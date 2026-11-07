package vacademy.io.admin_core_service.features.catalogue_resources.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsRateLimiter;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.ResourceDownloadRequest;
import vacademy.io.admin_core_service.features.catalogue_resources.service.CatalogueResourceDownloadService;

/**
 * Public beacon: a visitor opened a freebie on a catalogue site.
 *
 * Shares the analytics beacon's rate limiter (limits sized for a reader, not a
 * script) and, like it, always answers 204 — the response must not reveal
 * whether an email matched a lead.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/catalogue-resources")
public class PublicCatalogueResourceController {

    @Autowired
    private CatalogueResourceDownloadService service;

    @Autowired
    private CatalogueAnalyticsRateLimiter rateLimiter;

    @PostMapping("/download")
    public ResponseEntity<Void> download(@RequestBody ResourceDownloadRequest body,
                                         HttpServletRequest request) {
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
