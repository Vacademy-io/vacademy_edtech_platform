package vacademy.io.admin_core_service.features.engagement.report;

import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;

/**
 * One institute-local day as the daily report reads it, for the surfaces its numbers link to (the
 * task inbox filters, the outcomes lists): [D 00:00, D+1 00:00) in the institute's zone, as naive
 * UTC bounds, the storage of the engagement tables.
 */
public final class EngagementReportDay {

    private EngagementReportDay() {
    }

    /**
     * @param from     start of D, naive UTC
     * @param to       start of D+1, naive UTC
     * @param scanFrom how far back a row drafted before D may still have gone out on D (the report's
     *                 send-scan slack), so a scan stays on the created_at index
     */
    public record Bounds(LocalDate day, ZoneId zone, LocalDateTime from, LocalDateTime to, LocalDateTime scanFrom) {
    }

    /** The institute's zone as the report resolves it (aliases rewritten, bare offsets defaulted). */
    public static ZoneId zone(String timezoneId) {
        return EngagementDailyReportService.zone(timezoneId);
    }

    /** YYYY-MM-DD, any day; 400 when it is not a date. */
    public static LocalDate parse(String date) {
        try {
            return LocalDate.parse(date.trim());
        } catch (DateTimeParseException e) {
            throw new InvalidRequestException("date must be YYYY-MM-DD");
        }
    }

    /** As the report: 400 for a bad date, a future day or one more than 90 days back. */
    public static LocalDate parseReportDay(String date, ZoneId zone) {
        if (date == null || date.isBlank()) throw new InvalidRequestException("date is required");
        return EngagementDailyReportService.parseDay(date, LocalDate.now(zone));
    }

    public static Bounds bounds(LocalDate day, ZoneId zone) {
        Instant from = day.atStartOfDay(zone).toInstant();
        return new Bounds(day, zone, utc(from), utc(day.plusDays(1).atStartOfDay(zone).toInstant()),
                utc(from.minus(EngagementDailyReportService.SEND_SCAN_SLACK)));
    }

    /** A naive UTC timestamp as an ISO instant ("…Z"); null stays null. */
    public static String iso(LocalDateTime utc) {
        return utc == null ? null : utc.toInstant(ZoneOffset.UTC).toString();
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }
}
