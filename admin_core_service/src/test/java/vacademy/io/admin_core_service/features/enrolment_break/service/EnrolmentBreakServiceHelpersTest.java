package vacademy.io.admin_core_service.features.enrolment_break.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class EnrolmentBreakServiceHelpersTest {

    private static LocalDate d(String s) { return LocalDate.parse(s); }

    @Test
    void overlapsTreatsOpenEndsAsForever() {
        assertTrue(EnrolmentBreakService.overlaps(d("2026-12-01"), d("2026-12-10"), d("2026-12-10"), d("2026-12-20")));
        assertFalse(EnrolmentBreakService.overlaps(d("2026-12-01"), d("2026-12-09"), d("2026-12-10"), null));
        assertTrue(EnrolmentBreakService.overlaps(d("2026-12-01"), null, d("2027-06-01"), d("2027-06-02")));
        assertFalse(EnrolmentBreakService.overlaps(d("2026-12-11"), null, d("2026-12-01"), d("2026-12-10")));
    }

    @Test
    void courseLabelDropsDefaultParts() {
        assertEquals("Bharatanatyam · Adya", EnrolmentBreakService.label("Bharatanatyam", "Adya", "DEFAULT"));
        assertEquals("Kathak · Tue & Wed 9 AM", EnrolmentBreakService.label("Kathak", "default", "Tue & Wed 9 AM"));
        assertEquals("Zumba", EnrolmentBreakService.label("Zumba", null, null));
    }

    @Test
    void plusDaysKeepsTimeOfDayAndNulls() {
        Date end = java.sql.Timestamp.valueOf("2026-12-05 23:59:59");
        assertEquals(java.sql.Timestamp.valueOf("2026-12-20 23:59:59"), EnrolmentBreakService.plusDays(end, 15));
        assertNull(EnrolmentBreakService.plusDays(null, 15));
    }

    @Test
    void newDateKeepsTheOldEndTimeOfDay() {
        ZoneId z = ZoneId.of("Asia/Kolkata");
        Date old = Date.from(java.time.LocalDateTime.parse("2026-12-05T23:59:59").atZone(z).toInstant());
        Date moved = EnrolmentBreakService.atTimeOf(d("2027-01-10"), old, z);
        assertEquals(java.time.LocalDateTime.parse("2027-01-10T23:59:59"),
                moved.toInstant().atZone(z).toLocalDateTime());
    }

    @Test
    void splitIdsIgnoresBlanks() {
        assertEquals(List.of("a", "b"), EnrolmentBreakService.splitIds(" a, ,b "));
        assertEquals(List.of(), EnrolmentBreakService.splitIds(null));
    }

    @Test
    void everyBlockerHasAMessage() {
        for (String code : List.of("COURSE_NOT_FOUND", "PAUSE_NEEDS_COURSE", "NO_COURSES", "NOTHING_TO_STOP",
                "START_IN_PAST", "END_BEFORE_START", "TOO_LONG", "OVERLAP", "NEW_DATE_REQUIRED", "NEW_DATE_NOT_FUTURE")) {
            assertNotEquals(code, EnrolmentBreakService.blockerMessage(code));
        }
    }
}
