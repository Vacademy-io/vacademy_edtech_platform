package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveBalance;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveBalanceRepository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollAdjustmentRepository;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryStructure;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryStructureRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Full-and-final settlement preparation (Phase C6). The final month's prorated
 * salary already falls out of the payroll engine's employment-window logic;
 * this service adds the F&F-specific pieces as FNF-scoped adjustments:
 * leave encashment for encashable types (closing balance × gross/30), and an
 * optional notice-recovery deduction supplied by the admin. The admin then
 * creates a run with run_type FNF for the exit month and processes it — the
 * run picks up exactly the employees whose last working date falls in it.
 *
 * Encashed days are marked on the leave balance at prepare time; if the F&F is
 * abandoned, the admin reverses via the balance-adjust endpoint (documented
 * limitation until a formal F&F entity exists).
 */
@Service
public class FnFService {

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private LeaveBalanceRepository leaveBalanceRepository;

    @Autowired
    private EmployeeSalaryStructureRepository salaryStructureRepository;

    @Autowired
    private PayrollAdjustmentRepository adjustmentRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    /**
     * Creates the F&F adjustments for one exiting employee. Returns a summary
     * of what was created. Idempotence: refuses if an unconsumed FNF-scoped
     * LEAVE_ENCASHMENT adjustment already exists for the exit month.
     */
    @Transactional
    public Map<String, Object> prepareFnF(String employeeId, String instituteId,
                                          BigDecimal noticeRecoveryAmount, String userId) {
        EmployeeProfile employee = employeeProfileRepository.findById(employeeId)
                .orElseThrow(() -> new VacademyException("Employee not found"));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        if (employee.getLastWorkingDate() == null) {
            throw new VacademyException("Employee has no last working date set — record the exit first");
        }
        int month = employee.getLastWorkingDate().getMonthValue();
        int year = employee.getLastWorkingDate().getYear();

        boolean alreadyPrepared = adjustmentRepository
                .findByEmployeeIdAndYearAndMonthAndRunScopeAndPayrollEntryIdIsNull(
                        employee.getId(), year, month, "FNF")
                .stream().anyMatch(a -> "LEAVE_ENCASHMENT".equals(a.getCode()));
        if (alreadyPrepared) {
            throw new VacademyException("F&F already prepared for this employee (unconsumed FNF adjustments exist)");
        }

        EmployeeSalaryStructure structure = salaryStructureRepository
                .findFirstByEmployee_IdAndStatusOrderByEffectiveFromDesc(employee.getId(), "ACTIVE")
                .orElseThrow(() -> new VacademyException("Employee has no active salary structure"));
        BigDecimal grossMonthly = structure.getGrossMonthly() != null
                ? structure.getGrossMonthly()
                : structure.getCtcMonthly() != null ? structure.getCtcMonthly() : BigDecimal.ZERO;
        BigDecimal perDay = grossMonthly.divide(new BigDecimal("30"), 2, RoundingMode.HALF_UP);
        String currency = structure.getCurrency() != null ? structure.getCurrency() : "INR";

        List<Map<String, Object>> created = new ArrayList<>();

        // Leave encashment: encashable types' positive closing balances for the exit year.
        BigDecimal totalEncashDays = BigDecimal.ZERO;
        BigDecimal totalEncashAmount = BigDecimal.ZERO;
        for (LeaveBalance balance : leaveBalanceRepository.findByEmployee_IdAndYear(employee.getId(), year)) {
            if (balance.getLeaveType() == null
                    || balance.getLeaveType().getIsEncashable() == null
                    || !balance.getLeaveType().getIsEncashable()) {
                continue;
            }
            BigDecimal days = balance.getClosingBalance();
            if (days == null || days.signum() <= 0) continue;

            BigDecimal amount = perDay.multiply(days).setScale(2, RoundingMode.HALF_UP);
            balance.setEncashed((balance.getEncashed() != null ? balance.getEncashed() : BigDecimal.ZERO).add(days));
            leaveBalanceRepository.save(balance);

            totalEncashDays = totalEncashDays.add(days);
            totalEncashAmount = totalEncashAmount.add(amount);
        }
        if (totalEncashAmount.signum() > 0) {
            created.add(createAdjustment(employee, instituteId, month, year, "EARNING",
                    "LEAVE_ENCASHMENT", "Leave Encashment (" + totalEncashDays.stripTrailingZeros().toPlainString()
                            + " days)", totalEncashAmount, currency, userId));
        }

        // Notice recovery, when the admin supplies one.
        if (noticeRecoveryAmount != null && noticeRecoveryAmount.signum() > 0) {
            created.add(createAdjustment(employee, instituteId, month, year, "DEDUCTION",
                    "NOTICE_RECOVERY", "Notice Period Recovery",
                    noticeRecoveryAmount.setScale(2, RoundingMode.HALF_UP), currency, userId));
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("employeeId", employee.getId());
        summary.put("exitMonth", month);
        summary.put("exitYear", year);
        summary.put("encashedDays", totalEncashDays);
        summary.put("encashmentAmount", totalEncashAmount);
        summary.put("adjustments", created);
        summary.put("nextStep", "Create a payroll run with run_type FNF for " + month + "/" + year
                + " and process it — it pays exactly the employees exiting that month.");
        return summary;
    }

    private Map<String, Object> createAdjustment(EmployeeProfile employee, String instituteId,
                                                 int month, int year, String type, String code,
                                                 String label, BigDecimal amount, String currency,
                                                 String userId) {
        PayrollAdjustment adj = new PayrollAdjustment();
        adj.setInstituteId(instituteId);
        adj.setEmployeeId(employee.getId());
        adj.setMonth(month);
        adj.setYear(year);
        adj.setType(type);
        adj.setCode(code);
        adj.setLabel(label);
        adj.setAmount(amount);
        adj.setCurrency(currency);
        adj.setRunScope("FNF");
        adj.setSource("FNF");
        adj.setCreatedBy(userId);
        adj = adjustmentRepository.save(adj);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", adj.getId());
        out.put("type", type);
        out.put("code", code);
        out.put("label", label);
        out.put("amount", amount);
        return out;
    }
}
