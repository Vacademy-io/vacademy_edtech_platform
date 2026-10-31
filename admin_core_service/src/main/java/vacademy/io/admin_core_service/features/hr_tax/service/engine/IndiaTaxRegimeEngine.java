package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * India tax engine — FY 2025-26 (AY 2026-27) rules by default, overridable per
 * financial year through the institute's tax_rules JSONB (see resolveRules):
 * a top-level key equal to the FY string ("2025-26") overrides for that year,
 * else a "defaults" key, else the built-in constants below. Rate changes are
 * therefore DATA, not redeploys.
 *
 * Implements:
 * - New regime (default): 0-4L/4-8L/8-12L/12-16L/16-20L/20-24L/24L+ at
 *   0/5/10/15/20/25/30%, standard deduction 75k, §87A full rebate up to 12L
 *   taxable with marginal relief, 80CCD(2) employer NPS (14% of basic cap).
 * - Old regime: 2.5L/5L/10L slabs at 0/5/20/30%, SD 50k, §87A up to 5L (cap
 *   12,500), HRA exemption COMPUTED (min of received, rent-10% basic, 50/40%
 *   of basic), 80C (1.5L, employee-PF auto-counted), 80D (25k/50k senior +
 *   parents), 80CCD(1B) 50k, 80E, 80TTA.
 * - Surcharge with marginal relief (new regime capped at 25%), 4% cess.
 * - Monthly TDS as YTD true-up: (annual liability − already withheld) spread
 *   over remaining months.
 * - Statutory: EPF 12%/12% on min(basic, 15k) with EPS 8.33% split; ESI
 *   0.75%/3.25% under the 21k gross ceiling with contribution-period
 *   stickiness; Professional Tax by state slab (built-in defaults for the
 *   common states, overridable via tax_rules.professional_tax).
 */
@Component
public class IndiaTaxRegimeEngine implements TaxRegimeEngine {

    public static final String REGIME_NEW = "NEW";
    public static final String REGIME_OLD = "OLD";

    // ---- FY 2025-26 built-in defaults (all overridable via tax_rules) ----
    private static final BigDecimal[][] NEW_SLABS = {
            {bd(400000), bd(0)}, {bd(800000), bd(0.05)}, {bd(1200000), bd(0.10)},
            {bd(1600000), bd(0.15)}, {bd(2000000), bd(0.20)}, {bd(2400000), bd(0.25)},
            {null, bd(0.30)}};
    private static final BigDecimal NEW_STANDARD_DEDUCTION = bd(75000);
    private static final BigDecimal NEW_REBATE_87A_THRESHOLD = bd(1200000);

    private static final BigDecimal[][] OLD_SLABS = {
            {bd(250000), bd(0)}, {bd(500000), bd(0.05)}, {bd(1000000), bd(0.20)}, {null, bd(0.30)}};
    private static final BigDecimal OLD_STANDARD_DEDUCTION = bd(50000);
    private static final BigDecimal OLD_REBATE_87A_THRESHOLD = bd(500000);
    private static final BigDecimal OLD_REBATE_87A_CAP = bd(12500);

    // surcharge tiers: [income-threshold, rate]
    private static final BigDecimal[][] SURCHARGE_TIERS = {
            {bd(5000000), bd(0.10)}, {bd(10000000), bd(0.15)},
            {bd(20000000), bd(0.25)}, {bd(50000000), bd(0.37)}};
    private static final BigDecimal NEW_REGIME_SURCHARGE_CAP = bd(0.25);
    private static final BigDecimal CESS_RATE = bd(0.04);

    private static final BigDecimal CAP_80C = bd(150000);
    private static final BigDecimal CAP_80D_BASE = bd(25000);
    private static final BigDecimal CAP_80D_SENIOR = bd(50000);
    private static final BigDecimal CAP_80CCD1B = bd(50000);
    private static final BigDecimal CAP_80TTA = bd(10000);
    private static final BigDecimal CAP_80CCD2_PCT_OF_BASIC = bd(0.14);

    private static final BigDecimal PF_WAGE_CEILING = bd(15000);
    private static final BigDecimal PF_RATE = bd(0.12);
    private static final BigDecimal EPS_RATE = bd(0.0833);
    private static final BigDecimal ESI_GROSS_CEILING = bd(21000);
    private static final BigDecimal ESI_EMPLOYEE_RATE = bd(0.0075);
    private static final BigDecimal ESI_EMPLOYER_RATE = bd(0.0325);

    private static final String[] KEYS_80C = {"section_80c", "80c", "ppf", "elss", "life_insurance",
            "nsc", "tuition_fees", "fixed_deposit_5yr", "sukanya_samriddhi", "home_loan_principal"};

    @Override
    public String getCountryCode() {
        return "IND";
    }

    // ==================================================================
    // Income tax
    // ==================================================================

    @Override
    public TaxResult calculateMonthlyTax(TaxInput in) {
        Map<String, Object> rules = resolveRules(in.getTaxRules(), in.getFinancialYear());
        Map<String, Object> breakdown = new LinkedHashMap<>();

        String regime = REGIME_OLD.equalsIgnoreCase(in.getRegime()) ? REGIME_OLD : REGIME_NEW;
        breakdown.put("regime", regime);

        // Projection: actuals to date + this month + full months for the rest of the FY.
        BigDecimal ytdIncome = nvl(in.getYtdTaxableIncome());
        BigDecimal projectedAnnualGross = ytdIncome
                .add(nvl(in.getGrossForMonth()))
                .add(nvl(in.getGrossMonthlyFull()).multiply(bd(in.getMonthsRemainingAfterCurrent())));
        breakdown.put("projectedAnnualGross", projectedAnnualGross);

        BigDecimal annualBasic = nvl(in.getBasicMonthlyFull()).multiply(bd(12));
        Map<String, Object> decl = in.getDeclarations() != null ? in.getDeclarations() : Map.of();

        BigDecimal taxable;
        BigDecimal totalExemptions;
        if (REGIME_NEW.equals(regime)) {
            BigDecimal sd = readAmount(rules, "new_standard_deduction", NEW_STANDARD_DEDUCTION);
            // Only 80CCD(2) (employer NPS) survives the new regime, capped at 14% of basic.
            BigDecimal nps80ccd2 = min(declAmount(decl, "section_80ccd2", "employer_nps"),
                    annualBasic.multiply(CAP_80CCD2_PCT_OF_BASIC));
            totalExemptions = sd.add(nps80ccd2);
            breakdown.put("standardDeduction", sd);
            if (nps80ccd2.signum() > 0) breakdown.put("deduction80ccd2", nps80ccd2);
            taxable = projectedAnnualGross.subtract(totalExemptions);
        } else {
            BigDecimal sd = readAmount(rules, "old_standard_deduction", OLD_STANDARD_DEDUCTION);

            BigDecimal hraExemption = computeHraExemption(in, decl, annualBasic);
            breakdown.put("hraExemption", hraExemption);

            // 80C aggregate — employee's own PF contribution is counted automatically.
            BigDecimal annualEmployeePf = pfEmployeeMonthly(nvl(in.getBasicMonthlyFull())).multiply(bd(12));
            BigDecimal total80c = annualEmployeePf.add(declAmount(decl, "employee_pf_contribution"));
            for (String key : KEYS_80C) total80c = total80c.add(declAmount(decl, key));
            total80c = min(total80c, readAmount(rules, "cap_80c", CAP_80C));
            breakdown.put("deduction80c", total80c);

            BigDecimal cap80dSelf = truthy(decl.get("is_senior_citizen")) ? CAP_80D_SENIOR : CAP_80D_BASE;
            BigDecimal cap80dParents = truthy(decl.get("parents_senior")) ? CAP_80D_SENIOR : CAP_80D_BASE;
            BigDecimal total80d = min(declAmount(decl, "section_80d", "80d_self"), cap80dSelf)
                    .add(min(declAmount(decl, "80d_parents"), cap80dParents));
            breakdown.put("deduction80d", total80d);

            BigDecimal d80ccd1b = min(declAmount(decl, "section_80ccd1b", "nps_self"), CAP_80CCD1B);
            BigDecimal d80e = declAmount(decl, "section_80e", "education_loan_interest");
            BigDecimal d80tta = min(declAmount(decl, "section_80tta", "savings_interest"), CAP_80TTA);

            totalExemptions = sd.add(hraExemption).add(total80c).add(total80d)
                    .add(d80ccd1b).add(d80e).add(d80tta);
            breakdown.put("standardDeduction", sd);
            taxable = projectedAnnualGross.subtract(totalExemptions);
        }

        if (taxable.signum() < 0) taxable = BigDecimal.ZERO;
        breakdown.put("taxableIncome", taxable);

        BigDecimal annualTax = annualTaxOn(taxable, regime, rules, breakdown);

        // YTD true-up: remaining liability spread over remaining months (incl. current).
        BigDecimal alreadyDeducted = nvl(in.getYtdTaxDeducted());
        int monthsLeft = in.getMonthsRemainingAfterCurrent() + 1;
        BigDecimal remaining = annualTax.subtract(alreadyDeducted);
        BigDecimal monthlyTax = remaining.signum() <= 0
                ? BigDecimal.ZERO
                : remaining.divide(bd(monthsLeft), 0, RoundingMode.HALF_UP);
        breakdown.put("ytdTaxDeducted", alreadyDeducted);
        breakdown.put("monthsRemaining", monthsLeft);

        return TaxResult.builder()
                .monthlyTax(monthlyTax)
                .projectedAnnualGross(projectedAnnualGross)
                .projectedAnnualTaxable(taxable)
                .projectedAnnualTax(annualTax)
                .totalExemptions(totalExemptions)
                .breakdown(breakdown)
                .build();
    }

    /** Slab tax → §87A rebate (with new-regime marginal relief) → surcharge (with marginal relief) → cess. */
    private BigDecimal annualTaxOn(BigDecimal taxable, String regime, Map<String, Object> rules,
                                   Map<String, Object> breakdown) {
        BigDecimal[][] slabs = readSlabs(rules,
                REGIME_NEW.equals(regime) ? "new_slabs" : "old_slabs",
                REGIME_NEW.equals(regime) ? NEW_SLABS : OLD_SLABS);

        BigDecimal slabTax = slabTax(taxable, slabs);
        breakdown.put("slabTax", slabTax);

        // §87A rebate
        BigDecimal taxAfterRebate = slabTax;
        if (REGIME_NEW.equals(regime)) {
            BigDecimal threshold = readAmount(rules, "new_rebate_threshold", NEW_REBATE_87A_THRESHOLD);
            if (taxable.compareTo(threshold) <= 0) {
                taxAfterRebate = BigDecimal.ZERO;
            } else {
                // Marginal relief just above the rebate threshold: pay no more than the excess income.
                BigDecimal excess = taxable.subtract(threshold);
                if (slabTax.compareTo(excess) > 0) taxAfterRebate = excess;
            }
        } else {
            BigDecimal threshold = readAmount(rules, "old_rebate_threshold", OLD_REBATE_87A_THRESHOLD);
            if (taxable.compareTo(threshold) <= 0) {
                taxAfterRebate = slabTax.subtract(min(slabTax, OLD_REBATE_87A_CAP));
            }
        }
        breakdown.put("taxAfterRebate", taxAfterRebate);

        // Surcharge with marginal relief
        BigDecimal surchargeRate = BigDecimal.ZERO;
        BigDecimal tierThreshold = null;
        for (BigDecimal[] tier : SURCHARGE_TIERS) {
            if (taxable.compareTo(tier[0]) > 0) {
                surchargeRate = tier[1];
                tierThreshold = tier[0];
            }
        }
        if (REGIME_NEW.equals(regime) && surchargeRate.compareTo(NEW_REGIME_SURCHARGE_CAP) > 0) {
            surchargeRate = NEW_REGIME_SURCHARGE_CAP;
        }
        BigDecimal surcharge = BigDecimal.ZERO;
        if (surchargeRate.signum() > 0 && tierThreshold != null) {
            surcharge = taxAfterRebate.multiply(surchargeRate);
            // Marginal relief: (tax+surcharge) may not exceed tax-at-threshold + income-above-threshold.
            BigDecimal taxAtThreshold = slabTax(tierThreshold, slabs);
            BigDecimal maxPayable = taxAtThreshold.add(taxable.subtract(tierThreshold));
            if (taxAfterRebate.add(surcharge).compareTo(maxPayable) > 0) {
                surcharge = max(BigDecimal.ZERO, maxPayable.subtract(taxAfterRebate));
            }
            breakdown.put("surcharge", surcharge);
        }

        BigDecimal cess = taxAfterRebate.add(surcharge).multiply(CESS_RATE);
        breakdown.put("cess", scale2(cess));

        return scale2(taxAfterRebate.add(surcharge).add(cess));
    }

    private BigDecimal slabTax(BigDecimal taxable, BigDecimal[][] slabs) {
        BigDecimal tax = BigDecimal.ZERO;
        BigDecimal lower = BigDecimal.ZERO;
        for (BigDecimal[] slab : slabs) {
            BigDecimal upper = slab[0]; // null = no ceiling
            BigDecimal rate = slab[1];
            if (upper == null || taxable.compareTo(upper) < 0) {
                tax = tax.add(taxable.subtract(lower).multiply(rate));
                return scale2(max(tax, BigDecimal.ZERO));
            }
            tax = tax.add(upper.subtract(lower).multiply(rate));
            lower = upper;
        }
        return scale2(tax);
    }

    /**
     * Statutory HRA exemption = min(HRA received, rent − 10% of basic,
     * 50%/40% of basic by metro) — computed from rent declared, never taken
     * as a self-declared exemption amount.
     */
    private BigDecimal computeHraExemption(TaxInput in, Map<String, Object> decl, BigDecimal annualBasic) {
        BigDecimal rentPaid = declAmount(decl, "hra_rent_paid", "rent_paid");
        if (rentPaid.signum() <= 0) return BigDecimal.ZERO;

        BigDecimal hraReceived = nvl(in.getHraReceivedAnnual());
        if (hraReceived.signum() <= 0) hraReceived = declAmount(decl, "hra_received");
        if (hraReceived.signum() <= 0) return BigDecimal.ZERO;

        BigDecimal rentMinus10PctBasic = rentPaid.subtract(annualBasic.multiply(bd(0.10)));
        BigDecimal basicPct = annualBasic.multiply(truthy(decl.get("is_metro_city")) ? bd(0.50) : bd(0.40));

        BigDecimal exemption = min(min(hraReceived, rentMinus10PctBasic), basicPct);
        return max(exemption, BigDecimal.ZERO);
    }

    // ==================================================================
    // Statutory: EPF / ESI / PT
    // ==================================================================

    @Override
    public List<StatutoryItem> calculateStatutory(TaxInput in) {
        List<StatutoryItem> items = new ArrayList<>();
        Map<String, Object> settings = in.getStatutorySettings() != null ? in.getStatutorySettings() : Map.of();

        // --- EPF on earned (prorated) basic, ceiling 15k; employer split EPS 8.33 / EPF 3.67.
        if (!falsy(settings.get("pf_enabled"))) {
            BigDecimal basicForMonth = nvl(in.getBasicForMonth());
            if (basicForMonth.signum() > 0) {
                BigDecimal wageBase = min(basicForMonth, PF_WAGE_CEILING);
                BigDecimal employee = wageBase.multiply(PF_RATE).setScale(0, RoundingMode.HALF_UP);
                BigDecimal eps = wageBase.multiply(EPS_RATE).setScale(0, RoundingMode.HALF_UP);
                BigDecimal employer = wageBase.multiply(PF_RATE).setScale(0, RoundingMode.HALF_UP);
                Map<String, Object> detail = new LinkedHashMap<>();
                detail.put("wageBase", wageBase);
                detail.put("eps", eps);
                detail.put("epfEmployer", employer.subtract(eps));
                items.add(StatutoryItem.builder()
                        .code("PF").name("Provident Fund")
                        .employeeMonthly(employee).employerMonthly(employer)
                        .detail(detail).build());
            }
        }

        // --- ESI under the 21k ceiling, sticky within the Apr-Sep / Oct-Mar contribution period.
        if (!falsy(settings.get("esi_enabled"))) {
            BigDecimal eligibilityGross = in.getEsiGrossAtPeriodStart() != null
                    ? in.getEsiGrossAtPeriodStart() : nvl(in.getGrossMonthlyFull());
            if (eligibilityGross.signum() > 0 && eligibilityGross.compareTo(ESI_GROSS_CEILING) <= 0) {
                BigDecimal payBase = nvl(in.getGrossForMonth());
                // ESI amounts round UP to the next rupee by statute.
                BigDecimal employee = payBase.multiply(ESI_EMPLOYEE_RATE).setScale(0, RoundingMode.CEILING);
                BigDecimal employer = payBase.multiply(ESI_EMPLOYER_RATE).setScale(0, RoundingMode.CEILING);
                items.add(StatutoryItem.builder()
                        .code("ESI").name("Employee State Insurance")
                        .employeeMonthly(employee).employerMonthly(employer)
                        .detail(Map.of("eligibilityGross", eligibilityGross)).build());
            }
        }

        // --- Professional Tax by state slab (employee-only).
        if (!falsy(settings.get("pt_enabled"))) {
            BigDecimal pt = professionalTax(in);
            if (pt.signum() > 0) {
                items.add(StatutoryItem.builder()
                        .code("PT").name("Professional Tax")
                        .employeeMonthly(pt).employerMonthly(BigDecimal.ZERO)
                        .detail(Map.of("stateCode", in.getStateCode() == null ? "" : in.getStateCode()))
                        .build());
            }
        }

        return items;
    }

    /**
     * Monthly PT from tax_rules.professional_tax.{STATE} = [{"upTo": n|null,
     * "amount": a, "februaryAmount": b?}, ...], else built-in defaults for the
     * common PT states; states without PT (DL, UP, HR, RJ, ...) yield zero.
     */
    @SuppressWarnings("unchecked")
    private BigDecimal professionalTax(TaxInput in) {
        String state = in.getStateCode() == null ? "" : in.getStateCode().toUpperCase();
        BigDecimal gross = nvl(in.getGrossMonthlyFull());
        boolean february = in.getMonth() == 2;

        Object ptRules = resolveRules(in.getTaxRules(), in.getFinancialYear()).get("professional_tax");
        if (ptRules instanceof Map<?, ?> ptMap && ptMap.get(state) instanceof List<?> slabs) {
            for (Object slabObj : slabs) {
                if (slabObj instanceof Map<?, ?> slab) {
                    Object upTo = slab.get("upTo");
                    if (upTo == null || gross.compareTo(toBd(upTo)) <= 0) {
                        Object amount = february && slab.get("februaryAmount") != null
                                ? slab.get("februaryAmount") : slab.get("amount");
                        return toBd(amount);
                    }
                }
            }
            return BigDecimal.ZERO;
        }

        return switch (state) {
            case "MH" -> gross.compareTo(bd(10000)) > 0 ? (february ? bd(300) : bd(200))
                    : gross.compareTo(bd(7500)) > 0 ? bd(175) : BigDecimal.ZERO;
            case "KA" -> gross.compareTo(bd(25000)) >= 0 ? bd(200) : BigDecimal.ZERO;
            case "WB" -> gross.compareTo(bd(40000)) > 0 ? bd(200)
                    : gross.compareTo(bd(25000)) > 0 ? bd(150)
                    : gross.compareTo(bd(15000)) > 0 ? bd(130)
                    : gross.compareTo(bd(10000)) > 0 ? bd(110) : BigDecimal.ZERO;
            case "TN" -> gross.compareTo(bd(12500)) > 0 ? bd(208)
                    : gross.compareTo(bd(10000)) > 0 ? bd(171)
                    : gross.compareTo(bd(7500)) > 0 ? bd(115)
                    : gross.compareTo(bd(5000)) > 0 ? bd(52)
                    : gross.compareTo(bd(3500)) > 0 ? bd(22) : BigDecimal.ZERO;
            case "TS", "AP" -> gross.compareTo(bd(20000)) > 0 ? bd(200)
                    : gross.compareTo(bd(15000)) > 0 ? bd(150) : BigDecimal.ZERO;
            case "GJ" -> gross.compareTo(bd(12000)) > 0 ? bd(200) : BigDecimal.ZERO;
            case "MP" -> gross.compareTo(bd(18750)) > 0 ? (february ? bd(212) : bd(208)) : BigDecimal.ZERO;
            default -> BigDecimal.ZERO;
        };
    }

    /** Employee EPF share for a given (un-prorated) monthly basic — used for auto-80C. */
    private BigDecimal pfEmployeeMonthly(BigDecimal basicMonthly) {
        if (basicMonthly.signum() <= 0) return BigDecimal.ZERO;
        return min(basicMonthly, PF_WAGE_CEILING).multiply(PF_RATE).setScale(0, RoundingMode.HALF_UP);
    }

    // ==================================================================
    // Rules resolution + helpers
    // ==================================================================

    /** Per-FY override object, else "defaults", else the map itself. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> resolveRules(Map<String, Object> taxRules, String financialYear) {
        if (taxRules == null) return Map.of();
        Object fy = taxRules.get(financialYear);
        if (fy instanceof Map) return (Map<String, Object>) fy;
        Object defaults = taxRules.get("defaults");
        if (defaults instanceof Map) return (Map<String, Object>) defaults;
        return taxRules;
    }

    private BigDecimal readAmount(Map<String, Object> rules, String key, BigDecimal fallback) {
        Object v = rules.get(key);
        return v instanceof Number ? toBd(v) : fallback;
    }

    /** Slabs as [[upperLimitOrNull, rate], ...] from rules key, else the built-in table. */
    private BigDecimal[][] readSlabs(Map<String, Object> rules, String key, BigDecimal[][] fallback) {
        Object v = rules.get(key);
        if (!(v instanceof List<?> list) || list.isEmpty()) return fallback;
        try {
            BigDecimal[][] out = new BigDecimal[list.size()][2];
            for (int i = 0; i < list.size(); i++) {
                List<?> pair = (List<?>) list.get(i);
                out[i][0] = pair.get(0) == null ? null : toBd(pair.get(0));
                out[i][1] = toBd(pair.get(1));
            }
            return out;
        } catch (Exception e) {
            return fallback; // malformed override — built-ins are safer than a crash
        }
    }

    private BigDecimal declAmount(Map<String, Object> decl, String... keys) {
        for (String key : keys) {
            Object v = decl.get(key);
            if (v instanceof Number || (v instanceof String s && !s.isBlank())) {
                try {
                    BigDecimal amount = toBd(v);
                    if (amount.signum() > 0) return amount;
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return BigDecimal.ZERO;
    }

    private static boolean truthy(Object v) {
        return v != null && ("true".equalsIgnoreCase(v.toString()) || "1".equals(v.toString()));
    }

    private static boolean falsy(Object v) {
        return v != null && ("false".equalsIgnoreCase(v.toString()) || "0".equals(v.toString()));
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }

    private static BigDecimal toBd(Object v) {
        return new BigDecimal(v.toString());
    }

    private static BigDecimal nvl(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }

    private static BigDecimal min(BigDecimal a, BigDecimal b) {
        return a.compareTo(b) <= 0 ? a : b;
    }

    private static BigDecimal max(BigDecimal a, BigDecimal b) {
        return a.compareTo(b) >= 0 ? a : b;
    }

    private static BigDecimal scale2(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP);
    }
}
