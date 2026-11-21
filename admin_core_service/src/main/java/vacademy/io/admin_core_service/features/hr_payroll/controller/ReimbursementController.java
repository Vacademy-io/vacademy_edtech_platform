package vacademy.io.admin_core_service.features.hr_payroll.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_payroll.dto.CreateReimbursementDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.ReimbursementActionDTO;
import vacademy.io.admin_core_service.features.hr_payroll.dto.ReimbursementDTO;
import vacademy.io.admin_core_service.features.hr_payroll.service.ReimbursementService;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/payroll/reimbursements")
public class ReimbursementController {

    @Autowired
    private ReimbursementService reimbursementService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    public ResponseEntity<String> submitReimbursement(
            @RequestBody CreateReimbursementDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Guarded inside the service: employee must belong to the institute and
        // non-HR callers may only submit for their own employee record
        String id = reimbursementService.submitReimbursement(dto, instituteId, user);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<Page<ReimbursementDTO>> getReimbursements(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "employeeId", required = false) String employeeId,
            @RequestParam(defaultValue = "0") int pageNo,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        if (employeeId != null) {
            // Employee-scoped view: HR staff, or the employee themselves
            hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        } else {
            // Institute-wide view: HR staff only
            hrAccessGuard.requireHrStaff(user, instituteId);
        }
        Page<ReimbursementDTO> page = reimbursementService.getReimbursements(
                instituteId, status, employeeId, pageNo, pageSize);
        return ResponseEntity.ok(page);
    }

    @PutMapping("/{id}/action")
    @Auditable(
            entityType = "HR_REIMBURSEMENT",
            action = "ACTION",
            actionExpr = "#actionDTO?.action",
            entityIdExpr = "#id",
            descriptionExpr = "#actionDTO?.action + ' reimbursement ' + #id")
    public ResponseEntity<String> approveRejectReimbursement(
            @PathVariable("id") String id,
            @RequestBody ReimbursementActionDTO actionDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        String resultId = reimbursementService.approveRejectReimbursement(id, actionDTO, user.getUserId(), instituteId);
        return ResponseEntity.ok(resultId);
    }
}
