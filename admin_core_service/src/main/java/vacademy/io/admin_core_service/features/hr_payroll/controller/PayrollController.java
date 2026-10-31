package vacademy.io.admin_core_service.features.hr_payroll.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_payroll.dto.*;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryError;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryErrorRepository;
import vacademy.io.admin_core_service.features.hr_payroll.service.FnFService;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollAdjustmentService;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollCalculationService;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollEntryService;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollRunService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Payroll runs & entries. Access (plan.md section G): all payroll processing is
 * HR_ADMIN/ADMIN; entry/run reads are HR staff (HR_MANAGER may view).
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/payroll")
public class PayrollController {

    @Autowired
    private PayrollRunService payrollRunService;

    @Autowired
    private PayrollCalculationService payrollCalculationService;

    @Autowired
    private PayrollEntryService payrollEntryService;

    @Autowired
    private PayrollAdjustmentService payrollAdjustmentService;

    @Autowired
    private FnFService fnFService;

    @Autowired
    private PayrollEntryErrorRepository payrollEntryErrorRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    // ======================== Payroll Runs ========================

    @PostMapping("/runs")
    @Auditable(entityType = "HR_PAYROLL_RUN", action = "CREATE", entityIdExpr = "#result?.body")
    public ResponseEntity<String> createPayrollRun(
            @RequestBody CreatePayrollRunDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = payrollRunService.createPayrollRun(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    @GetMapping("/runs")
    public ResponseEntity<List<PayrollRunDTO>> getPayrollRuns(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "year", required = false) Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<PayrollRunDTO> runs = payrollRunService.getPayrollRuns(instituteId, year);
        return ResponseEntity.ok(runs);
    }

    @GetMapping("/runs/{id}")
    public ResponseEntity<PayrollRunDTO> getPayrollRunById(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        PayrollRunDTO run = payrollRunService.getPayrollRunById(id, instituteId);
        return ResponseEntity.ok(run);
    }

    @PostMapping("/runs/{id}/process")
    @Auditable(entityType = "HR_PAYROLL_RUN", action = "PROCESS", entityIdExpr = "#id")
    public ResponseEntity<String> processPayroll(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollCalculationService.processPayroll(id, instituteId, user.getUserId());
        return ResponseEntity.ok(resultId);
    }

    @PutMapping("/runs/{id}/approve")
    @Auditable(entityType = "HR_PAYROLL_RUN", action = "APPROVE", entityIdExpr = "#id")
    public ResponseEntity<String> approvePayroll(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollRunService.approvePayroll(id, instituteId, user.getUserId());
        return ResponseEntity.ok(resultId);
    }

    /** PROCESSED/APPROVED -> DRAFT with full financial reversal, so a wrong run can be recalculated. */
    @PutMapping("/runs/{id}/reject")
    @Auditable(entityType = "HR_PAYROLL_RUN", action = "REJECT", entityIdExpr = "#id")
    public ResponseEntity<String> rejectPayroll(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollRunService.rejectPayroll(id, instituteId);
        return ResponseEntity.ok(resultId);
    }

    @PutMapping("/runs/{id}/mark-paid")
    @Auditable(entityType = "HR_PAYROLL_RUN", action = "MARK_PAID", entityIdExpr = "#id")
    public ResponseEntity<String> markPaid(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollRunService.markPaid(id, instituteId);
        return ResponseEntity.ok(resultId);
    }

    @DeleteMapping("/runs/{id}")
    @Auditable(entityType = "HR_PAYROLL_RUN", action = "CANCEL", entityIdExpr = "#id")
    public ResponseEntity<String> cancelPayroll(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollRunService.cancelPayroll(id, instituteId);
        return ResponseEntity.ok(resultId);
    }

    // ======================== Payroll Entries ========================

    @GetMapping("/runs/{id}/entries")
    public ResponseEntity<List<PayrollEntryDTO>> getEntriesByRun(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<PayrollEntryDTO> entries = payrollEntryService.getEntriesByRun(id, instituteId);
        return ResponseEntity.ok(entries);
    }

    @GetMapping("/entries/{id}")
    public ResponseEntity<PayrollEntryDTO> getEntryById(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        PayrollEntryDTO entry = payrollEntryService.getEntryById(id, instituteId);
        return ResponseEntity.ok(entry);
    }

    @PutMapping("/entries/{id}/hold")
    @Auditable(entityType = "HR_PAYROLL_ENTRY", action = "HOLD", entityIdExpr = "#id",
            descriptionExpr = "'hold reason: ' + #holdDTO?.holdReason")
    public ResponseEntity<String> holdEntry(
            @PathVariable("id") String id,
            @RequestBody HoldReleaseDTO holdDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollEntryService.holdEntry(id, instituteId, holdDTO);
        return ResponseEntity.ok(resultId);
    }

    /** Per-employee processing failures of a run — replaces the old silent swallowing. */
    @GetMapping("/runs/{id}/errors")
    public ResponseEntity<List<PayrollEntryError>> getRunErrors(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        payrollRunService.getPayrollRunById(id, instituteId); // institute-scope check
        return ResponseEntity.ok(payrollEntryErrorRepository.findByPayrollRunIdOrderByCreatedAtAsc(id));
    }

    // ======================== Variable pay (adjustments) ========================

    @PostMapping("/adjustments")
    @Auditable(entityType = "HR_PAYROLL_ADJUSTMENT", action = "CREATE", entityIdExpr = "#result?.body")
    public ResponseEntity<String> createAdjustment(
            @RequestBody PayrollAdjustmentDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(payrollAdjustmentService.createAdjustment(dto, instituteId, user, "MANUAL"));
    }

    @GetMapping("/adjustments")
    public ResponseEntity<List<PayrollAdjustmentDTO>> getAdjustments(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("year") Integer year,
            @RequestParam("month") Integer month,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(payrollAdjustmentService.getAdjustments(instituteId, year, month));
    }

    @DeleteMapping("/adjustments/{id}")
    @Auditable(entityType = "HR_PAYROLL_ADJUSTMENT", action = "DELETE", entityIdExpr = "#id")
    public ResponseEntity<String> deleteAdjustment(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        payrollAdjustmentService.deleteAdjustment(id, instituteId);
        return ResponseEntity.ok(id);
    }

    // ======================== Full & final settlement ========================

    /**
     * Prepares an exiting employee's F&F: leave-encashment (and optional
     * notice-recovery) adjustments scoped to a run_type=FNF run for the exit
     * month. Create + process that run to pay out.
     */
    @PostMapping("/fnf/prepare")
    @Auditable(entityType = "HR_PAYROLL_FNF", action = "PREPARE", entityIdExpr = "#employeeId")
    public ResponseEntity<Map<String, Object>> prepareFnF(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("employeeId") String employeeId,
            @RequestParam(value = "noticeRecoveryAmount", required = false) BigDecimal noticeRecoveryAmount,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(fnFService.prepareFnF(employeeId, instituteId, noticeRecoveryAmount, user.getUserId()));
    }

    @PutMapping("/entries/{id}/release")
    @Auditable(entityType = "HR_PAYROLL_ENTRY", action = "RELEASE", entityIdExpr = "#id")
    public ResponseEntity<String> releaseEntry(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = payrollEntryService.releaseEntry(id, instituteId);
        return ResponseEntity.ok(resultId);
    }
}
