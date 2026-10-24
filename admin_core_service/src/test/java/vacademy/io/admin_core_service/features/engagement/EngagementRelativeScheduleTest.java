package vacademy.io.admin_core_service.features.engagement;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementRelativeSchedule;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver;
import vacademy.io.admin_core_service.features.engagement.service.EngagementScheduleResolver.SlotState;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EngagementRelativeScheduleTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final EngagementPlanRepository repo = Mockito.mock(EngagementPlanRepository.class);
    private final EngagementScheduleResolver resolver = new EngagementScheduleResolver();
    private final EngagementRelativeSchedule schedule = new EngagementRelativeSchedule(repo, resolver);

    private static Timestamp at(int y, int m, int d, int h) {
        return Timestamp.from(LocalDateTime.of(y, m, d, h, 0).atZone(IST).toInstant());
    }

    private EngagementPlan plan(Timestamp published) {
        EngagementPlan p = new EngagementPlan();
        p.setId("plan-1");
        p.setPackageSessionId("ps-1");
        p.setTimezone("Asia/Kolkata");
        p.setScheduleMode("RELATIVE");
        p.setPublishedAt(published);
        return p;
    }

    private EngagementSlot slot(int startDay, int endDay) {
        EngagementSlot s = new EngagementSlot();
        s.setId("slot-1");
        s.setPlanId("plan-1");
        s.setStartDay(startDay);
        s.setEndDay(endDay);
        s.setStartDate(EngagementRelativeSchedule.virtualDate(startDay));
        s.setEndDate(EngagementRelativeSchedule.virtualDate(endDay));
        s.setStartTime(LocalTime.of(6, 0));
        s.setEndTime(LocalTime.of(20, 0));
        return s;
    }

    @Test
    @DisplayName("a learner who joins after publish starts Day 1 on their join day (institute timezone)")
    void joinAfterPublish() {
        EngagementPlan p = plan(at(2026, 9, 1, 10));
        // 00:30 IST on the 10th is still the 10th locally even though it's the 9th in UTC.
        assertEquals(LocalDate.of(2026, 9, 10), schedule.dayOne(p, at(2026, 9, 10, 0)));
    }

    @Test
    @DisplayName("learners already in the batch start on the publish day")
    void joinedBeforePublish() {
        EngagementPlan p = plan(at(2026, 9, 15, 18));
        assertEquals(LocalDate.of(2026, 9, 15), schedule.dayOne(p, at(2026, 8, 1, 9)));
        assertEquals(LocalDate.of(2026, 9, 15), schedule.dayOne(p, null));
    }

    @Test
    @DisplayName("Days 1–3 run on the learner's first three days; the join day is Day 1")
    void localizeDays() {
        EngagementPlan p = plan(at(2026, 9, 1, 10));
        EngagementSlot mine = schedule.localize(p, slot(1, 3), LocalDate.of(2026, 9, 10));
        assertTrue(resolver.runsOn(mine, LocalDate.of(2026, 9, 10)));
        assertTrue(resolver.runsOn(mine, LocalDate.of(2026, 9, 12)));
        assertFalse(resolver.runsOn(mine, LocalDate.of(2026, 9, 9)));
        assertFalse(resolver.runsOn(mine, LocalDate.of(2026, 9, 13)));

        EngagementSlot day5 = schedule.localize(p, slot(5, 5), LocalDate.of(2026, 9, 10));
        assertEquals(LocalDate.of(2026, 9, 14), day5.getStartDate());
        assertEquals(LocalDate.of(2026, 9, 14), day5.getEndDate());
    }

    @Test
    @DisplayName("two learners who joined on different days see the same slot on different dates")
    void perLearnerState() {
        EngagementPlan p = plan(at(2026, 9, 1, 10));
        EngagementItem item = new EngagementItem();
        var now = LocalDateTime.of(2026, 9, 12, 9, 0).atZone(IST);
        EngagementSlot early = schedule.localize(p, slot(1, 1), LocalDate.of(2026, 9, 12));
        EngagementSlot late = schedule.localize(p, slot(1, 1), LocalDate.of(2026, 9, 14));
        assertEquals(SlotState.OPEN, resolver.stateOn(p, early, item, LocalDate.of(2026, 9, 12), now));
        assertFalse(resolver.runsOn(late, LocalDate.of(2026, 9, 12)));
    }

    @Test
    @DisplayName("calendar plans are left untouched")
    void calendarUntouched() {
        EngagementPlan p = plan(at(2026, 9, 1, 10));
        p.setScheduleMode("CALENDAR");
        EngagementSlot s = slot(1, 1);
        assertSame(s, schedule.localize(p, s, LocalDate.of(2026, 9, 10)));
    }

    @Test
    @DisplayName("Day 1 per learner for a batch comes from each learner's enrollment date")
    void batchDayOnes() {
        EngagementPlan p = plan(at(2026, 9, 5, 10));
        Mockito.when(repo.findJoinDatesForBatch("ps-1")).thenReturn(List.of(
                new Object[]{"old", at(2026, 8, 1, 10)},
                new Object[]{"new", at(2026, 9, 20, 10)}));
        Map<String, LocalDate> dayOnes = schedule.dayOnesForBatch(p);
        assertEquals(LocalDate.of(2026, 9, 5), dayOnes.get("old"));
        assertEquals(LocalDate.of(2026, 9, 20), dayOnes.get("new"));
    }
}
