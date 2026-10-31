package vacademy.io.admin_core_service.features.points_ledger.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsBreakdownItemDTO;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsSummaryDTO;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsLedger;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * The one way points are awarded anywhere in the platform.
 *
 * Points per level matches the learner app's existing constant (500) so the level a
 * learner already sees does not jump when the number moves server-side.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PointsLedgerService {

    /** Must stay in lock-step with XP_PER_LEVEL in the learner app's play-gamification.ts. */
    public static final int POINTS_PER_LEVEL = 500;

    private static final Map<String, String> SOURCE_LABELS = Map.of(
            PointsSourceType.ENGAGEMENT_ITEM.name(), "Daily engagement",
            PointsSourceType.ENGAGEMENT_STREAK.name(), "Streak bonus",
            PointsSourceType.ASSESSMENT.name(), "Assessments",
            PointsSourceType.ACTIVITY.name(), "Learning activity",
            PointsSourceType.MANUAL.name(), "Awarded by your institute");

    private final PointsLedgerRepository pointsLedgerRepository;
    private final InstituteTimezoneService instituteTimezoneService;

    /** Field-injected so the constructor stays (repository, timezone service); null in unit tests. */
    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Award points, at most once per idempotency key.
     *
     * Runs in its OWN transaction: a duplicate key is a normal, expected outcome
     * (double-tapped submit, retried request) and must not roll back the caller's
     * work — the attempt row that triggered the award still has to stand.
     *
     * @return the new row, or empty when these points were already awarded.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<PointsLedger> award(String userId, String instituteId, String packageSessionId,
                                        PointsSourceType sourceType, String sourceId,
                                        int points, String reason, String idempotencyKey) {
        return award(userId, instituteId, packageSessionId, sourceType, sourceId, points, reason,
                idempotencyKey, null);
    }

    /**
     * Same, with an explicit {@code awardedAt}.
     *
     * Backfilled points MUST carry the instant they were earned, not the instant the
     * backfill ran. Otherwise a learner's whole history lands inside "today", and one
     * backfill hands every learner a full history inside the current weekly
     * leaderboard window. Null means now.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<PointsLedger> award(String userId, String instituteId, String packageSessionId,
                                        PointsSourceType sourceType, String sourceId,
                                        int points, String reason, String idempotencyKey,
                                        Timestamp awardedAt) {
        if (userId == null || userId.isBlank() || instituteId == null || instituteId.isBlank()) {
            log.warn("[points] refusing award with missing user/institute (source={}, id={})", sourceType, sourceId);
            return Optional.empty();
        }
        if (points == 0) return Optional.empty();
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            log.warn("[points] refusing award with no idempotency key (user={}, source={})", userId, sourceType);
            return Optional.empty();
        }

        // Cheap pre-check; the unique index below is the real guarantee.
        if (pointsLedgerRepository.existsByIdempotencyKey(idempotencyKey)) {
            return Optional.empty();
        }

        PointsLedger row = new PointsLedger();
        row.setUserId(userId);
        row.setInstituteId(instituteId);
        row.setPackageSessionId(packageSessionId);
        row.setSourceType(sourceType.name());
        row.setSourceId(sourceId);
        row.setPoints(points);
        row.setReason(reason);
        row.setAwardedAt(awardedAt != null ? awardedAt : new Timestamp(System.currentTimeMillis()));
        row.setIdempotencyKey(idempotencyKey);

        try {
            return Optional.of(pointsLedgerRepository.saveAndFlush(row));
        } catch (DataIntegrityViolationException e) {
            // Concurrent duplicate — the other writer won. Correct outcome, not an error.
            log.debug("[points] duplicate award suppressed for key {}", idempotencyKey);
            return Optional.empty();
        }
    }

    /**
     * Reverse every award tied to a source row by writing compensating negative rows.
     * Used when an item is deleted or a score is corrected. The original rows stay —
     * the ledger is append-only and must remain auditable.
     *
     * @return how many reversal rows were written.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int reverse(PointsSourceType sourceType, String sourceId, String reason) {
        List<PointsLedger> originals =
                pointsLedgerRepository.findBySourceTypeAndSourceId(sourceType.name(), sourceId);
        int written = 0;
        for (PointsLedger original : originals) {
            if (original.getPoints() == null || original.getPoints() == 0) continue;
            // A reversal of a reversal is a no-op: the key collides and is suppressed.
            String key = "REVERSAL:" + original.getId();
            if (pointsLedgerRepository.existsByIdempotencyKey(key)) continue;

            PointsLedger reversal = new PointsLedger();
            reversal.setUserId(original.getUserId());
            reversal.setInstituteId(original.getInstituteId());
            reversal.setPackageSessionId(original.getPackageSessionId());
            reversal.setSourceType(original.getSourceType());
            reversal.setSourceId(original.getSourceId());
            reversal.setPoints(-original.getPoints());
            reversal.setReason(reason);
            reversal.setAwardedAt(new Timestamp(System.currentTimeMillis()));
            reversal.setIdempotencyKey(key);
            try {
                pointsLedgerRepository.saveAndFlush(reversal);
                written++;
            } catch (DataIntegrityViolationException e) {
                log.debug("[points] duplicate reversal suppressed for {}", original.getId());
            }
        }
        return written;
    }

    /**
     * The learner's own points state: total, windows, level, per-source breakdown and
     * the streak.
     *
     * <p>Deliberately NOT one read-only transaction. The streak reads other features'
     * tables by native SQL, and a failed statement inside a JPA transaction marks it
     * rollback-only, which would turn a cosmetic streak failure into a failed summary.
     * Each repository call runs in its own read transaction instead, and the streak
     * degrades to null on any error.
     *
     * <p>When the caller already holds a transaction (the engagement submit calls this
     * for the new total), the streak is skipped and left null: a failed native statement
     * would abort the caller's Postgres transaction and lose the learner's submission,
     * and that caller only reads totalPoints anyway.
     */
    public PointsSummaryDTO getSummary(String instituteId, String userId) {
        long total = pointsLedgerRepository.sumForUser(instituteId, userId);

        ZoneId zone = instituteTimezoneService.getZone(instituteId);
        LocalDate today = LocalDate.now(zone);
        Timestamp startOfToday = toTimestamp(today, zone);
        Timestamp startOfWeek = toTimestamp(today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), zone);

        long todayPoints = pointsLedgerRepository.sumForUserSince(instituteId, userId, startOfToday);
        long weekPoints = pointsLedgerRepository.sumForUserSince(instituteId, userId, startOfWeek);

        List<PointsBreakdownItemDTO> breakdown = new ArrayList<>();
        for (Object[] row : pointsLedgerRepository.breakdownForUser(instituteId, userId)) {
            String key = String.valueOf(row[0]);
            long points = row[1] == null ? 0L : ((Number) row[1]).longValue();
            if (points == 0) continue;
            breakdown.add(new PointsBreakdownItemDTO(key, SOURCE_LABELS.getOrDefault(key, key), points));
        }
        breakdown.sort((a, b) -> Long.compare(b.getPoints(), a.getPoints()));

        // Negative totals are possible in theory (reversals) — clamp so level maths stays sane.
        long safeTotal = Math.max(0, total);
        int level = (int) (safeTotal / POINTS_PER_LEVEL) + 1;
        int pointsToNextLevel = (int) (POINTS_PER_LEVEL - (safeTotal % POINTS_PER_LEVEL));

        PointsSummaryDTO dto = new PointsSummaryDTO(total, weekPoints, todayPoints, level, pointsToNextLevel, breakdown);
        dto.setToday(today.toString());
        dto.setTimezone(zone.getId());
        Set<LocalDate> activeDays = TransactionSynchronizationManager.isActualTransactionActive()
                ? null
                : loadActiveDays(instituteId, userId, zone, today);
        if (activeDays != null) {
            StreakState streak = computeStreak(activeDays, today);
            dto.setCurrentStreak(streak.currentStreak());
            dto.setLongestStreak(streak.longestStreak());
            dto.setKeptToday(streak.keptToday());
            dto.setLast7Days(streak.last7Days());
        }
        return dto;
    }

    // ── Streak ───────────────────────────────────────────────────────────────

    /** How far back the streak looks; longestStreak is "longest in the last year". */
    public static final int STREAK_LOOKBACK_DAYS = 366;

    /**
     * Ledger sources that prove the learner did something that day. ENGAGEMENT_STREAK is
     * derived from the streak itself and MANUAL is granted by staff, so neither counts.
     */
    static final List<String> STREAK_LEDGER_SOURCES = List.of(
            PointsSourceType.ENGAGEMENT_ITEM.name(),
            PointsSourceType.ASSESSMENT.name(),
            PointsSourceType.ACTIVITY.name());

    /** The streak as every learner surface shows it. */
    public record StreakState(int currentStreak, int longestStreak, boolean keptToday,
                              List<PointsSummaryDTO.StreakDay> last7Days) {}

    /**
     * Pure streak arithmetic over a set of institute-local active days.
     *
     * <p>currentStreak counts back from today when today is active, else from yesterday
     * (a streak is not broken until the day is over). longestStreak is the longest run
     * of consecutive days in the set, and is never below currentStreak. Days after
     * {@code today} are ignored.
     */
    public static StreakState computeStreak(Collection<LocalDate> activeDays, LocalDate today) {
        TreeSet<LocalDate> days = new TreeSet<>();
        if (activeDays != null) {
            for (LocalDate d : activeDays) if (d != null && !d.isAfter(today)) days.add(d);
        }
        boolean keptToday = days.contains(today);

        int current = 0;
        LocalDate cursor = keptToday ? today : today.minusDays(1);
        while (days.contains(cursor)) {
            current++;
            cursor = cursor.minusDays(1);
        }

        int longest = 0;
        int run = 0;
        LocalDate previous = null;
        for (LocalDate d : days) {
            run = (previous != null && previous.plusDays(1).equals(d)) ? run + 1 : 1;
            longest = Math.max(longest, run);
            previous = d;
        }
        longest = Math.max(longest, current);

        List<PointsSummaryDTO.StreakDay> last7 = new ArrayList<>(7);
        for (int i = 6; i >= 0; i--) {
            LocalDate d = today.minusDays(i);
            last7.add(new PointsSummaryDTO.StreakDay(d.toString(), days.contains(d)));
        }
        return new StreakState(current, longest, keptToday, last7);
    }

    /**
     * The learner's active days in the institute's zone over the look-back window: the
     * union of learning-activity days (the activity log, same measure as ACTIVITY points
     * and the learner hero), completed engagement tasks, earning ledger rows and live
     * classes the learner was marked PRESENT in.
     *
     * <p>Each source is read on its own so one failing source only narrows the union.
     * Returns null when every source failed, so the caller leaves the streak unset
     * rather than reporting a false 0. Overridable for tests.
     */
    protected Set<LocalDate> loadActiveDays(String instituteId, String userId, ZoneId zone, LocalDate today) {
        if (entityManager == null || userId == null || instituteId == null) return null;
        Timestamp from = toTimestamp(today.minusDays(STREAK_LOOKBACK_DAYS), zone);
        Timestamp to = toTimestamp(today.plusDays(1), zone);
        String zoneId = zone.getId();
        Set<LocalDate> days = new HashSet<>();
        int failures = 0;

        // Stored timestamps are UTC wall time (the JVM runs in UTC), hence the double AT TIME ZONE.
        try {
            days.addAll(toDates(entityManager.createNativeQuery("""
                    SELECT t.d FROM (
                        SELECT DATE(al.created_at AT TIME ZONE 'UTC' AT TIME ZONE :zone) AS d,
                               COALESCE(
                                   al.engaged_ms,
                                   CASE
                                       WHEN al.end_time IS NOT NULL AND al.start_time IS NOT NULL
                                           THEN EXTRACT(EPOCH FROM (al.end_time - al.start_time)) * 1000
                                       ELSE 0
                                   END
                               ) AS ms
                        FROM activity_log al
                        WHERE al.user_id = :userId
                          AND al.created_at >= :from
                          AND al.created_at < :to
                    ) t
                    GROUP BY t.d
                    HAVING SUM(t.ms) > 0
                    """)
                    .setParameter("zone", zoneId)
                    .setParameter("userId", userId)
                    .setParameter("from", from)
                    .setParameter("to", to)
                    .getResultList()));
        } catch (Exception e) {
            failures++;
            log.warn("[points] streak: activity days unavailable for user {}: {}", userId, e.getMessage());
        }

        try {
            days.addAll(toDates(entityManager.createNativeQuery("""
                    SELECT DISTINCT DATE(a.completed_at AT TIME ZONE 'UTC' AT TIME ZONE :zone)
                    FROM engagement_attempt a
                    WHERE a.user_id = :userId
                      AND a.institute_id = :instituteId
                      AND a.status = 'COMPLETED'
                      AND a.completed_at >= :from
                      AND a.completed_at < :to
                    """)
                    .setParameter("zone", zoneId)
                    .setParameter("userId", userId)
                    .setParameter("instituteId", instituteId)
                    .setParameter("from", from)
                    .setParameter("to", to)
                    .getResultList()));
        } catch (Exception e) {
            failures++;
            log.warn("[points] streak: engagement days unavailable for user {}: {}", userId, e.getMessage());
        }

        try {
            days.addAll(toDates(entityManager.createNativeQuery("""
                    SELECT DISTINCT DATE(p.awarded_at AT TIME ZONE 'UTC' AT TIME ZONE :zone)
                    FROM points_ledger p
                    WHERE p.institute_id = :instituteId
                      AND p.user_id = :userId
                      AND p.points > 0
                      AND p.source_type IN (:sources)
                      AND p.awarded_at >= :from
                      AND p.awarded_at < :to
                    """)
                    .setParameter("zone", zoneId)
                    .setParameter("userId", userId)
                    .setParameter("instituteId", instituteId)
                    .setParameter("sources", STREAK_LEDGER_SOURCES)
                    .setParameter("from", from)
                    .setParameter("to", to)
                    .getResultList()));
        } catch (Exception e) {
            failures++;
            log.warn("[points] streak: ledger days unavailable for user {}: {}", userId, e.getMessage());
        }

        // Live classes attended. Keyed on the class's own meeting_date: provider attendance
        // can be written many hours after the class, and that must not shift the day.
        try {
            days.addAll(toDates(entityManager.createNativeQuery("""
                    SELECT DISTINCT ss.meeting_date
                    FROM live_session_logs lsl
                    JOIN live_session ls ON ls.id = lsl.session_id
                    JOIN session_schedules ss ON ss.id = lsl.schedule_id
                    WHERE lsl.user_source_id = :userId
                      AND lsl.user_source_type = 'USER'
                      AND lsl.log_type = 'ATTENDANCE_RECORDED'
                      AND lsl.status = 'PRESENT'
                      AND ls.institute_id = :instituteId
                      AND ss.meeting_date BETWEEN :fromDate AND :toDate
                      AND ls.status IS DISTINCT FROM 'DELETED'
                      AND ss.status IS DISTINCT FROM 'DELETED'
                    """)
                    .setParameter("userId", userId)
                    .setParameter("instituteId", instituteId)
                    .setParameter("fromDate", today.minusDays(STREAK_LOOKBACK_DAYS))
                    .setParameter("toDate", today)
                    .getResultList()));
        } catch (Exception e) {
            failures++;
            log.warn("[points] streak: live attendance days unavailable for user {}: {}", userId, e.getMessage());
        }

        return failures == 4 ? null : days;
    }

    private static List<LocalDate> toDates(List<?> rows) {
        List<LocalDate> out = new ArrayList<>();
        for (Object row : rows) {
            Object value = row instanceof Object[] cols ? (cols.length == 0 ? null : cols[0]) : row;
            if (value instanceof java.sql.Date d) out.add(d.toLocalDate());
            else if (value instanceof LocalDate d) out.add(d);
            else if (value instanceof java.util.Date d) out.add(new java.sql.Date(d.getTime()).toLocalDate());
            else if (value != null) {
                try {
                    out.add(LocalDate.parse(value.toString().substring(0, 10)));
                } catch (Exception ignored) {
                    // an unreadable day is skipped, never fatal
                }
            }
        }
        return out;
    }

    /** Start-of-day in the institute's zone, as a UTC-based SQL timestamp. */
    private Timestamp toTimestamp(LocalDate localDate, ZoneId zone) {
        return Timestamp.from(localDate.atStartOfDay(zone).toInstant());
    }
}
