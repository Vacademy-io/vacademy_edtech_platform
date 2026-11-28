package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.EosbProvisionReportDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.EosbProvisionRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.repository.ComplianceProvisionQueryRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryStructure;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryStructureRepository;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * End-of-service benefit (EOSB) provision report (Phase E) — the Gulf sibling
 * of {@link GratuityProvisionService}. Applies only to institutes configured
 * for the UAE (ARE) or Saudi Arabia (SAU).
 *
 * <p>UAE — Federal Decree-Law 33/2021 art. 51: 21 days of basic wage per year
 * of service for the first 5 years and 30 days/year beyond, with the daily
 * basic taken as monthly basic / 30 and fractional years pro-rated across the
 * bands. Statutory floor: no entitlement before 1 completed year of service
 * (statutory liability 0, flagged not eligible) — but the books provision from
 * day one (IAS 19 accrual view), so the same banded figure WITHOUT the floor is
 * exposed separately as the accounting accrual. Statutory cap: the total
 * gratuity may not exceed 2 years' pay — approximated here as basic x 24 and
 * flagged when applied.
 *
 * <p>Saudi Arabia — Labor Law art. 84: half a month's basic per year for the
 * first 5 years and a full month per year beyond, band-split pro-rated. No
 * service floor, so statutory and accounting figures coincide. NOTE: art. 85's
 * resignation reductions (one-third under 5 years, two-thirds between 5 and 10)
 * are deliberately NOT modeled — the report provisions the full employer-side
 * liability, the conservative accounting position.
 *
 * <p>Monthly run-rate = the CURRENT band's monthly accrual, matching what the
 * payroll engines emit per month: UAE daily x (21|30)/12, KSA basic x (0.5|1)/12.
 */
@Service
public class EosbProvisionService {

    static final Set<String> EXITED_STATUSES = Set.of("TERMINATED", "RELIEVED", "ABSCONDING");
    static final Set<String> UAE_CODES = Set.of("ARE", "UAE");
    static final Set<String> SAUDI_CODES = Set.of("SAU", "KSA");

    /** Spec'd service-years denominator for this report (Gulf convention). */
    private static final BigDecimal DAYS_PER_YEAR = new BigDecimal("365.25");
    private static final BigDecimal FIVE = new BigDecimal("5");
    private static final BigDecimal TWELVE = new BigDecimal("12");
    private static final BigDecimal THIRTY = new BigDecimal("30");
    private static final BigDecimal HALF = new BigDecimal("0.50");

    private static final BigDecimal UAE_DAYS_FIRST_BAND = new BigDecimal("21");
    private static final BigDecimal UAE_DAYS_SECOND_BAND = new BigDecimal("30");
    /** Art. 51(2): total EOSB may not exceed two years' pay (basic x 24 here). */
    private static final BigDecimal UAE_CAP_MONTHS = new BigDecimal("24");

    private static final BigDecimal KSA_MONTHS_FIRST_BAND = new BigDecimal("0.5");
    private static final BigDecimal KSA_MONTHS_SECOND_BAND = BigDecimal.ONE;

    @Autowired
    private ComplianceProvisionQueryRepository provisionQueryRepository;

    @Autowired
    private EmployeeSalaryStructureRepository salaryStructureRepository;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private UserRepository userRepository;

    @Transactional(readOnly = true)
    public EosbProvisionReportDTO buildReport(String instituteId, LocalDate asOfDate) {
        LocalDate asOf = asOfDate != null ? asOfDate : LocalDate.now();
        String country = resolveGulfCountry(instituteId);
        boolean uae = "ARE".equals(country);

        List<EmployeeProfile> employees = provisionQueryRepository.findAllEmployeesByInstitute(instituteId);
        Map<String, String> names = buildUserNameMap(
                employees.stream().map(EmployeeProfile::getUserId).filter(Objects::nonNull)
                        .distinct().collect(Collectors.toList()));

        List<EosbProvisionRowDTO> rows = new ArrayList<>();
        BigDecimal totalStatutory = BigDecimal.ZERO;
        BigDecimal totalAccounting = BigDecimal.ZERO;
        BigDecimal totalRunRate = BigDecimal.ZERO;
        String reportCurrency = null;

        for (EmployeeProfile e : employees) {
            if (e.getJoinDate() == null || e.getJoinDate().isAfter(asOf)) {
                continue; // not yet in service as of the report date
            }
            boolean exited = e.getEmploymentStatus() != null
                    && EXITED_STATUSES.contains(e.getEmploymentStatus().toUpperCase());
            boolean exitedInAsOfMonth = false;
            if (exited) {
                // Exited employees stay on the report only for their exit month,
                // so the month-end provision movement (release on payout) is visible.
                LocalDate lwd = e.getLastWorkingDate();
                if (lwd == null || !YearMonth.from(lwd).equals(YearMonth.from(asOf))) {
                    continue;
                }
                exitedInAsOfMonth = true;
            }

            LocalDate serviceEnd = asOf;
            if (e.getLastWorkingDate() != null && e.getLastWorkingDate().isBefore(asOf)) {
                serviceEnd = e.getLastWorkingDate();
            }
            if (serviceEnd.isBefore(e.getJoinDate())) {
                serviceEnd = e.getJoinDate();
            }

            long serviceDays = ChronoUnit.DAYS.between(e.getJoinDate(), serviceEnd);
            // High precision for the band math; the row shows 2dp.
            BigDecimal yearsExact = new BigDecimal(serviceDays)
                    .divide(DAYS_PER_YEAR, 6, RoundingMode.HALF_UP);
            BigDecimal serviceYears = yearsExact.setScale(2, RoundingMode.HALF_UP);

            GratuityProvisionService.BasicResolution basic = resolveMonthlyBasic(e.getId());
            if (reportCurrency == null && basic.currency() != null) {
                reportCurrency = basic.currency();
            }

            BigDecimal accounting = BigDecimal.ZERO;
            BigDecimal statutory = BigDecimal.ZERO;
            BigDecimal runRate = BigDecimal.ZERO;
            boolean eligible = true;
            boolean capped = false;

            if (basic.amount() != null) {
                if (uae) {
                    UaeAccrual a = computeUaeAccrual(basic.amount(), yearsExact);
                    accounting = a.accounting;
                    statutory = a.statutory;
                    eligible = a.eligible;
                    capped = a.capped;
                    runRate = a.runRate;
                } else {
                    KsaAccrual a = computeKsaAccrual(basic.amount(), yearsExact);
                    accounting = a.accrual;
                    statutory = a.accrual; // no floor (art. 85 reductions not modeled)
                    runRate = a.runRate;
                }
            }

            totalStatutory = totalStatutory.add(statutory);
            totalAccounting = totalAccounting.add(accounting);
            totalRunRate = totalRunRate.add(runRate);

            rows.add(EosbProvisionRowDTO.builder()
                    .employeeId(e.getId())
                    .employeeCode(e.getEmployeeCode())
                    .employeeName(names.getOrDefault(e.getUserId(), "Unknown"))
                    .employmentStatus(e.getEmploymentStatus())
                    .joinDate(e.getJoinDate())
                    .serviceEndDate(serviceEnd)
                    .exitedInAsOfMonth(exitedInAsOfMonth)
                    .serviceYears(serviceYears)
                    .monthlyBasic(basic.amount())
                    .basicSource(basic.source())
                    .statutoryLiability(statutory)
                    .statutoryEligible(eligible)
                    .accountingAccrual(accounting)
                    .cappedAtTwoYearsPay(uae ? capped : Boolean.FALSE)
                    .monthlyRunRate(runRate)
                    .currency(basic.currency() != null ? basic.currency() : (uae ? "AED" : "SAR"))
                    .build());
        }

        rows.sort(Comparator.comparing(r -> r.getEmployeeCode() != null ? r.getEmployeeCode() : "",
                String.CASE_INSENSITIVE_ORDER));

        return EosbProvisionReportDTO.builder()
                .instituteId(instituteId)
                .countryCode(country)
                .asOfDate(asOf)
                .employeeCount(rows.size())
                .totalStatutoryLiability(totalStatutory)
                .totalAccountingAccrual(totalAccounting)
                .totalMonthlyRunRate(totalRunRate)
                .currency(reportCurrency != null ? reportCurrency : (uae ? "AED" : "SAR"))
                .rows(rows)
                .build();
    }

    /** CSV rendering of the same report for download. */
    @Transactional(readOnly = true)
    public String buildReportCsv(String instituteId, LocalDate asOfDate) {
        EosbProvisionReportDTO report = buildReport(instituteId, asOfDate);
        StringBuilder sb = new StringBuilder();
        sb.append("employee_code,employee_name,employment_status,join_date,service_end_date,")
                .append("service_years,monthly_basic,basic_source,statutory_liability,")
                .append("statutory_eligible,accounting_accrual,capped_at_two_years_pay,")
                .append("monthly_run_rate,currency,exited_in_as_of_month\n");
        for (EosbProvisionRowDTO r : report.getRows()) {
            sb.append(csv(r.getEmployeeCode())).append(',')
                    .append(csv(r.getEmployeeName())).append(',')
                    .append(csv(r.getEmploymentStatus())).append(',')
                    .append(csv(r.getJoinDate())).append(',')
                    .append(csv(r.getServiceEndDate())).append(',')
                    .append(csv(r.getServiceYears())).append(',')
                    .append(csv(r.getMonthlyBasic())).append(',')
                    .append(csv(r.getBasicSource())).append(',')
                    .append(csv(r.getStatutoryLiability())).append(',')
                    .append(csv(r.getStatutoryEligible())).append(',')
                    .append(csv(r.getAccountingAccrual())).append(',')
                    .append(csv(r.getCappedAtTwoYearsPay())).append(',')
                    .append(csv(r.getMonthlyRunRate())).append(',')
                    .append(csv(r.getCurrency())).append(',')
                    .append(csv(r.getExitedInAsOfMonth())).append('\n');
        }
        sb.append("STATUTORY_TOTAL,,,,,,,,").append(report.getTotalStatutoryLiability())
                .append(",,,,,,\n");
        sb.append("ACCOUNTING_TOTAL,,,,,,,,,,").append(report.getTotalAccountingAccrual())
                .append(",,,,\n");
        sb.append("RUN_RATE_TOTAL,,,,,,,,,,,,").append(report.getTotalMonthlyRunRate()).append(',')
                .append(report.getCurrency()).append(",\n");
        return sb.toString();
    }

    // ==================================================================
    // Accrual math
    // ==================================================================

    /**
     * UAE art. 51 band-split accrual: daily basic (basic/30) x
     * [min(years,5) x 21 + max(0, years-5) x 30], capped at basic x 24;
     * statutory figure floored to zero under 1 year of service.
     */
    private static UaeAccrual computeUaeAccrual(BigDecimal basic, BigDecimal yearsExact) {
        BigDecimal daily = basic.divide(THIRTY, 10, RoundingMode.HALF_UP);
        BigDecimal firstBandYears = yearsExact.min(FIVE);
        BigDecimal secondBandYears = yearsExact.subtract(FIVE).max(BigDecimal.ZERO);

        BigDecimal accounting = firstBandYears.multiply(UAE_DAYS_FIRST_BAND)
                .add(secondBandYears.multiply(UAE_DAYS_SECOND_BAND))
                .multiply(daily)
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal cap = basic.multiply(UAE_CAP_MONTHS).setScale(2, RoundingMode.HALF_UP);
        boolean capped = false;
        if (accounting.compareTo(cap) > 0) {
            accounting = cap;
            capped = true;
        }

        boolean eligible = yearsExact.compareTo(BigDecimal.ONE) >= 0;
        BigDecimal statutory = eligible ? accounting : BigDecimal.ZERO;

        BigDecimal bandDays = yearsExact.compareTo(FIVE) < 0 ? UAE_DAYS_FIRST_BAND : UAE_DAYS_SECOND_BAND;
        BigDecimal runRate = daily.multiply(bandDays).divide(TWELVE, 2, RoundingMode.HALF_UP);

        return new UaeAccrual(statutory, accounting, eligible, capped, runRate);
    }

    /**
     * KSA art. 84 band-split accrual: basic x [min(years,5) x 0.5 +
     * max(0, years-5) x 1]. No floor, no cap; art. 85 resignation reductions
     * intentionally not modeled (full liability provisioned).
     */
    private static KsaAccrual computeKsaAccrual(BigDecimal basic, BigDecimal yearsExact) {
        BigDecimal firstBandYears = yearsExact.min(FIVE);
        BigDecimal secondBandYears = yearsExact.subtract(FIVE).max(BigDecimal.ZERO);

        BigDecimal accrual = firstBandYears.multiply(HALF)
                .add(secondBandYears)
                .multiply(basic)
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal bandMonths = yearsExact.compareTo(FIVE) < 0 ? KSA_MONTHS_FIRST_BAND : KSA_MONTHS_SECOND_BAND;
        BigDecimal runRate = basic.multiply(bandMonths).divide(TWELVE, 2, RoundingMode.HALF_UP);

        return new KsaAccrual(accrual, runRate);
    }

    // ==================================================================
    // Lookups
    // ==================================================================

    /**
     * The institute's Gulf country from its tax configuration: ARE (UAE) or
     * SAU (KSA), accepting the common aliases. Any other (or missing)
     * configuration is a clean client error — this report is Gulf-only.
     */
    private String resolveGulfCountry(String instituteId) {
        List<TaxConfiguration> configs = taxConfigurationRepository
                .findAllByInstituteIdAndStatus(instituteId, "ACTIVE");
        if (configs.isEmpty()) {
            configs = taxConfigurationRepository.findAllByInstituteId(instituteId);
        }
        for (TaxConfiguration c : configs) {
            String code = c.getCountryCode() != null ? c.getCountryCode().trim().toUpperCase() : "";
            if (UAE_CODES.contains(code)) {
                return "ARE";
            }
            if (SAUDI_CODES.contains(code)) {
                return "SAU";
            }
        }
        throw new VacademyException(
                "The EOSB provision report applies to UAE (ARE) and Saudi Arabia (SAU) institutes only. "
                        + "This institute's tax configuration is "
                        + (configs.isEmpty() ? "not set up" : "for a different country")
                        + " — for India, use the gratuity provision report instead.");
    }

    /**
     * Monthly basic pay from the latest ACTIVE salary structure: the BASIC
     * component's monthly amount, falling back to 50% of gross monthly when no
     * BASIC component exists — the same resolution the gratuity report uses.
     */
    private GratuityProvisionService.BasicResolution resolveMonthlyBasic(String employeeId) {
        Optional<EmployeeSalaryStructure> structureOpt = salaryStructureRepository
                .findFirstByEmployee_IdAndStatusOrderByEffectiveFromDesc(employeeId, "ACTIVE");
        if (structureOpt.isEmpty()) {
            return new GratuityProvisionService.BasicResolution(null, "NONE", null);
        }
        EmployeeSalaryStructure structure = structureOpt.get();
        String currency = structure.getCurrency();
        if (structure.getComponents() != null) {
            for (EmployeeSalaryComponent c : structure.getComponents()) {
                if (c.getComponent() != null && "BASIC".equalsIgnoreCase(c.getComponent().getCode())
                        && c.getMonthlyAmount() != null) {
                    return new GratuityProvisionService.BasicResolution(
                            c.getMonthlyAmount().setScale(2, RoundingMode.HALF_UP),
                            "BASIC_COMPONENT", currency);
                }
            }
        }
        if (structure.getGrossMonthly() != null) {
            return new GratuityProvisionService.BasicResolution(
                    structure.getGrossMonthly().multiply(HALF).setScale(2, RoundingMode.HALF_UP),
                    "GROSS_FALLBACK", currency);
        }
        return new GratuityProvisionService.BasicResolution(null, "NONE", currency);
    }

    private Map<String, String> buildUserNameMap(List<String> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        List<User> users = userRepository.findByIdIn(userIds);
        return users.stream().collect(Collectors.toMap(
                User::getId,
                u -> u.getFullName() != null ? u.getFullName() : u.getUsername(),
                (a, b) -> a));
    }

    private static String csv(Object value) {
        if (value == null) return "";
        String s = String.valueOf(value);
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return '"' + s.replace("\"", "\"\"") + '"';
        }
        return s;
    }

    private record UaeAccrual(BigDecimal statutory, BigDecimal accounting,
                              boolean eligible, boolean capped, BigDecimal runRate) {
    }

    private record KsaAccrual(BigDecimal accrual, BigDecimal runRate) {
    }
}
