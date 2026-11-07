package vacademy.io.admin_core_service.features.live_session.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardDetails;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardRequest;
import vacademy.io.admin_core_service.features.live_session.dto.LiveClassDashboardResponse;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardDetailService;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassDashboardService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Admin Live Class Dashboard — one read-only call that returns the live /
 * upcoming / completed split, attendance, duration, engagement, feedback and
 * the instructor / batch / platform breakdowns for a date range.
 */
@RestController
@RequestMapping("/admin-core-service/live-session-report")
@RequiredArgsConstructor
public class LiveClassDashboardController {

    private final LiveClassDashboardService dashboardService;
    private final LiveClassDashboardDetailService detailService;

    @PostMapping("/dashboard")
    public ResponseEntity<LiveClassDashboardResponse> getDashboard(
            @RequestBody LiveClassDashboardRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(dashboardService.getDashboard(request));
    }

    /** One class's learners: who came, who was short of the rule, who never joined. */
    @PostMapping("/dashboard/class-learners")
    public ResponseEntity<LiveClassDashboardDetails.ClassLearnersResponse> getClassLearners(
            @RequestBody LiveClassDashboardRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.getClassLearners(request));
    }

    /** Learners who missed at least {@code min_missed} finished classes in the range. */
    @PostMapping("/dashboard/at-risk")
    public ResponseEntity<LiveClassDashboardDetails.AtRiskResponse> getAtRisk(
            @RequestBody LiveClassDashboardRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.getAtRisk(request));
    }

    /** Latest written feedback in the range, newest first. */
    @PostMapping("/dashboard/feedback-comments")
    public ResponseEntity<LiveClassDashboardDetails.FeedbackWallResponse> getFeedbackComments(
            @RequestBody LiveClassDashboardRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.getFeedbackWall(request));
    }
}
