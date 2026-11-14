package vacademy.io.admin_core_service.features.invoice.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.dto.PublicInvoiceListResponse;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

/**
 * Public (no-auth) invoice endpoints.
 * Mapped under /open/** which is in ALLOWED_PATHS in ApplicationSecurityConfig.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/invoices")
public class OpenInvoiceController {

    @Autowired
    private InvoiceService invoiceService;

    /**
     * Fetch invoice details by ID without authentication.
     * Used by the learner's shareable payment link page (/pay/invoice/{invoiceId}).
     */
    @GetMapping("/{invoiceId}")
    public ResponseEntity<InvoiceDTO> getInvoicePublic(@PathVariable String invoiceId) {
        InvoiceDTO invoice = invoiceService.getInvoiceById(invoiceId);
        // Public (learner payment link): never expose the admin's discount notes.
        return ResponseEntity.ok(invoice.withoutInternalDiscountNotes());
    }

    /**
     * Initiate gateway payment for an admin-created invoice without authentication.
     * The invoice already contains the user_id, so no session is required.
     * Used by the shareable invoice payment link (/pay/invoice/{invoiceId}).
     */
    @PostMapping("/{invoiceId}/initiate-payment")
    public ResponseEntity<PaymentResponseDTO> initiatePaymentPublic(
            @PathVariable String invoiceId,
            @RequestParam String instituteId,
            @RequestBody(required = false) vacademy.io.common.payment.dto.PaymentInitiationRequestDTO clientData) {
        // Body is the vendor-specific data the page collected (Stripe payment_method_id,
        // eWay encrypted card, redirect URLs). Amount/currency/vendor are always taken
        // from the invoice + institute config server-side, never from this body.
        PaymentResponseDTO response = invoiceService.initiatePaymentForAdminInvoice(
                invoiceId, instituteId, null, clientData);
        return ResponseEntity.ok(response);
    }

    /**
     * Fetch all invoices for a user identified by email address.
     * No authentication required — designed for WordPress shortcode / PHP snippet integration.
     * Returns an empty list (not 404) when the email has no matching user or invoices.
     *
     * @param email       User's email address (case-insensitive)
     * @param instituteId Optional — narrows results to a specific institute
     */
    @GetMapping("/by-email")
    public ResponseEntity<PublicInvoiceListResponse> getInvoicesByEmail(
            @RequestParam String email,
            @RequestParam(required = false) String instituteId) {
        PublicInvoiceListResponse response = invoiceService.getInvoicesByEmailPublic(email, instituteId);
        return ResponseEntity.ok(response);
    }
}
