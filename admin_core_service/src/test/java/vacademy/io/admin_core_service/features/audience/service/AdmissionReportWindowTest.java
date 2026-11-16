package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The Admissions and Conversions reports check an enrolment without enrolled_date on its created_at
 * (UTC wall clock) against the window's local midnights. Those bounds must be the instant the
 * institute's day starts, so a row counts on the same day as COALESCE(enrolled_date, local day).
 */
class AdmissionReportWindowTest {

    @Test
    void kolkataDayStartsAtPreviousEvening() {
        assertEquals("2026-10-13T18:30",
                AdmissionReportService.utcWallClock(LocalDate.of(2026, 10, 14), ZoneId.of("Asia/Kolkata")));
    }

    @Test
    void utcDayStartsAtMidnight() {
        assertEquals("2026-10-14T00:00",
                AdmissionReportService.utcWallClock(LocalDate.of(2026, 10, 14), ZoneId.of("UTC")));
    }

    @Test
    void daylightSavingOffsetIsTheOneInForceThatDay() {
        ZoneId newYork = ZoneId.of("America/New_York");
        // EDT (UTC-4) in July, EST (UTC-5) in December.
        assertEquals("2026-07-01T04:00", AdmissionReportService.utcWallClock(LocalDate.of(2026, 7, 1), newYork));
        assertEquals("2026-12-01T05:00", AdmissionReportService.utcWallClock(LocalDate.of(2026, 12, 1), newYork));
    }
}
