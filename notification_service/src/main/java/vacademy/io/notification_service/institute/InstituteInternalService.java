package vacademy.io.notification_service.institute;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;

@Slf4j
@Service
public class InstituteInternalService {

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${admin.core.service.baseurl}")
    private String adminCoreServerBaseUrl;

    /**
     * Raw institute JSON for the send path, kept for 10 seconds per pod.
     * Every email used to call admin-core twice (sender config + theme or policy), so a
     * slow admin-core made every email slow. A bulk batch sends many mails per second for
     * one institute, so even 10 seconds removes almost all of those calls, while a change
     * to sender, SMTP login, daily cap or send hour still applies within 10 seconds.
     * Only successful bodies are kept, never a failure, and the raw JSON is cached (not
     * the DTO) so a caller that changes its copy cannot change what the next caller reads.
     */
    private final Cache<String, String> sendPathBodies = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(10))
            .maximumSize(1_000)
            .build();

    /**
     * Same as {@link #getInstituteByInstituteId} but may answer from a 10 second cache.
     * Use it only to read settings for sending (sender, theme, name). Code that reads
     * settings in order to change and save them must call the uncached method, or it
     * could save an old copy over a newer change.
     */
    public InstituteInfoDTO getInstituteByInstituteIdCached(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            return getInstituteByInstituteId(instituteId);
        }
        String cached = sendPathBodies.getIfPresent(instituteId);
        if (cached != null) {
            try {
                return new ObjectMapper().readValue(cached, InstituteInfoDTO.class);
            } catch (Exception e) {
                sendPathBodies.invalidate(instituteId);
            }
        }
        return getInstituteByInstituteId(instituteId);
    }

    public void evictCachedInstitute(String instituteId) {
        if (instituteId != null) {
            sendPathBodies.invalidate(instituteId);
        }
    }

    public InstituteInfoDTO getInstituteByInstituteId(String instituteId) {
        try {
            log.info("Fetching institute details for instituteId: {} from admin-core-service", instituteId);
            log.debug("Using clientName: {}, baseUrl: {}", clientName, adminCoreServerBaseUrl);

            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    adminCoreServerBaseUrl,
                    "/admin-core-service/internal/institute/v1/" + instituteId,
                    null);

            log.info("Response status: {}, for instituteId: {}", response.getStatusCode(), instituteId);

            if (response.getBody() == null || response.getBody().isBlank()) {
                log.warn("Empty response body received for instituteId: {}", instituteId);
                return null;
            }

            try {
                ObjectMapper mapper = new ObjectMapper();
                InstituteInfoDTO result = mapper.readValue(response.getBody(), InstituteInfoDTO.class);
                log.info("Successfully parsed institute data for instituteId: {}", instituteId);
                if (instituteId != null && response.getStatusCode().is2xxSuccessful()) {
                    sendPathBodies.put(instituteId, response.getBody());
                }
                return result;
            } catch (Exception e) {
                log.error("Failed to parse institute data for instituteId: {}. Response body: {}",
                        instituteId, response.getBody(), e);
                throw new VacademyException("Failed to parse institute data: " + e.getMessage());
            }
        } catch (org.springframework.web.client.HttpServerErrorException e) {
            log.error("HTTP Server Error from admin-core-service for instituteId: {}. Status: {}, Response: {}",
                    instituteId, e.getStatusCode(), e.getResponseBodyAsString(), e);
            // Return null to allow the email service to fall back to default settings
            return null;
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            log.error("HTTP Client Error from admin-core-service for instituteId: {}. Status: {}, Response: {}",
                    instituteId, e.getStatusCode(), e.getResponseBodyAsString(), e);
            // Return null to allow the email service to fall back to default settings
            return null;
        } catch (org.springframework.web.client.ResourceAccessException e) {
            log.error("Failed to connect to admin-core-service for instituteId: {}. Error: {}",
                    instituteId, e.getMessage(), e);
            // Return null to allow the email service to fall back to default settings
            return null;
        } catch (Exception e) {
            log.error("Unexpected error fetching institute for instituteId: {}", instituteId, e);
            // Return null to allow the email service to fall back to default settings
            return null;
        }
    }

    public boolean updateInstituteSettings(String instituteId, String updatedSettings) {
        return updateInstituteSettings(instituteId, updatedSettings, null);
    }

    public boolean updateInstituteSettings(String instituteId, String updatedSettings, String authToken) {
        try {
            log.info("=== INSTITUTE SETTINGS UPDATE DEBUG ===");
            log.info("Institute ID: {}", instituteId);
            log.info("Admin Core URL: {}", adminCoreServerBaseUrl);
            log.info("Client Name: {}", clientName);
            log.info("Updated Settings: {}", updatedSettings);
            log.info("Auth Token provided: {}", authToken != null ? "Yes" : "No");

            // Try to call the /save-setting endpoint with proper format
            try {
                log.info("Attempting to update institute settings via admin-core-service /save-setting endpoint...");

                String requestBody;
                try {
                    // Parse the updated settings to extract EMAIL_SETTING data
                    com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();
                    com.fasterxml.jackson.databind.JsonNode settingsNode = objectMapper.readTree(updatedSettings);

                    // Get the EMAIL_SETTING data
                    com.fasterxml.jackson.databind.JsonNode emailSetting = settingsNode.path("setting")
                            .path("EMAIL_SETTING");
                    com.fasterxml.jackson.databind.JsonNode emailSettingData = emailSetting.path("data");

                    log.info("Settings structure: {}", settingsNode);
                    log.info("Email setting: {}", emailSetting);
                    log.info("Email setting data: {}", emailSettingData);

                    if (emailSettingData.isMissingNode() || emailSettingData.isNull()) {
                        log.error("EMAIL_SETTING data not found in settings. Available keys: {}",
                                settingsNode.path("setting").fieldNames());
                        throw new RuntimeException("EMAIL_SETTING data not found in settings");
                    }

                    // Create the proper request body for GenericSettingRequest (using snake_case
                    // naming)
                    com.fasterxml.jackson.databind.node.ObjectNode requestNode = objectMapper.createObjectNode();
                    requestNode.put("setting_name", "Email Setting");
                    requestNode.set("setting_data", emailSettingData);
                    requestBody = objectMapper.writeValueAsString(requestNode);

                    log.info("Request body: {}", requestBody);
                } catch (Exception jsonError) {
                    log.error("JSON parsing error: {}", jsonError.getMessage(), jsonError);
                    throw new RuntimeException("Failed to parse settings JSON: " + jsonError.getMessage(), jsonError);
                }

                ResponseEntity<String> response;
                if (authToken != null && !authToken.trim().isEmpty()) {
                    // Use authenticated request with Bearer token
                    log.info("Using authenticated request with Bearer token");
                    response = makeAuthenticatedRequest(
                            adminCoreServerBaseUrl,
                            "/admin-core-service/institute/setting/v1/save-setting?instituteId=" + instituteId
                                    + "&settingKey=EMAIL_SETTING",
                            requestBody,
                            authToken,
                            instituteId);
                } else {
                    // Fallback to HMAC request
                    log.info("Using HMAC request (no auth token provided)");
                    response = internalClientUtils.makeHmacRequest(
                            clientName,
                            HttpMethod.POST.name(),
                            adminCoreServerBaseUrl,
                            "/admin-core-service/institute/setting/v1/save-setting?instituteId=" + instituteId
                                    + "&settingKey=EMAIL_SETTING",
                            requestBody);
                }

                log.info("Response status: {}, Response body: {}", response.getStatusCode(), response.getBody());
                log.info("Response headers: {}", response.getHeaders());

                if (response.getStatusCode().is2xxSuccessful()) {
                    evictCachedInstitute(instituteId);
                    log.info("Successfully updated institute settings via admin-core-service for: {}", instituteId);
                    log.info("Database should now contain the updated EMAIL_SETTING data");
                    return true;
                } else {
                    log.error("Failed to update via admin-core-service. Status: {}, Response: {}",
                            response.getStatusCode(), response.getBody());
                    log.error("Database was NOT updated");
                    return false;
                }
            } catch (Exception e) {
                log.error("Failed to call admin-core-service save-setting endpoint: {}", e.getMessage(), e);
                // Fallback: Log the settings for manual database update
                log.error("=== MANUAL DATABASE UPDATE REQUIRED ===");
                log.error("Institute ID: {}", instituteId);
                log.error("Updated Settings JSON:");
                log.error("{}", updatedSettings);
                log.error("=== END MANUAL UPDATE ===");
                log.error("Please run this SQL query to update the database:");
                log.error("UPDATE institute SET setting = '{}' WHERE id = '{}';", updatedSettings, instituteId);
                return false;
            }
        } catch (Exception e) {
            log.error("Failed to update institute settings via admin-core-service: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Make authenticated request to admin-core-service
     */
    private ResponseEntity<String> makeAuthenticatedRequest(String baseUrl, String endpoint, String requestBody,
            String authToken, String instituteId) {
        try {
            // Create HTTP headers with Bearer token
            org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.set("Content-Type", "application/json");
            headers.set("Authorization", "Bearer " + authToken);
            // admin-core resolves the caller's roles for the clientId institute only, and its
            // save-setting checks the caller is staff of instituteId with clientId == instituteId.
            // Without this header the forwarded token resolves to no role and the save is refused.
            headers.set("clientId", instituteId);

            // Create HTTP entity with headers and body
            org.springframework.http.HttpEntity<String> entity = new org.springframework.http.HttpEntity<>(requestBody,
                    headers);

            // Make the request using RestTemplate
            org.springframework.web.client.RestTemplate restTemplate = new org.springframework.web.client.RestTemplate();
            String fullUrl = baseUrl + endpoint;

            log.info("Making authenticated request to: {}", fullUrl);
            return restTemplate.exchange(fullUrl, org.springframework.http.HttpMethod.POST, entity, String.class);

        } catch (Exception e) {
            log.error("Error making authenticated request: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to make authenticated request: " + e.getMessage(), e);
        }
    }
}
