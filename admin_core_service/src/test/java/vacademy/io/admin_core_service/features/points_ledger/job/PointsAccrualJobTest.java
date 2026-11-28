package vacademy.io.admin_core_service.features.points_ledger.job;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.points_ledger.dto.DailyActivityProjection;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsLedger;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.ScoringConfigService;

import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Streak length decides the size of a points award, so an off-by-one here is real
 * money to a learner. Pure set maths — no Spring, no DB.
 */
class PointsAccrualJobTest {

    private final PointsAccrualJob job = new PointsAccrualJob(null, null, null, null, null, null);

    private static final LocalDate D1 = LocalDate.of(2026, 9, 10);
    private static final LocalDate D2 = LocalDate.of(2026, 9, 11);
    private static final LocalDate D3 = LocalDate.of(2026, 9, 12);
    private static final LocalDate D4 = LocalDate.of(2026, 9, 13);

    @Test
    @DisplayName("a single active day is a streak of one")
    void singleDay() {
        assertEquals(1, job.streakLengthEndingOn(Set.of(D4), D4));
    }

    @Test
    @DisplayName("consecutive days accumulate")
    void consecutive() {
        assertEquals(4, job.streakLengthEndingOn(Set.of(D1, D2, D3, D4), D4));
    }

    @Test
    @DisplayName("a gap breaks the streak — only the run ending on the day counts")
    void gapBreaksIt() {
        // D1 active, D2 missed, D3 and D4 active -> streak ending D4 is 2, not 3.
        assertEquals(2, job.streakLengthEndingOn(Set.of(D1, D3, D4), D4));
    }

    @Test
    @DisplayName("a day with no activity has no streak")
    void inactiveDay() {
        assertEquals(0, job.streakLengthEndingOn(Set.of(D1, D2), D4));
    }

    @Test
    @DisplayName("the streak is measured to the day asked about, not to the latest day")
    void measuredToTheGivenDay() {
        // Asking about D2 must ignore D3/D4 entirely.
        assertEquals(2, job.streakLengthEndingOn(Set.of(D1, D2, D3, D4), D2));
    }

    @Test
    @DisplayName("an empty history yields zero rather than throwing")
    void emptyHistory() {
        assertEquals(0, job.streakLengthEndingOn(Set.of(), D4));
    }

    // ── Live-class attendance ────────────────────────────────────────────────

    private static final ZoneId UTC = ZoneId.of("UTC");

    private static DailyActivityProjection activity(String userId, LocalDate day) {
        return new DailyActivityProjection() {
            public String getUserId() { return userId; }
            public Date getActivityDate() { return Date.valueOf(day); }
            public Long getMillis() { return 60_000L; }
        };
    }

    private static LiveSessionLogsRepository.PresentDayProjection present(String userId, LocalDate day) {
        return new LiveSessionLogsRepository.PresentDayProjection() {
            public String getUserId() { return userId; }
            public Date getActivityDate() { return Date.valueOf(day); }
        };
    }

    private record Fixture(PointsAccrualJob job, PointsLedgerService ledger,
                           LiveSessionLogsRepository attendance, ActivityLogRepository activity) {}

    private static Fixture fixture(int activityPerDay, int streakPerDay) {
        ScoringConfigService scoring = mock(ScoringConfigService.class);
        when(scoring.isEnabled("inst")).thenReturn(true);
        when(scoring.getActivityPerDay("inst")).thenReturn(activityPerDay);
        when(scoring.getStreakPerDay("inst")).thenReturn(streakPerDay);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone("inst")).thenReturn(UTC);
        ActivityLogRepository activity = mock(ActivityLogRepository.class);
        LiveSessionLogsRepository attendance = mock(LiveSessionLogsRepository.class);
        PointsLedgerService ledger = mock(PointsLedgerService.class);
        when(ledger.award(anyString(), anyString(), any(), any(), any(), anyInt(), anyString(), anyString(), any()))
                .thenReturn(Optional.of(new PointsLedger()));
        return new Fixture(new PointsAccrualJob(null, tz, activity, scoring, ledger, attendance),
                ledger, attendance, activity);
    }

    @Test
    @DisplayName("a live class attended extends the streak bonus but earns no ACTIVITY points")
    void attendanceExtendsStreak() {
        LocalDate today = LocalDate.now(UTC);
        LocalDate twoDaysAgo = today.minusDays(2);
        LocalDate yesterday = today.minusDays(1);
        Fixture f = fixture(10, 5);
        when(f.activity().findDailyActivityForInstitute(eq("inst"), any(), any(), any(), any()))
                .thenReturn(List.of(activity("u", twoDaysAgo)));
        when(f.attendance().findPresentDaysForInstitute(eq("inst"), any(), any(), any()))
                .thenReturn(List.of(present("u", yesterday)));

        f.job().accrueForInstitute("inst", 3);

        verify(f.ledger()).award(eq("u"), eq("inst"), isNull(), eq(PointsSourceType.ACTIVITY), isNull(),
                eq(10), anyString(), eq("ACTIVITY:" + twoDaysAgo + ":u"), any());
        verify(f.ledger(), never()).award(anyString(), anyString(), any(), eq(PointsSourceType.ACTIVITY), any(),
                anyInt(), anyString(), eq("ACTIVITY:" + yesterday + ":u"), any());
        // Yesterday is day 2 of the streak: 5 x (2 - 1).
        verify(f.ledger()).award(eq("u"), eq("inst"), isNull(), eq(PointsSourceType.ENGAGEMENT_STREAK), isNull(),
                eq(5), anyString(), eq("ENGAGEMENT_STREAK:" + yesterday + ":u"), any());
    }

    @Test
    @DisplayName("a learner with only live classes still gets streak bonuses")
    void attendanceOnlyLearner() {
        LocalDate today = LocalDate.now(UTC);
        Fixture f = fixture(10, 5);
        when(f.activity().findDailyActivityForInstitute(eq("inst"), any(), any(), any(), any()))
                .thenReturn(List.of());
        when(f.attendance().findPresentDaysForInstitute(eq("inst"), any(), any(), any()))
                .thenReturn(List.of(present("u", today.minusDays(2)), present("u", today.minusDays(1))));

        f.job().accrueForInstitute("inst", 3);

        verify(f.ledger(), never()).award(anyString(), anyString(), any(), eq(PointsSourceType.ACTIVITY), any(),
                anyInt(), anyString(), anyString(), any());
        verify(f.ledger()).award(eq("u"), eq("inst"), isNull(), eq(PointsSourceType.ENGAGEMENT_STREAK), isNull(),
                eq(5), anyString(), eq("ENGAGEMENT_STREAK:" + today.minusDays(1) + ":u"), any());
    }

    @Test
    @DisplayName("an attendance lookup failure leaves the activity awards intact")
    void attendanceFailureIsNotFatal() {
        LocalDate twoDaysAgo = LocalDate.now(UTC).minusDays(2);
        Fixture f = fixture(10, 5);
        when(f.activity().findDailyActivityForInstitute(eq("inst"), any(), any(), any(), any()))
                .thenReturn(List.of(activity("u", twoDaysAgo)));
        when(f.attendance().findPresentDaysForInstitute(eq("inst"), any(), any(), any()))
                .thenThrow(new RuntimeException("boom"));

        assertEquals(1, f.job().accrueForInstitute("inst", 3));
        verify(f.ledger()).award(eq("u"), eq("inst"), isNull(), eq(PointsSourceType.ACTIVITY), isNull(),
                eq(10), anyString(), eq("ACTIVITY:" + twoDaysAgo + ":u"), any());
    }
}
