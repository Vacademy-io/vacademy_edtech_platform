package vacademy.io.admin_core_service.features.app_status.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.app_status.dto.AppStatusResponse;
import vacademy.io.admin_core_service.features.app_status.service.AppStatusService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Institute-admin-facing, read-only view of an institute's registered white-label apps.
 *
 * Deliberately NOT under /admin/* (same reasoning as WhiteLabelController) so the institute
 * admin dashboard can call it without an elevated super-admin role — the service layer verifies
 * the caller actually belongs to the instituteId being queried.
 *
 * Registration/editing stays exclusive to the health-check dashboard's App Registration module
 * (SuperAdmin-only, in community_service) — this endpoint has no write path on purpose.
 */
@RestController
@RequestMapping("/admin-core-service/institute/app-registry/v1")
@RequiredArgsConstructor
public class AppStatusController {

    private final AppStatusService appStatusService;

    @GetMapping("/status")
    public ResponseEntity<AppStatusResponse> getStatus(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {

        return ResponseEntity.ok(appStatusService.getStatus(user, instituteId));
    }
}
