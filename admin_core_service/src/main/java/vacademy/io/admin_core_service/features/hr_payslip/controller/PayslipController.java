package vacademy.io.admin_core_service.features.hr_payslip.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_payslip.dto.FileDownloadDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.GeneratePayslipDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.PayslipDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.PayslipEmailResultDTO;
import vacademy.io.admin_core_service.features.hr_payslip.service.PayslipService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/payslips")
public class PayslipController {

    @Autowired
    private PayslipService payslipService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping("/generate")
    @Auditable(
            entityType = "HR_PAYSLIP",
            action = "GENERATE",
            entityIdExpr = "#dto?.payrollRunId",
            descriptionExpr = "'generated payslips for payroll run ' + #dto?.payrollRunId")
    public ResponseEntity<String> generatePayslips(
            @RequestBody GeneratePayslipDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String result = payslipService.generatePayslips(dto.getPayrollRunId(), instituteId);
        return ResponseEntity.ok(result);
    }

    @GetMapping
    public ResponseEntity<List<PayslipDTO>> getPayslips(
            @RequestParam("employeeId") String employeeId,
            @RequestParam(value = "year", required = false) Integer year,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Employee must belong to the validated institute; non-HR callers may only read their own payslips
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        List<PayslipDTO> payslips = payslipService.getPayslips(employeeId, year);
        return ResponseEntity.ok(payslips);
    }

    @GetMapping("/{id}")
    public ResponseEntity<PayslipDTO> getPayslipById(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.validateMember(user, instituteId);
        PayslipDTO payslip = payslipService.getPayslipById(id, instituteId, user);
        return ResponseEntity.ok(payslip);
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> downloadPayslip(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Same self-or-staff rule as getPayslipById (enforced inside the service)
        hrAccessGuard.validateMember(user, instituteId);
        FileDownloadDTO file = payslipService.downloadPayslipPdf(id, instituteId, user);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDispositionFormData("attachment", file.getFileName());
        return new ResponseEntity<>(file.getBytes(), headers, HttpStatus.OK);
    }

    @PostMapping("/email")
    @Auditable(
            entityType = "HR_PAYSLIP",
            action = "EMAIL",
            entityIdExpr = "#dto?.payrollRunId",
            descriptionExpr = "'emailed payslips for payroll run ' + #dto?.payrollRunId")
    public ResponseEntity<PayslipEmailResultDTO> emailPayslips(
            @RequestBody GeneratePayslipDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        PayslipEmailResultDTO result = payslipService.emailPayslips(dto.getPayrollRunId(), instituteId);
        return ResponseEntity.ok(result);
    }
}
