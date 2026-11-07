package vacademy.io.admin_core_service.features.points_ledger.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.points_ledger.dto.DailyActivityProjection;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.ScoringConfigService;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns learning activity into points_ledger rows.
 *
 * Without this, the ledger only ever holds daily-engagement points, so switching a
 * leaderboard to POINTS would rank every learner at 0 and lose the signal the
 * minutes ranking already carries. Running this makes POINTS a SUPERSET of the
 * legacy ranking rather than a replacement for it.
 *
 * <p>Re-running is free and safe: every award carries an idempotency key of
 * '{SOURCE}:{local date}:{userId}', so a day can be processed any number of times
 * and awards exactly once. That is also what makes backfilling history just a matter
 * of widening the lookback.
 *
 * <p>Runs nightly, and deliberately reprocesses a few days rather than only
 * yesterday: a learner's activity can arrive late, and the idempotency key makes
 * revisiting a settled day a no-op.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class PointsAccrualJob {

    private static final List<String> ACTIVE_STATUSES = List.of("ACTIVE");

    /** How many days back each run reconsiders. Cheap, because awards are idempotent. */
    private static final int LOOKBACK_DAYS = 3;

    /** Streaks are computed over this window, matching the learner app's 30-day view. */
    private static final int STREAK_WINDOW_DAYS = 30;

    private final InstituteRepository instituteRepository;
    private final InstituteTimezoneService instituteTimezoneService;
    private final ActivityLogRepository activityLogRepository;
    private final ScoringConfigService scoringConfigService;
    private final PointsLedgerService pointsLedgerService;
    private final LiveSessionLogsRepository liveSessionLogsRepository;

    /**
     * Off unless explicitly enabled. The first run writes points for every active
     * learner in every institute, which changes what learners see — that should be a
     * deliberate switch, not a side effect of a deploy.
     */
    @Value("${vacademy.points.accrual.enabled:false}")
    private boolean enabled;

    /** 00:30 daily. Past midnight in most Indian-hours institutes, before any morning traffic. */
    @Scheduled(cron = "0 30 0 * * ?")
    @SchedulerLock(name = "PointsAccrualTick", lockAtMostFor = "PT55M", lockAtLeastFor = "PT1M")
    public void tick() {
        if (!enabled) {
            log.debug("[points-accrual] disabled (vacademy.points.accrual.enabled=false)");
            return;
        }
        List<String> instituteIds = new ArrayList<>();
        try {
            // findAll() returns Iterable here, not List — this repository does not
            // extend the ListCrudRepository variant.
            for (Institute institute : instituteRepository.findAll()) {
                if (institute.getId() != null) instituteIds.add(institute.getId());
            }
        } catch (Exception e) {
            log.error("[points-accrual] could not list institutes — tick aborted", e);
            return;
        }

        for (String instituteId : instituteIds) {
            try {
                accrueForInstitute(instituteId, LOOKBACK_DAYS);
            } catch (Exception e) {
                // One institute's bad data must not stop every other institute's points.
                log.error("[points-accrual] institute {} failed", instituteId, e);
            }
        }
    }

    /**
     * Award ACTIVITY and streak points for one institute over the last {@code days}.
     * Public so a backfill can call it with a wide window.
     *
     * @return how many ledger rows were written.
     */
    public int accrueForInstitute(String instituteId, int days) {
        // An institute that has not switched badges/leaderboard on has not opted into
        // a points economy at all; writing rows for it would surface numbers nobody asked for.
        if (!scoringConfigService.isEnabled(instituteId)) return 0;

        int activityPoints = scoringConfigService.getActivityPerDay(instituteId);
        int streakPoints = scoringConfigService.getStreakPerDay(instituteId);
        if (activityPoints <= 0 && streakPoints <= 0) return 0;

        ZoneId zone = instituteTimezoneService.getZone(instituteId);
        String zoneId = zone.getId();
        LocalDate today = LocalDate.now(zone);
        // Widen the read to cover the streak window; only the lookback days are awarded.
        LocalDate readFrom = today.minusDays(Math.max(days, STREAK_WINDOW_DAYS));
        LocalDate awardFrom = today.minusDays(days);

        List<DailyActivityProjection> rows = activityLogRepository.findDailyActivityForInstitute(
                instituteId,
                zoneId,
                Timestamp.from(readFrom.atStartOfDay(zone).toInstant()),
                Timestamp.from(today.plusDays(1).atStartOfDay(zone).toInstant()),
                ACTIVE_STATUSES);

        // ACTIVITY points are earned on activity-log days only; the streak also counts
        // days the learner attended a live class, matching the streak learners see.
        Map<String, Set<LocalDate>> activityDaysByUser = new HashMap<>();
        Map<String, Set<LocalDate>> streakDaysByUser = new HashMap<>();
        if (rows != null) {
            for (DailyActivityProjection row : rows) {
                if (row.getUserId() == null || row.getActivityDate() == null) continue;
                LocalDate day = row.getActivityDate().toLocalDate();
                activityDaysByUser.computeIfAbsent(row.getUserId(), k -> new HashSet<>()).add(day);
                streakDaysByUser.computeIfAbsent(row.getUserId(), k -> new HashSet<>()).add(day);
            }
        }
        if (streakPoints > 0) {
            try {
                for (LiveSessionLogsRepository.PresentDayProjection row
                        : liveSessionLogsRepository.findPresentDaysForInstitute(instituteId, readFrom, today, ACTIVE_STATUSES)) {
                    if (row.getUserId() == null || row.getActivityDate() == null) continue;
                    streakDaysByUser.computeIfAbsent(row.getUserId(), k -> new HashSet<>())
                            .add(row.getActivityDate().toLocalDate());
                }
            } catch (Exception e) {
                // Attendance only lengthens streaks; without it the activity awards still stand.
                log.warn("[points-accrual] institute {}: live attendance days unavailable: {}",
                        instituteId, e.getMessage());
            }
        }
        if (streakDaysByUser.isEmpty()) return 0;

        int written = 0;
        for (Map.Entry<String, Set<LocalDate>> entry : streakDaysByUser.entrySet()) {
            String userId = entry.getKey();
            Set<LocalDate> activeDays = entry.getValue();
            Set<LocalDate> activityDays = activityDaysByUser.getOrDefault(userId, Set.of());

            for (LocalDate day : sorted(activeDays)) {
                // Stamp the award with the END of the day it was earned, in the
                // institute's zone — not with "now". A 30-day backfill otherwise lands
                // every point inside today and inside this week's leaderboard.
                Timestamp earnedAt = Timestamp.from(day.plusDays(1).atStartOfDay(zone).minusSeconds(1).toInstant());
                // Today is still in progress; awarding it now would settle a day that
                // can still gain activity. It is picked up by tomorrow's run.
                if (!day.isBefore(today) || day.isBefore(awardFrom)) continue;

                if (activityPoints > 0 && activityDays.contains(day)) {
                    written += pointsLedgerService.award(
                            userId, instituteId, null,
                            PointsSourceType.ACTIVITY, null,
                            activityPoints, "Active on " + day,
                            "ACTIVITY:" + day + ":" + userId, earnedAt).isPresent() ? 1 : 0;
                }

                if (streakPoints > 0) {
                    int streak = streakLengthEndingOn(activeDays, day);
                    // The bonus scales with the streak, matching the learner app's
                    // "points per day of the current streak" wording.
                    int bonus = streakPoints * Math.max(0, streak - 1);
                    if (bonus > 0) {
                        written += pointsLedgerService.award(
                                userId, instituteId, null,
                                PointsSourceType.ENGAGEMENT_STREAK, null,
                                bonus, streak + "-day streak",
                                "ENGAGEMENT_STREAK:" + day + ":" + userId, earnedAt).isPresent() ? 1 : 0;
                    }
                }
            }
        }

        if (written > 0) {
            log.info("[points-accrual] institute {}: wrote {} ledger rows", instituteId, written);
        }
        return written;
    }

    /** Consecutive active days ending on {@code day}, counting backwards. Package-private for testing. */
    int streakLengthEndingOn(Set<LocalDate> activeDays, LocalDate day) {
        int streak = 0;
        LocalDate cursor = day;
        // Bounded by the window that was actually read, so a longer real streak is
        // simply reported as the window length rather than walking forever.
        while (streak < STREAK_WINDOW_DAYS && activeDays.contains(cursor)) {
            streak++;
            cursor = cursor.minusDays(1);
        }
        return streak;
    }

    private List<LocalDate> sorted(Set<LocalDate> days) {
        List<LocalDate> list = new ArrayList<>(days);
        list.sort(LocalDate::compareTo);
        return list;
    }
}
