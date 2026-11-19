package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
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
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

/**
 * Webhook handler for Cashfree payments.
 *
 * The goal is to mirror the behavior of {@link StripeWebHookService} and
 * {@link PhonePeWebHookService}:
 *  - Persist the incoming webhook
 *  - Resolve instituteId and our internal orderId (PaymentLog.id)
 *  - Map Cashfree order/payment status to PaymentStatusEnum
 *  - Update PaymentLog(s) and trigger post-payment logic
 */
@Slf4j
@Service
public class CashfreeWebHookService {

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

    /**
     * Process Cashfree webhook callbacks.
     *
     * @param payload          Raw JSON sent by Cashfree
     * @param signatureHeader  x-webhook-signature header
     * @param timestampHeader  x-webhook-timestamp header
     * @param instituteIdParam Optional instituteId from query param
     */
    public ResponseEntity<String> processWebHook(String payload,
                                                 String signatureHeader,
                                                 String timestampHeader,
                                                 String instituteIdParam) {
        log.info("Received Cashfree webhook payload.");
        String webhookId = null;

        try {
            // Step 1: Save webhook for audit
            webhookId = webHookService.saveWebhook(PaymentGateway.CASHFREE.name(), payload, null);

            // The order is read back from Cashfree before any status change (see
            // PaymentWebhookVerifier); the signature is checked and logged there too.
            return processVerifiedPayload(webhookId, payload, instituteIdParam,
                    new SignatureHeaders(signatureHeader, timestampHeader));

        } catch (Exception e) {
            String detailedMessage = WebHookErrorUtils.describeException(e);
            log.error("Error processing Cashfree webhook: {}", detailedMessage, e);
            if (webhookId != null) {
                webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            }
            return ResponseEntity.status(500).body("Error processing webhook");
        }
    }

    /**
     * Manually re-runs a previously persisted Cashfree webhook by id. Headers are
     * not stored, so there is no signature to check; the order read-back
     * (PaymentWebhookVerifier) runs as on live delivery.
     */
    public ResponseEntity<String> reprocessWebhook(String webhookId) {
        log.info("Manual reprocess requested for Cashfree webhookId={}", webhookId);

        var webhookOpt = webHookService.findById(webhookId);
        if (webhookOpt.isEmpty()) {
            return ResponseEntity.status(404).body("WebHook not found: " + webhookId);
        }
        var webhook = webhookOpt.get();

        if (!PaymentGateway.CASHFREE.name().equalsIgnoreCase(webhook.getVendor())) {
            return ResponseEntity.status(400)
                    .body("WebHook vendor is " + webhook.getVendor() + ", expected CASHFREE for this endpoint.");
        }

        String payload = webhook.getPayload();
        if (payload == null || payload.isBlank()) {
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED,
                    "Stored payload is empty, cannot reprocess");
            return ResponseEntity.status(400).body("Stored payload is empty for webhook " + webhookId);
        }

        webHookService.resetForReprocess(webhookId);

        try {
            // instituteIdParam is null on reprocess — service will fall back to order_tags.instituteId
            return processVerifiedPayload(webhookId, payload, null, null);
        } catch (Exception e) {
            String detailedMessage = WebHookErrorUtils.describeException(e);
            log.error("Manual reprocess failed for Cashfree webhookId={}: {}", webhookId, detailedMessage, e);
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            return ResponseEntity.status(500).body("Reprocess failed: " + detailedMessage);
        }
    }

    /**
     * Steps 2-6 of the pipeline: parse payload, extract orderId, resolve
     * instituteId, map status, update payment logs, finalize webhook row.
     * Shared between live webhook delivery and manual reprocess.
     */
    private ResponseEntity<String> processVerifiedPayload(String webhookId, String payload, String instituteIdParam,
            SignatureHeaders signatureHeaders)
            throws Exception {
        // Step 2: Parse payload
        JsonNode root = objectMapper.readTree(payload);
        JsonNode dataNode = root.path("data");

        // Cashfree payment webhooks (latest): status is in data.payment.payment_status ("SUCCESS" = PAID).
        // Older or order-level webhooks may use data.order.order_status. We support both.
        // See: https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks
        JsonNode orderNode = dataNode.path("order");
        String orderId = StringUtils.hasText(orderNode.path("order_id").asText(null))
                ? orderNode.path("order_id").asText(null)
                : orderNode.path("orderId").asText(null);
        JsonNode paymentNode = dataNode.path("payment");
        String paymentStatus = paymentNode.isMissingNode() ? null : paymentNode.path("payment_status").asText(null);
        String orderStatus = orderNode.path("order_status").asText(null);
        // Prefer payment_status (SUCCESS/FAILED); fall back to order_status (PAID/FAILED)
        String status = StringUtils.hasText(paymentStatus) ? paymentStatus : orderStatus;
        String eventType = root.path("type").asText(null);
        if (!StringUtils.hasText(status) && StringUtils.hasText(eventType)) {
            String upper = eventType.trim().toUpperCase();
            if (upper.contains("SUCCESS") || upper.contains("PAID") || "ORDER_PAID".equals(upper)
                    || "PAYMENT_SUCCESS".equals(upper) || "PAYMENT_SUCCESS_WEBHOOK".equals(upper)) {
                status = "SUCCESS";
            } else if (upper.contains("FAILED") || upper.contains("CANCELLED")) {
                status = "FAILED";
            }
        }

        if (!StringUtils.hasText(orderId)) {
            log.error("Cashfree webhook missing order_id. Payload: {}", payload);
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, "Missing order_id");
            return ResponseEntity.badRequest().body("Missing order_id");
        }

        // Step 3: Resolve instituteId
        String instituteId = instituteIdParam;
        if (!StringUtils.hasText(instituteId)) {
            JsonNode tagsNode = orderNode.path("order_tags");
            if (tagsNode.isObject()) {
                instituteId = tagsNode.path("instituteId").asText(null);
            }
        }

        if (!StringUtils.hasText(instituteId)) {
            log.warn("Cashfree webhook could not resolve instituteId for orderId={}", orderId);
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, "Missing instituteId");
            return ResponseEntity.badRequest().body("Missing instituteId");
        }

        log.info(
                "Processing Cashfree webhook for instituteId: {}, orderId: {}, status: {} (payment_status={}, order_status={}, eventType={}, webhookId={})",
                instituteId, orderId, status, paymentStatus, orderStatus, eventType, webhookId);
        if (log.isDebugEnabled()) {
            log.debug("Cashfree webhook payload snippet: {}",
                    payload.length() > 800 ? payload.substring(0, 800) + "..." : payload);
        }

        // Step 4: Map Cashfree status to internal PaymentStatusEnum (SUCCESS/PAID -> PAID, FAILED -> FAILED)
        PaymentStatusEnum mappedStatus = mapStatus(status);

        // Step 5: Update payment logs
        boolean checkAfterApply = false;
        if (mappedStatus == PaymentStatusEnum.PAID || mappedStatus == PaymentStatusEnum.FAILED) {
            PaymentWebhookVerifier.Mode mode = webhookVerifier.cashfreeMode();
            if (mode != PaymentWebhookVerifier.Mode.ENFORCE) {
                // Log mode: applied exactly as before; the gateway read-back runs after the
                // webhook is processed, off this thread, and only writes log lines.
                paymentLogService.updatePaymentLogsByOrderId(orderId, mappedStatus.name(), instituteId);
                checkAfterApply = true;
            } else {
                PaymentWebhookVerifier.Outcome outcome;
                try {
                    outcome = webhookVerifier.verifyCashfree(orderId, mappedStatus);
                    if (signatureHeaders != null) {
                        webhookVerifier.checkCashfreeSignature(
                                outcome.instituteId() != null ? outcome.instituteId() : instituteId,
                                signatureHeaders.timestamp(), signatureHeaders.signature(), payload, orderId);
                    }
                    webhookVerifier.report(PaymentGateway.CASHFREE.name(), mode, webhookId, orderId, mappedStatus,
                            outcome, instituteId);
                } catch (Exception e) {
                    log.warn("WEBHOOK_VERIFY vendor=CASHFREE orderId={} check failed: {}", orderId, e.getMessage());
                    outcome = new PaymentWebhookVerifier.Outcome(PaymentWebhookVerifier.Result.FETCH_ERROR, null, null);
                }

                if (!outcome.ok()) {
                    webHookService.updateWebHook(webhookId, payload, orderId, eventType);
                    webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED,
                            "Not applied, gateway check: " + outcome.result().code());
                    if (outcome.retryable()) {
                        return ResponseEntity.status(503).body("Payment could not be confirmed yet");
                    }
                    return ResponseEntity.ok("IGNORED");
                }
                paymentLogService.updatePaymentLogsForWebhook(orderId, PaymentGateway.CASHFREE.name(),
                        mappedStatus.name(), outcome.instituteId());
            }
            log.info("Cashfree webhook updated payment log(s) for orderId={} to {}", orderId, mappedStatus.name());
        } else {
            log.info("Cashfree status {} treated as PAYMENT_PENDING for orderId={} (no update)", status, orderId);
        }

        // Step 6: Mark webhook as processed
        webHookService.updateWebHook(webhookId, payload, orderId, root.path("type").asText(null));
        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED, null);

        if (checkAfterApply) {
            try {
                webhookVerifier.checkCashfreeAfterApply(webhookId, orderId, mappedStatus, instituteId,
                        signatureHeaders != null,
                        signatureHeaders != null ? signatureHeaders.signature() : null,
                        signatureHeaders != null ? signatureHeaders.timestamp() : null,
                        payload);
            } catch (Exception e) {
                log.warn("WEBHOOK_VERIFY vendor=CASHFREE orderId={} check not started: {}", orderId, e.getMessage());
            }
        }

        return ResponseEntity.ok("SUCCESS");
    }

    private PaymentStatusEnum mapStatus(String orderStatus) {
        if (!StringUtils.hasText(orderStatus)) {
            return PaymentStatusEnum.PAYMENT_PENDING;
        }
        String normalized = orderStatus.trim().toUpperCase();
        if ("PAID".equals(normalized) || "SUCCESS".equals(normalized)) {
            return PaymentStatusEnum.PAID;
        }
        if ("FAILED".equals(normalized) || "CANCELLED".equals(normalized) || "CANCELED".equals(normalized)) {
            return PaymentStatusEnum.FAILED;
        }
        return PaymentStatusEnum.PAYMENT_PENDING;
    }

    /** Cashfree's signature headers of a live delivery (none on reprocess). */
    private record SignatureHeaders(String signature, String timestamp) {
    }
}
