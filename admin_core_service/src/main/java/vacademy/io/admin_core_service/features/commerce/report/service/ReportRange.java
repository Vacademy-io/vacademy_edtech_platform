package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.document.service.FinancialYear;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;

/**
 * The India dates of a report, both inclusive. Documents are filtered on their stored India
 * {@code document_date}; timestamp columns (UTC wall times, contract 3.1) on {@link #storedFrom()}
 * (inclusive) and {@link #storedToExclusive()}: the start of the India day turned into UTC here,
 * explicitly, so the answer is the same whatever the JVM's default zone. "Today" is always passed
 * in from the clock.
 */
public record ReportRange(LocalDate from, LocalDate to) {

    /** One financial year at most. */
    public static final int MAX_DAYS = 366;
    /** The day book's longest range. */
    public static final int DAY_BOOK_MAX_DAYS = 31;
    /** How far back a report may reach. */
    public static final int MAX_YEARS_BACK = 3;

    public static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    /**
     * A range from request parameters. No dates: this month up to today. Only {@code to}: from the
     * first of its month. Only {@code from}: up to today. Refused (400 {@code VALIDATION}): from after
     * to, to after today, more than {@code maxDays} days.
     */
    public static ReportRange of(LocalDate from, LocalDate to, LocalDate today, int maxDays) {
        LocalDate end = to != null ? to : today;
        LocalDate start = from != null ? from : end.withDayOfMonth(1);
        return checked(start, end, today, maxDays);
    }

    /** As {@link #of}, but no dates means today alone (the day book). */
    public static ReportRange ofOrToday(LocalDate from, LocalDate to, LocalDate today, int maxDays) {
        if (from == null && to == null) {
            return checked(today, today, today, maxDays);
        }
        LocalDate end = to != null ? to : (from.isAfter(today) ? from : today);
        LocalDate start = from != null ? from : end;
        return checked(start, end, today, maxDays);
    }

    /**
     * A calendar month {@code YYYY-MM} in India dates: the 1st to the last day, or to today for
     * the current month. A month after the current one is refused.
     */
    public static ReportRange month(String month, LocalDate today) {
        YearMonth yearMonth;
        try {
            yearMonth = YearMonth.parse(month == null ? "" : month.trim());
        } catch (DateTimeParseException e) {
            throw new InvalidRequestException("VALIDATION: month must be YYYY-MM");
        }
        LocalDate start = yearMonth.atDay(1);
        if (start.isAfter(today)) {
            throw new InvalidRequestException("VALIDATION: the month has not started yet");
        }
        if (yearMonth.atEndOfMonth().isBefore(earliest(today))) {
            throw new InvalidRequestException("VALIDATION: reports reach back " + MAX_YEARS_BACK + " years at most");
        }
        LocalDate end = yearMonth.atEndOfMonth();
        return new ReportRange(start, end.isAfter(today) ? today : end);
    }

    private static ReportRange checked(LocalDate from, LocalDate to, LocalDate today, int maxDays) {
        if (from.isAfter(to)) {
            throw new InvalidRequestException("VALIDATION: from must not be after to");
        }
        if (to.isAfter(today)) {
            throw new InvalidRequestException("VALIDATION: to must not be after today");
        }
        if (from.isBefore(earliest(today))) {
            throw new InvalidRequestException("VALIDATION: reports reach back " + MAX_YEARS_BACK + " years at most");
        }
        if (ChronoUnit.DAYS.between(from, to) + 1 > maxDays) {
            throw new InvalidRequestException("VALIDATION: the range is at most " + maxDays + " days");
        }
        return new ReportRange(from, to);
    }

    /** Days in the range, both ends counted. */
    public long days() {
        return ChronoUnit.DAYS.between(from, to) + 1;
    }

    /** The first day a report may name: {@value #MAX_YEARS_BACK} years before today. */
    public static LocalDate earliest(LocalDate today) {
        return today.minusYears(MAX_YEARS_BACK);
    }

    /** A date the caller named (as-of): not after today, not before {@link #earliest}; 400 {@code VALIDATION}. */
    public static LocalDate checkedDay(LocalDate day, LocalDate today, String field) {
        if (day == null) {
            return null;
        }
        if (day.isAfter(today)) {
            throw new InvalidRequestException("VALIDATION: " + field + " must not be after today");
        }
        if (day.isBefore(earliest(today))) {
            throw new InvalidRequestException("VALIDATION: reports reach back " + MAX_YEARS_BACK + " years at most");
        }
        return day;
    }

    /** The stored (UTC wall) time the first India day starts at. */
    public LocalDateTime storedFrom() {
        return storedStartOf(from);
    }

    /** The stored (UTC wall) time the day after the last India day starts at; exclusive. */
    public LocalDateTime storedToExclusive() {
        return storedStartOf(to.plusDays(1));
    }

    /**
     * The start of an India day as a stored timestamp holds it: UTC wall time (2026-11-01 →
     * 2026-10-31T18:30). Never through the JVM's default zone.
     */
    public static LocalDateTime storedStartOf(LocalDate indiaDay) {
        return indiaDay.atStartOfDay(INDIA).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    /** The financial-year label of a date ("2026-27" for a year that starts in April). */
    public static String financialYear(LocalDate date, int fyStartMonth) {
        return FinancialYear.of(date, fyStartMonth);
    }
}
