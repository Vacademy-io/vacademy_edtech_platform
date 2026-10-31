package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.payments.util.WebHookErrorUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;
import vacademy.io.common.payment.currency.CurrencyRegistry;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalPaymentService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeLedgerAllocationService;
import vacademy.io.admin_core_service.features.fee_management.service.SchoolFeeReceiptService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.common.logging.SentryLogger;
import org.json.JSONArray;
import org.json.JSONObject;

import java.math.BigDecimal;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

@Slf4j
@Service
public class RazorpayWebHookService {

    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;

    @Autowired
    private WebHookService webHookService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private UserInstitutePaymentGatewayMappingService userInstitutePaymentGatewayMappingService;

    @Autowired
    private vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager razorpayPaymentManager;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private RenewalPaymentService renewalPaymentService;

    @Autowired
    private vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService planChangeService;

    @Autowired
    private FeeLedgerAllocationService feeLedgerAllocationService;

    @Autowired
    private SchoolFeeReceiptService schoolFeeReceiptService;

    @Autowired
    private vacademy.io.admin_core_service.features.invoice.service.InvoiceService invoiceService;

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.service.ApplicationFeeReceiptService applicationFeeReceiptService;

    @Autowired
    private vacademy.io.admin_core_service.features.auth_service.service.AuthService authService;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository paymentOptionRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService platformRazorpayWebHookService;

    /** Present once AI-plan autopay ships; recognises the platform's mandate tokens. */
    @Autowired
    private org.springframework.beans.factory.ObjectProvider<vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler> subscriptionPaymentHandler;

    /** Finds platform orders whose payments carry no notes (autopay registration links). */
    @Autowired
    private vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository platformPaymentRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;

    /**
     * Processes Razorpay webhook events
     */
    public ResponseEntity<String> processWebHook(String payload, String signature) {
        log.info("Received Razorpay webhook payload.");
        String webhookId = null;

        try {
            // Step 0: AI credit-pack purchases are paid on the PLATFORM Razorpay
            // account, not the institute's — they carry notes.payment_type =
            // AI_CREDIT_PACK and are signed with the platform webhook secret. They
            // still carry notes.instituteId (the buyer), so if the platform account
            // has this URL registered they land here and fail signature verification
            // against the institute's secret 100% of the time. Hand them to the
            // platform handler, which verifies against the right secret and grants
            // the credits. Routed before persistence — the platform handler saves its
            // own web_hook row with vendor='RAZORPAY_PLATFORM'. AI_SUBSCRIPTION payments and
            // the platform's autopay token.* events (no notes, matched by token id) go the same way.
            if (isPlatformCreditPackEvent(payload)) {
                log.info("Razorpay webhook is a platform (AI credit pack / AI plan) event — delegating to platform handler.");
                return platformRazorpayWebHookService.handleWebhook(payload, signature);
            }

            // Step 1: Log the incoming webhook
            webhookId = webHookService.saveWebhook(PaymentGateway.RAZORPAY.name(), payload, null);

            // Step 2: Extract instituteId from payload
            String instituteId = extractInstituteId(payload);
            if (instituteId == null) {
                log.warn("Webhook ignored: Missing or invalid 'instituteId' in payload notes.");
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Missing instituteId in payload");
                return ResponseEntity.ok("Webhook ignored: No instituteId found.");
            }

            // Step 3: Get webhook secret for signature verification
            String webhookSecret = getWebhookSecret(instituteId);
            if (webhookSecret == null) {
                log.error("Webhook secret not found for institute: {}", instituteId);
                SentryLogger.logError(new IllegalStateException("Webhook secret not found"),
                        "Razorpay webhook secret not configured", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "institute.id", instituteId,
                                "webhook.id", webhookId,
                                "operation", "getWebhookSecret"));
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Webhook secret not found");
                return ResponseEntity.status(404).body("Unknown institute");
            }

            // Step 4: Verify webhook signature
            if (!verifySignature(payload, signature, webhookSecret)) {
                log.error("Webhook signature verification failed for institute: {}", instituteId);
                SentryLogger.logError(new SecurityException("Webhook signature verification failed"),
                        "Razorpay webhook signature verification failed", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "institute.id", instituteId,
                                "webhook.id", webhookId,
                                "operation", "verifyWebhookSignature"));
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Invalid signature");
                return ResponseEntity.status(400).body("Invalid signature");
            }

            log.info("Webhook signature verified successfully for institute: {}", instituteId);

            return processVerifiedPayload(webhookId, payload, instituteId);

        } catch (Exception ex) {
            String detailedMessage = WebHookErrorUtils.describeException(ex);
            log.error("Unhandled error during Razorpay webhook processing: {}", detailedMessage, ex);
            SentryLogger.SentryEventBuilder.error(ex)
                    .withMessage("Razorpay webhook processing failed with unhandled error")
                    .withTag("payment.vendor", "RAZORPAY")
                    .withTag("webhook.id", webhookId != null ? webhookId : "unknown")
                    .withTag("operation", "processRazorpayWebhook")
                    .send();
            if (webhookId != null) {
                updateWebhookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            }
            return ResponseEntity.status(500).body("Internal server error");
        }
    }

    /**
     * Manually re-runs a previously persisted Razorpay webhook by id, bypassing
     * signature verification (it was verified at original receive time). Useful when
     * a webhook landed in FAILED state due to a transient post-payment error and
     * needs to be replayed after the fix is in place.
     *
     * Resets the WebHook row to RECEIVED before processing so the run is idempotent
     * with respect to the status field, and uses the same processing pipeline as
     * the live webhook (steps 5-10) so behavior matches exactly.
     */
    public ResponseEntity<String> reprocessWebhook(String webhookId) {
        log.info("Manual reprocess requested for webhookId={}", webhookId);

        var webhookOpt = webHookService.findById(webhookId);
        if (webhookOpt.isEmpty()) {
            return ResponseEntity.status(404).body("WebHook not found: " + webhookId);
        }
        var webhook = webhookOpt.get();

        if (!PaymentGateway.RAZORPAY.name().equalsIgnoreCase(webhook.getVendor())) {
            return ResponseEntity.status(400)
                    .body("WebHook vendor is " + webhook.getVendor() + ", expected RAZORPAY for this endpoint.");
        }

        String payload = webhook.getPayload();
        if (payload == null || payload.isBlank()) {
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Stored payload is empty, cannot reprocess");
            return ResponseEntity.status(400).body("Stored payload is empty for webhook " + webhookId);
        }

        String instituteId = extractInstituteId(payload);
        if (instituteId == null) {
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Missing instituteId in stored payload");
            return ResponseEntity.status(400).body("Missing instituteId in stored payload");
        }

        webHookService.resetForReprocess(webhookId);

        try {
            return processVerifiedPayload(webhookId, payload, instituteId);
        } catch (Exception ex) {
            String detailedMessage = WebHookErrorUtils.describeException(ex);
            log.error("Manual reprocess failed for webhookId={}: {}", webhookId, detailedMessage, ex);
            SentryLogger.SentryEventBuilder.error(ex)
                    .withMessage("Razorpay webhook manual reprocess failed")
                    .withTag("payment.vendor", "RAZORPAY")
                    .withTag("webhook.id", webhookId)
                    .withTag("institute.id", instituteId)
                    .withTag("operation", "reprocessWebhook")
                    .send();
            updateWebhookStatus(webhookId, WebHookStatus.FAILED, detailedMessage);
            return ResponseEntity.status(500).body("Reprocess failed: " + detailedMessage);
        }
    }

    /**
     * Steps 5-10 of the processing pipeline. Shared between live webhook delivery
     * (after signature verification) and manual reprocess (signature already
     * verified at original receive time). Any exception bubbles up so the caller
     * can attach a meaningful error message to the WebHook row.
     */
    private ResponseEntity<String> processVerifiedPayload(String webhookId, String payload, String instituteId)
            throws Exception {
        // Step 5: Parse webhook payload
        JsonNode webhookData = objectMapper.readTree(payload);
        String eventType = webhookData.get("event").asText();

        log.info("Processing Razorpay event: {} for institute: {} (webhookId={})", eventType, instituteId, webhookId);

        // Step 6: Extract payment entity from payload
        JsonNode paymentEntity = extractPaymentEntity(webhookData);
        if (paymentEntity == null) {
            log.info("Event {} does not contain payment entity. Acknowledging and skipping.", eventType);
            updateWebhookStatus(webhookId, WebHookStatus.PROCESSED,
                    "Event does not contain payment entity, skipped.");
            return ResponseEntity.ok("Webhook acknowledged, no action taken.");
        }

        // Step 7: Extract orderId from payment notes
        String orderId = extractOrderId(paymentEntity);
        if (orderId == null) {
            log.error("Missing 'orderId' in payment notes for payment_id: {}",
                    paymentEntity.get("id").asText());

            updateWebhookStatus(webhookId, WebHookStatus.FAILED, "Missing orderId in payment notes");
            return ResponseEntity.status(400).body("Missing orderId in payment notes");
        }

        // Step 8: Update webhook with order details
        webHookService.updateWebHook(webhookId, payload, orderId, eventType);

        // Step 9: Check payment type and route accordingly
        String paymentType = extractPaymentType(paymentEntity);

        if (paymentType != null && PaymentType.RENEWAL.name().equals(paymentType)) {
            log.info("Processing RENEWAL payment webhook for orderId: {}", orderId);
            handleRenewalPayment(eventType, orderId, instituteId, paymentEntity);
        } else if (paymentType != null && PaymentType.SCHOOL.name().equals(paymentType)) {
            log.info("Processing SCHOOL payment webhook for orderId: {}", orderId);
            handleSchoolPayment(eventType, orderId, instituteId, paymentEntity);
        } else if (paymentType != null && PaymentType.APPLICATION_FEE.name().equals(paymentType)) {
            log.info("Processing APPLICATION_FEE payment webhook for orderId: {}", orderId);
            handleApplicationFeePayment(eventType, orderId, instituteId, paymentEntity);
        } else if (paymentType != null && PaymentType.PLAN_CHANGE.name().equals(paymentType)) {
            log.info("Processing PLAN_CHANGE payment webhook for orderId: {}", orderId);
            handlePlanChangePayment(eventType, orderId, instituteId);
        } else {
            // Handle initial payment events
            handleRazorpayEvent(eventType, orderId, instituteId, paymentEntity);
        }

        // Step 10: Mark webhook as processed
        updateWebhookStatus(webhookId, WebHookStatus.PROCESSED, null);
        return ResponseEntity.ok("Webhook processed successfully");
    }


    /**
     * Handles different Razorpay event types
     */
    private void handleRazorpayEvent(String eventType, String orderId, String instituteId,
            JsonNode paymentEntity) {
        switch (eventType) {
            case "payment.captured":
                log.info("Payment captured for orderId: {}", orderId);

                // Extract and save payment method token for recurring payments
                extractAndSavePaymentMethod(orderId, instituteId, paymentEntity);

                generateAndStoreRazorpayInvoice(orderId, instituteId, paymentEntity);

                // payment.captured is the authoritative capture event and always arrives,
                // whereas order.paid can race with it or be deduped — so mark the log PAID
                // here too. updatePaymentLog only runs the post-payment side effects when
                // the log actually transitions to PAID, so a following order.paid is a no-op.
                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.PAID.name(), instituteId);
                break;

            case "payment.failed":
                log.warn("Payment failed for orderId: {}", orderId);
                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.FAILED.name(), instituteId);
                break;

            case "payment.authorized":
                log.info("Payment authorized (pending capture) for orderId: {}", orderId);
                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.PAYMENT_PENDING.name(),
                        instituteId);
                break;

            case "order.paid":
                log.info("Order fully paid for orderId: {}", orderId);

                extractAndSavePaymentMethod(orderId, instituteId, paymentEntity);

                generateAndStoreRazorpayInvoice(orderId, instituteId, paymentEntity);

                paymentLogService.updatePaymentLog(orderId, PaymentStatusEnum.PAID.name(), instituteId);
                break;

            default:
                log.info("Unhandled but valid event type: {}. Acknowledging.", eventType);
                break;
        }
    }

    /**
     * Handles APPLICATION_FEE payment webhook events.
     * Called when payment_type = APPLICATION_FEE is present in Razorpay notes.
     * Uses updatePaymentLogOnly to avoid triggering donation/enrollment
     * post-payment logic
     * (since userPlan is null for applicant payments).
     */
    private void handleApplicationFeePayment(String eventType, String orderId, String instituteId,
            JsonNode paymentEntity) {

        log.info("handleApplicationFeePayment: eventType={}, orderId={}, instituteId={}", eventType, orderId,
                instituteId);

        switch (eventType) {
            case "order.paid":
            case "payment.captured": {
                try {
                    // 1. Load PaymentLog by orderId to extract applicant context
                    java.util.Optional<vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog> logOpt = paymentLogRepository
                            .findById(orderId);
                    if (logOpt.isEmpty()) {
                        // Try searching by orderId in paymentSpecificData JSON
                        var logs = paymentLogRepository.findAllByOrderIdInOriginalRequest(orderId);
                        if (logs.isEmpty()) {
                            logs = paymentLogRepository.findAllByOrderIdInJson(orderId);
                        }
                        if (!logs.isEmpty()) {
                            logOpt = java.util.Optional.of(logs.get(0));
                        }
                    }

                    if (logOpt.isEmpty()) {
                        log.warn("No PaymentLog found for APPLICATION_FEE orderId: {}", orderId);
                        return;
                    }

                    var paymentLog = logOpt.get();

                    // 2. Update PaymentLog to PAID — use updatePaymentLogOnly to bypass
                    // donation notification (userPlan is null for applicant fees)
                    paymentLogService.updatePaymentLogOnly(
                            paymentLog.getId(),
                            vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum.SUCCESS
                                    .name(),
                            vacademy.io.common.payment.enums.PaymentStatusEnum.PAID.name(),
                            paymentLog.getPaymentSpecificData());

                    log.info("APPLICATION_FEE PaymentLog marked PAID: {}", paymentLog.getId());

                    // 3. Extract applicant context from paymentSpecificData
                    String applicantId = null;
                    String paymentOptionId = null;
                    double amountPaid = 0.0;
                    String transactionId = null;

                    if (paymentLog.getPaymentSpecificData() != null) {
                        try {
                            @SuppressWarnings("unchecked")
                            java.util.Map<String, Object> data = JsonUtil.fromJson(paymentLog.getPaymentSpecificData(),
                                    java.util.Map.class);
                            if (data != null) {
                                applicantId = (String) data.get("applicantId");
                                paymentOptionId = (String) data.get("paymentOptionId");
                            }
                        } catch (Exception e) {
                            log.warn("Could not parse paymentSpecificData for orderId={}: {}", orderId, e.getMessage());
                        }
                    }

                    // Fallback: Also check if they are directly in the Razorpay notes payload
                    if (applicantId == null || paymentOptionId == null) {
                        try {
                            com.fasterxml.jackson.databind.JsonNode notesNode = paymentEntity.get("notes");
                            if (notesNode != null) {
                                if (applicantId == null && notesNode.has("applicantId")) {
                                    applicantId = notesNode.get("applicantId").asText();
                                }
                                if (paymentOptionId == null && notesNode.has("paymentOptionId")) {
                                    paymentOptionId = notesNode.get("paymentOptionId").asText();
                                }
                            }
                        } catch (Exception e) {
                            log.warn("Could not extract applicant info from Razorpay notes for orderId={}", orderId);
                        }
                    }

                    // 4. Extract amount and transactionId from Razorpay payload
                    try {
                        String paidCurrency = paymentEntity.has("currency")
                                ? paymentEntity.get("currency").asText()
                                : (paymentLog.getCurrency() != null ? paymentLog.getCurrency() : "INR");
                        amountPaid = paymentEntity.has("amount")
                                ? CurrencyRegistry.fromMinorUnits(paymentEntity.get("amount").asLong(), paidCurrency) // minor units → major
                                : (paymentLog.getPaymentAmount() != null ? paymentLog.getPaymentAmount() : 0.0);
                        transactionId = paymentEntity.has("id")
                                ? paymentEntity.get("id").asText()
                                : orderId;
                    } catch (Exception e) {
                        amountPaid = paymentLog.getPaymentAmount() != null ? paymentLog.getPaymentAmount() : 0.0;
                        transactionId = orderId;
                    }

                    if (applicantId == null) {
                        log.warn(
                                "applicantId not found in paymentSpecificData for APPLICATION_FEE orderId: {} — skipping invoice",
                                orderId);
                        return;
                    }

                    // 5. Resolve recipient email and name from AudienceResponse & AuthService
                    String recipientEmail = null;
                    String recipientName = "Applicant";
                    try {
                        var arOpt = audienceResponseRepository.findByApplicantId(applicantId);
                        if (arOpt.isPresent()) {
                            var ar = arOpt.get();

                            // Get best-effort fallback from AudienceResponse first
                            recipientEmail = ar.getParentEmail();
                            recipientName = ar.getParentName() != null ? ar.getParentName() : "Applicant";

                            // Reliably override with real user profile from AuthService (just like offline
                            // flow)
                            if (ar.getUserId() != null) {
                                try {
                                    java.util.List<vacademy.io.common.auth.dto.UserDTO> parentUsers = authService
                                            .getUsersFromAuthServiceByUserIds(java.util.List.of(ar.getUserId()));
                                    if (parentUsers != null && !parentUsers.isEmpty()) {
                                        vacademy.io.common.auth.dto.UserDTO realParent = parentUsers.get(0);
                                        if (realParent.getEmail() != null && !realParent.getEmail().isBlank()) {
                                            recipientEmail = realParent.getEmail();
                                        }
                                        if (realParent.getFullName() != null && !realParent.getFullName().isBlank()) {
                                            recipientName = realParent.getFullName();
                                        }
                                    }
                                } catch (Exception authEx) {
                                    log.warn("API lookup for real parent account failed: {}", authEx.getMessage());
                                }
                            }
                        }
                    } catch (Exception e) {
                        log.warn("Could not load AudienceResponse for applicantId={}: {}", applicantId, e.getMessage());
                    }

                    // 6. Generate and email invoice PDF
                    applicationFeeReceiptService.generateAndSendInvoice(
                            applicantId,
                            paymentOptionId != null ? paymentOptionId : "",
                            paymentLog.getId(),
                            instituteId,
                            java.math.BigDecimal.valueOf(amountPaid),
                            transactionId,
                            "ONLINE",
                            recipientEmail,
                            recipientName);

                    log.info("APPLICATION_FEE invoice generated and emailed for applicantId={}, orderId={}",
                            applicantId, orderId);

                } catch (Exception e) {
                    log.error("Error in handleApplicationFeePayment for orderId={}: {}", orderId, e.getMessage(), e);
                    SentryLogger.logError(e, "APPLICATION_FEE webhook processing error", java.util.Map.of(
                            "order.id", orderId,
                            "institute.id", instituteId));
                }
                break;
            }
            case "payment.failed": {
                log.warn("APPLICATION_FEE payment failed for orderId: {}", orderId);
                try {
                    var logOpt = paymentLogRepository.findById(orderId);
                    if (logOpt.isPresent()) {
                        paymentLogService.updatePaymentLogOnly(
                                logOpt.get().getId(),
                                vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum.FAILED
                                        .name(),
                                vacademy.io.common.payment.enums.PaymentStatusEnum.FAILED.name(),
                                logOpt.get().getPaymentSpecificData());
                    }
                } catch (Exception e) {
                    log.error("Could not mark APPLICATION_FEE payment as failed for orderId={}: {}", orderId,
                            e.getMessage());
                }
                break;
            }
            default:
                log.info("Unhandled APPLICATION_FEE event type: {}. Acknowledging.", eventType);
                break;
        }
    }

    /**
     * Updates webhook status in database
     */
    private void updateWebhookStatus(String webhookId, WebHookStatus status, String notes) {
        if (webhookId != null) {
            webHookService.updateWebHookStatus(webhookId, status, notes);
        }
    }

    /**
     * Extracts instituteId from payment notes in the payload
     */
    private String extractInstituteId(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            JsonNode paymentEntity = extractPaymentEntity(root);

            if (paymentEntity != null) {
                JsonNode notesNode = paymentEntity.get("notes");
                if (notesNode != null && notesNode.has("instituteId")) {
                    return notesNode.get("instituteId").asText();
                }
            }

            // Fallback: Try to get from order notes if payment entity doesn't have it
            if (root.has("payload") && root.get("payload").has("order")) {
                JsonNode orderEntity = root.get("payload").get("order").get("entity");
                if (orderEntity != null) {
                    JsonNode notesNode = orderEntity.get("notes");
                    if (notesNode != null && notesNode.has("instituteId")) {
                        return notesNode.get("instituteId").asText();
                    }
                }
            }

        } catch (Exception e) {
            log.error("Failed to parse payload or extract instituteId", e);
            SentryLogger.logError(e, "Failed to parse Razorpay webhook payload", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "operation", "extractInstituteId"));
        }
        return null;
    }

    /**
     * True when the event belongs to the platform's own Razorpay account
     * (AI credit-pack purchase) rather than an institute's marketplace account.
     * Checks both the payment and order entity notes — order.paid carries the
     * notes on the order, payment.captured on the payment.
     *
     * Never throws: a payload we cannot parse is simply "not a platform event"
     * and falls through to the normal (signature-verified) institute path.
     */
    boolean isPlatformCreditPackEvent(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            JsonNode entity = extractPaymentEntity(root);
            String paymentType = entity != null ? extractPaymentType(entity) : null;
            if (paymentType == null && root.has("payload") && root.get("payload").has("order")) {
                JsonNode orderEntity = root.get("payload").get("order").get("entity");
                paymentType = orderEntity != null ? extractPaymentType(orderEntity) : null;
            }
            if (PaymentType.AI_CREDIT_PACK.name().equals(paymentType)
                    || PaymentType.AI_SUBSCRIPTION.name().equals(paymentType)) {
                return true;
            }
            // token.* carries only the token entity: ours when the platform handler knows the id.
            String event = root.has("event") ? root.get("event").asText() : null;
            if (event != null && event.startsWith("token.") && subscriptionPaymentHandler != null) {
                JsonNode token = root.path("payload").path("token").path("entity");
                String tokenId = token.has("id") ? token.get("id").asText() : null;
                var handler = subscriptionPaymentHandler.getIfAvailable();
                return tokenId != null && handler != null && handler.ownsToken(tokenId);
            }
            // No payment_type in the notes (a registration-link payment keeps its notes on the
            // invoice): ours when its order / invoice id is a platform_payment's vendor_order_id.
            // Razorpay ids are globally unique, so an institute's payment can never match.
            if (paymentType == null && entity != null && platformPaymentRepository != null) {
                for (String key : new String[] {"order_id", "invoice_id"}) {
                    JsonNode ref = entity.get(key);
                    if (ref != null && !ref.isNull() && !ref.asText().isBlank()
                            && platformPaymentRepository.findByVendorOrderId(ref.asText()).isPresent()) {
                        return true;
                    }
                }
            }
            return false;
        } catch (Exception e) {
            log.warn("Could not determine payment_type for webhook routing: {}", e.getMessage());
            return false;
        }
    }

    /**
     * Extracts orderId from payment notes
     */
    private String extractOrderId(JsonNode paymentEntity) {
        try {
            JsonNode notesNode = paymentEntity.get("notes");
            if (notesNode != null && notesNode.has("orderId")) {
                return notesNode.get("orderId").asText();
            }
        } catch (Exception e) {
            log.error("Failed to extract orderId from payment entity", e);
            SentryLogger.logError(e, "Failed to extract orderId from Razorpay payment entity", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "operation", "extractOrderId"));
        }
        return null;
    }

    /**
     * Extracts payment entity from webhook payload based on event type
     */
    private JsonNode extractPaymentEntity(JsonNode root) {
        try {
            // Check if payload contains payment entity
            if (root.has("payload") && root.get("payload").has("payment")) {
                return root.get("payload").get("payment").get("entity");
            }

            // Check if payload contains order entity
            if (root.has("payload") && root.get("payload").has("order")) {
                return root.get("payload").get("order").get("entity");
            }
        } catch (Exception e) {
            log.error("Failed to extract payment/order entity from payload", e);
            SentryLogger.logError(e, "Failed to extract payment entity from Razorpay webhook", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "operation", "extractPaymentEntity"));
        }
        return null;
    }

    /**
     * Retrieves webhook secret for the institute
     */
    private String getWebhookSecret(String instituteId) {
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(PaymentGateway.RAZORPAY.name(), instituteId);
        return gatewayData != null ? (String) gatewayData.get("webhookSecret") : null;
    }

    /**
     * Verifies Razorpay webhook signature using HMAC SHA256
     *
     * Razorpay signature format: hmac_sha256(webhook_secret, webhook_body)
     */
    private boolean verifySignature(String payload, String receivedSignature, String webhookSecret) {
        try {
            // Create HMAC SHA256 signature
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(
                    webhookSecret.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256");
            mac.init(secretKeySpec);

            byte[] hash = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));

            // Convert to hex string
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }

            String expectedSignature = hexString.toString();

            log.debug("Expected signature: {}", expectedSignature);
            log.debug("Received signature: {}", receivedSignature);

            // Compare signatures (constant time comparison to prevent timing attacks)
            return MessageDigestEquals(expectedSignature, receivedSignature);

        } catch (Exception e) {
            log.error("Error verifying Razorpay signature", e);
            SentryLogger.logError(e, "Error verifying Razorpay signature", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "operation", "verifySignature"));
            return false;
        }
    }

    /**
     * Constant time string comparison to prevent timing attacks
     */
    private boolean MessageDigestEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) {
            return false;
        }

        int result = 0;
        for (int i = 0; i < a.length(); i++) {
            result |= a.charAt(i) ^ b.charAt(i);
        }
        return result == 0;
    }

    private void extractAndSavePaymentMethod(String orderId, String instituteId, JsonNode paymentEntity) {
        try {
            // Step 1: Check if token_id exists in webhook
            if (!paymentEntity.has("token_id") || paymentEntity.get("token_id").isNull()) {
                log.debug("No token_id in webhook for orderId: {}. " +
                        "This is normal for non-recurring payments.", orderId);
                return;
            }

            String tokenId = paymentEntity.get("token_id").asText();
            log.info("Found token_id in webhook: {} for orderId: {}", tokenId, orderId);

            // Step 2: Get user ID from payment_log
            String userId = getUserIdFromPaymentLog(orderId);
            if (userId == null) {
                log.error("Cannot find userId for orderId: {}. Cannot save token.", orderId);
                SentryLogger.logError(new IllegalStateException("UserId not found for payment"),
                        "Cannot save Razorpay payment method - userId not found", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "order.id", orderId,
                                "razorpay.token.id", tokenId,
                                "operation", "savePaymentMethod"));
                return;
            }

            // Step 3: Get customer ID from webhook (optional, for validation)
            String customerId = paymentEntity.has("customer_id") ? paymentEntity.get("customer_id").asText() : null;

            if (customerId != null) {
                log.debug("Customer ID from webhook: {}", customerId);
            }

            // Step 4: Extract card details (optional, for display purposes)
            String cardLast4 = null;
            String cardBrand = null;
            String paymentMethodType = "card"; // Default

            if (paymentEntity.has("card") && !paymentEntity.get("card").isNull()) {
                JsonNode cardNode = paymentEntity.get("card");
                cardLast4 = cardNode.has("last4") ? cardNode.get("last4").asText() : null;
                cardBrand = cardNode.has("network") ? cardNode.get("network").asText() : null;

                log.debug("Card details - Last4: {}, Brand: {}", cardLast4, cardBrand);
            }

            // Get payment method type from webhook if available
            if (paymentEntity.has("method")) {
                paymentMethodType = paymentEntity.get("method").asText();
            }

            // Step 5: Save token to database (in existing JSON column)
            userInstitutePaymentGatewayMappingService.savePaymentMethodInCustomerData(
                    userId,
                    instituteId,
                    PaymentGateway.RAZORPAY.name(),
                    tokenId,
                    paymentMethodType,
                    cardLast4,
                    cardBrand);

            log.info("Successfully saved Razorpay payment method for user: {} " +
                    "with token: {}", userId, tokenId);

            // Step 6: Record a per-plan recurring mandate so RenewalChargeService
            // can charge this token off-session (keyed by userPlanId). Only the
            // plan flagged auto_renewal_enabled is ever charged, so persisting the
            // mandate here is safe for any token capture.
            persistRazorpayMandate(orderId, userId, instituteId, tokenId, customerId);

            // Step 7: The mandate is registered, so the authorization charge has done its
            // job. Give it back if the invite asks us to — otherwise the learner paid for
            // a "free" trial.
            refundTrialAuthorizationIfConfigured(orderId, instituteId,
                    paymentEntity.has("id") ? paymentEntity.get("id").asText() : null);

        } catch (Exception e) {
            // Don't fail the webhook if token save fails
            // Payment is already successful, token storage is just for future use
            log.error("Failed to extract/save payment method for orderId: {}. " +
                    "Payment processing will continue, but recurring payments may not work.",
                    orderId, e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to save Razorpay payment method")
                    .withTag("payment.vendor", "RAZORPAY")
                    .withTag("order.id", orderId)
                    .withTag("institute.id", instituteId)
                    .withTag("operation", "extractAndSavePaymentMethod")
                    .send();
        }
    }

    /**
     * Retrieves userId from payment_log table using order ID.
     *
     * @param orderId Payment log order ID
     * @return User ID or null if not found
     */
    /**
     * Persist a per-plan recurring mandate from a captured Razorpay token so the
     * auto-charge scheduler can debit it off-session. Keyed by the plan behind
     * this payment log. Best-effort — never fails the webhook.
     */
    /**
     * Refunds the mandate authorization charge when the invite has
     * AUTOPAY_SETTING.AUTH_REFUNDABLE set. Only applies to trial signups — a
     * non-trial enrollment's first payment IS the plan price, not an authorization.
     */
    private void refundTrialAuthorizationIfConfigured(String orderId, String instituteId,
            String razorpayPaymentId) {
        try {
            if (!StringUtils.hasText(razorpayPaymentId)) {
                return;
            }
            Optional<PaymentLog> plOpt = paymentLogRepository.findById(orderId);
            if (plOpt.isEmpty() || plOpt.get().getUserPlan() == null) {
                return;
            }
            UserPlan userPlan = plOpt.get().getUserPlan();
            if (!Boolean.TRUE.equals(userPlan.getIsTrial()) || userPlan.getEnrollInvite() == null) {
                return;
            }
            String settingJson = userPlan.getEnrollInvite().getSettingJson();
            if (!StringUtils.hasText(settingJson)) {
                return;
            }
            JsonNode autopay = objectMapper.readTree(settingJson).path("setting").path("AUTOPAY_SETTING");
            if (!autopay.path("AUTH_REFUNDABLE").asBoolean(false)) {
                return;
            }

            Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData(PaymentGateway.RAZORPAY.name(), instituteId);
            razorpayPaymentManager.refundPayment(razorpayPaymentId, gatewayData);
            log.info("Refunded mandate authorization {} for trial plan {}",
                    razorpayPaymentId, userPlan.getId());
        } catch (Exception e) {
            // The mandate is registered and the learner is enrolled — a failed refund must
            // not undo that. Surface it loudly instead; it is money owed back.
            log.error("Failed to refund mandate authorization for orderId {} (payment {}): {}",
                    orderId, razorpayPaymentId, e.getMessage(), e);
        }
    }

    private void persistRazorpayMandate(String orderId, String userId, String instituteId,
            String tokenId, String customerId) {
        try {
            Optional<PaymentLog> plOpt = paymentLogRepository.findById(orderId);
            if (plOpt.isEmpty() || plOpt.get().getUserPlan() == null) {
                log.debug("No user plan for orderId {} — skipping mandate persist", orderId);
                return;
            }
            PaymentLog paymentLog = plOpt.get();
            String userPlanId = paymentLog.getUserPlan().getId();
            // The cap and currency the mandate was registered with live on the originating
            // request. Without them the renewal charge has no local ceiling to enforce.
            Double maxAmount = null;
            String currency = null;
            try {
                JsonNode original = objectMapper.readTree(paymentLog.getPaymentSpecificData())
                        .path("originalRequest");
                JsonNode cap = original.path("razorpay_request").path("mandate_max_amount");
                if (cap.isNumber()) {
                    maxAmount = cap.asDouble();
                }
                if (original.hasNonNull("currency")) {
                    currency = original.get("currency").asText();
                }
            } catch (Exception e) {
                log.debug("Could not read mandate cap from payment log {}: {}", orderId, e.getMessage());
            }
            vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo mandate =
                    vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo.builder()
                            .vendor(PaymentGateway.RAZORPAY.name())
                            .customerId(customerId)
                            .providerRef(tokenId)
                            .maxAmount(maxAmount)
                            .currency(currency)
                            .frequency("as_presented")
                            .status(vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo.STATUS_ACTIVE)
                            .build();
            userInstitutePaymentGatewayMappingService.upsertMandate(
                    userId, instituteId, PaymentGateway.RAZORPAY.name(), userPlanId, mandate);
            log.info("Persisted Razorpay mandate for plan {} (token {})", userPlanId, tokenId);
        } catch (Exception e) {
            log.error("Failed to persist Razorpay mandate for orderId {}: {}", orderId, e.getMessage());
        }
    }

    private String getUserIdFromPaymentLog(String orderId) {
        try {
            Optional<PaymentLog> paymentLogOptional = paymentLogRepository.findById(orderId);

            if (paymentLogOptional.isPresent()) {
                String userId = paymentLogOptional.get().getUserId();
                log.debug("Found userId: {} for orderId: {}", userId, orderId);
                return userId;
            } else {
                log.warn("PaymentLog not found for orderId: {}", orderId);
                return null;
            }
        } catch (Exception e) {
            log.error("Error retrieving userId from payment_log for orderId: {}", orderId, e);
            SentryLogger.logError(e, "Error retrieving userId from payment log", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "order.id", orderId,
                    "operation", "getUserIdFromPaymentLog"));
            return null;
        }
    }

    private void generateAndStoreRazorpayInvoice(String orderId, String instituteId, JsonNode paymentEntity) {
        try {
            log.info("Generating Razorpay invoice for orderId: {}", orderId);

            // Step 1: Generate invoice via Razorpay API
            String invoiceUrl = generateRazorpayInvoice(orderId, instituteId, paymentEntity);

            if (invoiceUrl == null) {
                log.warn("Failed to generate Razorpay invoice for orderId: {}. " +
                        "Email will be sent without receipt URL.", orderId);
                return;
            }

            // Step 2: Store invoice URL in payment_specific_data
            storeInvoiceUrl(orderId, invoiceUrl);

            log.info("Successfully generated and stored Razorpay invoice URL for orderId: {}", orderId);

        } catch (Exception e) {
            // Don't fail the webhook if invoice generation fails
            // Payment is already successful, invoice is just for user convenience
            log.error("Error generating/storing Razorpay invoice for orderId: {}. " +
                    "Payment confirmation will continue without receipt URL.", orderId, e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Error generating or storing Razorpay invoice")
                    .withTag("payment.vendor", "RAZORPAY")
                    .withTag("order.id", orderId)
                    .withTag("institute.id", instituteId)
                    .withTag("operation", "generateAndStoreRazorpayInvoice")
                    .send();
        }
    }

    private String generateRazorpayInvoice(String orderId, String instituteId, JsonNode paymentEntity) {
        try {
            // Extract payment details from webhook
            String paymentId = paymentEntity.has("id") ? paymentEntity.get("id").asText() : null;
            long amount = paymentEntity.has("amount") ? paymentEntity.get("amount").asLong() : 0;
            String currency = paymentEntity.has("currency") ? paymentEntity.get("currency").asText() : "INR";
            String customerId = paymentEntity.has("customer_id") ? paymentEntity.get("customer_id").asText() : null;
            String email = paymentEntity.has("email") ? paymentEntity.get("email").asText() : null;
            String contact = paymentEntity.has("contact") ? paymentEntity.get("contact").asText() : null;

            // Validate required fields
            if (paymentId == null || amount == 0) {
                log.error("Missing required payment details for invoice generation. PaymentId: {}, Amount: {}",
                        paymentId, amount);
                SentryLogger.logError(new IllegalStateException("Missing payment details for invoice"),
                        "Missing required Razorpay payment details for invoice generation", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "order.id", orderId,
                                "payment.id", paymentId != null ? paymentId : "unknown",
                                "payment.amount", String.valueOf(amount),
                                "operation", "generateRazorpayInvoice"));
                return null;
            }

            // Get Razorpay credentials
            Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData(PaymentGateway.RAZORPAY.name(), instituteId);

            if (gatewayData == null) {
                log.error("Razorpay gateway data not found for institute: {}", instituteId);
                SentryLogger.logError(new IllegalStateException("Gateway data not found"),
                        "Razorpay gateway data not configured for institute", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "institute.id", instituteId,
                                "order.id", orderId,
                                "operation", "getRazorpayCredentials"));
                return null;
            }

            // Try multiple field name variations for compatibility
            String razorpayKeyId = (String) gatewayData.get("apiKey");
            if (razorpayKeyId == null) {
                razorpayKeyId = (String) gatewayData.get("keyId");
            }

            // Check for secret in multiple field names (publishableKey, apiSecret,
            // keySecret)
            String razorpayKeySecret = (String) gatewayData.get("publishableKey");
            if (razorpayKeySecret == null) {
                razorpayKeySecret = (String) gatewayData.get("apiSecret");
            }
            if (razorpayKeySecret == null) {
                razorpayKeySecret = (String) gatewayData.get("keySecret");
            }

            if (razorpayKeyId == null || razorpayKeySecret == null) {
                log.error("Razorpay credentials not found for institute: {}. Gateway data keys: {}",
                        instituteId, gatewayData != null ? gatewayData.keySet() : "null");
                SentryLogger.logError(new IllegalStateException("Razorpay credentials not configured"),
                        "Razorpay API credentials not found", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "institute.id", instituteId,
                                "order.id", orderId,
                                "has.keyId", String.valueOf(razorpayKeyId != null),
                                "has.keySecret", String.valueOf(razorpayKeySecret != null),
                                "operation", "getRazorpayApiCredentials"));
                return null;
            }

            log.debug("Retrieved Razorpay credentials for invoice generation. KeyId: {}", razorpayKeyId);

            // Build invoice request
            JSONObject invoiceRequest = new JSONObject();
            invoiceRequest.put("type", "invoice");
            invoiceRequest.put("description", "Payment Receipt - Course Enrollment");
            invoiceRequest.put("currency", currency);

            // Add customer ID if available
            if (customerId != null) {
                invoiceRequest.put("customer_id", customerId);
            } else {
                // Create customer inline if no customer_id
                JSONObject customer = new JSONObject();
                if (email != null)
                    customer.put("email", email);
                if (contact != null)
                    customer.put("contact", contact);
                customer.put("name", email != null ? email.split("@")[0] : "Customer");
                invoiceRequest.put("customer", customer);
            }

            // Add line items
            JSONArray lineItems = new JSONArray();
            JSONObject lineItem = new JSONObject();
            lineItem.put("name", "Course Enrollment Payment");
            lineItem.put("description", "Payment ID: " + paymentId);
            lineItem.put("amount", amount);
            lineItem.put("currency", currency);
            lineItem.put("quantity", 1);
            lineItems.put(lineItem);
            invoiceRequest.put("line_items", lineItems);

            // Don't send Razorpay's email/SMS (we'll send our own)
            invoiceRequest.put("email_notify", 0);
            invoiceRequest.put("sms_notify", 0);

            // Add reference to payment
            JSONObject notes = new JSONObject();
            notes.put("payment_id", paymentId);
            notes.put("order_id", orderId);
            invoiceRequest.put("notes", notes);

            log.debug("Razorpay invoice request: {}", invoiceRequest.toString());

            // Make API call to Razorpay
            String invoiceApiUrl = "https://api.razorpay.com/v1/invoices";
            String authString = razorpayKeyId + ":" + razorpayKeySecret;
            String encodedAuth = Base64.getEncoder().encodeToString(authString.getBytes(StandardCharsets.UTF_8));

            HttpClient client = HttpClient.newHttpClient();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(invoiceApiUrl))
                    .header("Authorization", "Basic " + encodedAuth)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(invoiceRequest.toString()))
                    .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200 || response.statusCode() == 201) {
                JSONObject invoiceResponse = new JSONObject(response.body());

                // Extract invoice URLs
                String shortUrl = invoiceResponse.has("short_url") ? invoiceResponse.getString("short_url") : null;
                String invoiceId = invoiceResponse.has("id") ? invoiceResponse.getString("id") : null;

                log.info("Razorpay invoice created successfully. Invoice ID: {}, URL: {}", invoiceId, shortUrl);

                return shortUrl;
            } else {
                log.error("Failed to generate Razorpay invoice. Status: {}, Response: {}",
                        response.statusCode(), response.body());
                SentryLogger.SentryEventBuilder.error(new RuntimeException("Razorpay invoice API failed"))
                        .withMessage("Failed to generate Razorpay invoice via API")
                        .withTag("payment.vendor", "RAZORPAY")
                        .withTag("order.id", orderId)
                        .withTag("institute.id", instituteId)
                        .withTag("razorpay.api.status", String.valueOf(response.statusCode()))
                        .withTag("operation", "callRazorpayInvoiceAPI")
                        .send();
                return null;
            }

        } catch (Exception e) {
            log.error("Error calling Razorpay Invoice API for orderId: {}", orderId, e);
            SentryLogger.logError(e, "Exception calling Razorpay invoice API", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "order.id", orderId,
                    "institute.id", instituteId != null ? instituteId : "unknown",
                    "operation", "generateRazorpayInvoice"));
            return null;
        }
    }

    private void storeInvoiceUrl(String orderId, String invoiceUrl) {
        if (invoiceUrl == null) {
            log.warn("No invoice URL to store for orderId: {}", orderId);
            return;
        }

        try {
            // Get existing payment log
            Optional<PaymentLog> paymentLogOptional = paymentLogRepository.findById(orderId);
            if (!paymentLogOptional.isPresent()) {
                log.error("Payment log not found for orderId: {}", orderId);
                SentryLogger.logError(new IllegalStateException("Payment log not found"),
                        "Payment log not found when storing Razorpay invoice URL", Map.of(
                                "payment.vendor", "RAZORPAY",
                                "order.id", orderId,
                                "operation", "storeInvoiceUrl"));
                return;
            }

            PaymentLog paymentLog = paymentLogOptional.get();

            // Parse existing payment_specific_data
            Map<String, Object> paymentData = JsonUtil.fromJson(
                    paymentLog.getPaymentSpecificData(),
                    Map.class);

            if (paymentData == null) {
                paymentData = new HashMap<>();
            }

            // Navigate to response.response_data (create if doesn't exist)
            Map<String, Object> response = (Map<String, Object>) paymentData.get("response");
            if (response == null) {
                response = new HashMap<>();
                paymentData.put("response", response);
            }

            Map<String, Object> responseData = (Map<String, Object>) response.get("response_data");
            if (responseData == null) {
                responseData = new HashMap<>();
                response.put("response_data", responseData);
            }

            // Add invoice URL (same field name as Stripe uses for consistency)
            responseData.put("receiptUrl", invoiceUrl);
            responseData.put("invoiceUrl", invoiceUrl); // Keep both for flexibility

            log.debug("Storing invoice URL in payment_specific_data: {}", invoiceUrl);

            // Save back to database
            paymentLog.setPaymentSpecificData(JsonUtil.toJson(paymentData));
            paymentLogRepository.save(paymentLog);

            log.info("Invoice URL stored successfully for orderId: {}", orderId);

        } catch (Exception e) {
            log.error("Error storing invoice URL in payment_specific_data for orderId: {}", orderId, e);
            SentryLogger.logError(e, "Error storing Razorpay invoice URL in payment log", Map.of(
                    "payment.vendor", "RAZORPAY",
                    "order.id", orderId,
                    "invoice.url", invoiceUrl != null ? invoiceUrl : "unknown",
                    "operation", "storeInvoiceUrl"));
        }
    }

    private String extractPaymentType(JsonNode paymentEntity) {
        try {
            JsonNode notesNode = paymentEntity.get("notes");
            if (notesNode != null && notesNode.has("payment_type")) {
                return notesNode.get("payment_type").asText();
            }
        } catch (Exception e) {
            log.warn("Failed to extract payment_type from payment entity", e);
        }
        return null;
    }

    private void handleRenewalPayment(String eventType, String orderId, String instituteId, JsonNode paymentEntity) {
        try {
            // Map Razorpay event to PaymentStatusEnum
            PaymentStatusEnum paymentStatus = determinePaymentStatus(eventType);

            if (paymentStatus == null) {
                log.info("Event {} is not relevant for renewal payment status update. Skipping.", eventType);
                return;
            }

            log.info("Processing renewal payment: orderId={}, status={}", orderId, paymentStatus);

            renewalPaymentService.handleRenewalPaymentConfirmation(orderId, instituteId, paymentStatus, paymentEntity);

        } catch (Exception e) {
            log.error("Error processing renewal payment webhook", e);
        }
    }

    /**
     * An upgrade payment settled. Applying the change is idempotent inside
     * PlanChangeService (it claims the payment log atomically), which matters here because
     * Razorpay delivers both payment.captured and order.paid for one payment and prod runs
     * several replicas.
     */
    private void handlePlanChangePayment(String eventType, String orderId, String instituteId) {
        try {
            PaymentStatusEnum paymentStatus = determinePaymentStatus(eventType);
            if (paymentStatus == null) {
                log.info("Event {} is not relevant for plan-change payment status. Skipping.", eventType);
                return;
            }
            planChangeService.handlePlanChangePaymentConfirmation(orderId, instituteId, paymentStatus);
        } catch (Exception e) {
            log.error("Error processing plan-change payment webhook for orderId {}", orderId, e);
        }
    }

    private PaymentStatusEnum determinePaymentStatus(String eventType) {
        switch (eventType) {
            case "payment.captured":
            case "order.paid":
                return PaymentStatusEnum.PAID;
            case "payment.failed":
                return PaymentStatusEnum.FAILED;
            case "payment.authorized":
                return PaymentStatusEnum.PAYMENT_PENDING;
            default:
                return null;
        }
    }

    private void handleSchoolPayment(String eventType, String orderId, String instituteId, JsonNode paymentEntity) {
        log.info("Handling SCHOOL payment webhook event: {} for orderId: {}", eventType, orderId);

        try {
            Optional<PaymentLog> paymentLogOpt = paymentLogRepository.findById(orderId);
            if (paymentLogOpt.isEmpty()) {
                log.error("PaymentLog not found for orderId: {}", orderId);
                return;
            }
            PaymentLog paymentLog = paymentLogOpt.get();

            switch (eventType) {
                case "order.paid":
                case "payment.captured":
                    log.info("School payment process for orderId: {}", orderId);

                    // Atomic idempotency claim — the dedupe gate for this whole block.
                    // Razorpay delivers BOTH payment.captured AND order.paid for one payment, and
                    // with 4 replicas they are handled concurrently; the slow Razorpay-invoice API
                    // call below widens the window further. A read-then-check guard races (both
                    // events read paymentStatus=null before either commits PAID) and double-allocates
                    // — e.g. ₹5 against ₹4/₹3/₹3 settles ALL three installments (₹5 + ₹5 = ₹10). This
                    // single-statement conditional UPDATE is atomic at the DB row level: exactly one
                    // event transitions NOT-PAID→PAID (rows=1) and proceeds; concurrent/duplicate/
                    // retried events get 0 and bail before allocation, receipt, and invoice. It
                    // commits in its own transaction so PAID is visible to the other replica at once.
                    int claimed = paymentLogService.claimPaidIfNotAlready(orderId);
                    if (claimed == 0) {
                        log.info("SCHOOL payment for orderId {} already claimed/processed by another "
                                + "event or replica; skipping duplicate '{}' to avoid double allocation.",
                                orderId, eventType);
                        break;
                    }

                    extractAndSavePaymentMethod(orderId, instituteId, paymentEntity);
                    generateAndStoreRazorpayInvoice(orderId, instituteId, paymentEntity);

                    // 1. Update PaymentLog status ONLY (no regular post-payment logic)
                    paymentLogService.updatePaymentLogOnly(orderId, PaymentLogStatusEnum.SUCCESS.name(),
                            PaymentStatusEnum.PAID.name(), null);

                    if (paymentLog.getUserPlan() != null) {
                        String userPlanId = paymentLog.getUserPlan().getId();
                        BigDecimal amount = paymentLog.getPaymentAmount() != null
                                ? BigDecimal.valueOf(paymentLog.getPaymentAmount())
                                : BigDecimal.ZERO;

                        // 2. Allocate payment to fee bills
                        feeLedgerAllocationService.allocatePayment(orderId, amount, userPlanId);

                        // 2b. Ledger: credit the money against the learner's account.
                        // This branch settles CPO/school fee installments and is the ONLY
                        // confirmation the account ledger gets for them — the generic
                        // enrollment path (UserPlanService.applyOperationsOnFirstPayment)
                        // is never reached from here. Without it the learner accrued a
                        // DEBIT_ACCRUAL per installment and no credit ever landed, so the
                        // side-view showed the payment nowhere in Transaction History and
                        // Due/Past Due never came down. Best-effort: a ledger write must
                        // never cost us the allocation or the receipt.
                        try {
                            userAccountLedgerService.recordCreditPayment(
                                    paymentLog.getUserId(), instituteId,
                                    amount,
                                    paymentLog.getCurrency() != null ? paymentLog.getCurrency() : "INR",
                                    "USER_PLAN", userPlanId,
                                    orderId, null, "Fee payment received");
                        } catch (Exception e) {
                            log.error("Failed to record ledger credit for SCHOOL payment orderId {}: {}",
                                    orderId, e.getMessage());
                        }

                        // 3. Update UserPlan status to ACTIVE (Batch status handled as well if needed,
                        // but normally just activating plan is enough or we rely on the normal flow.
                        // Since plan is active, learner can access.)
                        userPlanService.updateUserPlanStatuses(java.util.List.of(userPlanId),
                                UserPlanStatusEnum.ACTIVE.name());

                        // 4. Generate and send School Receipt
                        String paymentId = paymentEntity.has("id") ? paymentEntity.get("id").asText() : null;
                        schoolFeeReceiptService.generateAndSendReceipt(paymentLog.getUserId(), userPlanId, orderId,
                                instituteId, amount, paymentId, "ONLINE");

                        // 5. Generate a real (downloadable) tax invoice. Without this the
                        // payment-history tab can only synthesize a "PAID-<sfp>" row with no PDF
                        // (no real Invoice exists), so the learner/admin gets no download button and
                        // a non-"INV" number. Runs AFTER allocation so the invoice line items reflect
                        // the installments settled by this payment. Email is suppressed (sendEmail=false)
                        // because the fee receipt above already notifies the learner. Best-effort —
                        // never fail the webhook over invoice generation.
                        try {
                            invoiceService.generateInvoice(paymentLog.getUserPlan(), paymentLog, instituteId, false);
                        } catch (Exception e) {
                            log.error("Failed to generate invoice for SCHOOL payment orderId {}: {}", orderId,
                                    e.getMessage());
                        }
                    }
                    break;

                case "payment.failed":
                    log.warn("School payment failed for orderId: {}", orderId);

                    paymentLogService.updatePaymentLogOnly(orderId, PaymentLogStatusEnum.FAILED.name(),
                            PaymentStatusEnum.FAILED.name(), null);

                    if (paymentLog.getUserPlan() != null) {
                        String userPlanId = paymentLog.getUserPlan().getId();

                        // 1. Update UserPlan back to PAYMENT_FAILED
                        userPlanService.updateUserPlanStatuses(java.util.List.of(userPlanId),
                                UserPlanStatusEnum.PAYMENT_FAILED.name());
                        // Note: Batch status should ideally be updated to PAYMENT_FAILED, but updating
                        // the plan status explicitly handles the main restriction.
                    }
                    break;
            }
        } catch (Exception e) {
            log.error("Error processing school payment webhook for orderId: {}", orderId, e);
        }
    }
}
