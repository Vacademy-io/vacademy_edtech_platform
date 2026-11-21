package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.RazorpayDebitException;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.RazorpayGatewayException;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService.PayRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService.Report;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.common.institute.entity.Institute;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.INST;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.PV_PRO;

/**
 * The fixes of the 2026-10-16 review (autopay timing and failure modes, mandate state machine,
 * refunds on processed only, GST identity, invoice period, staff credit notes), on the same
 * in-memory wiring as {@link AiSubscriptionBillingFlowTest}.
 */
class AiSubscriptionReviewFixesTest {

    static final String RETURN = "https://admin.inst.test/settings?selectedTab=aiSettings";
    static final long PRO_TOTAL = 590_000L;

    BillingFixture f;

    @BeforeEach
    void setUp() {
        f = new BillingFixture();
    }

    private Map<String, Object> renewalCharge(Instant serviceStart) {
        Map<String, Object> sub = f.ai.activeSubscription(serviceStart.minus(Duration.ofDays(30)));
        return f.ai.newCharge((String) sub.get("subscription_id"), "PERIOD", PV_PRO, serviceStart,
                serviceStart.plus(Duration.ofDays(30)), BillingFixture.PRO_BASE);
    }

    private Mandate mandate(String sid, String method, String status, String token) {
        Mandate m = new Mandate(UUID.randomUUID().toString(), INST, sid, "cust_1", token, method, 1_500_000L,
                "as_presented", status, null, null, null, null, null, Instant.now(), Instant.now());
        f.mandates.rows.put(m.id(), m);
        return m;
    }

    private List<PlatformPayment> paymentsFor(String chargeId) {
        return f.payments.values().stream().filter(p -> f.items.getOrDefault(p.getId(), List.of()).stream()
                .anyMatch(i -> chargeId.equals(i.getSubscriptionChargeId()))).toList();
    }

    private Mail lastMail(Kind kind) {
        ArgumentCaptor<Mail> c = ArgumentCaptor.forClass(Mail.class);
        verify(f.mailer, atLeastOnce()).send(c.capture());
        return c.getAllValues().stream().filter(m -> m.kind() == kind).reduce((a, b) -> b).orElseThrow();
    }

    /** Charge renewal at T with an ACTIVE mandate, noticed at T-72 h; returns the time the debit is raised. */
    private Instant noticed(Map<String, Object> charge) {
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("pre_debit_notices"), r.toString());
        return Instant.parse((String) charge.get("next_attempt_at"));
    }

    // ── 1. debits are raised early enough for Razorpay's own delay ───────

    @Test
    void cardDebitIsRaised40hBeforeTheStartAndTheNoticeNamesRazorpaysDebitTime() {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        mandate((String) charge.get("subscription_id"), "CARD", AiSubscriptionMandateStore.ACTIVE, "token_card");
        Instant raise = noticed(charge);
        assertEquals(start.minus(Duration.ofHours(40)), raise);
        Instant debitAt = lastMail(Kind.PRE_DEBIT_NOTICE).debitAt();
        // cards: "we will automatically try to debit after 36 hours and 5 minutes"
        assertEquals(raise.plus(Duration.ofHours(36).plusMinutes(5)), debitAt);
        assertTrue(debitAt.isBefore(start), "the money is in before the period starts");
        f.now = raise;
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("debits_created"), r.toString());
        // even raised at the end of the hourly window, a card debit lands before the start
        assertTrue(raise.plus(Duration.ofHours(1)).plus(Duration.ofHours(36).plusMinutes(5)).isBefore(start));
        assertTrue(Instant.parse((String) charge.get("next_attempt_at")).isAfter(debitAt),
                "the job looks again only after Razorpay's debit time");
    }

    @Test
    void anUndeliveredPreDebitNoticeNeverSchedulesADebit() {
        when(f.mailer.send(argThat(m -> m != null && m.kind() == Kind.PRE_DEBIT_NOTICE))).thenReturn(0);
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        mandate((String) charge.get("subscription_id"), "UPI", AiSubscriptionMandateStore.ACTIVE, "token_upi");
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("pre_debit_notices_undelivered"), r.toString());
        assertNull(charge.get("pre_debit_notice_sent_at"));
        assertEquals("LINK_SENT", charge.get("status"), "collected by a payment link instead");
        // later passes leave it with the link: never a link AND a debit
        when(f.mailer.send(any())).thenReturn(1);
        f.now = start.minus(Duration.ofHours(40));
        f.collection.runOnce();
        f.now = start.minus(Duration.ofHours(2));
        f.collection.runOnce();
        verify(f.gateway, never()).createRecurringDebit(any());
        assertNull(charge.get("pre_debit_notice_sent_at"));
    }

    // ── 2. a debit's failure modes ───────────────────────────────────────

    @Test
    void aDebitWhoseOutcomeIsUnknownIsNeverFollowedByALinkOrASecondDebit() {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        String cid = (String) charge.get("id");
        mandate((String) charge.get("subscription_id"), "UPI", AiSubscriptionMandateStore.ACTIVE, "token_u1");
        f.now = noticed(charge);
        when(f.gateway.createRecurringDebit(any())).thenThrow(new RazorpayDebitException(
                new RazorpayGatewayException(0, "UNREACHABLE", "read timed out"), "order_unknown"));
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("debits_unknown"), r.toString());
        // the claim stays: DEBIT_SCHEDULED on the debit's payment, which keeps the order id for reconcile
        assertEquals("DEBIT_SCHEDULED", charge.get("status"));
        assertEquals(1, ((Number) charge.get("debit_attempts")).intValue());
        PlatformPayment debit = paymentsFor(cid).get(0);
        assertEquals(debit.getId(), charge.get("platform_payment_id"));
        assertEquals(PlatformPaymentResult.PAYMENT_PENDING, debit.getPaymentStatus());
        assertEquals("order_unknown", debit.getVendorOrderId());
        verify(f.gateway, never()).createPaymentLink(any());
        // next passes: in flight, nothing new
        f.advance(Duration.ofHours(1));
        f.collection.runOnce();
        f.now = Instant.parse((String) charge.get("next_attempt_at")).plusSeconds(60);
        f.collection.runOnce();
        verify(f.gateway, times(1)).createRecurringDebit(any());
        verify(f.gateway, never()).createPaymentLink(any());
        // and no person can collect it twice meanwhile
        for (Runnable call : List.<Runnable>of(
                () -> f.billing.payCharge(INST, cid, RETURN, "u", null),
                () -> f.ops.markPaidOffline(INST, cid, "NEFT-1", PRO_TOTAL, "bank transfer", "staff:1"),
                () -> f.ops.resendLink(INST, cid, "staff:1"),
                () -> f.ops.waive(INST, cid, "goodwill", "staff:1"))) {
            AiPlansBillingException e = assertThrows(AiPlansBillingException.class, call::run);
            assertEquals("DEBIT_IN_PROGRESS", e.getCode());
        }
        verify(f.gateway, never()).createPaymentLink(any());
        assertEquals("DEBIT_SCHEDULED", charge.get("status"));
    }

    @Test
    void aFailedClaimRaisesNothingAndARefusalFallsBackToALink() {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> charge = renewalCharge(start);
        String cid = (String) charge.get("id");
        mandate((String) charge.get("subscription_id"), "UPI", AiSubscriptionMandateStore.ACTIVE, "token_u2");
        f.now = noticed(charge);
        // ai_service is down for the claim: Razorpay is never called, no link, retried next run
        f.ai.failPatch = fields -> fields.containsKey("platform_payment_id") && "DEBIT_SCHEDULED".equals(fields.get("status"));
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("debits_not_raised"), r.toString());
        verify(f.gateway, never()).createRecurringDebit(any());
        verify(f.gateway, never()).createPaymentLink(any());
        assertEquals(PlatformPaymentResult.FAILED, paymentsFor(cid).get(0).getPaymentStatus());
        assertEquals(0, ((Number) charge.get("debit_attempts")).intValue());
        // back up; Razorpay refuses (4xx: no payment exists) -> FAILED + a payment link at once
        f.ai.failPatch = null;
        f.advance(Duration.ofHours(1));
        when(f.gateway.createRecurringDebit(any())).thenThrow(new RazorpayDebitException(
                new RazorpayGatewayException(400, "BAD_REQUEST_ERROR", "token expired"), "order_refused"));
        r = f.collection.runOnce();
        assertEquals(1, r.counts.get("debits_failed"), r.toString());
        verify(f.gateway).createPaymentLink(any());
        assertEquals("LINK_SENT", charge.get("status"));
        assertTrue(paymentsFor(cid).stream().filter(p -> p.getPaymentSpecificData().contains("AUTOPAY_DEBIT"))
                .allMatch(p -> p.getPaymentStatus() == PlatformPaymentResult.FAILED), "both debit rows are FAILED");
        assertEquals(Kind.DEBIT_FAILED, lastMail(Kind.DEBIT_FAILED).kind());
    }

    // ── 3. mandates: forward-only, cancelled stays cancelled ─────────────

    @Test
    void aCancelledPendingMandateIsNeverRevivedByALateRegistration() throws Exception {
        Map<String, Object> out = f.billing.checkout(INST, new PayRequest(PV_PRO, true, "UPI", "9876543210", RETURN,
                "k-cancel"), "user-1", "admin@inst.test");
        assertEquals("MANDATE", out.get("mode"));
        Mandate m = f.mandates.rows.values().iterator().next();
        String linkId = f.mandates.rows.get(m.id()).registrationLinkId();
        assertTrue(linkId.startsWith("inv_"));
        f.billing.cancelMandate(INST, "changed my mind");
        verify(f.gateway).cancelRegistrationLink(linkId);
        assertEquals(AiSubscriptionMandateStore.CANCELLED, f.mandates.rows.get(m.id()).status());

        // the UPI approval completes anyway (delayed): token recorded, then confirmed
        PlatformPayment reg = f.payments.get((String) out.get("platform_payment_id"));
        f.deliver(f.capturedEvent(null, "pay_late_auth", PRO_TOTAL, "token_late", reg.getVendorOrderId()));
        assertEquals(200, f.deliver(f.tokenEvent("token.confirmed", "token_late", "confirmed")).getStatusCode().value());
        assertEquals(AiSubscriptionMandateStore.CANCELLED, f.mandates.rows.get(m.id()).status(), "never revived");
        verify(f.gateway, atLeastOnce()).cancelToken("cust_1", "token_late", "UPI");
        verify(f.mailer, never()).send(argThat(x -> x != null && x.kind() == Kind.MANDATE_ACTIVE));
        assertTrue(f.mandateStore.findActiveForSubscription((String) f.ai.sub().get("subscription_id")).isEmpty(),
                "no mandate a renewal could be debited on");
    }

    @Test
    void aRetriedConfirmationOfAnOldMandateNeverCancelsTheLiveOne() throws Exception {
        String sid = UUID.randomUUID().toString();
        Mandate a = mandate(sid, "UPI", AiSubscriptionMandateStore.CANCELLED, "token_A");
        Mandate b = mandate(sid, "UPI", AiSubscriptionMandateStore.ACTIVE, "token_B");
        assertEquals(200, f.deliver(f.tokenEvent("token.confirmed", "token_A", "confirmed")).getStatusCode().value());
        assertEquals(AiSubscriptionMandateStore.CANCELLED, f.mandates.rows.get(a.id()).status());
        assertEquals(AiSubscriptionMandateStore.ACTIVE, f.mandates.rows.get(b.id()).status());
        verify(f.gateway, never()).cancelToken(anyString(), eq("token_B"), anyString());
        verify(f.gateway).cancelToken("cust_1", "token_A", "UPI");
        // REJECTED / EXPIRED are final too; PAUSED <-> ACTIVE is allowed
        Mandate r = mandate(sid, "UPI", AiSubscriptionMandateStore.REJECTED, "token_R");
        f.deliver(f.tokenEvent("token.confirmed", "token_R", "confirmed"));
        assertEquals(AiSubscriptionMandateStore.REJECTED, f.mandates.rows.get(r.id()).status());
        f.deliver(f.tokenEvent("token.paused", "token_B", "paused"));
        assertEquals(AiSubscriptionMandateStore.PAUSED, f.mandates.rows.get(b.id()).status());
        f.deliver(f.tokenEvent("token.confirmed", "token_B", "confirmed"));
        assertEquals(AiSubscriptionMandateStore.ACTIVE, f.mandates.rows.get(b.id()).status());
    }

    // ── 4. subscription refunds act on refund.processed only ─────────────

    private String refundEvent(String event, String refundId, String payId, long amount, String status) {
        return "{\"event\":\"" + event + "\",\"payload\":{\"refund\":{\"entity\":{\"id\":\"" + refundId
                + "\",\"payment_id\":\"" + payId + "\",\"amount\":" + amount + ",\"status\":\"" + status + "\"}},"
                + "\"payment\":{\"entity\":{\"id\":\"" + payId + "\",\"amount_refunded\":" + amount
                + ",\"notes\":{\"payment_type\":\"AI_SUBSCRIPTION\"}}}}}";
    }

    @Test
    void refundCreatedIsOnlyPendingProcessedIssuesTheCreditNoteAndFailedClears() throws Exception {
        Map<String, Object> out = f.billing.checkout(INST, new PayRequest(PV_PRO, false, null, null, RETURN, "k-rf"),
                "user-1", "admin@inst.test");
        String ppId = (String) out.get("platform_payment_id");
        f.deliver(f.capturedEvent(ppId, "pay_r1", PRO_TOTAL, null, null));
        PlatformPayment pp = f.payments.get(ppId);

        assertEquals(200, f.deliver(refundEvent("refund.created", "rfnd_a", "pay_r1", PRO_TOTAL, "pending"))
                .getStatusCode().value());
        verify(f.creditNotes, never()).issueForRefund(any(), any(), anyLong(), any(), any());
        assertTrue(f.ai.calls.stream().noneMatch(c -> c.startsWith("refunded:")), "no cancellation yet");
        assertEquals(PlatformPaymentResult.PAID, pp.getPaymentStatus());
        assertTrue(pp.getPaymentSpecificData().contains("refundsPending"));
        // while it is pending, staff cannot refund the same money again
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class,
                () -> f.ops.refund(INST, ppId, 1L, "more", "staff:1"));
        assertEquals(AiPlansBillingException.AMOUNT_MISMATCH, e.getCode());

        // the bank refused it: nothing was ever credited, the plan stays
        assertEquals(200, f.deliver(refundEvent("refund.failed", "rfnd_a", "pay_r1", PRO_TOTAL, "failed"))
                .getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAID, pp.getPaymentStatus());
        assertFalse(pp.getPaymentSpecificData().contains("\"refundsPending\":{\"rfnd_a\""), pp.getPaymentSpecificData());
        assertTrue(pp.getPaymentSpecificData().contains("refundsFailed"), pp.getPaymentSpecificData());
        assertFalse(pp.getPaymentSpecificData().contains("\"refunds\""), "never counted as refunded");
        verify(f.creditNotes, never()).issueForRefund(any(), any(), anyLong(), any(), any());
        assertEquals("ACTIVE", f.ai.sub().get("status"));

        // a second refund that goes through: credit note + ai_service on refund.processed only
        f.deliver(refundEvent("refund.created", "rfnd_b", "pay_r1", 100_000L, "pending"));
        verify(f.creditNotes, never()).issueForRefund(any(), any(), anyLong(), any(), any());
        f.deliver(refundEvent("refund.processed", "rfnd_b", "pay_r1", 100_000L, "processed"));
        verify(f.creditNotes, times(1)).issueForRefund(eq(ppId), eq("rfnd_b"), eq(100_000L), anyString(), anyString());
        assertTrue(f.ai.calls.contains("refunded:pay_r1:100000:100000"), f.ai.calls.toString());
        assertEquals(PlatformPaymentResult.PARTIALLY_REFUNDED, pp.getPaymentStatus());
        assertEquals(100_000L, pp.getRefundedAmountMinor());
    }

    // ── 5. GST: the B2B buyer's name and address are on the invoice ──────

    @Test
    void aGstinNeedsTheBuyerAddress() {
        Map<String, Object> body = new HashMap<>(Map.of("legal_name", "Inst One Pvt Ltd", "gstin", "27ABCDE1234F1Z5"));
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class,
                () -> f.billing.saveBillingProfile(INST, body, "u1"));
        assertEquals(AiSubscriptionPaymentService.BUYER_ADDRESS_REQUIRED, e.getCode());
        body.put("address", "12 MG Road, Pune 411001");
        assertEquals("27", f.billing.saveBillingProfile(INST, body, "u1").get("state_code"));
    }

    @Test
    void aGstinOnlyProfileUsesTheInstituteAddressElseRefuses() {
        // seeded by a credit-pack top-up: GSTIN + state only
        PlatformBillingProfile prof = new PlatformBillingProfile();
        prof.setInstituteId(INST);
        prof.setGstin("27ABCDE1234F1Z5");
        prof.setStateCode("27");
        f.profiles.put(INST, prof);
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class, () -> f.billing.checkout(INST,
                new PayRequest(PV_PRO, false, null, null, RETURN, "k-b2b-1"), "user-1", "admin@inst.test"));
        assertEquals(AiSubscriptionPaymentService.BUYER_ADDRESS_REQUIRED, e.getCode());

        Institute inst = f.instituteRepo.findById(INST).orElseThrow();
        inst.setInstituteName("Inst One");
        inst.setAddress("12 MG Road");
        inst.setCity("Pune");
        inst.setPinCode("411001");
        Map<String, Object> out = f.billing.checkout(INST, new PayRequest(PV_PRO, false, null, null, RETURN,
                "k-b2b-2"), "user-1", "admin@inst.test");
        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        assertEquals("27ABCDE1234F1Z5", pp.getBuyerGstin());
        assertEquals("Inst One", pp.getBuyerLegalName());
        assertEquals("12 MG Road, Pune, 411001", pp.getBuyerAddress());
        assertNull(f.profiles.get(INST).getAddress(), "the stored profile is never rewritten");
    }

    // ── 6. the invoice's service period is the one supplied ──────────────

    @Test
    void theInvoicePeriodStartsWhenTheFirstPeriodIsPaid() throws Exception {
        Instant checkoutAt = f.now;
        Map<String, Object> out = f.billing.checkout(INST, new PayRequest(PV_PRO, false, null, null, RETURN, "k-per"),
                "user-1", "admin@inst.test");
        String ppId = (String) out.get("platform_payment_id");
        PlatformPaymentItem item = f.items.get(ppId).get(0);
        assertEquals(checkoutAt, item.getServicePeriodStart());
        f.advance(Duration.ofHours(20)); // paid the next day, inside the 48 h link
        f.deliver(f.capturedEvent(ppId, "pay_per", PRO_TOTAL, null, null));
        assertEquals(PlatformPaymentResult.PAID, f.payments.get(ppId).getPaymentStatus());
        assertEquals(f.now, item.getServicePeriodStart());
        assertEquals(f.now.plus(Duration.ofDays(30)), item.getServicePeriodEnd());
        assertEquals("AI Pro subscription, paid period", item.getDescriptionSnapshot());
        verify(f.itemRepo, atLeastOnce()).saveAll(any());
    }

    // ── 7. card autopay at checkout, staff credit note, refunded before invoiced ──

    @Test
    void cardAutopayAtCheckoutPaysByLinkAndRegistersSeparately() {
        Map<String, Object> out = f.billing.checkout(INST, new PayRequest(PV_PRO, true, "CARD", "9876543210", RETURN,
                "k-card"), "user-1", "admin@inst.test");
        assertEquals("LINK", out.get("mode"), "a card authorisation is Rs 1: it cannot pay the charge");
        verify(f.gateway, never()).createRegistrationLink(any());
        verify(f.gateway).createPaymentLink(any());
    }

    @Test
    void staffCreditNoteAgainstAnAiPlanInvoice() {
        PlatformInvoice inv = new PlatformInvoice();
        inv.setId("inv-77");
        inv.setBuyerInstituteId(INST);
        inv.setInvoiceNumber("VT/2627/I00077");
        inv.setSourceKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
        when(f.invoiceRepo.findById("inv-77")).thenReturn(Optional.of(inv));
        PlatformCreditNote cn = new PlatformCreditNote();
        cn.setId("cn-1");
        cn.setCreditNoteNumber("VT/2627/C00001");
        cn.setTotalAmountMinor(590_000L);
        when(f.creditNotes.issueStaffCreditNote("inv-77", 590_000L, "returned by bank transfer", "staff:1"))
                .thenReturn(cn);
        when(f.documentMail.sendCreditNoteEmail(cn)).thenReturn(true);
        Map<String, Object> out = f.ops.staffCreditNote(INST, "inv-77", 590_000L, "returned by bank transfer", "staff:1");
        assertEquals("VT/2627/C00001", out.get("number"));
        assertEquals(true, out.get("emailed"));
        verify(f.documentMail).sendCreditNoteEmail(cn);
        assertThrows(AiPlansBillingException.class, () -> f.ops.staffCreditNote(INST, "inv-77", 1L, "", "staff:1"));
        assertThrows(AiPlansBillingException.class, () -> f.ops.staffCreditNote("inst-other", "inv-77", 1L, "why",
                "staff:1"), "another institute's invoice is not found");
        inv.setSourceKind(PlatformPaymentItemKind.CREDIT_PACK);
        assertThrows(AiPlansBillingException.class, () -> f.ops.staffCreditNote(INST, "inv-77", 1L, "why", "staff:1"));
    }

    @Test
    void aPaymentRefundedBeforeItsInvoiceIsInvoicedAndCreditedByTheReconcile() throws Exception {
        Map<String, Object> out = f.billing.checkout(INST, new PayRequest(PV_PRO, false, null, null, RETURN, "k-ri"),
                "user-1", "admin@inst.test");
        String ppId = (String) out.get("platform_payment_id");
        doThrow(new RuntimeException("db hiccup")).when(f.invoiceService).generateInvoice(ppId);
        f.deliver(f.capturedEvent(ppId, "pay_ri", PRO_TOTAL, null, null));
        assertEquals(PlatformPaymentResult.PAID, f.payments.get(ppId).getPaymentStatus());
        verify(f.documentMail, never()).sendInvoiceEmail(any());
        f.deliver(refundEvent("refund.processed", "rfnd_ri", "pay_ri", 100_000L, "processed"));
        assertEquals(PlatformPaymentResult.PARTIALLY_REFUNDED, f.payments.get(ppId).getPaymentStatus());

        // the invoice works again; the reconcile lists the refunded payment too
        PlatformInvoice inv = new PlatformInvoice();
        inv.setId("inv-ri");
        inv.setPlatformPaymentId(ppId);
        org.mockito.Mockito.doReturn(inv).when(f.invoiceService).generateInvoice(ppId);
        when(f.queries.paidWithoutInvoice(org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt()))
                .thenReturn(List.of(ppId));
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("invoices_repaired"), r.toString());
        verify(f.documentMail, times(1)).sendInvoiceEmail(inv);
        verify(f.creditNotes, atLeastOnce()).issueForRefund(eq(ppId), eq("rfnd_ri"), eq(100_000L), anyString(),
                anyString());
        // a second pass (or the webhook thread at the same time) never emails the invoice again
        f.collection.runOnce();
        verify(f.documentMail, times(1)).sendInvoiceEmail(inv);
    }
}
