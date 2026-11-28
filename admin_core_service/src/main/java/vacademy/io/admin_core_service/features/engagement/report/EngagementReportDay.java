package vacademy.io.admin_core_service.features.engagement.report;

import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;

/**
 * The institute-local days the daily report reads, for the report and the surfaces its numbers
 * link to (the task inbox filters, the outcomes lists): a period of whole days [from 00:00,
 * to+1 00:00) in the institute's zone, as naive UTC bounds, the storage of the engagement tables.
 *
 * <p>Request rules (design v3): {@code from} + {@code to} (YYYY-MM-DD, inclusive) win over
 * {@code date}; {@code date=D} is {@code from=to=D}. No day is in the future or before today − 89
 * (a 90-day window), from ≤ to, and from / to come together. Each break is a 400.
 */
public final class EngagementReportDay {

    /** Days the report reaches back, today included: the earliest day is today − (MAX_DAYS − 1). */
    public static final int MAX_DAYS = 90;

    private EngagementReportDay() {
    }

    /** An inclusive run of institute-local days; from = to for a single day. */
    public record Period(LocalDate from, LocalDate to) {

        public static Period of(LocalDate day) {
            return new Period(day, day);
        }

        public int days() {
            return (int) ChronoUnit.DAYS.between(from, to) + 1;
        }

        public boolean contains(LocalDate d) {
            return d != null && !d.isBefore(from) && !d.isAfter(to);
        }
    }

    /**
     * @param from     start of the first day, naive UTC
     * @param to       start of the day after the last, naive UTC
     * @param scanFrom how far back a row drafted before the period may still have gone out in it
     *                 (the report's send-scan slack), so a scan stays on the created_at index
     */
    public record Bounds(Period period, ZoneId zone, LocalDateTime from, LocalDateTime to, LocalDateTime scanFrom) {
    }

    /** The institute's zone as the report resolves it (aliases rewritten, bare offsets defaulted). */
    public static ZoneId zone(String timezoneId) {
        return EngagementDailyReportService.zone(timezoneId);
    }

    /** The earliest day a period may start on. */
    public static LocalDate earliest(LocalDate today) {
        return today.minusDays(MAX_DAYS - 1L);
    }

    /** YYYY-MM-DD, any day; 400 when it is not a date. */
    public static LocalDate parse(String date) {
        try {
            return LocalDate.parse(date.trim());
        } catch (DateTimeParseException e) {
            throw new InvalidRequestException("date must be YYYY-MM-DD");
        }
    }

    /**
     * The report's period: from + to when given, else date as one day, else null (the caller
     * decides: the report reads today, the item lists need one).
     *
     * @throws InvalidRequestException a bad format, from after to, a future day, a day before
     *                                 today − 89, or only one of from / to
     */
    public static Period period(String date, String from, String to, LocalDate today) {
        Period range = range(from, to, today);
        if (range != null) return range;
        if (blank(date)) return null;
        return Period.of(day("date", date, today));
    }

    /** from + to alone (the inbox keeps its own looser date); null when neither is given. */
    public static Period range(String from, String to, LocalDate today) {
        boolean hasFrom = !blank(from), hasTo = !blank(to);
        if (!hasFrom && !hasTo) return null;
        if (!hasFrom || !hasTo) throw new InvalidRequestException("from and to must be given together");
        LocalDate f = day("from", from, today);
        LocalDate t = day("to", to, today);
        if (f.isAfter(t)) throw new InvalidRequestException("from is after to");
        return new Period(f, t);
    }

    static LocalDate day(String param, String value, LocalDate today) {
        LocalDate d;
        try {
            d = LocalDate.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw new InvalidRequestException(param + " must be YYYY-MM-DD");
        }
        if (d.isAfter(today)) {
            throw new InvalidRequestException(param + " is in the future");
        }
        if (d.isBefore(earliest(today))) {
            throw new InvalidRequestException(param + " is more than " + (MAX_DAYS - 1) + " days ago");
        }
        return d;
    }

    public static Bounds bounds(Period period, ZoneId zone) {
        Instant from = period.from().atStartOfDay(zone).toInstant();
        return new Bounds(period, zone, utc(from), utc(period.to().plusDays(1).atStartOfDay(zone).toInstant()),
                utc(from.minus(EngagementDailyReportService.SEND_SCAN_SLACK)));
    }

    /** A naive UTC timestamp as an ISO instant ("…Z"); null stays null. */
    public static String iso(LocalDateTime utc) {
        return utc == null ? null : utc.toInstant(ZoneOffset.UTC).toString();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }
}
