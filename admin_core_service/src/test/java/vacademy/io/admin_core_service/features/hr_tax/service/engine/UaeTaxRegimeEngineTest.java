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
 * Pure unit tests for the UAE payroll engine. Expected values are hand-computed
 * from the statutes — GPSSA pension (employee 5% / employer 12.5% of the
 * contribution base, AED 1,000–50,000 band, UAE nationals only) and the EOSB
 * accrual under Federal Decree-Law 33/2021 art. 51 (21 days/year first 5 years,
 * 30 days/year after, daily basic = monthly basic / 30) — and asserted as exact
 * BigDecimal amounts via compareTo (scale-insensitive).
 */
@DisplayName("UaeTaxRegimeEngine")
class UaeTaxRegimeEngineTest {

    private final UaeTaxRegimeEngine engine = new UaeTaxRegimeEngine();

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
    @DisplayName("getCountryCode is ARE")
    void countryCode() {
        assertEquals("ARE", engine.getCountryCode());
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
                    .grossForMonth(new BigDecimal("30000"))
                    .grossMonthlyFull(new BigDecimal("30000"))
                    .ytdTaxableIncome(new BigDecimal("60000"))
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            assertAmount("monthlyTax", "0", result.getMonthlyTax());
            assertAmount("projectedAnnualTax", "0", result.getProjectedAnnualTax());
            assertAmount("projectedAnnualTaxable", "0", result.getProjectedAnnualTaxable());
            assertAmount("totalExemptions", "0", result.getTotalExemptions());
            // Projection still carries the gross: 60,000 ytd + 30,000 + 11 x 30,000.
            assertAmount("projectedAnnualGross", "420000", result.getProjectedAnnualGross());
            assertNotNull(result.getBreakdown(), "breakdown must not be null");
            assertNotNull(result.getBreakdown().get("note"), "breakdown must explain the zero tax");
        }
    }

    // ==================================================================
    // GPSSA pension
    // ==================================================================

    @Nested
    @DisplayName("GPSSA pension")
    class Gpssa {

        @Test
        @DisplayName("Emirati on basic 20,000: base 20,000 -> employee 5% = 1,000.00, employer 12.5% = 2,500.00")
        void emiratiWithinBand() {
            TaxInput in = baseInput()
                    .nationality("Emirati")
                    .basicForMonth(new BigDecimal("20000"))
                    .basicMonthlyFull(new BigDecimal("20000"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);
            StatutoryItem gpssa = item(items, "GPSSA").orElseThrow(
                    () -> new AssertionError("GPSSA item missing for a UAE national"));

            assertAmount("GPSSA contribution base", "20000",
                    (BigDecimal) gpssa.getDetail().get("contributionBase"));
            assertAmount("GPSSA employee (5%)", "1000.00", gpssa.getEmployeeMonthly());
            assertAmount("GPSSA employer (12.5%)", "2500.00", gpssa.getEmployerMonthly());
        }

        @Test
        @DisplayName("base clamps at the AED 50,000 ceiling: basic 60,000 -> base 50,000, employee 2,500.00, employer 6,250.00")
        void baseClampsAtCeiling() {
            TaxInput in = baseInput()
                    .nationality("Emirati")
                    .basicForMonth(new BigDecimal("60000"))
                    .basicMonthlyFull(new BigDecimal("60000"))
                    .build();

            StatutoryItem gpssa = item(engine.calculateStatutory(in), "GPSSA").orElseThrow();

            assertAmount("GPSSA contribution base (clamped)", "50000",
                    (BigDecimal) gpssa.getDetail().get("contributionBase"));
            assertAmount("GPSSA employee (5% of 50,000)", "2500.00", gpssa.getEmployeeMonthly());
            assertAmount("GPSSA employer (12.5% of 50,000)", "6250.00", gpssa.getEmployerMonthly());
        }

        @Test
        @DisplayName("expat (nationality Indian) gets no GPSSA item — EOSB still accrues")
        void expatHasNoGpssa() {
            TaxInput in = baseInput()
                    .nationality("Indian")
                    .basicForMonth(new BigDecimal("20000"))
                    .basicMonthlyFull(new BigDecimal("20000"))
                    .serviceYears(new BigDecimal("2"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertTrue(item(items, "GPSSA").isEmpty(), "expats must not carry GPSSA");
            assertTrue(item(items, "EOSB").isPresent(), "EOSB applies to every employee");
        }
    }

    // ==================================================================
    // EOSB accrual — art. 51, Federal Decree-Law 33/2021
    // ==================================================================

    @Nested
    @DisplayName("EOSB accrual (art. 51)")
    class Eosb {

        @Test
        @DisplayName("basic 9,000, 2 years of service: daily 300, 21 days band -> 21 x 300 / 12 = 525.00/month, employee side zero")
        void firstBandAccrual() {
            TaxInput in = baseInput()
                    .nationality("Indian")
                    .basicForMonth(new BigDecimal("9000"))
                    .basicMonthlyFull(new BigDecimal("9000"))
                    .serviceYears(new BigDecimal("2"))
                    .build();

            StatutoryItem eosb = item(engine.calculateStatutory(in), "EOSB").orElseThrow();

            assertAmount("EOSB employee side", "0", eosb.getEmployeeMonthly());
            assertAmount("EOSB monthly accrual (21-day band)", "525.00", eosb.getEmployerMonthly());
            assertAmount("daysPerYear", "21", (BigDecimal) eosb.getDetail().get("daysPerYear"));
        }

        @Test
        @DisplayName("basic 9,000, 7 years of service: 30 days band -> 30 x 300 / 12 = 750.00/month")
        void secondBandAccrual() {
            TaxInput in = baseInput()
                    .nationality("Indian")
                    .basicForMonth(new BigDecimal("9000"))
                    .basicMonthlyFull(new BigDecimal("9000"))
                    .serviceYears(new BigDecimal("7"))
                    .build();

            StatutoryItem eosb = item(engine.calculateStatutory(in), "EOSB").orElseThrow();

            assertAmount("EOSB monthly accrual (30-day band)", "750.00", eosb.getEmployerMonthly());
            assertAmount("daysPerYear", "30", (BigDecimal) eosb.getDetail().get("daysPerYear"));
        }
    }

    // ==================================================================
    // statutory_settings disable flags
    // ==================================================================

    @Nested
    @DisplayName("statutory_settings overrides")
    class DisableFlags {

        @Test
        @DisplayName("gpssa_enabled=false suppresses GPSSA for a national but keeps EOSB")
        void gpssaDisabled() {
            TaxInput in = baseInput()
                    .nationality("Emirati")
                    .basicForMonth(new BigDecimal("20000"))
                    .basicMonthlyFull(new BigDecimal("20000"))
                    .serviceYears(new BigDecimal("3"))
                    .statutorySettings(Map.of("gpssa_enabled", "false"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertTrue(item(items, "GPSSA").isEmpty(), "GPSSA must be suppressed");
            assertTrue(item(items, "EOSB").isPresent(), "EOSB must survive the GPSSA flag");
        }

        @Test
        @DisplayName("eosb_enabled=false suppresses EOSB but keeps GPSSA")
        void eosbDisabled() {
            TaxInput in = baseInput()
                    .nationality("Emirati")
                    .basicForMonth(new BigDecimal("20000"))
                    .basicMonthlyFull(new BigDecimal("20000"))
                    .serviceYears(new BigDecimal("3"))
                    .statutorySettings(Map.of("eosb_enabled", "false"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertTrue(item(items, "EOSB").isEmpty(), "EOSB must be suppressed");
            assertTrue(item(items, "GPSSA").isPresent(), "GPSSA must survive the EOSB flag");
        }
    }
}
