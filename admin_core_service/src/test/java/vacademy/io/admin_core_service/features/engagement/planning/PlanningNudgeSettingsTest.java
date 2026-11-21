package vacademy.io.admin_core_service.features.engagement.planning;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlanningNudgeSettingsTest {

    @Test
    void offWithDefaultsWhenNeverConfigured() {
        PlanningNudgeSettings s = PlanningNudgeSettings.from(null);
        assertFalse(s.enabled());
        assertEquals(5, s.sendDay());
        assertEquals(16, s.sendHour());
        assertEquals(24, s.reminderHours());
        assertFalse(s.autoPublish());
        assertEquals("MON_FRI", s.runDays());
        assertEquals(2, s.tasksPerDay());
        assertTrue(s.packageSessionIds().isEmpty());
    }

    @Test
    void parsesAndClampsEveryField() {
        PlanningNudgeSettings s = PlanningNudgeSettings.from(Map.of("planningNudge", Map.of(
                "enabled", true, "sendDay", "9", "sendHour", -3, "reminderHours", 0,
                "autoPublish", true, "runDays", "ALL", "tasksPerDay", 40,
                "packageSessionIds", List.of("b1", " ", "b2"))));
        assertTrue(s.enabled());
        assertEquals(7, s.sendDay());
        assertEquals(0, s.sendHour());
        assertEquals(0, s.reminderHours());
        assertTrue(s.autoPublish());
        assertEquals("ALL", s.runDays());
        assertEquals(5, s.tasksPerDay());
        assertEquals(Set.of("b1", "b2"), s.packageSessionIds());
    }

    @Test
    void unknownRunDaysAndGarbageFallBack() {
        PlanningNudgeSettings s = PlanningNudgeSettings.from(Map.of("planningNudge",
                Map.of("runDays", "WEEKENDS", "sendHour", "noon", "enabled", "yes")));
        assertEquals("MON_FRI", s.runDays());
        assertEquals(16, s.sendHour());
        assertFalse(s.enabled());   // only a real boolean true turns it on
    }

    @Test
    void weekToPlanIsTheComingMondayOrTodayOnAMonday() {
        assertEquals(LocalDate.of(2026, 11, 23), PlanningNudgeSettings.weekToPlan(LocalDate.of(2026, 11, 20))); // Fri
        assertEquals(LocalDate.of(2026, 11, 23), PlanningNudgeSettings.weekToPlan(LocalDate.of(2026, 11, 22))); // Sun
        assertEquals(LocalDate.of(2026, 11, 23), PlanningNudgeSettings.weekToPlan(LocalDate.of(2026, 11, 23))); // Mon
        assertEquals(LocalDate.of(2026, 11, 30), PlanningNudgeSettings.weekToPlan(LocalDate.of(2026, 11, 24))); // Tue
    }

    @Test
    void remainingDatesFollowRunDaysAndSkipThePast() {
        LocalDate monday = LocalDate.of(2026, 11, 23);
        PlanningNudgeSettings weekdays = PlanningNudgeSettings.defaults();
        assertEquals(5, weekdays.remainingDates(monday, monday.minusDays(3)).size());
        assertEquals(List.of(LocalDate.of(2026, 11, 26), LocalDate.of(2026, 11, 27)),
                weekdays.remainingDates(monday, LocalDate.of(2026, 11, 26)));
        assertTrue(weekdays.remainingDates(monday, LocalDate.of(2026, 11, 28)).isEmpty());
        PlanningNudgeSettings sat = PlanningNudgeSettings.from(Map.of("planningNudge", Map.of("runDays", "MON_SAT")));
        assertEquals(6, sat.remainingDates(monday, monday).size());
        PlanningNudgeSettings all = PlanningNudgeSettings.from(Map.of("planningNudge", Map.of("runDays", "ALL")));
        assertEquals(7, all.remainingDates(monday, monday).size());
    }

    @Test
    void emailsEscapeAdminTypedNames() {
        EngagementPlanningEmails.Mail m = EngagementPlanningEmails.ask("Acme <School>", "Riya \"R\" Jain",
                "<script>alert(1)</script>", "Maths & Science", LocalDate.of(2026, 11, 23),
                "https://dash.example.com/plan-week?t=abc", LocalDate.of(2026, 11, 29), true);
        assertFalse(m.html().contains("<script>"));
        assertTrue(m.html().contains("&lt;script&gt;"));
        assertTrue(m.html().contains("Maths &amp; Science"));
        assertTrue(m.subject().startsWith("Reminder: "));
        assertTrue(m.html().contains("Hi Riya,"));
    }

    @Test
    void tokensAreRandomAndOnlyTheirHashIsComparable() {
        String a = EngagementPlanningService.newToken();
        String b = EngagementPlanningService.newToken();
        assertNotEquals(a, b);
        assertEquals(43, a.length());
        assertEquals(64, EngagementPlanningService.hash(a).length());
        assertEquals(EngagementPlanningService.hash(a), EngagementPlanningService.hash(a));
        assertFalse(EngagementPlanningService.hash(a).contains(a));
    }

    @Test
    void portalLinkGetsASchemeAndNoTrailingSlash() {
        assertEquals("https://dash.vacademy.io/plan-week?t=x",
                EngagementPlanningService.link(EngagementPlanningService.portal(null), "x"));
    }
}
