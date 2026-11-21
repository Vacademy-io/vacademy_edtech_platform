package vacademy.io.admin_core_service.features.hr_leave.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveBalanceAdjustDTO;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveBalanceDTO;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveAccrualTxn;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveBalance;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeavePolicy;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveType;
import vacademy.io.admin_core_service.features.hr_leave.enums.AccrualType;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveAccrualTxnRepository;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveBalanceRepository;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeavePolicyRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class LeaveBalanceService {

    @Autowired
    private LeaveBalanceRepository leaveBalanceRepository;

    @Autowired
    private LeavePolicyRepository leavePolicyRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private LeaveAccrualTxnRepository leaveAccrualTxnRepository;

    @Autowired
    private AttendanceConfigRepository attendanceConfigRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    /**
     * Balances for one employee, or — when no employeeId is given — for every
     * employee in the institute, which is what the HR balance dashboard needs.
     * The institute-wide form is HR-staff only; the per-employee form still lets
     * an employee read their own.
     */
    @Transactional(readOnly = true)
    public List<LeaveBalanceDTO> getBalances(String employeeId, Integer year, String instituteId, CustomUserDetails user) {
        List<LeaveBalance> balances;
        if (employeeId == null || employeeId.isBlank()) {
            hrAccessGuard.requireHrStaff(user, instituteId);
            balances = leaveBalanceRepository.findByEmployee_InstituteIdAndYear(instituteId, year);
        } else {
            hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
            balances = leaveBalanceRepository.findByEmployee_IdAndYear(employeeId, year);
        }
        return balances.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    @Transactional
    public String adjustBalance(String balanceId, LeaveBalanceAdjustDTO dto, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        if (dto.getAdjustment() == null) {
            throw new VacademyException("Adjustment amount is required");
        }

        LeaveBalance balance = leaveBalanceRepository.findById(balanceId)
                .orElseThrow(() -> new VacademyException("Leave balance not found"));
        hrAccessGuard.requireInstituteMatch(balance.getEmployee().getInstituteId(), instituteId, "Leave balance");

        BigDecimal currentAdjustment = balance.getAdjustment() != null ? balance.getAdjustment() : BigDecimal.ZERO;
        balance.setAdjustment(currentAdjustment.add(dto.getAdjustment()));
        leaveBalanceRepository.save(balance);

        return balance.getId();
    }

    /**
     * Accrual process: for each active policy × eligible employee, records a
     * ledger row (hr_leave_accrual_txn) for the CURRENT period — MONTHLY
     * "YYYY-MM", QUARTERLY "YYYY-Qn", YEARLY "YYYY" — and adds the accrual
     * amount to the balance's accrued. The unique (employee, leave type,
     * period_key) constraint on the ledger makes the process idempotent per
     * period, replacing the old "accrued >= amount * month" heuristic.
     */
    @Transactional
    public String accrueLeaves(String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return accrueLeavesInternal(instituteId);
    }

    /**
     * Guard-free accrual core, shared by the guarded admin endpoint above and
     * the daily LeaveAccrualJob (which runs with no CustomUserDetails). The
     * accrual ledger's unique (employee, leave type, period_key) constraint
     * makes calling this daily safe — each period is credited exactly once.
     */
    @Transactional
    public String accrueLeavesInternal(String instituteId) {
        // "Today" in the institute's timezone (JVM stays UTC)
        AttendanceConfig attendanceConfig = attendanceConfigRepository.findByInstituteId(instituteId).orElse(null);
        LocalDate today = LocalDate.now(HrTimeUtil.resolveZone(attendanceConfig));
        int currentYear = today.getYear();

        List<LeavePolicy> activePolicies = leavePolicyRepository.findActivePolicies(instituteId, today);
        if (activePolicies.isEmpty()) {
            return "No active accrual policies found";
        }

        // Get all active employees
        List<EmployeeProfile> activeEmployees = employeeProfileRepository.findActiveEmployees(
                instituteId, Arrays.asList("ACTIVE", "PROBATION"));

        int accruedCount = 0;

        for (EmployeeProfile employee : activeEmployees) {
            for (LeavePolicy policy : activePolicies) {
                AccrualType accrualType = parseAccrualType(policy.getAccrualType());
                if (accrualType == null) {
                    // Missing/unknown accrual type — nothing to accrue
                    continue;
                }

                // Check if the policy is applicable to this employee's employment type
                if (policy.getApplicableEmploymentTypes() != null
                        && !policy.getApplicableEmploymentTypes().isEmpty()
                        && !policy.getApplicableEmploymentTypes().contains(employee.getEmploymentType())) {
                    continue;
                }

                // Check if applicable after days condition is met
                if (policy.getApplicableAfterDays() != null && policy.getApplicableAfterDays() > 0) {
                    long daysSinceJoining = ChronoUnit.DAYS.between(
                            employee.getJoinDate(), today);
                    if (daysSinceJoining < policy.getApplicableAfterDays()) {
                        continue;
                    }
                }

                // Current period bounds + ledger key
                LocalDate periodStart;
                LocalDate periodEnd;
                String periodKey;
                switch (accrualType) {
                    case MONTHLY -> {
                        YearMonth yearMonth = YearMonth.from(today);
                        periodStart = yearMonth.atDay(1);
                        periodEnd = yearMonth.atEndOfMonth();
                        periodKey = String.format("%d-%02d", currentYear, today.getMonthValue());
                    }
                    case QUARTERLY -> {
                        int quarter = (today.getMonthValue() - 1) / 3 + 1;
                        periodStart = LocalDate.of(currentYear, (quarter - 1) * 3 + 1, 1);
                        periodEnd = periodStart.plusMonths(3).minusDays(1);
                        periodKey = currentYear + "-Q" + quarter;
                    }
                    default -> {
                        periodStart = LocalDate.of(currentYear, 1, 1);
                        periodEnd = LocalDate.of(currentYear, 12, 31);
                        periodKey = String.valueOf(currentYear);
                    }
                }

                // Ledger idempotency: skip if this period was already accrued
                if (leaveAccrualTxnRepository.existsByEmployeeIdAndLeaveTypeIdAndPeriodKey(
                        employee.getId(), policy.getLeaveType().getId(), periodKey)) {
                    continue;
                }

                BigDecimal accrualAmount = policy.getAccrualAmount();
                if (accrualAmount == null) {
                    accrualAmount = accrualType == AccrualType.YEARLY
                            ? policy.getAnnualQuota()
                            : BigDecimal.ZERO;
                }

                // Pro-rata: a mid-period joiner's FIRST period is scaled by
                // remaining-days-in-period / total-days-in-period (1 decimal).
                String source = "ACCRUAL";
                if (Boolean.TRUE.equals(policy.getProRataEnabled())
                        && employee.getJoinDate() != null
                        && employee.getJoinDate().isAfter(periodStart)
                        && !employee.getJoinDate().isAfter(periodEnd)) {
                    long totalDays = ChronoUnit.DAYS.between(periodStart, periodEnd) + 1;
                    long remainingDays = ChronoUnit.DAYS.between(employee.getJoinDate(), periodEnd) + 1;
                    accrualAmount = accrualAmount
                            .multiply(BigDecimal.valueOf(remainingDays))
                            .divide(BigDecimal.valueOf(totalDays), 1, RoundingMode.HALF_UP);
                    source = "PRO_RATA";
                }

                // Record the ledger row FIRST — the unique constraint is the
                // real guard against a concurrent double-accrual.
                LeaveAccrualTxn txn = new LeaveAccrualTxn();
                txn.setEmployeeId(employee.getId());
                txn.setLeaveTypeId(policy.getLeaveType().getId());
                txn.setPolicyId(policy.getId());
                txn.setYear(currentYear);
                txn.setPeriodKey(periodKey);
                txn.setAmount(accrualAmount);
                txn.setSource(source);
                try {
                    leaveAccrualTxnRepository.saveAndFlush(txn);
                } catch (DataIntegrityViolationException e) {
                    // A concurrent run already accrued this period — skip
                    continue;
                }

                // Find or create leave balance
                Optional<LeaveBalance> existingBalance = leaveBalanceRepository
                        .findByEmployee_IdAndLeaveType_IdAndYear(
                                employee.getId(),
                                policy.getLeaveType().getId(),
                                currentYear);

                LeaveBalance balance;
                if (existingBalance.isPresent()) {
                    balance = existingBalance.get();
                } else {
                    balance = new LeaveBalance();
                    balance.setEmployee(employee);
                    balance.setLeaveType(policy.getLeaveType());
                    balance.setYear(currentYear);
                    balance.setOpeningBalance(BigDecimal.ZERO);
                    balance.setAccrued(BigDecimal.ZERO);
                    balance.setUsed(BigDecimal.ZERO);
                    balance.setAdjustment(BigDecimal.ZERO);
                    balance.setCarriedForward(BigDecimal.ZERO);
                    balance.setEncashed(BigDecimal.ZERO);
                }

                // Add accrual amount, capped to the annual quota
                BigDecimal currentAccrued = balance.getAccrued() != null ? balance.getAccrued() : BigDecimal.ZERO;
                BigDecimal newAccrued = currentAccrued.add(accrualAmount);
                if (policy.getAnnualQuota() != null && newAccrued.compareTo(policy.getAnnualQuota()) > 0) {
                    newAccrued = policy.getAnnualQuota();
                }

                balance.setAccrued(newAccrued);
                leaveBalanceRepository.save(balance);
                accruedCount++;
            }
        }

        return "Accrual completed for " + accruedCount + " employee-policy combinations";
    }

    private AccrualType parseAccrualType(String value) {
        if (value == null) {
            return null;
        }
        try {
            return AccrualType.valueOf(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Year-end process: for each employee's leave balance of the closing year,
     * calculate closing balance and handle carry forward and encashment.
     *
     * Idempotent per employee/leave-type via the accrual ledger: processing a
     * balance records a "CARRY-YYYY" txn (source CARRY_FORWARD), and balances
     * with an existing marker are skipped — a partially failed run can be
     * re-run and only picks up the unprocessed combinations (the old guard
     * refused the whole run if ANY next-year balance existed).
     */
    @Transactional
    public String yearEndProcess(String instituteId, Integer year, CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        int nextYear = year + 1;
        String carryPeriodKey = "CARRY-" + year;

        // Get all active employees
        List<EmployeeProfile> activeEmployees = employeeProfileRepository.findActiveEmployees(
                instituteId, Arrays.asList("ACTIVE", "PROBATION"));

        int processedCount = 0;

        for (EmployeeProfile employee : activeEmployees) {
            List<LeaveBalance> balances = leaveBalanceRepository.findByEmployee_IdAndYear(
                    employee.getId(), year);

            for (LeaveBalance balance : balances) {
                LeaveType leaveType = balance.getLeaveType();

                // Re-run guard: already processed for this employee/type
                if (leaveAccrualTxnRepository.existsByEmployeeIdAndLeaveTypeIdAndPeriodKey(
                        employee.getId(), leaveType.getId(), carryPeriodKey)) {
                    continue;
                }

                BigDecimal closingBalance = balance.getClosingBalance();
                BigDecimal carryForwardAmount = BigDecimal.ZERO;
                BigDecimal encashedAmount = BigDecimal.ZERO;

                if (closingBalance.compareTo(BigDecimal.ZERO) > 0) {
                    // Handle carry forward
                    if (Boolean.TRUE.equals(leaveType.getIsCarryForward())) {
                        carryForwardAmount = closingBalance;
                        // Cap at max carry forward if specified
                        if (leaveType.getMaxCarryForward() != null && leaveType.getMaxCarryForward() > 0) {
                            BigDecimal maxCF = new BigDecimal(leaveType.getMaxCarryForward());
                            if (carryForwardAmount.compareTo(maxCF) > 0) {
                                BigDecimal excess = carryForwardAmount.subtract(maxCF);
                                carryForwardAmount = maxCF;

                                // If encashable, mark the excess as encashed
                                if (Boolean.TRUE.equals(leaveType.getIsEncashable())) {
                                    encashedAmount = excess;
                                }
                            }
                        }
                    } else if (Boolean.TRUE.equals(leaveType.getIsEncashable())) {
                        // No carry forward, but encashable: encash entire closing balance
                        encashedAmount = closingBalance;
                    }
                }

                // Record the marker txn FIRST — its unique constraint is the
                // guard against a concurrent run double-processing this combo.
                LeaveAccrualTxn txn = new LeaveAccrualTxn();
                txn.setEmployeeId(employee.getId());
                txn.setLeaveTypeId(leaveType.getId());
                txn.setYear(year);
                txn.setPeriodKey(carryPeriodKey);
                txn.setAmount(carryForwardAmount);
                txn.setSource("CARRY_FORWARD");
                try {
                    leaveAccrualTxnRepository.saveAndFlush(txn);
                } catch (DataIntegrityViolationException e) {
                    // A concurrent run already processed this combination — skip
                    continue;
                }

                // Update encashed amount on closing year's balance
                if (encashedAmount.compareTo(BigDecimal.ZERO) > 0) {
                    BigDecimal currentEncashed = balance.getEncashed() != null
                            ? balance.getEncashed() : BigDecimal.ZERO;
                    balance.setEncashed(currentEncashed.add(encashedAmount));
                    leaveBalanceRepository.save(balance);
                }

                // Create next year's balance with carry forward
                if (carryForwardAmount.compareTo(BigDecimal.ZERO) > 0) {
                    Optional<LeaveBalance> nextYearBalance = leaveBalanceRepository
                            .findByEmployee_IdAndLeaveType_IdAndYear(
                                    employee.getId(),
                                    leaveType.getId(),
                                    nextYear);

                    LeaveBalance newBalance;
                    if (nextYearBalance.isPresent()) {
                        newBalance = nextYearBalance.get();
                        newBalance.setCarriedForward(carryForwardAmount);
                    } else {
                        newBalance = new LeaveBalance();
                        newBalance.setEmployee(employee);
                        newBalance.setLeaveType(leaveType);
                        newBalance.setYear(nextYear);
                        newBalance.setOpeningBalance(BigDecimal.ZERO);
                        newBalance.setAccrued(BigDecimal.ZERO);
                        newBalance.setUsed(BigDecimal.ZERO);
                        newBalance.setAdjustment(BigDecimal.ZERO);
                        newBalance.setCarriedForward(carryForwardAmount);
                        newBalance.setEncashed(BigDecimal.ZERO);
                    }

                    leaveBalanceRepository.save(newBalance);
                }

                processedCount++;
            }
        }

        return "Year-end process completed for " + processedCount + " balance records";
    }

    private LeaveBalanceDTO toDTO(LeaveBalance entity) {
        return LeaveBalanceDTO.builder()
                .id(entity.getId())
                .employeeId(entity.getEmployee().getId())
                .leaveTypeId(entity.getLeaveType().getId())
                .leaveTypeName(entity.getLeaveType().getName())
                .year(entity.getYear())
                .openingBalance(entity.getOpeningBalance())
                .accrued(entity.getAccrued())
                .used(entity.getUsed())
                .adjustment(entity.getAdjustment())
                .carriedForward(entity.getCarriedForward())
                .encashed(entity.getEncashed())
                .closingBalance(entity.getClosingBalance())
                .build();
    }
}
