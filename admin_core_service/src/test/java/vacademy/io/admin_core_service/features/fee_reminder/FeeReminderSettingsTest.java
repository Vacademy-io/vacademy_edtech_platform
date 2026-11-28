package vacademy.io.admin_core_service.features.fee_reminder;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class FeeReminderSettingsTest {

    private static FeeReminderSettings parse(String json) throws Exception {
        return FeeReminderSettings.from(new ObjectMapper().readTree(json));
    }

    @Test
    void nrithyaScheduleSevenBeforeOnDueThenEveryTwoDaysNoCutoff() throws Exception {
        FeeReminderSettings s = parse("{\"enabled\":true,\"days_before\":[7],\"on_due_date\":true,"
                + "\"overdue_every_days\":2,\"red_list_after_days\":15}");
        assertTrue(s.enabled());
        assertEquals("BEFORE_7", s.stepFor(7));
        assertNull(s.stepFor(6));
        assertNull(s.stepFor(1));
        assertEquals("DUE", s.stepFor(0));
        assertNull(s.stepFor(-1));
        assertEquals("OVERDUE_2", s.stepFor(-2));
        assertEquals("OVERDUE_4", s.stepFor(-4));
        assertEquals("OVERDUE_120", s.stepFor(-120), "no cutoff");
        assertEquals(15, s.redListAfterDays());
        assertEquals(7, s.maxDaysBefore());
    }

    @Test
    void cutoffAndNoRepeat() throws Exception {
        FeeReminderSettings s = parse("{\"enabled\":true,\"days_before\":[3,1],\"on_due_date\":false,"
                + "\"overdue_every_days\":3,\"stop_after_days\":9}");
        assertEquals("BEFORE_3", s.stepFor(3));
        assertEquals("BEFORE_1", s.stepFor(1));
        assertNull(s.stepFor(0));
        assertEquals("OVERDUE_9", s.stepFor(-9));
        assertNull(s.stepFor(-12), "past the cutoff");
        FeeReminderSettings none = parse("{\"enabled\":true,\"overdue_every_days\":0}");
        assertNull(none.stepFor(-2));
    }

    @Test
    void missingOrDisabledIsOff() throws Exception {
        assertFalse(FeeReminderSettings.from(null).enabled());
        assertFalse(parse("{}").enabled());
        assertEquals(java.util.List.of(7), parse("{}").daysBefore(), "default 7 days before");
        assertEquals(java.util.List.of(), parse("{\"days_before\":[]}").daysBefore(), "explicitly none");
    }

    @Test
    void payLinkAndAmount() {
        vacademy.io.common.auth.dto.UserDTO u = new vacademy.io.common.auth.dto.UserDTO();
        u.setUsername("riya s");
        assertEquals("https://learn.nrithya.com/subscriptions/riya+s", FeeReminderService.payLink("learn.nrithya.com/", u));
        assertNull(FeeReminderService.payLink(null, u));
        assertEquals("2600", FeeReminderService.formatAmount(2600.0));
        assertEquals("2125.50", FeeReminderService.formatAmount(2125.5));
    }
}
