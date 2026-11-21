package vacademy.io.admin_core_service.features.payments.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.payments.entity.WebHook;
import vacademy.io.admin_core_service.features.payments.service.CashfreeWebHookService;
import vacademy.io.admin_core_service.features.payments.service.EwayPoolingService;
import vacademy.io.admin_core_service.features.payments.service.PhonePeWebHookService;
import vacademy.io.admin_core_service.features.payments.service.RazorpayWebHookService;
import vacademy.io.admin_core_service.features.payments.service.StripeWebHookService;
import vacademy.io.admin_core_service.features.payments.service.WebHookService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.payment.enums.PaymentGateway;

import java.util.Optional;

@RestController
@RequestMapping("/admin-core-service/payments")
public class WebHookController {
    @Autowired
    private StripeWebHookService stripeWebHookService;

    @Autowired
    private RazorpayWebHookService razorpayWebHookService;

    @Autowired
    private EwayPoolingService ewayPoolingService;

    @Autowired
    private PhonePeWebHookService phonePeWebHookService;

    @Autowired
    private CashfreeWebHookService cashfreeWebHookService;

    @Autowired
    private WebHookService webHookService;

    @PostMapping("/webhook/callback/stripe")
    public ResponseEntity<String> handleStripeWebhook(
            @RequestBody String payload,
            @RequestHeader("Stripe-Signature") String sigHeader) {

        return stripeWebHookService.processWebHook(payload, sigHeader);
    }

    @PostMapping("/webhook/callback/razorpay")
    public ResponseEntity<String> handleRazorpayWebhook(
            @RequestBody String payload,
            @RequestHeader("X-Razorpay-Signature") String signature) {

        return razorpayWebHookService.processWebHook(payload, signature);
    }

    @PostMapping("/webhook/callback/phonepe")
    public ResponseEntity<String> handlePhonePeWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @RequestParam(value = "instituteId", required = false) String instituteId) {

        return phonePeWebHookService.processWebHook(payload, authHeader, instituteId);
    }

    @PostMapping("/webhook/callback/cashfree")
    public ResponseEntity<String> handleCashfreeWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "x-webhook-signature", required = false) String signature,
            @RequestHeader(value = "x-webhook-timestamp", required = false) String timestamp,
            @RequestParam(value = "instituteId", required = false) String instituteId) {

        return cashfreeWebHookService.processWebHook(payload, signature, timestamp, instituteId);
    }

    /**
     * Manually reprocess a previously persisted webhook of any supported gateway
     * by id. Use when a webhook ended up in FAILED state due to a transient
     * post-payment error and the underlying issue has since been fixed — replays
     * the stored payload through the same processing pipeline so payment_log
     * status and downstream side effects get a second chance to apply.
     *
     * Routes to the right gateway service based on the stored {@code vendor}
     * column on the WebHook row. Signature is not re-verified for any vendor
     * (it was checked when the webhook was first received). On failure,
     * {@code web_hook.error_message} is updated with a descriptive root cause.
     *
     * Authenticated endpoint — not in ALLOWED_PATHS, so it falls back to the
     * standard JWT auth filter — for platform super admins on the
     * SUPER_ADMIN_USER_IDS allowlist only (operations use it from the command line).
     */
    @PostMapping("/webhook/reprocess/{webhookId}")
    public ResponseEntity<String> reprocessWebhook(@PathVariable("webhookId") String webhookId,
            @RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Optional<WebHook> webhookOpt = webHookService.findById(webhookId);
        if (webhookOpt.isEmpty()) {
            return ResponseEntity.status(404).body("WebHook not found: " + webhookId);
        }
        String vendor = webhookOpt.get().getVendor();
        if (vendor == null) {
            return ResponseEntity.status(400).body("WebHook " + webhookId + " has no vendor recorded");
        }

        String normalized = vendor.trim().toUpperCase();
        if (PaymentGateway.RAZORPAY.name().equals(normalized)) {
            return razorpayWebHookService.reprocessWebhook(webhookId);
        }
        if (PaymentGateway.STRIPE.name().equals(normalized)) {
            return stripeWebHookService.reprocessWebhook(webhookId);
        }
        if (PaymentGateway.PHONEPE.name().equals(normalized)) {
            return phonePeWebHookService.reprocessWebhook(webhookId);
        }
        if (PaymentGateway.CASHFREE.name().equals(normalized)) {
            return cashfreeWebHookService.reprocessWebhook(webhookId);
        }
        return ResponseEntity.status(400)
                .body("Reprocess not supported for vendor: " + vendor);
    }

}
