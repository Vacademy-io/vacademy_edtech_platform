package vacademy.io.admin_core_service.features.commerce.parallelrun;

import vacademy.io.admin_core_service.features.commerce.parallelrun.enums.ParallelRunResult;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The comparison of one parallel-run day and the clean-day streak (WP-53 lane D). Pure: no
 * database, no clock.
 *
 * <ul>
 *   <li>A day is CLEAN when the old system's bill count equals the platform's and each of sales
 *       value, tax and cash differs by at most {@link #TOLERANCE} (returns too, when the old
 *       figure was given); otherwise DIFFERENT.</li>
 *   <li>Differences are "old system minus platform".</li>
 *   <li>The streak counts consecutive clean days backwards from the latest saved day. A saved day
 *       that is not clean ends it; a day with platform activity (bills, cash, returns or an open
 *       session) and no saved row ends it; a day with no activity and no saved row (the store was
 *       closed) is skipped. This is the same rule the day list uses for "not saved".</li>
 * </ul>
 */
public final class ParallelRunMath {

    /** Largest difference per money figure that still counts as clean. */
    public static final BigDecimal TOLERANCE = new BigDecimal("1.00");
    /** Clean days in a row that pass the parallel run. */
    public static final int CLEAN_DAYS_NEEDED = 7;

    private ParallelRunMath() {
    }

    /**
     * The platform's figures of one location and business date.
     *
     * @param bills        live POS invoices (counter sales and bill-book entries) dated that day
     * @param salesValue   their total, tax included, after round-off
     * @param tax          their tax
     * @param cash         cash received less cash refunded that day
     * @param returns      credit notes of POS invoices dated that day
     * @param openSessions counter sessions still open that covered the day
     */
    public record Figures(long bills, BigDecimal salesValue, BigDecimal tax, BigDecimal cash, BigDecimal returns,
                          int openSessions) {

        public Figures {
            salesValue = money(salesValue);
            tax = money(tax);
            cash = money(cash);
            returns = money(returns);
        }

        public static Figures zero() {
            return new Figures(0, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, 0);
        }
    }

    /** The old system's day totals as entered; {@code returns} null = not compared. */
    public record OldFigures(int billCount, BigDecimal salesValue, BigDecimal tax, BigDecimal cash,
                             BigDecimal returns) {

        public OldFigures {
            salesValue = money(salesValue);
            tax = money(tax);
            cash = money(cash);
            returns = returns == null ? null : money(returns);
        }
    }

    /** Old system minus platform; {@code returns} null when the old returns were not given. */
    public record Differences(long bills, BigDecimal salesValue, BigDecimal tax, BigDecimal cash,
                              BigDecimal returns) {
    }

    public static Differences differences(OldFigures old, Figures platform) {
        return new Differences(
                old.billCount() - platform.bills(),
                old.salesValue().subtract(platform.salesValue()),
                old.tax().subtract(platform.tax()),
                old.cash().subtract(platform.cash()),
                old.returns() == null ? null : old.returns().subtract(platform.returns()));
    }

    public static ParallelRunResult result(OldFigures old, Figures platform) {
        Differences d = differences(old, platform);
        boolean clean = d.bills() == 0
                && withinTolerance(d.salesValue())
                && withinTolerance(d.tax())
                && withinTolerance(d.cash())
                && (d.returns() == null || withinTolerance(d.returns()));
        return clean ? ParallelRunResult.CLEAN : ParallelRunResult.DIFFERENT;
    }

    static boolean withinTolerance(BigDecimal difference) {
        return difference.abs().compareTo(TOLERANCE) <= 0;
    }

    /**
     * Whether two platform readings of a day hold the same compared figures (bills, sales value,
     * tax, cash, returns; open sessions are not a figure). False when either is null.
     */
    public static boolean sameFigures(Figures a, Figures b) {
        if (a == null || b == null) {
            return false;
        }
        return a.bills() == b.bills()
                && a.salesValue().compareTo(b.salesValue()) == 0
                && a.tax().compareTo(b.tax()) == 0
                && a.cash().compareTo(b.cash()) == 0
                && a.returns().compareTo(b.returns()) == 0;
    }

    /**
     * One day for the streak.
     *
     * @param platformBills the platform's bills that day
     * @param clean         null when no row is saved for the day; else whether the saved day counts
     *                      as clean
     * @param activity      the platform had anything to compare that day (bills, cash, returns or
     *                      an open session)
     */
    public record StreakDay(LocalDate date, long platformBills, Boolean clean, boolean activity) {

        /** A day whose only activity is its bills. */
        public StreakDay(LocalDate date, long platformBills, Boolean clean) {
            this(date, platformBills, clean, platformBills > 0);
        }

        /** The day as the platform read it. */
        public static StreakDay of(LocalDate date, Figures live, Boolean clean) {
            return new StreakDay(date, live.bills(), clean, hasActivity(live));
        }
    }

    /** Bills, cash, returns or an open session: the day has something to compare. */
    public static boolean hasActivity(Figures live) {
        return live.bills() > 0 || live.openSessions() > 0 || live.cash().signum() != 0
                || live.returns().signum() != 0;
    }

    /**
     * Consecutive clean days ending at the latest saved day (0 when none is saved). The list may be
     * in any order; days outside it count as closed days.
     */
    public static int streak(List<StreakDay> days) {
        List<StreakDay> sorted = new ArrayList<>(days);
        sorted.sort(Comparator.comparing(StreakDay::date));
        int latestSaved = -1;
        for (int i = sorted.size() - 1; i >= 0; i--) {
            if (sorted.get(i).clean() != null) {
                latestSaved = i;
                break;
            }
        }
        int streak = 0;
        for (int i = latestSaved; i >= 0; i--) {
            StreakDay day = sorted.get(i);
            if (day.clean() == null) {
                if (day.activity()) {
                    break;
                }
                continue;
            }
            if (!day.clean()) {
                break;
            }
            streak++;
        }
        return streak;
    }

    public static boolean passed(int streak) {
        return streak >= CLEAN_DAYS_NEEDED;
    }

    static BigDecimal money(BigDecimal value) {
        return (value == null ? BigDecimal.ZERO : value).setScale(2, RoundingMode.HALF_UP);
    }
}
