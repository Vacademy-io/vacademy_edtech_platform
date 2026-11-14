package vacademy.io.admin_core_service.features.hr_payroll.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_payroll.dto.CreateLoanDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.EmployeeLoanDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.LoanRepaymentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.service.LoanService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/payroll/loans")
public class LoanController {

    @Autowired
    private LoanService loanService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_LOAN",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created loan for employee ' + #dto?.employeeId")
    public ResponseEntity<String> createLoan(
            @RequestBody CreateLoanDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Loans (principal, interest rate, tenure) are granted by HR — admin only
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = loanService.createLoan(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<List<EmployeeLoanDTO>> getLoans(
            @RequestParam("employeeId") String employeeId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Employee must belong to the validated institute; non-HR callers may only read their own loans
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        List<EmployeeLoanDTO> loans = loanService.getLoans(employeeId);
        return ResponseEntity.ok(loans);
    }

    @PutMapping("/{id}/approve")
    @Auditable(
            entityType = "HR_LOAN",
            action = "APPROVE",
            entityIdExpr = "#id",
            descriptionExpr = "'approved loan ' + #id")
    public ResponseEntity<String> approveLoan(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = loanService.approveLoan(id, user.getUserId(), instituteId);
        return ResponseEntity.ok(resultId);
    }

    @GetMapping("/{id}/repayments")
    public ResponseEntity<List<LoanRepaymentDTO>> getRepayments(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.validateMember(user, instituteId);
        List<LoanRepaymentDTO> repayments = loanService.getRepayments(id, instituteId, user);
        return ResponseEntity.ok(repayments);
    }
}
