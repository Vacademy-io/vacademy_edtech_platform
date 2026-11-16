package vacademy.io.admin_core_service.features.commerce.otp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateConfigDTO;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.dto.WhatsappRequest;
import vacademy.io.admin_core_service.features.notification.service.NotificationConfigService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Delivers a shop OTP as a WhatsApp template message: the institute's sender and its
 * approved {@code OTP_REQUEST} template, through the platform's unified send. The code comes
 * from {@link CommerceOtpService}; the platform's shared OTP store is neither written nor read,
 * so a shop code is checked only by {@link CommerceOtpService}.
 *
 * <p>The code is the first body parameter of the template and, when the template's setting
 * declares a button parameter (the copy-code button of a Meta authentication template), also
 * the parameter of button 0.
 *
 * <p>The phone number and the code are not logged here.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WhatsAppOtpDelivery implements CommerceOtpTransport {

    static final String EVENT = "OTP_REQUEST";
    static final String CHANNEL = "WHATSAPP";

    private final NotificationConfigService notificationConfigService;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper;

    @Override
    public void send(String instituteId, String phone, String code) {
        NotificationTemplateConfigDTO template;
        try {
            template = notificationConfigService.getTemplateConfigByEvent(EVENT, instituteId, CHANNEL);
        } catch (RuntimeException e) {
            // No OTP template is set up for the institute.
            log.warn("Commerce OTP: institute {} has no {} WhatsApp template ({})", instituteId, EVENT,
                    e.getClass().getSimpleName());
            throw unavailable();
        }
        if (template == null || !StringUtils.hasText(template.getTemplateName())) {
            log.warn("Commerce OTP: institute {} has no {} WhatsApp template", instituteId, EVENT);
            throw unavailable();
        }

        String digits = phone.replaceAll("[^0-9]", "");
        Map<String, String> body = new LinkedHashMap<>();
        body.put("1", code);
        WhatsappRequest request = new WhatsappRequest();
        request.setTemplateName(template.getTemplateName());
        request.setLanguageCode(StringUtils.hasText(template.getLanguageCode()) ? template.getLanguageCode() : "en");
        request.setUserDetails(List.of(Map.of(digits, body)));
        if (hasButtonParameter(template.getSettingJson())) {
            request.setButtonUrlParams(Map.of(digits, code));
            request.setButtonIndexParams(Map.of(digits, "0"));
        }

        UnifiedSendResponse response;
        try {
            response = notificationService.sendWhatsappViaUnified(request, instituteId);
        } catch (RuntimeException e) {
            // The message of a send failure can carry the phone: only its type is logged.
            log.warn("Commerce OTP send failed for institute {}: {}", instituteId, e.getClass().getSimpleName());
            throw unavailable();
        }
        if (response == null || response.getAccepted() < 1 || "FAILED".equalsIgnoreCase(response.getStatus())) {
            log.warn("Commerce OTP was not accepted for sending for institute {}", instituteId);
            throw unavailable();
        }
    }

    /** True unless the setting says the template has no button parameter. */
    boolean hasButtonParameter(String settingJson) {
        if (!StringUtils.hasText(settingJson)) {
            return true; // the fixed shape of a Meta authentication template
        }
        try {
            JsonNode parameters = objectMapper.readTree(settingJson).path("parameters");
            if (parameters.isMissingNode() || parameters.isNull()) {
                return true;
            }
            JsonNode button = parameters.path("button");
            return button.isArray() && !button.isEmpty();
        } catch (Exception e) {
            return true;
        }
    }

    private static CommerceOtpException unavailable() {
        return new CommerceOtpException(CommerceOtpException.UNAVAILABLE, "The code could not be sent");
    }
}
