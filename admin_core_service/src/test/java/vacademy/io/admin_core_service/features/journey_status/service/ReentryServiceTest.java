package vacademy.io.admin_core_service.features.journey_status.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

class ReentryServiceTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final LocalDate TODAY = LocalDate.of(2026, 12, 1);

    private static JourneyStatusConfig on() throws Exception {
        return JourneyStatusConfig.from(M.readTree("{\"enabled\": true}"));
    }

    private static ReentryService.Request req(ReentryService.Link extra, ReentryService.Link bridge, LocalDate returnOn) {
        return new ReentryService.Request("u1", "ps-main", " Back after 4 months ", extra, bridge, returnOn, false);
    }

    private static String fails(JourneyStatusConfig c, ReentryService.Request r) {
        return assertThrows(VacademyException.class, () -> ReentryService.validate(c, r, TODAY)).getMessage();
    }

    @Test
    void offOrNoReentryStatusIsRefused() throws Exception {
        assertTrue(fails(JourneyStatusConfig.off(), req(null, null, null)).contains("switched off"));
        JourneyStatusConfig noReentry = JourneyStatusConfig.from(M.readTree("""
                {"enabled": true, "statuses": [{"key": "learning", "label": "Learning", "kind": "ACTIVE"},
                                               {"key": "paused", "label": "Paused", "kind": "BREAK"}]}
                """));
        assertNull(noReentry.reentryStatus());
        assertTrue(fails(noReentry, req(null, null, null)).contains("No Re-entry status"));
    }

    @Test
    void returnDateDefaultsToTheLaterLastDay() throws Exception {
        ReentryService.Link extra = new ReentryService.Link("ps-x", TODAY, TODAY.plusDays(14));
        ReentryService.Link bridge = new ReentryService.Link("ps-b", TODAY, TODAY.plusDays(30));
        ReentryService.Plan p = ReentryService.validate(on(), req(extra, bridge, null), TODAY);
        assertEquals("re_entry", p.statusKey());
        assertEquals("Back after 4 months", p.reason());
        assertEquals(TODAY.plusDays(30), p.returnOn());
        assertNull(ReentryService.validate(on(), req(null, null, null), TODAY).returnOn());
        assertEquals(TODAY.plusDays(5), ReentryService.validate(on(), req(extra, null, TODAY.plusDays(5)), TODAY).returnOn());
    }

    @Test
    void badInputIsRefused() throws Exception {
        JourneyStatusConfig c = on();
        assertTrue(fails(c, new ReentryService.Request("u1", "ps-main", "  ", null, null, null, false)).contains("reason"));
        assertTrue(fails(c, new ReentryService.Request("u1", "", "r", null, null, null, false)).contains("batch"));
        assertTrue(fails(c, req(null, null, TODAY.minusDays(1))).contains("past"));
        assertTrue(fails(c, req(new ReentryService.Link("ps-main", TODAY, TODAY.plusDays(3)), null, null))
                .contains("different batch"));
        assertTrue(fails(c, req(new ReentryService.Link("ps-x", null, TODAY), null, null)).contains("first and the last day"));
        assertTrue(fails(c, req(null, new ReentryService.Link(" ", TODAY, TODAY), null)).contains("bridge course"));
        assertTrue(fails(c, req(new ReentryService.Link("ps-x", TODAY, TODAY.plusDays(10)),
                new ReentryService.Link("ps-x", TODAY.plusDays(5), TODAY.plusDays(20)), null)).contains("overlapping"));
    }

    @Test
    void reentryAutoReturnDefaultsOnAndCanBeSwitchedOff() throws Exception {
        assertTrue(on().reentryAutoReturn());
        assertTrue(JourneyStatusConfig.off().reentryAutoReturn());
        JourneyStatusConfig off = JourneyStatusConfig.from(M.readTree("{\"enabled\": true, \"reentry_auto_return\": false}"));
        assertFalse(off.reentryAutoReturn());
        assertEquals(false, off.toJson().get("reentry_auto_return"));
    }
}
