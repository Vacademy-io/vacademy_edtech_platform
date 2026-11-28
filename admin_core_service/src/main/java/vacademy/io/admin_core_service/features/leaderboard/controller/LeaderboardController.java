package vacademy.io.admin_core_service.features.leaderboard.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.leaderboard.dto.BadgeStatsResponseDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardResponseDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LearnerSummaryDTO;
import vacademy.io.admin_core_service.features.leaderboard.service.LeaderboardService;
import vacademy.io.admin_core_service.features.leaderboard.service.LeaderboardService.Metric;
import vacademy.io.admin_core_service.features.leaderboard.service.LeaderboardService.Window;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/leaderboard/v1")
@RequiredArgsConstructor
public class LeaderboardController {

    private final LeaderboardService leaderboardService;

    /**
     * Ranking metric, defaulting to the legacy ACTIVITY (focused minutes) so existing
     * callers are untouched. POINTS reads points_ledger — the only mode that can
     * reflect daily-engagement scores.
     */
    private Metric metric(String raw) {
        try {
            return raw == null || raw.isBlank() ? Metric.ACTIVITY : Metric.valueOf(raw.toUpperCase());
        } catch (Exception e) {
            return Metric.ACTIVITY;
        }
    }

    private Window window(String raw) {
        try {
            return raw == null || raw.isBlank() ? Window.ALL : Window.valueOf(raw.toUpperCase());
        } catch (Exception e) {
            return Window.ALL;
        }
    }

    /**
     * Learner-facing course leaderboard: the caller's own row marked "You". Peers are
     * anonymized to initials unless the institute opted into full names (same toggle as
     * the public page).
     */
    @GetMapping("/course/me")
    public ResponseEntity<LeaderboardResponseDTO> getCourseLeaderboardForLearner(
            @RequestParam String packageSessionId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String metric,
            @RequestParam(required = false) String window,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean anonymize = !leaderboardService.showFullNames(instituteId);
        return ResponseEntity.ok(leaderboardService.buildCourseLeaderboard(
                packageSessionId, instituteId, user.getUserId(), anonymize, 50, user,
                metric(metric), window(window)));
    }

    /** Admin course leaderboard: real names, full list. */
    @GetMapping("/course/admin")
    public ResponseEntity<LeaderboardResponseDTO> getCourseLeaderboardForAdmin(
            @RequestParam String packageSessionId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String metric,
            @RequestParam(required = false) String window,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leaderboardService.buildCourseLeaderboard(
                packageSessionId, instituteId, null, false, 200, user,
                metric(metric), window(window)));
    }

    /** Learner-facing institute-wide leaderboard: own row marked "You", peers per the full-names toggle. */
    @GetMapping("/institute/me")
    public ResponseEntity<LeaderboardResponseDTO> getInstituteLeaderboardForLearner(
            @RequestParam String instituteId,
            @RequestParam(required = false) String metric,
            @RequestParam(required = false) String window,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean anonymize = !leaderboardService.showFullNames(instituteId);
        return ResponseEntity.ok(leaderboardService.buildInstituteLeaderboard(
                instituteId, user.getUserId(), anonymize, 50, metric(metric), window(window)));
    }

    /** Admin institute-wide leaderboard: real names, full list across all courses. */
    @GetMapping("/institute/admin")
    public ResponseEntity<LeaderboardResponseDTO> getInstituteLeaderboardForAdmin(
            @RequestParam String instituteId,
            @RequestParam(required = false) String metric,
            @RequestParam(required = false) String window,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leaderboardService.buildInstituteLeaderboard(
                instituteId, null, false, 200, metric(metric), window(window)));
    }

    /** The learner's own profile summary: total badges, badge list, and best course rank. */
    @GetMapping("/my-summary")
    public ResponseEntity<LearnerSummaryDTO> getMySummary(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leaderboardService.buildLearnerSummary(instituteId, user.getUserId(), user));
    }

    /** Institute-wide badge award stats for the admin badges overview. */
    @GetMapping("/badge-stats")
    public ResponseEntity<BadgeStatsResponseDTO> getBadgeStats(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leaderboardService.buildBadgeStats(instituteId));
    }
}
