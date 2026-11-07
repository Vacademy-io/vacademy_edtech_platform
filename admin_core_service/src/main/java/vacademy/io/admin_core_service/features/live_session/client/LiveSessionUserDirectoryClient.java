package vacademy.io.admin_core_service.features.live_session.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.*;

/**
 * Looks up user display details (and resolves emails/usernames to ids) from
 * auth_service, which owns the {@code users} table.
 *
 * <p>Used for two jobs: naming instructors on admin and learner cards, and
 * turning the human-typed identifiers in a bulk-import CSV into user ids.
 *
 * <p>Every method degrades to "no data" rather than throwing. An unnamed
 * instructor is a cosmetic problem; a live-session list that 500s because the
 * user directory is briefly unreachable is not.
 */
@Component
@Slf4j
public class LiveSessionUserDirectoryClient {

    private static final int STAFF_PAGE_SIZE = 2000;

    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;

    @Value("${spring.application.name}")
    private String applicationName;

    private final vacademy.io.common.core.internal_api_wrapper.InternalClientUtils internalClientUtils;

    public LiveSessionUserDirectoryClient(
            vacademy.io.common.core.internal_api_wrapper.InternalClientUtils internalClientUtils) {
        this.internalClientUtils = internalClientUtils;
    }

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = buildRestTemplate();

    /** Minimal user record: whatever auth_service could tell us. */
    public record DirectoryUser(String id, String username, String email,
                                String fullName, String mobileNumber, String profilePicFileId) {
    }

    /**
     * Display details for the given user ids, keyed by id. Missing ids are
     * simply absent.
     *
     * <p>Goes over the HMAC-signed internal route rather than the JWT-forwarding
     * one because its callers include the notification scheduler, which runs on
     * a background thread with no inbound request and therefore no Authorization
     * header to forward.
     */
    public Map<String, DirectoryUser> findUsersByIds(Collection<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        List<String> ids = userIds.stream().filter(StringUtils::hasText).distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    applicationName, HttpMethod.POST.name(), authServerBaseUrl,
                    "/auth-service/internal/user/user-details-list", ids);

            Map<String, DirectoryUser> result = new HashMap<>();
            for (JsonNode node : objectMapper.readTree(response.getBody())) {
                DirectoryUser user = toDirectoryUser(node);
                if (user != null && user.id() != null) {
                    result.put(user.id(), user);
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("live_session.instructors.user_lookup_failed count={}: {}", ids.size(), e.getMessage());
            return Map.of();
        }
    }

    /**
     * The institute's staff, for resolving bulk-CSV identifiers.
     *
     * <p>Deliberately one call for the whole institute rather than a lookup per
     * CSV row: a 300-row import would otherwise be 300 cross-service round
     * trips, and the caller matches ids/emails/usernames against the result
     * locally.
     */
    public List<DirectoryUser> findInstituteStaff(String instituteId, List<String> roleNames) {
        if (!StringUtils.hasText(instituteId)) {
            return List.of();
        }
        String authHeader = currentRequestAuthHeader();
        if (authHeader == null) {
            return List.of();
        }
        try {
            Map<String, Object> body = new HashMap<>();
            if (roleNames != null && !roleNames.isEmpty()) {
                body.put("roles", roleNames);
            }
            body.put("status", List.of("ACTIVE"));
            body.put("page_number", 0);
            body.put("page_size", STAFF_PAGE_SIZE);

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", authHeader);
            headers.set("clientId", instituteId);
            headers.setContentType(MediaType.APPLICATION_JSON);

            ResponseEntity<String> response = restTemplate.exchange(
                    authServerBaseUrl + "/auth-service/v1/user-roles/users-of-status?instituteId=" + instituteId,
                    HttpMethod.POST, new HttpEntity<>(body, headers), String.class);

            List<DirectoryUser> users = new ArrayList<>();
            for (JsonNode node : objectMapper.readTree(response.getBody()).path("content")) {
                DirectoryUser user = toDirectoryUser(node);
                if (user != null && user.id() != null) {
                    users.add(user);
                }
            }
            return users;
        } catch (Exception e) {
            log.warn("live_session.instructors.staff_lookup_failed instituteId={}: {}",
                    instituteId, e.getMessage());
            return List.of();
        }
    }

    /**
     * auth_service serializes {@code User} in camelCase and
     * {@code UserWithRolesDTO} in snake_case, and this client reads both
     * endpoints, so each field is looked up under either spelling.
     */
    private DirectoryUser toDirectoryUser(JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return new DirectoryUser(
                text(node, "id"),
                text(node, "username"),
                text(node, "email"),
                text(node, "fullName", "full_name"),
                text(node, "mobileNumber", "mobile_number"),
                text(node, "profilePicFileId", "profile_pic_file_id"));
    }

    private String text(JsonNode node, String... names) {
        for (String name : names) {
            JsonNode value = node.get(name);
            if (value != null && !value.isNull() && StringUtils.hasText(value.asText())) {
                return value.asText();
            }
        }
        return null;
    }

    private String currentRequestAuthHeader() {
        try {
            ServletRequestAttributes attrs =
                    (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            return attrs == null ? null : attrs.getRequest().getHeader("Authorization");
        } catch (Exception e) {
            return null;
        }
    }

    private static RestTemplate buildRestTemplate() {
        org.springframework.http.client.SimpleClientHttpRequestFactory factory =
                new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(15000);
        return new RestTemplate(factory);
    }
}
