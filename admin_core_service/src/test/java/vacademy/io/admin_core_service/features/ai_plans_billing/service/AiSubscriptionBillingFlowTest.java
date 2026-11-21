package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLinkRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RecurringDebitRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RegistrationLinkRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService.PayRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService.Report;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService.FulfilResult;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.CapturedPayment;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.INST;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.PV_MAX;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.PV_PRO;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.PV_STARTER;

/**
 * End-to-end money flows of paid AI plans on the admin_core side: facade -> Razorpay (mocked) ->
 * webhook (S2's real PlatformRazorpayWebHookService + this unit's handler) -> ai_service (an
 * in-memory fake with the same contract) -> invoice / email, and the hourly billing job.
 */
class AiSubscriptionBillingFlowTest {

    static final String RETURN = "https://admin.inst.test/settings?selectedTab=aiSettings";
    /** Rs 5,000 + IGST 18% (buyer in 27, supplier in 23). */
    static final long PRO_TOTAL = 590_000L;

    BillingFixture f;

    @BeforeEach
    void setUp() {
        f = new BillingFixture();
    }

    private Map<String, Object> checkout(String pv, boolean autopay, String key) {
        return f.billing.checkout(INST, new PayRequest(pv, autopay, autopay ? "UPI" : null,
                autopay ? "9876543210" : null, RETURN, key), "user-1", "admin@inst.test");
    }

    private List<Kind> mailKinds() {
        ArgumentCaptor<Mail> c = ArgumentCaptor.forClass(Mail.class);
        verify(f.mailer, atLeastOnce()).send(c.capture());
        return c.getAllValues().stream().map(Mail::kind).collect(Collectors.toList());
    }

    private List<PlatformPayment> paymentsFor(String chargeId) {
        return f.payments.values().stream().filter(p -> f.items.getOrDefault(p.getId(), List.of()).stream()
                .anyMatch(i -> chargeId.equals(i.getSubscriptionChargeId()))).toList();
    }

    /** An ACTIVE PRO subscription half-way through its period, plus its renewal charge (DUE) at the period end. */
    private Map<String, Object> renewalCharge(Instant serviceStart) {
        Map<String, Object> sub = f.ai.activeSubscription(serviceStart.minus(Duration.ofDays(30)));
        return f.ai.newCharge((String) sub.get("subscription_id"), "PERIOD", PV_PRO, serviceStart,
                serviceStart.plus(Duration.ofDays(30)), BillingFixture.PRO_BASE);
    }

    // ── 1. first purchase by payment link ───────────────────────────────

    @Test
    void firstPurchaseLinkActivatesOnCaptureThenInvoicesOnce() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, false, "key-1");

        assertEquals("LINK", out.get("mode"));
        assertTrue(((String) out.get("url")).startsWith("https://rzp.io/l/"));
        assertEquals(PRO_TOTAL, out.get("total_minor"));

        ArgumentCaptor<PaymentLinkRequest> req = ArgumentCaptor.forClass(PaymentLinkRequest.class);
        verify(f.gateway).createPaymentLink(req.capture());
        PaymentLinkRequest r = req.getValue();
        assertEquals(PRO_TOTAL, r.amountMinor());
        assertEquals(f.now.plus(Duration.ofHours(48)).getEpochSecond(), r.expireByEpochSeconds(), "48 h first-purchase link");
        assertEquals("Vidyayatan Technologies", r.checkoutName(), "NEUTRAL brand on the hosted page");
        assertEquals("AI_SUBSCRIPTION", r.notes().get("payment_type"));
        assertTrue(r.callbackUrl().startsWith(RETURN + "&plan_pp="));

        Map<String, Object> charge = f.ai.charges.values().iterator().next();
        assertEquals("LINK_SENT", charge.get("status"));
        assertEquals(PRO_TOTAL, ((Number) charge.get("total_minor")).longValue(), "tax snapshot before the link");
        assertEquals("27", charge.get("place_of_supply"));
        assertEquals("IGST", charge.get("tax_head"));

        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, pp.getPaymentStatus());
        assertEquals("27", pp.getBuyerStateCode());
        assertEquals("Inst One Pvt Ltd", pp.getBuyerLegalName());
        assertEquals("NEUTRAL", pp.getBrandMode());
        PlatformPaymentItem item = f.items.get(pp.getId()).get(0);
        assertEquals(PlatformPaymentItemKind.AI_SUBSCRIPTION, item.getItemKind());
        assertNull(item.getPackId());
        assertEquals("998315", item.getHsnSacSnapshot());
        assertEquals(charge.get("id"), item.getSubscriptionChargeId());

        // Same dialog (same idempotency key) again: the same open link, nothing new at Razorpay.
        Map<String, Object> again = checkout(PV_PRO, false, "key-1");
        assertEquals(out.get("url"), again.get("url"));
        verify(f.gateway, times(1)).createPaymentLink(any());

        assertEquals(200, f.deliver(f.capturedEvent(pp.getId(), "pay_1", PRO_TOTAL, null, null)).getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAID, pp.getPaymentStatus());
        assertEquals("ACTIVE", f.ai.sub().get("status"));
        assertEquals("PAID", charge.get("status"));
        verify(f.invoiceService).generateInvoice(pp.getId());
        verify(f.documentMail, times(1)).sendInvoiceEmail(any());

        // order.paid / a Razorpay retry: no second /paid, invoice or email.
        f.deliver(f.capturedEvent(pp.getId(), "pay_1", PRO_TOTAL, null, null));
        assertEquals(1, f.ai.calls.stream().filter(c -> c.startsWith("paid:")).count());
        verify(f.documentMail, times(1)).sendInvoiceEmail(any());
    }

    @Test
    void checkoutRefusals() {
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class, () -> f.billing.checkout(INST,
                new PayRequest(PV_PRO, false, null, null, "https://evil.example/x", "k"), "u", null));
        assertEquals(AiPlansBillingException.RETURN_URL_NOT_ALLOWED, e.getCode());

        when(f.settings.invoiceSeriesV2Enabled()).thenReturn(false);
        e = assertThrows(AiPlansBillingException.class, () -> checkout(PV_PRO, false, "k"));
        assertEquals(AiPlansBillingException.INVOICE_SERIES_V2_REQUIRED, e.getCode());

        when(f.settings.invoiceSeriesV2Enabled()).thenReturn(true);
        when(f.settings.paymentsEnabled()).thenReturn(false);
        e = assertThrows(AiPlansBillingException.class, () -> checkout(PV_PRO, false, "k"));
        assertEquals(AiPlansBillingException.PAYMENTS_DISABLED, e.getCode());

        when(f.settings.paymentsEnabled()).thenReturn(true);
        f.profiles.get(INST).setStateCode(null);
        e = assertThrows(AiPlansBillingException.class, () -> checkout(PV_PRO, false, "k"));
        assertEquals(AiPlansBillingException.BUYER_STATE_REQUIRED, e.getCode());

        when(f.storefront.isOpen(INST)).thenReturn(false);
        org.mockito.Mockito.doThrow(AiPlansBillingException.storefrontOff()).when(f.storefront).requireOpen(INST);
        e = assertThrows(AiPlansBillingException.class, () -> f.billing.storefront(INST));
        assertEquals(AiPlansBillingException.STOREFRONT_OFF, e.getCode());
        assertTrue(f.ai.calls.stream().noneMatch(c -> c.startsWith("checkout")), "nothing reached ai_service");
        verify(f.gateway, never()).createPaymentLink(any());
    }

    @Test
    void storefrontNeverPassesInternalFieldsAndTaxesThePrice() {
        Map<String, Object> sf = f.billing.storefront(INST);
        String json = sf.toString();
        assertFalse(json.contains("internal_cost_cap_usd"), json);
        assertEquals("NEUTRAL", sf.get("brand_mode"));
        @SuppressWarnings("unchecked")
        Map<String, Object> supplier = (Map<String, Object>) sf.get("supplier");
        assertNull(supplier.get("trade_name"), "no Vacademy trade name for a white-labelled institute");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> plans = (List<Map<String, Object>>) sf.get("plans");
        Map<String, Object> pro = plans.stream().filter(p -> PV_PRO.equals(p.get("plan_version_id"))).findFirst().orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String, Object> price = (Map<String, Object>) pro.get("price");
        assertEquals(500_000L, price.get("base_minor"));
        assertEquals(PRO_TOTAL, price.get("total_minor"));
        assertEquals("18% GST", price.get("tax_label"));
        assertEquals(true, pro.get("autopay_eligible"));
    }

    @Test
    void vacademyBrandShowsTheTradeNameOnTheHostedPage() {
        when(f.brand.resolve(INST)).thenReturn(BrandMode.VACADEMY);
        checkout(PV_PRO, false, "k-v");
        ArgumentCaptor<PaymentLinkRequest> req = ArgumentCaptor.forClass(PaymentLinkRequest.class);
        verify(f.gateway).createPaymentLink(req.capture());
        assertEquals("Vacademy", req.getValue().checkoutName());
    }

    @Test
    void lapsedFirstPurchaseLinkIsVoidedByTheJob() {
        checkout(PV_PRO, false, "k-lapse");
        f.advance(Duration.ofHours(49));
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("checkouts_expired"));
        assertTrue(f.ai.calls.contains("void:CHECKOUT_EXPIRED"));
        verify(f.gateway).cancelPaymentLink(anyString());
    }

    // ── 2. autopay registration at checkout + 3. token.confirmed ─────────

    @Test
    void autopayRegistrationPaysTheFirstChargeAndTokenConfirmedActivatesTheMandate() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, true, "k-auto");
        assertEquals("MANDATE", out.get("mode"));
        ArgumentCaptor<RegistrationLinkRequest> req = ArgumentCaptor.forClass(RegistrationLinkRequest.class);
        verify(f.gateway).createRegistrationLink(req.capture());
        RegistrationLinkRequest r = req.getValue();
        assertEquals(PRO_TOTAL, r.amountMinor(), "the authorisation payment pays the first period");
        assertEquals(1_500_000L, r.maxAmountMinor(), "Rs 15,000 AFA-free ceiling per debit");
        assertEquals("as_presented", r.frequency());
        assertEquals("upi", r.method());
        verify(f.gateway, never()).createPaymentLink(any());

        Mandate m = f.mandates.rows.values().iterator().next();
        assertEquals(AiSubscriptionMandateStore.PENDING, m.status());
        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        assertTrue(pp.getVendorOrderId().startsWith("order_reg"));

        // The registration payment's notes live on the invoice: the webhook finds it by order id.
        f.deliver(f.capturedEvent(null, "pay_auth", PRO_TOTAL, "token_abc", pp.getVendorOrderId()));
        assertEquals(PlatformPaymentResult.PAID, pp.getPaymentStatus());
        assertEquals("ACTIVE", f.ai.sub().get("status"));
        m = f.mandates.rows.get(m.id());
        assertEquals("token_abc", m.tokenId());
        assertEquals(AiSubscriptionMandateStore.PENDING, m.status(), "ACTIVE only on token.confirmed");

        assertEquals(200, f.deliver(f.tokenEvent("token.confirmed", "token_abc", "confirmed")).getStatusCode().value());
        assertEquals(AiSubscriptionMandateStore.ACTIVE, f.mandates.rows.get(m.id()).status());
        assertTrue(mailKinds().contains(Kind.MANDATE_ACTIVE));
        // replay: idempotent
        f.deliver(f.tokenEvent("token.confirmed", "token_abc", "confirmed"));
        assertEquals(AiSubscriptionMandateStore.ACTIVE, f.mandates.rows.get(m.id()).status());

        f.deliver(f.tokenEvent("token.rejected", "token_unknown", "rejected")); // unknown token: acked
        f.deliver(f.tokenEvent("token.cancelled", "token_abc", "cancelled"));
        assertEquals(AiSubscriptionMandateStore.CANCELLED, f.mandates.rows.get(m.id()).status());
    }

    @Test
    void autopayAboveTheCeilingFallsBackToAPaymentLink() {
        f.ai.prices.put(PV_MAX, 1_300_000L); // Rs 13,000 + GST = Rs 15,340 > Rs 15,000
        Map<String, Object> out = checkout(PV_MAX, true, "k-big");
        assertEquals("LINK", out.get("mode"));
        verify(f.gateway, never()).createRegistrationLink(any());
        assertEquals(1_534_000L, out.get("total_minor"));
    }

    // ── 4. scheduled debit + 5. failed debit -> link -> grace ───────────

    @Test
    void renewalWithAMandateSendsTheNoticeThenDebitsAndAFailureFallsBackToALinkThenGrace() throws Exception {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        String sid = (String) charge.get("subscription_id");
        Mandate m = f.mandates.active(sid);

        // T-72 h: pre-debit notice, snapshot, DEBIT_SCHEDULED.
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("pre_debit_notices"), r.toString());
        assertEquals("DEBIT_SCHEDULED", charge.get("status"));
        assertEquals(PRO_TOTAL, ((Number) charge.get("total_minor")).longValue());
        Instant next = Instant.parse((String) charge.get("next_attempt_at"));
        assertEquals(start.minus(Duration.ofHours(40)), next,
                "raised 40 h before the start: Razorpay debits UPI 24-36 h and cards 36 h 5 min later");
        assertTrue(mailKinds().contains(Kind.PRE_DEBIT_NOTICE));
        verify(f.gateway, never()).createPaymentLink(any());

        // Too early: nothing.
        f.advance(Duration.ofHours(10));
        f.collection.runOnce();
        verify(f.gateway, never()).createRecurringDebit(any());

        // At next_attempt_at: the recurring debit on the token.
        f.now = next;
        r = f.collection.runOnce();
        assertEquals(1, r.counts.get("debits_created"), r.toString());
        ArgumentCaptor<RecurringDebitRequest> dr = ArgumentCaptor.forClass(RecurringDebitRequest.class);
        verify(f.gateway).createRecurringDebit(dr.capture());
        assertEquals(PRO_TOTAL, dr.getValue().amountMinor());
        assertEquals(m.tokenId(), dr.getValue().tokenId());
        assertEquals("cust_1", dr.getValue().customerId());
        assertEquals("AI_SUBSCRIPTION", dr.getValue().notes().get("payment_type"));
        assertEquals(1, ((Number) charge.get("debit_attempts")).intValue());
        PlatformPayment debit = paymentsFor((String) charge.get("id")).get(0);
        assertTrue(debit.getVendorOrderId().startsWith("order_debit"));

        // Next hour: the debit is in flight; no link, no second debit.
        f.advance(Duration.ofHours(1));
        f.collection.runOnce();
        verify(f.gateway, times(1)).createRecurringDebit(any());
        verify(f.gateway, never()).createPaymentLink(any());

        // payment.failed -> FAILED -> a payment link at once, open until the grace end.
        assertEquals(200, f.deliver(f.failedEvent(debit.getId(), "pay_x")).getStatusCode().value());
        assertEquals(PlatformPaymentResult.FAILED, debit.getPaymentStatus());
        ArgumentCaptor<PaymentLinkRequest> lr = ArgumentCaptor.forClass(PaymentLinkRequest.class);
        verify(f.gateway).createPaymentLink(lr.capture());
        assertEquals(start.plus(Duration.ofDays(7)).getEpochSecond(), lr.getValue().expireByEpochSeconds());
        assertEquals("LINK_SENT", charge.get("status"));
        assertTrue(mailKinds().contains(Kind.DEBIT_FAILED));

        // In grace (start + 1.5 d): one GRACE reminder, sent once.
        f.now = start.plus(Duration.ofHours(36));
        f.ai.sub().put("status", "GRACE");
        r = f.collection.runOnce();
        assertEquals(1, r.counts.get("reminders_GRACE"), r.toString());
        f.advance(Duration.ofHours(1));
        r = f.collection.runOnce();
        assertNull(r.counts.get("reminders_GRACE"));

        // Paid in grace by the link: GRACE_CLEARED, invoice.
        PlatformPayment link = paymentsFor((String) charge.get("id")).stream()
                .filter(p -> p.getVendorOrderId().startsWith("plink_")).findFirst().orElseThrow();
        f.deliver(f.capturedEvent(link.getId(), "pay_link", PRO_TOTAL, null, null));
        assertEquals("ACTIVE", f.ai.sub().get("status"));
        verify(f.invoiceService).generateInvoice(link.getId());
    }

    @Test
    void payingByLinkWhileADebitIsInFlightIsRefused() {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        f.mandates.active((String) charge.get("subscription_id"));
        f.collection.runOnce();
        f.now = start.minus(Duration.ofHours(40));
        f.collection.runOnce();
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class,
                () -> f.billing.payCharge(INST, (String) charge.get("id"), RETURN, "u", null));
        assertEquals("DEBIT_IN_PROGRESS", e.getCode());
        verify(f.gateway, never()).createPaymentLink(any());
    }

    @Test
    void anotherInstitutesChargeIsNotFound() {
        Map<String, Object> charge = renewalCharge(f.now.plus(Duration.ofDays(3)));
        charge.put("institute_id", "inst-other");
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class,
                () -> f.billing.payCharge(INST, (String) charge.get("id"), RETURN, "u", null));
        assertEquals(AiPlansBillingException.NOT_FOUND, e.getCode());
    }

    @Test
    void scheduledDebitCapturedRenewsAndInvoices() throws Exception {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        f.mandates.active((String) charge.get("subscription_id"));
        f.collection.runOnce();
        f.now = start.minus(Duration.ofHours(40));
        f.collection.runOnce();
        PlatformPayment debit = paymentsFor((String) charge.get("id")).get(0);
        f.deliver(f.capturedEvent(debit.getId(), "pay_debit", PRO_TOTAL, "token_x", debit.getVendorOrderId()));
        assertEquals("PAID", charge.get("status"));
        assertEquals(PlatformPaymentResult.PAID, debit.getPaymentStatus());
        verify(f.invoiceService).generateInvoice(debit.getId());
    }

    @Test
    void renewalWithoutAMandateGetsALinkAtT7AndReminders() {
        Instant start = f.now.plus(Duration.ofDays(7));
        Map<String, Object> charge = renewalCharge(start);
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("links_created"), r.toString());
        assertEquals("LINK_SENT", charge.get("status"));
        assertTrue(mailKinds().contains(Kind.RENEWAL_LINK));

        f.now = start.minus(Duration.ofDays(2));
        r = f.collection.runOnce();
        assertEquals(1, r.counts.get("reminders_T-3"), r.toString());
        f.now = start.plus(Duration.ofHours(2));
        r = f.collection.runOnce();
        assertEquals(1, r.counts.get("reminders_T-0"), r.toString());
        verify(f.gateway, times(1)).createPaymentLink(any());
    }

    @Test
    void jobIsDarkWithoutThePaymentsSwitch() {
        when(f.settings.paymentsEnabled()).thenReturn(false);
        renewalCharge(f.now.plus(Duration.ofDays(3)));
        assertNull(f.collection.runOnce());
        assertTrue(f.ai.calls.isEmpty());
    }

    // ── 6. duplicate payment -> refund ───────────────────────────────────

    @Test
    void aSecondPaymentForAPaidChargeIsRefundedOnceAndNeverInvoiced() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, false, "k-dup");
        String pp1 = (String) out.get("platform_payment_id");
        Map<String, Object> charge = f.ai.charges.values().iterator().next();
        // A second payable row for the same charge (e.g. a debit raced a fallback link).
        PlatformPayment second = f.paymentService.createPaymentRow(
                vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView.from(f.ai.charge(
                        (String) charge.get("id"), INST)),
                f.paymentService.price(vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView
                        .from(f.ai.charge((String) charge.get("id"), INST))), null, Map.of("purpose", "LINK"));

        f.deliver(f.capturedEvent(pp1, "pay_1", PRO_TOTAL, null, null));
        f.deliver(f.capturedEvent(second.getId(), "pay_2", PRO_TOTAL, null, null));

        assertEquals(PlatformPaymentDisposition.DUPLICATE, second.getDisposition());
        assertEquals(PlatformPaymentResult.PAID, second.getPaymentStatus(), "money was received");
        assertNotNull(second.getRefundRequestedAt());
        assertEquals(List.of("pay_2:" + PRO_TOTAL), f.refunds);
        verify(f.invoiceService, never()).generateInvoice(second.getId());

        // Retried webhook: no second refund.
        f.deliver(f.capturedEvent(second.getId(), "pay_2", PRO_TOTAL, null, null));
        assertEquals(1, f.refunds.size());
    }

    @Test
    void aChargeWithoutATaxSnapshotIsHeldNotRetriedForeverNorRefunded() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, false, "k-held");
        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        Map<String, Object> charge = f.ai.charges.values().iterator().next();
        charge.put("total_minor", null); // ai_service lost the snapshot (our bug): TOTAL_NOT_SET

        assertEquals(200, f.deliver(f.capturedEvent(pp.getId(), "pay_h", PRO_TOTAL, null, null))
                .getStatusCode().value(), "200, never a 500 loop on the shared platform webhook");
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, pp.getPaymentStatus());
        assertEquals(PlatformPaymentDisposition.NORMAL, pp.getDisposition());
        assertTrue(f.refunds.isEmpty());
        verify(f.invoiceService, never()).generateInvoice(pp.getId());
    }

    // ── 7. upgrade: pro-rata net charge with its own invoice ─────────────

    @Test
    void upgradeChargesTheProRataNetAmountNowAndInvoicesIt() throws Exception {
        f.ai.activeSubscription(f.now.minus(Duration.ofDays(15)));
        Map<String, Object> out = f.billing.change(INST, "UPGRADE", PV_MAX, RETURN, false, "user-1", "a@inst.test");
        assertEquals("LINK", out.get("mode"));
        assertEquals(295_000L, out.get("total_minor"), "Rs 2,500 net + 18% GST");
        ArgumentCaptor<PaymentLinkRequest> req = ArgumentCaptor.forClass(PaymentLinkRequest.class);
        verify(f.gateway).createPaymentLink(req.capture());
        assertEquals(f.now.plus(Duration.ofHours(2)).getEpochSecond(), req.getValue().expireByEpochSeconds(),
                "short-lived upgrade link");
        String ppId = (String) out.get("platform_payment_id");
        assertTrue(f.items.get(ppId).get(0).getDescriptionSnapshot().startsWith("Upgrade to AI Max"));

        f.deliver(f.capturedEvent(ppId, "pay_up", 295_000L, null, null));
        assertEquals(PV_MAX, f.ai.sub().get("plan_version_id"), "applies at once");
        verify(f.invoiceService).generateInvoice(ppId);
        assertEquals(295_000L, f.invoices.get(ppId).getTotalAmountMinor());
    }

    @Test
    void upgradeDryRunReturnsATaxedQuoteWithoutInternalFields() {
        f.ai.activeSubscription(f.now.minus(Duration.ofDays(15)));
        Map<String, Object> out = f.billing.change(INST, "UPGRADE", PV_MAX, null, true, "u", null);
        assertEquals("QUOTE", out.get("mode"));
        @SuppressWarnings("unchecked")
        Map<String, Object> q = (Map<String, Object>) out.get("quote");
        assertEquals(295_000L, q.get("total_minor"));
        assertFalse(out.toString().contains("internal_cost_cap_usd"));
        verify(f.gateway, never()).createPaymentLink(any());
    }

    // ── 8. downgrade at renewal + 9. cancel at period end ────────────────

    @Test
    void downgradeClosesTheOldRenewalLinkAndTheNextRenewalIsPricedLower() {
        Instant start = f.now.plus(Duration.ofDays(5));
        Map<String, Object> old = renewalCharge(start);
        f.collection.runOnce(); // T-5: renewal link at the PRO price
        String oldLink = (String) old.get("payment_link_id");
        String oldPp = (String) old.get("platform_payment_id");

        Map<String, Object> out = f.billing.change(INST, "DOWNGRADE", PV_STARTER, null, false, "u", null);
        assertEquals("APPLIED", out.get("mode"));
        verify(f.gateway).cancelPaymentLink(oldLink);
        assertEquals(PlatformPaymentResult.EXPIRED, f.payments.get(oldPp).getPaymentStatus());
        assertEquals(PV_STARTER, f.ai.sub().get("pending_plan_version_id"));

        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("links_created"), r.toString());
        ArgumentCaptor<PaymentLinkRequest> req = ArgumentCaptor.forClass(PaymentLinkRequest.class);
        verify(f.gateway, times(2)).createPaymentLink(req.capture());
        assertEquals(236_000L, req.getAllValues().get(1).amountMinor(), "Rs 2,000 + GST from the next period");
    }

    @Test
    void cancelAtPeriodEndClosesTheRenewalLinkAndKeepsThePlanUntilThen() {
        Instant start = f.now.plus(Duration.ofDays(5));
        Map<String, Object> renewal = renewalCharge(start);
        f.mandates.active((String) renewal.get("subscription_id"));
        when(f.settings.autopayEnabled()).thenReturn(false);
        f.collection.runOnce();
        String link = (String) renewal.get("payment_link_id");

        Map<String, Object> out = f.billing.change(INST, "CANCEL", null, null, false, "u", null);
        assertEquals("APPLIED", out.get("mode"));
        verify(f.gateway).cancelPaymentLink(link);
        assertEquals("ACTIVE", f.ai.sub().get("status"));
        assertEquals(true, f.ai.sub().get("cancel_at_period_end"));
        verify(f.gateway, never()).cancelToken(anyString(), anyString(), any());
        assertEquals("VOID", renewal.get("status"));
        assertNull(f.collection.runOnce().counts.get("links_created"));
    }

    // ── 10. amount mismatch refusals ─────────────────────────────────────

    @Test
    void amountMismatchNeverActivates() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, false, "k-mm");
        String ppId = (String) out.get("platform_payment_id");
        Map<String, Object> charge = f.ai.charges.values().iterator().next();

        // (a) Razorpay amount differs from the payment's server-side total: left for staff.
        f.deliver(f.capturedEvent(ppId, "pay_low", 100L, null, null));
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, f.payments.get(ppId).getPaymentStatus());
        assertTrue(f.ai.calls.stream().noneMatch(c -> c.startsWith("paid:")));
        assertEquals("PENDING", f.ai.sub().get("status"));

        // (b) ai_service refuses (the charge total no longer matches the payment): refunded, never a 500 loop.
        charge.put("total_minor", PRO_TOTAL + 1);
        assertEquals(200, f.deliver(f.capturedEvent(ppId, "pay_ok", PRO_TOTAL, null, null)).getStatusCode().value());
        PlatformPayment pp = f.payments.get(ppId);
        assertEquals(PlatformPaymentDisposition.LATE, pp.getDisposition());
        assertEquals(List.of("pay_ok:" + PRO_TOTAL), f.refunds);
        assertEquals("PENDING", f.ai.sub().get("status"));
        verify(f.invoiceService, never()).generateInvoice(ppId);

        // (c) Offline mark-paid with the wrong amount: refused before anything is written.
        int before = f.payments.size();
        Map<String, Object> other = renewalCharge(f.now.plus(Duration.ofDays(3)));
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class, () -> f.ops.markPaidOffline(INST,
                (String) other.get("id"), "NEFT-123", 500_000L, "bank transfer received", "staff:1"));
        assertEquals(AiPlansBillingException.AMOUNT_MISMATCH, e.getCode());
        assertEquals(before, f.payments.size());
    }

    @Test
    void vendorPaymentReusedOnAnotherChargeIsNeverRefunded() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, false, "k-reuse");
        Map<String, Object> other = f.ai.newCharge((String) f.ai.sub().get("subscription_id"), "PERIOD", PV_PRO,
                f.now.plus(Duration.ofDays(40)), f.now.plus(Duration.ofDays(70)), 1L);
        other.put("vendor_payment_id", "pay_shared");
        int code = f.deliver(f.capturedEvent((String) out.get("platform_payment_id"), "pay_shared", PRO_TOTAL, null, null))
                .getStatusCode().value();
        assertEquals(200, code, "held for staff: never a 500 loop that could disable the platform webhook");
        assertTrue(f.refunds.isEmpty());
        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, pp.getPaymentStatus(), "never marked paid on a guess");
        verify(f.invoiceService, never()).generateInvoice(pp.getId());
    }

    // ── ops: offline payment, refund with credit note, closed-charge cleanup ─

    @Test
    void offlinePaymentGoesThroughTheWebhookPathAndInvoices() {
        Map<String, Object> charge = renewalCharge(f.now.plus(Duration.ofDays(3)));
        Map<String, Object> out = f.ops.markPaidOffline(INST, (String) charge.get("id"), "NEFT-998", PRO_TOTAL,
                "bank transfer received", "staff:1");
        assertEquals(FulfilResult.FULFILLED.name(), out.get("result"));
        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        assertEquals("MANUAL", pp.getVendor());
        assertEquals("MANUAL:NEFT-998", pp.getVendorPaymentId());
        assertEquals(PlatformPaymentResult.PAID, pp.getPaymentStatus());
        verify(f.invoiceService).generateInvoice(pp.getId());
        assertEquals("PAID", charge.get("status"));
    }

    @Test
    void staffRefundGoesToRazorpayAndTheRefundWebhookIssuesACreditNoteAndTellsAiService() throws Exception {
        Map<String, Object> out = checkout(PV_PRO, false, "k-rf");
        String ppId = (String) out.get("platform_payment_id");
        f.deliver(f.capturedEvent(ppId, "pay_1", PRO_TOTAL, null, null));
        when(f.gateway.refund(eq("pay_1"), eq(100_000L), anyString(), any()))
                .thenReturn(new vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway
                        .Refund("rfnd_9", 100_000L, "processed"));
        Map<String, Object> r = f.ops.refund(INST, ppId, 100_000L, "goodwill", "staff:1");
        assertEquals("rfnd_9", r.get("refund_id"));
        assertThrows(AiPlansBillingException.class, () -> f.ops.refund(INST, ppId, 100_000L, "goodwill", "staff:1"),
                "double-click guard");

        String evt = "{\"event\":\"refund.processed\",\"payload\":{\"refund\":{\"entity\":{\"id\":\"rfnd_9\","
                + "\"payment_id\":\"pay_1\",\"amount\":100000}},\"payment\":{\"entity\":{\"id\":\"pay_1\","
                + "\"amount_refunded\":100000,\"notes\":{\"payment_type\":\"AI_SUBSCRIPTION\"}}}}}";
        assertEquals(200, f.deliver(evt).getStatusCode().value());
        verify(f.creditNotes).issueForRefund(eq(ppId), eq("rfnd_9"), eq(100_000L), anyString(), anyString());
        assertTrue(f.ai.calls.contains("refunded:pay_1:100000:100000"), f.ai.calls.toString());
        assertEquals(PlatformPaymentResult.PARTIALLY_REFUNDED, f.payments.get(ppId).getPaymentStatus());
    }

    @Test
    void reconcileClosesTheLinkOfAChargeTheRollVoided() {
        Map<String, Object> out = checkout(PV_PRO, false, "k-roll");
        String ppId = (String) out.get("platform_payment_id");
        Map<String, Object> charge = f.ai.charges.values().iterator().next();
        charge.put("status", "VOID"); // the roll expired the checkout
        f.ai.sub().put("status", "EXPIRED");
        when(f.queries.staleOpenPaymentIds(anyInt(), anyInt())).thenReturn(List.of(ppId));
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("closed_charge_links_closed"), r.toString());
        verify(f.gateway).cancelPaymentLink((String) charge.get("payment_link_id"));
        assertEquals(PlatformPaymentResult.EXPIRED, f.payments.get(ppId).getPaymentStatus());
    }

    @Test
    void waiveUsesAiServiceWaiveAndClosesTheLink() {
        Instant start = f.now.plus(Duration.ofDays(5));
        Map<String, Object> charge = renewalCharge(start);
        f.collection.runOnce();
        f.ops.waive(INST, (String) charge.get("id"), "goodwill for outage", "staff:1");
        assertEquals("WAIVED", charge.get("status"));
        verify(f.gateway).cancelPaymentLink(anyString());
        assertTrue(f.ai.calls.contains("waive:goodwill for outage"));
    }

    private static int anyInt() {
        return org.mockito.ArgumentMatchers.anyInt();
    }

    @SuppressWarnings("unused")
    private static long anyLongValue() {
        return anyLong();
    }
}
