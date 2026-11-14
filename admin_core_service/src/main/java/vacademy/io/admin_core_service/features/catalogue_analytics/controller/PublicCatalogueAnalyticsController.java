package vacademy.io.admin_core_service.features.catalogue_analytics.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_analytics.dto.CatalogueEventRequest;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsRateLimiter;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsService;

/**
 * Public analytics beacon for catalogue sites. Unauthenticated by necessity —
 * it is called from a visitor's browser on a public marketing page.
 *
 * Consequences of that, handled here:
 *  - rate limited per IP and per institute (its own limiter; the lead limiter's
 *    8/minute would throttle a reader browsing a few pages)
 *  - always answers 204, even when rejected. A beacon must not leak whether a
 *    limit was hit, and sendBeacon ignores the body anyway.
 *  - identity is derived server-side, never accepted from the caller.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/catalogue-analytics")
public class PublicCatalogueAnalyticsController {

    @Autowired
    private CatalogueAnalyticsService service;

    @Autowired
    private CatalogueAnalyticsRateLimiter rateLimiter;

    @PostMapping("/event")
    public ResponseEntity<Void> record(@RequestBody CatalogueEventRequest body,
                                       HttpServletRequest request) {
        String ip = clientIp(request);
        if (body != null && rateLimiter.tryAcquire(ip, body.getInstituteId())) {
            service.record(body, ip, request.getHeader("User-Agent"));
        }
        // 204 regardless: never tell a caller whether it was counted.
        return new ResponseEntity<>(HttpStatus.NO_CONTENT);
    }

    /** Real client IP behind the ingress/CDN — XFF is a chain, take the first. */
    private String clientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            return (comma > 0 ? xff.substring(0, comma) : xff).trim();
        }
        String real = request.getHeader("X-Real-IP");
        return (real != null && !real.isBlank()) ? real.trim() : request.getRemoteAddr();
    }
}
