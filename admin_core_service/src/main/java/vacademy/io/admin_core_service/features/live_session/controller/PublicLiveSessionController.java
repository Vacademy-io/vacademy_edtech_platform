package vacademy.io.admin_core_service.features.live_session.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsRateLimiter;
import vacademy.io.admin_core_service.features.live_session.service.PublicLiveSessionService;

import java.util.Map;

/**
 * Upcoming PUBLIC live classes of an institute, for anonymous visitors of its website
 * (docs/site-assistant/SPEC.md 3.1). No auth: {@code /admin-core-service/open/**} is permitAll in
 * ApplicationSecurityConfig. Rate-limited per IP and per institute with the reader-sized limiter
 * the other open catalogue reads share; cacheable for 60 s. Rules in {@link PublicLiveSessionService}.
 *
 * <p>Server-side callers (ai_service) use the internal mirror
 * {@code /admin-core-service/internal/site-assistant/v1/live-sessions}, which has no per-IP limit.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/live-sessions")
@RequiredArgsConstructor
public class PublicLiveSessionController {

    private final PublicLiveSessionService service;
    private final CatalogueAnalyticsRateLimiter rateLimiter;

    @GetMapping("/public")
    public ResponseEntity<Map<String, Object>> publicSessions(HttpServletRequest request,
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "days", required = false) String days,
            @RequestParam(value = "limit", required = false) String limit) {
        PublicLiveSessionService.Query query;
        try {
            query = service.parse(instituteId, from, days, limit);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().header("Cache-Control", "no-store")
                    .body(Map.of("error", e.getMessage()));
        }
        if (!rateLimiter.tryAcquire(clientIp(request), query.instituteId())) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).header("Retry-After", "60")
                    .header("Cache-Control", "no-store")
                    .body(Map.of("error", "Too many requests. Try again in a minute."));
        }
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60")
                .body(service.list(query));
    }

    /**
     * The visitor's IP for the per-IP limit, by the Catalogue API's rule
     * ({@link CatalogApiAuth#networkClientIp}): CF-Connecting-IP, else the first X-Forwarded-For
     * hop, else the socket peer. Taking X-Forwarded-For first would bucket every visitor behind one
     * Cloudflare edge into the same limit.
     */
    static String clientIp(HttpServletRequest request) {
        String ip = CatalogApiAuth.networkClientIp(request);
        return ip != null ? ip : request.getRemoteAddr();
    }
}
