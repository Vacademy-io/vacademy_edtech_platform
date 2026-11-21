package vacademy.io.admin_core_service.features.hr_compliance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_compliance.dto.BonusComputationReportDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.BonusComputationRowDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.BonusMaterializationResultDTO;
import vacademy.io.admin_core_service.features.hr_compliance.repository.ComplianceProvisionQueryRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.dto.PayrollAdjustmentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollAdjustmentService;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryStructure;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryStructureRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Statutory bonus computation (Phase D) under the Payment of Bonus Act, 1965.
 *
 * <p>Statutory basis:
 * <ul>
 *   <li>Eligibility — s.2(13) + s.8: employees drawing salary/wage (basic + DA)
 *       up to Rs 21,000/month who worked at least 30 working days in the
 *       accounting year.</li>
 *   <li>Calculation ceiling — s.12: where salary/wage exceeds Rs 7,000/month
 *       (or the scheduled-employment minimum wage, if higher — see note below),
 *       bonus is computed as if it were Rs 7,000.</li>
 *   <li>Rate — s.10 minimum 8.33%, s.11 maximum 20% of salary/wage earned in
 *       the accounting year.</li>
 * </ul>
 *
 * <p>Wage basis note: statutory "salary or wage" is basic + dearness allowance.
 * This platform's salary structures carry no separate DA component — institutes
 * are expected to merge DA into the BASIC component, so the BASIC monthly
 * amount is used as the bonus wage. The s.12 alternative floor (minimum wage
 * for the scheduled employment, if above 7,000) is not modeled — states'
 * minimum wages are not configured in the platform; flagged for a later phase.
 *
 * <p>Working-days assumption: attendance-level working-day counts are not
 * consulted; an employee employed during the FY is assumed to satisfy the
 * 30-working-day threshold unless joinDate/lastWorkingDate constrain the
 * employment window to fewer than 30 calendar days of overlap with the FY.
 */
@Service
public class StatutoryBonusService {

    /** s.2(13) eligibility wage ceiling (2015 amendment). */
    static final BigDecimal ELIGIBILITY_WAGE_CEILING = new BigDecimal("21000");
    /** s.12 calculation wage ceiling (2015 amendment). */
    static final BigDecimal CALCULATION_WAGE_CEILING = new BigDecimal("7000");
    /** s.10 statutory minimum bonus rate (%). */
    static final BigDecimal MIN_BONUS_PCT = new BigDecimal("8.33");
    /** s.11 statutory maximum bonus rate (%). */
    static final BigDecimal MAX_BONUS_PCT = new BigDecimal("20");
    /** Component code created for materialized bonus adjustments. */
    static final String BONUS_CODE = "STATUTORY_BONUS";
    /** s.8: minimum working days in the accounting year. */
    private static final long MIN_WORKING_DAYS = 30;
    /**
     * A calendar month counts as an eligible service month when the employee
     * was employed for at least this many of its days (half-month convention).
     */
    private static final long MIN_DAYS_FOR_MONTH = 15;
    private static final BigDecimal HALF = new BigDecimal("0.50");
    private static final BigDecimal HUNDRED = new BigDecimal("100");

    @Autowired
    private ComplianceProvisionQueryRepository provisionQueryRepository;

    @Autowired
    private EmployeeSalaryStructureRepository salaryStructureRepository;

    @Autowired
    private PayrollAdjustmentService payrollAdjustmentService;

    @Autowired
    private UserRepository userRepository;

    @Transactional(readOnly = true)
    public BonusComputationReportDTO computeBonus(String instituteId, String financialYear, BigDecimal bonusPct) {
        LocalDate fyStart = parseFyStart(financialYear);
        LocalDate fyEnd = fyStart.plusYears(1).minusDays(1); // Mar 31
        BigDecimal pct = clampPct(bonusPct);

        List<EmployeeProfile> employees = provisionQueryRepository.findAllEmployeesByInstitute(instituteId);
        Map<String, String> names = buildUserNameMap(
                employees.stream().map(EmployeeProfile::getUserId).filter(Objects::nonNull)
                        .distinct().collect(Collectors.toList()));

        List<BonusComputationRowDTO> rows = new ArrayList<>();
        BigDecimal totalBonus = BigDecimal.ZERO;
        int eligibleCount = 0;
        String reportCurrency = null;

        for (EmployeeProfile e : employees) {
            if (e.getJoinDate() == null || e.getJoinDate().isAfter(fyEnd)) {
                continue; // never in service during this FY
            }
            LocalDate serviceEnd = e.getLastWorkingDate() != null ? e.getLastWorkingDate() : fyEnd;
            if (serviceEnd.isBefore(fyStart)) {
                continue; // exited before the FY began
            }

            LocalDate overlapStart = e.getJoinDate().isAfter(fyStart) ? e.getJoinDate() : fyStart;
            LocalDate overlapEnd = serviceEnd.isBefore(fyEnd) ? serviceEnd : fyEnd;
            long overlapDays = ChronoUnit.DAYS.between(overlapStart, overlapEnd) + 1;

            BasicResolution basic = resolveMonthlyBasic(e.getId());
            if (reportCurrency == null && basic.currency != null) {
                reportCurrency = basic.currency;
            }

            String ineligibleReason = null;
            if (basic.amount == null) {
                ineligibleReason = "No ACTIVE salary structure / BASIC not resolvable";
            } else if (basic.amount.compareTo(ELIGIBILITY_WAGE_CEILING) > 0) {
                ineligibleReason = "Monthly wage above Rs 21,000 eligibility ceiling (s.2(13))";
            } else if (overlapDays < MIN_WORKING_DAYS) {
                ineligibleReason = "Fewer than 30 days of service in the FY (s.8)";
            }
            boolean eligible = ineligibleReason == null;

            int eligibleMonths = eligible ? countEligibleMonths(fyStart, overlapStart, overlapEnd) : 0;
            BigDecimal bonusWage = eligible ? basic.amount.min(CALCULATION_WAGE_CEILING) : null;
            BigDecimal bonus = BigDecimal.ZERO;
            if (eligible && eligibleMonths > 0) {
                bonus = bonusWage.multiply(new BigDecimal(eligibleMonths))
                        .multiply(pct).divide(HUNDRED, 2, RoundingMode.HALF_UP);
            }

            if (eligible) {
                eligibleCount++;
                totalBonus = totalBonus.add(bonus);
            }

            rows.add(BonusComputationRowDTO.builder()
                    .employeeId(e.getId())
                    .employeeCode(e.getEmployeeCode())
                    .employeeName(names.getOrDefault(e.getUserId(), "Unknown"))
                    .monthlyBasic(basic.amount)
                    .eligible(eligible)
                    .ineligibleReason(ineligibleReason)
                    .eligibleMonths(eligibleMonths)
                    .bonusWageBase(bonusWage)
                    .computedBonus(bonus)
                    .currency(basic.currency != null ? basic.currency : "INR")
                    .build());
        }

        rows.sort(Comparator.comparing(r -> r.getEmployeeCode() != null ? r.getEmployeeCode() : "",
                String.CASE_INSENSITIVE_ORDER));

        return BonusComputationReportDTO.builder()
                .instituteId(instituteId)
                .financialYear(financialYear)
                .fyStart(fyStart)
                .fyEnd(fyEnd)
                .bonusPct(pct)
                .eligibleCount(eligibleCount)
                .totalBonus(totalBonus)
                .currency(reportCurrency != null ? reportCurrency : "INR")
                .rows(rows)
                .build();
    }

    /**
     * Materializes the computed bonus as one BONUS-scope payroll adjustment per
     * eligible employee for the given payout month/year. Idempotent: employees
     * that already carry a STATUTORY_BONUS adjustment for that period —
     * consumed by a run or still pending — are skipped, so re-running after a
     * partial failure only fills the gaps.
     */
    @Transactional
    public BonusMaterializationResultDTO materialize(String instituteId, String financialYear,
                                                     BigDecimal bonusPct, Integer month, Integer year,
                                                     CustomUserDetails user) {
        if (month == null || month < 1 || month > 12 || year == null || year < 2000 || year > 2100) {
            throw new VacademyException("Valid payout month and year are required");
        }
        BonusComputationReportDTO report = computeBonus(instituteId, financialYear, bonusPct);

        Set<String> alreadyMaterialized = new HashSet<>(
                provisionQueryRepository.findAdjustmentEmployeeIdsForPeriod(instituteId, year, month, BONUS_CODE));

        int created = 0;
        int skipped = 0;
        BigDecimal totalAmount = BigDecimal.ZERO;
        for (BonusComputationRowDTO row : report.getRows()) {
            if (!Boolean.TRUE.equals(row.getEligible())
                    || row.getComputedBonus() == null
                    || row.getComputedBonus().compareTo(BigDecimal.ZERO) <= 0) {
                continue;
            }
            if (alreadyMaterialized.contains(row.getEmployeeId())) {
                skipped++;
                continue;
            }
            PayrollAdjustmentDTO dto = PayrollAdjustmentDTO.builder()
                    .employeeId(row.getEmployeeId())
                    .month(month)
                    .year(year)
                    .type("EARNING")
                    .code(BONUS_CODE)
                    .label("Statutory Bonus FY " + financialYear)
                    .amount(row.getComputedBonus())
                    .currency(row.getCurrency())
                    .runScope("BONUS")
                    .notes("Payment of Bonus Act computation @ " + report.getBonusPct()
                            + "% for " + row.getEligibleMonths() + " eligible month(s), wage base "
                            + row.getBonusWageBase())
                    .build();
            payrollAdjustmentService.createAdjustment(dto, instituteId, user, "SYSTEM");
            created++;
            totalAmount = totalAmount.add(row.getComputedBonus());
        }

        return BonusMaterializationResultDTO.builder()
                .financialYear(financialYear)
                .month(month)
                .year(year)
                .bonusPct(report.getBonusPct())
                .createdCount(created)
                .skippedExistingCount(skipped)
                .totalAmount(totalAmount)
                .build();
    }

    /** "2025-26" -> 2025-04-01; validates format and year continuity. */
    static LocalDate parseFyStart(String financialYear) {
        if (financialYear == null || !financialYear.matches("\\d{4}-\\d{2}")) {
            throw new VacademyException("financialYear must look like 2025-26");
        }
        int startYear = Integer.parseInt(financialYear.substring(0, 4));
        int endTwoDigit = Integer.parseInt(financialYear.substring(5));
        if ((startYear + 1) % 100 != endTwoDigit) {
            throw new VacademyException("financialYear years must be consecutive, e.g. 2025-26");
        }
        return LocalDate.of(startYear, 4, 1);
    }

    /** Clamp the requested rate into the Act's [8.33, 20] band; default 8.33. */
    static BigDecimal clampPct(BigDecimal requested) {
        if (requested == null) return MIN_BONUS_PCT;
        if (requested.compareTo(MIN_BONUS_PCT) < 0) return MIN_BONUS_PCT;
        if (requested.compareTo(MAX_BONUS_PCT) > 0) return MAX_BONUS_PCT;
        return requested;
    }

    /**
     * Number of FY calendar months in which the employee was employed for at
     * least 15 days (half-month convention; documented judgment call — the Act
     * prorates on salary "earned", which monthly proration approximates).
     */
    private int countEligibleMonths(LocalDate fyStart, LocalDate overlapStart, LocalDate overlapEnd) {
        int months = 0;
        for (int i = 0; i < 12; i++) {
            YearMonth ym = YearMonth.from(fyStart.plusMonths(i));
            LocalDate monthStart = ym.atDay(1);
            LocalDate monthEnd = ym.atEndOfMonth();
            LocalDate s = overlapStart.isAfter(monthStart) ? overlapStart : monthStart;
            LocalDate t = overlapEnd.isBefore(monthEnd) ? overlapEnd : monthEnd;
            if (!s.isAfter(t) && ChronoUnit.DAYS.between(s, t) + 1 >= MIN_DAYS_FOR_MONTH) {
                months++;
            }
        }
        return months;
    }

    /**
     * Bonus wage (basic + merged DA) from the latest ACTIVE structure's BASIC
     * component, falling back to 50% of gross monthly when absent.
     */
    private BasicResolution resolveMonthlyBasic(String employeeId) {
        Optional<EmployeeSalaryStructure> structureOpt = salaryStructureRepository
                .findFirstByEmployee_IdAndStatusOrderByEffectiveFromDesc(employeeId, "ACTIVE");
        if (structureOpt.isEmpty()) {
            return new BasicResolution(null, null);
        }
        EmployeeSalaryStructure structure = structureOpt.get();
        if (structure.getComponents() != null) {
            for (EmployeeSalaryComponent c : structure.getComponents()) {
                if (c.getComponent() != null && "BASIC".equalsIgnoreCase(c.getComponent().getCode())
                        && c.getMonthlyAmount() != null) {
                    return new BasicResolution(
                            c.getMonthlyAmount().setScale(2, RoundingMode.HALF_UP),
                            structure.getCurrency());
                }
            }
        }
        if (structure.getGrossMonthly() != null) {
            return new BasicResolution(
                    structure.getGrossMonthly().multiply(HALF).setScale(2, RoundingMode.HALF_UP),
                    structure.getCurrency());
        }
        return new BasicResolution(null, structure.getCurrency());
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

    record BasicResolution(BigDecimal amount, String currency) {
    }
}
