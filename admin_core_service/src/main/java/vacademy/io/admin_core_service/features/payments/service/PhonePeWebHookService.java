package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.payments.util.WebHookErrorUtils;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.payment.dto.PhonePeWebHookDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
 
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

@Slf4j
@Service
public class PhonePeWebHookService {

    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;

    @Autowired
    private WebHookService webHookService;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PaymentWebhookVerifier webhookVerifier;

    public ResponseEntity<String> processWebHook(String payload, String authHeader, String instituteIdParam) {
        log.info("Received PhonePe webhook callback.");
        String webhookId = null;

        try {
            // Step 2: Save webhook for audit (parse-failures will surface in catch with
            // descriptive message)
            webhookId = webHookService.saveWebhook(PaymentGateway.PHONEPE.name(), payload, null);

            // Step 4: Signature verification happens inside processVerifiedPayload,
            // once the instituteId (and thus the webhook credentials) is resolved.
            return processVerifiedPayload(webhookId, payload, authHeader, instituteIdParam, true);

        } catch (Exception e) {
            String detailedMessage = WebHookErrorUtils.describeException(e);
            log.error("Error processing PhonePe webhook: {}", detailedMessage, e);
            if (webhookId != null) {
                webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            }
            return ResponseEntity.status(500).body("Error processing webhook");
        }
    }

    /**
     * Manually re-runs a previously persisted PhonePe webhook by id. The stored
     * row has no Authorization header to check; the status read-back
     * (PaymentWebhookVerifier) runs as on live delivery.
     */
    public ResponseEntity<String> reprocessWebhook(String webhookId) {
        log.info("Manual reprocess requested for PhonePe webhookId={}", webhookId);

        var webhookOpt = webHookService.findById(webhookId);
        if (webhookOpt.isEmpty()) {
            return ResponseEntity.status(404).body("WebHook not found: " + webhookId);
        }
        var webhook = webhookOpt.get();

        if (!PaymentGateway.PHONEPE.name().equalsIgnoreCase(webhook.getVendor())) {
            return ResponseEntity.status(400)
                    .body("WebHook vendor is " + webhook.getVendor() + ", expected PHONEPE for this endpoint.");
        }

        String payload = webhook.getPayload();
        if (payload == null || payload.isBlank()) {
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED,
                    "Stored payload is empty, cannot reprocess");
            return ResponseEntity.status(400).body("Stored payload is empty for webhook " + webhookId);
        }

        webHookService.resetForReprocess(webhookId);

        try {
            // instituteIdParam is null on reprocess — service will fall back to metaInfo.udf1.
            // Signature was already verified on first delivery, so skip it on reprocess.
            return processVerifiedPayload(webhookId, payload, null, null, false);
        } catch (Exception e) {
            String detailedMessage = WebHookErrorUtils.describeException(e);
            log.error("Manual reprocess failed for PhonePe webhookId={}: {}", webhookId, detailedMessage, e);
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            return ResponseEntity.status(500).body("Reprocess failed: " + detailedMessage);
        }
    }

    /**
     * Steps 1, 3, 4, 5, 6 of the pipeline — payload parse, instituteId resolution,
     * signature verification, event handling, and webhook-row finalization. Shared
     * between live webhook delivery ({@code verifySignature=true}) and manual
     * reprocess ({@code verifySignature=false}).
     */
    private ResponseEntity<String> processVerifiedPayload(String webhookId, String payload, String authHeader,
            String instituteIdParam, boolean verifySignature)
            throws Exception {
        // Step 1: Parse payload
        PhonePeWebHookDTO webhookDTO = objectMapper.readValue(payload, PhonePeWebHookDTO.class);
        String merchantOrderId = webhookDTO.getPayload().getMerchantOrderId();
        String event = webhookDTO.getEvent();

        // Step 3: Extract instituteId - prioritize query parameter over metaInfo
        String instituteId = instituteIdParam;

        if (instituteId == null || instituteId.isEmpty()) {
            // Fallback: Try to get from metaInfo (udf1) if not in query param
            instituteId = webhookDTO.getPayload().getMetaInfo() != null
                    ? webhookDTO.getPayload().getMetaInfo().get("udf1")
                    : null;
        }

        if (instituteId == null || instituteId.isEmpty()) {
            log.error("Webhook missing instituteId. Cannot process payment update.");
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, "Missing instituteId");
            return ResponseEntity.status(400).body("Missing instituteId");
        }

        // Step 4: Verify the SHA256(username:password) signature PhonePe sends in
        // the Authorization header — but only when webhook credentials have been
        // configured for this institute (opt-in). If none are set we skip, so
        // existing setups without credentials keep working unchanged.
        if (verifySignature && !isSignatureAcceptable(authHeader, instituteId)) {
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, "Signature verification failed");
            return ResponseEntity.status(401).body("Invalid webhook signature");
        }

        log.info("Processing PhonePe webhook for instituteId: {}, orderId: {} (webhookId={})", instituteId,
                merchantOrderId, webhookId);

        // Step 5: Handle events
        EventResult handled = handleEvent(webhookId, payload, webhookDTO, instituteId);
        if (handled.notApplied() != null) {
            return handled.notApplied();
        }

        // Step 6: Mark as processed
        webHookService.updateWebHook(webhookId, payload, merchantOrderId, event);
        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED, null);

        if (handled.checkAfterApply() != null) {
            try {
                webhookVerifier.checkPhonePeAfterApply(webhookId, merchantOrderId, handled.checkAfterApply(),
                        instituteId);
            } catch (Exception e) {
                log.warn("WEBHOOK_VERIFY vendor=PHONEPE orderId={} check not started: {}", merchantOrderId,
                        e.getMessage());
            }
        }

        return ResponseEntity.ok("SUCCESS");
    }

    /**
     * What {@link #handleEvent} did: {@code notApplied} is the response to send when enforced
     * verification kept the event from being applied (else null); {@code checkAfterApply} is
     * the claimed status to read back from PhonePe after processing, in log mode (else null).
     */
    private record EventResult(ResponseEntity<String> notApplied, PaymentStatusEnum checkAfterApply) {
        static final EventResult DONE = new EventResult(null, null);
    }

    /**
     * Applies a completed/failed event to the order's payment logs. In log mode this is the
     * previous handling, unchanged, and the read-back is left for after processing; in enforce
     * mode the event is applied only when PhonePe confirms it.
     */
    private EventResult handleEvent(String webhookId, String payload, PhonePeWebHookDTO webhookDTO,
            String instituteId) {
        String event = webhookDTO.getEvent();
        String merchantOrderId = webhookDTO.getPayload().getMerchantOrderId();
        String state = webhookDTO.getPayload().getState();

        log.info("Handling PhonePe event: {} for order: {} with state: {}", event, merchantOrderId, state);

        PaymentStatusEnum claimed = null;
        if ("checkout.order.completed".equals(event) || "pg.order.completed".equals(event)
                || "COMPLETED".equalsIgnoreCase(state)) {
            log.info("Payment completed for order: {}", merchantOrderId);
            claimed = PaymentStatusEnum.PAID;
        } else if ("checkout.order.failed".equals(event) || "pg.order.failed".equals(event)
                || "FAILED".equalsIgnoreCase(state)) {
            log.warn("Payment failed for order: {}", merchantOrderId);
            claimed = PaymentStatusEnum.FAILED;
        } else if ("pg.refund.completed".equals(event)) {
            log.info("Refund completed for order: {}", merchantOrderId);
            // Implement refund status update if needed
        }
        if (claimed == null) {
            return EventResult.DONE;
        }

        PaymentWebhookVerifier.Mode mode = webhookVerifier.phonePeMode();
        if (mode != PaymentWebhookVerifier.Mode.ENFORCE) {
            paymentLogService.updatePaymentLogsByOrderId(merchantOrderId, claimed.name(), instituteId);
            return new EventResult(null, claimed);
        }

        PaymentWebhookVerifier.Outcome outcome;
        try {
            outcome = webhookVerifier.verifyPhonePe(merchantOrderId, claimed);
            webhookVerifier.report(PaymentGateway.PHONEPE.name(), mode, webhookId, merchantOrderId, claimed,
                    outcome, instituteId);
        } catch (Exception e) {
            log.warn("WEBHOOK_VERIFY vendor=PHONEPE orderId={} check failed: {}", merchantOrderId, e.getMessage());
            outcome = new PaymentWebhookVerifier.Outcome(PaymentWebhookVerifier.Result.FETCH_ERROR, null, null);
        }
        if (!outcome.ok()) {
            webHookService.updateWebHook(webhookId, payload, merchantOrderId, event);
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED,
                    "Not applied, gateway check: " + outcome.result().code());
            if (outcome.retryable()) {
                return new EventResult(ResponseEntity.status(503).body("Payment could not be confirmed yet"), null);
            }
            return new EventResult(ResponseEntity.ok("IGNORED"), null);
        }
        paymentLogService.updatePaymentLogsForWebhook(merchantOrderId, PaymentGateway.PHONEPE.name(),
                claimed.name(), outcome.instituteId());
        return EventResult.DONE;
    }

    /**
     * Validates the PhonePe webhook Authorization header, which is
     * {@code SHA256(username:password)} (hex) of the credentials configured on
     * both the PhonePe dashboard and our gateway mapping.
     *
     * <p>Opt-in: if no webhook credentials are configured for the institute we
     * return {@code true} (skip), preserving behaviour for setups that haven't
     * set them yet. When credentials ARE configured, a missing or mismatched
     * header is rejected.
     */
    private boolean isSignatureAcceptable(String authHeader, String instituteId) {
        try {
            Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData(PaymentGateway.PHONEPE.name(), instituteId);
            String username = gatewayData != null ? (String) gatewayData.get("webhookUsername") : null;
            String password = gatewayData != null ? (String) gatewayData.get("webhookPassword") : null;

            if (!StringUtils.hasText(username) || !StringUtils.hasText(password)) {
                log.warn("No PhonePe webhook credentials configured for institute {} — skipping signature verification",
                        instituteId);
                return true;
            }

            if (!StringUtils.hasText(authHeader)) {
                log.error("PhonePe webhook missing Authorization header but credentials are configured for institute {}",
                        instituteId);
                return false;
            }

            String input = username + ":" + password;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] encodedhash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            String expectedAuth = bytesToHex(encodedhash);

            // Per docs: Authorization: SHA256(username:password), hex-encoded. Compared
            // in constant time, case-insensitively as before (expectedAuth is lower case).
            boolean matches = MessageDigest.isEqual(
                    expectedAuth.getBytes(StandardCharsets.UTF_8),
                    authHeader.trim().toLowerCase(java.util.Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            if (!matches) {
                log.error("PhonePe webhook signature mismatch for institute {}", instituteId);
            }
            return matches;

        } catch (Exception e) {
            log.error("Error verifying PhonePe webhook signature for institute {}", instituteId, e);
            return false;
        }
    }

    private String bytesToHex(byte[] hash) {
        StringBuilder hexString = new StringBuilder(2 * hash.length);
        for (byte b : hash) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
}