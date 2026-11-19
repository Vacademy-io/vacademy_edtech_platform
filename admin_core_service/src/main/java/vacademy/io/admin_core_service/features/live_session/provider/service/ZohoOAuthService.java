package vacademy.io.admin_core_service.features.live_session.provider.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.live_session.provider.entity.LiveSessionProviderConfig;
import vacademy.io.admin_core_service.features.live_session.provider.repository.LiveSessionProviderConfigRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.meeting.enums.MeetingProvider;
import vacademy.io.common.external.VendorCallLog;

import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Manages Zoho OAuth2 tokens stored inside the generic configJson column.
 *
 * configJson structure for ZOHO_MEETING:
 * {
 * "clientId": "...",
 * "clientSecret": "...",
 * "accessToken": "...",
 * "refreshToken": "...",
 * "tokenExpiresAt": 1234567890, <- Unix epoch seconds
 * "zohoUserId": "12345678",
 * "domain": "zoho.com"
 * }
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZohoOAuthService {

    private final LiveSessionProviderConfigRepository configRepository;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    private static final long TOKEN_BUFFER_SECONDS = 300L;
    private static final List<String> ACTIVE = List.of("ACTIVE");

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * One-time setup: exchange a Zoho Self-Client authorization code for tokens,
     * then auto-fetch and store the Zoho User ID.
     */
    public LiveSessionProviderConfig connectZoho(String instituteId,
            String clientId,
            String clientSecret,
            String authorizationCode,
            String domain,
            String suppliedZohoUserId) {
        String resolvedDomain = (domain == null || domain.isBlank()) ? "zoho.com" : domain;
        String tokenUrl = buildTokenUrl(resolvedDomain);

        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "authorization_code");
        params.add("code", authorizationCode);
        params.add("client_id", clientId);
        params.add("client_secret", clientSecret);

        JsonNode tokenResponse = webClientBuilder.build()
                .post().uri(tokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(params))
                .retrieve()
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(tokenUrl, "exchange authorization code", null, e))
                .block();

        if (tokenResponse == null || !tokenResponse.has("access_token")) {
            throw new VacademyException("Zoho token exchange failed: " +
                    (tokenResponse != null ? tokenResponse.toString() : "null response"));
        }

        String accessToken = tokenResponse.get("access_token").asText();
        String refreshToken = tokenResponse.has("refresh_token")
                ? tokenResponse.get("refresh_token").asText()
                : null;
        long expiresIn = tokenResponse.has("expires_in")
                ? tokenResponse.get("expires_in").asLong()
                : 3600L;

        // Use supplied Zoho User ID if provided — avoids needing AaaServer.profile.READ
        // scope
        String zohoUserId;
        if (suppliedZohoUserId != null && !suppliedZohoUserId.isBlank()) {
            zohoUserId = suppliedZohoUserId.trim();
            log.info("Using caller-supplied Zoho User ID: {}", zohoUserId);
        } else {
            zohoUserId = fetchZohoUserId(accessToken, resolvedDomain);
        }

        // Build the configJson map
        Map<String, Object> configMap = new HashMap<>();
        configMap.put("clientId", clientId);
        configMap.put("clientSecret", clientSecret);
        configMap.put("accessToken", accessToken);
        configMap.put("refreshToken", refreshToken);
        configMap.put("tokenExpiresAt", Instant.now().getEpochSecond() + expiresIn);
        configMap.put("zohoUserId", zohoUserId);
        configMap.put("domain", resolvedDomain);

        // Upsert: per-organizer record if vendorUserId is set, else institute-wide.
        boolean hasVendorUser = suppliedZohoUserId != null && !suppliedZohoUserId.isBlank();
        LiveSessionProviderConfig config;
        if (hasVendorUser) {
            config = configRepository
                    .findByInstituteIdAndProviderAndVendorUserIdAndStatusIn(
                            instituteId, MeetingProvider.ZOHO_MEETING.name(), suppliedZohoUserId, ACTIVE)
                    .orElse(LiveSessionProviderConfig.builder()
                            .instituteId(instituteId)
                            .provider(MeetingProvider.ZOHO_MEETING.name())
                            .vendorUserId(suppliedZohoUserId)
                            .build());
        } else {
            config = configRepository
                    .findByInstituteIdAndProviderAndStatusIn(
                            instituteId, MeetingProvider.ZOHO_MEETING.name(), ACTIVE)
                    .orElse(LiveSessionProviderConfig.builder()
                            .instituteId(instituteId)
                            .provider(MeetingProvider.ZOHO_MEETING.name())
                            .build());
        }

        config.setConfigJson(toJson(configMap));
        config.setStatus("ACTIVE");
        config.setUpdatedAt(new Date());
        return configRepository.save(config);
    }

    /**
     * Returns a valid configMap for the institute-wide credential.
     * Backward-compatible — delegates to the overload with vendorUserId=null.
     */
    public Map<String, Object> getValidConfigMap(String instituteId) {
        return getValidConfigMap(instituteId, null);
    }

    /**
     * Returns a valid configMap, preferring the per-organizer credential when
     * vendorUserId is non-null. Falls back to the institute-wide credential
     * (vendorUserId IS NULL) when no personal config exists.
     */
    public Map<String, Object> getValidConfigMap(String instituteId, String vendorUserId) {
        LiveSessionProviderConfig config = resolveConfig(instituteId, vendorUserId);
        Map<String, Object> configMap = fromJson(config.getConfigJson());
        long nowEpoch = Instant.now().getEpochSecond();
        Object expiresAtObj = configMap.get("tokenExpiresAt");
        long expiresAt = expiresAtObj instanceof Number ? ((Number) expiresAtObj).longValue() : 0L;

        if ((expiresAt - nowEpoch) < TOKEN_BUFFER_SECONDS) {
            String refreshToken = (String) configMap.get("refreshToken");
            if (refreshToken == null || refreshToken.isBlank()) {
                throw new VacademyException(
                        "Zoho access token expired and no refresh token for institute: " + instituteId);
            }
            configMap = refreshAccessToken(config, configMap);
        }
        return configMap;
    }

    /**
     * Resolves the best available credential:
     * 1. Per-organizer record (vendorUserId match) if it exists.
     * 2. Institute-wide record (vendorUserId IS NULL) as fallback.
     */
    private LiveSessionProviderConfig resolveConfig(String instituteId, String vendorUserId) {
        String provider = MeetingProvider.ZOHO_MEETING.name();
        if (vendorUserId != null && !vendorUserId.isBlank()) {
            return configRepository
                    .findByInstituteIdAndProviderAndVendorUserIdAndStatusIn(instituteId, provider, vendorUserId, ACTIVE)
                    .or(() -> configRepository.findByInstituteIdAndProviderAndStatusIn(instituteId, provider, ACTIVE))
                    .orElseThrow(() -> new VacademyException(
                            "Zoho Meeting not connected for institute: " + instituteId));
        }
        return configRepository
                .findByInstituteIdAndProviderAndStatusIn(instituteId, provider, ACTIVE)
                .orElseThrow(() -> new VacademyException(
                        "Zoho Meeting not connected for institute: " + instituteId));
    }

    /** Check if Zoho Meeting is connected for an institute */
    public boolean isConnected(String instituteId) {
        return configRepository.existsByInstituteIdAndProviderAndStatusIn(
                instituteId, MeetingProvider.ZOHO_MEETING.name(), ACTIVE);
    }

    /** Static URL builders — used by ZohoMeetingManager too */
    public static String buildTokenUrl(String domain) {
        return "https://accounts." + domain + "/oauth/v2/token";
    }

    public static String buildApiBase(String domain) {
        return "https://meeting." + domain;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private Map<String, Object> refreshAccessToken(LiveSessionProviderConfig config,
            Map<String, Object> configMap) {
        String domain = (String) configMap.getOrDefault("domain", "zoho.com");
        String tokenUrl = buildTokenUrl(domain);

        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "refresh_token");
        params.add("refresh_token", (String) configMap.get("refreshToken"));
        params.add("client_id", (String) configMap.get("clientId"));
        params.add("client_secret", (String) configMap.get("clientSecret"));

        JsonNode response = webClientBuilder.build()
                .post().uri(tokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(params))
                .retrieve()
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(tokenUrl, "refresh access token", null, e))
                .block();

        if (response == null || !response.has("access_token")) {
            throw new VacademyException("Zoho token refresh failed for institute: " + config.getInstituteId());
        }

        long expiresIn = response.has("expires_in") ? response.get("expires_in").asLong() : 3600L;
        configMap.put("accessToken", response.get("access_token").asText());
        configMap.put("tokenExpiresAt", Instant.now().getEpochSecond() + expiresIn);

        config.setConfigJson(toJson(configMap));
        config.setUpdatedAt(new Date());
        configRepository.save(config);

        log.info("Zoho access token refreshed for institute {}", config.getInstituteId());
        return configMap;
    }

    private String fetchZohoUserId(String accessToken, String domain) {
        // Correct endpoint: Zoho Accounts OAuth user info — NOT the Meeting API
        String userInfoUrl = "https://accounts." + domain + "/oauth/user/info";
        try {
            JsonNode response = webClientBuilder.build()
                    .get()
                    .uri(userInfoUrl)
                    .header("Authorization", "Zoho-oauthtoken " + accessToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .doOnError(e -> VendorCallLog.failed(userInfoUrl, "fetch user info", null, e))
                    .block();

            if (response == null) {
                throw new VacademyException("Null response from Zoho user info endpoint");
            }

            // Zoho returns ZSOID as the numeric user ID used in Meeting API paths
            String zsid = response.path("ZSOID").asText(null);
            if (zsid == null || zsid.isBlank()) {
                zsid = response.path("ZUID").asText(null); // fallback 1
            }
            if (zsid == null || zsid.isBlank()) {
                zsid = response.path("id").asText(null); // fallback 2
            }
            if (zsid == null || zsid.isBlank()) {
                log.warn("Zoho user info response: {}", response);
                throw new VacademyException(
                        "Could not extract ZSOID from Zoho user info. Response: " + response);
            }
            log.info("Fetched Zoho user ZSOID={} for domain={}", zsid, domain);
            return zsid;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("Failed to fetch Zoho User ID: " + e.getMessage());
        }
    }

    // -----------------------------------------------------------------------
    // JSON helpers
    // -----------------------------------------------------------------------

    private String toJson(Map<String, Object> map) {
        try {
            return objectMapper.writeValueAsString(map);
        } catch (Exception e) {
            throw new VacademyException("Failed to serialize provider config to JSON");
        }
    }

    public Map<String, Object> fromJson(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {
            });
        } catch (Exception e) {
            throw new VacademyException("Failed to parse provider config JSON");
        }
    }

    // -----------------------------------------------------------------------
    // SDK OAuth (Server-based Application)
    // -----------------------------------------------------------------------

    /**
     * One-time setup: exchange a Zoho SDK Server-based Application authorization
     * code for SDK tokens. Merges SDK fields into the existing ZOHO_MEETING
     * configJson — does NOT remove regular meeting credentials.
     */
    public LiveSessionProviderConfig connectSdkZoho(String instituteId,
            String sdkClientId,
            String sdkClientSecret,
            String authorizationCode,
            String redirectUri,
            String domain,
            String presenterZuid) {
        String resolvedDomain = (domain == null || domain.isBlank()) ? "zoho.com" : domain;
        String tokenUrl = buildTokenUrl(resolvedDomain);

        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "authorization_code");
        params.add("code", authorizationCode);
        params.add("client_id", sdkClientId);
        params.add("client_secret", sdkClientSecret);
        params.add("redirect_uri", redirectUri);

        JsonNode tokenResponse = webClientBuilder.build()
                .post().uri(tokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(params))
                .retrieve()
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(tokenUrl, "exchange sdk authorization code", null, e))
                .block();

        if (tokenResponse == null || !tokenResponse.has("access_token")) {
            throw new VacademyException("Zoho SDK token exchange failed: " +
                    (tokenResponse != null ? tokenResponse.toString() : "null response"));
        }

        String sdkAccessToken = tokenResponse.get("access_token").asText();
        String sdkRefreshToken = tokenResponse.has("refresh_token")
                ? tokenResponse.get("refresh_token").asText()
                : null;
        long expiresIn = tokenResponse.has("expires_in")
                ? tokenResponse.get("expires_in").asLong()
                : 3600L;

        // Merge into existing config — find the ACTIVE institute-wide record
        LiveSessionProviderConfig config = configRepository
                .findByInstituteIdAndProviderAndStatusIn(instituteId, MeetingProvider.ZOHO_MEETING.name(), ACTIVE)
                .orElse(LiveSessionProviderConfig.builder()
                        .instituteId(instituteId)
                        .provider(MeetingProvider.ZOHO_MEETING.name())
                        .build());

        Map<String, Object> configMap = (config.getConfigJson() != null && !config.getConfigJson().isBlank())
                ? fromJson(config.getConfigJson())
                : new HashMap<>();

        // Add SDK-specific fields only — regular credentials are untouched
        configMap.put("sdkClientId", sdkClientId);
        configMap.put("sdkClientSecret", sdkClientSecret);
        configMap.put("sdkAccessToken", sdkAccessToken);
        configMap.put("sdkRefreshToken", sdkRefreshToken);
        configMap.put("sdkTokenExpiresAt", Instant.now().getEpochSecond() + expiresIn);
        if (presenterZuid != null && !presenterZuid.isBlank()) {
            configMap.put("presenterZuid", presenterZuid.trim());
        }

        config.setConfigJson(toJson(configMap));
        config.setStatus("ACTIVE");
        config.setUpdatedAt(new Date());
        log.info("Zoho SDK credentials stored for institute {}", instituteId);
        return configRepository.save(config);
    }

    /**
     * Returns a valid SDK access token, refreshing if near expiry.
     */
    public String getSdkValidToken(String instituteId) {
        LiveSessionProviderConfig config = configRepository
                .findByInstituteIdAndProviderAndStatusIn(instituteId, MeetingProvider.ZOHO_MEETING.name(), ACTIVE)
                .orElseThrow(
                        () -> new VacademyException("Zoho Meeting not connected for institute: " + instituteId));

        Map<String, Object> configMap = fromJson(config.getConfigJson());

        if (!configMap.containsKey("sdkClientId")) {
            throw new VacademyException("Zoho SDK credentials not configured for institute: " + instituteId);
        }

        long nowEpoch = Instant.now().getEpochSecond();
        Object sdkExpiresAtObj = configMap.get("sdkTokenExpiresAt");
        long sdkExpiresAt = sdkExpiresAtObj instanceof Number ? ((Number) sdkExpiresAtObj).longValue() : 0L;

        if ((sdkExpiresAt - nowEpoch) < TOKEN_BUFFER_SECONDS) {
            String sdkRefreshToken = (String) configMap.get("sdkRefreshToken");
            if (sdkRefreshToken == null || sdkRefreshToken.isBlank()) {
                throw new VacademyException(
                        "Zoho SDK access token expired and no refresh token for institute: " + instituteId);
            }
            configMap = refreshSdkAccessToken(config, configMap);
        }

        return (String) configMap.get("sdkAccessToken");
    }

    /**
     * Returns the SDK configMap (access token + presenterZuid + domain) after
     * refreshing if needed.
     */
    public Map<String, Object> getSdkValidConfigMap(String instituteId) {
        LiveSessionProviderConfig config = configRepository
                .findByInstituteIdAndProviderAndStatusIn(instituteId, MeetingProvider.ZOHO_MEETING.name(), ACTIVE)
                .orElseThrow(
                        () -> new VacademyException("Zoho Meeting not connected for institute: " + instituteId));

        Map<String, Object> configMap = fromJson(config.getConfigJson());

        if (!configMap.containsKey("sdkClientId")) {
            throw new VacademyException("Zoho SDK credentials not configured for institute: " + instituteId);
        }

        long nowEpoch = Instant.now().getEpochSecond();
        Object sdkExpiresAtObj = configMap.get("sdkTokenExpiresAt");
        long sdkExpiresAt = sdkExpiresAtObj instanceof Number ? ((Number) sdkExpiresAtObj).longValue() : 0L;

        if ((sdkExpiresAt - nowEpoch) < TOKEN_BUFFER_SECONDS) {
            String sdkRefreshToken = (String) configMap.get("sdkRefreshToken");
            if (sdkRefreshToken == null || sdkRefreshToken.isBlank()) {
                throw new VacademyException(
                        "Zoho SDK access token expired and no refresh token for institute: " + instituteId);
            }
            configMap = refreshSdkAccessToken(config, configMap);
        }

        return configMap;
    }

    private Map<String, Object> refreshSdkAccessToken(LiveSessionProviderConfig config,
            Map<String, Object> configMap) {
        String domain = (String) configMap.getOrDefault("domain", "zoho.com");
        String tokenUrl = buildTokenUrl(domain);

        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        params.add("grant_type", "refresh_token");
        params.add("refresh_token", (String) configMap.get("sdkRefreshToken"));
        params.add("client_id", (String) configMap.get("sdkClientId"));
        params.add("client_secret", (String) configMap.get("sdkClientSecret"));

        JsonNode response = webClientBuilder.build()
                .post().uri(tokenUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(params))
                .retrieve()
                .bodyToMono(JsonNode.class)
                .doOnError(e -> VendorCallLog.failed(tokenUrl, "refresh sdk access token", null, e))
                .block();

        if (response == null || !response.has("access_token")) {
            throw new VacademyException("Zoho SDK token refresh failed for institute: " + config.getInstituteId());
        }

        long expiresIn = response.has("expires_in") ? response.get("expires_in").asLong() : 3600L;
        configMap.put("sdkAccessToken", response.get("access_token").asText());
        configMap.put("sdkTokenExpiresAt", Instant.now().getEpochSecond() + expiresIn);

        config.setConfigJson(toJson(configMap));
        config.setUpdatedAt(new Date());
        configRepository.save(config);

        log.info("Zoho SDK access token refreshed for institute {}", config.getInstituteId());
        return configMap;
    }
}
