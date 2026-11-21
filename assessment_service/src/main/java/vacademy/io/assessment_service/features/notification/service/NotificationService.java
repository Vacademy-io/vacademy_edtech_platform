package vacademy.io.assessment_service.features.notification.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.assessment_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.assessment_service.features.notification.dto.unified.UnifiedSendRequest;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

@Service
@Slf4j
public class NotificationService {

    private static final String UNIFIED_SEND = "/notification-service/internal/v1/send";
    /** Bulk announcement create — the rows the dashboard bell actually reads. */
    private static final String ANNOUNCEMENT_MULTIPLE = "/notification-service/v1/announcements/admin/multiple";

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${notification.server.baseurl}")
    private String notificationServerBaseUrl;

    /**
     * Same as {@link #sendEmailToUsers} but says whether the notification service
     * accepted the send, for callers that must raise an alert when mail fails.
     */
    public boolean sendEmailToUsersReporting(NotificationDTO dto, String instituteId) {
        try {
            sendEmailToUsersOrThrow(dto, instituteId);
            return true;
        } catch (Exception e) {
            log.error("Failed to send email via unified API: {}", e.getMessage(), e);
            return false;
        }
    }

    public void sendEmailToUsers(NotificationDTO dto, String instituteId) {
        try {
            sendEmailToUsersOrThrow(dto, instituteId);
        } catch (Exception e) {
            log.error("Failed to send email via unified API: {}", e.getMessage(), e);
        }
    }

    private void sendEmailToUsersOrThrow(NotificationDTO dto, String instituteId) {
        List<UnifiedSendRequest.Recipient> recipients = new ArrayList<>();
        if (dto.getUsers() != null) {
            for (NotificationToUserDTO user : dto.getUsers()) {
                recipients.add(UnifiedSendRequest.Recipient.builder()
                        .email(user.getChannelId())
                        .userId(user.getUserId())
                        .variables(user.getPlaceholders())
                        .build());
            }
        }

        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("EMAIL")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(dto.getSubject())
                        .emailBody(dto.getBody())
                        .emailType("UTILITY_EMAIL")
                        .source(dto.getSource())
                        .sourceId(dto.getSourceId())
                        .build())
                .build();

        var response = internalClientUtils.makeHmacRequest(
                clientName, HttpMethod.POST.name(),
                notificationServerBaseUrl, UNIFIED_SEND, request);
        if (response == null || !response.getStatusCode().is2xxSuccessful()) {
            throw new IllegalStateException("notification service answered "
                    + (response == null ? "nothing" : response.getStatusCode()));
        }
    }

    public void sendAttachmentEmailToUsers(AttachmentNotificationDTO dto, String instituteId) {
        List<UnifiedSendRequest.Recipient> recipients = new ArrayList<>();

        if (dto.getUsers() != null) {
            for (AttachmentUsersDTO user : dto.getUsers()) {
                List<UnifiedSendRequest.Attachment> attachments = new ArrayList<>();
                if (user.getAttachments() != null) {
                    for (AttachmentUsersDTO.AttachmentDTO att : user.getAttachments()) {
                        attachments.add(UnifiedSendRequest.Attachment.builder()
                                .filename(att.getAttachmentName() != null ? att.getAttachmentName() : dto.getAttachmentName())
                                .contentBase64(att.getAttachment())
                                .build());
                    }
                }

                recipients.add(UnifiedSendRequest.Recipient.builder()
                        .email(user.getChannelId())
                        .userId(user.getUserId())
                        .variables(user.getPlaceholders())
                        .attachments(attachments)
                        .build());
            }
        }

        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("EMAIL")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(dto.getSubject())
                        .emailBody(dto.getBody())
                        .emailType(dto.getEmailType() != null ? dto.getEmailType() : "UTILITY_EMAIL")
                        .source(dto.getSource())
                        .sourceId(dto.getSourceId())
                        .build())
                .build();

        try {
            internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(),
                    notificationServerBaseUrl, UNIFIED_SEND, request);
        } catch (Exception e) {
            log.error("Failed to send attachment email via unified API: {}", e.getMessage(), e);
        }
    }

    /**
     * Sends an approved WhatsApp template to each recipient. Per-recipient values go in
     * {@code variables} (named; notification_service maps them to the template's positions),
     * and {@code _headerUrl} carries the document link when headerType is "document".
     * Returns whether the notification service accepted the batch.
     */
    public boolean sendWhatsAppTemplate(String instituteId, String templateName, String languageCode,
                                        List<UnifiedSendRequest.Recipient> recipients, String headerType,
                                        String source, String sourceId) {
        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("WHATSAPP")
                .templateName(templateName)
                .languageCode(languageCode)
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .headerType(headerType)
                        .source(source)
                        .sourceId(sourceId)
                        .build())
                .build();
        try {
            var response = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(), notificationServerBaseUrl, UNIFIED_SEND, request);
            return response != null && response.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            log.error("Failed to send WhatsApp template {} via unified API: {}", templateName, e.getMessage(), e);
            return false;
        }
    }

    public void sendPushNotificationToUsers(String instituteId, List<String> userIds, String title, String body, java.util.Map<String, String> data) {
        List<UnifiedSendRequest.Recipient> recipients = userIds.stream()
                .map(uid -> UnifiedSendRequest.Recipient.builder().userId(uid).build())
                .toList();

        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("PUSH")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .pushTitle(title)
                        .pushBody(body)
                        .pushData(data)
                        .build())
                .build();

        try {
            internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(),
                    notificationServerBaseUrl, UNIFIED_SEND, request);
        } catch (Exception e) {
            log.error("Failed to send push notification via unified API: {}", e.getMessage(), e);
        }
    }

    /**
     * Light the recipients' dashboard bell and push to their apps.
     *
     * The unified send's SYSTEM_ALERT channel is FCM push only; the bell in the
     * admin dashboard reads announcement system alerts
     * ({@code /v1/user-messages/user/{id}/system-alerts}). Until 2026-09-20 this
     * method only did the push, so every staff notice built on it (bulk copy
     * check, AI-check completion) reached nobody on the web. Same shape
     * admin_core_service's {@code createSystemAlertAnnouncement} uses; createdByRole
     * ADMIN bypasses the institute's optional announcement approval, as a
     * system notice must.
     */
    public void sendSystemAlertToUsers(String instituteId, List<String> userIds, String title, String body) {
        createBellAnnouncement(instituteId, userIds, title, body);
        List<UnifiedSendRequest.Recipient> recipients = userIds.stream()
                .map(uid -> UnifiedSendRequest.Recipient.builder().userId(uid).build())
                .toList();

        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("SYSTEM_ALERT")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .pushTitle(title)
                        .pushBody(body)
                        .build())
                .build();

        try {
            internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(),
                    notificationServerBaseUrl, UNIFIED_SEND, request);
        } catch (Exception e) {
            log.error("Failed to send system alert via unified API: {}", e.getMessage(), e);
        }
    }

    private void createBellAnnouncement(String instituteId, List<String> userIds, String title, String body) {
        if (instituteId == null || instituteId.isEmpty() || userIds == null) return;
        List<Map<String, Object>> recipients = userIds.stream()
                .filter(id -> id != null && !id.isEmpty())
                .distinct()
                .map(id -> Map.<String, Object>of("recipientType", "USER", "recipientId", id))
                .toList();
        if (recipients.isEmpty()) return;

        Map<String, Object> payload = new HashMap<>();
        payload.put("title", title == null || title.isBlank() ? "Notification" : title);
        payload.put("content", Map.of("type", "text", "content", body == null || body.isBlank() ? "Open to view details." : body));
        payload.put("instituteId", instituteId);
        payload.put("createdBy", "system");
        payload.put("createdByName", "System");
        payload.put("createdByRole", "ADMIN");
        payload.put("recipients", recipients);
        payload.put("modes", List.of(Map.of(
                "modeType", "SYSTEM_ALERT",
                "settings", Map.of("priority", 2, "isDismissible", true, "showBadge", true, "isActive", true))));
        try {
            internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(),
                    notificationServerBaseUrl, ANNOUNCEMENT_MULTIPLE, List.of(payload));
        } catch (Exception e) {
            log.error("Failed to create bell announcement (institute={}, users={}): {}",
                    instituteId, recipients.size(), e.getMessage());
        }
    }
}
