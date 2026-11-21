package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Saudi Arabia engine (country code SAU / alias KSA). No personal income tax
 * on salary; the statutory obligations are:
 *
 * - GOSI: Saudi nationals — employee 9.75% (annuities 9% + SANED 0.75%),
 *   employer 11.75% (annuities 9% + SANED 0.75% + occupational hazard 2%);
 *   expats — employer-only 2% occupational hazard. v1 contribution base is
 *   monthly BASIC (statutorily basic + housing), clamped to SAR 1,500–45,000.
 * - EOSB accrual as an employer cost (Labor Law art. 84): half a month's
 *   basic per year for the first 5 years, a full month per year after —
 *   emitted monthly (annual/12).
 *
 * Overrides via statutory_settings: gosi_enabled, eosb_enabled.
 */
@Component
public class SaudiTaxRegimeEngine implements TaxRegimeEngine {

    private static final BigDecimal GOSI_SAUDI_EMPLOYEE_RATE = new BigDecimal("0.0975");
    private static final BigDecimal GOSI_SAUDI_EMPLOYER_RATE = new BigDecimal("0.1175");
    private static final BigDecimal GOSI_EXPAT_EMPLOYER_RATE = new BigDecimal("0.02");
    private static final BigDecimal GOSI_MIN_BASE = new BigDecimal("1500");
    private static final BigDecimal GOSI_MAX_BASE = new BigDecimal("45000");

    private static final BigDecimal FIVE_YEARS = new BigDecimal("5");

    @Override
    public String getCountryCode() {
        return "SAU";
    }

    @Override
    public TaxResult calculateMonthlyTax(TaxInput input) {
        Map<String, Object> breakdown = new LinkedHashMap<>();
        breakdown.put("note", "Saudi Arabia levies no personal income tax on salary");
        BigDecimal projected = nvl(input.getYtdTaxableIncome())
                .add(nvl(input.getGrossForMonth()))
                .add(nvl(input.getGrossMonthlyFull())
                        .multiply(new BigDecimal(input.getMonthsRemainingAfterCurrent())));
        return TaxResult.builder()
                .monthlyTax(BigDecimal.ZERO)
                .projectedAnnualGross(projected)
                .projectedAnnualTaxable(BigDecimal.ZERO)
                .projectedAnnualTax(BigDecimal.ZERO)
                .totalExemptions(BigDecimal.ZERO)
                .breakdown(breakdown)
                .build();
    }

    @Override
    public List<StatutoryItem> calculateStatutory(TaxInput input) {
        List<StatutoryItem> items = new ArrayList<>();
        Map<String, Object> settings = input.getStatutorySettings() != null
                ? input.getStatutorySettings() : Map.of();

        BigDecimal basicFull = nvl(input.getBasicMonthlyFull());
        boolean saudi = isSaudiNational(input.getNationality());

        // GOSI
        if (!isFalse(settings.get("gosi_enabled")) && basicFull.signum() > 0) {
            BigDecimal base = clamp(nvl(input.getBasicForMonth()), GOSI_MIN_BASE, GOSI_MAX_BASE);
            BigDecimal employee = saudi
                    ? base.multiply(GOSI_SAUDI_EMPLOYEE_RATE).setScale(2, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;
            BigDecimal employer = base.multiply(saudi ? GOSI_SAUDI_EMPLOYER_RATE : GOSI_EXPAT_EMPLOYER_RATE)
                    .setScale(2, RoundingMode.HALF_UP);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("contributionBase", base);
            detail.put("national", saudi);
            items.add(StatutoryItem.builder()
                    .code("GOSI").name("GOSI")
                    .employeeMonthly(employee).employerMonthly(employer)
                    .detail(detail).build());
        }

        // EOSB accrual
        if (!isFalse(settings.get("eosb_enabled")) && basicFull.signum() > 0) {
            BigDecimal serviceYears = nvl(input.getServiceYears());
            BigDecimal monthsPerYear = serviceYears.compareTo(FIVE_YEARS) < 0
                    ? new BigDecimal("0.5") : BigDecimal.ONE;
            BigDecimal monthlyAccrual = basicFull.multiply(monthsPerYear)
                    .divide(new BigDecimal("12"), 2, RoundingMode.HALF_UP);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("serviceYears", serviceYears);
            detail.put("monthsPerYear", monthsPerYear);
            items.add(StatutoryItem.builder()
                    .code("EOSB").name("End of Service Benefit (accrual)")
                    .employeeMonthly(BigDecimal.ZERO).employerMonthly(monthlyAccrual)
                    .detail(detail).build());
        }

        return items;
    }

    private static boolean isSaudiNational(String nationality) {
        return nationality != null && nationality.toLowerCase().contains("saudi");
    }

    private static boolean isFalse(Object v) {
        return v != null && ("false".equalsIgnoreCase(v.toString()) || "0".equals(v.toString()));
    }

    private static BigDecimal clamp(BigDecimal v, BigDecimal min, BigDecimal max) {
        if (v.compareTo(min) < 0) return min;
        if (v.compareTo(max) > 0) return max;
        return v;
    }

    private static BigDecimal nvl(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }
}
