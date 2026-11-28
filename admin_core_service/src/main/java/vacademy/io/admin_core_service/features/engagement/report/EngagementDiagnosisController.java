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
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Engagement diagnosis for the Engagement Dashboard: what is clearly broken in the lead-to-demo chain
 * (DAILY, short) and comparisons of what works (WEEKLY, detailed). Institute admins only, as the
 * daily report. No AI runs for this: rules read the numbers.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/reports")
@RequiredArgsConstructor
public class EngagementDiagnosisController {

    private final EngagementDiagnosisService diagnosisService;
    private final EngagementAccessGuard accessGuard;

    /**
     * @param engineId omit for all engines
     * @param view     DAILY (default) or WEEKLY
     * @param to       the last day, YYYY-MM-DD in the institute's time zone; omit for today there. 400
     *                 for a bad format, a future day, or a day of the period before today − 89
     * @param fresh    skip the cached copy
     */
    @GetMapping("/diagnosis")
    public ResponseEntity<EngagementDiagnosis> diagnosis(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "engineId", required = false) String engineId,
            @RequestParam(value = "view", required = false) String view,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "fresh", required = false, defaultValue = "false") boolean fresh) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new InvalidRequestException("instituteId is required");
        }
        try {
            accessGuard.requireAdmin(user, instituteId);
        } catch (VacademyException e) {
            // The shared guard answers 510 for every refusal; this endpoint is new, so it says 403.
            throw new ForbiddenException(e.getMessage());
        }
        return ResponseEntity.ok(diagnosisService.diagnosis(instituteId, engineId, view, to, fresh));
    }
}
