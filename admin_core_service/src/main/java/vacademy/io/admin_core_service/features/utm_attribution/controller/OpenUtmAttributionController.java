package vacademy.io.admin_core_service.features.utm_attribution.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsRateLimiter;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmTrackRequest;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;

/**
 * Capture endpoint for campaign attribution, called by the learner app right
 * after a successful submission (audience form, live-session registration,
 * assessment registration, enrolment invite, catalogue lead).
 *
 * Unauthenticated by necessity — the person submitting a public form has no
 * token yet. Consequences, handled here:
 *  - rate limited per IP and per institute on its OWN counters, so telemetry
 *    can never spend the budget that real lead submissions need.
 *  - always answers 204. Whether a touch was recorded is not the caller's
 *    business, and a failure here must never surface as an error on a form the
 *    learner has already successfully submitted.
 *  - identity fields are accepted but only ever ATTACH a touch to a person; the
 *    service never creates or modifies a user from this payload.
 *
 * Lives under {@code /admin-core-service/open/**}, the established permitAll
 * prefix in ApplicationSecurityConfig.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/utm")
public class OpenUtmAttributionController {

    @Autowired
    private UtmAttributionService service;

    // NOT PublicLeadRateLimiter: that one's 8/minute is the budget for actual
    // LEAD submissions, and sharing it means a tagged campaign's telemetry can
    // 429 a real lead from the same IP (a school or cafe behind one NAT).
    // Losing an attribution row must never cost a lead. This limiter exists for
    // exactly this class of best-effort telemetry and keeps its own counters.
    @Autowired
    private CatalogueAnalyticsRateLimiter rateLimiter;

    @PostMapping("/track")
    public ResponseEntity<Void> track(@RequestBody UtmTrackRequest body, HttpServletRequest request) {
        if (body != null && rateLimiter.tryAcquire(clientIp(request), body.getInstituteId())) {
            service.record(body);
        }
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
