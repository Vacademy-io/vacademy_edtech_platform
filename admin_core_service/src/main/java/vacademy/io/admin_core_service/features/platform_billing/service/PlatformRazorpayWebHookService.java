package vacademy.io.admin_core_service.features.platform_billing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.payments.enums.WebHookStatus;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.payments.service.WebHookService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.CaptureOutcome;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.CapturedPayment;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.RefundEvent;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.common.payment.enums.PaymentType;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Webhook handler for Razorpay events on the *platform's* Razorpay account
 * (institute -> platform: AI credit packs and AI plan subscriptions).
 *
 * Distinct from {@code RazorpayWebHookService} which handles per-institute
 * Razorpay accounts (institute -> learner enrollment).
 *
 * Pipeline:
 *   1. Persist raw event in `web_hook` with vendor='RAZORPAY_PLATFORM'
 *   2. Verify HMAC-SHA256 signature against the platform webhook secret
 *   3. Parse event type + notes.payment_type (AI_CREDIT_PACK | AI_SUBSCRIPTION; anything else
 *      is acked and skipped)
 *   4. Switch on event type:
 *        payment.captured / order.paid -> fulfil (see below)
 *        payment.failed                -> mark FAILED (never a settled row)
 *        refund.processed/created      -> cumulative refund status; credit reversal (packs) or
 *                                         the subscription handler; never a 500. A NORMAL
 *                                         subscription payment acts on refund.processed only
 *                                         (refund.created is recorded as pending: no credit
 *                                         note, no cancellation for money that has not moved)
 *        refund.failed                 -> pending refund cleared, alerted
 *        token.*                       -> autopay mandate events, to the subscription handler
 *
 * Fulfilment (F1, critique #8 / #10):
 *   - Runs in one short transaction holding SELECT ... FOR UPDATE on the platform_payment row,
 *     so payment.captured and order.paid can never fulfil the same payment twice.
 *   - The paid amount and currency must equal the row's server-side total snapshot; a mismatch
 *     is alerted and left for staff (200, no retry loop, nothing granted).
 *   - The downstream step runs FIRST (credit grant for packs, ai_service /charges/{id}/paid via
 *     {@link SubscriptionPaymentHandler} for subscriptions). If it throws, nothing is written and
 *     the webhook returns 500, so Razorpay retries. PAID is written only after it succeeds.
 *   - Invoice + confirmation email run after the commit, outside the lock, by the thread that
 *     made the payment PAID; a later event for a PAID payment is a no-op (as before).
 *
 * Duplicate / late payments (critique #7): a second payment for an already-PAID order gets its
 * own platform_payment row with disposition DUPLICATE; a subscription payment the handler
 * reports DUPLICATE / LATE keeps its row with that disposition. Either way the money is refunded
 * once by {@link #autoRefund} (refund_requested_at written before the Razorpay call,
 * amount_refunded checked first, failures alerted, never a 500), and the row is never invoiced or
 * credit-noted. Their refund events only update the row's own status.
 *
 * Idempotency at storage level: credit_transactions has a partial UNIQUE index on
 * external_reference_id (V243); platform_payment.vendor_payment_id is unique (V590);
 * platform_invoice.platform_payment_id is unique.
 */
@Slf4j
@Service
public class PlatformRazorpayWebHookService {

    /** notes.payment_type values this handler owns. */
    static final Set<String> PLATFORM_PAYMENT_TYPES =
            Set.of(PaymentType.AI_CREDIT_PACK.name(), PaymentType.AI_SUBSCRIPTION.name());

    static final String EVENT_TOKEN_PREFIX = "token.";

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final WebHookService webHookService;
    private final PlatformPaymentConfigService configService;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformPaymentItemRepository paymentItemRepository;
    private final PlatformInvoiceService platformInvoiceService;
    private final PlatformInvoicePdfService platformInvoicePdfService;
    private final CreditClient creditClient;
    private final InstituteRepository instituteRepository;
    private final PaymentNotificatonService paymentNotificationService;
    private final RazorpayPaymentManager razorpayPaymentManager;
    private final ObjectProvider<SubscriptionPaymentHandler> subscriptionHandlerProvider;
    /** REQUIRES_NEW: each lock is held only for its own short transaction. */
    private final TransactionTemplate txTemplate;

    public PlatformRazorpayWebHookService(
            WebHookService webHookService,
            PlatformPaymentConfigService configService,
            PlatformPaymentRepository paymentRepository,
            PlatformPaymentItemRepository paymentItemRepository,
            PlatformInvoiceService platformInvoiceService,
            PlatformInvoicePdfService platformInvoicePdfService,
            CreditClient creditClient,
            InstituteRepository instituteRepository,
            PaymentNotificatonService paymentNotificationService,
            RazorpayPaymentManager razorpayPaymentManager,
            ObjectProvider<SubscriptionPaymentHandler> subscriptionHandlerProvider,
            PlatformTransactionManager transactionManager) {
        this.webHookService = webHookService;
        this.configService = configService;
        this.paymentRepository = paymentRepository;
        this.paymentItemRepository = paymentItemRepository;
        this.platformInvoiceService = platformInvoiceService;
        this.platformInvoicePdfService = platformInvoicePdfService;
        this.creditClient = creditClient;
        this.instituteRepository = instituteRepository;
        this.paymentNotificationService = paymentNotificationService;
        this.razorpayPaymentManager = razorpayPaymentManager;
        this.subscriptionHandlerProvider = subscriptionHandlerProvider;
        this.txTemplate = new TransactionTemplate(transactionManager);
        this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** What one fulfilment attempt did. */
    public enum FulfilResult {
        /** This call made the payment PAID (downstream done, invoice + email attempted). */
        FULFILLED,
        /** Already PAID by this same payment id (repeat event): nothing done. */
        ALREADY_FULFILLED,
        /** A different payment for an already-paid order, or a handler DUPLICATE / LATE: refunded. */
        REFUND_REQUIRED,
        /** Paid amount / currency differs from the server-side total: alerted, left for staff. */
        AMOUNT_MISMATCH,
        /** The subscription handler refused it without a refund (HELD): alerted, left for staff. */
        HELD,
        /** No platform_payment row for this id. */
        NOT_FOUND
    }

    public ResponseEntity<String> handleWebhook(String payload, String signature) {
        log.info("Received platform-Razorpay webhook payload (length={})",
                payload == null ? 0 : payload.length());

        // 1. Persist raw event
        String webhookId = webHookService.saveWebhook("RAZORPAY_PLATFORM", payload, null);

        try {
            // 2a. Route check BEFORE signature verify. If both this URL and the
            // institute URL are registered on the same Razorpay account, every
            // institute-marketplace event is also delivered here — signed with the
            // institute's secret, so it would fail verification, 400, and be retried
            // by Razorpay forever. Acking an unverified foreign event is safe: we
            // read notes.payment_type for routing only and change no state.
            String earlyPaymentType = extractPaymentType(extractPaymentEntity(objectMapper.readTree(payload)));
            if (earlyPaymentType != null && !PLATFORM_PAYMENT_TYPES.contains(earlyPaymentType)) {
                log.info("Platform webhook received {} event — not ours, acking without action",
                        earlyPaymentType);
                webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                        "Skipped (pre-verify): payment_type=" + earlyPaymentType);
                return ResponseEntity.ok("Skipped");
            }

            // 2b. Signature verify
            if (signature == null || signature.isBlank()) {
                webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED,
                        "Missing X-Razorpay-Signature header");
                return ResponseEntity.status(400).body("Missing signature");
            }
            String webhookSecret = configService.getWebhookSecret();
            if (!verifySignature(payload, signature, webhookSecret)) {
                log.error("Platform-Razorpay webhook signature verification failed");
                webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED,
                        "Invalid signature");
                return ResponseEntity.status(400).body("Invalid signature");
            }

            // 3. Parse
            JsonNode root = objectMapper.readTree(payload);
            String eventType = textOrNull(root, "event");
            JsonNode paymentEntity = extractPaymentEntity(root);
            JsonNode refundEntity = extractRefundEntity(root);

            // Defense-in-depth: only platform payment types should arrive here. If
            // somebody mis-routes Razorpay events, ignore and ack so retries stop.
            if (paymentEntity != null) {
                String paymentType = extractPaymentType(paymentEntity);
                if (paymentType != null && !PLATFORM_PAYMENT_TYPES.contains(paymentType)) {
                    log.warn("Platform webhook received a non-platform event "
                            + "(payment_type={}, event={}) — ignoring", paymentType, eventType);
                    webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                            "Skipped: payment_type=" + paymentType);
                    return ResponseEntity.ok("Skipped");
                }
            }

            if (eventType == null) {
                webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                        "Event type missing");
                return ResponseEntity.ok("No event type");
            }

            // 4. Route by event
            switch (eventType) {
                case "payment.captured":
                case "order.paid": {
                    if (paymentEntity == null) {
                        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                                "No payment entity in event");
                        return ResponseEntity.ok("No payment entity");
                    }
                    String orderId = resolvePlatformPaymentId(root, paymentEntity);
                    webHookService.updateWebHook(webhookId, payload, orderId, eventType);
                    if (orderId == null) {
                        log.warn("Platform webhook {}: no platform_payment for payment {} — acking",
                                eventType, textOrNull(paymentEntity, "id"));
                        break;
                    }
                    FulfilResult result = fulfil(orderId, toCaptured(paymentEntity));
                    if (result == FulfilResult.AMOUNT_MISMATCH) {
                        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                                "Amount mismatch: left for staff");
                        return ResponseEntity.ok("Amount mismatch");
                    }
                    if (result == FulfilResult.HELD) {
                        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                                "Held by the subscription handler: left for staff");
                        return ResponseEntity.ok("Held");
                    }
                    break;
                }

                case "payment.failed": {
                    if (paymentEntity == null) {
                        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                                "No payment entity in event");
                        return ResponseEntity.ok("No payment entity");
                    }
                    String failedOrderId = resolvePlatformPaymentId(root, paymentEntity);
                    webHookService.updateWebHook(webhookId, payload, failedOrderId, eventType);
                    handlePaymentFailure(failedOrderId, paymentEntity);
                    break;
                }

                case "refund.processed":
                case "refund.created":
                case "refund.failed": {
                    if (refundEntity == null) {
                        webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED,
                                "No refund entity in event");
                        return ResponseEntity.ok("No refund entity");
                    }
                    String refundedPaymentId = textOrNull(refundEntity, "payment_id");
                    webHookService.updateWebHook(webhookId, payload, refundedPaymentId, eventType);
                    if ("refund.failed".equals(eventType)) {
                        handleRefundFailed(refundEntity);
                    } else {
                        handleRefund(eventType, refundEntity, paymentEntity);
                    }
                    break;
                }

                default:
                    if (eventType.startsWith(EVENT_TOKEN_PREFIX)) {
                        handleTokenEvent(eventType, root);
                        break;
                    }
                    log.info("Platform-Razorpay event {} not handled — ack and skip", eventType);
                    break;
            }

            webHookService.updateWebHookStatus(webhookId, WebHookStatus.PROCESSED, null);
            return ResponseEntity.ok("OK");

        } catch (Exception e) {
            log.error("Platform-Razorpay webhook processing failed", e);
            webHookService.updateWebHookStatus(webhookId, WebHookStatus.FAILED, e.getMessage());
            return ResponseEntity.status(500).body("Processing failed");
        }
    }

    // ───────────────────────────────────────────────────────────────
    // Fulfilment
    // ───────────────────────────────────────────────────────────────

    /**
     * Manual / reconcile fulfilment of a stuck platform_payment (used by
     * {@code PlatformBillingAdminController.fulfillPayment} and the reconcile job). The payment is
     * fetched from Razorpay and must be captured, carry this order's {@code notes.orderId} (or
     * this row's order / invoice id) and match the server-side total, so a typo in the request
     * body can never grant credits or activate a plan (critique B). Then it runs exactly the
     * webhook's {@link #fulfil} path.
     *
     * @param platformPaymentId  our platform_payment.id
     * @param razorpayPaymentId  Razorpay's pay_* id
     * @throws VacademyException when the payment cannot be verified
     */
    public FulfilResult fulfillCreditPackPayment(String platformPaymentId, String razorpayPaymentId) {
        if (platformPaymentId == null || !StringUtils.hasText(razorpayPaymentId)) {
            throw new VacademyException("platform_payment id and Razorpay payment id are required");
        }
        PlatformPayment row = paymentRepository.findById(platformPaymentId)
                .orElseThrow(() -> new VacademyException("platform_payment not found: " + platformPaymentId));
        Map<String, Object> fetched = razorpayPaymentManager.fetchPayment(
                razorpayPaymentId.trim(), configService.getRazorpayCredsMap());
        JsonNode entity = objectMapper.valueToTree(fetched);
        verifyFetchedPayment(row, entity);
        return fulfil(platformPaymentId, toCaptured(entity));
    }

    /** A fetched payment must be captured and belong to this platform_payment. Package-private for tests. */
    static void verifyFetchedPayment(PlatformPayment row, JsonNode entity) {
        String status = textOrNull(entity, "status");
        if (!"captured".equalsIgnoreCase(status)) {
            throw new VacademyException("Razorpay payment is not captured (status=" + status + ")");
        }
        JsonNode notes = entity.get("notes");
        String noteOrder = notes != null && notes.isObject() ? textOrNull(notes, "orderId") : null;
        if (noteOrder != null) {
            if (!noteOrder.equals(row.getId())) {
                throw new VacademyException("Razorpay payment belongs to order " + noteOrder
                        + ", not " + row.getId());
            }
            return;
        }
        String vendorOrderId = row.getVendorOrderId();
        if (vendorOrderId != null && (vendorOrderId.equals(textOrNull(entity, "order_id"))
                || vendorOrderId.equals(textOrNull(entity, "invoice_id")))) {
            return;
        }
        throw new VacademyException("Razorpay payment carries no reference to platform_payment " + row.getId());
    }

    /** Outcome of the locked step; the follow-ups run after the commit. */
    private record LockedStep(FulfilResult result, PlatformPayment payment, List<PlatformPaymentItem> items,
            boolean subscription, String refundRowId) {}

    /**
     * The webhook fulfilment path (see the class comment). Public so the reconcile job can call
     * it with a payment it fetched itself.
     */
    public FulfilResult fulfil(String platformPaymentId, CapturedPayment captured) {
        if (platformPaymentId == null) {
            log.error("Cannot fulfill: platformPaymentId is missing");
            return FulfilResult.NOT_FOUND;
        }
        if (captured == null || !StringUtils.hasText(captured.vendorPaymentId())) {
            throw new VacademyException("Cannot fulfil platform_payment " + platformPaymentId
                    + ": the Razorpay payment id is missing");
        }

        LockedStep step = txTemplate.execute(status -> lockedFulfil(platformPaymentId, captured));
        if (step == null) {
            return FulfilResult.NOT_FOUND;
        }

        switch (step.result()) {
            case FULFILLED -> afterPaid(step);
            case REFUND_REQUIRED -> autoRefund(step.refundRowId(), "DUPLICATE_OR_LATE");
            case AMOUNT_MISMATCH -> SentryLogger.logWarning(
                    "Platform payment amount mismatch; nothing granted, left for staff",
                    Map.of("platform_payment_id", platformPaymentId,
                            "vendor_payment_id", captured.vendorPaymentId(),
                            "paid_minor", String.valueOf(captured.amountMinor())));
            case HELD -> SentryLogger.logWarning(
                    "Platform subscription payment held; not marked paid, not refunded, left for staff",
                    Map.of("platform_payment_id", platformPaymentId,
                            "vendor_payment_id", captured.vendorPaymentId(),
                            "paid_minor", String.valueOf(captured.amountMinor())));
            default -> { }
        }
        return step.result();
    }

    private LockedStep lockedFulfil(String platformPaymentId, CapturedPayment c) {
        Optional<PlatformPayment> opt = paymentRepository.findByIdForUpdate(platformPaymentId);
        if (opt.isEmpty()) {
            log.error("platform_payment not found for id={}", platformPaymentId);
            return new LockedStep(FulfilResult.NOT_FOUND, null, List.of(), false, null);
        }
        PlatformPayment payment = opt.get();

        // This exact Razorpay payment is already recorded (on this row or a stray row).
        Optional<PlatformPayment> byVendorId = paymentRepository.findByVendorPaymentId(c.vendorPaymentId());
        if (byVendorId.isPresent()) {
            PlatformPayment recorded = byVendorId.get();
            if (!recorded.getId().equals(payment.getId())) {
                log.info("Payment {} already recorded on platform_payment {} — no-op",
                        c.vendorPaymentId(), recorded.getId());
                boolean stray = recorded.getDisposition() != null
                        && recorded.getDisposition() != PlatformPaymentDisposition.NORMAL;
                return new LockedStep(stray ? FulfilResult.REFUND_REQUIRED : FulfilResult.ALREADY_FULFILLED,
                        recorded, List.of(), false, stray ? recorded.getId() : null);
            }
        }

        if (isSettled(payment)) {
            if (payment.getVendorPaymentId() == null || c.vendorPaymentId().equals(payment.getVendorPaymentId())) {
                log.info("platform_payment {} already in terminal state {} — no-op",
                        platformPaymentId, payment.getPaymentStatus());
                boolean stray = payment.getDisposition() != null
                        && payment.getDisposition() != PlatformPaymentDisposition.NORMAL;
                return new LockedStep(stray ? FulfilResult.REFUND_REQUIRED : FulfilResult.ALREADY_FULFILLED,
                        payment, List.of(), false, stray ? payment.getId() : null);
            }
            // A second, different payment for an order that is already paid.
            PlatformPayment stray = recordStrayPayment(payment, c, PlatformPaymentDisposition.DUPLICATE);
            log.warn("Duplicate payment {} for already-paid platform_payment {} recorded as {} — refunding",
                    c.vendorPaymentId(), payment.getId(), stray.getId());
            return new LockedStep(FulfilResult.REFUND_REQUIRED, stray, List.of(), false, stray.getId());
        }

        if (!amountMatches(payment, c)) {
            log.error("Amount mismatch on platform_payment {}: paid {} {} vs expected {} {}",
                    payment.getId(), c.amountMinor(), c.currency(),
                    payment.getTotalAmountMinor(), payment.getCurrency());
            payment.setPaymentSpecificData(withNote(payment.getPaymentSpecificData(), "amountMismatch",
                    objectMapper.createObjectNode()
                            .put("vendorPaymentId", c.vendorPaymentId())
                            .put("paidMinor", c.amountMinor())
                            .put("currency", c.currency())
                            .put("at", Instant.now().toString())));
            paymentRepository.save(payment);
            return new LockedStep(FulfilResult.AMOUNT_MISMATCH, payment, List.of(), false, null);
        }

        List<PlatformPaymentItem> items = paymentItemRepository.findByPlatformPaymentId(payment.getId());
        boolean subscription = hasSubscriptionItem(items);

        if (subscription) {
            SubscriptionPaymentHandler handler = subscriptionHandlerProvider.getIfAvailable();
            if (handler == null) {
                // Throw = 500 = Razorpay retries until the handler is deployed. Never mark PAID.
                throw new VacademyException("No subscription payment handler for platform_payment "
                        + payment.getId());
            }
            CaptureOutcome outcome = handler.onPaymentCaptured(payment, items, c);
            if (outcome == CaptureOutcome.FULFILLED) {
                // the handler aligned the item's service period / text with what was supplied
                paymentItemRepository.saveAll(items);
            }
            if (outcome == CaptureOutcome.HELD) {
                payment.setPaymentSpecificData(withNote(payment.getPaymentSpecificData(), "subscriptionHeld",
                        objectMapper.createObjectNode()
                                .put("vendorPaymentId", c.vendorPaymentId())
                                .put("paidMinor", c.amountMinor())
                                .put("at", Instant.now().toString())));
                paymentRepository.save(payment);
                return new LockedStep(FulfilResult.HELD, payment, List.of(), false, null);
            }
            if (outcome == CaptureOutcome.DUPLICATE || outcome == CaptureOutcome.LATE) {
                payment.setDisposition(outcome == CaptureOutcome.DUPLICATE
                        ? PlatformPaymentDisposition.DUPLICATE : PlatformPaymentDisposition.LATE);
                markPaid(payment, c);
                paymentRepository.save(payment);
                return new LockedStep(FulfilResult.REFUND_REQUIRED, payment, items, true, payment.getId());
            }
        } else {
            // Credit pack: grant FIRST (throws on any failure -> 500 -> Razorpay retries).
            BigDecimal totalCredits = sumCredits(items);
            String packCode = items.isEmpty() ? null : items.get(0).getPackCodeSnapshot();
            creditClient.grantFromPayment(
                    payment.getInstituteId(),
                    totalCredits,
                    c.vendorPaymentId(),          // -> credit_transactions.external_reference_id
                    payment.getId(),              // -> credit_transactions.reference_id
                    packCode);
        }

        // Only after the downstream step succeeded.
        markPaid(payment, c);
        paymentRepository.save(payment);
        return new LockedStep(FulfilResult.FULFILLED, payment, items, subscription, null);
    }

    private void afterPaid(LockedStep step) {
        PlatformPayment payment = step.payment();
        if (step.subscription()) {
            SubscriptionPaymentHandler handler = subscriptionHandlerProvider.getIfAvailable();
            if (handler != null) {
                try {
                    handler.afterPaid(payment, step.items());
                } catch (Exception e) {
                    log.error("Subscription afterPaid failed for platform_payment {}: {}",
                            payment.getId(), e.getMessage(), e);
                }
            }
            return;
        }

        // Credit pack: render + persist the GST invoice, then email confirmation. Both wrapped in
        // try/catch — credits are already granted, so a billing-side failure
        // shouldn't 500 the webhook (Razorpay would just retry).
        PlatformInvoice invoice = null;
        try {
            invoice = platformInvoiceService.generateInvoice(payment.getId());
        } catch (Exception e) {
            log.error("Invoice generation failed for platform_payment {}: {}",
                    payment.getId(), e.getMessage(), e);
        }

        try {
            sendPurchaseEmail(payment, step.items(), sumCredits(step.items()), invoice);
        } catch (Exception e) {
            log.error("Confirmation email failed for platform_payment {}: {}",
                    payment.getId(), e.getMessage(), e);
        }
    }

    /** A new row for a second payment against an already-paid order (never invoiced). */
    private PlatformPayment recordStrayPayment(PlatformPayment original, CapturedPayment c,
            PlatformPaymentDisposition disposition) {
        PlatformPayment p = new PlatformPayment();
        p.setInstituteId(original.getInstituteId());
        p.setBuyerUserId(original.getBuyerUserId());
        p.setVendor(original.getVendor());
        p.setCurrency(StringUtils.hasText(c.currency()) ? c.currency().toUpperCase() : original.getCurrency());
        p.setBaseAmountMinor(c.amountMinor());
        p.setTaxAmountMinor(0L);
        p.setTotalAmountMinor(c.amountMinor());
        p.setBuyerLegalName(original.getBuyerLegalName());
        p.setBuyerGstin(original.getBuyerGstin());
        p.setBuyerStateCode(original.getBuyerStateCode());
        p.setBuyerAddress(original.getBuyerAddress());
        p.setPlaceOfSupply(original.getPlaceOfSupply());
        p.setTaxHead(original.getTaxHead());
        p.setBrandMode(original.getBrandMode());
        p.setDisposition(disposition);
        ObjectNode data = objectMapper.createObjectNode();
        data.put("snapshotKind", "stray_payment");
        data.put("strayOf", original.getId());
        data.put("reason", disposition.name());
        p.setPaymentSpecificData(data.toString());
        markPaid(p, c);
        return paymentRepository.saveAndFlush(p);
    }

    private static void markPaid(PlatformPayment payment, CapturedPayment c) {
        payment.setStatus(PlatformPaymentStatus.SUCCESS);
        payment.setPaymentStatus(PlatformPaymentResult.PAID);
        payment.setVendorPaymentId(c.vendorPaymentId());
        if (payment.getPaidAt() == null) {
            payment.setPaidAt(Instant.now());
        }
    }

    /** Paid amount and currency equal the server-side snapshot (critique #10). Package-private for tests. */
    static boolean amountMatches(PlatformPayment payment, CapturedPayment c) {
        Long expected = payment.getTotalAmountMinor();
        if (expected == null || c.amountMinor() != expected) {
            return false;
        }
        return c.currency() == null || payment.getCurrency() == null
                || c.currency().equalsIgnoreCase(payment.getCurrency());
    }

    private static boolean isSettled(PlatformPayment p) {
        PlatformPaymentResult r = p.getPaymentStatus();
        return r == PlatformPaymentResult.PAID
                || r == PlatformPaymentResult.REFUNDED
                || r == PlatformPaymentResult.PARTIALLY_REFUNDED;
    }

    static boolean hasSubscriptionItem(List<PlatformPaymentItem> items) {
        if (items == null) return false;
        for (PlatformPaymentItem i : items) {
            if (i.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION) return true;
        }
        return false;
    }

    private static BigDecimal sumCredits(List<PlatformPaymentItem> items) {
        return items.stream()
                .map(PlatformPaymentItem::getCredits)
                .filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    // ───────────────────────────────────────────────────────────────
    // Automatic refund of DUPLICATE / LATE payments (critique #7)
    // ───────────────────────────────────────────────────────────────

    /**
     * Refund a DUPLICATE / LATE payment in full, at most once. {@code refund_requested_at} is
     * written (and committed) before Razorpay is called, so a retried webhook never refunds
     * twice; Razorpay's {@code amount_refunded} is checked first, and the refund carries a
     * receipt (Razorpay's refund idempotency key). A NORMAL payment is never auto-refunded.
     * Never throws: a failure is alerted and must be finished by hand.
     *
     * @return true when a refund was requested by this call
     */
    public boolean autoRefund(String platformPaymentId, String reason) {
        if (platformPaymentId == null) return false;
        PlatformPayment claimed;
        try {
            claimed = txTemplate.execute(status -> {
                PlatformPayment p = paymentRepository.findByIdForUpdate(platformPaymentId).orElse(null);
                if (p == null || p.getVendorPaymentId() == null) return null;
                if (p.getDisposition() == null || p.getDisposition() == PlatformPaymentDisposition.NORMAL) {
                    log.error("Refusing to auto-refund NORMAL platform_payment {}", platformPaymentId);
                    return null;
                }
                if (p.getRefundRequestedAt() != null) {
                    log.info("Auto-refund already requested for platform_payment {} at {}",
                            platformPaymentId, p.getRefundRequestedAt());
                    return null;
                }
                p.setRefundRequestedAt(Instant.now());
                return paymentRepository.save(p);
            });
        } catch (Exception e) {
            alertRefund(platformPaymentId, null, "claim failed", e);
            return false;
        }
        if (claimed == null) return false;

        String payId = claimed.getVendorPaymentId();
        try {
            Map<String, Object> creds = configService.getRazorpayCredsMap();
            Map<String, Object> rp = razorpayPaymentManager.fetchPayment(payId, creds);
            long amount = asLong(rp.get("amount"), claimed.getTotalAmountMinor() == null ? 0L : claimed.getTotalAmountMinor());
            long alreadyRefunded = asLong(rp.get("amount_refunded"), 0L);
            long toRefund = amount - alreadyRefunded;
            if (toRefund <= 0) {
                log.info("Payment {} is already fully refunded on Razorpay — nothing to do", payId);
                return false;
            }
            razorpayPaymentManager.refundPayment(payId, toRefund, "ar-" + claimed.getId(),
                    Map.of("platform_payment_id", claimed.getId(),
                            "reason", reason == null ? "AUTO_REFUND" : reason,
                            "disposition", claimed.getDisposition().name()),
                    creds);
            log.warn("Auto-refund of {} paise requested for {} payment {} (platform_payment {})",
                    toRefund, claimed.getDisposition(), payId, claimed.getId());
            return true;
        } catch (Exception e) {
            alertRefund(claimed.getId(), payId, "Razorpay refund failed", e);
            return false;
        }
    }

    private static void alertRefund(String platformPaymentId, String payId, String what, Exception e) {
        log.error("[platform-billing] auto-refund {} for platform_payment {} (payment {}): {}",
                what, platformPaymentId, payId, e.getMessage(), e);
        SentryLogger.logError(e, "Platform auto-refund " + what + "; finish it by hand in Razorpay",
                Map.of("platform_payment_id", String.valueOf(platformPaymentId),
                        "vendor_payment_id", String.valueOf(payId)));
    }

    // ───────────────────────────────────────────────────────────────
    // payment.failed
    // ───────────────────────────────────────────────────────────────

    private void handlePaymentFailure(String platformPaymentId, JsonNode paymentEntity) {
        if (platformPaymentId == null) return;
        PlatformPayment failed = txTemplate.execute(status -> {
            PlatformPayment payment = paymentRepository.findByIdForUpdate(platformPaymentId).orElse(null);
            if (payment == null) return null;
            if (isSettled(payment)) {
                log.warn("Got payment.failed for already-settled platform_payment {} ({}) — ignoring",
                        platformPaymentId, payment.getPaymentStatus());
                return null;
            }
            payment.setStatus(PlatformPaymentStatus.FAILED);
            payment.setPaymentStatus(PlatformPaymentResult.FAILED);
            paymentRepository.save(payment);
            log.info("platform_payment {} marked FAILED", platformPaymentId);
            return payment;
        });
        if (failed == null) return;
        List<PlatformPaymentItem> items = paymentItemRepository.findByPlatformPaymentId(failed.getId());
        if (hasSubscriptionItem(items)) {
            SubscriptionPaymentHandler handler = subscriptionHandlerProvider.getIfAvailable();
            if (handler != null) {
                try {
                    handler.onPaymentFailed(failed, items, paymentEntity);
                } catch (Exception e) {
                    log.error("Subscription onPaymentFailed failed for platform_payment {}: {}",
                            failed.getId(), e.getMessage(), e);
                }
            }
        }
    }

    // ───────────────────────────────────────────────────────────────
    // Refunds (F10 cumulative; critique #7 disposition; never a 500 loop)
    // ───────────────────────────────────────────────────────────────

    private record RefundWork(PlatformPayment payment, List<PlatformPaymentItem> items, boolean reverseCredits,
            long cumulative, boolean fully, boolean pendingOnly) {}

    static final String DATA_REFUNDS_PENDING = "refundsPending";

    /** Pack path and older callers: a processed refund. */
    void handleRefund(JsonNode refundEntity, JsonNode paymentEntity) {
        handleRefund("refund.processed", refundEntity, paymentEntity);
    }

    /**
     * refund.failed: the money stayed with us. A refund still pending on the row is cleared (no
     * credit note was issued for it: subscriptions wait for refund.processed) and staff are alerted.
     * A pack refund's credit reversal (done on refund.created, unchanged) is left for staff.
     */
    void handleRefundFailed(JsonNode refundEntity) {
        String razorpayPaymentId = textOrNull(refundEntity, "payment_id");
        String refundId = textOrNull(refundEntity, "id");
        if (razorpayPaymentId == null || refundId == null) {
            return;
        }
        try {
            txTemplate.executeWithoutResult(status -> paymentRepository.findByVendorPaymentIdForUpdate(razorpayPaymentId)
                    .ifPresent(p -> {
                        ObjectNode data = readData(p.getPaymentSpecificData());
                        if (data.get(DATA_REFUNDS_PENDING) instanceof ObjectNode pending && pending.has(refundId)) {
                            pending.remove(refundId);
                            ObjectNode failed = data.has("refundsFailed") && data.get("refundsFailed").isObject()
                                    ? (ObjectNode) data.get("refundsFailed") : data.putObject("refundsFailed");
                            failed.put(refundId, Instant.now().toString());
                            p.setPaymentSpecificData(data.toString());
                            p.setRefundRequestedAt(null);
                            paymentRepository.save(p);
                        }
                    }));
        } catch (Exception e) {
            log.error("Could not clear failed refund {} on payment {}: {}", refundId, razorpayPaymentId, e.getMessage());
        }
        SentryLogger.logWarning("Platform refund FAILED at Razorpay; the money was not returned — retry or settle by hand",
                Map.of("vendor_payment_id", razorpayPaymentId, "refund_id", refundId));
    }

    void handleRefund(String eventType, JsonNode refundEntity, JsonNode paymentEntity) {
        boolean processed = !"refund.created".equals(eventType);
        String razorpayPaymentId = textOrNull(refundEntity, "payment_id");
        String refundId = textOrNull(refundEntity, "id");
        long refundAmountMinor = refundEntity.has("amount") ? refundEntity.get("amount").asLong() : 0L;
        if (razorpayPaymentId == null || refundId == null) {
            log.warn("Refund event missing payment_id or refund_id — ignoring");
            return;
        }
        Long razorpayCumulative = paymentEntity != null && paymentEntity.has("amount_refunded")
                && !paymentEntity.get("amount_refunded").isNull()
                ? paymentEntity.get("amount_refunded").asLong() : null;
        try {
            RefundWork work = txTemplate.execute(status ->
                    lockedRecordRefund(razorpayPaymentId, refundId, refundAmountMinor, razorpayCumulative, processed));
            if (work == null || work.pendingOnly()) return;
            PlatformPayment payment = work.payment();
            if (payment.getDisposition() != null && payment.getDisposition() != PlatformPaymentDisposition.NORMAL) {
                log.info("Refund {} on {} payment {} recorded; no credits, charge or credit note touched",
                        refundId, payment.getDisposition(), razorpayPaymentId);
                return;
            }
            if (hasSubscriptionItem(work.items())) {
                SubscriptionPaymentHandler handler = subscriptionHandlerProvider.getIfAvailable();
                if (handler == null) {
                    SentryLogger.logWarning("Subscription refund with no handler deployed",
                            Map.of("platform_payment_id", payment.getId(), "refund_id", refundId));
                    return;
                }
                handler.onRefund(payment, work.items(), new RefundEvent(razorpayPaymentId, refundId,
                        refundAmountMinor, work.cumulative(), work.fully(), refundEntity));
                return;
            }
            if (work.reverseCredits()) {
                reverseCredits(payment, work.items(), refundId, refundAmountMinor);
            }
        } catch (Exception e) {
            log.error("Refund {} on payment {} could not be fully processed: {}",
                    refundId, razorpayPaymentId, e.getMessage(), e);
            SentryLogger.logError(e, "Platform refund webhook processing failed (acked, no retry)",
                    Map.of("vendor_payment_id", razorpayPaymentId, "refund_id", refundId));
        }
    }

    private RefundWork lockedRecordRefund(String razorpayPaymentId, String refundId, long refundAmountMinor,
            Long razorpayCumulative, boolean processed) {
        Optional<PlatformPayment> opt = paymentRepository.findByVendorPaymentIdForUpdate(razorpayPaymentId);
        if (opt.isEmpty()) {
            log.error("platform_payment not found for refund (razorpay_payment_id={})", razorpayPaymentId);
            return null;
        }
        PlatformPayment payment = opt.get();
        ObjectNode data = readData(payment.getPaymentSpecificData());
        List<PlatformPaymentItem> subItems = paymentItemRepository.findByPlatformPaymentId(payment.getId());
        boolean normalSubscription = hasSubscriptionItem(subItems) && (payment.getDisposition() == null
                || payment.getDisposition() == PlatformPaymentDisposition.NORMAL);
        if (normalSubscription) {
            boolean known = data.get("refunds") instanceof ObjectNode r && r.has(refundId);
            if (!processed) {
                // Initiated only: shown as pending; credit note, cancellation and the ai_service
                // report wait for refund.processed (a refund can still fail).
                if (!known) {
                    ObjectNode pending = data.get(DATA_REFUNDS_PENDING) instanceof ObjectNode o ? o
                            : data.putObject(DATA_REFUNDS_PENDING);
                    pending.putObject(refundId).put("amountMinor", refundAmountMinor).put("at", Instant.now().toString());
                    payment.setPaymentSpecificData(data.toString());
                    paymentRepository.save(payment);
                }
                return new RefundWork(payment, subItems, false, 0L, false, true);
            }
            if (data.get(DATA_REFUNDS_PENDING) instanceof ObjectNode pending) {
                pending.remove(refundId);
            }
            // Razorpay's amount_refunded can include refunds still pending: only processed ones count.
            razorpayCumulative = null;
        }
        ObjectNode refunds = data.has("refunds") && data.get("refunds").isObject()
                ? (ObjectNode) data.get("refunds") : data.putObject("refunds");
        ObjectNode entry = refunds.has(refundId) && refunds.get(refundId).isObject()
                ? (ObjectNode) refunds.get(refundId) : null;
        if (entry == null) {
            entry = refunds.putObject(refundId);
            entry.put("amountMinor", refundAmountMinor);
            entry.put("creditsReversed", false);
            entry.put("at", Instant.now().toString());
        }

        long recorded = 0L;
        for (Iterator<JsonNode> it = refunds.elements(); it.hasNext(); ) {
            JsonNode r = it.next();
            recorded += r.path("amountMinor").asLong(0L);
        }
        long cumulative = Math.max(recorded, razorpayCumulative == null ? 0L : razorpayCumulative);
        long total = payment.getTotalAmountMinor() == null ? 0L : payment.getTotalAmountMinor();
        boolean fully = total > 0 && cumulative >= total;

        payment.setRefundedAmountMinor(cumulative);
        payment.setPaymentStatus(fully ? PlatformPaymentResult.REFUNDED : PlatformPaymentResult.PARTIALLY_REFUNDED);
        payment.setPaymentSpecificData(data.toString());
        paymentRepository.save(payment);

        List<PlatformPaymentItem> items = subItems;
        boolean normal = payment.getDisposition() == null || payment.getDisposition() == PlatformPaymentDisposition.NORMAL;
        boolean reverse = normal && !hasSubscriptionItem(items) && !entry.path("creditsReversed").asBoolean(false);
        return new RefundWork(payment, items, reverse, cumulative, fully, false);
    }

    /** Pro-rated credit reversal for one pack refund; idempotent on the refund id in ai_service. */
    private void reverseCredits(PlatformPayment payment, List<PlatformPaymentItem> items, String refundId,
            long refundAmountMinor) {
        // refunded_credits = totalCredits * (refundAmountMinor / totalAmountMinor) — this refund only
        BigDecimal totalCredits = sumCredits(items);
        BigDecimal proRated = totalCredits;
        if (payment.getTotalAmountMinor() != null && payment.getTotalAmountMinor() > 0) {
            proRated = totalCredits
                    .multiply(BigDecimal.valueOf(refundAmountMinor))
                    .divide(BigDecimal.valueOf(payment.getTotalAmountMinor()), 2, java.math.RoundingMode.HALF_UP);
        }
        String packCode = items.isEmpty() ? null : items.get(0).getPackCodeSnapshot();

        Map<String, Object> result = creditClient.refundFromPayment(
                payment.getInstituteId(),
                proRated,
                refundId,           // -> credit_transactions.external_reference_id
                payment.getId(),    // -> credit_transactions.reference_id
                packCode);
        boolean ok = result != null && !Boolean.FALSE.equals(result.get("success"));
        if (!ok) {
            // Left unmarked: the next refund event for this refund id (refund.created is followed
            // by refund.processed) tries again. Acked either way: never a 500 loop.
            SentryLogger.logWarning("Credit reversal for a pack refund failed",
                    Map.of("platform_payment_id", payment.getId(), "refund_id", refundId));
            return;
        }
        txTemplate.executeWithoutResult(status ->
                paymentRepository.findByIdForUpdate(payment.getId()).ifPresent(p -> {
                    ObjectNode data = readData(p.getPaymentSpecificData());
                    JsonNode refunds = data.get("refunds");
                    if (refunds instanceof ObjectNode r && r.get(refundId) instanceof ObjectNode e) {
                        e.put("creditsReversed", true);
                        p.setPaymentSpecificData(data.toString());
                        paymentRepository.save(p);
                    }
                }));
        log.info("Refunded {} credits from platform_payment {} (refund_id={})",
                proRated, payment.getId(), refundId);
    }

    // ───────────────────────────────────────────────────────────────
    // token.* (autopay mandates)
    // ───────────────────────────────────────────────────────────────

    private void handleTokenEvent(String eventType, JsonNode root) {
        JsonNode token = root.path("payload").path("token").path("entity");
        String tokenId = textOrNull(token, "id");
        SubscriptionPaymentHandler handler = subscriptionHandlerProvider.getIfAvailable();
        if (handler == null) {
            log.info("Platform token event {} for {} with no subscription handler — acked", eventType, tokenId);
            return;
        }
        handler.onTokenEvent(eventType, token, root);
    }

    // ───────────────────────────────────────────────────────────────
    // Reconcile (lost webhooks, expired links)
    // ───────────────────────────────────────────────────────────────

    /**
     * Checks an unpaid platform_payment raised through a Payment Link ({@code vendor_order_id}
     * holds the {@code plink_} id) against Razorpay: a paid link is fulfilled through the normal
     * path (covers a lost webhook); an expired / cancelled link marks the row EXPIRED. For the
     * hourly reconcile job.
     *
     * @return the link status Razorpay reported, or null when there was nothing to check
     */
    public String reconcileFromLink(String platformPaymentId) {
        PlatformPayment p = paymentRepository.findById(platformPaymentId).orElse(null);
        if (p == null || isSettled(p) || p.getPaymentStatus() == PlatformPaymentResult.EXPIRED) return null;
        String linkId = p.getVendorOrderId();
        if (!StringUtils.hasText(linkId) || !linkId.startsWith("plink_")) return null;
        Map<String, Object> link = razorpayPaymentManager.fetchPaymentLink(linkId, configService.getRazorpayCredsMap());
        String status = link.get("status") == null ? null : link.get("status").toString();
        if ("paid".equalsIgnoreCase(status) || "partially_paid".equalsIgnoreCase(status)) {
            Object payments = link.get("payments");
            if (payments instanceof List<?> list) {
                for (Object o : list) {
                    if (o instanceof Map<?, ?> m && "captured".equalsIgnoreCase(String.valueOf(m.get("status")))
                            && m.get("paymentId") != null) {
                        fulfillCreditPackPayment(platformPaymentId, m.get("paymentId").toString());
                    }
                }
            }
        } else if ("expired".equalsIgnoreCase(status) || "cancelled".equalsIgnoreCase(status)) {
            txTemplate.executeWithoutResult(tx -> paymentRepository.findByIdForUpdate(platformPaymentId)
                    .filter(row -> !isSettled(row))
                    .ifPresent(row -> {
                        row.setStatus(PlatformPaymentStatus.EXPIRED);
                        row.setPaymentStatus(PlatformPaymentResult.EXPIRED);
                        paymentRepository.save(row);
                    }));
        }
        return status;
    }

    // ───────────────────────────────────────────────────────────────
    // Email (credit packs; subscriptions email from their handler)
    // ───────────────────────────────────────────────────────────────

    private void sendPurchaseEmail(
            PlatformPayment payment,
            List<PlatformPaymentItem> items,
            BigDecimal totalCredits,
            PlatformInvoice invoice) {
        if (invoice == null) {
            // No invoice = no invoice number to put in the email; skip until v1.1
            // adds a separate "credits added" template that doesn't need one.
            return;
        }
        Optional<Institute> buyerOpt = instituteRepository.findById(payment.getInstituteId());
        if (buyerOpt.isEmpty()) {
            log.warn("Skipping confirmation email — institute {} not found", payment.getInstituteId());
            return;
        }
        Institute buyer = buyerOpt.get();
        String email = buyer.getEmail();
        if (email == null || email.isBlank()) {
            // v1: institute billing email is the only routing target. v1.1: also
            // notify the user who clicked Buy via buyerUserId -> auth service lookup.
            log.warn("Skipping confirmation email — institute {} has no email", payment.getInstituteId());
            return;
        }

        String packName = items.isEmpty() ? "AI Credits" : items.get(0).getPackCodeSnapshot();
        String totalDisplay = formatMajor(payment.getTotalAmountMinor(), payment.getCurrency());

        // Render the GST tax invoice and attach it. A render failure must not
        // block the confirmation — the PDF is also downloadable on demand from
        // AI Credits → Billing, so fall back to the no-attachment email.
        byte[] invoicePdf = null;
        String invoiceFileName = null;
        try {
            invoicePdf = platformInvoicePdfService.renderPdf(invoice);
            invoiceFileName = platformInvoicePdfService.fileName(invoice);
        } catch (Exception e) {
            log.error("Invoice PDF render failed for {} — sending confirmation without attachment: {}",
                    invoice.getInvoiceNumber(), e.getMessage());
        }

        paymentNotificationService.sendCreditPackConfirmation(
                payment.getInstituteId(),
                email,
                payment.getBuyerUserId(),
                invoice.getInvoiceNumber(),
                totalCredits.stripTrailingZeros().toPlainString(),
                totalDisplay,
                packName,
                invoicePdf,
                invoiceFileName);
    }

    private static String formatMajor(long amountMinor, String currency) {
        double major = amountMinor / 100.0;
        String symbol = "INR".equalsIgnoreCase(currency) ? "₹"
                : "USD".equalsIgnoreCase(currency) ? "$" : "";
        return symbol + String.format(java.util.Locale.ROOT, "%.2f", major);
    }

    // ───────────────────────────────────────────────────────────────
    // JSON extractors
    // ───────────────────────────────────────────────────────────────

    private static String textOrNull(JsonNode node, String field) {
        if (node == null || !node.has(field) || node.get(field).isNull()) return null;
        return node.get(field).asText();
    }

    private static long asLong(Object v, long fallback) {
        if (v instanceof Number n) return n.longValue();
        if (v != null) {
            try {
                return Long.parseLong(v.toString());
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        return fallback;
    }

    /** The webhook / fetched payment entity as the handler sees it. Package-private for tests. */
    static CapturedPayment toCaptured(JsonNode e) {
        return new CapturedPayment(
                textOrNull(e, "id"),
                e != null && e.has("amount") && !e.get("amount").isNull() ? e.get("amount").asLong() : -1L,
                textOrNull(e, "currency"),
                textOrNull(e, "method"),
                textOrNull(e, "order_id"),
                textOrNull(e, "invoice_id"),
                textOrNull(e, "token_id"),
                textOrNull(e, "customer_id"),
                e != null && e.has("created_at") && e.get("created_at").isNumber() ? e.get("created_at").asLong() : null,
                e);
    }

    /** payload.payload.payment.entity */
    private JsonNode extractPaymentEntity(JsonNode root) {
        JsonNode payload = root.get("payload");
        if (payload == null) return null;
        JsonNode payment = payload.get("payment");
        if (payment == null) return null;
        return payment.get("entity");
    }

    /** payload.payload.refund.entity */
    private JsonNode extractRefundEntity(JsonNode root) {
        JsonNode payload = root.get("payload");
        if (payload == null) return null;
        JsonNode refund = payload.get("refund");
        if (refund == null) return null;
        return refund.get("entity");
    }

    /**
     * Our platform_payment.id for a payment event: {@code notes.orderId} on the payment (set on
     * every order / link we create), else on the order entity of an {@code order.paid}, else the
     * row whose vendor_order_id is the payment's Razorpay order or invoice id (registration-link
     * payments, whose notes live on the invoice).
     */
    private String resolvePlatformPaymentId(JsonNode root, JsonNode paymentEntity) {
        JsonNode notes = paymentEntity.get("notes");
        String fromNotes = notes != null && notes.isObject() ? textOrNull(notes, "orderId") : null;
        if (fromNotes != null) return fromNotes;
        JsonNode order = root.path("payload").path("order").path("entity");
        JsonNode orderNotes = order.get("notes");
        String fromOrder = orderNotes != null && orderNotes.isObject() ? textOrNull(orderNotes, "orderId") : null;
        if (fromOrder != null) return fromOrder;
        for (String key : List.of("order_id", "invoice_id")) {
            String ref = textOrNull(paymentEntity, key);
            if (ref != null) {
                Optional<PlatformPayment> row = paymentRepository.findByVendorOrderId(ref);
                if (row.isPresent()) return row.get().getId();
            }
        }
        return null;
    }

    private String extractPaymentType(JsonNode paymentEntity) {
        if (paymentEntity == null) return null;
        JsonNode notes = paymentEntity.get("notes");
        if (notes == null) return null;
        return textOrNull(notes, "payment_type");
    }

    private ObjectNode readData(String json) {
        if (StringUtils.hasText(json)) {
            try {
                JsonNode n = objectMapper.readTree(json);
                if (n instanceof ObjectNode o) return o;
            } catch (Exception e) {
                log.warn("Unreadable payment_specific_data, starting fresh: {}", e.getMessage());
            }
        }
        return objectMapper.createObjectNode();
    }

    private String withNote(String json, String key, JsonNode value) {
        ObjectNode data = readData(json);
        data.set(key, value);
        return data.toString();
    }

    // ───────────────────────────────────────────────────────────────
    // HMAC signature verify (mirror of RazorpayWebHookService — kept inline
    // to avoid coupling the platform service to the institute-marketplace
    // service)
    // ───────────────────────────────────────────────────────────────

    private boolean verifySignature(String payload, String received, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                String h = Integer.toHexString(0xff & b);
                if (h.length() == 1) hex.append('0');
                hex.append(h);
            }
            return constantTimeEquals(hex.toString(), received);
        } catch (Exception e) {
            log.error("HMAC verification error", e);
            return false;
        }
    }

    private boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int diff = 0;
        for (int i = 0; i < a.length(); i++) diff |= a.charAt(i) ^ b.charAt(i);
        return diff == 0;
    }
}
