package vacademy.io.admin_core_service.features.engagement;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.job.EngagementRevealJob;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAttemptRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementItemRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementSlotRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The reveal job pays a held-back bonus only to answers given before the reveal of the
 * run they were answered in (§19.1). A daily slot: runs 00:00-00:01 UTC, so each day's
 * reveal (the close, 00:01) has passed for the rest of that day.
 */
class EngagementRevealJobTest {

    private EngagementPlanRepository plans;
    private EngagementSlotRepository slots;
    private EngagementItemRepository items;
    private EngagementAttemptRepository attempts;
    private PointsLedgerService points;
    private EngagementRevealJob job;
    private EngagementItem item;

    @BeforeEach
    void setUp() {
        plans = mock(EngagementPlanRepository.class);
        slots = mock(EngagementSlotRepository.class);
        items = mock(EngagementItemRepository.class);
        attempts = mock(EngagementAttemptRepository.class);
        points = mock(PointsLedgerService.class);
        job = new EngagementRevealJob(plans, slots, items, attempts, new EngagementScheduleResolver(), points);

        EngagementPlan plan = new EngagementPlan();
        plan.setId("plan-1");
        plan.setInstituteId("inst-1");
        plan.setPackageSessionId("ps-1");
        plan.setStatus("PUBLISHED");
        plan.setTimezone("UTC");
        plan.setDefaultMissPolicy("CATCH_UP_FULL");
        plan.setDefaultCatchUpDays(1);
        when(plans.findAllPublished()).thenReturn(List.of(plan));

        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        EngagementSlot daily = new EngagementSlot();
        daily.setId("daily");
        daily.setPlanId("plan-1");
        daily.setStartDate(today.minusDays(3));
        daily.setEndDate(today.plusDays(3));
        daily.setStartTime(LocalTime.of(0, 0));
        daily.setEndTime(LocalTime.of(0, 1));
        when(slots.findActiveByPlan("plan-1")).thenReturn(List.of(daily));

        item = new EngagementItem();
        item.setId("q");
        item.setSlotId("daily");
        item.setItemType("QUESTION_OF_DAY");
        item.setTitle("Q");
        item.setVersion(1);
        item.setCorrectPoints(20);
        item.setHideResultUntilReveal(true);
        when(items.findActiveBySlot("daily")).thenReturn(List.of(item));
        when(points.award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(), anyString(),
                anyString())).thenReturn(Optional.empty());
    }

    private EngagementAttempt correctAnswer(String user, java.time.LocalDateTime atUtc, boolean late) {
        EngagementAttempt a = new EngagementAttempt();
        a.setId("att-" + user);
        a.setItemId("q");
        a.setItemVersion(1);
        a.setUserId(user);
        a.setInstituteId("inst-1");
        a.setPackageSessionId("ps-1");
        a.setStatus("COMPLETED");
        a.setIsCorrect(true);
        a.setIsLate(late);
        a.setPointsAwarded(0);
        a.setCompletedAt(Timestamp.from(atUtc.toInstant(ZoneOffset.UTC)));
        return a;
    }

    @Test
    @DisplayName("an answer given after its own run's reveal earns no bonus at a later run's reveal")
    void noBonusForAnswerAfterItsOwnReveal() {
        LocalDate yesterday = LocalDate.now(ZoneOffset.UTC).minusDays(1);
        // Yesterday noon: a catch-up, long after yesterday's 00:01 reveal. Today's run has
        // revealed too, and noon yesterday is "before" it — the old check paid this.
        EngagementAttempt late = correctAnswer("late", yesterday.atTime(12, 0), true);
        when(attempts.findByItem("q")).thenReturn(List.of(late));

        job.tick();

        verify(points, never()).award(anyString(), anyString(), anyString(), any(), anyString(), anyInt(),
                anyString(), anyString());
    }

    @Test
    @DisplayName("an answer given inside its run, before that run's reveal, is paid once")
    void bonusForAnswerBeforeItsReveal() {
        LocalDate yesterday = LocalDate.now(ZoneOffset.UTC).minusDays(1);
        EngagementAttempt onTime = correctAnswer("ontime", yesterday.atTime(0, 0, 30), false);
        when(attempts.findByItem("q")).thenReturn(List.of(onTime));

        job.tick();

        verify(points, times(1)).award(eq("ontime"), eq("inst-1"), eq("ps-1"), any(), eq("q"), eq(20),
                anyString(), eq("ENGAGEMENT_BONUS:q:v1:ontime"));
    }
}
