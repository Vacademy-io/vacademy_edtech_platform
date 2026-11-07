package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;
import vacademy.io.admin_core_service.features.hr_attendance.entity.Holiday;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceRecordRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.HolidayRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeBankDetail;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeBankDetailRepository;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveApplication;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveApplicationRepository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.*;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollEntryStatus;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollStatus;
import vacademy.io.admin_core_service.features.hr_payroll.repository.*;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryStructure;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentType;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryStructureRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryComponentRepository;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxComputation;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxConfiguration;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxDeclaration;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxComputationRepository;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxConfigurationRepository;
import vacademy.io.admin_core_service.features.hr_tax.repository.TaxDeclarationRepository;
import vacademy.io.admin_core_service.features.hr_tax.service.engine.StatutoryItem;
import vacademy.io.admin_core_service.features.hr_tax.service.engine.TaxInput;
import vacademy.io.admin_core_service.features.hr_tax.service.engine.TaxRegimeEngine;
import vacademy.io.admin_core_service.features.hr_tax.service.engine.TaxResult;
import vacademy.io.admin_core_service.features.hr_tax.service.engine.TaxRegimeFactory;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class PayrollCalculationService {

    private static final Logger log = LoggerFactory.getLogger(PayrollCalculationService.class);

    /**
     * Last-resort currency for rows whose own source (salary structure,
     * adjustment) carries none. The RUN's currency comes from
     * {@link PayrollCurrencyResolver} so a Gulf institute is not stamped INR.
     */
    private static final String DEFAULT_CURRENCY = PayrollCurrencyResolver.FALLBACK_CURRENCY;

    /** Structure component codes that mean a statutory scheme is template-managed (skip engine). */
    private static final Map<String, Set<String>> STATUTORY_ALIASES = Map.of(
            "PF", Set.of("PF", "EPF", "PF_EMP", "PROVIDENT_FUND"),
            "ESI", Set.of("ESI", "ESI_EMP"),
            "PT", Set.of("PT", "PROF_TAX", "PROFESSIONAL_TAX"));

    @Autowired
    private PayrollRunRepository payrollRunRepository;

    @Autowired
    private PayrollCurrencyResolver payrollCurrencyResolver;

    @Autowired
    private PayrollEntryRepository payrollEntryRepository;

    @Autowired
    private PayrollEntryComponentRepository payrollEntryComponentRepository;

    @Autowired
    private PayrollEntryErrorRepository payrollEntryErrorRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private EmployeeSalaryStructureRepository salaryStructureRepository;

    @Autowired
    private SalaryComponentRepository salaryComponentRepository;

    @Autowired
    private AttendanceRecordRepository attendanceRecordRepository;

    @Autowired
    private HolidayRepository holidayRepository;

    @Autowired
    private LeaveApplicationRepository leaveApplicationRepository;

    @Autowired
    private ReimbursementRepository reimbursementRepository;

    @Autowired
    private EmployeeLoanRepository employeeLoanRepository;

    @Autowired
    private LoanRepaymentRepository loanRepaymentRepository;

    @Autowired
    private EmployeeBankDetailRepository bankDetailRepository;

    @Autowired
    private TaxRegimeFactory taxRegimeFactory;

    @Autowired
    private TaxConfigurationRepository taxConfigurationRepository;

    @Autowired
    private TaxDeclarationRepository taxDeclarationRepository;

    @Autowired
    private TaxComputationRepository taxComputationRepository;

    @Autowired
    private PayrollAdjustmentRepository payrollAdjustmentRepository;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    /**
     * Everything one employee's calculation produced, held in memory until the
     * calculation SUCCEEDED — nothing (loan balances included) is mutated
     * before persistence, so a failed employee leaves no partial state behind.
     */
    private static class EntryBundle {
        PayrollEntry entry;
        List<PayrollEntryComponent> components = new ArrayList<>();
        List<LoanRepayment> repayments = new ArrayList<>();
        Map<EmployeeLoan, BigDecimal> loanNewBalances = new LinkedHashMap<>();
        List<Reimbursement> reimbursements = new ArrayList<>();
        List<PayrollAdjustment> adjustments = new ArrayList<>();
        TaxComputation taxComputation;
    }

    /**
     * Processes a payroll run. The run is row-locked for the duration so two
     * concurrent calls serialize; a failure rolls the whole transaction back,
     * leaving the run in DRAFT exactly as before the call. Per-employee
     * failures do NOT fail the run — they are recorded as
     * {@link PayrollEntryError} rows and surfaced in the response message.
     */
    @Transactional
    public String processPayroll(String payrollRunId, String instituteId, String processedByUserId) {
        PayrollRun run = payrollRunRepository.findByIdAndInstituteIdForUpdate(payrollRunId, instituteId)
                .orElseThrow(() -> new VacademyException("Payroll run not found"));

        if (!PayrollStatus.DRAFT.name().equals(run.getStatus())) {
            throw new VacademyException("Payroll run must be in DRAFT status to process. Current status: " + run.getStatus());
        }

        run.setStatus(PayrollStatus.PROCESSING.name());
        run.setProcessedBy(processedByUserId);
        payrollRunRepository.save(run);

        // Re-processing after reject/failure: reverse loan/reimbursement side
        // effects and delete prior entries, components, tax computations, errors.
        reverseAndDeleteEntries(payrollRunId);

        String runType = run.getRunType() != null ? run.getRunType() : "REGULAR";
        List<EmployeeProfile> employees = selectEmployeesForRun(run, runType);

        if (employees.isEmpty()) {
            String reason = switch (runType) {
                case "FNF" -> " (no employees exiting in this month)";
                case "OFF_CYCLE", "BONUS" -> " (no pending adjustments for this month)";
                default -> "";
            };
            throw new VacademyException("No employees in scope for this " + runType + " run" + reason);
        }

        YearMonth yearMonth = YearMonth.of(run.getYear(), run.getMonth());
        LocalDate monthStart = yearMonth.atDay(1);
        LocalDate monthEnd = yearMonth.atEndOfMonth();

        // Hoisted per-run context (was fetched per-employee before).
        TaxContext taxContext = resolveTaxContext(run);
        Set<LocalDate> weekdayHolidayDates = resolveWeekdayHolidays(run.getInstituteId(), monthStart, monthEnd);
        Map<String, SalaryComponent> componentCache = new HashMap<>();

        BigDecimal totalGross = BigDecimal.ZERO;
        BigDecimal totalDeductions = BigDecimal.ZERO;
        BigDecimal totalNetPay = BigDecimal.ZERO;
        BigDecimal totalEmployerCost = BigDecimal.ZERO;
        int processedCount = 0;
        List<PayrollEntryError> errors = new ArrayList<>();

        for (EmployeeProfile employee : employees) {
            try {
                EntryBundle bundle = calculateEmployeePayroll(run, employee, monthStart, monthEnd,
                        yearMonth, weekdayHolidayDates, taxContext, componentCache, runType);
                if (bundle == null) {
                    continue; // no salary structure / not employed this month — deliberately skipped
                }
                persistBundle(bundle);
                PayrollEntry entry = bundle.entry;
                totalGross = totalGross.add(entry.getGrossSalary());
                totalDeductions = totalDeductions.add(nvl(entry.getTotalDeductions()));
                totalNetPay = totalNetPay.add(entry.getNetPay());
                totalEmployerCost = totalEmployerCost.add(
                        entry.getGrossSalary().add(nvl(entry.getTotalEmployerContributions())));
                processedCount++;
            } catch (Exception e) {
                log.error("Payroll {}: entry calculation failed for employee {} ({})",
                        payrollRunId, employee.getId(), employee.getEmployeeCode(), e);
                PayrollEntryError error = new PayrollEntryError();
                error.setPayrollRunId(payrollRunId);
                error.setEmployeeId(employee.getId());
                error.setErrorStage("CALCULATION");
                error.setErrorMessage(e.getMessage());
                errors.add(error);
            }
        }

        if (!errors.isEmpty()) {
            payrollEntryErrorRepository.saveAll(errors);
        }

        run.setTotalEmployees(processedCount);
        run.setTotalGross(totalGross);
        run.setTotalDeductions(totalDeductions);
        run.setTotalNetPay(totalNetPay);
        run.setTotalEmployerCost(totalEmployerCost);
        run.setStatus(PayrollStatus.PROCESSED.name());
        run.setProcessedAt(LocalDateTime.now());
        if (run.getCurrency() == null) {
            run.setCurrency(payrollCurrencyResolver.resolve(run.getInstituteId()));
        }
        payrollRunRepository.save(run);

        // Phase F5: HR_PAYROLL_PROCESSED workflow trigger (emit-and-forget — a
        // workflow failure must never break the payroll processing itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("runId", run.getId());
            contextData.put("month", run.getMonth());
            contextData.put("year", run.getYear());
            contextData.put("runType", runType);
            contextData.put("totalEmployees", processedCount);
            contextData.put("totalNetPay", totalNetPay.toPlainString());
            contextData.put("errorCount", errors.size());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_PAYROLL_PROCESSED.name(),
                    run.getId(),
                    run.getInstituteId(),
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_PAYROLL_PROCESSED workflow", e);
        }

        if (!errors.isEmpty()) {
            return run.getId() + " (processed " + processedCount + " employees, "
                    + errors.size() + " failed — see run errors)";
        }
        return run.getId();
    }

    /**
     * Reverses all financial side effects of a run's entries and deletes them:
     * loan balances restored (CLOSED loans reopened), reimbursements unlinked,
     * loan repayments / entry components / tax computations / error rows
     * deleted. Used before reprocessing, on reject (PROCESSED -> DRAFT), and on
     * cancel — so a cancelled run no longer eats EMIs and reimbursements.
     */
    @Transactional
    public void reverseAndDeleteEntries(String payrollRunId) {
        List<PayrollEntry> existingEntries = payrollEntryRepository
                .findByPayrollRunIdOrderByEmployeeEmployeeCodeAsc(payrollRunId);

        PayrollRun run = payrollRunRepository.findById(payrollRunId).orElse(null);

        for (PayrollEntry entry : existingEntries) {
            String entryId = entry.getId();

            List<Reimbursement> linkedReimbursements = reimbursementRepository.findByPayrollEntryId(entryId);
            for (Reimbursement reimb : linkedReimbursements) {
                reimb.setPayrollEntry(null);
                reimbursementRepository.save(reimb);
            }

            List<LoanRepayment> linkedRepayments = loanRepaymentRepository.findByPayrollEntryId(entryId);
            for (LoanRepayment repayment : linkedRepayments) {
                EmployeeLoan loan = repayment.getLoan();
                if (loan != null) {
                    BigDecimal currentBalance = loan.getBalanceAmount() != null ? loan.getBalanceAmount() : BigDecimal.ZERO;
                    loan.setBalanceAmount(currentBalance.add(repayment.getAmount()));
                    if ("CLOSED".equals(loan.getStatus())) {
                        loan.setStatus("ACTIVE");
                    }
                    employeeLoanRepository.save(loan);
                }
            }

            loanRepaymentRepository.deleteByPayrollEntryId(entryId);
            payrollEntryComponentRepository.deleteByPayrollEntryId(entryId);

            if (run != null && entry.getEmployee() != null) {
                taxComputationRepository.deleteByEmployee_IdAndMonthAndYear(
                        entry.getEmployee().getId(), run.getMonth(), run.getYear());
            }
        }

        if (!existingEntries.isEmpty()) {
            List<String> entryIds = existingEntries.stream().map(PayrollEntry::getId).collect(Collectors.toList());
            payrollAdjustmentRepository.unlinkByPayrollEntryIds(entryIds);
            payrollEntryRepository.deleteAll(existingEntries);
        }
        payrollEntryErrorRepository.deleteByPayrollRunId(payrollRunId);
    }

    // ------------------------------------------------------------------
    // Per-run context
    // ------------------------------------------------------------------

    private static class TaxContext {
        TaxConfiguration config;
        TaxRegimeEngine engine;
        String financialYear;
        int fyStartMonth;
    }

    /**
     * Resolves tax config + engine once per run. If a tax configuration exists
     * but no engine supports its country, the run FAILS loudly — silently
     * paying every employee with zero withholding is never acceptable.
     */
    private TaxContext resolveTaxContext(PayrollRun run) {
        List<TaxConfiguration> configs = taxConfigurationRepository
                .findAllByInstituteIdAndStatus(run.getInstituteId(), "ACTIVE");
        if (configs.isEmpty()) {
            configs = taxConfigurationRepository.findAllByInstituteId(run.getInstituteId());
        }
        if (configs.isEmpty()) {
            return null; // institute has not configured tax — TDS simply not computed
        }

        TaxContext ctx = new TaxContext();
        ctx.config = configs.get(0);
        try {
            ctx.engine = taxRegimeFactory.getEngine(ctx.config.getCountryCode());
        } catch (Exception e) {
            throw new VacademyException("Tax is configured for country " + ctx.config.getCountryCode()
                    + " but no tax engine supports it: " + e.getMessage());
        }
        ctx.fyStartMonth = ctx.config.getFinancialYearStartMonth() != null
                ? ctx.config.getFinancialYearStartMonth() : 4;
        ctx.financialYear = getFinancialYear(run.getMonth(), run.getYear(), ctx.fyStartMonth);
        return ctx;
    }

    /** V144 requires component_id NOT NULL — system rows (TDS/PF/ESI/PT/adjustments) need real components. */
    private SalaryComponent getOrCreateSystemComponent(Map<String, SalaryComponent> cache, String instituteId,
                                                       String code, String name, String type) {
        return cache.computeIfAbsent(code, c ->
                salaryComponentRepository.findByInstituteIdAndCode(instituteId, c)
                        .orElseGet(() -> {
                            SalaryComponent comp = new SalaryComponent();
                            comp.setInstituteId(instituteId);
                            comp.setName(name);
                            comp.setCode(c);
                            comp.setType(type);
                            comp.setCategory("STATUTORY");
                            comp.setIsTaxable(false);
                            comp.setIsStatutory(true);
                            comp.setIsActive(true);
                            comp.setDisplayOrder(100);
                            comp.setDescription("System component: " + name);
                            return salaryComponentRepository.save(comp);
                        }));
    }

    /**
     * Who a run pays. REGULAR: everyone employed (incl. notice period). FNF:
     * exactly the employees whose last working date falls in the month, any
     * status. OFF_CYCLE/BONUS: exactly the employees holding unconsumed
     * adjustments scoped to that run type for the month.
     */
    private List<EmployeeProfile> selectEmployeesForRun(PayrollRun run, String runType) {
        YearMonth ym = YearMonth.of(run.getYear(), run.getMonth());
        switch (runType) {
            case "FNF": {
                List<String> statuses = Arrays.asList(
                        "ACTIVE", "PROBATION", "NOTICE_PERIOD", "RELIEVED", "TERMINATED");
                return employeeProfileRepository.findActiveEmployees(run.getInstituteId(), statuses).stream()
                        .filter(e -> e.getLastWorkingDate() != null
                                && !e.getLastWorkingDate().isBefore(ym.atDay(1))
                                && !e.getLastWorkingDate().isAfter(ym.atEndOfMonth()))
                        .collect(Collectors.toList());
            }
            case "OFF_CYCLE":
            case "BONUS": {
                List<String> employeeIds = payrollAdjustmentRepository.findEmployeeIdsWithPendingAdjustments(
                        run.getInstituteId(), run.getYear(), run.getMonth(), runType);
                return employeeIds.isEmpty() ? List.of()
                        : employeeProfileRepository.findAllById(employeeIds).stream()
                                .filter(e -> run.getInstituteId().equals(e.getInstituteId()))
                                .collect(Collectors.toList());
            }
            default:
                return employeeProfileRepository.findActiveEmployees(
                        run.getInstituteId(), Arrays.asList("ACTIVE", "PROBATION", "NOTICE_PERIOD"));
        }
    }

    private Set<LocalDate> resolveWeekdayHolidays(String instituteId, LocalDate monthStart, LocalDate monthEnd) {
        List<Holiday> mandatoryHolidays = holidayRepository.findByInstituteIdAndDateRange(
                instituteId, monthStart, monthEnd);
        return mandatoryHolidays.stream()
                .filter(h -> h.getIsOptional() == null || !h.getIsOptional())
                .filter(h -> {
                    DayOfWeek dow = h.getDate().getDayOfWeek();
                    return dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY;
                })
                .map(Holiday::getDate)
                .collect(Collectors.toSet());
    }

    // ------------------------------------------------------------------
    // Per-employee calculation (no persistence, no side effects)
    // ------------------------------------------------------------------

    private EntryBundle calculateEmployeePayroll(PayrollRun run, EmployeeProfile employee,
                                                 LocalDate monthStart, LocalDate monthEnd,
                                                 YearMonth yearMonth,
                                                 Set<LocalDate> weekdayHolidayDates,
                                                 TaxContext taxContext,
                                                 Map<String, SalaryComponent> componentCache,
                                                 String runType) {
        // OFF_CYCLE/BONUS runs pay exactly the pending adjustments — no base salary.
        if ("OFF_CYCLE".equals(runType) || "BONUS".equals(runType)) {
            return calculateAdjustmentsOnlyEntry(run, employee, runType, taxContext, componentCache);
        }

        // Employment window: joiners/leavers are paid only for their employed
        // slice of the month; employees fully outside the month are skipped.
        LocalDate empStart = employee.getJoinDate() != null ? employee.getJoinDate() : monthStart;
        LocalDate empEnd = employee.getLastWorkingDate() != null ? employee.getLastWorkingDate() : monthEnd;
        if (empStart.isAfter(monthEnd) || empEnd.isBefore(monthStart)) {
            return null;
        }
        LocalDate windowStart = empStart.isAfter(monthStart) ? empStart : monthStart;
        LocalDate windowEnd = empEnd.isBefore(monthEnd) ? empEnd : monthEnd;

        // a. Salary structure effective for THIS period (was: latest ACTIVE regardless of dates).
        List<EmployeeSalaryStructure> structures = salaryStructureRepository
                .findByEmployeeIdOrderByEffectiveFromDesc(employee.getId());
        EmployeeSalaryStructure salaryStructure = selectStructureFor(structures, monthStart, monthEnd);
        if (salaryStructure == null) {
            return null; // skip employees without an applicable salary structure
        }

        // b. Working-day math
        int totalCalendarDays = yearMonth.lengthOfMonth();
        int weekends = 0;
        for (LocalDate date = monthStart; !date.isAfter(monthEnd); date = date.plusDays(1)) {
            DayOfWeek dow = date.getDayOfWeek();
            if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) weekends++;
        }
        int daysHoliday = weekdayHolidayDates.size();
        int totalWorkingDays = totalCalendarDays - weekends - daysHoliday;
        if (totalWorkingDays <= 0) totalWorkingDays = 1;

        long workingDaysInWindow = windowStart.datesUntil(windowEnd.plusDays(1))
                .filter(d -> isWorkingDay(d, weekdayHolidayDates))
                .count();

        long presentCount = attendanceRecordRepository.countByEmployeeAndDateRangeAndStatus(
                employee.getId(), monthStart, monthEnd, "PRESENT");
        long halfDayCount = attendanceRecordRepository.countByEmployeeAndDateRangeAndStatus(
                employee.getId(), monthStart, monthEnd, "HALF_DAY");

        List<AttendanceRecord> allAttendanceRecords = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDateBetweenOrderByAttendanceDateAsc(
                        employee.getId(), monthStart, monthEnd);
        boolean hasAttendanceRecords = !allAttendanceRecords.isEmpty();

        // Approved leaves, clipped to both the month and the employment window
        List<LeaveApplication> approvedLeaves = leaveApplicationRepository.findApprovedLeavesInRange(
                employee.getId(), monthStart, monthEnd);

        BigDecimal paidLeaveDays = BigDecimal.ZERO;
        BigDecimal unpaidLeaveDays = BigDecimal.ZERO;
        BigDecimal totalLeaveDays = BigDecimal.ZERO;

        for (LeaveApplication leave : approvedLeaves) {
            LocalDate leaveStart = maxDate(leave.getFromDate(), windowStart);
            LocalDate leaveEnd = minDate(leave.getToDate(), windowEnd);
            if (leaveStart.isAfter(leaveEnd)) continue;

            boolean isPaid = leave.getLeaveType() != null
                    && leave.getLeaveType().getIsPaid() != null
                    && leave.getLeaveType().getIsPaid();

            BigDecimal days;
            if (leave.getIsHalfDay() != null && leave.getIsHalfDay()) {
                days = isWorkingDay(leaveStart, weekdayHolidayDates) ? new BigDecimal("0.5") : BigDecimal.ZERO;
            } else {
                long full = leaveStart.datesUntil(leaveEnd.plusDays(1))
                        .filter(d -> isWorkingDay(d, weekdayHolidayDates))
                        .count();
                days = new BigDecimal(full);
            }
            if (days.signum() <= 0) continue;

            totalLeaveDays = totalLeaveDays.add(days);
            if (isPaid) paidLeaveDays = paidLeaveDays.add(days);
            else unpaidLeaveDays = unpaidLeaveDays.add(days);
        }

        BigDecimal windowWorkingDaysBD = new BigDecimal(workingDaysInWindow);
        BigDecimal daysPresent;
        BigDecimal daysAbsent;

        if (hasAttendanceRecords) {
            daysPresent = new BigDecimal(presentCount)
                    .add(new BigDecimal(halfDayCount).multiply(new BigDecimal("0.5")));
            daysAbsent = windowWorkingDaysBD.subtract(daysPresent).subtract(totalLeaveDays);
        } else {
            // No attendance records at all — assume full attendance within the employment window.
            daysPresent = windowWorkingDaysBD.subtract(totalLeaveDays);
            daysAbsent = BigDecimal.ZERO;
        }
        if (daysPresent.signum() < 0) daysPresent = BigDecimal.ZERO;
        if (daysAbsent.signum() < 0) daysAbsent = BigDecimal.ZERO;

        BigDecimal effectivePaidDays = daysPresent.add(paidLeaveDays);

        // c. Pro-rate against the FULL month's working days — the employment
        // window shrinks the numerator, so mid-month joiners/leavers prorate.
        BigDecimal grossMonthly = salaryStructure.getGrossMonthly();
        if (grossMonthly == null) {
            grossMonthly = salaryStructure.getCtcMonthly() != null ? salaryStructure.getCtcMonthly() : BigDecimal.ZERO;
        }

        BigDecimal totalWorkingDaysBD = new BigDecimal(totalWorkingDays);
        BigDecimal proRateFactor = effectivePaidDays.compareTo(totalWorkingDaysBD) >= 0
                ? BigDecimal.ONE
                : effectivePaidDays.divide(totalWorkingDaysBD, 6, RoundingMode.HALF_UP);

        BigDecimal grossForMonth = grossMonthly.multiply(proRateFactor).setScale(2, RoundingMode.HALF_UP);

        // d. Components proportionally (+ discover BASIC and HRA for the tax engine)
        EntryBundle bundle = new EntryBundle();
        BigDecimal totalEarnings = BigDecimal.ZERO;
        BigDecimal totalDeductionsAmount = BigDecimal.ZERO;
        BigDecimal totalEmployerContributions = BigDecimal.ZERO;
        BigDecimal basicMonthlyFull = BigDecimal.ZERO;
        BigDecimal hraAnnual = BigDecimal.ZERO;
        Set<String> structureComponentCodes = new HashSet<>();

        if (salaryStructure.getComponents() != null) {
            for (EmployeeSalaryComponent salComp : salaryStructure.getComponents()) {
                SalaryComponent def = salComp.getComponent();
                String code = def.getCode() != null ? def.getCode().toUpperCase() : "";
                structureComponentCodes.add(code);
                if ("BASIC".equals(code)) basicMonthlyFull = nvl(salComp.getMonthlyAmount());
                if ("HRA".equals(code)) {
                    hraAnnual = salComp.getAnnualAmount() != null
                            ? salComp.getAnnualAmount()
                            : nvl(salComp.getMonthlyAmount()).multiply(new BigDecimal("12"));
                }

                BigDecimal componentAmount = salComp.getMonthlyAmount()
                        .multiply(proRateFactor)
                        .setScale(2, RoundingMode.HALF_UP);

                PayrollEntryComponent entryComp = new PayrollEntryComponent();
                entryComp.setComponent(def);
                entryComp.setComponentType(def.getType());
                entryComp.setAmount(componentAmount);
                bundle.components.add(entryComp);

                String compType = def.getType();
                if (ComponentType.EARNING.name().equals(compType)) {
                    totalEarnings = totalEarnings.add(componentAmount);
                } else if (ComponentType.DEDUCTION.name().equals(compType)) {
                    totalDeductionsAmount = totalDeductionsAmount.add(componentAmount);
                } else if (ComponentType.EMPLOYER_CONTRIBUTION.name().equals(compType)) {
                    totalEmployerContributions = totalEmployerContributions.add(componentAmount);
                }
            }
        }
        if (basicMonthlyFull.signum() == 0) {
            // No BASIC component defined — fall back to the common 50%-of-gross heuristic.
            basicMonthlyFull = grossMonthly.multiply(new BigDecimal("0.5"));
        }
        BigDecimal basicForMonth = basicMonthlyFull.multiply(proRateFactor).setScale(2, RoundingMode.HALF_UP);

        // Variable-pay adjustments (V482) scoped to this run type — bonuses,
        // incentives, recoveries, F&F encashment. Materialized as components
        // and taxed via the true-up (earnings raise this month's taxable gross).
        BigDecimal adjEarnings = BigDecimal.ZERO;
        BigDecimal adjDeductions = BigDecimal.ZERO;
        List<PayrollAdjustment> adjustments = payrollAdjustmentRepository
                .findByEmployeeIdAndYearAndMonthAndRunScopeAndPayrollEntryIdIsNull(
                        employee.getId(), run.getYear(), run.getMonth(), runType);
        for (PayrollAdjustment adj : adjustments) {
            boolean earning = "EARNING".equals(adj.getType());
            PayrollEntryComponent comp = new PayrollEntryComponent();
            comp.setComponent(getOrCreateSystemComponent(componentCache, run.getInstituteId(),
                    adj.getCode(), adj.getLabel(),
                    earning ? ComponentType.EARNING.name() : ComponentType.DEDUCTION.name()));
            comp.setComponentType(earning ? ComponentType.EARNING.name() : ComponentType.DEDUCTION.name());
            comp.setAmount(adj.getAmount());
            bundle.components.add(comp);
            if (earning) adjEarnings = adjEarnings.add(adj.getAmount());
            else adjDeductions = adjDeductions.add(adj.getAmount());
        }
        bundle.adjustments.addAll(adjustments);
        BigDecimal taxableGrossForMonth = grossForMonth.add(adjEarnings);

        // --- Tax + statutory via the per-run engine. A failure here fails THIS
        // employee (recorded as an error row) — never silently paid untaxed.
        BigDecimal tdsAmount = BigDecimal.ZERO;
        if (taxContext != null) {
            TaxInput taxInput = buildTaxInput(run, employee, taxContext, structures,
                    taxableGrossForMonth, grossMonthly, basicForMonth, basicMonthlyFull, hraAnnual);

            TaxResult taxResult = taxContext.engine.calculateMonthlyTax(taxInput);
            tdsAmount = nvl(taxResult.getMonthlyTax());

            if (tdsAmount.signum() > 0) {
                totalDeductionsAmount = totalDeductionsAmount.add(tdsAmount);
                PayrollEntryComponent tdsComponent = new PayrollEntryComponent();
                tdsComponent.setComponent(getOrCreateSystemComponent(componentCache, run.getInstituteId(),
                        "TDS", "Income Tax (TDS)", ComponentType.DEDUCTION.name()));
                tdsComponent.setComponentType(ComponentType.DEDUCTION.name());
                tdsComponent.setAmount(tdsAmount);
                bundle.components.add(tdsComponent);
            }

            // Statutory (PF/ESI/PT) — engine amounts, unless the salary template
            // already carries the scheme as a component (no double deduction).
            for (StatutoryItem item : taxContext.engine.calculateStatutory(taxInput)) {
                Set<String> aliases = STATUTORY_ALIASES.getOrDefault(item.getCode(), Set.of(item.getCode()));
                if (aliases.stream().anyMatch(structureComponentCodes::contains)) {
                    continue;
                }
                BigDecimal employeeAmt = nvl(item.getEmployeeMonthly());
                if (employeeAmt.signum() > 0) {
                    PayrollEntryComponent comp = new PayrollEntryComponent();
                    comp.setComponent(getOrCreateSystemComponent(componentCache, run.getInstituteId(),
                            item.getCode(), item.getName(), ComponentType.DEDUCTION.name()));
                    comp.setComponentType(ComponentType.DEDUCTION.name());
                    comp.setAmount(employeeAmt);
                    bundle.components.add(comp);
                    totalDeductionsAmount = totalDeductionsAmount.add(employeeAmt);
                }
                BigDecimal employerAmt = nvl(item.getEmployerMonthly());
                if (employerAmt.signum() > 0) {
                    PayrollEntryComponent comp = new PayrollEntryComponent();
                    comp.setComponent(getOrCreateSystemComponent(componentCache, run.getInstituteId(),
                            item.getCode() + "_ER", item.getName() + " (Employer)",
                            ComponentType.EMPLOYER_CONTRIBUTION.name()));
                    comp.setComponentType(ComponentType.EMPLOYER_CONTRIBUTION.name());
                    comp.setAmount(employerAmt);
                    bundle.components.add(comp);
                    totalEmployerContributions = totalEmployerContributions.add(employerAmt);
                }
            }

            // Cumulative audit row (upsert under the V480 unique).
            BigDecimal ytdIncomeAfter = nvl(taxInput.getYtdTaxableIncome()).add(taxableGrossForMonth);
            BigDecimal ytdTaxAfter = nvl(taxInput.getYtdTaxDeducted()).add(tdsAmount);
            TaxComputation computation = taxComputationRepository
                    .findByEmployee_IdAndFinancialYearAndMonthAndYear(
                            employee.getId(), taxContext.financialYear, run.getMonth(), run.getYear())
                    .orElseGet(TaxComputation::new);
            computation.setEmployee(employee);
            computation.setFinancialYear(taxContext.financialYear);
            computation.setMonth(run.getMonth());
            computation.setYear(run.getYear());
            computation.setProjectedAnnualIncome(taxResult.getProjectedAnnualGross());
            computation.setProjectedAnnualTax(taxResult.getProjectedAnnualTax());
            computation.setProjectedMonthlyTax(tdsAmount);
            computation.setActualIncomeTillDate(ytdIncomeAfter);
            computation.setActualTaxDeducted(ytdTaxAfter);
            computation.setTotalExemptions(taxResult.getTotalExemptions());
            computation.setTotalDeductions80c(extract80c(taxResult));
            computation.setComputationDetails(taxResult.getBreakdown());
            bundle.taxComputation = computation;
        }

        // e. Approved unpaid reimbursements
        List<Reimbursement> unpaidReimbursements = reimbursementRepository.findApprovedUnpaid(employee.getId());
        BigDecimal reimbursementTotal = BigDecimal.ZERO;
        for (Reimbursement reimb : unpaidReimbursements) {
            reimbursementTotal = reimbursementTotal.add(reimb.getAmount());
        }
        bundle.reimbursements.addAll(unpaidReimbursements);

        // f. Loan EMIs — planned only; balances are mutated at persist time.
        List<EmployeeLoan> activeLoans = employeeLoanRepository.findActiveLoans(employee.getId());
        BigDecimal loanDeduction = BigDecimal.ZERO;

        for (EmployeeLoan loan : activeLoans) {
            BigDecimal emi = loan.getEmiAmount();
            BigDecimal balance = loan.getBalanceAmount() != null ? loan.getBalanceAmount() : BigDecimal.ZERO;
            if (balance.signum() > 0) {
                BigDecimal deductAmount = emi.min(balance);
                loanDeduction = loanDeduction.add(deductAmount);

                LoanRepayment repayment = new LoanRepayment();
                repayment.setLoan(loan);
                repayment.setAmount(deductAmount);
                repayment.setRepaymentDate(LocalDate.now());
                repayment.setMonth(run.getMonth());
                repayment.setYear(run.getYear());
                repayment.setBalanceAfter(balance.subtract(deductAmount));
                bundle.repayments.add(repayment);
                bundle.loanNewBalances.put(loan, balance.subtract(deductAmount));
            }
        }

        // Overtime
        BigDecimal overtimeHours = BigDecimal.ZERO;
        for (AttendanceRecord record : allAttendanceRecords) {
            if (record.getOvertimeHours() != null) {
                overtimeHours = overtimeHours.add(record.getOvertimeHours());
            }
        }
        BigDecimal overtimePay = BigDecimal.ZERO;
        if (overtimeHours.signum() > 0) {
            BigDecimal hourlyRate = grossMonthly
                    .divide(totalWorkingDaysBD, 6, RoundingMode.HALF_UP)
                    .divide(new BigDecimal("8"), 6, RoundingMode.HALF_UP);
            overtimePay = hourlyRate
                    .multiply(new BigDecimal("1.5"))
                    .multiply(overtimeHours)
                    .setScale(2, RoundingMode.HALF_UP);
        }

        // g. Net pay
        BigDecimal otherEarnings = overtimePay.add(adjEarnings);
        BigDecimal otherDeductions = adjDeductions;
        BigDecimal netPay = totalEarnings
                .add(reimbursementTotal)
                .add(otherEarnings)
                .subtract(totalDeductionsAmount)
                .subtract(otherDeductions)
                .subtract(loanDeduction);
        if (netPay.signum() < 0) netPay = BigDecimal.ZERO;

        // h. Entry
        PayrollEntry entry = new PayrollEntry();
        entry.setPayrollRun(run);
        entry.setEmployee(employee);
        entry.setSalaryStructure(salaryStructure);
        entry.setGrossSalary(grossForMonth);
        entry.setTotalEarnings(totalEarnings);
        entry.setTotalDeductions(totalDeductionsAmount);
        entry.setTotalEmployerContributions(totalEmployerContributions);
        entry.setNetPay(netPay);
        entry.setTotalWorkingDays(totalWorkingDays);
        entry.setDaysPresent(daysPresent);
        entry.setDaysAbsent(daysAbsent);
        entry.setDaysOnLeave(totalLeaveDays);
        entry.setDaysHoliday(daysHoliday);
        entry.setOvertimeHours(overtimeHours);
        entry.setArrears(BigDecimal.ZERO);
        entry.setReimbursements(reimbursementTotal);
        entry.setLoanDeduction(loanDeduction);
        entry.setOtherEarnings(otherEarnings);
        entry.setOtherDeductions(otherDeductions);
        entry.setStatus(PayrollEntryStatus.CALCULATED.name());
        entry.setCurrency(salaryStructure.getCurrency() != null ? salaryStructure.getCurrency() : DEFAULT_CURRENCY);

        EmployeeBankDetail primaryBank = bankDetailRepository.findByEmployeeIdAndIsPrimaryTrue(employee.getId())
                .orElse(null);
        if (primaryBank != null) {
            entry.setBankAccount(primaryBank);
        }

        bundle.entry = entry;
        return bundle;
    }

    /**
     * OFF_CYCLE/BONUS entry: pays exactly the pending adjustments — no base
     * salary, attendance, loans, reimbursements, or statutory. Income tax
     * still applies to the earnings via the YTD true-up, so a bonus run is
     * withheld correctly and recorded in the FY's cumulative computation.
     */
    private EntryBundle calculateAdjustmentsOnlyEntry(PayrollRun run, EmployeeProfile employee,
                                                      String runType, TaxContext taxContext,
                                                      Map<String, SalaryComponent> componentCache) {
        List<PayrollAdjustment> adjustments = payrollAdjustmentRepository
                .findByEmployeeIdAndYearAndMonthAndRunScopeAndPayrollEntryIdIsNull(
                        employee.getId(), run.getYear(), run.getMonth(), runType);
        if (adjustments.isEmpty()) {
            return null;
        }

        EntryBundle bundle = new EntryBundle();
        BigDecimal adjEarnings = BigDecimal.ZERO;
        BigDecimal adjDeductions = BigDecimal.ZERO;
        for (PayrollAdjustment adj : adjustments) {
            boolean earning = "EARNING".equals(adj.getType());
            PayrollEntryComponent comp = new PayrollEntryComponent();
            comp.setComponent(getOrCreateSystemComponent(componentCache, run.getInstituteId(),
                    adj.getCode(), adj.getLabel(),
                    earning ? ComponentType.EARNING.name() : ComponentType.DEDUCTION.name()));
            comp.setComponentType(earning ? ComponentType.EARNING.name() : ComponentType.DEDUCTION.name());
            comp.setAmount(adj.getAmount());
            bundle.components.add(comp);
            if (earning) adjEarnings = adjEarnings.add(adj.getAmount());
            else adjDeductions = adjDeductions.add(adj.getAmount());
        }
        bundle.adjustments.addAll(adjustments);

        BigDecimal tdsAmount = BigDecimal.ZERO;
        if (taxContext != null && adjEarnings.signum() > 0) {
            TaxInput taxInput = buildTaxInput(run, employee, taxContext, List.of(),
                    adjEarnings, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);
            TaxResult taxResult = taxContext.engine.calculateMonthlyTax(taxInput);
            tdsAmount = nvl(taxResult.getMonthlyTax());
            if (tdsAmount.signum() > 0) {
                PayrollEntryComponent tdsComponent = new PayrollEntryComponent();
                tdsComponent.setComponent(getOrCreateSystemComponent(componentCache, run.getInstituteId(),
                        "TDS", "Income Tax (TDS)", ComponentType.DEDUCTION.name()));
                tdsComponent.setComponentType(ComponentType.DEDUCTION.name());
                tdsComponent.setAmount(tdsAmount);
                bundle.components.add(tdsComponent);
            }
            TaxComputation computation = taxComputationRepository
                    .findByEmployee_IdAndFinancialYearAndMonthAndYear(
                            employee.getId(), taxContext.financialYear, run.getMonth(), run.getYear())
                    .orElseGet(TaxComputation::new);
            computation.setEmployee(employee);
            computation.setFinancialYear(taxContext.financialYear);
            computation.setMonth(run.getMonth());
            computation.setYear(run.getYear());
            computation.setProjectedAnnualIncome(taxResult.getProjectedAnnualGross());
            computation.setProjectedAnnualTax(taxResult.getProjectedAnnualTax());
            computation.setProjectedMonthlyTax(tdsAmount);
            computation.setActualIncomeTillDate(nvl(taxInput.getYtdTaxableIncome()).add(adjEarnings));
            computation.setActualTaxDeducted(nvl(taxInput.getYtdTaxDeducted()).add(tdsAmount));
            computation.setTotalExemptions(taxResult.getTotalExemptions());
            computation.setComputationDetails(taxResult.getBreakdown());
            bundle.taxComputation = computation;
        }

        BigDecimal netPay = adjEarnings.subtract(adjDeductions).subtract(tdsAmount);
        if (netPay.signum() < 0) netPay = BigDecimal.ZERO;

        PayrollEntry entry = new PayrollEntry();
        entry.setPayrollRun(run);
        entry.setEmployee(employee);
        entry.setGrossSalary(adjEarnings);
        entry.setTotalEarnings(BigDecimal.ZERO);
        entry.setTotalDeductions(tdsAmount);
        entry.setTotalEmployerContributions(BigDecimal.ZERO);
        entry.setNetPay(netPay);
        entry.setTotalWorkingDays(0);
        entry.setDaysPresent(BigDecimal.ZERO);
        entry.setDaysAbsent(BigDecimal.ZERO);
        entry.setDaysOnLeave(BigDecimal.ZERO);
        entry.setDaysHoliday(0);
        entry.setOvertimeHours(BigDecimal.ZERO);
        entry.setArrears(BigDecimal.ZERO);
        entry.setReimbursements(BigDecimal.ZERO);
        entry.setLoanDeduction(BigDecimal.ZERO);
        entry.setOtherEarnings(adjEarnings);
        entry.setOtherDeductions(adjDeductions);
        entry.setStatus(PayrollEntryStatus.CALCULATED.name());
        entry.setCurrency(adjustments.get(0).getCurrency() != null
                ? adjustments.get(0).getCurrency() : DEFAULT_CURRENCY);

        EmployeeBankDetail primaryBank = bankDetailRepository.findByEmployeeIdAndIsPrimaryTrue(employee.getId())
                .orElse(null);
        if (primaryBank != null) {
            entry.setBankAccount(primaryBank);
        }

        bundle.entry = entry;
        return bundle;
    }

    // ------------------------------------------------------------------
    // Tax input assembly
    // ------------------------------------------------------------------

    private TaxInput buildTaxInput(PayrollRun run, EmployeeProfile employee, TaxContext ctx,
                                   List<EmployeeSalaryStructure> structures,
                                   BigDecimal grossForMonth, BigDecimal grossMonthlyFull,
                                   BigDecimal basicForMonth, BigDecimal basicMonthlyFull,
                                   BigDecimal hraAnnual) {
        // Regime + declarations, gated by verification policy: VERIFIED always
        // counts; SUBMITTED counts only until the proof cutoff (Jan-Mar of the
        // FY require VERIFIED — the standard Indian payroll control).
        String regime = null;
        Map<String, Object> declarations = Map.of();
        Optional<TaxDeclaration> declOpt = taxDeclarationRepository.findByEmployee_IdAndFinancialYear(
                employee.getId(), ctx.financialYear);
        if (declOpt.isPresent()) {
            TaxDeclaration decl = declOpt.get();
            regime = decl.getRegime();
            boolean verified = "VERIFIED".equals(decl.getStatus()) || "LOCKED".equals(decl.getStatus());
            boolean beforeCutoff = run.getMonth() >= 4; // Apr-Dec
            if (decl.getDeclarations() != null && (verified || beforeCutoff)) {
                declarations = decl.getDeclarations();
            }
        }

        // YTD from the cumulative audit trail: the latest FY row before this month.
        BigDecimal ytdIncome = BigDecimal.ZERO;
        BigDecimal ytdTax = BigDecimal.ZERO;
        List<TaxComputation> fyRows = taxComputationRepository
                .findByEmployee_IdAndFinancialYearOrderByMonthAsc(employee.getId(), ctx.financialYear);
        TaxComputation latestPrior = null;
        int currentPos = fyMonthPosition(run.getMonth(), ctx.fyStartMonth);
        for (TaxComputation row : fyRows) {
            int rowPos = fyMonthPosition(row.getMonth(), ctx.fyStartMonth);
            if (rowPos < currentPos && (latestPrior == null
                    || rowPos > fyMonthPosition(latestPrior.getMonth(), ctx.fyStartMonth))) {
                latestPrior = row;
            }
        }
        if (latestPrior != null) {
            ytdIncome = nvl(latestPrior.getActualIncomeTillDate());
            ytdTax = nvl(latestPrior.getActualTaxDeducted());
        }

        int monthsRemainingAfterCurrent = 12 - fyMonthPosition(run.getMonth(), ctx.fyStartMonth);

        // ESI stickiness: gross at the start of the current Apr-Sep / Oct-Mar period.
        BigDecimal esiGrossAtPeriodStart = null;
        LocalDate periodStart = esiPeriodStart(run.getMonth(), run.getYear());
        EmployeeSalaryStructure periodStructure = selectStructureFor(structures, periodStart, periodStart);
        if (periodStructure != null) {
            esiGrossAtPeriodStart = periodStructure.getGrossMonthly() != null
                    ? periodStructure.getGrossMonthly() : periodStructure.getCtcMonthly();
        }

        return TaxInput.builder()
                .financialYear(ctx.financialYear)
                .month(run.getMonth())
                .year(run.getYear())
                .monthsRemainingAfterCurrent(monthsRemainingAfterCurrent)
                .grossForMonth(grossForMonth)
                .grossMonthlyFull(grossMonthlyFull)
                .basicForMonth(basicForMonth)
                .basicMonthlyFull(basicMonthlyFull)
                .hraReceivedAnnual(hraAnnual.signum() > 0 ? hraAnnual : null)
                .ytdTaxableIncome(ytdIncome)
                .ytdTaxDeducted(ytdTax)
                .regime(regime)
                .declarations(declarations)
                .taxRules(ctx.config.getTaxRules() != null ? ctx.config.getTaxRules() : Map.of())
                .statutorySettings(ctx.config.getStatutorySettings() != null
                        ? ctx.config.getStatutorySettings() : Map.of())
                .stateCode(ctx.config.getStateCode())
                .esiGrossAtPeriodStart(esiGrossAtPeriodStart)
                .nationality(employee.getNationality())
                .serviceYears(serviceYearsAsOf(employee, run))
                .build();
    }

    /** Persists one employee's bundle; only now are loan balances actually mutated. */
    private void persistBundle(EntryBundle bundle) {
        PayrollEntry entry = payrollEntryRepository.save(bundle.entry);

        for (PayrollEntryComponent entryComp : bundle.components) {
            entryComp.setPayrollEntry(entry);
            payrollEntryComponentRepository.save(entryComp);
        }

        for (LoanRepayment repayment : bundle.repayments) {
            repayment.setPayrollEntry(entry);
            loanRepaymentRepository.save(repayment);
        }

        for (Map.Entry<EmployeeLoan, BigDecimal> loanUpdate : bundle.loanNewBalances.entrySet()) {
            EmployeeLoan loan = loanUpdate.getKey();
            BigDecimal newBalance = loanUpdate.getValue();
            loan.setBalanceAmount(newBalance);
            if (newBalance.signum() <= 0) {
                loan.setStatus("CLOSED");
                loan.setBalanceAmount(BigDecimal.ZERO);
            }
            employeeLoanRepository.save(loan);
        }

        for (Reimbursement reimb : bundle.reimbursements) {
            reimb.setPayrollEntry(entry);
            reimbursementRepository.save(reimb);
        }

        for (PayrollAdjustment adj : bundle.adjustments) {
            adj.setPayrollEntryId(entry.getId());
            payrollAdjustmentRepository.save(adj);
        }

        if (bundle.taxComputation != null) {
            taxComputationRepository.save(bundle.taxComputation);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Latest structure whose effective window overlaps [from, to]; ACTIVE or SUPERSEDED. */
    private EmployeeSalaryStructure selectStructureFor(List<EmployeeSalaryStructure> structures,
                                                       LocalDate from, LocalDate to) {
        if (structures == null) return null;
        return structures.stream()
                .filter(s -> "ACTIVE".equals(s.getStatus()) || "SUPERSEDED".equals(s.getStatus()))
                .filter(s -> s.getEffectiveFrom() == null || !s.getEffectiveFrom().isAfter(to))
                .filter(s -> s.getEffectiveTo() == null || !s.getEffectiveTo().isBefore(from))
                .findFirst() // list is ordered effectiveFrom DESC
                .orElse(null);
    }

    private static boolean isWorkingDay(LocalDate d, Set<LocalDate> weekdayHolidayDates) {
        DayOfWeek dow = d.getDayOfWeek();
        return dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY && !weekdayHolidayDates.contains(d);
    }

    /** Fractional completed years of service as of the payroll month's end (for Gulf EOSB bands). */
    private static BigDecimal serviceYearsAsOf(EmployeeProfile employee, PayrollRun run) {
        if (employee.getJoinDate() == null) return BigDecimal.ZERO;
        LocalDate asOf = YearMonth.of(run.getYear(), run.getMonth()).atEndOfMonth();
        long days = java.time.temporal.ChronoUnit.DAYS.between(employee.getJoinDate(), asOf);
        if (days <= 0) return BigDecimal.ZERO;
        return new BigDecimal(days).divide(new BigDecimal("365.25"), 2, RoundingMode.HALF_UP);
    }

    /** 1-based position of a calendar month within the financial year. */
    private static int fyMonthPosition(int month, int fyStartMonth) {
        return ((month - fyStartMonth + 12) % 12) + 1;
    }

    /** ESI contribution periods: Apr-Sep and Oct-Mar. */
    private static LocalDate esiPeriodStart(int month, int year) {
        if (month >= 4 && month <= 9) return LocalDate.of(year, 4, 1);
        if (month >= 10) return LocalDate.of(year, 10, 1);
        return LocalDate.of(year - 1, 10, 1);
    }

    @SuppressWarnings("unchecked")
    private static BigDecimal extract80c(TaxResult result) {
        Object v = result.getBreakdown() != null ? result.getBreakdown().get("deduction80c") : null;
        return v instanceof BigDecimal b ? b : BigDecimal.ZERO;
    }

    private static LocalDate maxDate(LocalDate a, LocalDate b) {
        return a.isAfter(b) ? a : b;
    }

    private static LocalDate minDate(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? a : b;
    }

    private static BigDecimal nvl(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }

    /**
     * Financial-year label honoring the configured start month: April start
     * (India) -> "2025-26"; January start -> "2026".
     */
    private String getFinancialYear(int month, int year, int fyStartMonth) {
        if (fyStartMonth <= 1) {
            return String.valueOf(year);
        }
        int fyStartYear = month >= fyStartMonth ? year : year - 1;
        return fyStartYear + "-" + ((fyStartYear + 1) % 100);
    }
}
