package vacademy.io.admin_core_service.features.ai_plans_billing.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient.Json;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionOpsService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;
import java.util.Map;

/**
 * Super-admin (portal) money actions on AI plan billing (design §7.3). Every write needs a
 * {@code reason} (at least 3 characters) and is logged with the acting user.
 *
 * <pre>
 *   GET  /admin-core-service/super-admin/v1/ai-plans-billing/institutes/{iid}/billing
 *   POST .../institutes/{iid}/charges/{cid}/mark-paid     {reference, amount_minor, reason}   offline / bank transfer
 *   POST .../institutes/{iid}/charges/{cid}/waive         {reason}                            no invoice (no consideration)
 *   POST .../institutes/{iid}/charges/{cid}/resend-link   {reason?}
 *   POST .../institutes/{iid}/payments/{ppId}/refund      {amount_minor?, reason}             credit note follows the refund webhook
 *   POST .../institutes/{iid}/mandates/{mid}/cancel       {reason}
 *   GET  .../institutes/{iid}/documents                   invoices (both kinds) + credit notes
 *   GET  .../institutes/{iid}/invoices/{id}/pdf
 *   GET  .../institutes/{iid}/credit-notes/{id}/pdf
 * </pre>
 * The document reads ignore the storefront rollout gate (staff see every institute).
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/ai-plans-billing")
public class AiPlansBillingOpsController {

    private final AiSubscriptionOpsService ops;
    private final AiSubscriptionBillingService billing;

    public AiPlansBillingOpsController(AiSubscriptionOpsService ops, AiSubscriptionBillingService billing) {
        this.ops = ops;
        this.billing = billing;
    }

    @GetMapping("/institutes/{instituteId}/billing")
    public ResponseEntity<Map<String, Object>> billing(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(ops.billingTimeline(instituteId));
    }

    @PostMapping("/institutes/{instituteId}/charges/{chargeId}/mark-paid")
    public ResponseEntity<Map<String, Object>> markPaid(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("chargeId") String chargeId,
            @RequestBody Map<String, Object> body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Long amount = Json.lng(body, "amount_minor", "amountMinor");
        if (amount == null) {
            throw AiPlansBillingException.invalid("amount_minor is required");
        }
        log.warn("[ai-plans-billing] ops mark-paid charge={} institute={} by {}", chargeId, instituteId,
                user.getUserId());
        // paid_at (when the money reached the bank) is recorded in the audit log line only; the
        // period starts at the time it is marked paid, as for an online payment.
        String reason = Json.str(body, "reason");
        String paidAt = Json.str(body, "paid_at", "paidAt");
        if (reason != null && paidAt != null) {
            reason = reason + " (received " + paidAt + ")";
        }
        return ResponseEntity.ok(ops.markPaidOffline(instituteId, chargeId, Json.str(body, "reference", "external_ref"),
                amount, reason, actor(user)));
    }

    @PostMapping("/institutes/{instituteId}/charges/{chargeId}/waive")
    public ResponseEntity<Map<String, Object>> waive(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("chargeId") String chargeId,
            @RequestBody Map<String, Object> body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        log.warn("[ai-plans-billing] ops waive charge={} institute={} by {}", chargeId, instituteId, user.getUserId());
        return ResponseEntity.ok(ops.waive(instituteId, chargeId, Json.str(body, "reason"), actor(user)));
    }

    @PostMapping("/institutes/{instituteId}/charges/{chargeId}/resend-link")
    public ResponseEntity<Map<String, Object>> resendLink(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("chargeId") String chargeId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        log.info("[ai-plans-billing] ops resend-link charge={} institute={} by {}", chargeId, instituteId,
                user.getUserId());
        return ResponseEntity.ok(ops.resendLink(instituteId, chargeId, actor(user)));
    }

    @PostMapping("/institutes/{instituteId}/payments/{platformPaymentId}/refund")
    public ResponseEntity<Map<String, Object>> refund(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @PathVariable("platformPaymentId") String platformPaymentId, @RequestBody Map<String, Object> body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        log.warn("[ai-plans-billing] ops refund payment={} institute={} by {}", platformPaymentId, instituteId,
                user.getUserId());
        return ResponseEntity.ok(ops.refund(instituteId, platformPaymentId, Json.lng(body, "amount_minor", "amountMinor"),
                Json.str(body, "reason"), actor(user)));
    }

    /** Staff credit note against an AI-plan invoice (offline refund, waiver after invoicing); body {amount_minor, reason}. */
    @PostMapping("/institutes/{instituteId}/invoices/{invoiceId}/credit-note")
    public ResponseEntity<Map<String, Object>> staffCreditNote(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("invoiceId") String invoiceId,
            @RequestBody Map<String, Object> body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Long amount = Json.lng(body, "amount_minor", "amountMinor");
        if (amount == null) {
            throw AiPlansBillingException.invalid("amount_minor is required");
        }
        log.warn("[ai-plans-billing] ops credit-note invoice={} institute={} amount={} by {}", invoiceId, instituteId,
                amount, user.getUserId());
        return ResponseEntity.ok(ops.staffCreditNote(instituteId, invoiceId, amount, Json.str(body, "reason"),
                actor(user)));
    }

    @PostMapping("/institutes/{instituteId}/mandates/{mandateId}/cancel")
    public ResponseEntity<Map<String, Object>> cancelMandate(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("mandateId") String mandateId,
            @RequestBody Map<String, Object> body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        log.warn("[ai-plans-billing] ops cancel mandate={} institute={} by {}", mandateId, instituteId,
                user.getUserId());
        return ResponseEntity.ok(ops.cancelMandate(instituteId, mandateId, Json.str(body, "reason"), actor(user)));
    }

    @GetMapping("/institutes/{instituteId}/documents")
    public ResponseEntity<Map<String, Object>> documents(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        List<Map<String, Object>> docs = billing.listDocuments(instituteId);
        return ResponseEntity.ok(Map.of("documents", docs));
    }

    @GetMapping(value = "/institutes/{instituteId}/invoices/{invoiceId}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> invoicePdf(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("invoiceId") String invoiceId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        PlatformInvoice inv = billing.invoiceOf(instituteId, invoiceId);
        return pdf(billing.invoicePdf(inv), billing.invoiceFileName(inv));
    }

    @GetMapping(value = "/institutes/{instituteId}/credit-notes/{creditNoteId}/pdf",
            produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> creditNotePdf(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId, @PathVariable("creditNoteId") String creditNoteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        PlatformCreditNote cn = billing.creditNoteOf(instituteId, creditNoteId);
        return pdf(billing.creditNotePdf(cn), billing.creditNoteFileName(cn));
    }

    private static ResponseEntity<byte[]> pdf(byte[] bytes, String fileName) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(fileName).build());
        headers.setCacheControl("private, no-store");
        return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
    }

    static String actor(CustomUserDetails user) {
        return "staff:" + user.getUserId();
    }
}
