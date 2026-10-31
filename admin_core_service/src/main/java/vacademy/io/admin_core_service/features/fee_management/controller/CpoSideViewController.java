package vacademy.io.admin_core_service.features.fee_management.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.fee_management.dto.ApplyCpoDiscountRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoDiscountPreviewDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoSideViewInstallmentsResponseDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoUserPlanSummaryDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.ModifyInstallmentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.RecordOfflinePaymentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.SplitInstallmentRequestDTO;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import java.util.List;
import vacademy.io.admin_core_service.features.fee_management.service.CpoSideViewService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Admin side-view payment-history API for CPO UserPlans.
 *
 * <ul>
 *   <li>GET  /user-plan/{userPlanId}/installments — full installment ledger + discount snapshot</li>
 *   <li>PUT  /installments/{sfpId} — modify dates / amount / discount on one installment</li>
 *   <li>PUT  /user-plan/{userPlanId}/cpo-discount — apply / modify / remove whole-CPO discount</li>
 *   <li>POST /user-plan/{userPlanId}/record-offline-payment — record + FIFO-allocate offline collection</li>
 * </ul>
 *
 * <p>All write endpoints return the refreshed list payload so the side-view
 * can re-render in one round trip.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/fee-management")
@RequiredArgsConstructor
public class CpoSideViewController {

    private final CpoSideViewService cpoSideViewService;

    /**
     * Compact list of every CPO UserPlan a user is enrolled in. Used to
     * populate the side-view "CPO installments" section so the frontend
     * knows which UserPlans to render before drilling into any one.
     */
    @GetMapping("/user/{userId}/cpo-user-plans")
    public ResponseEntity<List<CpoUserPlanSummaryDTO>> listForUser(@PathVariable String userId) {
        return ResponseEntity.ok(cpoSideViewService.listForUser(userId));
    }

    @GetMapping("/user-plan/{userPlanId}/installments")
    public ResponseEntity<CpoSideViewInstallmentsResponseDTO> list(@PathVariable String userPlanId) {
        return ResponseEntity.ok(cpoSideViewService.list(userPlanId));
    }

    @PutMapping("/installments/{sfpId}")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#sfpId",
            descriptionExpr = "'edited installment ' + #sfpId")
    public ResponseEntity<CpoSideViewInstallmentsResponseDTO> modifyInstallment(
            @PathVariable String sfpId,
            @RequestBody ModifyInstallmentRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails userDetails) {
        String adminUserId = userDetails != null ? userDetails.getUserId() : null;
        return ResponseEntity.ok(cpoSideViewService.modifyInstallment(sfpId, request, adminUserId));
    }

    /**
     * Moves part of one installment's unpaid balance onto a new installment with its own due
     * date — how an admin schedules "the rest is due on the 10th". Plan total unchanged.
     */
    @PostMapping("/installments/{sfpId}/split")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "SPLIT",
            entityIdExpr = "#sfpId",
            descriptionExpr = "'split installment ' + #sfpId + ': ' + #request?.amount + ' due ' + #request?.dueDate")
    public ResponseEntity<CpoSideViewInstallmentsResponseDTO> splitInstallment(
            @PathVariable String sfpId,
            @RequestBody SplitInstallmentRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails userDetails) {
        String adminUserId = userDetails != null ? userDetails.getUserId() : null;
        return ResponseEntity.ok(cpoSideViewService.splitInstallment(sfpId, request, adminUserId));
    }

    @PutMapping("/user-plan/{userPlanId}/cpo-discount")
    @Auditable(
            entityType = "FEE_PLAN",
            action = "UPDATE",
            entityIdExpr = "#userPlanId",
            descriptionExpr = "(#request?.remove ? 'removed' : 'changed') + ' the plan discount on ' + #userPlanId")
    public ResponseEntity<CpoSideViewInstallmentsResponseDTO> setCpoDiscount(
            @PathVariable String userPlanId,
            @RequestBody ApplyCpoDiscountRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails userDetails) {
        String adminUserId = userDetails != null ? userDetails.getUserId() : null;
        return ResponseEntity.ok(cpoSideViewService.setCpoDiscount(userPlanId, request, adminUserId));
    }

    /** What a plan discount would take off each installment, before it is applied. Saves nothing. */
    @PostMapping("/user-plan/{userPlanId}/cpo-discount/preview")
    public ResponseEntity<CpoDiscountPreviewDTO> previewCpoDiscount(
            @PathVariable String userPlanId,
            @RequestBody ApplyCpoDiscountRequestDTO request) {
        return ResponseEntity.ok(cpoSideViewService.previewCpoDiscount(userPlanId, request));
    }

    @PostMapping("/user-plan/{userPlanId}/record-offline-payment")
    @Auditable(
            entityType = "PAYMENT",
            action = "CREATE",
            entityIdExpr = "#userPlanId",
            descriptionExpr = "'recorded an offline payment of ' + #request?.amount + ' on plan ' + #userPlanId")
    public ResponseEntity<CpoSideViewInstallmentsResponseDTO> recordOfflinePayment(
            @PathVariable String userPlanId,
            @RequestBody RecordOfflinePaymentRequestDTO request,
            @AuthenticationPrincipal CustomUserDetails userDetails) {
        String adminUserId = userDetails != null ? userDetails.getUserId() : null;
        return ResponseEntity.ok(cpoSideViewService.recordOfflinePayment(userPlanId, request, adminUserId));
    }
}
