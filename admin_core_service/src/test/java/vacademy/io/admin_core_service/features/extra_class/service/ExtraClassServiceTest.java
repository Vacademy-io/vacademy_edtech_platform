package vacademy.io.admin_core_service.features.extra_class.service;

import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExtraClassServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 26);

    @Test
    void datesAreRequired() {
        assertThrows(VacademyException.class, () -> ExtraClassService.validateDates(null, TODAY, TODAY));
        assertThrows(VacademyException.class, () -> ExtraClassService.validateDates(TODAY, null, TODAY));
    }

    @Test
    void lastDayMustNotBeBeforeFirst() {
        assertThrows(VacademyException.class,
                () -> ExtraClassService.validateDates(TODAY.plusDays(3), TODAY.plusDays(2), TODAY));
    }

    @Test
    void lastDayMustNotBeInThePast() {
        assertThrows(VacademyException.class,
                () -> ExtraClassService.validateDates(TODAY.minusDays(5), TODAY.minusDays(1), TODAY));
    }

    @Test
    void ninetyDaysAtMost() {
        assertDoesNotThrow(() -> ExtraClassService.validateDates(TODAY, TODAY.plusDays(89), TODAY));
        assertThrows(VacademyException.class, () -> ExtraClassService.validateDates(TODAY, TODAY.plusDays(90), TODAY));
    }

    @Test
    void oneDayAndPastStartAreFine() {
        assertDoesNotThrow(() -> ExtraClassService.validateDates(TODAY, TODAY, TODAY));
        assertDoesNotThrow(() -> ExtraClassService.validateDates(TODAY.minusDays(2), TODAY.plusDays(2), TODAY));
    }

    @Test
    void overlapTreatsMissingDatesAsOpen() {
        // A normal enrolment with no end overlaps any window after its start.
        assertTrue(ExtraClassService.overlaps(TODAY.minusDays(100), null, TODAY, TODAY.plusDays(7)));
        assertTrue(ExtraClassService.overlaps(null, null, TODAY, TODAY));
        assertFalse(ExtraClassService.overlaps(TODAY.minusDays(10), TODAY.minusDays(1), TODAY, TODAY.plusDays(7)));
        assertFalse(ExtraClassService.overlaps(TODAY.plusDays(8), TODAY.plusDays(9), TODAY, TODAY.plusDays(7)));
        assertTrue(ExtraClassService.overlaps(TODAY.plusDays(7), TODAY.plusDays(9), TODAY, TODAY.plusDays(7)));
    }

    @Test
    void stateFollowsDatesAndStatus() {
        assertEquals("UPCOMING", ExtraClassService.state("INACTIVE", TODAY.plusDays(1), TODAY.plusDays(3), TODAY));
        assertEquals("CURRENT", ExtraClassService.state("ACTIVE", TODAY, TODAY, TODAY));
        assertEquals("ENDED", ExtraClassService.state("ACTIVE", TODAY.minusDays(3), TODAY.minusDays(1), TODAY));
        assertEquals("ENDED", ExtraClassService.state("EXPIRED", TODAY, TODAY.plusDays(3), TODAY));
    }

    @Test
    void endOfDayInIndiaReadsBackAsTheSameDay() {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        Timestamp end = Timestamp.from(TODAY.atTime(23, 59, 59).atZone(ist).toInstant());
        assertEquals(TODAY, ExtraClassService.toDay(end, ist));
        assertEquals(TODAY, ExtraClassService.toDay(java.sql.Date.valueOf(TODAY), ist));
    }

    @Test
    void labelSkipsDefaultParts() {
        assertEquals("Bharatanatyam · Mon-Wed 6pm",
                ExtraClassService.label(Map.of("course_name", "Bharatanatyam", "level_name", "default",
                        "batch_name", "Mon-Wed 6pm")));
    }
}
