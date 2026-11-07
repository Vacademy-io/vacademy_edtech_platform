package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * UAE engine (country code ARE / alias UAE). No personal income tax; the
 * statutory obligations are:
 *
 * - GPSSA pension for UAE nationals (private sector): employee 5%, employer
 *   12.5% of the contribution salary. v1 uses monthly BASIC as the
 *   contribution base (statutorily basic + housing allowance), clamped to the
 *   AED 1,000–50,000 band. GCC nationals technically contribute at their home
 *   scheme's rates — not modeled in v1 (treated as expats), noted here.
 * - End-of-service benefit (EOSB) accrual as an employer cost: 21 days of
 *   basic per year for the first 5 years of service, 30 days/year after
 *   (Federal Decree-Law 33/2021 art. 51), daily basic = monthly basic / 30.
 *   Emitted monthly (annual/12) so payroll carries the true employer cost and
 *   the provision report can aggregate it.
 *
 * Overrides via statutory_settings: gpssa_enabled, eosb_enabled ("false"
 * disables). Currency is implicit (institute currency, expected AED).
 */
@Component
public class UaeTaxRegimeEngine implements TaxRegimeEngine {

    private static final BigDecimal GPSSA_EMPLOYEE_RATE = new BigDecimal("0.05");
    private static final BigDecimal GPSSA_EMPLOYER_RATE = new BigDecimal("0.125");
    private static final BigDecimal GPSSA_MIN_BASE = new BigDecimal("1000");
    private static final BigDecimal GPSSA_MAX_BASE = new BigDecimal("50000");

    private static final BigDecimal EOSB_DAYS_FIRST_BAND = new BigDecimal("21");
    private static final BigDecimal EOSB_DAYS_SECOND_BAND = new BigDecimal("30");
    private static final BigDecimal FIVE_YEARS = new BigDecimal("5");

    @Override
    public String getCountryCode() {
        return "ARE";
    }

    @Override
    public TaxResult calculateMonthlyTax(TaxInput input) {
        Map<String, Object> breakdown = new LinkedHashMap<>();
        breakdown.put("note", "UAE levies no personal income tax on salary");
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

        // GPSSA — UAE nationals only.
        if (!isFalse(settings.get("gpssa_enabled")) && isUaeNational(input.getNationality())
                && basicFull.signum() > 0) {
            BigDecimal base = clamp(nvl(input.getBasicForMonth()), GPSSA_MIN_BASE, GPSSA_MAX_BASE);
            BigDecimal employee = base.multiply(GPSSA_EMPLOYEE_RATE).setScale(2, RoundingMode.HALF_UP);
            BigDecimal employer = base.multiply(GPSSA_EMPLOYER_RATE).setScale(2, RoundingMode.HALF_UP);
            items.add(StatutoryItem.builder()
                    .code("GPSSA").name("GPSSA Pension")
                    .employeeMonthly(employee).employerMonthly(employer)
                    .detail(Map.of("contributionBase", base)).build());
        }

        // EOSB accrual — employer cost for every employee.
        if (!isFalse(settings.get("eosb_enabled")) && basicFull.signum() > 0) {
            BigDecimal serviceYears = nvl(input.getServiceYears());
            BigDecimal daysPerYear = serviceYears.compareTo(FIVE_YEARS) < 0
                    ? EOSB_DAYS_FIRST_BAND : EOSB_DAYS_SECOND_BAND;
            BigDecimal dailyBasic = basicFull.divide(new BigDecimal("30"), 6, RoundingMode.HALF_UP);
            BigDecimal monthlyAccrual = dailyBasic.multiply(daysPerYear)
                    .divide(new BigDecimal("12"), 2, RoundingMode.HALF_UP);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("serviceYears", serviceYears);
            detail.put("daysPerYear", daysPerYear);
            items.add(StatutoryItem.builder()
                    .code("EOSB").name("End of Service Benefit (accrual)")
                    .employeeMonthly(BigDecimal.ZERO).employerMonthly(monthlyAccrual)
                    .detail(detail).build());
        }

        return items;
    }

    private static boolean isUaeNational(String nationality) {
        if (nationality == null) return false;
        String n = nationality.toLowerCase();
        return n.contains("emirat") || n.contains("uae") || n.contains("united arab");
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
