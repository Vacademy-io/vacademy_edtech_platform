package vacademy.io.admin_core_service.features.user_subscription.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import java.util.List;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeOptionsDTO;
import vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.*;
import vacademy.io.admin_core_service.features.user_subscription.service.AdminManualRenewalService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentVoidService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/v1/user-plan")
public class UserPlanController {

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private PaymentVoidService paymentVoidService;

    @Autowired
    private PaymentDeletionService paymentDeletionService;

    @Autowired
    private vacademy.io.admin_core_service.core.security.InstituteAccessValidator instituteAccessValidator;

    @Autowired
    private AdminManualRenewalService adminManualRenewalService;

    @GetMapping("/{userPlanId}/with-payment-logs")
    public ResponseEntity<UserPlanDTO> getUserPlanWithPaymentLogs(
            @PathVariable String userPlanId,
            @RequestParam(required = false, defaultValue = "false") boolean includePolicyDetails,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        UserPlanDTO userPlanDTO = userPlanService.getUserPlanWithPaymentLogs(userPlanId, includePolicyDetails);
        return ResponseEntity.ok(userPlanDTO);
    }

    @PostMapping("/all")
    public ResponseEntity<Page<UserPlanDTO>> getUserPlans(
            @RequestParam(required = false, defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(required = false, defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize,
            @RequestBody UserPlanFilterDTO filterDTO) {

        Page<UserPlanDTO> userPlans = userPlanService.getUserPlansByUserIdAndInstituteId(pageNo, pageSize, filterDTO);
        return ResponseEntity.ok(userPlans);
    }

    @PostMapping("/payment-logs")
    public ResponseEntity<Page<PaymentLogWithUserPlanDTO>> getPaymentLogs(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam(required = false, defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(required = false, defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize,
            @RequestBody PaymentLogFilterRequestDTO filterDTO) {

        Page<PaymentLogWithUserPlanDTO> paymentLogs = paymentLogService
                .getPaymentLogsForInstitute(filterDTO, pageNo, pageSize);
        return ResponseEntity.ok(paymentLogs);
    }

    /**
     * Per-status counts and totals for the same rows {@code POST /payment-logs} would list under
     * the same filters. Manage Payments reads its tiles and tab counts from here so the table can
     * page normally instead of pulling every row into the browser to add them up.
     */
    @PostMapping("/payment-logs/summary")
    public ResponseEntity<PaymentLogSummaryResponseDTO> getPaymentLogSummary(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody PaymentLogFilterRequestDTO filterDTO) {
        return ResponseEntity.ok(paymentLogService.getPaymentLogSummary(filterDTO));
    }

    /**
     * Aggregated PAID collection total + per-day series for an institute, optionally
     * scoped to one sub-org, over a UTC date window. Powers the dashboard "amount
     * collected (last 3/7/24 days / all)" panels. Omit dates for all-time.
     */
    @PostMapping("/payment-logs/collection-summary")
    public ResponseEntity<CollectionSummaryResponseDTO> getCollectionSummary(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody CollectionSummaryRequestDTO request) {
        return ResponseEntity.ok(paymentLogService.getCollectionSummary(request));
    }

    /**
     * Total billed / collected / due for an institute over a window, computed from the plans
     * learners are enrolled on rather than from payment rows — so a part-paid instalment plan and
     * an enrolment that has never paid both show up as money owed. Omit dates for all-time.
     */
    @PostMapping("/payment-logs/billing-summary")
    public ResponseEntity<BillingSummaryResponseDTO> getBillingSummary(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody BillingSummaryRequestDTO request) {
        return ResponseEntity.ok(paymentLogService.getBillingSummary(request));
    }

    /**
     * Paginated drill-down behind the "Due payment" card: the learners who still owe money, with
     * the amount, the fee type, and (for custom instalment plans) their next instalment.
     *
     * <p>{@code includeNotYetDue=true} returns the "Outstanding" list instead: every learner with
     * a balance still to collect, whatever its due date, soonest next instalment first. Defaults
     * to false, so existing callers keep the Due list unchanged.
     *
     * <p>{@code dueMonth=yyyy-MM} narrows to the learners with something falling due in that month
     * (one bar of the instalment forecast). Omitted, the lists are exactly as before.
     */
    @PostMapping("/payment-logs/outstanding-learners")
    public ResponseEntity<Page<OutstandingLearnerDTO>> getOutstandingLearners(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody BillingSummaryRequestDTO request,
            @RequestParam(value = "pageNo", defaultValue = "0") int pageNo,
            @RequestParam(value = "pageSize", defaultValue = "20") int pageSize,
            @RequestParam(value = "includeNotYetDue", defaultValue = "false") boolean includeNotYetDue,
            @RequestParam(value = "dueMonth", required = false) String dueMonth) {
        return ResponseEntity.ok(paymentLogService.getOutstandingLearners(
                request, pageNo, pageSize, includeNotYetDue, dueMonth));
    }

    /**
     * Instalment fee progress (billed / paid / overdue / to come, instalment plans only) and the
     * Upcoming card split by month. Same body as billing-summary; read-only.
     */
    @PostMapping("/payment-logs/instalment-forecast")
    public ResponseEntity<InstalmentForecastResponseDTO> getInstalmentForecast(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody BillingSummaryRequestDTO request) {
        return ResponseEntity.ok(paymentLogService.getInstalmentForecast(request));
    }

    /**
     * The enrolments behind one learner's Due row — the side view. Returns cancelled plans too,
     * flagged, so an admin can verify a cancellation actually removed the balance.
     */
    @PostMapping("/payment-logs/learner-plan-breakdown")
    public ResponseEntity<List<LearnerPlanBreakdownDTO>> getLearnerPlanBreakdown(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody BillingSummaryRequestDTO request,
            @RequestParam("userId") String userId) {
        return ResponseEntity.ok(paymentLogService.getLearnerPlanBreakdown(request, userId));
    }

    /**
     * Voids an offline / manually recorded payment that was entered by mistake — see
     * {@link PaymentVoidService}. The payment stays in the listing (struck through) for audit;
     * every total, installment and ledger figure it had moved is put back.
     *
     * <p>{@code POST /v1/user-plan/payment-logs/{paymentLogId}/void?instituteId=xxx}
     */
    @PostMapping("/payment-logs/{paymentLogId}/void")
    @Auditable(
            entityType = "PAYMENT",
            action = "VOID",
            captureBefore = "@paymentDeletionService.paymentAuditSnapshot(#paymentLogId)",
            entityIdExpr = "#paymentLogId",
            descriptionExpr = "'voided payment ' + #paymentLogId + (#request?.reason != null ? ': ' + #request.reason : '')")
    public ResponseEntity<PaymentVoidResultDTO> voidPayment(
            @PathVariable String paymentLogId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) VoidPaymentRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(paymentVoidService.voidPayment(
                paymentLogId,
                instituteId,
                request != null ? request.getReason() : null,
                userDetails != null ? userDetails.getUserId() : null));
    }

    /**
     * Permanently deletes an offline / manually recorded payment. OFF unless the caller's role has
     * Display Settings → Learner Management → "delete payments & invoices" switched on — checked
     * server-side by {@link PaymentDeletionService#canDelete}. A payment that still counts is
     * voided first, so balances, installments and invoices are put right before the rows go. The
     * deleted payment is kept in the admin activity log (before-snapshot).
     *
     * <p>{@code DELETE /v1/user-plan/payment-logs/{paymentLogId}?instituteId=xxx}
     */
    /**
     * Whether the caller may permanently delete payments / invoices here — the same check the
     * delete endpoints run. The admin app shows the Delete buttons only when this says yes, so
     * the screen can never offer a delete the server will refuse.
     *
     * <p>{@code GET /v1/user-plan/payment-logs/can-delete?instituteId=xxx}
     */
    @GetMapping("/payment-logs/can-delete")
    public ResponseEntity<java.util.Map<String, Object>> canDeletePayments(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        boolean allowed = paymentDeletionService.canDelete(
                userDetails != null ? userDetails.getUserId() : null, instituteId);
        return ResponseEntity.ok(java.util.Map.of("allowed", allowed));
    }

    @DeleteMapping("/payment-logs/{paymentLogId}")
    public ResponseEntity<java.util.Map<String, Object>> deletePayment(
            @PathVariable String paymentLogId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(paymentDeletionService.deletePayment(
                paymentLogId, instituteId, userDetails != null ? userDetails.getUserId() : null));
    }

    @PostMapping("/payment-logs/update-tracking")
    @Auditable(
            entityType = "PAYMENT",
            action = "UPDATE",
            entityIdExpr = "#trackingDTO?.paymentLogId",
            descriptionExpr = "'updated order tracking for payment ' + #trackingDTO?.paymentLogId")
    public ResponseEntity<Void> updatePaymentLogTracking(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody UpdatePaymentLogTrackingDTO trackingDTO) {

        paymentLogService.updatePaymentLogTracking(trackingDTO);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/status")
    public ResponseEntity<Void> updateUserPlanStatuses(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody UserPlanStatusUpdateRequestDTO request) {

        userPlanService.updateUserPlanStatuses(request.getUserPlanIds(), request.getStatus());
        return ResponseEntity.ok().build();
    }

    @PutMapping("/{userPlanId}/cancel")
    public ResponseEntity<Void> cancelUserPlan(
            @PathVariable String userPlanId,
            @RequestParam(required = false, defaultValue = "false") boolean force,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        userPlanService.cancelUserPlan(userPlanId, force);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/membership-details")
    public ResponseEntity<Page<MembershipDetailsDTO>> getMembershipDetails(
            @RequestParam(required = false, defaultValue = "0") int pageNo,
            @RequestParam(required = false, defaultValue = "10") int pageSize,
            @RequestBody MembershipFilterDTO filterDTO,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        // Ensure institute ID is set (security check could be added here to ensure user
        // belongs to institute)
        if (filterDTO.getInstituteId() == null) {
            // Fallback or Error depending on logic, assuming usually passed in body or
            // derived
        }

        return ResponseEntity
                .ok(userPlanService.getMembershipDetails(filterDTO, pageNo, pageSize));
    }

    /**
     * The plans this learner could be moved to, with the proration figures shown for
     * information. Same eligibility rules as the learner-facing listing — an admin cannot
     * move someone onto a plan the institute has not flagged as switchable.
     */
    @GetMapping("/{userPlanId}/change-options")
    public ResponseEntity<PlanChangeOptionsDTO> getPlanChangeOptions(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        return ResponseEntity.ok(userPlanService.getPlanChangeOptions(userPlanId, instituteId));
    }

    /**
     * Admin override: move the learner onto another plan immediately, with no payment.
     * For comps, corrections and negotiated moves.
     *
     * <p>The access window is left as-is — no money changed hands, so extending or
     * truncating what the learner already paid for would be arbitrary. The new price takes
     * effect at the next renewal.
     */
    @PostMapping("/{userPlanId}/change-plan")
    public ResponseEntity<UserPlanDTO> changePlan(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestBody PlanChangeRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        return ResponseEntity.ok(
                userPlanService.adminChangePlan(userPlanId, instituteId, request, userDetails));
    }

    /** Defaults for the manual-renewal dialog: suggested end date and amount. Saves nothing. */
    @GetMapping("/{userPlanId}/manual-renewal/preview")
    public ResponseEntity<ManualRenewalPreviewDTO> previewManualRenewal(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(adminManualRenewalService.preview(userPlanId, instituteId));
    }

    /**
     * Admin records a renewal the member paid offline and extends the membership. Never
     * turns autopay on, and sends the member nothing unless the request asks for it.
     */
    @PostMapping("/{userPlanId}/manual-renewal")
    @Auditable(
            entityType = "PAYMENT",
            action = "CREATE",
            entityIdExpr = "#userPlanId",
            descriptionExpr = "'recorded a manual renewal of ' + #request?.amount + ' on plan ' + #userPlanId")
    public ResponseEntity<ManualRenewalResultDTO> recordManualRenewal(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestBody ManualRenewalRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(adminManualRenewalService.renew(userPlanId, instituteId, request, userDetails));
    }

    /**
     * Admin moves an active membership's end date (and its course access) without a payment,
     * with a required remark. Who changed it and when is kept in the plan's remarks, the
     * learner access log and the admin activity log.
     */
    @PostMapping("/{userPlanId}/end-date")
    @Auditable(
            entityType = "LEARNER",
            action = "ACCESS_CHANGE",
            entityIdExpr = "#userPlanId",
            descriptionExpr = "'changed the membership end date of plan ' + #userPlanId + ' to ' + #request?.newEndDate")
    public ResponseEntity<ManualRenewalResultDTO> changePlanEndDate(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestBody ChangePlanEndDateRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(adminManualRenewalService.changeEndDate(userPlanId, instituteId, request, userDetails));
    }

    /** Renewal records and admin remarks on this membership, newest first. */
    @GetMapping("/{userPlanId}/remarks")
    public ResponseEntity<Page<vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO>> listPlanRemarks(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(adminManualRenewalService.listRemarks(userPlanId, instituteId, page, size));
    }

    @PostMapping("/{userPlanId}/remarks")
    public ResponseEntity<vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO> addPlanRemark(
            @PathVariable String userPlanId,
            @RequestParam String instituteId,
            @RequestBody PlanRemarkRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(adminManualRenewalService.addRemark(
                userPlanId, instituteId, request != null ? request.getRemark() : null, userDetails));
    }
}
