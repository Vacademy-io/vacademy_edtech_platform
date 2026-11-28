package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.GratuityProvisionReportDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.GratuityProvisionRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.repository.ComplianceProvisionQueryRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryStructure;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryStructureRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.Period;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Gratuity provision report (Phase D) under the Payment of Gratuity Act, 1972.
 *
 * <p>Statutory basis, s.4: gratuity = (15/26) x last drawn monthly wages
 * (basic + DA) x completed years of service, where a part of a year in excess
 * of six months counts as a full year, capped at Rs 20,00,000 (ceiling per the
 * 2018 amendment + MoLE notification S.O.1420(E)).
 *
 * <p>Vesting: payable after 5 years of continuous service (s.4(1)), which
 * judicial precedent (Mettur Beardsell Ltd. v. RLC, Madras HC) reads as
 * 4 years + 240 days. Employees short of vesting still carry an accounting
 * provision (AS-15/Ind AS-19 accrual view) and are reported flagged unvested.
 *
 * <p>Monthly run-rate: 4.81% of monthly basic — the payroll-costing
 * approximation of (15/26)/12.
 */
@Service
public class GratuityProvisionService {

    /** Rs 20,00,000 statutory ceiling on gratuity payable. */
    static final BigDecimal GRATUITY_CEILING = new BigDecimal("2000000.00");
    /** Monthly accrual run-rate: 4.81% of monthly basic. */
    static final BigDecimal MONTHLY_RUN_RATE_PCT = new BigDecimal("4.81");
    static final Set<String> EXITED_STATUSES = Set.of("TERMINATED", "RELIEVED", "ABSCONDING");
    private static final BigDecimal FIFTEEN = new BigDecimal("15");
    private static final BigDecimal TWENTY_SIX = new BigDecimal("26");
    private static final BigDecimal DAYS_PER_YEAR = new BigDecimal("365.2425");
    private static final BigDecimal HALF = new BigDecimal("0.50");
    private static final BigDecimal HUNDRED = new BigDecimal("100");

    @Autowired
    private ComplianceProvisionQueryRepository provisionQueryRepository;

    @Autowired
    private EmployeeSalaryStructureRepository salaryStructureRepository;

    @Autowired
    private UserRepository userRepository;

    @Transactional(readOnly = true)
    public GratuityProvisionReportDTO buildReport(String instituteId, LocalDate asOfDate) {
        LocalDate asOf = asOfDate != null ? asOfDate : LocalDate.now();
        List<EmployeeProfile> employees = provisionQueryRepository.findAllEmployeesByInstitute(instituteId);

        Map<String, String> names = buildUserNameMap(
                employees.stream().map(EmployeeProfile::getUserId).filter(java.util.Objects::nonNull)
                        .distinct().collect(Collectors.toList()));

        List<GratuityProvisionRowDTO> rows = new ArrayList<>();
        BigDecimal totalAccrued = BigDecimal.ZERO;
        BigDecimal vestedAccrued = BigDecimal.ZERO;
        BigDecimal unvestedAccrued = BigDecimal.ZERO;
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
            BigDecimal rawYears = new BigDecimal(serviceDays)
                    .divide(DAYS_PER_YEAR, 2, RoundingMode.HALF_UP);

            Period p = Period.between(e.getJoinDate(), serviceEnd);
            int completedYears = p.getYears();
            // s.4(2): a part of a year "in excess of six months" rounds up to a
            // full year — applied once past the 5-year vesting threshold, per
            // the reporting convention for this pack.
            boolean partExceedsSixMonths = p.getMonths() > 6 || (p.getMonths() == 6 && p.getDays() > 0);
            int roundedYears = completedYears + ((completedYears >= 5 && partExceedsSixMonths) ? 1 : 0);

            // Vesting: 4 years + 240 days of continuous service.
            boolean vested = !e.getJoinDate().plusYears(4).plusDays(240).isAfter(serviceEnd);

            BasicResolution basic = resolveMonthlyBasic(e.getId());
            if (reportCurrency == null && basic.currency != null) {
                reportCurrency = basic.currency;
            }

            BigDecimal accrued = BigDecimal.ZERO;
            BigDecimal runRate = BigDecimal.ZERO;
            boolean capped = false;
            if (basic.amount != null) {
                accrued = basic.amount.multiply(FIFTEEN)
                        .divide(TWENTY_SIX, 10, RoundingMode.HALF_UP)
                        .multiply(new BigDecimal(roundedYears))
                        .setScale(2, RoundingMode.HALF_UP);
                if (accrued.compareTo(GRATUITY_CEILING) > 0) {
                    accrued = GRATUITY_CEILING;
                    capped = true;
                }
                runRate = basic.amount.multiply(MONTHLY_RUN_RATE_PCT)
                        .divide(HUNDRED, 2, RoundingMode.HALF_UP);
            }

            totalAccrued = totalAccrued.add(accrued);
            if (vested) {
                vestedAccrued = vestedAccrued.add(accrued);
            } else {
                unvestedAccrued = unvestedAccrued.add(accrued);
            }
            totalRunRate = totalRunRate.add(runRate);

            rows.add(GratuityProvisionRowDTO.builder()
                    .employeeId(e.getId())
                    .employeeCode(e.getEmployeeCode())
                    .employeeName(names.getOrDefault(e.getUserId(), "Unknown"))
                    .employmentStatus(e.getEmploymentStatus())
                    .joinDate(e.getJoinDate())
                    .serviceEndDate(serviceEnd)
                    .exitedInAsOfMonth(exitedInAsOfMonth)
                    .rawYears(rawYears)
                    .roundedYears(roundedYears)
                    .monthlyBasic(basic.amount)
                    .basicSource(basic.source)
                    .accruedLiability(accrued)
                    .cappedAtCeiling(capped)
                    .vested(vested)
                    .monthlyRunRate(runRate)
                    .currency(basic.currency != null ? basic.currency : "INR")
                    .build());
        }

        rows.sort(Comparator.comparing(r -> r.getEmployeeCode() != null ? r.getEmployeeCode() : "",
                String.CASE_INSENSITIVE_ORDER));

        return GratuityProvisionReportDTO.builder()
                .instituteId(instituteId)
                .asOfDate(asOf)
                .employeeCount(rows.size())
                .totalAccruedLiability(totalAccrued)
                .vestedAccruedLiability(vestedAccrued)
                .unvestedAccruedLiability(unvestedAccrued)
                .totalMonthlyRunRate(totalRunRate)
                .currency(reportCurrency != null ? reportCurrency : "INR")
                .rows(rows)
                .build();
    }

    /** CSV rendering of the same report for download. */
    @Transactional(readOnly = true)
    public String buildReportCsv(String instituteId, LocalDate asOfDate) {
        GratuityProvisionReportDTO report = buildReport(instituteId, asOfDate);
        StringBuilder sb = new StringBuilder();
        sb.append("employee_code,employee_name,employment_status,join_date,service_end_date,")
                .append("raw_years,rounded_years,monthly_basic,basic_source,accrued_liability,")
                .append("capped_at_ceiling,vested,monthly_run_rate,currency,exited_in_as_of_month\n");
        for (GratuityProvisionRowDTO r : report.getRows()) {
            sb.append(csv(r.getEmployeeCode())).append(',')
                    .append(csv(r.getEmployeeName())).append(',')
                    .append(csv(r.getEmploymentStatus())).append(',')
                    .append(csv(r.getJoinDate())).append(',')
                    .append(csv(r.getServiceEndDate())).append(',')
                    .append(csv(r.getRawYears())).append(',')
                    .append(csv(r.getRoundedYears())).append(',')
                    .append(csv(r.getMonthlyBasic())).append(',')
                    .append(csv(r.getBasicSource())).append(',')
                    .append(csv(r.getAccruedLiability())).append(',')
                    .append(csv(r.getCappedAtCeiling())).append(',')
                    .append(csv(r.getVested())).append(',')
                    .append(csv(r.getMonthlyRunRate())).append(',')
                    .append(csv(r.getCurrency())).append(',')
                    .append(csv(r.getExitedInAsOfMonth())).append('\n');
        }
        sb.append("TOTAL,,,,,,,,,").append(report.getTotalAccruedLiability()).append(",,,")
                .append(report.getTotalMonthlyRunRate()).append(',')
                .append(report.getCurrency()).append(",\n");
        sb.append("VESTED_TOTAL,,,,,,,,,").append(report.getVestedAccruedLiability()).append(",,,,,\n");
        sb.append("UNVESTED_TOTAL,,,,,,,,,").append(report.getUnvestedAccruedLiability()).append(",,,,,\n");
        return sb.toString();
    }

    /**
     * Monthly basic pay from the latest ACTIVE salary structure: the BASIC
     * component's monthly amount, falling back to 50% of gross monthly when no
     * BASIC component exists. (DA, where an institute pays it, is expected to
     * be merged into BASIC for statutory wage purposes — see StatutoryBonusService.)
     */
    private BasicResolution resolveMonthlyBasic(String employeeId) {
        Optional<EmployeeSalaryStructure> structureOpt = salaryStructureRepository
                .findFirstByEmployee_IdAndStatusOrderByEffectiveFromDesc(employeeId, "ACTIVE");
        if (structureOpt.isEmpty()) {
            return new BasicResolution(null, "NONE", null);
        }
        EmployeeSalaryStructure structure = structureOpt.get();
        String currency = structure.getCurrency();
        if (structure.getComponents() != null) {
            for (EmployeeSalaryComponent c : structure.getComponents()) {
                if (c.getComponent() != null && "BASIC".equalsIgnoreCase(c.getComponent().getCode())
                        && c.getMonthlyAmount() != null) {
                    return new BasicResolution(
                            c.getMonthlyAmount().setScale(2, RoundingMode.HALF_UP),
                            "BASIC_COMPONENT", currency);
                }
            }
        }
        if (structure.getGrossMonthly() != null) {
            return new BasicResolution(
                    structure.getGrossMonthly().multiply(HALF).setScale(2, RoundingMode.HALF_UP),
                    "GROSS_FALLBACK", currency);
        }
        return new BasicResolution(null, "NONE", currency);
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

    /** Resolved monthly basic + provenance. */
    record BasicResolution(BigDecimal amount, String source, String currency) {
    }
}
