package vacademy.io.admin_core_service.features.ai_plans_billing.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient.Json;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansUpstreamException;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformCreditNoteRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformCreditNoteService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformDocumentMailService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoiceService;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler;
import vacademy.io.common.logging.SentryLogger;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The AI-subscription side of the platform webhook ({@link SubscriptionPaymentHandler}).
 *
 * <ul>
 *   <li>{@link #onPaymentCaptured}: inside the webhook's row lock, before PAID. Records the
 *       autopay token from a registration payment, then asks ai_service to settle the charge
 *       ({@code /charges/{id}/paid}). Transport / 5xx errors throw (500, Razorpay retries); an
 *       explicit refusal becomes DUPLICATE or LATE (refunded, never invoiced).</li>
 *   <li>{@link #afterPaid}: issues the tax invoice (series v2, from the payment snapshot) and
 *       emails it, brand-aware.</li>
 *   <li>{@link #onPaymentFailed}: a failed autopay debit falls back to a payment link at once (D5).</li>
 *   <li>{@link #onRefund}: credit note + {@code /charges/{id}/refunded}.</li>
 *   <li>{@link #onTokenEvent}: mandate status from token.confirmed / rejected / paused / cancelled.</li>
 * </ul>
 */
@Slf4j
@Component
public class AiSubscriptionPaymentHandler implements SubscriptionPaymentHandler {

    static final String ACTOR = "system:ai-plans-billing";

    /** /paid actions that mean "this payment settled the charge". */
    static final Set<String> SETTLED = Set.of("ACTIVATED", "RENEWAL_PAID", "GRACE_CLEARED", "UPGRADED",
            "ALREADY_PROCESSED", "PAID", "FULFILLED");
    static final Set<String> DUPLICATE_CODES = Set.of("DUPLICATE", "ALREADY_PAID", "CHARGE_ALREADY_PAID",
            "DUPLICATE_PAYMENT");
    /** Explicit refusals that mean the money must go back (never a 500 loop). */
    static final Set<String> LATE_CODES = Set.of("REFUND_REQUIRED", "LATE", "AMOUNT_MISMATCH", "CHARGE_VOID",
            "CHARGE_NOT_PAYABLE", "CHARGE_NOT_FOUND", "SUBSCRIPTION_ENDED", "SUBSCRIPTION_NOT_PAYABLE",
            "PERIOD_CHANGED", "LIVE_CONFLICT", "ALREADY_SUBSCRIBED");
    /**
     * Deliberately NOT refunded: VENDOR_PAYMENT_REUSED (this Razorpay payment already settled
     * ANOTHER charge, so refunding it would take back money that paid for something) and
     * TOTAL_NOT_SET (a missing snapshot is our bug). HELD: 200 to Razorpay (a 500 loop would get
     * the shared platform webhook disabled, packs included), row left unpaid, Sentry alert.
     */
    static final Set<String> HELD_CODES = Set.of("VENDOR_PAYMENT_REUSED", "TOTAL_NOT_SET");

    private final AiPlansInternalClient client;
    private final AiSubscriptionPaymentService payments;
    private final AiSubscriptionMandateStore mandates;
    private final PlatformRazorpayGateway gateway;
    private final PlatformInvoiceService invoiceService;
    private final PlatformCreditNoteService creditNoteService;
    private final PlatformCreditNoteRepository creditNoteRepository;
    private final PlatformDocumentMailService documentMail;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformInvoiceRepository invoiceRepository;
    private final AiPlansBillingMailer mailer;
    private final TransactionTemplate tx;

    public AiSubscriptionPaymentHandler(
            AiPlansInternalClient client,
            AiSubscriptionPaymentService payments,
            AiSubscriptionMandateStore mandates,
            PlatformRazorpayGateway gateway,
            PlatformInvoiceService invoiceService,
            PlatformCreditNoteService creditNoteService,
            PlatformCreditNoteRepository creditNoteRepository,
            PlatformDocumentMailService documentMail,
            PlatformPaymentRepository paymentRepository,
            PlatformInvoiceRepository invoiceRepository,
            AiPlansBillingMailer mailer,
            PlatformTransactionManager transactionManager) {
        this.client = client;
        this.payments = payments;
        this.mandates = mandates;
        this.gateway = gateway;
        this.invoiceService = invoiceService;
        this.creditNoteService = creditNoteService;
        this.creditNoteRepository = creditNoteRepository;
        this.documentMail = documentMail;
        this.paymentRepository = paymentRepository;
        this.invoiceRepository = invoiceRepository;
        this.mailer = mailer;
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ── captured ─────────────────────────────────────────────────────────

    @Override
    public CaptureOutcome onPaymentCaptured(PlatformPayment payment, List<PlatformPaymentItem> items,
            CapturedPayment captured) {
        Map<String, Object> data = payments.paymentData(payment);
        String mandateId = Json.str(data, "mandateId");
        String purpose = Json.str(data, AiSubscriptionPaymentService.NOTE_PURPOSE);

        // The registration (authorisation) payment carries the token: keep it, ACTIVE comes with token.confirmed.
        if (mandateId != null && StringUtils.hasText(captured.tokenId())
                && !"AUTOPAY_DEBIT".equals(purpose)) {
            mandates.recordToken(mandateId, captured.tokenId(), captured.customerId(), captured.vendorPaymentId());
            syncTokenNow(mandateId, captured.tokenId());
            // Completed after the institute cancelled (or the mandate lapsed): the token must not live on.
            mandates.findById(mandateId).filter(m -> AiSubscriptionMandateStore.isTerminal(m.status()))
                    .ifPresent(m -> cancelTokenQuietly(m.razorpayCustomerId() != null ? m.razorpayCustomerId()
                            : captured.customerId(), captured.tokenId(), m.method(), m.id()));
        }

        String chargeId = chargeIdOf(items);
        if (chargeId == null) {
            // Rs 1 autopay authorisation with nothing to pay for: refunded, never invoiced.
            if ("MANDATE_AUTH".equals(purpose)) {
                log.info("[ai-plans-billing] autopay authorisation {} captured for mandate {}; refunding",
                        captured.vendorPaymentId(), mandateId);
            } else {
                SentryLogger.logWarning("AI subscription payment without a charge; refunding",
                        Map.of("platform_payment_id", payment.getId(), "vendor_payment_id", captured.vendorPaymentId()));
            }
            return CaptureOutcome.LATE;
        }

        Map<String, Object> resp;
        try {
            resp = client.chargePaid(chargeId, payment.getId(), captured.vendorPaymentId(), captured.amountMinor());
        } catch (AiPlansUpstreamException e) {
            String code = e.getCode() == null ? "" : e.getCode().toUpperCase(Locale.ROOT);
            if (!e.isRetryable() && DUPLICATE_CODES.contains(code)) {
                return CaptureOutcome.DUPLICATE;
            }
            if (!e.isRetryable() && LATE_CODES.contains(code)) {
                alertRefused(payment, captured, chargeId, code);
                return CaptureOutcome.LATE;
            }
            if (!e.isRetryable() && HELD_CODES.contains(code)) {
                SentryLogger.logWarning("AI subscription payment held: ai_service refused it without a refund",
                        Map.of("platform_payment_id", payment.getId(), "vendor_payment_id", captured.vendorPaymentId(),
                                "charge_id", chargeId, "code", code));
                return CaptureOutcome.HELD;
            }
            // Anything else (ai_service down, a contract mismatch with no code): 500 -> Razorpay retries.
            throw e;
        }
        String action = Json.str(resp, "action", "result", "outcome");
        String a = action == null ? "" : action.toUpperCase(Locale.ROOT);
        if (SETTLED.contains(a)) {
            log.info("[ai-plans-billing] charge {} settled by {} ({})", chargeId, captured.vendorPaymentId(), a);
            applyInvoiceBlock(items, Json.map(resp, "invoice"));
            return CaptureOutcome.FULFILLED;
        }
        if (DUPLICATE_CODES.contains(a)) {
            return CaptureOutcome.DUPLICATE;
        }
        if (LATE_CODES.contains(a)) {
            alertRefused(payment, captured, chargeId, a);
            return CaptureOutcome.LATE;
        }
        // Unknown answer: do not mark PAID on a guess.
        throw new AiPlansUpstreamException(200, "UNKNOWN_ACTION",
                "ai_service answered /paid with an unknown action '" + action + "'", true);
    }

    private void alertRefused(PlatformPayment payment, CapturedPayment c, String chargeId, String code) {
        SentryLogger.logWarning("AI subscription payment refused by ai_service; refunding",
                Map.of("platform_payment_id", payment.getId(), "vendor_payment_id", c.vendorPaymentId(),
                        "charge_id", chargeId, "code", code));
    }

    /**
     * The supply the payment settled, as ai_service recorded it ({@code /paid}'s {@code invoice}
     * block): a first period starts when it is paid, an upgrade when its payment arrives. The item
     * snapshot (what the tax invoice prints) is aligned with it inside the locked fulfil step, so
     * the invoice's service period always matches the period supplied. The webhook saves the items.
     */
    static void applyInvoiceBlock(List<PlatformPaymentItem> items, Map<String, Object> invoice) {
        if (items == null || invoice == null) {
            return;
        }
        Instant start = instantOrNull(Json.str(invoice, "service_start"));
        Instant end = instantOrNull(Json.str(invoice, "service_end"));
        String description = Json.str(invoice, "description");
        for (PlatformPaymentItem i : items) {
            if (i.getItemKind() != PlatformPaymentItemKind.AI_SUBSCRIPTION || !StringUtils.hasText(i.getSubscriptionChargeId())) {
                continue;
            }
            if (start != null && end != null && end.isAfter(start)) {
                i.setServicePeriodStart(start);
                i.setServicePeriodEnd(end);
            }
            if (StringUtils.hasText(description)) {
                i.setDescriptionSnapshot(description.length() > 255 ? description.substring(0, 255) : description);
            }
            return;
        }
    }

    private static Instant instantOrNull(String s) {
        if (!StringUtils.hasText(s)) {
            return null;
        }
        try {
            return java.time.OffsetDateTime.parse(s).toInstant();
        } catch (Exception e) {
            try {
                return Instant.parse(s);
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    /** The charge id of the first AI_SUBSCRIPTION item, or null (a Rs 1 autopay authorisation has none). */
    public static String chargeIdOf(List<PlatformPaymentItem> items) {
        if (items == null) {
            return null;
        }
        for (PlatformPaymentItem i : items) {
            if (i.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION
                    && StringUtils.hasText(i.getSubscriptionChargeId())) {
                return i.getSubscriptionChargeId();
            }
        }
        return null;
    }

    // ── after PAID: invoice + email ──────────────────────────────────────

    @Override
    public void afterPaid(PlatformPayment payment, List<PlatformPaymentItem> items) {
        issueInvoiceAndEmail(payment.getId(), items);
    }

    static final String DATA_INVOICE_EMAILED = "invoiceEmailedAt";

    /**
     * Idempotent: the invoice is unique per payment, and its email goes out once per payment (the
     * webhook thread and the reconcile job may both get here: the send is claimed under the
     * payment's row lock). A payment refunded before its invoice existed gets its credit notes
     * now, from the refunds recorded on it (idempotent on the Razorpay refund id).
     */
    public PlatformInvoice issueInvoiceAndEmail(String platformPaymentId, List<PlatformPaymentItem> items) {
        if (chargeIdOf(items) == null) {
            return null;
        }
        PlatformPayment p = paymentRepository.findById(platformPaymentId).orElse(null);
        if (p == null || p.getDisposition() != null && p.getDisposition() != PlatformPaymentDisposition.NORMAL) {
            return null;
        }
        PlatformInvoice invoice = invoiceService.generateInvoice(platformPaymentId);
        if (invoice != null && claimInvoiceEmail(platformPaymentId)) {
            documentMail.sendInvoiceEmail(invoice);
        }
        if (invoice != null) {
            issueMissingCreditNotes(platformPaymentId);
        }
        return invoice;
    }

    /** True for exactly one caller per payment. */
    boolean claimInvoiceEmail(String platformPaymentId) {
        Boolean claimed = tx.execute(s -> paymentRepository.findByIdForUpdate(platformPaymentId).map(row -> {
            Map<String, Object> data = payments.paymentData(row);
            if (data.get(DATA_INVOICE_EMAILED) != null) {
                return false;
            }
            row.setPaymentSpecificData(payments.mergeJson(row.getPaymentSpecificData(),
                    Map.of(DATA_INVOICE_EMAILED, Instant.now().toString())));
            paymentRepository.save(row);
            return true;
        }).orElse(false));
        return Boolean.TRUE.equals(claimed);
    }

    @SuppressWarnings("unchecked")
    void issueMissingCreditNotes(String platformPaymentId) {
        PlatformPayment p = paymentRepository.findById(platformPaymentId).orElse(null);
        if (p == null || p.getRefundedAmountMinor() == null || p.getRefundedAmountMinor() <= 0) {
            return;
        }
        Object refunds = payments.paymentData(p).get("refunds");
        if (!(refunds instanceof Map<?, ?> map)) {
            return;
        }
        for (Map.Entry<?, ?> e : map.entrySet()) {
            String refundId = String.valueOf(e.getKey());
            Long amount = e.getValue() instanceof Map<?, ?> m ? Json.lng((Map<String, Object>) m, "amountMinor") : null;
            if (amount == null || amount <= 0 || creditNoteRepository.findByVendorRefundId(refundId).isPresent()) {
                continue;
            }
            try {
                creditNoteService.issueForRefund(platformPaymentId, refundId, amount, "Refund", ACTOR)
                        .ifPresent(documentMail::sendCreditNoteEmail);
            } catch (RuntimeException ex) {
                log.error("[ai-plans-billing] credit note for refund {} of {} failed: {}", refundId,
                        platformPaymentId, ex.getMessage());
            }
        }
    }

    // ── payment.failed ───────────────────────────────────────────────────

    @Override
    public void onPaymentFailed(PlatformPayment payment, List<PlatformPaymentItem> items, JsonNode paymentEntity) {
        Map<String, Object> data = payments.paymentData(payment);
        if (!"AUTOPAY_DEBIT".equals(Json.str(data, AiSubscriptionPaymentService.NOTE_PURPOSE))) {
            return; // a failed attempt on a link: the same link can still be paid
        }
        String chargeId = chargeIdOf(items);
        if (chargeId == null) {
            return;
        }
        String reason = paymentEntity == null ? null : text(paymentEntity, "error_description");
        Map<String, Object> patch = new HashMap<>();
        patch.put("status", "FAILED");
        patch.put("last_error", reason == null ? "autopay debit failed"
                : (reason.length() > 250 ? reason.substring(0, 250) : reason));
        try {
            client.patchCharge(chargeId, patch);
        } catch (RuntimeException e) {
            // The charge may already be closed (paid by a link meanwhile): the link step decides.
            log.warn("[ai-plans-billing] could not mark charge {} FAILED: {}", chargeId, e.getMessage());
        }
        fallBackToLink(chargeId, payment.getInstituteId(), Kind.DEBIT_FAILED);
    }

    /** Sends a payment link for a charge whose autopay did not go through. Never throws. */
    public void fallBackToLink(String chargeId, String instituteId, Kind kind) {
        try {
            ChargeView charge = ChargeView.from(client.charge(chargeId, instituteId));
            if (charge == null || !charge.isOpen()) {
                return;
            }
            Instant expireBy = charge.graceEnd() != null ? charge.graceEnd() : payments.now().plusSeconds(7 * 86_400L);
            AiSubscriptionPaymentService.LinkOutcome link = payments.createLinkForCharge(charge, null, expireBy,
                    null, null, null);
            if (!link.alreadyPaid() && StringUtils.hasText(link.url())) {
                mailer.send(new Mail(kind, charge.instituteId(), charge.planName(),
                        AiPlansBillingMailer.money(link.totalMinor(), charge.currency()), link.url(),
                        charge.serviceStart(), link.expiresAt(), null, null));
            }
        } catch (Exception e) {
            log.error("[ai-plans-billing] fallback link for charge {} failed: {} (the billing job retries)",
                    chargeId, e.getMessage());
        }
    }

    // ── refunds ──────────────────────────────────────────────────────────

    @Override
    public void onRefund(PlatformPayment payment, List<PlatformPaymentItem> items, RefundEvent refund) {
        String chargeId = chargeIdOf(items);
        if (chargeId == null) {
            return;
        }
        boolean noteExisted = creditNoteRepository.findByVendorRefundId(refund.vendorRefundId()).isPresent();
        Optional<PlatformCreditNote> note = creditNoteService.issueForRefund(payment.getId(), refund.vendorRefundId(),
                refund.refundAmountMinor(), "Refund", ACTOR);
        if (note.isPresent() && !noteExisted) {
            documentMail.sendCreditNoteEmail(note.get());
        }
        try {
            client.chargeRefunded(chargeId, refund.vendorPaymentId(), refund.refundAmountMinor(),
                    refund.cumulativeRefundedMinor(), refund.vendorRefundId());
        } catch (RuntimeException e) {
            // Remember it; the billing job re-sends (the call is idempotent on the cumulative amount).
            markRefundSyncPending(payment.getId(), refund.vendorRefundId());
            throw e;
        }
    }

    void markRefundSyncPending(String paymentId, String refundId) {
        try {
            tx.executeWithoutResult(s -> paymentRepository.findById(paymentId).ifPresent(p -> {
                p.setPaymentSpecificData(payments.mergeJson(p.getPaymentSpecificData(),
                        Map.of("refundSyncPending", refundId)));
                paymentRepository.save(p);
            }));
        } catch (RuntimeException e) {
            log.error("[ai-plans-billing] could not flag refund sync for {}: {}", paymentId, e.getMessage());
        }
    }

    // ── tokens ───────────────────────────────────────────────────────────

    @Override
    public boolean ownsToken(String tokenId) {
        return mandates.findByTokenId(tokenId).isPresent();
    }

    @Override
    public void onTokenEvent(String eventType, JsonNode tokenEntity, JsonNode root) {
        String tokenId = text(tokenEntity, "id");
        Optional<Mandate> found = mandates.findByTokenId(tokenId);
        if (found.isEmpty()) {
            // Possible when token.confirmed beats payment.captured: the reconcile job polls PENDING mandates.
            log.info("[ai-plans-billing] {} for unknown token {} — acked", eventType, tokenId);
            return;
        }
        String status = tokenEntity == null ? null : text(tokenEntity.path("recurring_details"), "status");
        String failure = tokenEntity == null ? null : text(tokenEntity.path("recurring_details"), "failure_reason");
        String target = mandateStatusFor(eventType, status);
        if (target == null) {
            return;
        }
        // The webhook's own created_at (unix seconds): an older, retried event never undoes a newer one.
        Instant eventAt = root != null && root.path("created_at").isNumber()
                ? Instant.ofEpochSecond(root.path("created_at").asLong()) : null;
        applyMandateStatus(found.get(), target, failure, eventAt);
    }

    /**
     * token.confirmed often arrives a moment before this capture links the token to the mandate,
     * and is then acked as an unknown token (seen live 2026-10-16: 0.55 s apart). Ask Razorpay
     * for the token's state now instead of leaving the mandate PENDING until the hourly
     * reconcile. Best-effort: any failure leaves it to that reconcile.
     */
    void syncTokenNow(String mandateId, String tokenId) {
        try {
            Mandate m = mandates.findById(mandateId).orElse(null);
            if (m == null || !AiSubscriptionMandateStore.PENDING.equals(m.status())
                    || !StringUtils.hasText(m.razorpayCustomerId()) || !StringUtils.hasText(tokenId)) {
                return;
            }
            for (PlatformRazorpayGateway.TokenInfo t : gateway.fetchTokens(m.razorpayCustomerId())) {
                if (tokenId.equals(t.id())) {
                    String target = mandateStatusFor(null, t.status());
                    if (target != null) {
                        applyMandateStatus(m, target, null);
                    }
                    return;
                }
            }
        } catch (Exception e) {
            log.warn("[ai-plans-billing] token sync for mandate {} left to the hourly reconcile: {}", mandateId,
                    e.getMessage());
        }
    }

    /** token.* event (or recurring_details.status) -> mandate status; null = no change. */
    public static String mandateStatusFor(String eventType, String recurringStatus) {
        String e = eventType == null ? "" : eventType.toLowerCase(Locale.ROOT);
        String s = recurringStatus == null ? "" : recurringStatus.toLowerCase(Locale.ROOT);
        if (e.endsWith(".confirmed") || "confirmed".equals(s) && e.isEmpty()) {
            return AiSubscriptionMandateStore.ACTIVE;
        }
        if (e.endsWith(".rejected") || "rejected".equals(s) && e.isEmpty()) {
            return AiSubscriptionMandateStore.REJECTED;
        }
        if (e.endsWith(".paused") || "paused".equals(s) && e.isEmpty()) {
            return AiSubscriptionMandateStore.PAUSED;
        }
        if (e.endsWith(".cancelled") || "cancelled".equals(s) && e.isEmpty()) {
            return AiSubscriptionMandateStore.CANCELLED;
        }
        return null;
    }

    /** As {@link #applyMandateStatus(Mandate, String, String, Instant)} without an event time (polling). */
    public void applyMandateStatus(Mandate m, String target, String failure) {
        applyMandateStatus(m, target, failure, null);
    }

    /**
     * Applies a mandate status along the forward-only transitions of
     * {@link AiSubscriptionMandateStore#allowedFrom} (CANCELLED / REJECTED / EXPIRED are final; an
     * event older than the last one applied is dropped). Activating a PENDING mandate supersedes any
     * other usable mandate of the same subscription (one ACTIVE/PAUSED per subscription,
     * ux_asm_usable); the superseded tokens are cancelled at Razorpay best-effort. A token that is
     * confirmed for a mandate already ended is cancelled at Razorpay, never revived.
     */
    public void applyMandateStatus(Mandate stale, String target, String failure, Instant eventAt) {
        final String[] from = new String[1];
        List<Mandate> superseded = tx.execute(s -> {
            Mandate m = mandates.findByIdForUpdate(stale.id()).orElse(null);
            if (m == null || target.equals(m.status())) {
                return List.<Mandate>of();
            }
            from[0] = m.status();
            if (!AiSubscriptionMandateStore.allowedFrom(target).contains(m.status())
                    || mandates.isStaleEvent(m.id(), eventAt)) {
                return null;
            }
            List<Mandate> others = List.of();
            if (AiSubscriptionMandateStore.ACTIVE.equals(target) && AiSubscriptionMandateStore.PENDING.equals(m.status())) {
                others = mandates.findOtherUsable(m.subscriptionId(), m.id());
                for (Mandate o : others) {
                    mandates.updateStatus(o.id(), AiSubscriptionMandateStore.CANCELLED, "superseded by " + m.id());
                }
            }
            if (mandates.transition(m.id(), target, failure, eventAt) == 0) {
                return null;
            }
            return others;
        });
        if (superseded == null) {
            // not applied: an ended mandate, or an out-of-order event
            log.info("[ai-plans-billing] mandate {} stays {}: {} not applied", stale.id(), from[0], target);
            if (AiSubscriptionMandateStore.ACTIVE.equals(target) && AiSubscriptionMandateStore.isTerminal(from[0])) {
                cancelTokenQuietly(stale.razorpayCustomerId(), stale.tokenId(), stale.method(), stale.id());
            }
            return;
        }
        if (from[0] == null) {
            return; // already in that status
        }
        for (Mandate o : superseded) {
            if (o.razorpayCustomerId() != null && o.tokenId() != null) {
                cancelTokenQuietly(o.razorpayCustomerId(), o.tokenId(), o.method(), o.id());
            }
        }
        log.info("[ai-plans-billing] mandate {} {} -> {}", stale.id(), from[0], target);
        if (AiSubscriptionMandateStore.ACTIVE.equals(target) && AiSubscriptionMandateStore.PENDING.equals(from[0])) {
            // set-up confirmation only (a resume after a pause is not a new set-up)
            mailer.send(new Mail(Kind.MANDATE_ACTIVE, stale.instituteId(), null, null, null, null, null, null,
                    "UPI".equalsIgnoreCase(stale.method()) ? "UPI Autopay" : "card"));
        }
    }

    private void cancelTokenQuietly(String customerId, String tokenId, String method, String mandateId) {
        if (!StringUtils.hasText(customerId) || !StringUtils.hasText(tokenId)) {
            return;
        }
        try {
            gateway.cancelToken(customerId, tokenId, method);
            log.info("[ai-plans-billing] token {} of ended mandate {} cancelled at Razorpay", tokenId, mandateId);
        } catch (Exception e) {
            log.warn("[ai-plans-billing] could not cancel token {} of mandate {}: {}", tokenId, mandateId, e.getMessage());
            SentryLogger.logWarning("AI plan autopay token of an ended mandate could not be cancelled; cancel it in Razorpay",
                    Map.of("mandate_id", String.valueOf(mandateId), "token_id", tokenId));
        }
    }

    private static String text(JsonNode n, String field) {
        if (n == null || !n.hasNonNull(field)) {
            return null;
        }
        return n.get(field).asText();
    }
}
