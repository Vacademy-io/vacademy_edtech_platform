package vacademy.io.admin_core_service.features.shortlink.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;
import java.security.SecureRandom;

@Service
public class ShortLinkIntegrationService {

    @Value("${media.server.baseurl:http://media-service:8075}")
    private String mediaServiceBaseUrl;

    @Value("${short.link.base.url:https://u.vacademy.io}")
    private String shortLinkBaseUrl;

    @Value("${spring.application.name}")
    private String clientName;

    @Autowired
    private InternalClientUtils internalClientUtils;

    public String createShortLink(String shortCode, String destinationUrl, String source, String sourceId, String instituteId) {
        String route = "/media-service/internal/v1/short-link/create";

        CreateShortLinkRequest request = CreateShortLinkRequest.builder()
                .shortCode(shortCode)
                .destinationUrl(destinationUrl)
                .source(source)
                .sourceId(sourceId)
                .instituteId(instituteId)
                .build();

        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    mediaServiceBaseUrl,
                    route,
                    request);

            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new VacademyException("Failed to create short link via media service");
            }

            return shortCode;
        } catch (Exception e) {
            throw new VacademyException(
                    "Error communicating with media service for short link creation: " + e.getMessage());
        }
    }

    /**
     * The short link for a source entity, creating it only the first time.
     *
     * <p>media_service keys these on (source, sourceId), so a workflow that runs
     * every morning reuses the same code for a learner instead of minting a new
     * one per send — the learner's link stays stable and the table doesn't grow
     * a row per day.</p>
     *
     * @return the absolute short URL (e.g. {@code https://u.suchbliss.com/s/K7MNPQ3A}),
     *         or null when media_service could not be reached — callers should fall
     *         back to the long URL rather than send an empty link.
     */
    public String getOrCreateShortLink(String source, String sourceId, String destinationUrl,
            String instituteId) {
        return getOrCreateShortLink(source, sourceId, destinationUrl, instituteId, null);
    }

    /**
     * As above, but asks media_service for a specific code.
     *
     * <p>The hint is a request, not a guarantee. media_service slugifies it and uses
     * it only if it is still free; otherwise it appends a random suffix, and a blank
     * hint means a random code — which is exactly the behaviour of the four-argument
     * form, so existing callers are unaffected.</p>
     *
     * <p>It also only applies the first time. A learner who already has a link keeps
     * it, because media_service matches on (source, sourceId) before it ever looks
     * at the hint.</p>
     *
     * @param shortCodeHint desired code, e.g. a mobile number so the link reads
     *                      {@code u.suchbliss.com/s/919829227181}. Anything readable
     *                      here is also guessable — do not pass a hint that would let
     *                      someone enumerate learners where the destination is not
     *                      itself behind a login.
     */
    public String getOrCreateShortLink(String source, String sourceId, String destinationUrl,
            String instituteId, String shortCodeHint) {
        if (destinationUrl == null || destinationUrl.isBlank()) {
            return null;
        }
        CreateShortLinkRequest request = CreateShortLinkRequest.builder()
                .source(source)
                .sourceId(sourceId)
                .destinationUrl(destinationUrl)
                .instituteId(instituteId)
                .shortCode(shortCodeHint == null || shortCodeHint.isBlank() ? null : shortCodeHint.trim())
                .build();
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    mediaServiceBaseUrl,
                    "/media-service/public/v1/short-link/get-or-create",
                    request);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                shortUrlLogger.warn("get-or-create returned {} for {}/{}",
                        response.getStatusCode(), source, sourceId);
                return null;
            }
            com.fasterxml.jackson.databind.JsonNode node =
                    new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.getBody());
            String absolute = node.path("absoluteUrl").asText(null);
            if (absolute != null && !absolute.isBlank()) {
                return absolute;
            }
            // Older media_service builds return only the code; resolve the host here.
            String shortName = node.path("shortName").asText(null);
            return shortName == null ? null : buildAbsoluteUrl(instituteId, shortName);
        } catch (Exception e) {
            shortUrlLogger.error("Short link get-or-create failed for {}/{}: {}",
                    source, sourceId, e.getMessage(), e);
            return null;
        }
    }

    private static final org.slf4j.Logger shortUrlLogger = org.slf4j.LoggerFactory.getLogger(ShortLinkIntegrationService.class);

    private final java.util.Map<String, String> baseUrlCache = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile long lastCacheClearTime = System.currentTimeMillis();

    public String buildAbsoluteUrl(String instituteId, String shortCode) {
        if (shortCode == null || shortCode.isBlank())
            return null;
        if (shortCode.startsWith("http"))
            return shortCode; // For old existing absolute URLs

        if (System.currentTimeMillis() - lastCacheClearTime > 60000) { // Clear cache every 1 min
            baseUrlCache.clear();
            lastCacheClearTime = System.currentTimeMillis();
        }

        String cacheKey = instituteId != null && !instituteId.isBlank() ? instituteId : "DEFAULT";

        // Cache every answer media-service actually gave, including the default
        // host for institutes without a custom domain — those used to miss the
        // cache and cost one media-service call per short URL, i.e. per invite
        // row in every invite list. Failures are still not cached.
        String cachedHost = baseUrlCache.get(cacheKey);
        String host;
        if (cachedHost != null) {
            host = cachedHost;
        } else {
            String fetched = fetchBaseUrlFromMediaService(instituteId);
            if (fetched != null) {
                baseUrlCache.put(cacheKey, fetched);
                host = fetched;
            } else {
                host = shortLinkBaseUrl;
            }
        }

        // Ensure host doesn't end with slash
        if (host.endsWith("/")) {
            host = host.substring(0, host.length() - 1);
        }

        return host + "/s/" + shortCode;
    }

    /** The host media-service reports for this institute, or null if the call failed. */
    private String fetchBaseUrlFromMediaService(String instituteId) {
        String route = "/media-service/internal/v1/short-link/base-url"
                + (instituteId != null && !instituteId.isBlank() ? "?instituteId=" + instituteId : "");
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    mediaServiceBaseUrl,
                    route,
                    null);
            String responseBody = response.getBody();
            if (response.getStatusCode().is2xxSuccessful() && responseBody != null && !responseBody.isBlank()) {
                // Strip surrounding JSON quotes defensively (e.g. if server returned JSON string)
                String body = responseBody.trim();
                if (body.startsWith("\"") && body.endsWith("\"") && body.length() > 1) {
                    body = body.substring(1, body.length() - 1);
                }
                shortUrlLogger.info("Fetched base URL for institute {}: {}", instituteId, body);
                return body;
            } else {
                shortUrlLogger.warn("base-url endpoint returned non-2xx or empty body for institute {}. Status: {}, Body: {}",
                        instituteId, response.getStatusCode(), responseBody);
            }
        } catch (Exception e) {
            shortUrlLogger.error("Failed to fetch base URL from media service for institute {}: {}",
                    instituteId, e.getMessage(), e);
        }
        return null;
    }

    public String generateRandomCode() {
        return generateRandomCode(6);
    }

    public String generateRandomCode(int length) {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            int index = random.nextInt(chars.length());
            sb.append(chars.charAt(index));
        }
        return sb.toString();
    }

    public void updateShortLink(String source, String sourceId, String newDestinationUrl) {
        String encodedUrl;
        try {
            encodedUrl = java.net.URLEncoder.encode(newDestinationUrl, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            encodedUrl = newDestinationUrl;
        }
        String route = "/media-service/internal/v1/short-link/update?source=" + source
                + "&sourceId=" + sourceId
                + "&newDestinationUrl=" + encodedUrl;

        try {
            internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.PUT.name(),
                    mediaServiceBaseUrl,
                    route,
                    null);
        } catch (Exception e) {
            throw new VacademyException(
                    "Error communicating with media service for short link update: " + e.getMessage());
        }
    }

    public void deleteShortLink(String source, String sourceId) {
        String route = "/media-service/internal/v1/short-link/delete?source=" + source
                + "&sourceId=" + sourceId;

        try {
            internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.DELETE.name(),
                    mediaServiceBaseUrl,
                    route,
                    null);
        } catch (Exception e) {
            throw new VacademyException(
                    "Error communicating with media service for short link deletion: " + e.getMessage());
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    private static class CreateShortLinkRequest {
        private String shortCode;
        private String destinationUrl;
        private String source;
        private String sourceId;
        private String instituteId;
    }
}
