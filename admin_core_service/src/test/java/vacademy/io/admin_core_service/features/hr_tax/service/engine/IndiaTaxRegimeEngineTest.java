package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pure unit tests for the FY 2025-26 India tax engine. All expected values are
 * hand-computed from the Income-tax Act rules (new/old regime slabs, section 87A
 * incl. marginal relief, 4% cess) and the EPF/ESI/PT statutes, then asserted as
 * exact BigDecimal amounts via compareTo (scale-insensitive).
 */
@DisplayName("IndiaTaxRegimeEngine — FY 2025-26")
class IndiaTaxRegimeEngineTest {

    private final IndiaTaxRegimeEngine engine = new IndiaTaxRegimeEngine();

    private static final String FY = "2025-26";

    /** Scale-insensitive exact-amount assertion. */
    private static void assertAmount(String what, String expected, BigDecimal actual) {
        assertNotNull(actual, what + " must not be null");
        assertEquals(0, new BigDecimal(expected).compareTo(actual),
                what + ": expected " + expected + " but was " + actual);
    }

    private static TaxInput.TaxInputBuilder baseInput() {
        return TaxInput.builder()
                .financialYear(FY)
                .year(2025)
                .taxRules(Map.of())
                .statutorySettings(Map.of())
                .declarations(Map.of());
    }

    // ==================================================================
    // calculateMonthlyTax — NEW regime
    // ==================================================================

    @Nested
    @DisplayName("calculateMonthlyTax — new regime")
    class NewRegime {

        @Test
        @DisplayName("gross 1,00,000/month for the full year: taxable 11,25,000 <= 12,00,000 so section 87A rebate wipes the tax to zero")
        void fullRebateUnder12Lakh() {
            TaxInput in = baseInput()
                    .regime("NEW")
                    .month(4).monthsRemainingAfterCurrent(11)
                    .grossForMonth(new BigDecimal("100000"))
                    .grossMonthlyFull(new BigDecimal("100000"))
                    .ytdTaxableIncome(BigDecimal.ZERO)
                    .ytdTaxDeducted(BigDecimal.ZERO)
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            assertAmount("projectedAnnualGross", "1200000", result.getProjectedAnnualGross());
            assertAmount("totalExemptions (standard deduction)", "75000", result.getTotalExemptions());
            assertAmount("projectedAnnualTaxable", "1125000", result.getProjectedAnnualTaxable());
            assertAmount("projectedAnnualTax", "0", result.getProjectedAnnualTax());
            assertAmount("monthlyTax", "0", result.getMonthlyTax());
        }

        @Test
        @DisplayName("gross 2,00,000/month: annual 24,00,000 -> taxable 23,25,000 -> slab tax 2,81,250 + 4% cess = 2,92,500; monthly 24,375")
        void slabMathAt24Lakh() {
            TaxInput in = baseInput()
                    .regime("NEW")
                    .month(4).monthsRemainingAfterCurrent(11)
                    .grossForMonth(new BigDecimal("200000"))
                    .grossMonthlyFull(new BigDecimal("200000"))
                    .ytdTaxableIncome(BigDecimal.ZERO)
                    .ytdTaxDeducted(BigDecimal.ZERO)
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            // 4L@0 + 4L@5% (20,000) + 4L@10% (40,000) + 4L@15% (60,000)
            // + 4L@20% (80,000) + 3,25,000@25% (81,250) = 2,81,250; cess 11,250.
            assertAmount("projectedAnnualTaxable", "2325000", result.getProjectedAnnualTaxable());
            assertAmount("slabTax", "281250", (BigDecimal) result.getBreakdown().get("slabTax"));
            assertAmount("projectedAnnualTax", "292500", result.getProjectedAnnualTax());
            assertAmount("monthlyTax (292,500 / 12)", "24375", result.getMonthlyTax());
        }

        @Test
        @DisplayName("section 87A marginal relief: taxable 12,05,000 -> slab tax 60,750 capped at excess-over-threshold 5,000 -> annual 5,200 with cess")
        void marginalReliefJustAbove12Lakh() {
            // Projection = ytd 11,80,000 + current month 1,00,000 + 0 remaining
            // = 12,80,000 gross; SD 75,000 -> taxable 12,05,000.
            TaxInput in = baseInput()
                    .regime("NEW")
                    .month(3).monthsRemainingAfterCurrent(0)
                    .grossForMonth(new BigDecimal("100000"))
                    .grossMonthlyFull(new BigDecimal("100000"))
                    .ytdTaxableIncome(new BigDecimal("1180000"))
                    .ytdTaxDeducted(BigDecimal.ZERO)
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            assertAmount("projectedAnnualTaxable", "1205000", result.getProjectedAnnualTaxable());
            // Slab tax: 4-8L 20,000 + 8-12L 40,000 + 5,000@15% 750 = 60,750...
            assertAmount("slabTax", "60750", (BigDecimal) result.getBreakdown().get("slabTax"));
            // ...but marginal relief caps liability at taxable - 12,00,000 = 5,000.
            assertAmount("taxAfterRebate (marginal relief cap)", "5000",
                    (BigDecimal) result.getBreakdown().get("taxAfterRebate"));
            assertAmount("projectedAnnualTax (5,000 + 4% cess)", "5200", result.getProjectedAnnualTax());
            // Last FY month, nothing withheld yet -> the whole 5,200 this month.
            assertAmount("monthlyTax", "5200", result.getMonthlyTax());
        }

        @Test
        @DisplayName("YTD true-up in month 12: remaining liability 1,42,500 spread over the 4 months left = 35,625")
        void ytdTrueUp() {
            TaxInput in = baseInput()
                    .regime("NEW")
                    .month(12).monthsRemainingAfterCurrent(3)
                    .grossForMonth(new BigDecimal("200000"))
                    .grossMonthlyFull(new BigDecimal("200000"))
                    .ytdTaxableIncome(new BigDecimal("1600000"))
                    .ytdTaxDeducted(new BigDecimal("150000"))
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            // 16,00,000 + 2,00,000 + 3 x 2,00,000 = 24,00,000 -> annual tax 2,92,500
            assertAmount("projectedAnnualGross", "2400000", result.getProjectedAnnualGross());
            assertAmount("projectedAnnualTax", "292500", result.getProjectedAnnualTax());
            // (2,92,500 - 1,50,000) / 4 months (Dec..Mar) = 35,625
            assertAmount("monthlyTax", "35625", result.getMonthlyTax());
        }

        @Test
        @DisplayName("tax_rules per-FY override of new_standard_deduction is honored and changes the outcome")
        void standardDeductionOverrideFromRules() {
            // Annual gross 13,00,000 (ytd 12,00,000 + 1,00,000 in the last month).
            TaxInput.TaxInputBuilder builder = baseInput()
                    .regime("NEW")
                    .month(3).monthsRemainingAfterCurrent(0)
                    .grossForMonth(new BigDecimal("100000"))
                    .grossMonthlyFull(new BigDecimal("100000"))
                    .ytdTaxableIncome(new BigDecimal("1200000"))
                    .ytdTaxDeducted(BigDecimal.ZERO);

            // Control: built-in SD 75,000 -> taxable 12,25,000 -> marginal relief
            // caps at 25,000 -> + cess = 26,000 annual.
            TaxResult withDefaultSd = engine.calculateMonthlyTax(builder.build());
            assertAmount("control taxable (SD 75k)", "1225000", withDefaultSd.getProjectedAnnualTaxable());
            assertAmount("control annual tax", "26000", withDefaultSd.getProjectedAnnualTax());

            // Override: SD 1,00,000 for FY 2025-26 -> taxable exactly 12,00,000
            // -> full section 87A rebate -> zero tax.
            TaxInput overridden = builder
                    .taxRules(Map.of(FY, Map.of("new_standard_deduction", 100000)))
                    .build();
            TaxResult withOverriddenSd = engine.calculateMonthlyTax(overridden);

            assertAmount("overridden standardDeduction", "100000",
                    (BigDecimal) withOverriddenSd.getBreakdown().get("standardDeduction"));
            assertAmount("overridden taxable", "1200000", withOverriddenSd.getProjectedAnnualTaxable());
            assertAmount("overridden annual tax (87A rebate)", "0", withOverriddenSd.getProjectedAnnualTax());
            assertAmount("overridden monthlyTax", "0", withOverriddenSd.getMonthlyTax());
        }
    }

    // ==================================================================
    // calculateMonthlyTax — OLD regime
    // ==================================================================

    @Nested
    @DisplayName("calculateMonthlyTax — old regime with declarations")
    class OldRegime {

        @Test
        @DisplayName("gross 12,00,000 with HRA/80C/80D declarations: taxable 7,88,000 -> tax 70,100 + cess = 72,904; monthly 6,075")
        void oldRegimeWithDeclarations() {
            // basic 40,000/mo (annual 4,80,000), metro, rent 2,40,000/yr,
            // HRA received 2,40,000/yr, 80C declared 2,00,000, 80D 20,000.
            TaxInput in = baseInput()
                    .regime("OLD")
                    .month(4).monthsRemainingAfterCurrent(11)
                    .grossForMonth(new BigDecimal("100000"))
                    .grossMonthlyFull(new BigDecimal("100000"))
                    .basicMonthlyFull(new BigDecimal("40000"))
                    .hraReceivedAnnual(new BigDecimal("240000"))
                    .ytdTaxableIncome(BigDecimal.ZERO)
                    .ytdTaxDeducted(BigDecimal.ZERO)
                    .declarations(Map.of(
                            "section_80c", 200000,
                            "section_80d", 20000,
                            "hra_rent_paid", 240000,
                            "is_metro_city", true))
                    .build();

            TaxResult result = engine.calculateMonthlyTax(in);

            // HRA exemption = min(received 2,40,000;
            //                     rent - 10% basic = 2,40,000 - 48,000 = 1,92,000;
            //                     50% of basic (metro) = 2,40,000) = 1,92,000.
            assertAmount("hraExemption", "192000", (BigDecimal) result.getBreakdown().get("hraExemption"));

            // 80C: auto employee-PF 12% of min(40,000; 15,000 ceiling) = 1,800/mo
            // = 21,600/yr, + declared 2,00,000 -> capped at 1,50,000.
            assertAmount("deduction80c (capped)", "150000", (BigDecimal) result.getBreakdown().get("deduction80c"));
            assertAmount("deduction80d", "20000", (BigDecimal) result.getBreakdown().get("deduction80d"));

            // Taxable = 12,00,000 - 50,000 (SD) - 1,92,000 (HRA) - 1,50,000 (80C)
            //           - 20,000 (80D) = 7,88,000.
            assertAmount("totalExemptions", "412000", result.getTotalExemptions());
            assertAmount("projectedAnnualTaxable", "788000", result.getProjectedAnnualTaxable());

            // Old slabs: 2.5-5L@5% = 12,500 + 2,88,000@20% = 57,600 -> 70,100.
            // No 87A (taxable > 5,00,000). + 4% cess 2,804 -> 72,904.
            assertAmount("slabTax", "70100", (BigDecimal) result.getBreakdown().get("slabTax"));
            assertAmount("projectedAnnualTax", "72904", result.getProjectedAnnualTax());
            // 72,904 / 12 = 6,075.33 -> rounded to whole rupees = 6,075.
            assertAmount("monthlyTax", "6075", result.getMonthlyTax());
        }
    }

    // ==================================================================
    // calculateStatutory — EPF / ESI / PT
    // ==================================================================

    @Nested
    @DisplayName("calculateStatutory — EPF / ESI / Professional Tax")
    class Statutory {

        private Optional<StatutoryItem> item(List<StatutoryItem> items, String code) {
            return items.stream().filter(i -> code.equals(i.getCode())).findFirst();
        }

        @Test
        @DisplayName("basic 20,000: PF on capped wage base 15,000 -> employee 1,800, employer 1,800 split EPS 1,250 / EPF 550")
        void pfOnCappedWageBase() {
            TaxInput in = baseInput()
                    .month(4)
                    .basicForMonth(new BigDecimal("20000"))
                    .grossForMonth(new BigDecimal("20000"))
                    .grossMonthlyFull(new BigDecimal("20000"))
                    .stateCode("MH")
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            StatutoryItem pf = item(items, "PF").orElseThrow();
            assertAmount("PF employee (12% of 15,000)", "1800", pf.getEmployeeMonthly());
            assertAmount("PF employer", "1800", pf.getEmployerMonthly());
            assertAmount("PF wage base", "15000", (BigDecimal) pf.getDetail().get("wageBase"));
            // EPS 8.33% of 15,000 = 1,249.50 -> HALF_UP to whole rupee = 1,250.
            assertAmount("EPS share", "1250", (BigDecimal) pf.getDetail().get("eps"));
            assertAmount("EPF employer share (1,800 - 1,250)", "550",
                    (BigDecimal) pf.getDetail().get("epfEmployer"));
        }

        @Test
        @DisplayName("gross 20,000 (under the 21,000 ceiling): ESI employee 150 (0.75%), employer 650 (3.25%)")
        void esiUnderCeiling() {
            TaxInput in = baseInput()
                    .month(4)
                    .basicForMonth(new BigDecimal("20000"))
                    .grossForMonth(new BigDecimal("20000"))
                    .grossMonthlyFull(new BigDecimal("20000"))
                    .stateCode("MH")
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            StatutoryItem esi = item(items, "ESI").orElseThrow();
            assertAmount("ESI employee", "150", esi.getEmployeeMonthly());
            assertAmount("ESI employer", "650", esi.getEmployerMonthly());
        }

        @Test
        @DisplayName("ESI stickiness: gross now 22,000 but 20,000 at period start -> ESI still deducted on the current gross")
        void esiStickyWithinContributionPeriod() {
            TaxInput in = baseInput()
                    .month(7)
                    .grossForMonth(new BigDecimal("22000"))
                    .grossMonthlyFull(new BigDecimal("22000"))
                    .esiGrossAtPeriodStart(new BigDecimal("20000"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            StatutoryItem esi = item(items, "ESI").orElseThrow();
            // Rates apply to the actual month's gross: 0.75% / 3.25% of 22,000.
            assertAmount("ESI employee (sticky)", "165", esi.getEmployeeMonthly());
            assertAmount("ESI employer (sticky)", "715", esi.getEmployerMonthly());
        }

        @Test
        @DisplayName("gross 22,000 already at period start -> above the 21,000 ceiling, no ESI item")
        void esiAboveCeilingNoItem() {
            TaxInput in = baseInput()
                    .month(7)
                    .grossForMonth(new BigDecimal("22000"))
                    .grossMonthlyFull(new BigDecimal("22000"))
                    .esiGrossAtPeriodStart(new BigDecimal("22000"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertTrue(item(items, "ESI").isEmpty(), "no ESI above the 21,000 ceiling");
        }

        @Test
        @DisplayName("Maharashtra PT: gross 20,000 -> 200/month, and 300 in February")
        void professionalTaxMaharashtra() {
            TaxInput regularMonth = baseInput()
                    .month(4)
                    .grossForMonth(new BigDecimal("20000"))
                    .grossMonthlyFull(new BigDecimal("20000"))
                    .stateCode("MH")
                    .build();
            TaxInput february = baseInput()
                    .month(2)
                    .grossForMonth(new BigDecimal("20000"))
                    .grossMonthlyFull(new BigDecimal("20000"))
                    .stateCode("MH")
                    .build();

            StatutoryItem ptRegular = item(engine.calculateStatutory(regularMonth), "PT").orElseThrow();
            StatutoryItem ptFebruary = item(engine.calculateStatutory(february), "PT").orElseThrow();

            assertAmount("MH PT regular month", "200", ptRegular.getEmployeeMonthly());
            assertAmount("MH PT February", "300", ptFebruary.getEmployeeMonthly());
            assertAmount("PT has no employer share", "0", ptRegular.getEmployerMonthly());
        }

        @Test
        @DisplayName("statutory settings pf_enabled=false suppresses the PF item but leaves ESI and PT intact")
        void pfDisableFlag() {
            TaxInput in = baseInput()
                    .month(4)
                    .basicForMonth(new BigDecimal("20000"))
                    .grossForMonth(new BigDecimal("20000"))
                    .grossMonthlyFull(new BigDecimal("20000"))
                    .stateCode("MH")
                    .statutorySettings(Map.of("pf_enabled", "false"))
                    .build();

            List<StatutoryItem> items = engine.calculateStatutory(in);

            assertFalse(item(items, "PF").isPresent(), "PF must be suppressed by pf_enabled=false");
            assertTrue(item(items, "ESI").isPresent(), "ESI must be unaffected");
            assertTrue(item(items, "PT").isPresent(), "PT must be unaffected");
        }
    }
}
