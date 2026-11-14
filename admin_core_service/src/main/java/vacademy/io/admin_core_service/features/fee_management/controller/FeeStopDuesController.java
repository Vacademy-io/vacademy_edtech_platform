package vacademy.io.admin_core_service.features.fee_management.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesResultDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.service.FeeAccessGuard;
import vacademy.io.admin_core_service.features.fee_management.service.FeeStopDuesService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Stop dues on one course's installment (a learner who dropped out or stopped paying) and Reopen.
 * A course of an admission package is stopped on the package instead. Staff of the bill's
 * institute only.
 */
@RestController
@RequestMapping("/admin-core-service/v1/fee-management")
@RequiredArgsConstructor
public class FeeStopDuesController {

    private final FeeStopDuesService feeStopDuesService;
    private final FeeAccessGuard feeAccessGuard;

    @PostMapping("/installments/{sfpId}/stop-dues")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "CANCEL",
            entityIdExpr = "#sfpId",
            descriptionExpr = "'stopped dues on installment ' + #sfpId + (#request?.includeLater ? ' and later ones' : '')"
                    + " + (#request?.removeFromCourse ? ', removed from the course' : '') + ': ' + #request?.reason")
    public ResponseEntity<StopDuesResultDTO> stopDues(
            @PathVariable String sfpId,
            @RequestBody StopDuesRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        StudentFeePayment bill = feeStopDuesService.bill(sfpId);
        String instituteId = feeAccessGuard.requireStaffOfBillsInstitute(user, List.of(bill), null);
        return ResponseEntity.ok(feeStopDuesService.stopForInstallment(
                sfpId, request, instituteId, user != null ? user.getUserId() : null));
    }

    @PostMapping("/installments/{sfpId}/reopen")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#sfpId",
            descriptionExpr = "'reopened the stopped dues of installment ' + #sfpId")
    public ResponseEntity<StopDuesResultDTO> reopen(
            @PathVariable String sfpId,
            @RequestAttribute("user") CustomUserDetails user) {
        StudentFeePayment bill = feeStopDuesService.bill(sfpId);
        feeAccessGuard.requireStaffOfBillsInstitute(user, List.of(bill), null);
        return ResponseEntity.ok(feeStopDuesService.reopenForInstallment(sfpId, user != null ? user.getUserId() : null));
    }
}
