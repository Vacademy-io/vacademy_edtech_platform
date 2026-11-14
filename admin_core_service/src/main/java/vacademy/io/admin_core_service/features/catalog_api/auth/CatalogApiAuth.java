package vacademy.io.admin_core_service.features.catalog_api.auth;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.website.InstituteWebsiteService;
import vacademy.io.admin_core_service.features.catalog_api.website.WebsiteHosts;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.service.ApiKeySecrets;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * Authenticates a public Catalogue API request ({@code /admin-core-service/open/catalog/v1}),
 * locks browser calls to the institute's verified websites and enforces the per-key limits.
 *
 * <p>Keys: publishable {@code vak_pub_…} institute API keys (product {@code catalog}), sent as
 * {@code X-API-Key: <key>} or {@code Authorization: Bearer <key>}. They are meant to be visible
 * in page source, so the key alone proves little; what keeps another site from embedding it:
 * <ul>
 *   <li><b>Origin lock.</b> A request with an {@code Origin} header (every cross-origin browser
 *       fetch) must come from localhost / 127.0.0.1 / [::1] (any port, the institute's local
 *       development) or from a host equal to, or a subdomain of, a VERIFIED website of the key's
 *       institute. No Origin = a server-side fetch (e.g. Next.js SSR): allowed. Referer is not
 *       consulted.</li>
 *   <li><b>Rate limits</b>, in memory per pod, fixed one-minute windows: every call
 *       {@value #READS_PER_MINUTE}/min per key; enquiries additionally
 *       {@value #LEADS_PER_MINUTE}/min per key and {@value #LEADS_PER_MINUTE_PER_CLIENT}/min per
 *       (key, end-user IP) via {@link #rateLimitLead}.</li>
 * </ul>
 * A successful key verification is cached for {@value #VERIFY_CACHE_TTL_MS} ms per pod, so a
 * revoked key keeps working for up to that long.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CatalogApiAuth {

    public static final String SCOPE_READ = InstituteApiKeyService.SCOPE_CATALOG_READ;
    public static final String SCOPE_LEADS_WRITE = InstituteApiKeyService.SCOPE_LEADS_WRITE;

    static final int READS_PER_MINUTE = 1200;
    static final int LEADS_PER_MINUTE = 30;
    static final int LEADS_PER_MINUTE_PER_CLIENT = 5;
    static final long VERIFY_CACHE_TTL_MS = 30_000L;
    private static final int MAX_TRACKED = 10_000;
    private static final Pattern KEY_SHAPE = Pattern.compile("^vak_pub_[0-9a-f]{48}$");

    private final InstituteApiKeyService instituteApiKeyService;
    private final InstituteWebsiteService websiteService;

    /** bucket -> {minute, count}. */
    private final Map<String, long[]> windows = new ConcurrentHashMap<>();
    /** key hash -> verified principal, for {@link #VERIFY_CACHE_TTL_MS}. */
    private final Map<String, CachedPrincipal> verified = new ConcurrentHashMap<>();

    private LongSupplier clock = System::currentTimeMillis;

    void setClock(LongSupplier clock) {
        this.clock = clock;
    }

    public record Principal(String instituteId, String keyId, List<String> scopes) {
        public boolean has(String scope) {
            return scopes != null && scopes.contains(scope);
        }
    }

    /**
     * Key → principal, scope check, the origin lock, then the read rate limit
     * ({@value #READS_PER_MINUTE}/min per key). Throws {@link CatalogApiException} with the public error code.
     */
    public Principal authenticate(HttpServletRequest request, String requiredScope) {
        String key = presentedKey(request);
        if (key == null) {
            throw new CatalogApiException(HttpStatus.UNAUTHORIZED, "missing_api_key",
                    "Send your publishable key in the X-API-Key header (or Authorization: Bearer).");
        }
        Principal p = verifyKey(key, clientIp(request));
        if (requiredScope != null && !p.has(requiredScope)) {
            throw new CatalogApiException(HttpStatus.FORBIDDEN, "insufficient_scope",
                    "This API key does not have the " + requiredScope + " scope.",
                    Map.of("required_scope", requiredScope), null);
        }
        // Origin first: a call from a site that is not the institute's must not use up its quota.
        checkOrigin(p, request.getHeader("Origin"));
        hit("read:" + p.keyId(), READS_PER_MINUTE,
                "Too many requests for this API key (limit " + READS_PER_MINUTE + " per minute).");
        return p;
    }

    /**
     * Enquiry limits on top of {@link #authenticate}: {@value #LEADS_PER_MINUTE}/min per key, and
     * {@value #LEADS_PER_MINUTE_PER_CLIENT}/min per (key, end-user IP) when the end user's IP is
     * known: from the network for a browser call (CF-Connecting-IP, else the first
     * X-Forwarded-For hop), from {@code X-Client-IP} for a server-side call. A browser cannot
     * pick its own bucket with X-Client-IP: when Origin is present that header is ignored.
     */
    public void rateLimitLead(Principal p, HttpServletRequest request) {
        hit("lead:" + p.keyId(), LEADS_PER_MINUTE,
                "Too many enquiries for this API key (limit " + LEADS_PER_MINUTE + " per minute).");
        String endUser = endUserIp(request);
        if (endUser != null) {
            hit("lead-ip:" + p.keyId() + "|" + endUser, LEADS_PER_MINUTE_PER_CLIENT,
                    "Too many enquiries from this visitor (limit " + LEADS_PER_MINUTE_PER_CLIENT
                            + " per minute). Try again shortly.");
        }
    }

    // ── Key ──────────────────────────────────────────────────────────────────

    private Principal verifyKey(String key, String ip) {
        if (!key.startsWith(ApiKeySecrets.CATALOG_KEY_PREFIX)) {
            throw new CatalogApiException(HttpStatus.UNAUTHORIZED, "invalid_api_key",
                    "This is not a Catalogue API key. Publishable keys start with vak_pub_.");
        }
        if (!KEY_SHAPE.matcher(key).matches()) {
            // Malformed: no lookup, same answer as an unknown key.
            throw invalidKey();
        }
        String hash = ApiKeySecrets.sha256Hex(key);
        long now = clock.getAsLong();
        CachedPrincipal cached = verified.get(hash);
        if (cached != null && cached.expiresAtMillis() > now) {
            return cached.principal();
        }
        Optional<ApiKeyVerifyResponse> found;
        try {
            found = instituteApiKeyService.verify(hash, ip);
        } catch (RuntimeException e) {
            log.warn("catalog-api: key verification failed: {}", e.getMessage());
            throw new CatalogApiException(HttpStatus.SERVICE_UNAVAILABLE, "auth_unavailable",
                    "Could not verify the API key right now. Retry shortly.", null, 5);
        }
        ApiKeyVerifyResponse v = found.orElseThrow(CatalogApiAuth::invalidKey);
        if (v.products() == null || !v.products().contains(InstituteApiKeyService.PRODUCT_CATALOG)) {
            throw new CatalogApiException(HttpStatus.FORBIDDEN, "product_not_enabled",
                    "This API key is not a Catalogue API key.");
        }
        Principal p = new Principal(v.instituteId(), v.keyId(), v.scopes() == null ? List.of() : List.copyOf(v.scopes()));
        if (verified.size() > MAX_TRACKED) {
            verified.entrySet().removeIf(e -> e.getValue().expiresAtMillis() <= now);
            if (verified.size() > MAX_TRACKED) verified.clear();
        }
        verified.put(hash, new CachedPrincipal(p, now + VERIFY_CACHE_TTL_MS));
        return p;
    }

    private static CatalogApiException invalidKey() {
        return new CatalogApiException(HttpStatus.UNAUTHORIZED, "invalid_api_key",
                "This API key is invalid, revoked or expired.");
    }

    // ── Origin lock ──────────────────────────────────────────────────────────

    void checkOrigin(Principal p, String origin) {
        if (origin == null) {
            return; // server-side call
        }
        String host = WebsiteHosts.originHost(origin);
        if (host != null && WebsiteHosts.isLocalDevHost(host)) {
            return;
        }
        if (host != null && isAllowed(websiteService.verifiedHosts(p.instituteId()), host)) {
            return;
        }
        String shown = host != null ? host : origin.trim();
        if (shown.length() > 100) shown = shown.substring(0, 100);
        throw new CatalogApiException(HttpStatus.FORBIDDEN, "origin_not_allowed",
                host != null
                        ? "Add and verify " + host + " in Settings → Integrations → Catalogue API & websites to call this API from it."
                        : "This API can only be called from your verified websites (Settings → Integrations → Catalogue API & websites).",
                Map.of("origin", shown), null);
    }

    /** Exact host or a subdomain of a verified host, on label boundaries ({@link WebsiteHosts#covers}). */
    static boolean isAllowed(Set<String> verifiedHosts, String originHost) {
        return WebsiteHosts.coveredByAny(verifiedHosts, originHost);
    }

    // ── Rate limits ──────────────────────────────────────────────────────────

    /** Fixed one-minute window per bucket. In memory, per pod: a guard rail, not billing. */
    void hit(String bucket, int limit, String message) {
        long nowMs = clock.getAsLong();
        long minute = nowMs / 60_000L;
        long[] w = windows.compute(bucket, (k, prev) -> {
            if (prev == null || prev[0] != minute) return new long[]{minute, 1};
            prev[1]++;
            return prev;
        });
        if (windows.size() > MAX_TRACKED) windows.entrySet().removeIf(e -> e.getValue()[0] < minute);
        if (w[1] > limit) {
            int retry = (int) Math.max(1, 60 - (nowMs / 1000L) % 60);
            throw new CatalogApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", message,
                    Map.of("limit_per_minute", limit), retry);
        }
    }

    // ── Request helpers ──────────────────────────────────────────────────────

    static String presentedKey(HttpServletRequest request) {
        String key = request.getHeader("X-API-Key");
        if (key == null || key.isBlank()) {
            String auth = request.getHeader("Authorization");
            if (auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) key = auth.substring(7);
        }
        return key == null || key.isBlank() ? null : key.trim();
    }

    /** The end user's IP for the per-visitor enquiry limit, or null when it is not known. */
    static String endUserIp(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null) {
            return networkClientIp(request);
        }
        return clean(request.getHeader("X-Client-IP"));
    }

    /**
     * CF-Connecting-IP, else the first X-Forwarded-For hop (null when neither is present). Behind
     * Cloudflare the first X-Forwarded-For hop can be the edge (our ingress does not rewrite it), so
     * CF-Connecting-IP — the visitor as Cloudflare saw them — wins. Shared by the open endpoints
     * that rate-limit per visitor IP.
     */
    public static String networkClientIp(HttpServletRequest request) {
        String cf = clean(request.getHeader("CF-Connecting-IP"));
        if (cf != null) return cf;
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return clean(xff.split(",")[0]);
        return null;
    }

    private static String clientIp(HttpServletRequest request) {
        String ip = networkClientIp(request);
        return ip != null ? ip : request.getRemoteAddr();
    }

    private static String clean(String ip) {
        if (ip == null) return null;
        String s = ip.trim();
        if (s.isEmpty()) return null;
        return s.length() <= 64 ? s : s.substring(0, 64);
    }

    private record CachedPrincipal(Principal principal, long expiresAtMillis) {
    }
}
