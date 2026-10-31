package vacademy.io.admin_core_service.features.hr_payslip.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_payslip.dto.BankExportDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.BankExportRequestDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.BankExportResultDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.FileDownloadDTO;
import vacademy.io.admin_core_service.features.hr_payslip.service.BankExportService;
import vacademy.io.admin_core_service.features.hr_payslip.service.HrReportService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/reports")
public class ReportsController {

    @Autowired
    private BankExportService bankExportService;

    @Autowired
    private HrReportService hrReportService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping("/bank-export")
    @Auditable(
            entityType = "HR_BANK_EXPORT",
            action = "GENERATE",
            entityIdExpr = "#requestDTO?.payrollRunId",
            descriptionExpr = "'generated bank export for payroll run ' + #requestDTO?.payrollRunId")
    public ResponseEntity<BankExportResultDTO> generateBankExport(
            @RequestBody BankExportRequestDTO requestDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Plaintext bank account numbers + net pay for all staff — HR admin ONLY
        hrAccessGuard.requireHrAdmin(user, instituteId);
        BankExportResultDTO result = bankExportService.generateBankExport(requestDTO, user.getUserId(), instituteId);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/bank-export/{id}/download")
    @Auditable(
            entityType = "HR_BANK_EXPORT",
            action = "DOWNLOAD",
            entityIdExpr = "#id",
            descriptionExpr = "'downloaded bank export ' + #id")
    public ResponseEntity<byte[]> downloadBankExport(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Plaintext bank account numbers + net pay for all staff — HR admin ONLY
        hrAccessGuard.requireHrAdmin(user, instituteId);
        FileDownloadDTO file = bankExportService.downloadBankExport(id, instituteId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(file.getContentType()));
        headers.setContentDispositionFormData("attachment", file.getFileName());
        return new ResponseEntity<>(file.getBytes(), headers, HttpStatus.OK);
    }

    @GetMapping("/bank-export")
    public ResponseEntity<List<BankExportDTO>> getBankExports(
            @RequestParam("payrollRunId") String payrollRunId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<BankExportDTO> exports = bankExportService.getBankExports(payrollRunId, instituteId);
        return ResponseEntity.ok(exports);
    }

    @GetMapping("/payroll-summary")
    public ResponseEntity<Map<String, Object>> getPayrollSummary(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        Map<String, Object> summary = hrReportService.getPayrollSummary(instituteId, month, year);
        return ResponseEntity.ok(summary);
    }
}
