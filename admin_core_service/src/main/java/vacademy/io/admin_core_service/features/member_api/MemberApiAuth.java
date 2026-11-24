package vacademy.io.admin_core_service.features.member_api;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.service.ApiKeySecrets;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Authenticates a Member Lookup API request and enforces its per-key rate limit.
 *
 * <p>Keys: the institute's existing login-links keys ({@code vak_login_…}, product
 * {@code login_links}, Settings → Security → Login links). No new key or scope is needed:
 * a login-links key can already mint a code that signs in as any learner of the institute
 * and sees everything that learner sees, so reading the same learner's profile, membership
 * and sub-org data through this API grants nothing new.
 *
 * <p>Sent as {@code X-API-Key: <key>} or {@code Authorization: Bearer <key>}. The institute
 * always comes from the key, never from the request.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MemberApiAuth {

    /** Requests per key per minute, per pod. A bulk lookup of 100 users is one request. */
    static final int REQUESTS_PER_MINUTE = 120;

    private final InstituteApiKeyService instituteApiKeyService;

    private final Map<String, long[]> windows = new ConcurrentHashMap<>();

    public record Principal(String instituteId, String keyId) {
    }

    public Principal authenticate(HttpServletRequest request) {
        String key = presentedKey(request);
        if (key == null) {
            throw new MemberApiException(HttpStatus.UNAUTHORIZED, "missing_api_key",
                    "Send your API key in the X-API-Key header (or Authorization: Bearer).");
        }
        if (!key.startsWith(ApiKeySecrets.LOGIN_LINKS_KEY_PREFIX)) {
            throw new MemberApiException(HttpStatus.UNAUTHORIZED, "invalid_api_key",
                    "Use a Login links API key (starts with vak_login_), from Settings → Security.");
        }
        Optional<ApiKeyVerifyResponse> verified;
        try {
            verified = instituteApiKeyService.verify(ApiKeySecrets.sha256Hex(key), clientIp(request));
        } catch (RuntimeException e) {
            log.warn("member-api: key verification failed: {}", e.getMessage());
            throw new MemberApiException(HttpStatus.SERVICE_UNAVAILABLE, "auth_unavailable",
                    "Could not verify the API key right now. Retry shortly.", null, 5);
        }
        ApiKeyVerifyResponse v = verified.orElseThrow(() -> new MemberApiException(HttpStatus.UNAUTHORIZED,
                "invalid_api_key", "This API key is invalid, revoked or expired."));
        if (v.products() == null || !v.products().contains(InstituteApiKeyService.PRODUCT_LOGIN_LINKS)) {
            throw new MemberApiException(HttpStatus.FORBIDDEN, "product_not_enabled",
                    "This API key is not a Login links key.");
        }
        rateLimit(v.keyId());
        return new Principal(v.instituteId(), v.keyId());
    }

    /** Fixed one-minute window per key. In memory, per pod: a guard rail, not billing. */
    void rateLimit(String keyId) {
        long minute = System.currentTimeMillis() / 60_000L;
        long[] w = windows.compute(keyId, (k, prev) -> {
            if (prev == null || prev[0] != minute) return new long[]{minute, 1};
            prev[1]++;
            return prev;
        });
        if (w[1] > REQUESTS_PER_MINUTE) {
            int retry = (int) Math.max(1, 60 - (System.currentTimeMillis() / 1000L) % 60);
            throw new MemberApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited",
                    "Too many requests for this API key (limit " + REQUESTS_PER_MINUTE + " per minute).",
                    Map.of("limit_per_minute", REQUESTS_PER_MINUTE), retry);
        }
        if (windows.size() > 10_000) windows.entrySet().removeIf(e -> e.getValue()[0] < minute);
    }

    static String presentedKey(HttpServletRequest request) {
        String key = request.getHeader("X-API-Key");
        if (key == null || key.isBlank()) {
            String auth = request.getHeader("Authorization");
            if (auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) key = auth.substring(7);
        }
        return key == null || key.isBlank() ? null : key.trim();
    }

    private static String clientIp(HttpServletRequest request) {
        String cf = request.getHeader("CF-Connecting-IP");
        if (cf != null && !cf.isBlank()) return cf.trim();
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        return request.getRemoteAddr();
    }
}
