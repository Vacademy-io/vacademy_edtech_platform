package vacademy.io.admin_core_service.features.engagement.report;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Engagement daily report for the Engagement Dashboard: one engine's day, or every engine's.
 * Institute admins only (EngagementAccessGuard), like every engagement surface. Credits are
 * shown to every admin; real money ({@code realCost}) only to platform super admins.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/reports")
@RequiredArgsConstructor
public class EngagementDailyReportController {

    private final EngagementDailyReportService reportService;
    private final EngagementAccessGuard accessGuard;

    /**
     * @param engineId omit for all engines
     * @param date     YYYY-MM-DD in the institute's time zone; omit for today there
     */
    @GetMapping("/daily")
    public ResponseEntity<EngagementDailyReport> daily(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "engineId", required = false) String engineId,
            @RequestParam(value = "date", required = false) String date) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new InvalidRequestException("instituteId is required");
        }
        try {
            accessGuard.requireAdmin(user, instituteId);
        } catch (VacademyException e) {
            // The shared guard answers 510 for every refusal; this endpoint is new, so it says 403.
            throw new ForbiddenException(e.getMessage());
        }
        boolean superAdmin = SuperAdminAuthUtil.isSuperAdminUserId(user.getUserId());
        return ResponseEntity.ok(reportService.daily(instituteId, engineId, date, superAdmin));
    }
}
