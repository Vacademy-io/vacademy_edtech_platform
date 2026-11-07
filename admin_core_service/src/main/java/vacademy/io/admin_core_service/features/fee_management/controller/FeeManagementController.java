package vacademy.io.admin_core_service.features.fee_management.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.fee_management.dto.ComplexPaymentOptionDTO;
import vacademy.io.admin_core_service.features.fee_management.service.FeeManagementService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/fee-management")
public class FeeManagementController {

    @Autowired
    private FeeManagementService feeManagementService;

    /**
     * API #1: Create a full CPO with nested fee types, assigned values, and
     * installments.
     * POST /admin-core-service/v1/fee-management/cpo
     */
    @PostMapping("/cpo")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'created fee plan ' + #request?.name")
    public ResponseEntity<ComplexPaymentOptionDTO> createCpo(
            @RequestBody ComplexPaymentOptionDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.createCpo(request, userDetails));
    }

    /**
     * API #2: List all CPOs for an institute (lightweight).
     * GET /admin-core-service/v1/fee-management/cpo/{instituteId}
     */
    @GetMapping("/cpo/{instituteId}")
    public ResponseEntity<Page<ComplexPaymentOptionDTO>> listCposByInstitute(
            @PathVariable String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.listCposByInstitute(instituteId, page, size));
    }

    /**
     * API #3: Get full CPO with all nested children.
     * GET /admin-core-service/v1/fee-management/cpo/{cpoId}/full
     */
    @GetMapping("/cpo/{cpoId}/full")
    public ResponseEntity<ComplexPaymentOptionDTO> getFullCpo(
            @PathVariable String cpoId,
            @RequestParam(defaultValue = "0") int feeTypePage,
            @RequestParam(defaultValue = "20") int feeTypeSize,
            @RequestParam(defaultValue = "0") int installmentPage,
            @RequestParam(defaultValue = "50") int installmentSize,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(
                feeManagementService.getFullCpo(cpoId, feeTypePage, feeTypeSize, installmentPage, installmentSize));
    }

    /**
     * API #4: Update CPO Metadata.
     * PUT /admin-core-service/v1/fee-management/cpo/{cpoId}
     */
    @PutMapping("/cpo/{cpoId}")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#cpoId",
            descriptionExpr = "'updated fee plan ' + (#request?.name ?: #result?.body?.name)")
    public ResponseEntity<ComplexPaymentOptionDTO> updateCpo(
            @PathVariable String cpoId,
            @RequestBody ComplexPaymentOptionDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.updateCpo(cpoId, request));
    }

    /**
     * API #5: Update Fee Type & Commercials.
     * PUT /admin-core-service/v1/fee-management/fee-type/{feeTypeId}
     */
    @PutMapping("/fee-type/{feeTypeId}")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#feeTypeId",
            descriptionExpr = "'updated fee type ' + (#request?.name ?: #result?.body?.name)")
    public ResponseEntity<ComplexPaymentOptionDTO.FeeTypeDTO> updateFeeType(
            @PathVariable String feeTypeId,
            @RequestBody ComplexPaymentOptionDTO.FeeTypeDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.updateFeeType(feeTypeId, request));
    }

    /**
     * API #6: Soft delete CPO and all related records by status update.
     * PUT /admin-core-service/v1/fee-management/cpo/{cpoId}/soft-delete
     */
    @PutMapping("/cpo/{cpoId}/soft-delete")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "DELETE",
            entityIdExpr = "#cpoId",
            descriptionExpr = "'deleted fee plan ' + (#result?.body?.name ?: #cpoId)")
    public ResponseEntity<ComplexPaymentOptionDTO> softDeleteCpo(
            @PathVariable String cpoId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.softDeleteCpoById(cpoId));
    }

    /**
     * API #7: Get all CPO options available for a package session (class).
     * Returns full CPO details with fee breakdown for admin to select during
     * admission.
     * GET
     * /admin-core-service/v1/fee-management/package-session/{packageSessionId}/cpo-options
     */
    @GetMapping("/package-session/{packageSessionId}/cpo-options")
    public ResponseEntity<List<ComplexPaymentOptionDTO>> getCpoOptionsForPackageSession(
            @PathVariable String packageSessionId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.getCpoOptionsForPackageSession(packageSessionId));
    }

    /**
     * API #8: Approve a PENDING_APPROVAL CPO.
     * Only admins should call this. Moves CPO status from PENDING_APPROVAL →
     * ACTIVE.
     * POST /admin-core-service/v1/fee-management/cpo/{cpoId}/approve
     */
    @PostMapping("/cpo/{cpoId}/approve")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "APPROVE",
            entityIdExpr = "#cpoId",
            descriptionExpr = "'approved fee plan ' + (#result?.body?.name ?: #cpoId)")
    public ResponseEntity<ComplexPaymentOptionDTO> approveCpo(
            @PathVariable String cpoId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(feeManagementService.approveCpo(cpoId, userDetails));
    }
}
