package vacademy.io.admin_core_service.features.invoice.controller;

import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.invoice.dto.AdminCreateInvoiceRequestDTO;
import vacademy.io.admin_core_service.features.invoice.dto.AdminInvoicePaymentLinkResponseDTO;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceBulkExportService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/invoices")
public class InvoiceController {

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountPermissionService adminDiscountPermissionService;

    @Autowired
    private InvoiceService invoiceService;

    @Autowired
    private InvoiceBulkExportService invoiceBulkExportService;

    @Autowired
    private vacademy.io.admin_core_service.features.invoice.service.ManualReminderService manualReminderService;

    @Autowired
    private vacademy.io.admin_core_service.core.security.InstituteAccessValidator instituteAccessValidator;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService paymentDeletionService;

    /**
     * Get invoice by ID. Cross-tenant guard: fetch first (the id alone doesn't reveal the
     * institute), then verify the caller belongs to the invoice's institute before returning
     * it — this endpoint is now also reachable from the frontend "Duplicate" action, which
     * would otherwise let any authenticated admin read another institute's invoice (line
     * items, learner, notes) by id.
     */
    @GetMapping("/{invoiceId}")
    public ResponseEntity<InvoiceDTO> getInvoice(
            @PathVariable String invoiceId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        InvoiceDTO invoice = invoiceService.getInvoiceById(invoiceId);
        instituteAccessValidator.validateUserAccess(userDetails, invoice.getInstituteId());
        return ResponseEntity.ok(invoice);
    }

    /**
     * Get invoices by user ID
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<List<InvoiceDTO>> getInvoicesByUser(
            @PathVariable String userId,
            @RequestParam(required = false) String instituteId) {
        List<InvoiceDTO> invoices = invoiceService.getInvoicesByUserId(userId, instituteId);
        return ResponseEntity.ok(invoices);
    }

    /**
     * Manually fire an {@code INSTALLMENT_DUE_REMINDER} workflow event for a single SFP
     * (installment). Mirrors the per-row context the scheduled fee-reminder job builds,
     * so any workflow already authored against that event runs unchanged.
     *
     * <p>Request: {@code POST /v1/invoices/sfp/{sfpId}/send-reminder}
     * (no body — the SFP id is enough to derive recipient/amount/dueDate).
     */
    @PostMapping("/sfp/{sfpId}/send-reminder")
    @vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable(
            entityType = "FEE_PLAN",
            action = "SEND_MESSAGE",
            entityIdExpr = "#sfpId",
            descriptionExpr = "'sent a fee reminder for installment ' + #sfpId")
    public ResponseEntity<java.util.Map<String, Object>> sendManualReminder(
            @PathVariable String sfpId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails userDetails) {
        String triggeredBy = userDetails != null ? userDetails.getUserId() : null;
        return ResponseEntity.ok(manualReminderService.triggerReminderForSfp(sfpId, triggeredBy));
    }

    /**
     * Download invoice PDF — 302-redirects to a freshly-presigned S3 URL. If the
     * persisted Invoice row has no {@code pdf_file_id} (typical when local-dev S3
     * upload failed at create time), the service regenerates the PDF on demand,
     * persists the new file id, and returns the URL — so this endpoint is the only
     * thing the frontend needs to call regardless of whether the PDF was ever
     * successfully uploaded the first time.
     */
    @GetMapping("/{invoiceId}/download")
    public ResponseEntity<String> downloadInvoice(@PathVariable String invoiceId) {
        String url = invoiceService.resolveOrRegeneratePdfUrl(invoiceId);
        if (url == null || url.isBlank()) {
            return ResponseEntity.notFound().build();
        }
        HttpHeaders headers = new HttpHeaders();
        headers.add("Location", url);
        return new ResponseEntity<>(headers, HttpStatus.FOUND);
    }

    /**
     * Get invoices by institute ID with optional filters and pagination.
     *
     * Usage: GET /admin-core-service/v1/invoices/institute/{instituteId}?page=0&size=20&userId=...&status=...&startDate=...&endDate=...
     */
    @GetMapping("/institute/{instituteId}")
    public ResponseEntity<Page<InvoiceDTO>> getInvoicesByInstitute(
            @PathVariable String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endDate) {
        Page<InvoiceDTO> invoices = invoiceService.getInvoicesByInstituteId(
                instituteId, userId, status, startDate, endDate, page, size);
        return ResponseEntity.ok(invoices);
    }

    /**
     * Every invoice issued in a date window as one ZIP of PDFs plus an {@code invoices.csv}
     * manifest — the "Invoices (ZIP)" export on Manage Payments. One invoice per payment;
     * see {@link vacademy.io.admin_core_service.features.invoice.service.InvoiceBulkExportService}.
     *
     * <p>Written straight to the response rather than as a {@code StreamingResponseBody}: an
     * async response would be cut off by the servlet async timeout on a large period. The plan
     * is made first, so "nothing in this period" / "too many" come back as ordinary errors.
     *
     * <p>Usage: GET /admin-core-service/v1/invoices/institute/{instituteId}/bulk-download?startDate=...&endDate=...
     */
    @GetMapping("/institute/{instituteId}/bulk-download")
    public void bulkDownloadInvoices(
            @PathVariable String instituteId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endDate,
            @RequestAttribute("user") CustomUserDetails userDetails,
            jakarta.servlet.http.HttpServletResponse response) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        InvoiceBulkExportService.ExportPlan plan = invoiceBulkExportService.plan(instituteId, startDate, endDate);
        response.setContentType("application/zip");
        response.setHeader("Content-Disposition", "attachment; filename=\"invoices.zip\"");
        try {
            invoiceBulkExportService.writeZip(plan, response.getOutputStream());
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("Failed to write invoice archive", e);
        }
    }

    /**
     * Bulk "which invoice covers each of these payments?" lookup, for the Invoice column on
     * the Manage Payments table.
     *
     * <p>Deliberately not folded into the payment-logs listing: the column is optional (an
     * admin can hide it), so this keeps the cost off every payments request and lets the
     * frontend ask only for the page it is showing.
     *
     * <p>Payment logs with no invoice are omitted rather than returned as nulls.
     *
     * <p>{@code POST /v1/invoices/by-payment-logs?instituteId=xxx}
     * with {@code {"payment_log_ids": ["...", "..."]}}
     */
    @PostMapping("/by-payment-logs")
    public ResponseEntity<List<vacademy.io.admin_core_service.features.invoice.dto.PaymentLogInvoiceDTO>> getInvoicesForPaymentLogs(
            @RequestParam String instituteId,
            @RequestBody vacademy.io.admin_core_service.features.invoice.dto.PaymentLogInvoiceLookupRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(invoiceService.getInvoicesForPaymentLogs(
                instituteId, request != null ? request.getPaymentLogIds() : null));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin invoice endpoints
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Admin creates invoices for one or multiple users.
     * No package session / enroll invite required.
     * Returns one entry per userId with a shareable payment link.
     *
     * POST /admin-core-service/v1/invoices/admin/create
     */
    @PostMapping("/admin/create")
    @vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable(
            entityType = "INVOICE",
            action = "CREATE",
            descriptionExpr = "'created ' + (#result?.body?.size() ?: 0) + ' invoice(s)'")
    public ResponseEntity<List<AdminInvoicePaymentLinkResponseDTO>> createAdminInvoices(
            @Valid @RequestBody AdminCreateInvoiceRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        // Cross-tenant guard: the caller must belong to the institute they are billing under.
        instituteAccessValidator.validateUserAccess(userDetails, request.getInstituteId());
        // Only roles allowed to by Display Settings (learnerManagement.canApplyDiscounts).
        if (vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService
                .isRequested(request.getAdminDiscount())) {
            adminDiscountPermissionService.requireCanApplyDiscounts(userDetails, request.getInstituteId());
        }
        List<AdminInvoicePaymentLinkResponseDTO> result =
                invoiceService.createAdminInvoices(request, userDetails.getUserId());
        return ResponseEntity.ok(result);
    }

    /**
     * Non-persisting preview for the admin Create-Invoice dialog. Renders the institute's
     * invoice template with the supplied line items + overrides and returns the rendered
     * HTML plus the resolved value of every editable placeholder the template uses, so the
     * admin can review, edit the dynamic values, and see the exact invoice before creating.
     * Consumes no invoice number and writes nothing.
     *
     * POST /admin-core-service/v1/invoices/admin/preview
     */
    @PostMapping("/admin/preview")
    public ResponseEntity<vacademy.io.admin_core_service.features.invoice.dto.AdminInvoicePreviewResponseDTO> previewAdminInvoice(
            @Valid @RequestBody AdminCreateInvoiceRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        // Cross-tenant guard: preview resolves the institute's template + billed user's PII, so
        // the caller must belong to the requested institute (mirrors createAdminInvoices).
        instituteAccessValidator.validateUserAccess(userDetails, request.getInstituteId());
        return ResponseEntity.ok(invoiceService.previewAdminInvoice(request));
    }

    /**
     * Initiates gateway payment for an admin-created invoice.
     * Called when the user opens the payment link and clicks "Pay Now".
     * Returns gateway order/session details for the frontend to complete payment.
     *
     * POST /admin-core-service/v1/invoices/{invoiceId}/initiate-payment?instituteId=xxx
     */
    @PostMapping("/{invoiceId}/initiate-payment")
    public ResponseEntity<PaymentResponseDTO> initiatePaymentForAdminInvoice(
            @PathVariable String invoiceId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody(required = false) vacademy.io.common.payment.dto.PaymentInitiationRequestDTO clientData) {
        PaymentResponseDTO response = invoiceService.initiatePaymentForAdminInvoice(
                invoiceId, instituteId, userDetails, clientData);
        return ResponseEntity.ok(response);
    }

    /**
     * Edit an unpaid admin invoice in place — line items, currency, dates, notes, per-invoice
     * tax and editable template values — keeping the SAME invoice number and regenerating the
     * PDF. Only PENDING_PAYMENT invoices are editable (see the service for why).
     *
     * <p>{@code PUT /v1/invoices/{invoiceId}?instituteId=xxx}
     */
    @PutMapping("/{invoiceId}")
    @vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable(
            entityType = "INVOICE",
            action = "UPDATE",
            entityIdExpr = "#invoiceId",
            captureBefore = "@paymentDeletionService.invoiceAuditSnapshot(#invoiceId)",
            descriptionExpr = "'edited invoice ' + (#result?.body?.invoiceNumber ?: #invoiceId)")
    public ResponseEntity<InvoiceDTO> updateAdminInvoice(
            @PathVariable String invoiceId,
            @RequestParam String instituteId,
            @Valid @RequestBody vacademy.io.admin_core_service.features.invoice.dto.AdminUpdateInvoiceRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(
                invoiceService.updateAdminInvoice(invoiceId, instituteId, request, userDetails));
    }

    /**
     * Void a PENDING_PAYMENT admin invoice created in error (wrong amount, wrong
     * learner, …). Terminal — flips status to REJECTED, disables the payment link, and
     * the invoice can never be marked paid afterward. The row + PDF are kept for
     * record-keeping. To fix the mistake, the admin re-creates via "Duplicate" on the
     * frontend, which prefills a new invoice from this one's line items.
     *
     * <p>Body: {@code {"reason": "..."}} (optional).
     *
     * <p>{@code POST /v1/invoices/{invoiceId}/reject?instituteId=xxx}
     */
    @PostMapping("/{invoiceId}/reject")
    @vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable(
            entityType = "INVOICE",
            action = "CANCEL",
            entityIdExpr = "#invoiceId",
            captureBefore = "@paymentDeletionService.invoiceAuditSnapshot(#invoiceId)",
            descriptionExpr = "'cancelled invoice ' + (#result?.body?.invoiceNumber ?: #invoiceId) + (#request?.reason != null ? ': ' + #request.reason : '')")
    public ResponseEntity<InvoiceDTO> rejectInvoice(
            @PathVariable String invoiceId,
            @RequestParam String instituteId,
            @RequestBody(required = false) vacademy.io.admin_core_service.features.invoice.dto.RejectInvoiceRequestDTO request,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        String reason = request != null ? request.getReason() : null;
        return ResponseEntity.ok(invoiceService.rejectInvoice(invoiceId, instituteId, reason, userDetails));
    }

    /**
     * Permanently deletes an invoice. OFF unless the caller's role has Display Settings →
     * Learner Management → "delete payments & invoices" switched on (checked server-side). Refused
     * while a live payment is recorded against it and for live-class invoices; a bill's own
     * ledger obligation goes with it. Kept in the admin activity log (before-snapshot).
     *
     * <p>{@code DELETE /v1/invoices/{invoiceId}?instituteId=xxx}
     */
    @DeleteMapping("/{invoiceId}")
    public ResponseEntity<java.util.Map<String, Object>> deleteInvoice(
            @PathVariable String invoiceId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(paymentDeletionService.deleteInvoice(
                invoiceId, instituteId, userDetails != null ? userDetails.getUserId() : null));
    }

    /**
     * Record an offline / manual payment against a PENDING_PAYMENT admin invoice.
     * Creates a MANUAL PaymentLog (no UserPlan), links it to the invoice, flips
     * status to PAID, and sends a best-effort confirmation email.
     *
     * <p>Body: {@code {"transaction_id": "...", "notes": "..."}} (both optional).
     */
    @PostMapping("/{invoiceId}/mark-paid-manual")
    @vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable(
            entityType = "INVOICE",
            action = "STATUS_CHANGE",
            entityIdExpr = "#invoiceId",
            captureBefore = "@paymentDeletionService.invoiceAuditSnapshot(#invoiceId)",
            descriptionExpr = "'marked invoice ' + (#result?.body?.invoiceNumber ?: #invoiceId) + ' as paid (offline payment)'")
    public ResponseEntity<InvoiceDTO> markInvoicePaidManually(
            @PathVariable String invoiceId,
            @RequestBody(required = false) vacademy.io.admin_core_service.features.invoice.dto.ManualInvoicePaymentRequestDTO request,
            @RequestAttribute(value = "user", required = false) CustomUserDetails userDetails) {
        return ResponseEntity.ok(invoiceService.markInvoicePaidManually(invoiceId, request, userDetails));
    }

    /**
     * Re-send the payment-due reminder for a PENDING_PAYMENT admin invoice. Fires
     * the same in-app system alert + email the creation flow uses, but with a
     * "Reminder:" prefix so the learner can distinguish a follow-up from the
     * original bill. Both channels are best-effort; the response reports which
     * succeeded so the FE can toast precisely.
     *
     * <p>{@code POST /v1/invoices/{invoiceId}/send-reminder}
     */
    @PostMapping("/{invoiceId}/send-reminder")
    @vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable(
            entityType = "INVOICE",
            action = "SEND_MESSAGE",
            entityIdExpr = "#invoiceId",
            descriptionExpr = "'sent a payment reminder for invoice ' + #invoiceId")
    public ResponseEntity<java.util.Map<String, Object>> sendInvoiceReminder(
            @PathVariable String invoiceId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails userDetails) {
        return ResponseEntity.ok(invoiceService.sendInvoiceReminder(invoiceId, userDetails));
    }

    /**
     * Test endpoint: Manually trigger invoice generation for a payment log
     * This will group related payment logs (same vendor_id or time window) into one invoice
     * Useful for testing invoice generation without going through full payment flow
     * 
     * Usage: POST /admin-core-service/v1/invoices/test/generate/{paymentLogId}
     */
    @PostMapping("/test/generate/{paymentLogId}")
    public ResponseEntity<String> testGenerateInvoice(@PathVariable String paymentLogId) {
        try {
            return ResponseEntity.ok(invoiceService.testGenerateInvoice(paymentLogId));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error: " + e.getMessage());
        }
    }

    /**
     * Test endpoint: Generate invoice for MULTI-PACKAGE enrollment (v2 API)
     * This simulates the v2 API scenario where multiple payment logs have the same order ID
     * and should be grouped into a single invoice with multiple line items
     *
     * Usage: POST /admin-core-service/v1/invoices/test/generate-multi-package/{orderId}
     */
    @PostMapping("/test/generate-multi-package/{orderId}")
    public ResponseEntity<String> testGenerateInvoiceMultiPackage(@PathVariable String orderId) {
        try {
            return ResponseEntity.ok(invoiceService.testGenerateInvoiceForMultiPackage(orderId));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error: " + e.getMessage());
        }
    }

    /**
     * Test endpoint: Generate invoice for a SINGLE payment log only (no grouping)
     * This bypasses the grouping logic and creates an invoice for just this one payment log
     * Useful for testing single payment log scenarios
     *
     * Usage: POST /admin-core-service/v1/invoices/test/generate-single/{paymentLogId}
     */
    @PostMapping("/test/generate-single/{paymentLogId}")
    public ResponseEntity<String> testGenerateInvoiceSingle(@PathVariable String paymentLogId) {
        try {
            return ResponseEntity.ok(invoiceService.testGenerateInvoiceSingle(paymentLogId));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error: " + e.getMessage());
        }
    }
}

