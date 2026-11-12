package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.audience.service.MetaAdAttributionBackfillService;

/**
 * Service-to-service only (InternalAuthFilter: clientName + Signature headers). Fills the ad
 * columns on an institute's older Meta leads; dry run unless {@code dryRun=false}.
 */
@RestController
@RequestMapping("/admin-core-service/internal/meta-ad-attribution/v1")
@RequiredArgsConstructor
public class MetaAdAttributionBackfillInternalController {

    private final MetaAdAttributionBackfillService service;

    @PostMapping("/backfill")
    public ResponseEntity<MetaAdAttributionBackfillService.Result> backfill(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "days", required = false) Integer days,
            @RequestParam(value = "dryRun", defaultValue = "true") boolean dryRun) {
        return ResponseEntity.ok(service.backfill(instituteId, days, dryRun));
    }
}
