package vacademy.io.admin_core_service.features.enroll_invite.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Sends the "someone filled your invite form" alert to the team members an admin
 * configured on the invite link.
 *
 * <p>
 * This is the enroll-invite twin of the audience campaign's Team Notifications
 * (audience.to_notify): the recipient list is authored on the invite-creation
 * form and stored in enroll_invite.setting_json under
 * {@code setting.NOTIFICATION_SETTING.TO_NOTIFY} as a comma-separated string, so
 * no schema change is needed.
 *
 * <p>
 * Every failure here is swallowed — a bad mailbox or a notification-service
 * outage must never fail the learner's form submission or enrollment.
 */
@Slf4j
@Service
public class InviteFormAdminNotificationService {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private CustomFieldRepository customFieldRepository;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * Mails every configured team member with the details the learner just submitted.
     *
     * @param enrollInvite      the invite whose form was filled (carries the recipient list)
     * @param user              the learner who filled the form
     * @param customFieldValues the custom-field answers from the submission (may be null)
     */
    public void notifyAdminsOnFormFill(EnrollInvite enrollInvite,
            UserDTO user,
            List<CustomFieldValueDTO> customFieldValues) {
        try {
            if (enrollInvite == null) {
                return;
            }

            List<String> recipients = resolveRecipients(enrollInvite);
            if (CollectionUtils.isEmpty(recipients)) {
                return;
            }

            Map<String, String> customFields = buildCustomFieldMapForEmail(customFieldValues);
            String inviteName = StringUtils.hasText(enrollInvite.getName())
                    ? enrollInvite.getName()
                    : "Invite Link";
            String body = buildAdminNotificationBody(
                    inviteName,
                    user != null ? user.getFullName() : null,
                    user != null ? user.getEmail() : null,
                    user != null ? user.getMobileNumber() : null,
                    customFields);

            log.info("Sending invite-form notification for invite {} to {} recipient(s)",
                    enrollInvite.getId(), recipients.size());

            for (String recipient : recipients) {
                GenericEmailRequest emailRequest = new GenericEmailRequest();
                emailRequest.setTo(recipient);
                emailRequest.setSubject("New Form Submission - " + inviteName);
                emailRequest.setBody(body);

                try {
                    notificationService.sendGenericHtmlMailViaUnified(emailRequest, enrollInvite.getInstituteId());
                    log.info("Sent invite-form notification to: {}", recipient);
                } catch (Exception ex) {
                    log.error("Failed to send invite-form notification to {}: {}", recipient, ex.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Failed to send invite-form admin notifications for invite {}: {}",
                    enrollInvite != null ? enrollInvite.getId() : null, e.getMessage(), e);
        }
    }

    /**
     * Strips {@code setting.NOTIFICATION_SETTING} out of a setting_json blob.
     *
     * <p>
     * The learner-facing invite endpoints are open (no auth) and hand the whole
     * setting_json to the browser so the FE can read the availability message and
     * post-form-fill config. The team's email addresses have no business being in
     * that payload, so every open read runs the JSON through here first.
     *
     * @return the setting_json without the notification block, or the input unchanged
     *         when there is nothing to strip
     */
    public String redactFromSettingJson(String settingJson) {
        if (!StringUtils.hasText(settingJson)) {
            return settingJson;
        }
        try {
            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode setting = root.get("setting");
            if (!(setting instanceof ObjectNode) || !setting.has("NOTIFICATION_SETTING")) {
                return settingJson;
            }
            ((ObjectNode) setting).remove("NOTIFICATION_SETTING");
            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            log.warn("Could not redact notification settings from setting_json: {}", e.getMessage());
            return settingJson;
        }
    }

    /**
     * Reads setting_json → setting.NOTIFICATION_SETTING and returns the de-duplicated,
     * trimmed recipient list. An explicit {@code ENABLED: false} turns the alert off
     * without the admin having to clear the addresses.
     */
    private List<String> resolveRecipients(EnrollInvite enrollInvite) {
        if (!StringUtils.hasText(enrollInvite.getSettingJson())) {
            return Collections.emptyList();
        }

        EnrollInviteSettingDTO settingDTO;
        try {
            settingDTO = objectMapper.readValue(enrollInvite.getSettingJson(), EnrollInviteSettingDTO.class);
        } catch (Exception e) {
            log.warn("Could not parse setting_json for invite {}: {}", enrollInvite.getId(), e.getMessage());
            return Collections.emptyList();
        }

        if (settingDTO == null || settingDTO.getSetting() == null
                || settingDTO.getSetting().getNotificationSetting() == null) {
            return Collections.emptyList();
        }

        EnrollInviteSettingDTO.NotificationSetting notificationSetting = settingDTO.getSetting()
                .getNotificationSetting();
        if (Boolean.FALSE.equals(notificationSetting.getEnabled())) {
            return Collections.emptyList();
        }
        if (!StringUtils.hasText(notificationSetting.getToNotify())) {
            return Collections.emptyList();
        }

        Set<String> seen = new LinkedHashSet<>();
        List<String> recipients = new ArrayList<>();
        for (String email : notificationSetting.getToNotify().split(",")) {
            String trimmed = email.trim();
            if (!StringUtils.hasText(trimmed)) {
                continue;
            }
            if (seen.add(trimmed.toLowerCase(Locale.ROOT))) {
                recipients.add(trimmed);
            }
        }
        return recipients;
    }

    /**
     * Turns the submitted custom-field answers into a readable {label -> value} map by
     * resolving each custom_field_id against its definition.
     */
    private Map<String, String> buildCustomFieldMapForEmail(List<CustomFieldValueDTO> customFieldValues) {
        if (CollectionUtils.isEmpty(customFieldValues)) {
            return Collections.emptyMap();
        }

        Set<String> customFieldIds = customFieldValues.stream()
                .map(CustomFieldValueDTO::getCustomFieldId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        if (customFieldIds.isEmpty()) {
            return Collections.emptyMap();
        }

        Map<String, String> fieldIdToName = new HashMap<>();
        try {
            for (CustomFields definition : customFieldRepository.findAllById(customFieldIds)) {
                fieldIdToName.putIfAbsent(definition.getId(), definition.getFieldName());
            }
        } catch (Exception e) {
            log.warn("Could not resolve custom field labels for invite-form notification: {}", e.getMessage());
            return Collections.emptyMap();
        }

        // LinkedHashMap so the email lists the answers in the order the learner filled them.
        Map<String, String> result = new LinkedHashMap<>();
        for (CustomFieldValueDTO value : customFieldValues) {
            String fieldName = fieldIdToName.get(value.getCustomFieldId());
            if (StringUtils.hasText(fieldName) && StringUtils.hasText(value.getValue())) {
                result.put(fieldName, value.getValue());
            }
        }
        return result;
    }

    private String buildAdminNotificationBody(String inviteName, String userName, String userEmail,
            String userMobile, Map<String, String> customFields) {
        StringBuilder emailBody = new StringBuilder();

        java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
        java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                .ofPattern("MMM dd, yyyy hh:mm a z");
        String submissionTime = now.format(formatter);

        emailBody.append("<!DOCTYPE html>");
        emailBody.append("<html lang='en'>");
        emailBody.append("<head>");
        emailBody.append("<meta charset='UTF-8'>");
        emailBody.append("<meta name='viewport' content='width=device-width, initial-scale=1.0'>");
        emailBody.append("<style>");
        emailBody.append(
                "body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }");
        emailBody.append(
                ".container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }");
        emailBody
                .append(".header { background-color: #2c3e50; color: white; padding: 30px 20px; text-align: center; }");
        emailBody.append(".header h1 { margin: 0; font-size: 24px; font-weight: 600; }");
        emailBody.append(
                ".badge { background-color: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; display: inline-block; margin-top: 10px; font-size: 14px; }");
        emailBody.append(".content { padding: 30px 20px; }");
        emailBody.append(".alert-icon { text-align: center; margin-bottom: 20px; font-size: 48px; }");
        emailBody.append(
                ".message { color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 25px; text-align: center; }");
        emailBody.append(".invite-name { color: #2c3e50; font-weight: 600; font-size: 18px; }");
        emailBody.append(
                ".info-section { background-color: #f9f9f9; border-left: 4px solid #2c3e50; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }");
        emailBody.append(".info-section h3 { color: #2c3e50; margin: 0 0 15px 0; font-size: 16px; font-weight: 600; }");
        emailBody.append(".info-item { display: flex; padding: 8px 0; border-bottom: 1px solid #e9ecef; }");
        emailBody.append(".info-item:last-child { border-bottom: none; }");
        emailBody.append(".info-label { font-weight: 600; color: #495057; min-width: 140px; }");
        emailBody.append(".info-value { color: #6c757d; flex: 1; word-break: break-word; }");
        emailBody.append(
                ".action-section { background-color: #e8e8e8; padding: 20px; margin: 25px 0; border-radius: 8px; text-align: center; border-left: 4px solid #2c3e50; }");
        emailBody.append(".action-section p { color: #2c3e50; margin: 0; font-size: 14px; font-weight: 600; }");
        emailBody.append(
                ".footer { background-color: #f9f9f9; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }");
        emailBody.append(".footer p { margin: 5px 0; }");
        emailBody.append("</style>");
        emailBody.append("</head>");
        emailBody.append("<body>");
        emailBody.append("<div class='container'>");

        emailBody.append("<div class='header'>");
        emailBody.append("<h1>&#128276; New Form Submission</h1>");
        emailBody.append("<div class='badge'>Admin Alert</div>");
        emailBody.append("</div>");

        emailBody.append("<div class='content'>");
        emailBody.append("<div class='alert-icon'>&#127919;</div>");
        emailBody.append("<div class='message'>");
        emailBody.append("Someone just filled the enrollment form for:<br>");
        emailBody.append("<span class='invite-name'>").append(escapeHtml(inviteName)).append("</span>");
        emailBody.append("</div>");

        emailBody.append("<div class='info-section'>");
        emailBody.append("<h3>Submission Details</h3>");
        appendInfoItem(emailBody, "Name", userName);
        appendInfoItem(emailBody, "Email", userEmail);
        appendInfoItem(emailBody, "Mobile", userMobile);
        appendInfoItem(emailBody, "Submitted", submissionTime);
        emailBody.append("</div>");

        if (!CollectionUtils.isEmpty(customFields)) {
            emailBody.append("<div class='info-section'>");
            emailBody.append("<h3>Additional Information</h3>");
            for (Map.Entry<String, String> entry : customFields.entrySet()) {
                appendInfoItem(emailBody, entry.getKey(), entry.getValue());
            }
            emailBody.append("</div>");
        }

        emailBody.append("<div class='action-section'>");
        emailBody.append(
                "<p>&#128161; <strong>Action Required:</strong> Follow up with this learner as soon as possible to maximize conversion.</p>");
        emailBody.append("</div>");

        emailBody.append("</div>");

        emailBody.append("<div class='footer'>");
        emailBody.append("<p>This is an automated notification from your enrollment system.</p>");
        emailBody.append("</div>");

        emailBody.append("</div>");
        emailBody.append("</body>");
        emailBody.append("</html>");

        return emailBody.toString();
    }

    private void appendInfoItem(StringBuilder emailBody, String label, String value) {
        if (!StringUtils.hasText(value)) {
            return;
        }
        emailBody.append("<div class='info-item'>");
        emailBody.append("<span class='info-label'>").append(escapeHtml(label)).append(":</span>");
        emailBody.append("<span class='info-value'>").append(escapeHtml(value)).append("</span>");
        emailBody.append("</div>");
    }

    /** Learner-supplied answers land in an HTML mail, so keep them from breaking the markup. */
    private String escapeHtml(String value) {
        if (value == null) {
            return "";
        }
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
