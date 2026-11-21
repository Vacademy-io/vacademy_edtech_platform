package vacademy.io.admin_core_service.features.catalogue_analytics.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_analytics.dto.CatalogueAnalyticsResponse;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsQueryService;
import vacademy.io.common.auth.model.CustomUserDetails;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

/** Read side of catalogue analytics — the admin dashboard. */
@RestController
@RequestMapping("/admin-core-service/v1/catalogue-analytics")
public class CatalogueAnalyticsController {

    @Autowired
    private CatalogueAnalyticsQueryService queryService;

    /**
     * Summary for one institute over the last `days` days.
     *
     * instituteId is a request param rather than being taken from the token
     * because an admin can belong to several institutes and the editor already
     * knows which site is open — but it is checked against the caller's own
     * authorities, so it cannot be used to read another institute's traffic.
     */
    @GetMapping("/summary")
    public ResponseEntity<CatalogueAnalyticsResponse> summary(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "30") int days) {
        return ResponseEntity.ok(queryService.summary(user, instituteId, days));
    }
}
