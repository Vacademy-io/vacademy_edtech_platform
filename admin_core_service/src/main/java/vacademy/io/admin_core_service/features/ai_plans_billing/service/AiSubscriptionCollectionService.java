package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient.Json;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.Customer;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentInfo;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.TokenInfo;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionPaymentQueries;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.DebitOutcomeUnknownException;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.DebitRefusedException;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.LinkOutcome;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.Priced;
import vacademy.io.admin_core_service.features.ai_plans_billing.webhook.AiSubscriptionPaymentHandler;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * One pass of the AI subscription billing job, driven by charge STATE in ai_service (critique #6:
 * never by a roll report that can be lost).
 *
 * <p>For each charge ai_service lists as needing collection
 * ({@code GET /charges?status=DUE&needs_collection=true}):
 * <ul>
 *   <li><b>Autopay</b> (billing.autopay.enabled, an ACTIVE mandate, total within Rs 15,000 and the
 *       mandate's max, no failed debit yet, no live link): the pre-debit notice email goes out from
 *       {@value #NOTICE_LEAD_HOURS} h before the service start (and at least 24 h before the debit);
 *       then the recurring debit is raised {@value #DEBIT_CREATE_LEAD_HOURS} h before the service
 *       start, for UPI and cards alike: without a notification object Razorpay notifies the
 *       customer and debits UPI about 25 h later ("may take between 24-36 hours") and cards after
 *       36 h 5 min, so the money is in before the period starts. A refused debit falls back to a
 *       payment link at once (D5); a debit whose outcome is unknown is never followed by a link.</li>
 *   <li><b>Payment link</b> otherwise: created from T-{@value #LINK_LEAD_DAYS} days, open until the
 *       grace end; reminders at T-3, T-0 and once in grace (each sent once, tracked on the link's
 *       platform_payment).</li>
 *   <li>A first purchase or an upgrade whose link has expired unpaid is voided.</li>
 * </ul>
 * Then the reconcile passes: stale unpaid payments against Razorpay (lost webhooks, expired
 * links), PAID payments missing an invoice, PENDING mandates waiting for token.confirmed, lapsed
 * registrations, and refunds not yet reported to ai_service.
 *
 * <p>Each item is handled on its own: one failure is logged and never stops the rest.
 */
@Slf4j
@Service
public class AiSubscriptionCollectionService {

    public static final int LINK_LEAD_DAYS = 7;
    public static final int NOTICE_LEAD_HOURS = 72;
    /**
     * The recurring debit is raised this long before the service start, for UPI and cards:
     * Razorpay debits cards "after 36 hours and 5 minutes" without a notification object
     * (https://razorpay.com/docs/api/payments/recurring-payments/cards/create-subsequent-payments/)
     * and UPI payments "may take between 24-36 hours"
     * (https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/);
     * 36 h 5 min + the hourly job + margin = 40 h.
     */
    public static final int DEBIT_CREATE_LEAD_HOURS = 40;
    static final Duration MIN_NOTICE = Duration.ofHours(24);
    static final String ACTOR = "system:ai-plans-billing-job";
    static final String DATA_REMINDERS = "reminders";

    private final AiPlansBillingSettings settings;
    private final AiPlansInternalClient client;
    private final AiSubscriptionPaymentService payments;
    private final AiSubscriptionMandateStore mandates;
    private final AiSubscriptionPaymentQueries queries;
    private final PlatformRazorpayGateway gateway;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformPaymentItemRepository itemRepository;
    private final PlatformRazorpayWebHookService webhookService;
    private final AiSubscriptionPaymentHandler handler;
    private final AiPlansBillingMailer mailer;
    private final TransactionTemplate tx;

    public AiSubscriptionCollectionService(
            AiPlansBillingSettings settings,
            AiPlansInternalClient client,
            AiSubscriptionPaymentService payments,
            AiSubscriptionMandateStore mandates,
            AiSubscriptionPaymentQueries queries,
            PlatformRazorpayGateway gateway,
            PlatformPaymentRepository paymentRepository,
            PlatformPaymentItemRepository itemRepository,
            PlatformRazorpayWebHookService webhookService,
            AiSubscriptionPaymentHandler handler,
            AiPlansBillingMailer mailer,
            PlatformTransactionManager transactionManager) {
        this.settings = settings;
        this.client = client;
        this.payments = payments;
        this.mandates = mandates;
        this.queries = queries;
        this.gateway = gateway;
        this.paymentRepository = paymentRepository;
        this.itemRepository = itemRepository;
        this.webhookService = webhookService;
        this.handler = handler;
        this.mailer = mailer;
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** What one pass did, for the log line and the tests. */
    public static final class Report {
        public final Map<String, Integer> counts = new LinkedHashMap<>();
        public final List<String> errors = new ArrayList<>();

        void inc(String key) {
            counts.merge(key, 1, Integer::sum);
        }

        @Override
        public String toString() {
            return counts + (errors.isEmpty() ? "" : " errors=" + errors.size());
        }
    }

    /** One full pass; null when billing.subscriptions.payments.enabled is off. */
    public Report runOnce() {
        if (!settings.paymentsEnabled()) {
            return null;
        }
        Report r = new Report();
        List<Map<String, Object>> due;
        if (!settings.invoiceSeriesV2Enabled()) {
            // Subscriptions are invoiced on the v2 series only: raise nothing payable without it
            // (reconcile still settles money that already arrived).
            r.errors.add("billing.invoice.series_v2.enabled is off: no links or debits raised");
            reconcile(r);
            return r;
        }
        try {
            due = client.chargesNeedingCollection();
        } catch (Exception e) {
            r.errors.add("charges: " + e.getMessage());
            due = List.of();
        }
        for (Map<String, Object> raw : due) {
            ChargeView c = ChargeView.from(raw);
            if (c == null) {
                continue;
            }
            try {
                collect(c, r);
            } catch (Exception e) {
                log.warn("[ai-plans-billing] charge {} not collected this run: {}", c.id(), e.getMessage());
                r.errors.add(c.id() + ": " + e.getMessage());
            }
        }
        remind(r);
        reconcile(r);
        return r;
    }

    // ── collection ───────────────────────────────────────────────────────

    void collect(ChargeView c, Report r) {
        if (!c.isOpen() || c.instituteId() == null) {
            return;
        }
        Instant now = payments.now();
        if (c.isFirstPurchase() || c.isUpgrade()) {
            if (staffQueuedWithoutLink(c, now)) {
                sendQueuedCheckoutLink(c, r);
                return;
            }
            expireStaleCheckout(c, now, r);
            return;
        }
        if (debitInFlight(c)) {
            r.inc("debits_waiting");
            return; // the webhook settles it; reconcileOrder catches a lost outcome
        }
        if (tryAutopay(c, now, r)) {
            return;
        }
        boolean liveLink = StringUtils.hasText(c.paymentLinkId()) && c.linkExpiresAt() != null
                && c.linkExpiresAt().isAfter(now);
        if (!liveLink) {
            if (c.serviceStart() == null || now.isBefore(c.serviceStart().minus(Duration.ofDays(LINK_LEAD_DAYS)))) {
                return;
            }
            Instant graceEnd = c.graceEnd();
            if (graceEnd != null && !graceEnd.isAfter(now)) {
                return; // ai_service expires it; no new link after the grace end
            }
            LinkOutcome link = payments.createLinkForCharge(c, null, graceEnd, null, null, null);
            if (link.alreadyPaid()) {
                r.inc("already_paid");
                return;
            }
            r.inc("links_created");
            Kind kind = c.debitAttempts() > 0 || "FAILED".equalsIgnoreCase(c.status()) ? Kind.DEBIT_FAILED
                    : Kind.RENEWAL_LINK;
            mailer.send(new Mail(kind, c.instituteId(), c.planName(),
                    AiPlansBillingMailer.money(link.totalMinor(), c.currency()), link.url(), c.serviceStart(),
                    link.expiresAt(), null, null));
            markReminder(link.platformPaymentId(), "T-7");
            return;
        }
        sendReminderIfDue(c, now, r);
    }

    /**
     * A recurring debit was raised for this charge and has no outcome yet: the charge points at a
     * PAYMENT_PENDING AUTOPAY_DEBIT payment, or (should the charge's pointer have moved) any such
     * payment of the charge already sent to Razorpay (it has an order id).
     */
    boolean debitInFlight(ChargeView c) {
        if (!"DEBIT_SCHEDULED".equalsIgnoreCase(c.status())) {
            return false;
        }
        if (payments.debitInFlight(c)) {
            return true;
        }
        try {
            for (String id : queries.paymentIdsForCharge(c.id())) {
                Optional<PlatformPayment> pp = paymentRepository.findById(id);
                if (pp.isPresent() && pp.get().getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING
                        && StringUtils.hasText(pp.get().getVendorOrderId())
                        && "AUTOPAY_DEBIT".equals(Json.str(payments.paymentData(pp.get()), "purpose"))) {
                    return true;
                }
            }
        } catch (RuntimeException e) {
            log.warn("[ai-plans-billing] could not list the payments of charge {}: {}", c.id(), e.getMessage());
            return true; // when in doubt, never raise a second debit / a link
        }
        return false;
    }

    /** First purchase / upgrade: the link is made at checkout. Once it lapses unpaid, void the charge. */
    /**
     * A first-purchase / upgrade charge that never had a link but was queued by staff (super-admin
     * assign with "send link", or the portal's Send link: both set {@code next_attempt_at}; a
     * storefront checkout never does, it makes its link in the request).
     */
    static boolean staffQueuedWithoutLink(ChargeView c, Instant now) {
        return !StringUtils.hasText(c.paymentLinkId()) && c.nextAttemptAt() != null && !c.nextAttemptAt().isAfter(now);
    }

    void sendQueuedCheckoutLink(ChargeView c, Report r) {
        Instant expiry = payments.now().plus(c.isUpgrade() ? AiSubscriptionPaymentService.UPGRADE_TTL
                : AiSubscriptionPaymentService.FIRST_PURCHASE_TTL);
        LinkOutcome link = payments.createLinkForCharge(c, null, expiry, null, null, null);
        if (link.alreadyPaid()) {
            r.inc("already_paid");
            return;
        }
        r.inc("links_created");
        mailer.send(new Mail(c.isUpgrade() ? Kind.UPGRADE_LINK : Kind.PAYMENT_LINK, c.instituteId(), c.planName(),
                AiPlansBillingMailer.money(link.totalMinor(), c.currency()), link.url(), c.serviceStart(),
                link.expiresAt(), null, null));
    }

    void expireStaleCheckout(ChargeView c, Instant now, Report r) {
        if (c.linkExpiresAt() == null || c.linkExpiresAt().isAfter(now)) {
            return;
        }
        if (StringUtils.hasText(c.paymentLinkId()) && payments.closeLink(c.paymentLinkId(), c.platformPaymentId())) {
            r.inc("already_paid");
            return; // paid at the last moment: the webhook / reconcile fulfils it
        }
        client.voidCharge(c.id(), c.isUpgrade() ? "UPGRADE_LINK_EXPIRED" : "CHECKOUT_EXPIRED", ACTOR);
        r.inc("checkouts_expired");
    }

    /**
     * Autopay for a renewal charge (D5). Timeline with an ACTIVE mandate:
     * <ol>
     *   <li>from {@value #NOTICE_LEAD_HOURS} h before the service start: the tax snapshot is written
     *       (while the charge is still DUE: ai_service locks the amount once a debit is scheduled),
     *       the pre-debit notice email goes out and, only once it was handed over, the charge becomes
     *       DEBIT_SCHEDULED with {@code next_attempt_at} at least 24 h after the notice;</li>
     *   <li>at {@code next_attempt_at} ({@value #DEBIT_CREATE_LEAD_HOURS} h before the start): the
     *       recurring payment is created (see {@link AiSubscriptionPaymentService#createDebit});</li>
     *   <li>a refused debit, or a payment.failed later, falls back to a payment link at once; a debit
     *       whose outcome is unknown waits for the webhook / reconcile, never a link.</li>
     * </ol>
     * A charge already being collected by a live payment link stays with the link.
     *
     * @return true when autopay owns this charge (notice sent / debit raised / waiting)
     */
    boolean tryAutopay(ChargeView c, Instant now, Report r) {
        if (!settings.autopayEnabled() || c.debitAttempts() > 0 || "FAILED".equalsIgnoreCase(c.status())
                || c.serviceStart() == null || c.subscriptionId() == null) {
            return false;
        }
        if (!"DEBIT_SCHEDULED".equalsIgnoreCase(c.status()) && StringUtils.hasText(c.paymentLinkId())
                && c.linkExpiresAt() != null && c.linkExpiresAt().isAfter(now)) {
            return false; // never a live link AND a debit for one charge
        }
        Optional<Mandate> found = c.mandateId() != null ? mandates.findById(c.mandateId())
                : mandates.findActiveForSubscription(c.subscriptionId());
        if (found.isEmpty() || !found.get().isActive() || !StringUtils.hasText(found.get().tokenId())
                || !c.instituteId().equals(found.get().instituteId())) {
            return false;
        }
        Mandate m = found.get();
        Priced priced;
        try {
            priced = payments.price(c);
        } catch (Exception e) {
            return false; // no billing state: the link path reports it
        }
        long total = priced.tax().getTotalAmountMinor();
        if (!AiSubscriptionPaymentService.autopayEligible(total)
                || m.maxAmountMinor() != null && total > m.maxAmountMinor()) {
            return false;
        }
        boolean upi = "UPI".equalsIgnoreCase(m.method());
        Instant debitAt = c.serviceStart().minus(Duration.ofHours(DEBIT_CREATE_LEAD_HOURS));
        if (c.preDebitNoticeSentAt() == null) {
            if (now.isBefore(c.serviceStart().minus(Duration.ofHours(NOTICE_LEAD_HOURS)))) {
                return true; // too early for anything; autopay will handle it
            }
            // The customer can cancel or pause the mandate from their UPI / bank app, and a token.*
            // webhook can be missed: ask Razorpay before promising a debit in the notice.
            String tokenState = tokenStateAtRazorpay(m, now);
            if (tokenState != null && !AiSubscriptionMandateStore.ACTIVE.equals(tokenState)) {
                handler.applyMandateStatus(m, tokenState, "token " + tokenState + " at Razorpay before the pre-debit notice");
                r.inc("mandates_unusable_at_notice");
                return false; // the link path takes this charge
            }
            Instant createAt = later(debitAt, now.plus(MIN_NOTICE));
            // What the customer is told: when Razorpay debits after we raise the payment.
            Instant expectedDebit = createAt.plus(upi ? AiSubscriptionPaymentService.UPI_EXPECTED_DEBIT
                    : AiSubscriptionPaymentService.CARD_EXPECTED_DEBIT);
            payments.patchSnapshot(c, priced);
            // The notice first: the charge is scheduled for a debit only when it was handed over.
            int sent = mailer.send(new Mail(Kind.PRE_DEBIT_NOTICE, c.instituteId(), c.planName(),
                    AiPlansBillingMailer.money(total, c.currency()), null, c.serviceStart(), null, expectedDebit,
                    upi ? "UPI Autopay" : "card"));
            if (sent <= 0) {
                SentryLogger.logWarning("AI plan pre-debit notice not delivered; collecting by payment link instead",
                        Map.of("charge_id", c.id(), "institute_id", c.instituteId()));
                r.inc("pre_debit_notices_undelivered");
                return false; // the link path takes the charge this run (and keeps it: live link)
            }
            Map<String, Object> patch = new LinkedHashMap<>();
            patch.put("pre_debit_notice_sent_at", now.toString());
            patch.put("mandate_id", m.id());
            patch.put("status", "DEBIT_SCHEDULED");
            patch.put("next_attempt_at", createAt.toString());
            client.patchCharge(c.id(), patch);
            r.inc("pre_debit_notices");
            return true;
        }
        Instant notBefore = later(debitAt, c.preDebitNoticeSentAt().plus(MIN_NOTICE));
        if (now.isBefore(notBefore)) {
            return true;
        }
        Customer customer = null;
        try {
            customer = gateway.fetchCustomer(m.razorpayCustomerId());
        } catch (Exception e) {
            log.warn("[ai-plans-billing] customer {} unavailable: {}", m.razorpayCustomerId(), e.getMessage());
        }
        String contact = customer != null && StringUtils.hasText(customer.contact()) ? customer.contact()
                : payments.instituteContact(c.instituteId());
        String email = customer == null ? null : customer.email();
        try {
            payments.createDebit(c, m, contact, email);
            r.inc("debits_created");
        } catch (DebitOutcomeUnknownException e) {
            // Razorpay may have the payment: no link, no second debit; webhook / reconcileOrder settle it.
            SentryLogger.logWarning("AI plan autopay debit outcome unknown; waiting for Razorpay",
                    Map.of("charge_id", c.id(), "institute_id", c.instituteId(), "error", trim(e.getMessage(), 250)));
            r.inc("debits_unknown");
        } catch (DebitRefusedException e) {
            refusedDebitFallback(c, e, r);
        } catch (AiPlansBillingException e) {
            if (AiPlansBillingException.AUTOPAY_UNAVAILABLE.equals(e.getCode())) {
                refusedDebitFallback(c, e, r); // the mandate cannot take it: pay by link
            } else {
                notRaised(c, now, e, r);
            }
        } catch (RuntimeException e) {
            // DebitNotRaisedException, or a failure before the claim (snapshot / payment row):
            // nothing exists at Razorpay.
            notRaised(c, now, e, r);
        }
        return true;
    }

    /**
     * The mandate's state as Razorpay reports it ({@code GET /customers/{id}/tokens}): ACTIVE,
     * PAUSED, REJECTED, CANCELLED or EXPIRED, or null when unknown (token not listed, a status we
     * don't map, or the call failed). Null keeps today's path: the debit is attempted and a
     * refusal falls back to a payment link.
     */
    String tokenStateAtRazorpay(Mandate m, Instant now) {
        if (!StringUtils.hasText(m.razorpayCustomerId())) {
            return null;
        }
        try {
            for (TokenInfo t : gateway.fetchTokens(m.razorpayCustomerId())) {
                if (m.tokenId().equals(t.id())) {
                    if (t.expiredAt() != null && t.expiredAt() > 0
                            && Instant.ofEpochSecond(t.expiredAt()).isBefore(now)) {
                        return AiSubscriptionMandateStore.EXPIRED;
                    }
                    return AiSubscriptionPaymentHandler.mandateStatusFor(null, t.status());
                }
            }
        } catch (Exception e) {
            log.warn("[ai-plans-billing] token check for mandate {} failed: {}", m.id(), e.getMessage());
        }
        return null;
    }

    private void refusedDebitFallback(ChargeView c, Exception e, Report r) {
        log.warn("[ai-plans-billing] debit for charge {} refused ({}); sending a payment link", c.id(), e.getMessage());
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("status", "FAILED");
        patch.put("debit_attempts", c.debitAttempts() + 1);
        patch.put("last_error", trim(e.getMessage(), 250));
        client.patchCharge(c.id(), patch);
        handler.fallBackToLink(c.id(), c.instituteId(), Kind.DEBIT_FAILED);
        r.inc("debits_failed");
    }

    /** Nothing was raised: retry on the next pass, or by link once the period has started. */
    private void notRaised(ChargeView c, Instant now, Exception e, Report r) {
        if (!now.isBefore(c.serviceStart())) {
            refusedDebitFallback(c, e, r); // too late for a debit now
            return;
        }
        log.warn("[ai-plans-billing] debit for charge {} not raised this run ({}); retrying next run", c.id(),
                e.getMessage());
        r.errors.add(c.id() + ": debit not raised: " + e.getMessage());
        r.inc("debits_not_raised");
    }

    /**
     * T-3 / T-0 / grace reminders for renewal links that are still live (ai_service's
     * {@code needs_collection} lists a LINK_SENT charge only once its link has expired).
     */
    void remind(Report r) {
        List<Map<String, Object>> live;
        try {
            live = client.chargesWithLiveLinks();
        } catch (Exception e) {
            r.errors.add("live links: " + e.getMessage());
            return;
        }
        Instant now = payments.now();
        for (Map<String, Object> raw : live) {
            ChargeView c = ChargeView.from(raw);
            if (c == null || c.instituteId() == null || c.isFirstPurchase() || c.isUpgrade()
                    || !"LINK_SENT".equalsIgnoreCase(c.status())
                    || c.subscriptionStatus() != null && !"ACTIVE".equalsIgnoreCase(c.subscriptionStatus())
                            && !"GRACE".equalsIgnoreCase(c.subscriptionStatus())) {
                continue;
            }
            try {
                sendReminderIfDue(c, now, r);
            } catch (Exception e) {
                r.errors.add("reminder " + c.id() + ": " + e.getMessage());
            }
        }
    }

    void sendReminderIfDue(ChargeView c, Instant now, Report r) {
        if (c.serviceStart() == null || !StringUtils.hasText(c.platformPaymentId())) {
            return;
        }
        String stage = null;
        Kind kind = null;
        Instant start = c.serviceStart();
        Instant graceEnd = c.graceEnd();
        if (!now.isBefore(start.plus(Duration.ofDays(1))) && graceEnd != null && now.isBefore(graceEnd)) {
            stage = "GRACE";
            kind = Kind.GRACE;
        } else if (!now.isBefore(start) && now.isBefore(start.plus(Duration.ofDays(1)))) {
            stage = "T-0";
            kind = Kind.REMINDER_DUE_TODAY;
        } else if (!now.isBefore(start.minus(Duration.ofDays(3))) && now.isBefore(start)) {
            stage = "T-3";
            kind = Kind.REMINDER_DUE_SOON;
        }
        if (stage == null) {
            return;
        }
        Optional<PlatformPayment> pp = paymentRepository.findById(c.platformPaymentId());
        if (pp.isEmpty() || reminderSent(pp.get(), stage)) {
            return;
        }
        long total = pp.get().getTotalAmountMinor() == null ? 0L : pp.get().getTotalAmountMinor();
        mailer.send(new Mail(kind, c.instituteId(), c.planName(), AiPlansBillingMailer.money(total, c.currency()),
                c.paymentLinkUrl(), start, c.linkExpiresAt() != null ? c.linkExpiresAt() : graceEnd, null, null));
        markReminder(c.platformPaymentId(), stage);
        r.inc("reminders_" + stage);
    }

    @SuppressWarnings("unchecked")
    boolean reminderSent(PlatformPayment p, String stage) {
        Object list = payments.paymentData(p).get(DATA_REMINDERS);
        return list instanceof List<?> l && l.contains(stage);
    }

    @SuppressWarnings("unchecked")
    void markReminder(String paymentId, String stage) {
        if (paymentId == null) {
            return;
        }
        try {
            tx.executeWithoutResult(s -> paymentRepository.findByIdForUpdate(paymentId).ifPresent(p -> {
                Map<String, Object> data = payments.paymentData(p);
                List<Object> sent = data.get(DATA_REMINDERS) instanceof List<?> l ? new ArrayList<>(l) : new ArrayList<>();
                if (!sent.contains(stage)) {
                    sent.add(stage);
                }
                p.setPaymentSpecificData(payments.mergeJson(p.getPaymentSpecificData(), Map.of(DATA_REMINDERS, sent)));
                paymentRepository.save(p);
            }));
        } catch (Exception e) {
            log.warn("[ai-plans-billing] could not record reminder {} on {}: {}", stage, paymentId, e.getMessage());
        }
    }

    // ── reconcile ────────────────────────────────────────────────────────

    void reconcile(Report r) {
        reconcileOpenPayments(r);
        reconcileInvoices(r);
        reconcileMandates(r);
        reconcileRefundSync(r);
    }

    /**
     * Unpaid subscription payments older than 30 min: settle a lost payment, expire a dead link,
     * and close the link of a charge ai_service has closed meanwhile (the roll voids unpaid
     * checkouts, expired renewals, cancelled and re-priced charges without telling admin_core).
     */
    void reconcileOpenPayments(Report r) {
        for (String id : safeList(() -> queries.staleOpenPaymentIds(30, 200), r)) {
            try {
                PlatformPayment p = paymentRepository.findById(id).orElse(null);
                if (p == null || p.getVendorOrderId() == null) {
                    continue;
                }
                if (closeLinkOfClosedCharge(p, r)) {
                    continue;
                }
                if (p.getVendorOrderId().startsWith("plink_")) {
                    String status = webhookService.reconcileFromLink(id);
                    if (status != null) {
                        r.inc("links_checked");
                    }
                    continue;
                }
                if (p.getVendorOrderId().startsWith("order_")) {
                    reconcileOrder(p, r);
                }
            } catch (Exception e) {
                r.errors.add("reconcile " + id + ": " + e.getMessage());
            }
        }
    }

    /**
     * When the payment's charge is no longer open (VOID, WAIVED, or settled by another payment),
     * its still-payable link is cancelled. If Razorpay says it was paid in the meantime, the
     * payment is fulfilled through the normal path (ai_service then answers REFUND_REQUIRED /
     * DUPLICATE, or activates a lapsed checkout). Returns true when it handled the payment.
     */
    boolean closeLinkOfClosedCharge(PlatformPayment p, Report r) {
        List<PlatformPaymentItem> items = itemRepository.findByPlatformPaymentId(p.getId());
        String chargeId = AiSubscriptionPaymentHandler.chargeIdOf(items);
        if (chargeId == null) {
            return false;
        }
        ChargeView c = ChargeView.from(client.charge(chargeId, p.getInstituteId()));
        if (c == null || c.isOpen() && p.getId().equals(c.platformPaymentId())) {
            return false;
        }
        if (c.isOpen()) {
            // The charge moved on to a newer payment: this older row must not stay payable.
            String linkId = p.getVendorOrderId().startsWith("plink_") ? p.getVendorOrderId() : null;
            if (linkId == null) {
                return false;
            }
            if (payments.closeLink(linkId, p.getId())) {
                webhookService.reconcileFromLink(p.getId());
                r.inc("superseded_links_paid");
            } else {
                r.inc("superseded_links_closed");
            }
            return true;
        }
        String linkId = p.getVendorOrderId().startsWith("plink_") ? p.getVendorOrderId()
                : StringUtils.hasText(c.paymentLinkId()) && c.paymentLinkId().startsWith("inv_")
                        && p.getId().equals(c.platformPaymentId()) ? c.paymentLinkId() : null;
        if (linkId == null) {
            return false; // a debit order: reconcileOrder decides
        }
        if (payments.closeLink(linkId, p.getId())) {
            if (linkId.startsWith("plink_")) {
                webhookService.reconcileFromLink(p.getId());
            } else {
                reconcileOrder(p, r);
            }
            r.inc("closed_charge_links_paid");
        } else {
            r.inc("closed_charge_links_closed");
        }
        return true;
    }

    /** Registration and debit orders: fulfil a captured payment; a debit with only failures falls back. */
    void reconcileOrder(PlatformPayment p, Report r) {
        List<PaymentInfo> list = gateway.fetchOrderPayments(p.getVendorOrderId());
        for (PaymentInfo info : list) {
            if ("captured".equalsIgnoreCase(info.status())) {
                webhookService.fulfillCreditPackPayment(p.getId(), info.id());
                r.inc("orders_fulfilled");
                return;
            }
        }
        Map<String, Object> data = payments.paymentData(p);
        boolean debit = "AUTOPAY_DEBIT".equals(Json.str(data, "purpose"));
        boolean allFailed = !list.isEmpty() && list.stream().allMatch(i -> "failed".equalsIgnoreCase(i.status()));
        Instant created = p.getCreatedAt() == null ? null
                : p.getCreatedAt().toInstant(java.time.ZoneOffset.UTC);
        boolean old = created != null && created.isBefore(payments.now().minus(Duration.ofHours(48)));
        if (debit && p.getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING && (allFailed || old && list.isEmpty())) {
            tx.executeWithoutResult(s -> paymentRepository.findByIdForUpdate(p.getId()).ifPresent(row -> {
                if (row.getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING) {
                    row.setStatus(PlatformPaymentStatus.FAILED);
                    row.setPaymentStatus(PlatformPaymentResult.FAILED);
                    paymentRepository.save(row);
                }
            }));
            List<PlatformPaymentItem> items = itemRepository.findByPlatformPaymentId(p.getId());
            String chargeId = AiSubscriptionPaymentHandler.chargeIdOf(items);
            if (chargeId != null) {
                Map<String, Object> patch = new LinkedHashMap<>();
                patch.put("status", "FAILED");
                patch.put("last_error", "autopay debit did not complete");
                client.patchCharge(chargeId, patch);
                handler.fallBackToLink(chargeId, p.getInstituteId(), Kind.DEBIT_FAILED);
                r.inc("debits_lapsed");
            }
        } else if (!debit && p.getLinkExpiresAt() != null && p.getLinkExpiresAt().isBefore(payments.now())
                && list.stream().noneMatch(i -> "authorized".equalsIgnoreCase(i.status()))) {
            payments.markExpired(p.getId());
            r.inc("registrations_expired");
        }
    }

    void reconcileInvoices(Report r) {
        for (String id : safeList(() -> queries.paidWithoutInvoice(15, 100), r)) {
            try {
                handler.issueInvoiceAndEmail(id, itemRepository.findByPlatformPaymentId(id));
                r.inc("invoices_repaired");
            } catch (Exception e) {
                r.errors.add("invoice " + id + ": " + e.getMessage());
            }
        }
    }

    void reconcileMandates(Report r) {
        for (Mandate m : safeList(() -> mandates.findPendingWithToken(100), r)) {
            try {
                if (m.razorpayCustomerId() == null) {
                    continue;
                }
                for (TokenInfo t : gateway.fetchTokens(m.razorpayCustomerId())) {
                    if (m.tokenId().equals(t.id())) {
                        String target = AiSubscriptionPaymentHandler.mandateStatusFor(null, t.status());
                        if (target != null) {
                            handler.applyMandateStatus(m, target, null);
                            r.inc("mandates_synced");
                        }
                    }
                }
            } catch (Exception e) {
                r.errors.add("mandate " + m.id() + ": " + e.getMessage());
            }
        }
        for (Mandate m : safeList(() -> mandates.findLapsedPending(3, 200), r)) {
            mandates.updateStatus(m.id(), AiSubscriptionMandateStore.EXPIRED, "registration not completed");
            r.inc("mandates_lapsed");
        }
    }

    void reconcileRefundSync(Report r) {
        for (String id : safeList(() -> queries.refundSyncPending(100), r)) {
            try {
                PlatformPayment p = paymentRepository.findById(id).orElse(null);
                if (p == null) {
                    continue;
                }
                String chargeId = AiSubscriptionPaymentHandler.chargeIdOf(itemRepository.findByPlatformPaymentId(id));
                if (chargeId == null || p.getVendorPaymentId() == null) {
                    continue;
                }
                String refundId = Json.str(payments.paymentData(p), "refundSyncPending");
                long cumulative = p.getRefundedAmountMinor() == null ? 0L : p.getRefundedAmountMinor();
                if (cumulative <= 0) {
                    continue;
                }
                client.chargeRefunded(chargeId, p.getVendorPaymentId(), cumulative, cumulative, refundId);
                tx.executeWithoutResult(s -> paymentRepository.findByIdForUpdate(id).ifPresent(row -> {
                    Map<String, Object> data = payments.paymentData(row);
                    data.remove("refundSyncPending");
                    row.setPaymentSpecificData(payments.toJson(data));
                    paymentRepository.save(row);
                }));
                r.inc("refunds_synced");
            } catch (Exception e) {
                r.errors.add("refund sync " + id + ": " + e.getMessage());
            }
        }
    }

    private interface Query<T> {
        List<T> run();
    }

    private static <T> List<T> safeList(Query<T> q, Report r) {
        try {
            return q.run();
        } catch (Exception e) {
            r.errors.add("query: " + e.getMessage());
            return List.of();
        }
    }

    private static Instant later(Instant a, Instant b) {
        return a.isAfter(b) ? a : b;
    }

    private static String trim(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() > max ? s.substring(0, max) : s;
    }
}
