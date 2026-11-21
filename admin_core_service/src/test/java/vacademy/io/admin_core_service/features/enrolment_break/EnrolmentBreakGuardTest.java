package vacademy.io.admin_core_service.features.enrolment_break;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.enrolment_break.entity.EnrolmentBreak;
import vacademy.io.admin_core_service.features.enrolment_break.repository.EnrolmentBreakRepository;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard.Category;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class EnrolmentBreakGuardTest {

    private static final String INST = "inst-1";
    private static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    private EnrolmentBreakRepository repo;
    private EnrolmentBreakGuard guard;
    private final List<EnrolmentBreak> rows = new ArrayList<>();
    private LocalDate today;

    @BeforeEach
    void setUp() {
        repo = mock(EnrolmentBreakRepository.class);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone(anyString())).thenReturn(ZONE);
        when(repo.findByStatusIn(anyCollection())).thenAnswer(i -> List.copyOf(rows));
        guard = new EnrolmentBreakGuard(repo, tz);
        today = LocalDate.now(ZONE);
    }

    private EnrolmentBreak brk(String kind, String user, String ps, String plan, LocalDate from, LocalDate to,
                               boolean classStop, boolean feeStop, String status) {
        EnrolmentBreak b = new EnrolmentBreak();
        b.setId(user + "-" + ps + "-" + from);
        b.setInstituteId(INST);
        b.setUserId(user);
        b.setPackageSessionId(ps);
        b.setUserPlanId(plan);
        b.setKind(kind);
        b.setStartsOn(from);
        b.setEndsOn(to);
        b.setStopClassReminders(classStop);
        b.setStopFeeReminders(feeStop);
        b.setStatus(status);
        rows.add(b);
        guard.invalidate();
        return b;
    }

    @Test
    void noBreaksMeansNothingHeldAndOneQueryPerMinute() {
        assertFalse(guard.isHeld(INST, "u1", Category.CLASS, null, null));
        assertFalse(guard.isHeld(INST, "u1", Category.FEE, "ps1", "plan1"));
        assertFalse(guard.instituteHasActiveBreaks(INST));
        assertFalse(guard.anyLive());
        assertFalse(guard.isPlanPaused("plan1"));
        verify(repo, times(1)).findByStatusIn(anyCollection());
    }

    @Test
    void holdStopsOnlyWhatItSaysAndOnlyForThatLearner() {
        brk("HOLD", "u1", null, null, today.minusDays(1), today.plusDays(3), true, false, "ACTIVE");
        assertTrue(guard.isHeld(INST, "u1", Category.CLASS, "ps1", null));
        assertFalse(guard.isHeld(INST, "u1", Category.FEE, "ps1", null), "fee reminders were not stopped");
        assertFalse(guard.isHeld(INST, "u2", Category.CLASS, "ps1", null), "another learner");
        assertFalse(guard.isHeld("other-inst", "u1", Category.CLASS, null, null), "another institute");
    }

    @Test
    void courseScopedBreakOnlyHoldsThatCourse() {
        brk("HOLD", "u1", "ps1", "plan1", today, null, true, true, "ACTIVE");
        assertTrue(guard.isHeld(INST, "u1", Category.CLASS, "ps1", null));
        assertFalse(guard.isHeld(INST, "u1", Category.CLASS, "ps2", null));
        assertTrue(guard.isHeld(INST, "u1", Category.FEE, null, "plan1"));
        assertFalse(guard.isHeld(INST, "u1", Category.FEE, null, "plan2"));
        assertTrue(guard.isHeld(INST, "u1", Category.FEE, null, null), "message not tied to a course");
    }

    @Test
    void datesAreInclusiveAndPastOrFutureBreaksDoNothing() {
        brk("HOLD", "u1", null, null, today.plusDays(1), today.plusDays(5), true, true, "SCHEDULED");
        brk("HOLD", "u2", null, null, today.minusDays(5), today.minusDays(1), true, true, "ACTIVE");
        brk("HOLD", "u3", null, null, today, today, true, true, "SCHEDULED");
        assertFalse(guard.isHeld(INST, "u1", Category.CLASS, null, null), "starts tomorrow");
        assertFalse(guard.isHeld(INST, "u2", Category.CLASS, null, null), "ended yesterday");
        assertTrue(guard.isHeld(INST, "u3", Category.CLASS, null, null), "one-day break, today, before the job ran");
    }

    @Test
    void pauseSkipsBillingOnlyWhileActive() {
        brk("PAUSE", "u1", "ps1", "plan1", today, null, true, true, "ACTIVE");
        brk("HOLD", "u2", "ps1", "plan2", today, null, true, true, "ACTIVE");
        assertTrue(guard.isPlanPaused("plan1"));
        assertFalse(guard.isPlanPaused("plan2"), "a hold never stops billing");
        assertTrue(guard.isPlanFeeHeld("plan2"), "but it does stop fee reminders");
        assertEquals(java.util.Set.of("plan1"), guard.pausedPlanIds(List.of("plan1", "plan2", "plan3")));
    }

    @Test
    void withoutHeldReturnsSameListWhenNothingHeld() {
        List<String> users = List.of("u1", "u2");
        assertSame(users, guard.withoutHeld(INST, Category.CLASS, null, users, u -> u));
        brk("HOLD", "u2", null, null, today, null, true, true, "ACTIVE");
        assertEquals(List.of("u1"), guard.withoutHeld(INST, Category.CLASS, null, users, u -> u));
    }

    @Test
    void lookupFailureFailsOpen() {
        when(repo.findByStatusIn(anyCollection())).thenThrow(new RuntimeException("db down"));
        guard.invalidate();
        assertFalse(guard.isHeld(INST, "u1", Category.CLASS, null, null));
        assertFalse(guard.isPlanPaused("plan1"));
    }

    @Test
    void workflowCategoriesAreNarrow() {
        assertEquals(Category.CLASS, EnrolmentBreakGuard.categoryForWorkflow(Map.of("triggerEvents", "LIVE_SESSION_START")));
        assertEquals(Category.FEE, EnrolmentBreakGuard.categoryForWorkflow(Map.of("triggerEvents", "MEMBERSHIP_EXPIRY")));
        assertNull(EnrolmentBreakGuard.categoryForWorkflow(Map.of("triggerEvents", "LEARNER_BATCH_ENROLLMENT")));
        assertNull(EnrolmentBreakGuard.categoryForWorkflow(Map.of("scheduleId", "s1")));
        assertNull(EnrolmentBreakGuard.categoryForWorkflow(null));
    }
}
