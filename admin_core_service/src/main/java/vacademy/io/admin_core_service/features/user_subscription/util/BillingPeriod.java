package vacademy.io.admin_core_service.features.user_subscription.util;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;

/**
 * Calendar-month billing (PAYMENT_SETTING.calendarMonthBilling, off by default).
 *
 * <p>Plans store validity in days (30, 90, 180, 365). Counted in days, a monthly member's due
 * date drifts (30-day months) and a late payment moves it to the payment day. Institutes that
 * bill each learner on a fixed day of the month (their first class date) switch this on: a
 * plan whose validity is about 1, 2, 3, 6 or 12 months then moves by calendar months, and a
 * renewal keeps the learner's own due date even when paid late.
 */
public final class BillingPeriod {

    private BillingPeriod() {}

    /** Calendar months a validity in days stands for, or null when it is not a month-shaped plan. */
    public static Integer calendarMonths(Integer validityDays) {
        if (validityDays == null) return null;
        int d = validityDays;
        if (d >= 28 && d <= 31) return 1;
        if (d >= 56 && d <= 62) return 2;
        if (d >= 84 && d <= 93) return 3;
        if (d >= 168 && d <= 186) return 6;
        if (d >= 360 && d <= 366) return 12;
        return null;
    }

    /** {@code from} plus the plan's period: calendar months when month-shaped, else days. Keeps the time of day. */
    public static Date add(Date from, int validityDays, boolean calendarMonths, ZoneId zone) {
        Integer months = calendarMonths ? calendarMonths(validityDays) : null;
        LocalDateTime t = LocalDateTime.ofInstant(from.toInstant(), zone);
        LocalDateTime next = months != null ? t.plusMonths(months) : t.plusDays(validityDays);
        return Date.from(next.atZone(zone).toInstant());
    }

    /**
     * Where the next period starts on renewal. Day mode (unchanged behaviour): the current end
     * date when still in the future, else now. Calendar mode: the current end date, so a late
     * payment keeps the learner's due date, unless that date is more than a whole period in the
     * past (a long lapse), when the new period starts now.
     */
    public static Date renewalBase(Date currentEnd, Date now, int validityDays, boolean calendarMonths, ZoneId zone) {
        if (currentEnd == null) return now;
        if (!calendarMonths) return currentEnd.before(now) ? now : currentEnd;
        Date oneLater = add(currentEnd, validityDays, true, zone);
        return oneLater.before(now) ? now : currentEnd;
    }
}
