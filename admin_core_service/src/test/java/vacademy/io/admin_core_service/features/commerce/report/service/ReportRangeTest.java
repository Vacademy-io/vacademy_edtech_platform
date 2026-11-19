package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.TimeZone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** India dates to stored (UTC wall) bounds, the 366-day and 31-day caps, months and financial years. */
class ReportRangeTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 19);
    private TimeZone saved;

    @BeforeEach
    void utcLikeProduction() {
        saved = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    }

    @AfterEach
    void restore() {
        TimeZone.setDefault(saved);
    }

    @Test
    void indiaDayStartsAt1830UtcTheDayBefore() {
        ReportRange range = ReportRange.of(LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 1), TODAY,
                ReportRange.MAX_DAYS);
        assertEquals(LocalDateTime.of(2026, 10, 31, 18, 30), range.storedFrom());
        assertEquals(LocalDateTime.of(2026, 11, 1, 18, 30), range.storedToExclusive());
    }

    @Test
    void theBoundsDoNotDependOnTheJvmZone() {
        // The same India day gives the same stored (UTC) bounds in any JVM zone, a DST zone included.
        for (String zone : java.util.List.of("Asia/Kolkata", "America/New_York", "Pacific/Chatham")) {
            TimeZone.setDefault(TimeZone.getTimeZone(zone));
            ReportRange range = ReportRange.of(LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 19), TODAY,
                    ReportRange.MAX_DAYS);
            assertEquals(LocalDateTime.of(2026, 10, 31, 18, 30), range.storedFrom(), zone);
            assertEquals(LocalDateTime.of(2026, 11, 19, 18, 30), range.storedToExclusive(), zone);
            assertEquals(LocalDateTime.of(2026, 3, 7, 18, 30), ReportRange.storedStartOf(LocalDate.of(2026, 3, 8)),
                    zone + " on a DST change day");
        }
    }

    @Test
    void reportsReachBackThreeYearsAtMost() {
        LocalDate earliest = TODAY.minusYears(3);
        ReportRange.of(earliest, earliest.plusDays(10), TODAY, ReportRange.MAX_DAYS);
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> ReportRange.of(earliest.minusDays(1), earliest.plusDays(10), TODAY, ReportRange.MAX_DAYS));
        assertTrue(e.getMessage().startsWith("VALIDATION:"));
        assertThrows(InvalidRequestException.class, () -> ReportRange.month("2023-10", TODAY));
        assertEquals(LocalDate.of(2023, 11, 30), ReportRange.month("2023-11", TODAY).to());
        assertThrows(InvalidRequestException.class, () -> ReportRange.checkedDay(TODAY.plusDays(1), TODAY, "asOf"));
        assertThrows(InvalidRequestException.class,
                () -> ReportRange.checkedDay(earliest.minusDays(1), TODAY, "asOf"));
    }

    @Test
    void threeHundredSixtySixDaysPassAndThreeHundredSixtySevenAreRefused() {
        LocalDate from = LocalDate.of(2025, 11, 19);
        ReportRange ok = ReportRange.of(from, from.plusDays(365), TODAY.plusYears(1), ReportRange.MAX_DAYS);
        assertEquals(366, ok.days());
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> ReportRange.of(from, from.plusDays(366), TODAY.plusYears(1), ReportRange.MAX_DAYS));
        assertTrue(e.getMessage().startsWith("VALIDATION:"));
    }

    @Test
    void dayBookAllowsThirtyOneDays() {
        LocalDate from = LocalDate.of(2026, 10, 1);
        assertEquals(31, ReportRange.ofOrToday(from, from.plusDays(30), TODAY, ReportRange.DAY_BOOK_MAX_DAYS).days());
        assertThrows(InvalidRequestException.class,
                () -> ReportRange.ofOrToday(from, from.plusDays(31), TODAY, ReportRange.DAY_BOOK_MAX_DAYS));
        ReportRange today = ReportRange.ofOrToday(null, null, TODAY, ReportRange.DAY_BOOK_MAX_DAYS);
        assertEquals(TODAY, today.from());
        assertEquals(TODAY, today.to());
    }

    @Test
    void refusesFromAfterToAndToAfterToday() {
        assertThrows(InvalidRequestException.class,
                () -> ReportRange.of(TODAY, TODAY.minusDays(1), TODAY, ReportRange.MAX_DAYS));
        assertThrows(InvalidRequestException.class,
                () -> ReportRange.of(TODAY, TODAY.plusDays(1), TODAY, ReportRange.MAX_DAYS));
    }

    @Test
    void noDatesMeansThisMonthToToday() {
        ReportRange range = ReportRange.of(null, null, TODAY, ReportRange.MAX_DAYS);
        assertEquals(LocalDate.of(2026, 11, 1), range.from());
        assertEquals(TODAY, range.to());
    }

    @Test
    void monthParsesAndStopsAtToday() {
        ReportRange october = ReportRange.month("2026-10", TODAY);
        assertEquals(LocalDate.of(2026, 10, 1), october.from());
        assertEquals(LocalDate.of(2026, 10, 31), october.to());
        ReportRange february = ReportRange.month("2024-02", TODAY);
        assertEquals(LocalDate.of(2024, 2, 29), february.to());
        ReportRange current = ReportRange.month("2026-11", TODAY);
        assertEquals(LocalDate.of(2026, 11, 1), current.from());
        assertEquals(TODAY, current.to());
        assertThrows(InvalidRequestException.class, () -> ReportRange.month("2026-12", TODAY));
        assertThrows(InvalidRequestException.class, () -> ReportRange.month("2026-13", TODAY));
        assertThrows(InvalidRequestException.class, () -> ReportRange.month("Nov 2026", TODAY));
    }

    @Test
    void financialYearOfADate() {
        assertEquals("2026-27", ReportRange.financialYear(LocalDate.of(2026, 4, 1), 4));
        assertEquals("2025-26", ReportRange.financialYear(LocalDate.of(2026, 3, 31), 4));
        assertEquals("2026", ReportRange.financialYear(LocalDate.of(2026, 3, 31), 1));
    }
}
