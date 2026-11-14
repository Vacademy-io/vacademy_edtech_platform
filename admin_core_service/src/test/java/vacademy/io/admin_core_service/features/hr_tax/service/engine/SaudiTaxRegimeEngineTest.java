package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pure unit tests for the Saudi Arabia payroll engine. Expected values are
 * hand-computed from the statutes — GOSI (Saudi nationals: employee 9.75%,
 * employer 11.75%; expats: employer-only 2% occupational hazard; base clamped
 * to SAR 1,500–45,000) and the EOSB accrual under Labor Law art. 84 (half a
 * month's basic per year for the first 5 years, a full month after) — and
 * asserted as exact BigDecimal amounts via compareTo (scale-insensitive).
 */
@DisplayName("SaudiTaxRegimeEngine")
class SaudiTaxRegimeEngineTest {

    private final SaudiTaxRegimeEngine engine = new SaudiTaxRegimeEngine();

    /** Scale-insensitive exact-amount assertion. */
    private static void assertAmount(String what, String expected, BigDecimal actual) {
        assertNotNull(actual, what + " must not be null");
        assertEquals(0, new BigDecimal(expected).compareTo(actual),
                what + ": expected " + expected + " but was " + actual);
    }

    private static TaxInput.TaxInputBuilder baseInput() {
        return TaxInput.builder()
                .financialYear("2026")
                .year(2026)
                .month(1)
                .monthsRemainingAfterCurrent(11)
                .taxRules(Map.of())
                .statutorySettings(Map.of())
                .declarations(Map.of());
    }

    private static Optional<StatutoryItem> item(List<StatutoryItem> items, String code) {
        return items.stream().filter(i -> code.equals(i.getCode())).findFirst();
    }

    @Test
    @DisplayName("getCountryCode is SAU")
    void countryCode() {
        assertEquals("SAU", engine.getCountryCode());
    }

    // ==================================================================
    // calculateMonthlyTax — always zero
    // ==================================================================

    @Nested
    @DisplayName("calculateMonthlyTax")
    class IncomeTax {

        @Test
        @DisplayName("no personal income tax: monthly and annual tax are zero, with an explanatory breakdown note")
        void incomeTaxIsAlwaysZero() {
            TaxInput in = baseInput()
                    .grossForMonth(new BigDecimal("15000"))
                    .grossMonthlyFull(new BigDecimal("15000"))
                    .ytdTaxableIncome(new BigDecimal("30000"))
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            assertAmount("monthlyTax", "0", result.getMonthlyTax());
            assertAmount("projectedAnnualTax", "0", result.getProjectedAnnualTax());
            assertAmount("projectedAnnualTaxable", "0", result.getProjectedAnnualTaxable());
            assertAmount("totalExemptions", "0", result.getTotalExemptions());
            // Projection still carries the gross: 30,000 ytd + 15,000 + 11 x 15,000.
            assertAmount("projectedAnnualGross", "210000", result.getProjectedAnnualGross());
            assertNotNull(result.getBreakdown(), "breakdown must not be null");
            assertNotNull(result.getBreakdown().get("note"), "breakdown must explain the zero tax");
        }
    }

    // ==================================================================
    // GOSI
    // ==================================================================

    @Nested
    @DisplayName("GOSI")
    class Gosi {

        @Test
        @DisplayName("Saudi national on basic 10,000: employee 9.75% = 975.00, employer 11.75% = 1,175.00")
        void saudiNationalRates() {
            TaxInput in = baseInput()
                    .nationality("Saudi")
                    .basicForMonth(new BigDecimal("10000"))
                    .basicMonthlyFull(new BigDecimal("10000"))
                    .build();

            StatutoryItem gosi = item(engine.calculateStatutory(in), "GOSI").orElseThrow(
                    () -> new AssertionError("GOSI item missing"));

            assertAmount("GOSI contribution base", "10000",
                    (BigDecimal) gosi.getDetail().get("contributionBase"));
            assertEquals(Boolean.TRUE, gosi.getDetail().get("national"));
            assertAmount("GOSI employee (9.75%)", "975.00", gosi.getEmployeeMonthly());
            assertAmount("GOSI employer (11.75%)", "1175.00", gosi.getEmployerMonthly());
        }

        @Test
        @DisplayName("expat on basic 10,000: employee 0, employer-only occupational hazard 2% = 200.00")
        void expatEmployerOnly() {
            TaxInput in = baseInput()
                    .nationality("Indian")
                    .basicForMonth(new BigDecimal("10000"))
                    .basicMonthlyFull(new BigDecimal("10000"))
                    .build();

            StatutoryItem gosi = item(engine.calculateStatutory(in), "GOSI").orElseThrow();

            assertEquals(Boolean.FALSE, gosi.getDetail().get("national"));
            assertAmount("GOSI employee (expat)", "0", gosi.getEmployeeMonthly());
            assertAmount("GOSI employer (2%)", "200.00", gosi.getEmployerMonthly());
        }

        @Test
        @DisplayName("base clamps at the SAR 45,000 ceiling: basic 50,000 -> employee 4,387.50, employer 5,287.50")
        void baseClampsAtCeiling() {
            TaxInput in = baseInput()
                    .nationality("Saudi")
                    .basicForMonth(new BigDecimal("50000"))
                    .basicMonthlyFull(new BigDecimal("50000"))
                    .build();

            StatutoryItem gosi = item(engine.calculateStatutory(in), "GOSI").orElseThrow();

            assertAmount("GOSI contribution base (clamped)", "45000",
                    (BigDecimal) gosi.getDetail().get("contributionBase"));
            assertAmount("GOSI employee (9.75% of 45,000)", "4387.50", gosi.getEmployeeMonthly());
            assertAmount("GOSI employer (11.75% of 45,000)", "5287.50", gosi.getEmployerMonthly());
        }

        @Test
        @DisplayName("base floors at SAR 1,500: basic 1,000 -> employee 146.25, employer 176.25")
        void baseFloorsAtMinimum() {
            TaxInput in = baseInput()
                    .nationality("Saudi")
                    .basicForMonth(new BigDecimal("1000"))
                    .basicMonthlyFull(new BigDecimal("1000"))
                    .build();

            StatutoryItem gosi = item(engine.calculateStatutory(in), "GOSI").orElseThrow();

            assertAmount("GOSI contribution base (floored)", "1500",
                    (BigDecimal) gosi.getDetail().get("contributionBase"));
            assertAmount("GOSI employee (9.75% of 1,500)", "146.25", gosi.getEmployeeMonthly());
            assertAmount("GOSI employer (11.75% of 1,500)", "176.25", gosi.getEmployerMonthly());
        }
    }

    // ==================================================================
    // EOSB accrual — Labor Law art. 84
    // ==================================================================

    @Nested
    @DisplayName("EOSB accrual (art. 84)")
    class Eosb {

        @Test
        @DisplayName("basic 12,000, 3 years of service: half-month band -> 0.5 x 12,000 / 12 = 500.00/month, employee side zero")
        void firstBandAccrual() {
            TaxInput in = baseInput()
                    .nationality("Indian")
                    .basicForMonth(new BigDecimal("12000"))
                    .basicMonthlyFull(new BigDecimal("12000"))
                    .serviceYears(new BigDecimal("3"))
                    .build();

            StatutoryItem eosb = item(engine.calculateStatutory(in), "EOSB").orElseThrow();

            assertAmount("EOSB employee side", "0", eosb.getEmployeeMonthly());
            assertAmount("EOSB monthly accrual (half-month band)", "500.00", eosb.getEmployerMonthly());
            assertAmount("monthsPerYear", "0.5", (BigDecimal) eosb.getDetail().get("monthsPerYear"));
        }

        @Test
        @DisplayName("basic 12,000, 6 years of service: full-month band -> 12,000 / 12 = 1,000.00/month")
        void secondBandAccrual() {
            TaxInput in = baseInput()
                    .nationality("Indian")
                    .basicForMonth(new BigDecimal("12000"))
                    .basicMonthlyFull(new BigDecimal("12000"))
                    .serviceYears(new BigDecimal("6"))
                    .build();

            StatutoryItem eosb = item(engine.calculateStatutory(in), "EOSB").orElseThrow();

            assertAmount("EOSB monthly accrual (full-month band)", "1000.00", eosb.getEmployerMonthly());
            assertAmount("monthsPerYear", "1", (BigDecimal) eosb.getDetail().get("monthsPerYear"));
        }
    }

    // ==================================================================
    // statutory_settings disable flags
    // ==================================================================

    @Nested
    @DisplayName("statutory_settings overrides")
    class DisableFlags {

        @Test
        @DisplayName("gosi_enabled=false suppresses GOSI but keeps EOSB")
        void gosiDisabled() {
            TaxInput in = baseInput()
                    .nationality("Saudi")
                    .basicForMonth(new BigDecimal("12000"))
                    .basicMonthlyFull(new BigDecimal("12000"))
                    .serviceYears(new BigDecimal("3"))
                    .statutorySettings(Map.of("gosi_enabled", "false"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertTrue(item(items, "GOSI").isEmpty(), "GOSI must be suppressed");
            assertTrue(item(items, "EOSB").isPresent(), "EOSB must survive the GOSI flag");
        }

        @Test
        @DisplayName("eosb_enabled=false suppresses EOSB but keeps GOSI")
        void eosbDisabled() {
            TaxInput in = baseInput()
                    .nationality("Saudi")
                    .basicForMonth(new BigDecimal("12000"))
                    .basicMonthlyFull(new BigDecimal("12000"))
                    .serviceYears(new BigDecimal("3"))
                    .statutorySettings(Map.of("eosb_enabled", "false"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertTrue(item(items, "EOSB").isEmpty(), "EOSB must be suppressed");
            assertTrue(item(items, "GOSI").isPresent(), "GOSI must survive the EOSB flag");
        }
    }
}
