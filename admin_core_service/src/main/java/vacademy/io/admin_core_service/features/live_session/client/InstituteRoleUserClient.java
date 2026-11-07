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
import java.util.concurrent.ConcurrentHashMap;

/**
 * Resolves "which users in this institute hold these roles" from auth_service.
 *
 * <p>admin_core_service has no {@code users} or {@code user_role} table — those
 * live in auth_service's database — so role membership cannot be joined in SQL
 * and has to be fetched over HTTP. That makes this call latency-critical: it
 * sits in front of every admin live-session list for an institute that has
 * configured SPECIFIC_ROLES visibility.
 *
 * <p>Hence the short TTL cache. Role membership changes rarely (someone is made
 * a teacher), the blast radius of a stale entry is bounded (a session appears or
 * disappears from a list for up to a minute), and the alternative is one
 * cross-service round trip per list render.
 *
 * <p>Failure is <b>fail-open</b>: if auth_service cannot be reached we return
 * an empty optional and the caller falls back to OWN rather than to ALL. Losing
 * sight of colleagues' sessions for a minute is recoverable; showing every
 * session in the institute to a role that was configured not to see them is not.
 */
@Component
@Slf4j
public class InstituteRoleUserClient {

    private static final long CACHE_TTL_MS = 60_000L;
    /** users-of-status is paged; the roles we resolve are staff roles, not learners. */
    private static final int PAGE_SIZE = 2000;

    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;

    @Value("${spring.application.name}")
    private String applicationName;

    private final vacademy.io.common.core.internal_api_wrapper.InternalClientUtils internalClientUtils;

    public InstituteRoleUserClient(
            vacademy.io.common.core.internal_api_wrapper.InternalClientUtils internalClientUtils) {
        this.internalClientUtils = internalClientUtils;
    }

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = buildRestTemplate();
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private final Map<String, CacheEntry> callerRolesCache = new ConcurrentHashMap<>();
    private final Map<String, CacheEntry> callerRoleIdsCache = new ConcurrentHashMap<>();

    private record CacheEntry(Set<String> userIds, long expiresAt) {
        boolean isFresh() {
            return System.currentTimeMillis() < expiresAt;
        }
    }

    /**
     * User ids of every ACTIVE member of {@code roleNames} in the institute.
     *
     * @return empty optional when the lookup failed — distinct from an empty
     *         set, which legitimately means "nobody holds these roles".
     */
    public Optional<Set<String>> findUserIdsWithRoles(String instituteId, Collection<String> roleNames) {
        if (!StringUtils.hasText(instituteId) || roleNames == null || roleNames.isEmpty()) {
            return Optional.of(Set.of());
        }

        List<String> normalizedRoles = roleNames.stream()
                .filter(StringUtils::hasText)
                .map(r -> r.trim().toUpperCase())
                .distinct()
                .sorted()
                .toList();
        if (normalizedRoles.isEmpty()) {
            return Optional.of(Set.of());
        }

        String cacheKey = instituteId + "::" + String.join(",", normalizedRoles);
        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && cached.isFresh()) {
            return Optional.of(cached.userIds());
        }

        String authHeader = currentRequestAuthHeader();
        if (authHeader == null) {
            log.warn("live_session.visibility.role_lookup_no_auth_header instituteId={}", instituteId);
            return Optional.empty();
        }

        try {
            Map<String, Object> body = new HashMap<>();
            body.put("roles", normalizedRoles);
            body.put("status", List.of("ACTIVE"));
            body.put("page_number", 0);
            body.put("page_size", PAGE_SIZE);

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", authHeader);
            headers.set("clientId", instituteId);
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = authServerBaseUrl
                    + "/auth-service/v1/user-roles/users-of-status?instituteId=" + instituteId;
            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(body, headers), String.class);

            JsonNode content = objectMapper.readTree(response.getBody()).path("content");
            Set<String> userIds = new HashSet<>();
            for (JsonNode node : content) {
                String id = node.path("id").asText(null);
                if (StringUtils.hasText(id)) {
                    userIds.add(id);
                }
            }
            cache.put(cacheKey, new CacheEntry(Set.copyOf(userIds),
                    System.currentTimeMillis() + CACHE_TTL_MS));
            return Optional.of(Set.copyOf(userIds));
        } catch (Exception e) {
            log.error("live_session.visibility.role_lookup_failed instituteId={} roles={}: {}",
                    instituteId, normalizedRoles, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * The role names one user holds <b>at this institute</b>.
     *
     * <p>Needed because {@code CustomUserDetails.getAuthorities()} flattens role
     * names and permission names into a single list with nothing to tell them
     * apart. The visibility rules are keyed by role, and "a role with no rule
     * means ALL" — so a permission string wrongly treated as a role would make
     * every caller unrestricted. auth_service's {@code institute-roles} route
     * is the documented source for authorisation decisions, and is HMAC-signed
     * so it needs no forwarded JWT.
     *
     * @return empty optional when the lookup failed — distinct from an empty
     *         set, which means "no roles at this institute".
     */
    public Optional<Set<String>> findRolesOfUser(String instituteId, String userId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId)) {
            return Optional.of(Set.of());
        }
        String cacheKey = instituteId + "::" + userId;
        CacheEntry cached = callerRolesCache.get(cacheKey);
        if (cached != null && cached.isFresh()) {
            return Optional.of(cached.userIds());
        }
        try {
            String route = "/auth-service/internal/user/v1/institute-roles?instituteId="
                    + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&userIds=" + java.net.URLEncoder.encode(userId, java.nio.charset.StandardCharsets.UTF_8);
            ResponseEntity<String> response = internalClientUtils.makeHmacRequestWithEncodedRoute(
                    applicationName, HttpMethod.GET.name(), authServerBaseUrl, route, null);

            Set<String> roles = new HashSet<>();
            JsonNode node = objectMapper.readTree(response.getBody()).path(userId);
            for (JsonNode role : node) {
                String name = role.asText(null);
                if (StringUtils.hasText(name)) {
                    roles.add(name.trim().toUpperCase());
                }
            }
            Set<String> frozen = Set.copyOf(roles);
            callerRolesCache.put(cacheKey, new CacheEntry(frozen, System.currentTimeMillis() + CACHE_TTL_MS));
            return Optional.of(frozen);
        } catch (Exception e) {
            log.error("live_session.visibility.caller_roles_lookup_failed instituteId={} userId={}: {}",
                    instituteId, userId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Role IDS the user holds ACTIVE at the institute — what per-role Display Settings cards are
     * keyed by. Same contract as {@link #findRolesOfUser}: empty optional when the lookup failed.
     */
    public Optional<Set<String>> findRoleIdsOfUser(String instituteId, String userId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId)) {
            return Optional.of(Set.of());
        }
        String cacheKey = instituteId + "::" + userId;
        CacheEntry cached = callerRoleIdsCache.get(cacheKey);
        if (cached != null && cached.isFresh()) {
            return Optional.of(cached.userIds());
        }
        try {
            String route = "/auth-service/internal/user/v1/institute-role-ids?instituteId="
                    + java.net.URLEncoder.encode(instituteId, java.nio.charset.StandardCharsets.UTF_8)
                    + "&userId=" + java.net.URLEncoder.encode(userId, java.nio.charset.StandardCharsets.UTF_8);
            ResponseEntity<String> response = internalClientUtils.makeHmacRequestWithEncodedRoute(
                    applicationName, HttpMethod.GET.name(), authServerBaseUrl, route, null);

            Set<String> ids = new HashSet<>();
            for (JsonNode id : objectMapper.readTree(response.getBody())) {
                String value = id.asText(null);
                if (StringUtils.hasText(value)) {
                    ids.add(value.trim());
                }
            }
            Set<String> frozen = Set.copyOf(ids);
            callerRoleIdsCache.put(cacheKey, new CacheEntry(frozen, System.currentTimeMillis() + CACHE_TTL_MS));
            return Optional.of(frozen);
        } catch (Exception e) {
            log.error("caller_role_ids_lookup_failed instituteId={} userId={}: {}",
                    instituteId, userId, e.getMessage());
            return Optional.empty();
        }
    }

    private String currentRequestAuthHeader() {
        try {
            ServletRequestAttributes attrs =
                    (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs == null) {
                return null;
            }
            return attrs.getRequest().getHeader("Authorization");
        } catch (Exception e) {
            return null;
        }
    }

    private static RestTemplate buildRestTemplate() {
        org.springframework.http.client.SimpleClientHttpRequestFactory factory =
                new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(10000);
        return new RestTemplate(factory);
    }
}
