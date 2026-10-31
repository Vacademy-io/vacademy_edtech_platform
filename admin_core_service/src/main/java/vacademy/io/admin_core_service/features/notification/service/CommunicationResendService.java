package vacademy.io.admin_core_service.features.notification.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.notification.dto.ResendCommunicationRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Replays one already-sent message to the learner it originally went to.
 *
 * <p>The send itself still happens in notification-service; this only builds the request. It lives
 * in admin-core because the ACTION needs an actor: notification-service's {@code /v1/send} is
 * permitAll, so a resend posted straight there has no authenticated admin to name in the audit log.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CommunicationResendService {

    /** Stamped on the send so resent rows are identifiable in notification_log. */
    public static final String RESEND_SOURCE = "STUDENT_TIMELINE_RESEND";

    private static final String WHATSAPP = "WHATSAPP";
    private static final String EMAIL = "EMAIL";

    private final NotificationService notificationService;

    public UnifiedSendResponse resend(ResendCommunicationRequest request) {
        String channel = normaliseChannel(request.getChannel());

        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("instituteId is required");
        }
        if (!StringUtils.hasText(request.getRecipient())) {
            throw new VacademyException("This message has no recipient to resend to");
        }
        // A WhatsApp send is only ever a template — a free-text Inbox reply has nothing to replay,
        // and WhatsApp would refuse it outside the 24h session window anyway.
        if (WHATSAPP.equals(channel) && !StringUtils.hasText(request.getTemplateName())) {
            throw new VacademyException("Only template messages can be resent on WhatsApp");
        }
        if (EMAIL.equals(channel) && !StringUtils.hasText(request.getEmailBody())) {
            throw new VacademyException("The original email body was not stored, so there is nothing to resend");
        }

        UnifiedSendRequest.Recipient.RecipientBuilder recipient = UnifiedSendRequest.Recipient.builder()
                .userId(request.getRecipientUserId())
                .name(request.getRecipientName())
                .variables(request.getVariables());

        UnifiedSendRequest.SendOptions.SendOptionsBuilder options = UnifiedSendRequest.SendOptions.builder()
                .source(RESEND_SOURCE)
                // Correlates the audit row with the notification_log row this send writes.
                .sourceId(UUID.randomUUID().toString());

        if (WHATSAPP.equals(channel)) {
            recipient.phone(request.getRecipient());
            // Meta rejects a media-header template that arrives without its header component
            // (#132012), so the attachment the original send carried is threaded through again.
            if (isMediaHeader(request.getHeaderType()) && StringUtils.hasText(request.getHeaderUrl())) {
                options.headerType(request.getHeaderType().toLowerCase());
                options.headerUrl(request.getHeaderUrl());
            }
        } else {
            recipient.email(request.getRecipient());
            options.emailSubject(request.getEmailSubject());
            options.emailBody(request.getEmailBody());
            // emailType is deliberately left unset: the original send's type is not stored on the
            // log row, and notification-service defaults to UTILITY_EMAIL. Guessing PROMOTIONAL
            // here would change which unsubscribe list the resend is checked against.
        }

        UnifiedSendRequest send = UnifiedSendRequest.builder()
                .instituteId(request.getInstituteId())
                .channel(channel)
                .templateName(WHATSAPP.equals(channel) ? request.getTemplateName() : null)
                .languageCode(StringUtils.hasText(request.getLanguageCode()) ? request.getLanguageCode() : "en")
                .recipients(List.of(recipient.build()))
                .options(options.build())
                .build();

        UnifiedSendResponse response = notificationService.sendUnified(send);
        log.info("Resend {} to {} (template={}, log={}): accepted={} failed={}",
                channel, request.getRecipient(), request.getTemplateName(),
                request.getSourceLogId(),
                response != null ? response.getAccepted() : 0,
                response != null ? response.getFailed() : 0);
        return response;
    }

    /**
     * Whether the provider actually took the message. A rejected recipient rides back inside a 200
     * with {@code failed: 1}, and an audit row for that would claim a resend that never left.
     */
    public boolean wasAccepted(UnifiedSendResponse response) {
        return response != null
                && response.getFailed() == 0
                && !"FAILED".equals(response.getStatus());
    }

    /** Sentence for the activity-log row, e.g. "resent WhatsApp template welcome_v2 to Shristy". */
    public String describe(ResendCommunicationRequest request) {
        String channel = WHATSAPP.equals(normaliseChannel(request.getChannel())) ? "WhatsApp" : "email";
        String what = StringUtils.hasText(request.getTemplateName())
                ? " template " + request.getTemplateName()
                : StringUtils.hasText(request.getEmailSubject()) ? " \"" + request.getEmailSubject() + "\"" : "";
        String who = StringUtils.hasText(request.getRecipientName())
                ? request.getRecipientName()
                : request.getRecipient();
        String edited = request.isVariablesChanged() ? " with edited variables" : "";
        return "resent " + channel + what + " to " + who + edited;
    }

    private static String normaliseChannel(String channel) {
        String upper = channel == null ? "" : channel.trim().toUpperCase();
        if (!WHATSAPP.equals(upper) && !EMAIL.equals(upper)) {
            throw new VacademyException("Only WHATSAPP and EMAIL messages can be resent");
        }
        return upper;
    }

    private static boolean isMediaHeader(String headerType) {
        if (!StringUtils.hasText(headerType)) return false;
        return Map.of("IMAGE", true, "VIDEO", true, "DOCUMENT", true)
                .containsKey(headerType.trim().toUpperCase());
    }
}
