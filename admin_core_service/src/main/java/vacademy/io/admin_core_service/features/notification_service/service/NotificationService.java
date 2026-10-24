package vacademy.io.admin_core_service.features.notification_service.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.notification.constants.NotificationConstant;
import vacademy.io.admin_core_service.features.notification.dto.MessageOrigin;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.dto.WhatsappRequest;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.GenericEmailRequest;
import vacademy.io.common.logging.SentryLogger;

import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class NotificationService {

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${notification.server.baseurl}")
    private String notificationServerBaseUrl;

    /**
     * Past this recipient count the bridge methods queue the send to
     * notification-service's durable batch processor instead of letting it send
     * inline. An inline send loops one provider call per recipient, so a
     * multi-recipient send routinely outlives InternalClientUtils' 30s read
     * timeout — the caller then sees a ResourceAccessException (surfacing as a
     * 511) while delivery keeps running server-side, and any transaction the
     * caller was in gets rolled back. Mirrors AudienceService's threshold.
     */
    private static final int ASYNC_SEND_THRESHOLD = 10;

    // ==================== Unified Send API ====================

    /**
     * Send notification via the unified API — single endpoint for WhatsApp, Email, Push, System Alert.
     * Supports sync (<=100 recipients) and async batch (>100).
     * New callers should prefer this over the channel-specific methods above.
     */
    public UnifiedSendResponse sendUnified(UnifiedSendRequest request) {
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.POST.name(),
                notificationServerBaseUrl,
                NotificationConstant.UNIFIED_SEND,
                request);

        if (response == null || response.getBody() == null) {
            throw new VacademyException("Empty response from unified send API");
        }

        ObjectMapper mapper = new ObjectMapper();
        mapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {
            return mapper.readValue(response.getBody(), UnifiedSendResponse.class);
        } catch (JsonProcessingException e) {
            SentryLogger.logError(e, "Failed to parse unified send response", Map.of(
                    "notification.type", request.getChannel() != null ? request.getChannel() : "unknown",
                    "institute.id", request.getInstituteId() != null ? request.getInstituteId() : "unknown",
                    "operation", "sendUnified"));
            throw new VacademyException("Error parsing unified send response: " + e.getMessage());
        }
    }

    // ==================== Bridge Methods (old DTO → unified send) ====================

    /**
     * Bridge: converts old NotificationDTO (email) → unified send.
     * Preserves all placeholders as variables. Body + subject contain {{key}} placeholders
     * which notification service resolves per-recipient.
     */
    public UnifiedSendResponse sendEmailViaUnified(NotificationDTO dto, String instituteId) {
        List<UnifiedSendRequest.Recipient> recipients = new java.util.ArrayList<>();
        if (dto.getUsers() != null) {
            for (NotificationToUserDTO user : dto.getUsers()) {
                recipients.add(UnifiedSendRequest.Recipient.builder()
                        .email(user.getChannelId())
                        .userId(user.getUserId())
                        .variables(user.getPlaceholders())
                        .build());
            }
        }

        return sendUnified(UnifiedSendRequest.builder()
                .instituteId(instituteId)
                .channel("EMAIL")
                .recipients(recipients)
                .forceAsync(recipients.size() > ASYNC_SEND_THRESHOLD)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(dto.getSubject())
                        .emailBody(dto.getBody())
                        .emailType("UTILITY_EMAIL")
                        .source(dto.getSource())
                        .sourceId(dto.getSourceId())
                        .build())
                .build());
    }

    /**
     * Bridge: converts old GenericEmailRequest → unified send.
     * Overload 1: with explicit params
     */
    public UnifiedSendResponse sendHtmlEmailViaUnified(
            String to, String subject, String body, String instituteId,
            String fromEmail, String fromName, String emailType) {

        return sendUnified(UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                        .email(to).build()))
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(subject)
                        .emailBody(body)
                        .emailType(emailType != null ? emailType : "UTILITY_EMAIL")
                        .fromEmail(fromEmail)
                        .fromName(fromName)
                        .source("html-email")
                        .build())
                .build());
    }

    /**
     * Bridge: List<NotificationDTO> (batch email) → unified send. Sends each DTO sequentially.
     * Drop-in replacement for sendEmailToUsersMultiple.
     */
    public void sendEmailToUsersMultipleViaUnified(List<NotificationDTO> dtos, String instituteId) {
        for (NotificationDTO dto : dtos) {
            try {
                sendEmailViaUnified(dto, instituteId);
            } catch (Exception e) {
                log.error("Failed to send batch email for source {}: {}", dto.getSourceId(), e.getMessage());
            }
        }
    }

    /**
     * Bridge: GenericEmailRequest object → unified send.
     * Drop-in replacement for sendGenericHtmlMail(request, instituteId).
     */
    public UnifiedSendResponse sendGenericHtmlMailViaUnified(GenericEmailRequest request, String instituteId) {
        return sendHtmlEmailViaUnified(
                request.getTo(), request.getSubject(), request.getBody(),
                instituteId, null, null,
                request.getEmailType() != null ? request.getEmailType() : "UTILITY_EMAIL");
    }

    /**
     * Bridge: GenericEmailRequest without instituteId.
     */
    public UnifiedSendResponse sendGenericHtmlMailViaUnified(GenericEmailRequest request) {
        return sendGenericHtmlMailViaUnified(request, null);
    }

    /**
     * Bridge: converts old WhatsappRequest → unified send.
     * Maps the legacy Map<phone, Map<key,value>> format to recipients with variables.
     */
    public UnifiedSendResponse sendWhatsappViaUnified(WhatsappRequest request, String instituteId) {
        return sendWhatsappViaUnified(request, instituteId, null);
    }

    /**
     * As {@link #sendWhatsappViaUnified(WhatsappRequest, String)}, recording who is sending
     * (e.g. a workflow) so the WhatsApp Inbox and the student timeline can show it.
     */
    public UnifiedSendResponse sendWhatsappViaUnified(WhatsappRequest request, String instituteId,
                                                      MessageOrigin origin) {
        List<UnifiedSendRequest.Recipient> recipients = new java.util.ArrayList<>();

        log.info("sendWhatsappViaUnified: template={}, userDetails={}, headerParams={}, headerVideoParams={}, buttonUrlParams={}, buttonIndexParams={}, headerType={}",
                request.getTemplateName(),
                request.getUserDetails() != null ? request.getUserDetails().size() : 0,
                request.getHeaderParams() != null ? request.getHeaderParams().keySet() : "null",
                request.getHeaderVideoParams() != null ? request.getHeaderVideoParams().keySet() : "null",
                request.getButtonUrlParams() != null ? request.getButtonUrlParams().keySet() : "null",
                request.getButtonIndexParams() != null ? request.getButtonIndexParams().keySet() : "null",
                request.getHeaderType());

        if (request.getUserDetails() != null) {
            for (Map<String, Map<String, String>> userDetail : request.getUserDetails()) {
                for (Map.Entry<String, Map<String, String>> entry : userDetail.entrySet()) {
                    String phone = entry.getKey().replaceAll("[^0-9]", "");
                    Map<String, String> vars = new java.util.HashMap<>(
                            entry.getValue() != null ? entry.getValue() : Map.of());

                    // Inject per-phone header URL (image)
                    if (request.getHeaderParams() != null && request.getHeaderParams().containsKey(phone)) {
                        Map<String, String> headerMap = request.getHeaderParams().get(phone);
                        if (headerMap != null) {
                            // headerParams format: phone -> {"1": "imageUrl"} — extract the URL
                            String headerUrl = headerMap.values().stream().findFirst().orElse(null);
                            if (headerUrl != null) {
                                vars.put("_headerUrl", headerUrl);
                                vars.put("_headerType", "image");
                            }
                        }
                    }

                    // Inject per-phone header video URL
                    if (request.getHeaderVideoParams() != null && request.getHeaderVideoParams().containsKey(phone)) {
                        vars.put("_headerUrl", request.getHeaderVideoParams().get(phone));
                        vars.put("_headerType", "video");
                    }

                    // Inject per-phone button URL param + index
                    if (request.getButtonUrlParams() != null && request.getButtonUrlParams().containsKey(phone)) {
                        vars.put("_buttonUrl", request.getButtonUrlParams().get(phone));
                        String btnIdx = (request.getButtonIndexParams() != null)
                                ? request.getButtonIndexParams().get(phone) : null;
                        vars.put("_buttonIndex", btnIdx != null ? btnIdx : "0");
                    }

                    recipients.add(UnifiedSendRequest.Recipient.builder()
                            .phone(phone)
                            .variables(vars)
                            .build());
                }
            }
        }

        UnifiedSendRequest.SendOptions.SendOptionsBuilder optsBuilder =
                UnifiedSendRequest.SendOptions.builder().source("whatsapp-bridge");

        if (request.getHeaderType() != null) {
            optsBuilder.headerType(request.getHeaderType());
        }
        if (origin != null) {
            optsBuilder.originType(origin.type()).originId(origin.id()).originName(origin.name());
        }

        return sendUnified(UnifiedSendRequest.builder()
                .instituteId(instituteId)
                .channel("WHATSAPP")
                .templateName(request.getTemplateName())
                .languageCode(request.getLanguageCode() != null ? request.getLanguageCode() : "en")
                .recipients(recipients)
                .options(optsBuilder.build())
                .build());
    }

    /**
     * Bridge: List<WhatsappRequest> (batch) → unified send. Sends each request sequentially.
     */
    public void sendWhatsappViaUnified(List<WhatsappRequest> requests, String instituteId) {
        sendWhatsappViaUnified(requests, instituteId, null);
    }

    /** Batch form of {@link #sendWhatsappViaUnified(WhatsappRequest, String, MessageOrigin)}. */
    public void sendWhatsappViaUnified(List<WhatsappRequest> requests, String instituteId, MessageOrigin origin) {
        for (WhatsappRequest request : requests) {
            try {
                sendWhatsappViaUnified(request, instituteId, origin);
            } catch (Exception e) {
                log.error("Failed to send WhatsApp batch for template {}: {}",
                        request.getTemplateName(), e.getMessage());
                SentryLogger.logError(e, "WhatsApp HTTP bridge failed — notification_service unreachable or returned error",
                        Map.of("template.name", request.getTemplateName() != null ? request.getTemplateName() : "unknown",
                                "layer", "3-notification-bridge"));
            }
        }
    }

    /**
     * Bridge: push notification → unified send.
     */
    public UnifiedSendResponse sendPushViaUnified(
            String instituteId, List<String> userIds, String title, String body, Map<String, String> data) {

        List<UnifiedSendRequest.Recipient> recipients = userIds.stream()
                .map(id -> UnifiedSendRequest.Recipient.builder().userId(id).build())
                .collect(java.util.stream.Collectors.toList());

        return sendUnified(UnifiedSendRequest.builder()
                .instituteId(instituteId)
                .channel("PUSH")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .pushTitle(title)
                        .pushBody(body)
                        .pushData(data)
                        .source("push-bridge")
                        .build())
                .build());
    }

    /**
     * Bridge: system alert → unified send.
     */
    public UnifiedSendResponse sendSystemAlertViaUnified(
            String instituteId, List<String> userIds, String title, String body) {

        List<UnifiedSendRequest.Recipient> recipients = userIds.stream()
                .map(id -> UnifiedSendRequest.Recipient.builder().userId(id).build())
                .collect(java.util.stream.Collectors.toList());

        return sendUnified(UnifiedSendRequest.builder()
                .instituteId(instituteId)
                .channel("SYSTEM_ALERT")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .pushTitle(title)
                        .pushBody(body)
                        .source("system-alert-bridge")
                        .build())
                .build());
    }

    /**
     * Bridge: List<AttachmentNotificationDTO> → unified send with attachments.
     * Converts base64 attachments from old DTO format to new Recipient.attachments format.
     */
    public UnifiedSendResponse sendAttachmentEmailViaUnified(
            List<AttachmentNotificationDTO> dtos, String instituteId) {

        if (dtos == null || dtos.isEmpty()) {
            return UnifiedSendResponse.builder().total(0).accepted(0).failed(0).status("COMPLETED").build();
        }

        List<UnifiedSendRequest.Recipient> recipients = new java.util.ArrayList<>();

        for (AttachmentNotificationDTO dto : dtos) {
            if (dto.getUsers() == null) continue;

            for (vacademy.io.common.notification.dto.AttachmentUsersDTO user : dto.getUsers()) {
                List<UnifiedSendRequest.Attachment> attachments = new java.util.ArrayList<>();
                if (user.getAttachments() != null) {
                    for (vacademy.io.common.notification.dto.AttachmentUsersDTO.AttachmentDTO att : user.getAttachments()) {
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

        // Use first DTO for subject/body (all DTOs in a batch typically share the same template)
        AttachmentNotificationDTO first = dtos.get(0);
        String emailType = first.getEmailType() != null ? first.getEmailType() : "UTILITY_EMAIL";

        return sendUnified(UnifiedSendRequest.builder()
                .instituteId(instituteId != null ? instituteId : "")
                .channel("EMAIL")
                .recipients(recipients)
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(first.getSubject())
                        .emailBody(first.getBody())
                        .emailType(emailType)
                        .source(first.getSource())
                        .sourceId(first.getSourceId())
                        .build())
                .build());
    }

    /**
     * Create a SYSTEM_ALERT announcement so the recipients' bell icon lights up. Unlike
     * {@link #sendSystemAlertViaUnified} (which only emits an FCM push), this persists an
     * Announcement + AnnouncementSystemAlert + RecipientMessage chain in notification-service — the
     * exact rows that {@code /v1/user-messages/user/{userId}/system-alerts} queries.
     *
     * <p>Fire-and-forget from the caller's perspective: any HTTP or parse failure is logged and
     * swallowed here so a transient notification-service blip never fails the business flow (doubt
     * create / resolve / etc.).
     *
     * @param createdByRole passed as "ADMIN" to bypass the institute's optional approval gate —
     *                      system-generated alerts (doubts, etc.) shouldn't wait for a human to
     *                      approve them. Real user-authored announcements still flow through the
     *                      normal approval setting.
     */
    public void createSystemAlertAnnouncement(
            String instituteId, List<String> userIds, String title, String body,
            String createdBy, String createdByName, String createdByRole,
            Map<String, Object> alertSettings) {
        createSystemAlertAnnouncement(instituteId, userIds, title, body, createdBy,
                createdByName, createdByRole, alertSettings, null, null);
    }

    /**
     * As above, but tagging the announcement with what it is ABOUT so it can be
     * found and switched off later — a lead-assignment alert that must stay on
     * the bell until the counsellor has actually worked that lead.
     */
    public void createSystemAlertAnnouncement(
            String instituteId, List<String> userIds, String title, String body,
            String createdBy, String createdByName, String createdByRole,
            Map<String, Object> alertSettings, String entity, String entityId) {
        if (instituteId == null || instituteId.isEmpty()) return;
        if (userIds == null || userIds.isEmpty()) return;

        List<Map<String, Object>> recipients = userIds.stream()
                .filter(id -> id != null && !id.isEmpty())
                .distinct()
                .map(id -> {
                    Map<String, Object> r = new java.util.HashMap<>();
                    r.put("recipientType", "USER");
                    r.put("recipientId", id);
                    return r;
                })
                .collect(java.util.stream.Collectors.toList());
        if (recipients.isEmpty()) return;

        // CreateAnnouncementRequest applies @NotBlank to title + RichTextDataRequest.content, so
        // a transiently-null doubt summary would cause the notification-service to 400 the whole
        // batch. Keep the bell-alert best-effort by substituting a neutral fallback instead of
        // letting validation fail.
        String safeTitle = (title == null || title.isBlank()) ? "Notification" : title;
        String safeBody = (body == null || body.isBlank()) ? "Tap to view details." : body;

        Map<String, Object> content = new java.util.HashMap<>();
        content.put("type", "text");
        content.put("content", safeBody);

        Map<String, Object> mode = new java.util.HashMap<>();
        mode.put("modeType", "SYSTEM_ALERT");
        // Defaults match AnnouncementSystemAlert entity defaults (priority=1, dismissible=true, badge=true).
        mode.put("settings", alertSettings != null ? alertSettings : Map.of(
                "priority", 2,
                "isDismissible", true,
                "showBadge", true,
                "isActive", true));

        Map<String, Object> payload = new java.util.HashMap<>();
        payload.put("title", safeTitle);
        payload.put("content", content);
        payload.put("instituteId", instituteId);
        payload.put("createdBy", createdBy != null && !createdBy.isEmpty() ? createdBy : "system");
        payload.put("createdByName", createdByName != null ? createdByName : "System");
        if (entity != null && !entity.isBlank() && entityId != null && !entityId.isBlank()) {
            payload.put("entity", entity);
            payload.put("entityId", entityId);
        }
        payload.put("createdByRole", createdByRole != null ? createdByRole : "ADMIN");
        payload.put("recipients", recipients);
        payload.put("modes", List.of(mode));

        try {
            internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    notificationServerBaseUrl,
                    NotificationConstant.ANNOUNCEMENT_MULTIPLE,
                    List.of(payload));
        } catch (Exception e) {
            log.warn("System alert announcement dispatch failed (institute={}, users={}): {}",
                    instituteId, recipients.size(), e.getMessage());
        }
    }

    /**
     * Switch off the still-active system alerts raised about one entity.
     *
     * The lead-assignment bell is not dismissible on purpose — it is meant to
     * stay until the counsellor works the lead — so this is the only way it
     * comes down. Best-effort like every other call here: a notification-service
     * blip must never fail the activity that triggered it.
     */
    public void deactivateSystemAlertsForEntity(String instituteId, String entity, String entityId) {
        if (instituteId == null || instituteId.isBlank()
                || entity == null || entity.isBlank()
                || entityId == null || entityId.isBlank()) {
            return;
        }
        try {
            String route = NotificationConstant.SYSTEM_ALERT_DEACTIVATE_BY_ENTITY
                    + "?instituteId=" + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&entity=" + java.net.URLEncoder.encode(entity, java.nio.charset.StandardCharsets.UTF_8)
                    + "&entityId=" + java.net.URLEncoder.encode(entityId, java.nio.charset.StandardCharsets.UTF_8);
            internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.PUT.name(), notificationServerBaseUrl, route, null);
        } catch (Exception e) {
            log.warn("Could not clear system alerts for {} {} (institute={}): {}",
                    entity, entityId, instituteId, e.getMessage());
        }
    }

    /**
     * Poll batch status for async sends.
     */
    public UnifiedSendResponse getUnifiedBatchStatus(String batchId) {
        String url = NotificationConstant.UNIFIED_SEND + "/" + batchId + "/status";
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.GET.name(),
                notificationServerBaseUrl,
                url,
                null);

        ObjectMapper mapper = new ObjectMapper();
        mapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {
            return mapper.readValue(response.getBody(), UnifiedSendResponse.class);
        } catch (JsonProcessingException e) {
            throw new VacademyException("Error parsing batch status response: " + e.getMessage());
        }
    }
}
