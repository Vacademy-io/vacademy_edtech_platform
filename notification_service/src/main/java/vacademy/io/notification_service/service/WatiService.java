package vacademy.io.notification_service.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.notification_service.features.external_communication_log.model.ExternalCommunicationSource;
import vacademy.io.notification_service.features.external_communication_log.service.ExternalCommunicationLogService;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.notification_service.util.LogMask;

import java.util.*;
import java.util.stream.Collectors;

/**
 * WATI (WhatsApp Team Inbox) Integration Service
 *
 * Handles WhatsApp message sending via WATI API
 * API Documentation: https://docs.wati.io
 */
@Service
@Slf4j
public class WatiService {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final ExternalCommunicationLogService externalCommunicationLogService;

    public WatiService(
            vacademy.io.notification_service.features.external_communication_log.service.ExternalCommunicationLogService externalCommunicationLogService) {
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
        this.objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        this.externalCommunicationLogService = externalCommunicationLogService;
    }

    /**
     * Send template messages via WATI API
     *
     * @param templateName  WATI template name
     * @param userDetails   List of phone numbers with their parameter values
     * @param languageCode  Language code (e.g., "en", "hi")
     * @param apiKey        WATI API key
     * @param apiUrl        WATI API base URL
     * @param broadcastName Name for this broadcast campaign
     * @return List of send results (phone -> success/failure)
     */
    public List<Map<String, Boolean>> sendTemplateMessages(
            String templateName,
            List<Map<String, Map<String, String>>> userDetails,
            String languageCode,
            String apiKey,
            String apiUrl,
            String broadcastName) {

        log.info("Sending WATI template messages (bulk): template={}, recipients={}, apiUrl={}",
                templateName, userDetails.size(), apiUrl);

        // Upsert all contacts before sending — ensures required attributes are set
        // (WATI rejects sends with "Missing customer attributes" if contact is incomplete)
        upsertContacts(userDetails, apiKey, apiUrl);

        // Deduplicate based on phone number
        Map<String, Map<String, String>> uniqueUsers = userDetails.stream()
                .collect(Collectors.toMap(
                        detail -> detail.keySet().iterator().next(),
                        detail -> detail.get(detail.keySet().iterator().next()),
                        (existing, replacement) -> existing));

        // Build bulk request
        WatiTemplateRequest request = new WatiTemplateRequest();
        request.setTemplateName(templateName);
        request.setBroadcastName(broadcastName != null ? broadcastName : "Notification");

        List<WatiReceiver> receivers = new ArrayList<>();
        for (Map.Entry<String, Map<String, String>> entry : uniqueUsers.entrySet()) {
            String phoneNumber = entry.getKey();
            Map<String, String> params = entry.getValue();

            String formattedPhone = phoneNumber.replaceAll("[^0-9]", "");
            WatiReceiver receiver = new WatiReceiver();
            receiver.setWhatsappNumber(formattedPhone);

            List<WatiCustomParam> customParams = new ArrayList<>();

            // Convert special _prefixed variables to WATI media params
            String headerUrl = params.get("_headerUrl");
            String headerType = params.get("_headerType");
            if (headerUrl != null) {
                String watiParamName = switch (headerType != null ? headerType : "image") {
                    case "video" -> "header_video_url";
                    case "document" -> "header_document_url";
                    default -> "header_image_url";
                };
                WatiCustomParam mediaParam = new WatiCustomParam();
                mediaParam.setName(watiParamName);
                mediaParam.setValue(headerUrl);
                customParams.add(mediaParam);
            }

            String buttonUrl = params.get("_buttonUrl");
            if (buttonUrl != null) {
                // Strip leading slash — template URL is "https://js.vacademy.io/{{1}}"
                // so suffix must NOT start with "/" or Meta gets a double-slash URL
                String buttonUrlSuffix = buttonUrl.startsWith("/") ? buttonUrl.substring(1) : buttonUrl;
                WatiCustomParam btnParam = new WatiCustomParam();
                btnParam.setName("button_url_suffix");
                btnParam.setValue(buttonUrlSuffix);
                customParams.add(btnParam);
            }

            // Add body params: filter out _ prefixed keys, sort numerically
            List<WatiCustomParam> bodyCustomParams = params.entrySet().stream()
                    .filter(e -> !e.getKey().startsWith("_"))
                    .sorted((e1, e2) -> {
                        try {
                            int k1 = Integer.parseInt(e1.getKey());
                            try {
                                int k2 = Integer.parseInt(e2.getKey());
                                return Integer.compare(k1, k2);
                            } catch (NumberFormatException ex2) {
                                return 1;
                            }
                        } catch (NumberFormatException ex1) {
                            try {
                                Integer.parseInt(e2.getKey());
                                return -1;
                            } catch (NumberFormatException ex2) {
                                return e1.getKey().compareTo(e2.getKey());
                            }
                        }
                    })
                    .map(e -> {
                        WatiCustomParam param = new WatiCustomParam();
                        param.setName(e.getKey());
                        param.setValue(e.getValue());
                        return param;
                    })
                    .collect(Collectors.toList());
            customParams.addAll(bodyCustomParams);

            receiver.setCustomParams(customParams);
            receivers.add(receiver);
        }
        request.setReceivers(receivers);

        // Create headers
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        try {
            String jsonRequest = objectMapper.writeValueAsString(request);
            // A count only: the body holds each recipient's number, name and message values.
            log.info("WATI Bulk Request: template={}, receivers={}", templateName, receivers.size());
            String logId = externalCommunicationLogService.start(ExternalCommunicationSource.WHATSAPP, null, request);
            HttpEntity<String> entity = new HttpEntity<>(jsonRequest, headers);

            String endpoint = apiUrl + "/api/v1/sendTemplateMessages";
            ResponseEntity<String> response = restTemplate.exchange(endpoint, HttpMethod.POST, entity, String.class);
            boolean httpSuccess = response.getStatusCode().is2xxSuccessful();
            log.info("WATI Bulk Response: status={}, body={}", response.getStatusCode(), response.getBody());
            externalCommunicationLogService.markSuccess(logId, response.getBody());

            // Check WATI response body for actual delivery status
            boolean deliverySuccess = httpSuccess;
            if (httpSuccess && response.getBody() != null) {
                try {
                    JsonNode respJson = objectMapper.readTree(response.getBody());
                    boolean result = respJson.path("result").asBoolean(true);
                    if (!result) {
                        String info = respJson.path("info").asText("unknown error");
                        log.error("WATI API returned success=false: {}", info);
                        // Layer 5: WATI accepted the HTTP call but rejected the send internally
                        SentryLogger.logWarning("WATI API returned result=false",
                                Map.of(
                                        "template.name", templateName,
                                        "wati.info", info,
                                        "recipient.count", String.valueOf(uniqueUsers.size()),
                                        "api.url", apiUrl,
                                        "layer", "5-wati-api"
                                ));
                        deliverySuccess = false;
                    }
                } catch (Exception ignored) {}
            }

            final boolean finalSuccess = deliverySuccess;
            return uniqueUsers.keySet().stream()
                    .map(phone -> Map.of(phone, finalSuccess))
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Failed to send WATI bulk message: {}", e.getMessage(), e);
            // Layer 5: HTTP call to WATI failed entirely — network error, timeout, or auth failure
            SentryLogger.logError(e, "WATI bulk send HTTP call failed",
                    Map.of(
                            "template.name", templateName,
                            "recipient.count", String.valueOf(uniqueUsers.size()),
                            "api.url", apiUrl,
                            "layer", "5-wati-api"
                    ));
            // Best effort: if logging hadn't started, create one just to mark failure
            try {
                String fallbackId = externalCommunicationLogService.start(ExternalCommunicationSource.WHATSAPP, null,
                        "WATI request failed");
                externalCommunicationLogService.markFailure(fallbackId, e.getMessage(), null);
            } catch (Exception ignored) {
            }
            return uniqueUsers.keySet().stream()
                    .map(phone -> Map.of(phone, false))
                    .collect(Collectors.toList());
        }
    }

    /**
     * Upsert all contacts before sending template messages.
     * Sets allowbroadcast=true, allowcampaign=true, allowsms=true so WATI
     * doesn't reject with "Missing customer attributes".
     * Failures are logged and swallowed — send proceeds regardless.
     */
    private void upsertContacts(List<Map<String, Map<String, String>>> userDetails,
                                 String apiKey, String apiUrl) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        List<Map<String, String>> requiredAttributes = List.of(
                Map.of("name", "allowbroadcast", "value", "true"),
                Map.of("name", "allowcampaign", "value", "true"),
                Map.of("name", "allowsms", "value", "true"),
                Map.of("name", "Channel", "value", "WhatsApp"),
                Map.of("name", "Source", "value", "Vacademy"),
                Map.of("name", "attribute_1", "value", "-")
                // DO NOT set contact_owner — it is a WATI system attribute requiring a valid agent email.
                // DO NOT set lead_stage — WATI system attribute with predefined values.
                // Setting these to arbitrary values (e.g. "-") breaks template sends.
        );

        int addContactFailures = 0;
        for (Map<String, Map<String, String>> userDetail : userDetails) {
            String phone = userDetail.keySet().iterator().next();
            String formattedPhone = phone.replaceAll("[^0-9]", "");

            // Step 1: Try updateContactAttributes (for existing contacts)
            boolean updated = updateContactAttributes(formattedPhone, requiredAttributes, headers, apiUrl);

            // Step 2: If contact didn't exist (update failed), create it via addContact
            if (!updated) {
                if (!addContact(formattedPhone, requiredAttributes, headers, apiUrl)) {
                    addContactFailures++;
                }
            }
        }

        // One aggregated Sentry event per batch if any contact upsert failed, instead
        // of one per recipient. If contacts can't be created, WATI rejects the
        // template send with "Missing customer attributes", so this is worth knowing.
        if (addContactFailures > 0) {
            SentryLogger.logWarning("WATI contact upsert failed for some recipients — template sends may be rejected",
                    Map.of("failed.count", String.valueOf(addContactFailures),
                            "total.count", String.valueOf(userDetails.size()),
                            "api.url", apiUrl,
                            "layer", "5-wati-api"));
        }
    }

    private boolean updateContactAttributes(String phone, List<Map<String, String>> customParams,
                                             HttpHeaders headers, String apiUrl) {
        // POST /{tenantId}/api/v1/updateContactAttributes/{whatsappNumber}
        String endpoint = apiUrl + "/api/v1/updateContactAttributes/" + phone;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("customParams", customParams);
        try {
            String json = objectMapper.writeValueAsString(body);
            HttpEntity<String> entity = new HttpEntity<>(json, headers);
            ResponseEntity<String> response = restTemplate.exchange(endpoint, HttpMethod.POST, entity, String.class);
            log.info("WATI updateContactAttributes {}: status={}, body={}", LogMask.phone(phone), response.getStatusCode(),
                    response.getBody());

            // WATI returns HTTP 200 even on failure — check "result" field in body
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                JsonNode respJson = objectMapper.readTree(response.getBody());
                return respJson.path("result").asBoolean(false);
            }
            return false;
        } catch (Exception e) {
            log.info("WATI updateContactAttributes failed for {} (contact may not exist yet): {}", LogMask.phone(phone),
                    e.getMessage());
            return false;
        }
    }

    private boolean addContact(String phone, List<Map<String, String>> customParams,
                             HttpHeaders headers, String apiUrl) {
        // POST /{tenantId}/api/v1/addContact/{whatsappNumber}
        // Body requires "name" field (use phone as fallback name)
        String endpoint = apiUrl + "/api/v1/addContact/" + phone;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", phone);
        body.put("customParams", customParams);
        try {
            String json = objectMapper.writeValueAsString(body);
            HttpEntity<String> entity = new HttpEntity<>(json, headers);
            ResponseEntity<String> response = restTemplate.exchange(endpoint, HttpMethod.POST, entity, String.class);
            log.info("WATI addContact {}: status={}, body={}", LogMask.phone(phone), response.getStatusCode(),
                    response.getBody());
            return true;
        } catch (Exception e) {
            // Per-recipient failure: counted and reported ONCE by upsertContacts.
            // A per-recipient Sentry event fanned a single WATI outage into up to
            // one event per recipient (thousands per failing batch).
            log.warn("WATI addContact failed for {}: {}", LogMask.phone(phone), e.getMessage());
            return false;
        }
    }

    @Data
    public static class WatiTemplateRequest {
        @JsonProperty("template_name")
        private String templateName;
        @JsonProperty("broadcast_name")
        private String broadcastName;
        private List<WatiReceiver> receivers;
    }

    @Data
    public static class WatiReceiver {
        private String whatsappNumber;
        private List<WatiCustomParam> customParams;
    }

    @Data
    public static class WatiCustomParam {
        private String name;
        private String value;
    }

    @Data
    public static class WatiMessageResponse {
        private Boolean result;
        private String info;
        private String messageId;
    }
}
