package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;

/**
 * Pushes learner profile edits (name/email) AND portal password changes to every
 * WordPress LMS the learner's courses are connected to, via the site's CRM plugin
 * ({@code /wp-json/crm/v1/edit-user}, Basic auth with the same
 * apiKey/apiSecret stored in LMS_SETTING). Best-effort and async: the
 * profile/password edit never fails because an LMS is unreachable, and a learner
 * missing on the LMS is the LMS's 4xx to log, not ours to surface.
 *
 * <p>Which sites those are is {@link LearnerLmsConnectionResolver}'s answer, shared
 * with the post-password-change hand-off so a learner is never sent to a site this
 * class did not push their new password to.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerLmsUserSyncService {

    private final LearnerLmsConnectionResolver learnerLmsConnectionResolver;
    private final ObjectMapper objectMapper;

    @Async
    public void syncProfileUpdate(String userId, String oldEmail, String newEmail, String newFullName) {
        try {
            doSync(userId, oldEmail, newEmail, newFullName);
        } catch (Exception e) {
            log.warn("LMS profile sync failed for user {}: {}", userId, e.getMessage());
        }
    }

    /**
     * Mirrors a learner's new portal password to every connected WordPress LMS.
     * Same discovery + edit-user path as the profile sync, but the payload carries
     * only {@code email} (to match the WP user) + {@code password}. Async and
     * best-effort: a password change must never fail because an LMS is unreachable.
     */
    @Async
    public void syncPasswordUpdate(String userId, String email, String newPassword) {
        try {
            doPasswordSync(userId, email, newPassword);
        } catch (Exception e) {
            log.warn("LMS password sync failed for user {}: {}", userId, e.getMessage());
        }
    }

    private void doSync(String userId, String oldEmail, String newEmail, String newFullName) {
        if (!StringUtils.hasText(oldEmail)) {
            log.debug("LMS profile sync skipped for user {}: no existing email to match on", userId);
            return;
        }

        Map<String, JsonNode> connections = resolveWordpressConnections(userId);
        if (connections.isEmpty()) {
            log.debug("LMS profile sync: no WordPress LMS connections for user {}", userId);
            return;
        }

        ObjectNode payload = buildEditUserPayload(oldEmail, newEmail, newFullName);
        for (JsonNode conn : connections.values()) {
            pushEditUser(conn, payload, userId);
        }
    }

    private void doPasswordSync(String userId, String email, String newPassword) {
        if (!StringUtils.hasText(email) || !StringUtils.hasText(newPassword)) {
            log.debug("LMS password sync skipped for user {}: missing email or password", userId);
            return;
        }

        Map<String, JsonNode> connections = resolveWordpressConnections(userId);
        if (connections.isEmpty()) {
            log.debug("LMS password sync: no WordPress LMS connections for user {}", userId);
            return;
        }

        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("email", email.trim());
        payload.put("password", newPassword);
        for (JsonNode conn : connections.values()) {
            pushEditUser(conn, payload, userId);
        }
    }

    /** Delegates to the shared resolver so discovery and the push agree on one rule set. */
    private Map<String, JsonNode> resolveWordpressConnections(String userId) {
        return learnerLmsConnectionResolver.resolveWordpressConnections(userId);
    }

    private ObjectNode buildEditUserPayload(String oldEmail, String newEmail, String newFullName) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("email", oldEmail.trim());
        if (StringUtils.hasText(newEmail) && !newEmail.trim().equalsIgnoreCase(oldEmail.trim())) {
            payload.put("new_email", newEmail.trim());
        }
        if (StringUtils.hasText(newFullName)) {
            String[] parts = newFullName.trim().split("\\s+", 2);
            payload.put("first_name", parts[0]);
            payload.put("last_name", parts.length > 1 ? parts[1] : "");
        }
        return payload;
    }

    private void pushEditUser(JsonNode conn, ObjectNode payload, String userId) {
        String apiUrl = conn.path("apiUrl").asText("");
        String apiKey = conn.path("apiKey").asText("");
        String apiSecret = conn.path("apiSecret").asText("");
        String editUserUrl = deriveEditUserUrl(apiUrl);
        try {
            String basic = Base64.getEncoder()
                    .encodeToString((apiKey + ":" + apiSecret).getBytes(StandardCharsets.UTF_8));
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(8))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(editUserUrl))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Basic " + basic)
                    .POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                log.info("LMS profile sync ok for user {} at {}", userId, editUserUrl);
            } else {
                log.warn("LMS profile sync for user {} at {} returned HTTP {}: {}", userId, editUserUrl,
                        response.statusCode(), truncate(response.body()));
            }
        } catch (Exception e) {
            log.warn("LMS profile sync for user {} at {} failed: {}", userId, editUserUrl, e.getMessage());
        }
    }

    /**
     * The CRM plugin lives at {@code <site>/wp-json/crm/v1/edit-user}; the
     * stored apiUrl is usually {@code <site>/wp-json/wp/v2}, so cut back to
     * the /wp-json root before appending the plugin route.
     */
    private String deriveEditUserUrl(String apiUrl) {
        String url = apiUrl.trim();
        if (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        int wpJson = url.indexOf("/wp-json");
        String base = wpJson >= 0 ? url.substring(0, wpJson + "/wp-json".length()) : url + "/wp-json";
        return base + "/crm/v1/edit-user";
    }

    private static String truncate(String s) {
        if (s == null) {
            return null;
        }
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }
}
