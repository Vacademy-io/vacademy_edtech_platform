package vacademy.io.admin_core_service.features.journey_status.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ReentryServiceTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final LocalDate TODAY = LocalDate.of(2026, 12, 1);

    private static JourneyStatusConfig on() throws Exception {
        return JourneyStatusConfig.from(M.readTree("{\"enabled\": true}"));
    }

    private static ReentryService.Request req(ReentryService.Link extra, ReentryService.Link bridge, LocalDate returnOn) {
        return new ReentryService.Request("u1", "ps-main", " Back after 4 months ", extra == null ? null : List.of(extra),
                bridge, null, null, returnOn, false);
    }

    private static ReentryService.Request full(List<ReentryService.Link> extras, ReentryService.OneOnOne o,
                                               ReentryService.Assessment a, LocalDate returnOn) {
        return new ReentryService.Request("u1", "ps-main", "Back", extras, null, o, a, returnOn, false);
    }

    private static ReentryService.Slot slot(int plusDays, String time, Integer minutes) {
        return new ReentryService.Slot(TODAY.plusDays(plusDays), LocalTime.parse(time), minutes);
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
        assertTrue(fails(c, new ReentryService.Request("u1", "ps-main", "  ", null, null, null, null, null, false)).contains("reason"));
        assertTrue(fails(c, new ReentryService.Request("u1", "", "r", null, null, null, null, null, false)).contains("batch"));
        assertTrue(fails(c, req(null, null, TODAY.minusDays(1))).contains("past"));
        assertTrue(fails(c, req(new ReentryService.Link("ps-main", TODAY, TODAY.plusDays(3)), null, null))
                .contains("different batch"));
        assertTrue(fails(c, req(new ReentryService.Link("ps-x", null, TODAY), null, null)).contains("first and the last day"));
        assertTrue(fails(c, req(null, new ReentryService.Link(" ", TODAY, TODAY), null)).contains("bridge course"));
        assertTrue(fails(c, req(new ReentryService.Link("ps-x", TODAY, TODAY.plusDays(10)),
                new ReentryService.Link("ps-x", TODAY.plusDays(5), TODAY.plusDays(20)), null)).contains("overlapping"));
    }

    @Test
    void severalExtraClassesAreChecked() throws Exception {
        JourneyStatusConfig c = on();
        ReentryService.Link mon = new ReentryService.Link("ps-mon", TODAY, TODAY.plusDays(20));
        ReentryService.Link tue = new ReentryService.Link("ps-tue", TODAY, TODAY.plusDays(40));
        assertEquals(TODAY.plusDays(40), ReentryService.validate(c, full(List.of(mon, tue), null, null, null), TODAY).returnOn());
        // Same batch twice on overlapping dates is refused; on separate dates it is fine.
        assertTrue(fails(c, full(List.of(mon, new ReentryService.Link("ps-mon", TODAY.plusDays(10), TODAY.plusDays(30))),
                null, null, null)).contains("overlapping"));
        assertNotNull(ReentryService.validate(c, full(List.of(mon,
                new ReentryService.Link("ps-mon", TODAY.plusDays(21), TODAY.plusDays(30))), null, null, null), TODAY));
        assertTrue(fails(c, full(List.of(mon, new ReentryService.Link("ps-main", TODAY, TODAY)), null, null, null))
                .contains("different batch"));
        List<ReentryService.Link> six = List.of(mon, tue, new ReentryService.Link("a", TODAY, TODAY),
                new ReentryService.Link("b", TODAY, TODAY), new ReentryService.Link("c", TODAY, TODAY),
                new ReentryService.Link("d", TODAY, TODAY));
        assertTrue(fails(c, full(six, null, null, null)).contains("at most 5"));
    }

    @Test
    void oneOnOneSessionsAreCheckedAndSetTheReturnDate() throws Exception {
        JourneyStatusConfig c = on();
        ReentryService.OneOnOne o = new ReentryService.OneOnOne("t1", "  ",
                List.of(slot(3, "09:00", 60), slot(50, "18:30", 45)), null);
        ReentryService.Plan p = ReentryService.validate(c, full(List.of(new ReentryService.Link("ps-x", TODAY, TODAY.plusDays(20))),
                o, null, null), TODAY);
        assertEquals(TODAY.plusDays(50), p.returnOn());
        assertEquals("One-on-one class", p.oneOnOneTitle());

        assertTrue(fails(c, full(null, new ReentryService.OneOnOne(" ", null, List.of(slot(1, "09:00", 60)), null), null, null))
                .contains("teacher"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, List.of(), null), null, null))
                .contains("at least one session"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, List.of(slot(-1, "09:00", 60)), null), null, null))
                .contains("past"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null,
                List.of(slot(2, "09:00", 60), slot(2, "09:30", 30)), null), null, null)).contains("overlap"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, List.of(slot(2, "09:00", 500)), null), null, null))
                .contains("minutes"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, List.of(slot(2, "23:30", 60)), null), null, null))
                .contains("same day"));
    }

    @Test
    void extraPaymentIsChecked() throws Exception {
        JourneyStatusConfig c = on();
        List<ReentryService.Slot> one = List.of(slot(2, "10:00", 60));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, one,
                new ReentryService.Payment(BigDecimal.ZERO, TODAY, null)), null, null)).contains("more than zero"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, one,
                new ReentryService.Payment(new BigDecimal("1500"), null, null)), null, null)).contains("due date"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, one,
                new ReentryService.Payment(new BigDecimal("1500"), TODAY.minusDays(1), null)), null, null)).contains("past"));
        assertNotNull(ReentryService.validate(c, full(null, new ReentryService.OneOnOne("t1", null, one,
                new ReentryService.Payment(new BigDecimal("1500"), TODAY.plusDays(7), "Bridge")), null, null), TODAY));
    }

    @Test
    void assessmentIsOptionalAndDefaultsToTenMinutes() throws Exception {
        JourneyStatusConfig c = on();
        assertNull(ReentryService.validate(c, full(null, null, null, null), TODAY).returnOn());
        ReentryService.Plan p = ReentryService.validate(c, full(null, null,
                new ReentryService.Assessment("t1", slot(1, "17:00", null)), null), TODAY);
        assertEquals(10, p.assessmentMinutes());
        // The assessment alone does not set a return date.
        assertNull(p.returnOn());
        assertTrue(fails(c, full(null, null, new ReentryService.Assessment("", slot(1, "17:00", 10)), null)).contains("teacher"));
        assertTrue(fails(c, full(null, null, new ReentryService.Assessment("t1", null), null)).contains("date"));
        assertTrue(fails(c, full(null, new ReentryService.OneOnOne("t1", null, List.of(slot(1, "17:00", 60)), null),
                new ReentryService.Assessment("t1", slot(1, "17:30", 10)), null)).contains("overlaps"));
        // Another teacher at the same time is fine.
        assertNotNull(ReentryService.validate(c, full(null, new ReentryService.OneOnOne("t1", null, List.of(slot(1, "17:00", 60)), null),
                new ReentryService.Assessment("t2", slot(1, "17:30", 10)), null), TODAY));
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
