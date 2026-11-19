package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.external.VendorCallLog;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.notification_service.dto.WhatsAppOTPRequest;
import vacademy.io.notification_service.dto.WhatsAppOTPResponse;

import java.util.List;

/**
 * WATI WhatsApp API provider implementation.
 * Expects normalized credentials from Factory: { apiKey, apiUrl, whatsappNumber
 * }
 */
@Slf4j
public class WatiWhatsAppServiceProvider implements WhatsAppServiceProvider {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    public WatiWhatsAppServiceProvider(ObjectMapper objectMapper, RestTemplate restTemplate) {
        this.objectMapper = objectMapper;
        this.restTemplate = restTemplate;
    }

    @Override
    public WhatsAppOTPResponse sendOtp(WhatsAppOTPRequest request, String otp, JsonNode credentials) {
        try {
            // Extract credentials - Factory provides normalized flat structure
            String apiKey = credentials.path("apiKey").asText(null);
            String apiUrl = credentials.path("apiUrl").asText("https://live-server.wati.io");
            String whatsappNumber = credentials.path("whatsappNumber").asText(null);

            if (apiKey == null || apiKey.isEmpty() || apiUrl == null || apiUrl.isEmpty()) {
                log.error("WATI credentials incomplete. apiKey present: {}, apiUrl present: {}",
                        apiKey != null && !apiKey.isEmpty(),
                        apiUrl != null && !apiUrl.isEmpty());
                return WhatsAppOTPResponse.builder()
                        .success(false)
                        .message("WhatsApp (WATI) credentials not configured correctly.")
                        .build();
            }

            // Ensure apiUrl ends with correct endpoint
            if (!apiUrl.endsWith("/api/v1/sendTemplateMessage")) {
                apiUrl = apiUrl.endsWith("/")
                        ? apiUrl + "api/v1/sendTemplateMessage"
                        : apiUrl + "/api/v1/sendTemplateMessage";
            }

            // Build WATI Payload
            WatiPayload payload = WatiPayload.builder()
                    .template_name(request.getTemplateName())
                    .broadcast_name(request.getTemplateName())
                    .parameters(List.of(
                            WatiParameter.builder()
                                    .name("otp")
                                    .value(otp)
                                    .build()))
                    .build();

            // Call WATI API
            boolean success = callWatiAPI(apiUrl, apiKey, request.getPhoneNumber(), payload, otp);

            if (success) {
                log.info("WhatsApp OTP sent successfully via WATI");
                // SECURITY: Do not return OTP in response
                return WhatsAppOTPResponse.builder()
                        .success(true)
                        .message("WhatsApp OTP sent successfully via WATI")
                        .build();
            } else {
                log.error("Failed to send WhatsApp OTP via WATI");
                return WhatsAppOTPResponse.builder()
                        .success(false)
                        .message("Failed to send WhatsApp OTP via WATI")
                        .build();
            }

        } catch (Exception e) {
            log.error("Exception in WatiWhatsAppServiceProvider: {}", e.getMessage(), e);
            return WhatsAppOTPResponse.builder()
                    .success(false)
                    .message("Exception sending WATI OTP: " + e.getMessage())
                    .build();
        }
    }

    private boolean callWatiAPI(String url, String apiKey, String receiverNumber, WatiPayload payload, String otp) {
        try {
            // Append recipient as query parameter
            String finalUrl = url + "?whatsappNumber=" + receiverNumber;

            log.info("Calling WATI API: {}", finalUrl);

            // SECURITY: Mask OTP in logs
            String maskedPayload = getMaskedPayloadForLogging(payload, otp);
            log.info("WATI API Payload (masked): {}", maskedPayload);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            // Set Authorization header - add Bearer prefix if not present
            String finalAuthHeader = apiKey.toLowerCase().startsWith("bearer ")
                    ? apiKey
                    : "Bearer " + apiKey;
            headers.set("Authorization", finalAuthHeader);

            HttpEntity<WatiPayload> request = new HttpEntity<>(payload, headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    finalUrl,
                    HttpMethod.POST,
                    request,
                    String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("WATI API call successful");
                return true;
            } else {
                log.error("WATI API call failed. Status: {}", response.getStatusCode());
                return false;
            }

        } catch (Exception e) {
            VendorCallLog.failed(url, "send otp template message", null, e);
            log.error("Exception while calling WATI API: {}", e.getMessage(), e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("WATI API call failed")
                    .withTag("notification.type", "WHATSAPP_OTP_WATI")
                    .send();
            return false;
        }
    }

    /**
     * Create masked payload for logging (hides OTP)
     */
    private String getMaskedPayloadForLogging(WatiPayload payload, String otp) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            return json.replace(otp, "******");
        } catch (Exception e) {
            return "Unable to serialize payload";
        }
    }

    @Data
    @Builder
    private static class WatiPayload {
        private String template_name;
        private String broadcast_name;
        private List<WatiParameter> parameters;
    }

    @Data
    @Builder
    private static class WatiParameter {
        private String name;
        private String value;
    }
}
