package vacademy.io.admin_core_service.features.commerce.parallelrun;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Differences;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Figures;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.OldFigures;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.StreakDay;
import vacademy.io.admin_core_service.features.commerce.parallelrun.enums.ParallelRunResult;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The day verdict (₹1.00 tolerance, bills exact, returns optional) and the clean-day streak. */
class ParallelRunMathTest {

    private static final LocalDate D1 = LocalDate.of(2026, 11, 1);

    private static BigDecimal m(String value) {
        return new BigDecimal(value);
    }

    private static Figures platform(long bills, String sales, String tax, String cash, String returns) {
        return new Figures(bills, m(sales), m(tax), m(cash), m(returns), 0);
    }

    private static OldFigures old(int bills, String sales, String tax, String cash, String returns) {
        return new OldFigures(bills, m(sales), m(tax), m(cash), returns == null ? null : m(returns));
    }

    private static final Figures PLATFORM = platform(2, "800.00", "38.10", "400.00", "100.00");

    @Test
    void sameFiguresAreClean() {
        assertEquals(ParallelRunResult.CLEAN, ParallelRunMath.result(old(2, "800", "38.10", "400", null), PLATFORM));
    }

    @Test
    void oneRupeeIsCleanAndOneRupeeOnePaisaIsDifferent() {
        assertEquals(ParallelRunResult.CLEAN,
                ParallelRunMath.result(old(2, "801.00", "37.10", "399.00", null), PLATFORM));
        assertEquals(ParallelRunResult.DIFFERENT,
                ParallelRunMath.result(old(2, "801.01", "38.10", "400.00", null), PLATFORM));
        assertEquals(ParallelRunResult.DIFFERENT,
                ParallelRunMath.result(old(2, "800.00", "36.09", "400.00", null), PLATFORM));
        assertEquals(ParallelRunResult.DIFFERENT,
                ParallelRunMath.result(old(2, "800.00", "38.10", "398.99", null), PLATFORM));
    }

    @Test
    void billsOffByOneIsDifferent() {
        assertEquals(ParallelRunResult.DIFFERENT,
                ParallelRunMath.result(old(3, "800", "38.10", "400", null), PLATFORM));
        assertEquals(ParallelRunResult.DIFFERENT,
                ParallelRunMath.result(old(1, "800", "38.10", "400", null), PLATFORM));
    }

    @Test
    void returnsAreComparedOnlyWhenGiven() {
        assertEquals(ParallelRunResult.CLEAN, ParallelRunMath.result(old(2, "800", "38.10", "400", null), PLATFORM));
        assertEquals(ParallelRunResult.CLEAN,
                ParallelRunMath.result(old(2, "800", "38.10", "400", "101.00"), PLATFORM));
        assertEquals(ParallelRunResult.DIFFERENT,
                ParallelRunMath.result(old(2, "800", "38.10", "400", "0"), PLATFORM));
    }

    @Test
    void differencesAreOldMinusPlatform() {
        Differences d = ParallelRunMath.differences(old(3, "790.50", "38.10", "402", null), PLATFORM);
        assertEquals(1, d.bills());
        assertEquals(m("-9.50"), d.salesValue());
        assertEquals(m("0.00"), d.tax());
        assertEquals(m("2.00"), d.cash());
        assertNull(d.returns());
    }

    @Test
    void sameFiguresIgnoresOpenSessionsAndScale() {
        Figures a = new Figures(2, m("800"), m("38.1"), m("400"), m("100"), 0);
        Figures b = new Figures(2, m("800.00"), m("38.10"), m("400.00"), m("100.00"), 3);
        assertTrue(ParallelRunMath.sameFigures(a, b));
        assertFalse(ParallelRunMath.sameFigures(a, platform(2, "800.01", "38.10", "400", "100")));
        assertFalse(ParallelRunMath.sameFigures(null, b));
    }

    // ------------------------------------------------------------------ streak

    private static List<StreakDay> cleanDays(int n) {
        List<StreakDay> days = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            days.add(new StreakDay(D1.plusDays(i), 5, true));
        }
        return days;
    }

    @Test
    void sevenCleanDaysPass() {
        int streak = ParallelRunMath.streak(cleanDays(7));
        assertEquals(7, streak);
        assertTrue(ParallelRunMath.passed(streak));
        assertFalse(ParallelRunMath.passed(6));
    }

    @Test
    void aDifferentDayResetsTheStreak() {
        List<StreakDay> days = cleanDays(7);
        days.set(3, new StreakDay(D1.plusDays(3), 5, false));
        assertEquals(3, ParallelRunMath.streak(days));
        days.set(6, new StreakDay(D1.plusDays(6), 5, false));
        assertEquals(0, ParallelRunMath.streak(days));
    }

    @Test
    void anUnsavedTradingDayResetsTheStreak() {
        List<StreakDay> days = cleanDays(7);
        days.set(2, new StreakDay(D1.plusDays(2), 4, null));
        assertEquals(4, ParallelRunMath.streak(days));
    }

    @Test
    void aClosedDayIsSkipped() {
        List<StreakDay> days = cleanDays(8);
        days.set(4, new StreakDay(D1.plusDays(4), 0, null));
        assertEquals(7, ParallelRunMath.streak(days));
        assertTrue(ParallelRunMath.passed(ParallelRunMath.streak(days)));
    }

    @Test
    void theStreakEndsAtTheLatestSavedDayAndDaysAfterItDoNotCount() {
        List<StreakDay> days = cleanDays(7);
        // Today and yesterday traded but are not saved yet: the streak still ends at the latest saved day.
        days.add(new StreakDay(D1.plusDays(7), 9, null));
        days.add(new StreakDay(D1.plusDays(8), 9, null));
        // Order of the list does not matter.
        java.util.Collections.reverse(days);
        assertEquals(7, ParallelRunMath.streak(days));
    }

    @Test
    void nothingSavedIsNoStreak() {
        assertEquals(0, ParallelRunMath.streak(List.of(new StreakDay(D1, 3, null))));
        assertEquals(0, ParallelRunMath.streak(List.of()));
    }
}
