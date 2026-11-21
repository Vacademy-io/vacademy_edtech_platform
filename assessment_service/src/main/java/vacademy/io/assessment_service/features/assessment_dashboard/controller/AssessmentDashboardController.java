package vacademy.io.assessment_service.features.assessment_dashboard.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardRequest;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

/**
 * Admin Assessment Dashboard — one read-only call for a date range: what is live now,
 * participation, scores, evaluation backlog, and the batch / type / learner breakdowns.
 */
@RestController
@RequestMapping("/assessment-service/assessment/admin/dashboard")
@RequiredArgsConstructor
public class AssessmentDashboardController {

    private final AssessmentDashboardService dashboardService;

    @PostMapping("/insights")
    public ResponseEntity<AssessmentDashboardResponse> getInsights(
            @RequestBody AssessmentDashboardRequest request,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestAttribute("user") CustomUserDetails user) {
        requireInstituteMember(user, clientId, request == null ? null : request.getInstituteId());
        return ResponseEntity.ok(dashboardService.getDashboard(request));
    }

    /**
     * The JWT filter resolves the caller's roles for the {@code clientId} institute, so a
     * caller with no role there, or asking about a different institute than the one they
     * authenticated against, is refused rather than shown another institute's learners.
     */
    private static void requireInstituteMember(CustomUserDetails user, String clientId, String instituteId) {
        if (user == null || user.getAuthorities() == null || user.getAuthorities().isEmpty()) {
            throw new ForbiddenException("You do not have a role in this institute");
        }
        if (clientId != null && !clientId.isBlank() && instituteId != null && !clientId.equals(instituteId)) {
            throw new ForbiddenException("You do not have access to this institute");
        }
    }
}
