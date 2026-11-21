package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.Refund;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionPaymentQueries;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.LinkOutcome;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.Priced;
import vacademy.io.admin_core_service.features.ai_plans_billing.webhook.AiSubscriptionPaymentHandler;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformCreditNoteService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformDocumentMailService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService.FulfilResult;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.CapturedPayment;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Super-admin money actions on AI plan charges (portal; every write needs a reason and is
 * logged with the actor): mark paid offline, waive, refund (credit note follows the refund
 * webhook), staff credit note, resend the payment link, cancel a mandate, and a read-only billing
 * timeline. None of them acts on a charge whose autopay debit is in flight (409 DEBIT_IN_PROGRESS).
 */
@Slf4j
@Service
public class AiSubscriptionOpsService {

    static final Duration REFUND_DOUBLE_CLICK_GUARD = Duration.ofMinutes(2);

    private final AiPlansInternalClient client;
    private final AiSubscriptionPaymentService payments;
    private final AiSubscriptionBillingService billing;
    private final AiSubscriptionMandateStore mandates;
    private final AiSubscriptionPaymentQueries queries;
    private final PlatformRazorpayGateway gateway;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformPaymentItemRepository itemRepository;
    private final PlatformInvoiceRepository invoiceRepository;
    private final PlatformRazorpayWebHookService webhookService;
    private final AiPlansBillingMailer mailer;
    private final PlatformCreditNoteService creditNoteService;
    private final PlatformDocumentMailService documentMail;
    private final TransactionTemplate tx;

    public AiSubscriptionOpsService(
            AiPlansInternalClient client,
            AiSubscriptionPaymentService payments,
            AiSubscriptionBillingService billing,
            AiSubscriptionMandateStore mandates,
            AiSubscriptionPaymentQueries queries,
            PlatformRazorpayGateway gateway,
            PlatformPaymentRepository paymentRepository,
            PlatformPaymentItemRepository itemRepository,
            PlatformInvoiceRepository invoiceRepository,
            PlatformRazorpayWebHookService webhookService,
            AiPlansBillingMailer mailer,
            PlatformTransactionManager transactionManager,
            PlatformCreditNoteService creditNoteService,
            PlatformDocumentMailService documentMail) {
        this.client = client;
        this.payments = payments;
        this.billing = billing;
        this.mandates = mandates;
        this.queries = queries;
        this.gateway = gateway;
        this.paymentRepository = paymentRepository;
        this.itemRepository = itemRepository;
        this.invoiceRepository = invoiceRepository;
        this.webhookService = webhookService;
        this.mailer = mailer;
        this.creditNoteService = creditNoteService;
        this.documentMail = documentMail;
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    ChargeView openCharge(String instituteId, String chargeId) {
        ChargeView c = ChargeView.from(client.charge(chargeId, instituteId));
        if (c == null || c.instituteId() != null && !c.instituteId().equals(instituteId)) {
            throw AiPlansBillingException.notFound("Charge");
        }
        if (!c.isOpen()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "The charge is " + c.status());
        }
        return c;
    }

    static void requireReason(String reason) {
        if (!StringUtils.hasText(reason) || reason.trim().length() < 3) {
            throw AiPlansBillingException.invalid("A reason is required");
        }
    }

    /**
     * Bank transfer received: the amount must equal the charge total. The payment (vendor MANUAL,
     * vendor_payment_id {@code MANUAL:<reference>}, unique) is settled through the webhook
     * service's own fulfil path, so the charge, the PAID write, the invoice and the email follow
     * exactly the online route.
     */
    public Map<String, Object> markPaidOffline(String instituteId, String chargeId, String reference, long amountMinor,
            String reason, String actor) {
        requireReason(reason);
        if (!StringUtils.hasText(reference) || !reference.trim().matches("[A-Za-z0-9/_.-]{3,50}")) {
            throw AiPlansBillingException.invalid("reference must be 3-50 letters, digits or / _ . -");
        }
        ChargeView c = AiSubscriptionBillingService.withInstitute(openCharge(instituteId, chargeId), instituteId);
        // an autopay debit is pending at Razorpay: marking it paid offline would collect twice
        payments.requireNoDebitInFlight(c);
        Priced p = payments.price(c);
        long total = p.tax().getTotalAmountMinor();
        if (amountMinor != total) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, AiPlansBillingException.AMOUNT_MISMATCH,
                    "The charge total is " + total + " paise, not " + amountMinor);
        }
        if (StringUtils.hasText(c.paymentLinkId()) && payments.closeLink(c.paymentLinkId(), c.platformPaymentId())) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "The open payment link was already paid online");
        }
        payments.patchSnapshot(c, p);
        PlatformPayment pp = payments.createManualPayment(c, p, actor, reference.trim());
        String vendorPaymentId = "MANUAL:" + reference.trim();
        FulfilResult result = webhookService.fulfil(pp.getId(), new CapturedPayment(vendorPaymentId, total,
                c.currency(), "offline", null, null, null, null, Instant.now().getEpochSecond(), null));
        log.info("[ai-plans-billing] charge {} marked paid offline by {} (ref {}, reason {}): {}",
                chargeId, actor, reference, reason, result);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("platform_payment_id", pp.getId());
        out.put("result", result == null ? null : result.name());
        out.put("total_minor", total);
        return out;
    }

    /**
     * Waive a charge (no consideration, so no invoice): its link is closed and ai_service is asked
     * to mark it WAIVED (ai_service decides what a waived period gives).
     */
    public Map<String, Object> waive(String instituteId, String chargeId, String reason, String actor) {
        requireReason(reason);
        ChargeView c = openCharge(instituteId, chargeId);
        payments.requireNoDebitInFlight(c);
        if (StringUtils.hasText(c.paymentLinkId()) && payments.closeLink(c.paymentLinkId(), c.platformPaymentId())) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "The open payment link was already paid");
        }
        Map<String, Object> resp = client.waiveCharge(chargeId, reason.trim(), actor);
        log.info("[ai-plans-billing] charge {} waived by {}: {}", chargeId, actor, reason);
        return resp;
    }

    /**
     * Staff refund of a NORMAL subscription payment (full or partial, cumulative never above the
     * total). {@code refund_requested_at} is written first; the credit note and the ai_service
     * {@code /refunded} call follow from the refund webhook (one path, idempotent on the refund id).
     */
    public Map<String, Object> refund(String instituteId, String platformPaymentId, Long amountMinor, String reason,
            String actor) {
        requireReason(reason);
        PlatformPayment p = paymentRepository.findById(platformPaymentId)
                .filter(row -> instituteId.equals(row.getInstituteId()))
                .orElseThrow(() -> AiPlansBillingException.notFound("Payment"));
        List<PlatformPaymentItem> items = itemRepository.findByPlatformPaymentId(p.getId());
        if (AiSubscriptionPaymentHandler.chargeIdOf(items) == null) {
            throw AiPlansBillingException.invalid("Not an AI plan payment");
        }
        if (p.getDisposition() != null && p.getDisposition() != PlatformPaymentDisposition.NORMAL) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "This payment is " + p.getDisposition() + " and is refunded automatically");
        }
        if (p.getPaymentStatus() != PlatformPaymentResult.PAID
                && p.getPaymentStatus() != PlatformPaymentResult.PARTIALLY_REFUNDED) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "Only a paid payment can be refunded");
        }
        if ("MANUAL".equalsIgnoreCase(p.getVendor()) || !StringUtils.hasText(p.getVendorPaymentId())) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "An offline payment is refunded outside Razorpay; issue a staff credit note against its "
                            + "invoice instead (POST .../institutes/{iid}/invoices/{invoiceId}/credit-note)");
        }
        long total = p.getTotalAmountMinor() == null ? 0L : p.getTotalAmountMinor();
        // processed refunds plus the ones Razorpay has accepted but not processed yet
        long already = (p.getRefundedAmountMinor() == null ? 0L : p.getRefundedAmountMinor()) + pendingRefunds(p);
        long amount = amountMinor == null ? total - already : amountMinor;
        if (amount <= 0 || already + amount > total) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, AiPlansBillingException.AMOUNT_MISMATCH,
                    "Refund must be between 1 and " + (total - already) + " paise");
        }
        Instant now = Instant.now();
        Boolean claimed = tx.execute(s -> paymentRepository.findByIdForUpdate(p.getId()).map(row -> {
            Instant last = row.getRefundRequestedAt();
            if (last != null && last.isAfter(now.minus(REFUND_DOUBLE_CLICK_GUARD))) {
                return false;
            }
            row.setRefundRequestedAt(now);
            paymentRepository.save(row);
            return true;
        }).orElse(false));
        if (!Boolean.TRUE.equals(claimed)) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "A refund was requested for this payment moments ago; check it before trying again");
        }
        String receipt = ("rf" + p.getId().replace("-", "")).substring(0, Math.min(26, 2 + p.getId().length()))
                + "_" + (already + amount);
        Refund refund = gateway.refund(p.getVendorPaymentId(), amount, receipt,
                Map.of("reason", reason.trim(), "platform_payment_id", p.getId(), "actor", actor == null ? "" : actor));
        log.info("[ai-plans-billing] refund {} of {} on {} requested by {}: {}", refund.id(), amount, p.getId(), actor,
                reason);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("refund_id", refund.id());
        out.put("amount_minor", refund.amountMinor());
        out.put("status", refund.status());
        return out;
    }

    @SuppressWarnings("unchecked")
    long pendingRefunds(PlatformPayment p) {
        Object pending = payments.paymentData(p).get("refundsPending");
        long sum = 0L;
        if (pending instanceof Map<?, ?> m) {
            for (Object v : m.values()) {
                if (v instanceof Map<?, ?> e && e.get("amountMinor") instanceof Number n) {
                    sum += n.longValue();
                }
            }
        }
        return sum;
    }

    /** Re-sends the one payable link of an open charge (a new one if the old has expired). */
    public Map<String, Object> resendLink(String instituteId, String chargeId, String actor) {
        ChargeView c = AiSubscriptionBillingService.withInstitute(openCharge(instituteId, chargeId), instituteId);
        payments.requireNoDebitInFlight(c);
        LinkOutcome link = payments.createLinkForCharge(c, null, billing.expiryFor(c), actor, null, null);
        if (link.alreadyPaid()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "The open link was already paid");
        }
        Kind kind = c.isUpgrade() ? Kind.UPGRADE_LINK : c.isFirstPurchase() ? Kind.PAYMENT_LINK : Kind.RENEWAL_LINK;
        int sent = mailer.send(new Mail(kind, c.instituteId(), c.planName(),
                AiPlansBillingMailer.money(link.totalMinor(), c.currency()), link.url(), c.serviceStart(),
                link.expiresAt(), null, null));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("platform_payment_id", link.platformPaymentId());
        out.put("url", link.url());
        out.put("link_expires_at", link.expiresAt() == null ? null : link.expiresAt().toString());
        out.put("reused", link.reused());
        out.put("emailed_to", sent);
        return out;
    }

    /**
     * Staff credit note against an AI-plan tax invoice of this institute (design §4.6: a waiver or a
     * refund made outside Razorpay after invoicing, e.g. an offline payment returned by bank
     * transfer). The amount is GST-inclusive; the credit-note service splits the tax in the
     * invoice's ratio and refuses a total above what is left on the invoice. Emailed brand-aware.
     */
    public Map<String, Object> staffCreditNote(String instituteId, String invoiceId, long amountMinor, String reason,
            String actor) {
        requireReason(reason);
        PlatformInvoice inv = billing.invoiceOf(instituteId, invoiceId);
        if (inv.getSourceKind() != PlatformPaymentItemKind.AI_SUBSCRIPTION) {
            throw AiPlansBillingException.invalid("Staff credit notes here are for AI plan invoices only");
        }
        if (amountMinor <= 0) {
            throw AiPlansBillingException.invalid("amount_minor must be positive");
        }
        PlatformCreditNote cn;
        try {
            cn = creditNoteService.issueStaffCreditNote(inv.getId(), amountMinor, reason.trim(), actor);
        } catch (PlatformCreditNoteService.CreditNoteException e) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, e.getCode(), e.getMessage());
        }
        boolean emailed = documentMail.sendCreditNoteEmail(cn);
        log.info("[ai-plans-billing] staff credit note {} of {} against {} by {}: {}", cn.getCreditNoteNumber(),
                amountMinor, inv.getInvoiceNumber(), actor, reason);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("credit_note_id", cn.getId());
        out.put("number", cn.getCreditNoteNumber());
        out.put("invoice_number", inv.getInvoiceNumber());
        out.put("total_minor", cn.getTotalAmountMinor());
        out.put("emailed", emailed);
        return out;
    }

    public Map<String, Object> cancelMandate(String instituteId, String mandateId, String reason, String actor) {
        requireReason(reason);
        Mandate m = mandates.findById(mandateId).filter(x -> instituteId.equals(x.instituteId()))
                .orElseThrow(() -> AiPlansBillingException.notFound("Mandate"));
        billing.cancelMandate(m, "staff " + actor + ": " + reason.trim());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mandate_id", m.id());
        out.put("status", AiSubscriptionMandateStore.CANCELLED);
        return out;
    }

    /** Payments (with their invoice) and mandates of an institute, newest first. */
    public Map<String, Object> billingTimeline(String instituteId) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (String id : queries.paymentIdsForInstitute(instituteId, 200)) {
            paymentRepository.findById(id).ifPresent(p -> {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("platform_payment_id", p.getId());
                r.put("created_at", p.getCreatedAt() == null ? null : p.getCreatedAt().toString());
                r.put("vendor", p.getVendor());
                r.put("vendor_order_id", p.getVendorOrderId());
                r.put("vendor_payment_id", p.getVendorPaymentId());
                r.put("status", p.getStatus() == null ? null : p.getStatus().name());
                r.put("payment_status", p.getPaymentStatus() == null ? null : p.getPaymentStatus().name());
                r.put("disposition", p.getDisposition() == null ? null : p.getDisposition().name());
                r.put("total_minor", p.getTotalAmountMinor());
                r.put("refunded_minor", p.getRefundedAmountMinor());
                r.put("place_of_supply", p.getPlaceOfSupply());
                r.put("tax_head", p.getTaxHead());
                List<PlatformPaymentItem> items = itemRepository.findByPlatformPaymentId(p.getId());
                r.put("charge_id", AiSubscriptionPaymentHandler.chargeIdOf(items));
                r.put("description", items.isEmpty() ? null : items.get(0).getDescriptionSnapshot());
                r.put("purpose", payments.paymentData(p).get(AiSubscriptionPaymentService.NOTE_PURPOSE));
                invoiceRepository.findByPlatformPaymentId(p.getId()).ifPresent(inv -> {
                    r.put("invoice_id", inv.getId());
                    r.put("invoice_number", inv.getInvoiceNumber());
                });
                rows.add(r);
            });
        }
        List<Map<String, Object>> ms = new ArrayList<>();
        for (Mandate m : mandates.findForInstitute(instituteId)) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("id", m.id());
            v.put("subscription_id", m.subscriptionId());
            v.put("status", m.status());
            v.put("method", m.method());
            v.put("max_amount_minor", m.maxAmountMinor());
            v.put("token_id", m.tokenId());
            v.put("failure_reason", m.failureReason());
            v.put("created_at", m.createdAt() == null ? null : m.createdAt().toString());
            ms.add(v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("payments", rows);
        out.put("mandates", ms);
        return out;
    }
}
