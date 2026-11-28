package vacademy.io.admin_core_service.features.hr_payroll.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;
import vacademy.io.admin_core_service.features.hr_payroll.dto.CreateLoanDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.EmployeeLoanDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.LoanRepaymentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.entity.EmployeeLoan;
import vacademy.io.admin_core_service.features.hr_payroll.entity.LoanRepayment;
import vacademy.io.admin_core_service.features.hr_payroll.enums.LoanStatus;
import vacademy.io.admin_core_service.features.hr_payroll.repository.EmployeeLoanRepository;
import vacademy.io.admin_core_service.features.hr_payroll.repository.LoanRepaymentRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@lombok.extern.slf4j.Slf4j
@Service
public class LoanService {

    @Autowired
    private EmployeeLoanRepository loanRepository;

    @Autowired
    private LoanRepaymentRepository repaymentRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrNotificationService hrNotificationService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Transactional
    public String createLoan(CreateLoanDTO dto, String instituteId) {
        EmployeeProfile employee = employeeProfileRepository.findById(dto.getEmployeeId())
                .orElseThrow(() -> new VacademyException("Employee not found"));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        EmployeeLoan loan = new EmployeeLoan();
        loan.setEmployee(employee);
        loan.setInstituteId(instituteId);
        loan.setLoanType(dto.getLoanType());
        loan.setPrincipalAmount(dto.getPrincipalAmount());
        loan.setInterestRate(dto.getInterestRate() != null ? dto.getInterestRate() : BigDecimal.ZERO);
        loan.setTenureMonths(dto.getTenureMonths());
        loan.setNotes(dto.getNotes());
        // Currency defaults to INR unless an explicit 3-letter code is supplied
        loan.setCurrency(normalizeCurrency(dto.getCurrency()));
        loan.setStatus(LoanStatus.PENDING.name());
        loan.setDisbursedAmount(BigDecimal.ZERO);
        loan.setBalanceAmount(BigDecimal.ZERO);

        // Calculate EMI
        BigDecimal emi = calculateEMI(dto.getPrincipalAmount(), loan.getInterestRate(), dto.getTenureMonths());
        loan.setEmiAmount(emi);

        // Set start month/year to next month
        LocalDate nextMonth = LocalDate.now().plusMonths(1).withDayOfMonth(1);
        loan.setStartMonth(nextMonth.getMonthValue());
        loan.setStartYear(nextMonth.getYear());

        loan = loanRepository.save(loan);

        // Phase F5: HR_LOAN_REQUESTED workflow trigger (emit-and-forget — a
        // workflow failure must never break the loan creation itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("loanId", loan.getId());
            contextData.put("employeeId", employee.getId());
            contextData.put("employeeUserId", employee.getUserId());
            contextData.put("loanType", loan.getLoanType());
            contextData.put("principalAmount", loan.getPrincipalAmount() != null
                    ? loan.getPrincipalAmount().toPlainString() : null);
            contextData.put("emiAmount", loan.getEmiAmount() != null
                    ? loan.getEmiAmount().toPlainString() : null);
            contextData.put("tenureMonths", loan.getTenureMonths());
            contextData.put("currency", loan.getCurrency());
            contextData.put("status", loan.getStatus());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_LOAN_REQUESTED.name(),
                    loan.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_LOAN_REQUESTED workflow", e);
        }

        return loan.getId();
    }

    @Transactional(readOnly = true)
    public List<EmployeeLoanDTO> getLoans(String employeeId) {
        List<EmployeeLoan> loans = loanRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId);
        return loans.stream().map(this::toDTO).collect(Collectors.toList());
    }

    @Transactional
    public String approveLoan(String id, String approverUserId, String instituteId) {
        EmployeeLoan loan = loanRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Loan not found"));
        hrAccessGuard.requireInstituteMatch(loan.getInstituteId(), instituteId, "Loan");

        // The approver must not be the loan's own employee
        if (approverUserId != null && approverUserId.equals(loan.getEmployee().getUserId())) {
            throw new VacademyException("You cannot approve your own loan");
        }

        if (!LoanStatus.PENDING.name().equals(loan.getStatus())) {
            throw new VacademyException("Only PENDING loans can be approved. Current status: " + loan.getStatus());
        }

        loan.setStatus(LoanStatus.ACTIVE.name());
        loan.setApprovedBy(approverUserId);
        loan.setApprovedAt(LocalDateTime.now());
        loan.setDisbursedAmount(loan.getPrincipalAmount());

        // BUG 6 FIX: Initialize balance as total repayable amount (EMI * tenure months)
        // instead of just the principal. For interest-bearing loans, the EMI includes
        // both principal and interest components. Setting balance = principal would cause
        // the employee to underpay the interest portion since the full EMI (which includes
        // interest) is deducted from the balance each month.
        // For zero-interest loans, EMI * tenure = principal, so this remains correct.
        loan.setBalanceAmount(loan.getEmiAmount().multiply(new BigDecimal(loan.getTenureMonths())));

        loanRepository.save(loan);

        // Best-effort employee email on approval (send failures never break the operation)
        try {
            String currency = loan.getCurrency() != null ? loan.getCurrency() : "INR";
            String subject = "Your loan was approved";
            String body = hrNotificationService.buildEmailBody(subject,
                    "Loan type", loan.getLoanType(),
                    "Amount", currency + " " + loan.getPrincipalAmount().toPlainString(),
                    "Monthly EMI", currency + " " + loan.getEmiAmount().toPlainString(),
                    "Tenure", loan.getTenureMonths() + " month(s)",
                    "Deductions start", loan.getStartMonth() + "/" + loan.getStartYear());
            hrNotificationService.emailEmployee(loan.getEmployee(), subject, body);
        } catch (Exception e) {
            // emailEmployee already swallows send failures; this guards lazy-load surprises
        }

        // Phase F5: HR_LOAN_DECIDED workflow trigger (emit-and-forget — a
        // workflow failure must never break the approval itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("loanId", loan.getId());
            contextData.put("employeeId", loan.getEmployee().getId());
            contextData.put("employeeUserId", loan.getEmployee().getUserId());
            contextData.put("loanType", loan.getLoanType());
            contextData.put("principalAmount", loan.getPrincipalAmount() != null
                    ? loan.getPrincipalAmount().toPlainString() : null);
            contextData.put("emiAmount", loan.getEmiAmount() != null
                    ? loan.getEmiAmount().toPlainString() : null);
            contextData.put("tenureMonths", loan.getTenureMonths());
            contextData.put("currency", loan.getCurrency());
            contextData.put("status", loan.getStatus());
            contextData.put("approvedBy", loan.getApprovedBy());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_LOAN_DECIDED.name(),
                    loan.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_LOAN_DECIDED workflow", e);
        }

        return loan.getId();
    }

    @Transactional(readOnly = true)
    public List<LoanRepaymentDTO> getRepayments(String loanId, String instituteId, CustomUserDetails user) {
        EmployeeLoan loan = loanRepository.findById(loanId)
                .orElseThrow(() -> new VacademyException("Loan not found"));
        hrAccessGuard.requireInstituteMatch(loan.getInstituteId(), instituteId, "Loan");
        // Only HR staff or the loan's own employee may read its repayments
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, loan.getEmployee().getId());

        List<LoanRepayment> repayments = repaymentRepository.findByLoanIdOrderByYearAscMonthAsc(loanId);

        return repayments.stream()
                .map(r -> LoanRepaymentDTO.builder()
                        .id(r.getId())
                        .loanId(r.getLoan().getId())
                        .amount(r.getAmount())
                        .repaymentDate(r.getRepaymentDate())
                        .month(r.getMonth())
                        .year(r.getYear())
                        .balanceAfter(r.getBalanceAfter())
                        .build())
                .collect(Collectors.toList());
    }

    /**
     * Calculate EMI using standard formula:
     * EMI = P * r * (1+r)^n / ((1+r)^n - 1)
     * where P = principal, r = monthly interest rate, n = tenure in months
     * If interest rate is 0, EMI = principal / tenure
     */
    private BigDecimal calculateEMI(BigDecimal principal, BigDecimal annualInterestRate, int tenureMonths) {
        if (tenureMonths <= 0) {
            throw new VacademyException("Tenure must be greater than 0");
        }

        if (annualInterestRate == null || annualInterestRate.compareTo(BigDecimal.ZERO) == 0) {
            // Simple division for zero-interest loans
            return principal.divide(new BigDecimal(tenureMonths), 2, RoundingMode.HALF_UP);
        }

        // Monthly interest rate = annual rate / 12 / 100
        BigDecimal monthlyRate = annualInterestRate
                .divide(new BigDecimal("1200"), 10, RoundingMode.HALF_UP);

        // (1 + r)^n
        BigDecimal onePlusR = BigDecimal.ONE.add(monthlyRate);
        BigDecimal power = onePlusR.pow(tenureMonths, new MathContext(15));

        // EMI = P * r * (1+r)^n / ((1+r)^n - 1)
        BigDecimal numerator = principal.multiply(monthlyRate).multiply(power);
        BigDecimal denominator = power.subtract(BigDecimal.ONE);

        return numerator.divide(denominator, 2, RoundingMode.HALF_UP);
    }

    /** Defaults to INR; validates the 3-letter ISO-4217 shape when provided. */
    private String normalizeCurrency(String currency) {
        if (currency == null || currency.trim().isEmpty()) {
            return "INR";
        }
        String normalized = currency.trim().toUpperCase();
        if (!normalized.matches("[A-Z]{3}")) {
            throw new VacademyException("Invalid currency code: " + currency + ". Expected a 3-letter code like INR or USD.");
        }
        return normalized;
    }

    private EmployeeLoanDTO toDTO(EmployeeLoan loan) {
        return EmployeeLoanDTO.builder()
                .id(loan.getId())
                .employeeId(loan.getEmployee().getId())
                .employeeCode(loan.getEmployee().getEmployeeCode())
                .instituteId(loan.getInstituteId())
                .loanType(loan.getLoanType())
                .principalAmount(loan.getPrincipalAmount())
                .interestRate(loan.getInterestRate())
                .tenureMonths(loan.getTenureMonths())
                .emiAmount(loan.getEmiAmount())
                .disbursedAmount(loan.getDisbursedAmount())
                .balanceAmount(loan.getBalanceAmount())
                .startMonth(loan.getStartMonth())
                .startYear(loan.getStartYear())
                .status(loan.getStatus())
                .notes(loan.getNotes())
                .currency(loan.getCurrency() != null ? loan.getCurrency() : "INR")
                .build();
    }
}
