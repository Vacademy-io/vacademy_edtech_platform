package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.external.VendorCallLog;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.notification_service.dto.MetaWhatsAppPayload;
import vacademy.io.notification_service.dto.WhatsAppOTPRequest;
import vacademy.io.notification_service.dto.WhatsAppOTPResponse;

import java.util.ArrayList;
import java.util.List;

/**
 * Meta (Facebook) WhatsApp Business API provider implementation.
 * Expects normalized credentials from Factory: { accessToken, phoneNumberId }
 */
@Slf4j
public class MetaWhatsAppServiceProvider implements WhatsAppServiceProvider {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final String metaApiBaseUrl;

    public MetaWhatsAppServiceProvider(ObjectMapper objectMapper, RestTemplate restTemplate, String metaApiBaseUrl) {
        this.objectMapper = objectMapper;
        this.restTemplate = restTemplate;
        this.metaApiBaseUrl = metaApiBaseUrl;
    }

    @Override
    public WhatsAppOTPResponse sendOtp(WhatsAppOTPRequest request, String otp, JsonNode credentials) {
        try {
            // Extract credentials - Factory provides normalized flat structure
            String accessToken = credentials.path("accessToken").asText(null);
            String phoneNumberId = credentials.path("phoneNumberId").asText(null);

            if (accessToken == null || accessToken.isEmpty() || phoneNumberId == null || phoneNumberId.isEmpty()) {
                log.error("Meta credentials not configured. accessToken present: {}, phoneNumberId present: {}",
                        accessToken != null && !accessToken.isEmpty(),
                        phoneNumberId != null && !phoneNumberId.isEmpty());
                return WhatsAppOTPResponse.builder()
                        .success(false)
                        .message("WhatsApp credentials not configured correctly for Meta.")
                        .build();
            }

            // Build Meta API payload
            MetaWhatsAppPayload payload = buildMetaPayload(
                    request.getPhoneNumber(),
                    request.getTemplateName(),
                    request.getLanguageCode(),
                    otp,
                    request.getSettingJson());

            // Call Meta API
            boolean success = callMetaAPI(phoneNumberId, accessToken, payload, otp);

            if (success) {
                log.info("WhatsApp OTP sent successfully via Meta");
                // SECURITY: Do not return OTP in response
                return WhatsAppOTPResponse.builder()
                        .success(true)
                        .message("WhatsApp OTP sent successfully via Meta")
                        .build();
            } else {
                log.error("Failed to send WhatsApp OTP via Meta");
                return WhatsAppOTPResponse.builder()
                        .success(false)
                        .message("Failed to send WhatsApp OTP via Meta")
                        .build();
            }

        } catch (Exception e) {
            log.error("Exception in MetaWhatsAppServiceProvider: {}", e.getMessage(), e);
            return WhatsAppOTPResponse.builder()
                    .success(false)
                    .message("Exception sending Meta OTP: " + e.getMessage())
                    .build();
        }
    }

    /**
     * Send a generic (non-OTP) template message via the Meta Cloud API.
     * Builds a template payload with an optional IMAGE header (when
     * {@code headerImageUrl} is set) plus one text body parameter per entry in
     * {@code bodyParams}. Reuses the same Meta send path as OTP so
     * retries/logging stay consistent.
     *
     * @return true if the Meta API accepted the message.
     */
    public boolean sendTemplateMessage(String phoneNumberId, String accessToken, String phoneNumber,
            String templateName, String languageCode, List<String> bodyParams, String headerImageUrl) {
        if (accessToken == null || accessToken.isEmpty() || phoneNumberId == null || phoneNumberId.isEmpty()) {
            log.error("Meta credentials not configured for generic template send. accessToken present: {}, phoneNumberId present: {}",
                    accessToken != null && !accessToken.isEmpty(),
                    phoneNumberId != null && !phoneNumberId.isEmpty());
            return false;
        }

        List<MetaWhatsAppPayload.Component> components = new ArrayList<>();

        // IMAGE header (if the template declares one). Must precede the body component.
        if (headerImageUrl != null && !headerImageUrl.isBlank()) {
            components.add(MetaWhatsAppPayload.Component.builder()
                    .type("header")
                    .parameters(List.of(MetaWhatsAppPayload.Parameter.builder()
                            .type("image")
                            .image(MetaWhatsAppPayload.Image.builder().link(headerImageUrl).build())
                            .build()))
                    .build());
        }

        List<MetaWhatsAppPayload.Parameter> params = new ArrayList<>();
        if (bodyParams != null) {
            for (String value : bodyParams) {
                params.add(MetaWhatsAppPayload.Parameter.builder()
                        .type("text")
                        .text(value)
                        .build());
            }
        }

        if (!params.isEmpty()) {
            components.add(MetaWhatsAppPayload.Component.builder()
                    .type("body")
                    .parameters(params)
                    .build());
        }

        MetaWhatsAppPayload.Template template = MetaWhatsAppPayload.Template.builder()
                .name(templateName)
                .language(MetaWhatsAppPayload.Language.builder()
                        .code(languageCode)
                        .build())
                .components(components)
                .build();

        MetaWhatsAppPayload payload = MetaWhatsAppPayload.builder()
                .messagingProduct("whatsapp")
                .to(phoneNumber)
                .type("template")
                .template(template)
                .build();

        return callMetaAPI(phoneNumberId, accessToken, payload, null);
    }

    /**
     * Build Meta WhatsApp API payload from template configuration
     */
    private MetaWhatsAppPayload buildMetaPayload(String phoneNumber, String templateName, String languageCode,
            String otp, String settingJson) {
        try {
            // Parse setting_json to get parameter configuration
            JsonNode settingNode = objectMapper.readTree(settingJson);
            JsonNode parametersNode = settingNode.path("parameters");

            List<MetaWhatsAppPayload.Component> components = new ArrayList<>();

            // Build body component if configured
            if (parametersNode.has("body")) {
                JsonNode bodyParamsConfig = parametersNode.get("body");
                List<MetaWhatsAppPayload.Parameter> bodyParams = new ArrayList<>();

                if (bodyParamsConfig.isArray()) {
                    for (JsonNode paramConfig : bodyParamsConfig) {
                        if ("otp".equals(paramConfig.path("source").asText())) {
                            bodyParams.add(MetaWhatsAppPayload.Parameter.builder()
                                    .type(paramConfig.path("type").asText("text"))
                                    .text(otp)
                                    .build());
                        }
                    }
                }

                if (!bodyParams.isEmpty()) {
                    components.add(MetaWhatsAppPayload.Component.builder()
                            .type("body")
                            .parameters(bodyParams)
                            .build());
                }
            }

            // Build button component if configured
            if (parametersNode.has("button")) {
                JsonNode buttonParamsConfig = parametersNode.get("button");
                List<MetaWhatsAppPayload.Parameter> buttonParams = new ArrayList<>();

                if (buttonParamsConfig.isArray()) {
                    for (JsonNode paramConfig : buttonParamsConfig) {
                        if ("otp".equals(paramConfig.path("source").asText())) {
                            buttonParams.add(MetaWhatsAppPayload.Parameter.builder()
                                    .type(paramConfig.path("type").asText("text"))
                                    .text(otp)
                                    .build());
                        }
                    }
                }

                if (!buttonParams.isEmpty()) {
                    components.add(MetaWhatsAppPayload.Component.builder()
                            .type("button")
                            .subType("url")
                            .index("0")
                            .parameters(buttonParams)
                            .build());
                }
            }

            // Build template
            MetaWhatsAppPayload.Template template = MetaWhatsAppPayload.Template.builder()
                    .name(templateName)
                    .language(MetaWhatsAppPayload.Language.builder()
                            .code(languageCode)
                            .build())
                    .components(components)
                    .build();

            return MetaWhatsAppPayload.builder()
                    .messagingProduct("whatsapp")
                    .to(phoneNumber)
                    .type("template")
                    .template(template)
                    .build();

        } catch (Exception e) {
            log.error("Failed to parse settingJson, using default payload structure: {}", e.getMessage());
            return buildDefaultMetaPayload(phoneNumber, templateName, languageCode, otp);
        }
    }

    /**
     * Build default Meta WhatsApp API payload (fallback)
     */
    private MetaWhatsAppPayload buildDefaultMetaPayload(String phoneNumber, String templateName, String languageCode,
            String otp) {
        List<MetaWhatsAppPayload.Parameter> bodyParams = new ArrayList<>();
        bodyParams.add(MetaWhatsAppPayload.Parameter.builder()
                .type("text")
                .text(otp)
                .build());

        List<MetaWhatsAppPayload.Parameter> buttonParams = new ArrayList<>();
        buttonParams.add(MetaWhatsAppPayload.Parameter.builder()
                .type("text")
                .text(otp)
                .build());

        List<MetaWhatsAppPayload.Component> components = new ArrayList<>();
        components.add(MetaWhatsAppPayload.Component.builder()
                .type("body")
                .parameters(bodyParams)
                .build());
        components.add(MetaWhatsAppPayload.Component.builder()
                .type("button")
                .subType("url")
                .index("0")
                .parameters(buttonParams)
                .build());

        MetaWhatsAppPayload.Template template = MetaWhatsAppPayload.Template.builder()
                .name(templateName)
                .language(MetaWhatsAppPayload.Language.builder()
                        .code(languageCode)
                        .build())
                .components(components)
                .build();

        return MetaWhatsAppPayload.builder()
                .messagingProduct("whatsapp")
                .to(phoneNumber)
                .type("template")
                .template(template)
                .build();
    }

    /**
     * Call Meta WhatsApp API
     */
    private boolean callMetaAPI(String phoneNumberId, String accessToken, MetaWhatsAppPayload payload, String otp) {
        try {
            String url = metaApiBaseUrl + "/" + phoneNumberId + "/messages";
            log.info("Calling Meta API: {}", url);

            // SECURITY: Mask OTP in logs
            String maskedPayload = getMaskedPayloadForLogging(payload, otp);
            log.info("Meta API Payload (masked): {}", maskedPayload);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(accessToken);

            HttpEntity<MetaWhatsAppPayload> request = new HttpEntity<>(payload, headers);

            ResponseEntity<String> response;
            try {
                response = restTemplate.exchange(
                        url,
                        HttpMethod.POST,
                        request,
                        String.class);
            } catch (RestClientException e) {
                VendorCallLog.failed(url, "send template message", otp == null ? request : null, e);
                throw e;
            }

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Meta API call successful");
                return true;
            } else {
                log.error("Meta API call failed. Status: {}", response.getStatusCode());
                return false;
            }

        } catch (Exception e) {
            log.error("Exception while calling Meta API: {}", e.getMessage(), e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Meta API call failed")
                    .withTag("notification.type", "WHATSAPP_OTP")
                    .send();
            return false;
        }
    }

    /**
     * Create masked payload for logging (hides OTP)
     */
    private String getMaskedPayloadForLogging(MetaWhatsAppPayload payload, String otp) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            return (otp == null || otp.isEmpty()) ? json : json.replace(otp, "******");
        } catch (Exception e) {
            return "Unable to serialize payload";
        }
    }
}
