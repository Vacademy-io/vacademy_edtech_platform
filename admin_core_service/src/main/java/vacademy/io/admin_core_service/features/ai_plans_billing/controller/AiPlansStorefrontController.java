package vacademy.io.admin_core_service.features.ai_plans_billing.controller;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient.Json;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService.PayRequest;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Tenant facade for paid AI plans: the storefront, billing profile, checkout (payment link or
 * autopay registration), plan changes, autopay, invoices and credit notes.
 *
 * <pre>
 *   GET  /admin-core-service/ai-plans/v1/storefront?instituteId=
 *   PUT  /admin-core-service/ai-plans/v1/billing-profile          {institute_id, legal_name, gstin?, state_code, address?, billing_email?}
 *   POST /admin-core-service/ai-plans/v1/checkout                 {institute_id, plan_version_id, autopay, autopay_method?, contact?, return_url, idempotency_key}
 *        -> {mode: LINK|MANDATE|APPLIED, url, platform_payment_id, total_minor, link_expires_at}
 *   POST /admin-core-service/ai-plans/v1/change                   {institute_id, action UPGRADE|DOWNGRADE|CANCEL|RESUME, plan_version_id?, return_url?, dry_run?}
 *   POST /admin-core-service/ai-plans/v1/charges/{chargeId}/pay   {institute_id, return_url?}
 *   GET  /admin-core-service/ai-plans/v1/orders/{ppId}/status?instituteId=
 *   GET  /admin-core-service/ai-plans/v1/invoices?instituteId=    invoices (both kinds) + credit notes
 *   GET  /admin-core-service/ai-plans/v1/invoices/{id}/pdf?instituteId=
 *   GET  /admin-core-service/ai-plans/v1/credit-notes/{id}/pdf?instituteId=
 *   POST /admin-core-service/ai-plans/v1/mandate/setup            {institute_id, method UPI|CARD, contact?, return_url?}
 *   POST /admin-core-service/ai-plans/v1/mandate/cancel           {institute_id, reason?}
 * </pre>
 *
 * Every call needs an ADMIN of that institute ({@code requireInstituteAdmin}, no root-user
 * bypass), and every call answers 404 STOREFRONT_OFF unless {@code billing.storefront.mode}
 * opens the storefront for this institute (sub-org children never; see
 * {@code StorefrontAccessService}). Writes that move money also need
 * {@code billing.subscriptions.payments.enabled} (409 PAYMENTS_DISABLED).
 */
@RestController
@RequestMapping("/admin-core-service/ai-plans/v1")
public class AiPlansStorefrontController {

    private final AiSubscriptionBillingService billing;
    private final InstituteAccessValidator access;

    public AiPlansStorefrontController(AiSubscriptionBillingService billing, InstituteAccessValidator access) {
        this.billing = billing;
        this.access = access;
    }

    @GetMapping("/storefront")
    public ResponseEntity<Map<String, Object>> storefront(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.storefront(instituteId));
    }

    @PutMapping("/billing-profile")
    public ResponseEntity<Map<String, Object>> saveBillingProfile(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody Map<String, Object> body) {
        String instituteId = institute(body);
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.saveBillingProfile(instituteId, body, user.getUserId()));
    }

    @PostMapping("/checkout")
    public ResponseEntity<Map<String, Object>> checkout(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyHeader,
            @RequestBody Map<String, Object> body) {
        String instituteId = institute(body);
        access.requireInstituteAdmin(user, instituteId);
        String key = StringUtils.hasText(idempotencyHeader) ? idempotencyHeader
                : Json.str(body, "idempotency_key", "idempotencyKey");
        PayRequest req = new PayRequest(
                Json.str(body, "plan_version_id", "planVersionId"),
                Json.bool(body, "autopay"),
                Json.str(body, "autopay_method", "autopayMethod", "method"),
                Json.str(body, "contact"),
                Json.str(body, "return_url", "returnUrl"),
                key);
        return ResponseEntity.ok(billing.checkout(instituteId, req, user.getUserId(), user.getEmail()));
    }

    @PostMapping("/change")
    public ResponseEntity<Map<String, Object>> change(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody Map<String, Object> body) {
        String instituteId = institute(body);
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.change(instituteId, Json.str(body, "action"),
                Json.str(body, "plan_version_id", "planVersionId"), Json.str(body, "return_url", "returnUrl"),
                Json.bool(body, "dry_run", "dryRun"), user.getUserId(), user.getEmail()));
    }

    @PostMapping("/charges/{chargeId}/pay")
    public ResponseEntity<Map<String, Object>> payCharge(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("chargeId") String chargeId, @RequestBody Map<String, Object> body) {
        String instituteId = institute(body);
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.payCharge(instituteId, chargeId, Json.str(body, "return_url", "returnUrl"),
                user.getUserId(), user.getEmail()));
    }

    @GetMapping("/orders/{platformPaymentId}/status")
    public ResponseEntity<Map<String, Object>> orderStatus(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("platformPaymentId") String platformPaymentId,
            @RequestParam("instituteId") String instituteId) {
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.orderStatus(instituteId, platformPaymentId));
    }

    @GetMapping("/invoices")
    public ResponseEntity<Map<String, Object>> documents(@RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        access.requireInstituteAdmin(user, instituteId);
        List<Map<String, Object>> docs = billing.documents(instituteId);
        return ResponseEntity.ok(Map.of("documents", docs));
    }

    @GetMapping(value = "/invoices/{invoiceId}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> invoicePdf(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("invoiceId") String invoiceId, @RequestParam("instituteId") String instituteId) {
        access.requireInstituteAdmin(user, instituteId);
        PlatformInvoice inv = billing.ownInvoice(instituteId, invoiceId);
        return pdf(billing.invoicePdf(inv), billing.invoiceFileName(inv));
    }

    @GetMapping(value = "/credit-notes/{creditNoteId}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> creditNotePdf(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable("creditNoteId") String creditNoteId, @RequestParam("instituteId") String instituteId) {
        access.requireInstituteAdmin(user, instituteId);
        PlatformCreditNote cn = billing.ownCreditNote(instituteId, creditNoteId);
        return pdf(billing.creditNotePdf(cn), billing.creditNoteFileName(cn));
    }

    @PostMapping("/mandate/setup")
    public ResponseEntity<Map<String, Object>> setupMandate(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody Map<String, Object> body) {
        String instituteId = institute(body);
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.setupMandate(instituteId, Json.str(body, "method", "autopay_method"),
                Json.str(body, "contact"), Json.str(body, "return_url", "returnUrl"), user.getUserId(),
                user.getEmail()));
    }

    @PostMapping("/mandate/cancel")
    public ResponseEntity<Map<String, Object>> cancelMandate(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody Map<String, Object> body) {
        String instituteId = institute(body);
        access.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(billing.cancelMandate(instituteId, Json.str(body, "reason")));
    }

    static String institute(Map<String, Object> body) {
        String id = Json.str(body, "institute_id", "instituteId");
        if (!StringUtils.hasText(id)) {
            throw new AiPlansBillingException(HttpStatus.BAD_REQUEST, AiPlansBillingException.INVALID_REQUEST,
                    "institute_id is required");
        }
        return id.trim();
    }

    private static ResponseEntity<byte[]> pdf(byte[] bytes, String fileName) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(fileName).build());
        headers.setCacheControl("private, no-store");
        return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
    }
}
