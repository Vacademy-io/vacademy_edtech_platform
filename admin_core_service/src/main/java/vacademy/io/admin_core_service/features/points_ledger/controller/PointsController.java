package vacademy.io.admin_core_service.features.points_ledger.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsHistoryDTO;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsOverviewDTO;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsSummaryDTO;
import vacademy.io.admin_core_service.features.points_ledger.job.PointsAccrualJob;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsOverviewService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/points")
@RequiredArgsConstructor
@Slf4j
public class PointsController {

    private final PointsLedgerService pointsLedgerService;
    private final PointsOverviewService pointsOverviewService;
    private final PointsAccrualJob pointsAccrualJob;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * The authenticated learner's own points summary.
     *
     * The user is ALWAYS taken from the JWT, never from a parameter, so a caller
     * cannot read another learner's points by changing an id.
     */
    @GetMapping("/v1/me/summary")
    public ResponseEntity<PointsSummaryDTO> mySummary(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(pointsLedgerService.getSummary(instituteId, user.getUserId()));
    }

    /**
     * Institute admin: run points accrual for this institute now, over the last
     * {@code days} days.
     *
     * The nightly job settles yesterday and holds today open, which makes "did this
     * work" unanswerable until tomorrow and leaves no way to backfill history. This
     * runs the same code on demand. Awards are idempotent on
     * '{SOURCE}:{local date}:{userId}', so calling it repeatedly — or with a wider
     * window than last time — adds each day's points exactly once.
     *
     * <p>Respects the same guards as the job: an institute with badges/leaderboard
     * switched off accrues nothing.
     */
    @PostMapping("/v1/accrual/run")
    public ResponseEntity<Map<String, Object>> runAccrual(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "30") int days,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireAdminAccess(user, instituteId);
        // Bounded so a stray call cannot ask for years of history in one request.
        int window = Math.max(1, Math.min(days, 365));
        int written = pointsAccrualJob.accrueForInstitute(instituteId, window);
        return ResponseEntity.ok(Map.of(
                "instituteId", instituteId,
                "days", window,
                "rowsWritten", written));
    }

    /**
     * Staff: one learner's points summary (student detail view).
     *
     * Requires staff membership of the institute — this reads ANOTHER learner's
     * totals by id, so without the check any authenticated user could walk other
     * people's points by changing the userId.
     */
    @GetMapping("/v1/learner/summary")
    public ResponseEntity<PointsSummaryDTO> learnerSummary(
            @RequestParam String instituteId,
            @RequestParam String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(pointsLedgerService.getSummary(instituteId, userId));
    }

    /** Staff: one learner's recent awards, points per week and active days (student detail view). */
    @GetMapping("/v1/learner/history")
    public ResponseEntity<PointsHistoryDTO> learnerHistory(
            @RequestParam String instituteId,
            @RequestParam String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(pointsLedgerService.getHistory(instituteId, userId));
    }

    /** Staff: points and badges earned across some batches, or every batch when none are passed. */
    @GetMapping("/v1/overview")
    public ResponseEntity<PointsOverviewDTO> overview(
            @RequestParam String instituteId,
            @RequestParam(required = false) List<String> packageSessionIds,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(pointsOverviewService.getOverview(instituteId, packageSessionIds, startDate, endDate));
    }
}
