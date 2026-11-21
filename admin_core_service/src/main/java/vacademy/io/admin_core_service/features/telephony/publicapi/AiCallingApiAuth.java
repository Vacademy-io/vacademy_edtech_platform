package vacademy.io.admin_core_service.features.telephony.publicapi;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.service.ApiKeySecrets;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;
import vacademy.io.admin_core_service.features.telephony.apikey.AiCallApiKeyService;
import vacademy.io.admin_core_service.features.telephony.apikey.entity.AiCallApiKey;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Authenticates a public AI calling API request and enforces its per-key rate limit.
 *
 * <p>Keys: {@code vak_call_…} institute API keys (hashed, product {@code ai_calling},
 * issued in Settings). The first-generation {@code vak_live_…} keys (ai_call_api_key,
 * stored in plaintext) are still accepted with the default AI calling scopes, so nothing
 * that used them breaks; new keys are only issued as {@code vak_call_}. They never get the
 * human_calls scopes: those let a key ring staff phones and list staff, and must be granted
 * explicitly on a new key.
 *
 * <p>Sent as {@code X-API-Key: <key>} or {@code Authorization: Bearer <key>}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiCallingApiAuth {

    /** Requests per key per minute, per pod. A batch of 1,000 calls is one request. */
    static final int REQUESTS_PER_MINUTE = 300;

    private final InstituteApiKeyService instituteApiKeyService;
    private final AiCallApiKeyService legacyKeyService;

    private final Map<String, long[]> windows = new ConcurrentHashMap<>();

    public record Principal(String instituteId, String keyId, List<String> scopes) {
        public boolean has(String scope) {
            return scopes != null && scopes.contains(scope);
        }
    }

    public Principal authenticate(HttpServletRequest request, String requiredScope) {
        String key = presentedKey(request);
        if (key == null) {
            throw new AiCallingApiException(HttpStatus.UNAUTHORIZED, "missing_api_key",
                    "Send your API key in the X-API-Key header (or Authorization: Bearer).");
        }
        Principal p = key.startsWith(AiCallApiKeyService.KEY_PREFIX) ? legacy(key) : current(key, clientIp(request));
        if (requiredScope != null && !p.has(requiredScope)) {
            throw new AiCallingApiException(HttpStatus.FORBIDDEN, "insufficient_scope",
                    "This API key does not have the " + requiredScope + " scope.",
                    Map.of("required_scope", requiredScope));
        }
        rateLimit(p.keyId());
        return p;
    }

    /**
     * As {@link #authenticate}, for routes several scopes may reach (e.g. reading a counsellor:
     * human_calls:read or counsellors:manage). Passes when the key holds any of them.
     */
    public Principal authenticateAny(HttpServletRequest request, String... anyOf) {
        Principal p = authenticate(request, null);
        for (String s : anyOf) {
            if (p.has(s)) return p;
        }
        throw new AiCallingApiException(HttpStatus.FORBIDDEN, "insufficient_scope",
                "This API key needs one of these scopes: " + String.join(", ", anyOf) + ".",
                Map.of("required_scope", anyOf[0], "accepted_scopes", List.of(anyOf)));
    }

    private Principal current(String key, String ip) {
        if (!key.startsWith(ApiKeySecrets.AI_CALLING_KEY_PREFIX)) {
            throw new AiCallingApiException(HttpStatus.UNAUTHORIZED, "invalid_api_key",
                    "This is not an AI calling API key. Keys start with vak_call_.");
        }
        Optional<ApiKeyVerifyResponse> verified;
        try {
            verified = instituteApiKeyService.verify(ApiKeySecrets.sha256Hex(key), ip);
        } catch (RuntimeException e) {
            log.warn("ai-calling-api: key verification failed: {}", e.getMessage());
            throw new AiCallingApiException(HttpStatus.SERVICE_UNAVAILABLE, "auth_unavailable",
                    "Could not verify the API key right now. Retry shortly.", null, 5);
        }
        ApiKeyVerifyResponse v = verified.orElseThrow(() -> new AiCallingApiException(HttpStatus.UNAUTHORIZED,
                "invalid_api_key", "This API key is invalid, revoked or expired."));
        if (v.products() == null || !v.products().contains(InstituteApiKeyService.PRODUCT_AI_CALLING)) {
            throw new AiCallingApiException(HttpStatus.FORBIDDEN, "product_not_enabled",
                    "This API key is not an AI calling key.");
        }
        return new Principal(v.instituteId(), v.keyId(), v.scopes());
    }

    private Principal legacy(String key) {
        try {
            AiCallApiKey k = legacyKeyService.verify(key);
            return new Principal(k.getInstituteId(), "legacy:" + k.getId(), InstituteApiKeyService.AI_CALLING_SCOPES);
        } catch (ResponseStatusException e) {
            throw new AiCallingApiException(HttpStatus.UNAUTHORIZED, "invalid_api_key",
                    "This API key is invalid or revoked.");
        }
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
            throw new AiCallingApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited",
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
