package vacademy.io.admin_core_service.features.notification.service;

import vacademy.io.common.external.ExternalCallLog;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.notification.dto.WatiConfig;
import vacademy.io.admin_core_service.features.notification.dto.WatiContactAttributeRequest;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class WatiContactAttributeService {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = ExternalCallLog.attach(new RestTemplate());

    /**
     * Extract WATI configuration from institute settings
     */
    public WatiConfig extractWatiConfig(Institute institute) {
        try {
            String settingJson = institute.getSetting();
            if (settingJson == null || settingJson.trim().isEmpty()) {
                log.debug("No settings found for institute: {}", institute.getId());
                return null;
            }

            JsonNode rootNode = objectMapper.readTree(settingJson);
            JsonNode whatsappSettingNode = rootNode.path("setting").path("WHATSAPP_SETTING");
            
            if (whatsappSettingNode.isMissingNode()) {
                log.debug("No WHATSAPP_SETTING found for institute: {}", institute.getId());
                return null;
            }

            JsonNode dataNode = whatsappSettingNode.path("data");
            if (dataNode.isMissingNode()) {
                log.debug("No data node found in WHATSAPP_SETTING for institute: {}", institute.getId());
                return null;
            }

            // Check both UTILITY_WHATSAPP and MARKETING_WHATSAPP
            JsonNode utilityWhatsappNode = dataNode.path("UTILITY_WHATSAPP");
            JsonNode watiConfigNode = null;
            
            if (!utilityWhatsappNode.isMissingNode()) {
                String provider = utilityWhatsappNode.path("provider").asText("");
                if ("WATI".equalsIgnoreCase(provider)) {
                    watiConfigNode = utilityWhatsappNode.path("wati");
                }
            }

            // If not found in UTILITY_WHATSAPP, check MARKETING_WHATSAPP
            if (watiConfigNode == null || watiConfigNode.isMissingNode()) {
                JsonNode marketingWhatsappNode = dataNode.path("MARKETING_WHATSAPP");
                if (!marketingWhatsappNode.isMissingNode()) {
                    String provider = marketingWhatsappNode.path("provider").asText("");
                    if ("WATI".equalsIgnoreCase(provider)) {
                        watiConfigNode = marketingWhatsappNode.path("wati");
                    }
                }
            }

            if (watiConfigNode == null || watiConfigNode.isMissingNode()) {
                log.debug("No WATI configuration found for institute: {}", institute.getId());
                return null;
            }

            String apiKey = watiConfigNode.path("apiKey").asText(null);
            String apiUrl = watiConfigNode.path("apiUrl").asText(null);
            String whatsappNumber = watiConfigNode.path("whatsappNumber").asText(null);
            Boolean enableContactAttributeUpdate = watiConfigNode.path("enableContactAttributeUpdate").asBoolean(false);
            JsonNode attrNode = watiConfigNode.path("contactAttributeMappings");

            List<WatiConfig.AttributeMapping> contactAttributeMappings =
                    objectMapper.convertValue(attrNode, new TypeReference<List<WatiConfig.AttributeMapping>>() {});

            if (apiKey == null || apiUrl == null || whatsappNumber == null) {
                log.warn("Incomplete WATI configuration for institute: {}", institute.getId());
                return null;
            }

            return WatiConfig.builder()
                    .apiKey(apiKey)
                    .apiUrl(apiUrl)
                    .whatsappNumber(whatsappNumber)
                    .enableContactAttributeUpdate(enableContactAttributeUpdate)
                    .contactAttributeMappings(contactAttributeMappings)
                    .build();

        } catch (Exception e) {
            log.error("Error extracting WATI config for institute: {}", institute.getId(), e);
            return null;
        }
    }

    /**
     * Update contact attributes in WATI using template variables
     */
    public void updateContactAttributes(WatiConfig watiConfig, String userMobileNumber, 
                                       java.util.Map<String, Object> templateVariables) {
        if (watiConfig == null) {
            log.debug("WATI config is null, skipping contact attribute update");
            return;
        }

        if (!Boolean.TRUE.equals(watiConfig.getEnableContactAttributeUpdate())) {
            log.debug("Contact attribute update is not enabled in WATI config");
            return;
        }

        if (watiConfig.getContactAttributeMappings() == null || watiConfig.getContactAttributeMappings().isEmpty()) {
            log.debug("No contact attribute mappings configured, skipping update");
            return;
        }

        try {
            // Normalize mobile number - remove + and any spaces
            String normalizedMobile = normalizeMobileNumber(userMobileNumber);
            
            if (normalizedMobile == null || normalizedMobile.isEmpty()) {
                log.warn("Invalid mobile number for WATI contact attribute update: {}", userMobileNumber);
                return;
            }

            // Build custom params from configured mappings
            List<WatiContactAttributeRequest.CustomParam> customParams = new java.util.ArrayList<>();
            
            for (WatiConfig.AttributeMapping mapping : watiConfig.getContactAttributeMappings()) {
                String valueKey = mapping.getValueKey();
                Object value = templateVariables.get(valueKey);
                
                if (value != null) {
                    customParams.add(WatiContactAttributeRequest.CustomParam.builder()
                            .name(mapping.getName())
                            .value(value.toString())
                            .build());
                } else {
                    log.debug("No value found for mapping key: {}, skipping this attribute", valueKey);
                }
            }

            if (customParams.isEmpty()) {
                log.warn("No valid custom params to update for mobile: {}", normalizedMobile);
                return;
            }

            // Build the URL
            String url = String.format("%s/api/v1/updateContactAttributes/%s", 
                    watiConfig.getApiUrl(), normalizedMobile);

            // Build the request body
            WatiContactAttributeRequest request = WatiContactAttributeRequest.builder()
                    .customParams(customParams)
                    .build();

            // Build headers
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("accept", "*/*");
            
            // Handle authorization header - check if apiKey already has "Bearer " prefix
            String authHeader = watiConfig.getApiKey();
            if (!authHeader.startsWith("Bearer ")) {
                authHeader = "Bearer " + authHeader;
            }
            headers.set("Authorization", authHeader);

            HttpEntity<WatiContactAttributeRequest> entity = new HttpEntity<>(request, headers);

            // Make the API call
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    entity,
                    String.class
            );

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Successfully updated WATI contact attributes for mobile: {} with {} attributes", 
                        normalizedMobile, customParams.size());
            } else {
                log.warn("WATI contact attribute update returned status: {} for mobile: {}", 
                        response.getStatusCode(), normalizedMobile);
            }

        } catch (Exception e) {
            log.error("Error updating WATI contact attributes for mobile: {}", userMobileNumber, e);
            // Don't throw exception - this is a non-critical operation
        }
    }

    /**
     * Normalize mobile number - remove + and spaces
     */
    private String normalizeMobileNumber(String mobileNumber) {
        if (mobileNumber == null || mobileNumber.trim().isEmpty()) {
            return null;
        }
        
        return mobileNumber.trim()
                .replace("+", "")
                .replace(" ", "")
                .replace("-", "");
    }
}
