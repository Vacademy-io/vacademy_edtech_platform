package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.TokenInfo;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService.Report;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.INST;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.PV_PRO;

/**
 * Before the pre-debit notice, the job asks Razorpay whether the mandate's token is still usable:
 * a customer can cancel or pause UPI Autopay from their app, and a token.* webhook can be missed.
 * An unusable token never gets a notice; the charge goes to a payment link. An unknown answer
 * (token not listed, call failed) keeps the existing path.
 */
class AutopayTokenCheckTest {

    private BillingFixture f;

    @BeforeEach
    void setUp() {
        f = new BillingFixture();
    }

    private Map<String, Object> renewalCharge() {
        Instant start = f.now.plus(Duration.ofHours(72));
        Map<String, Object> sub = f.ai.activeSubscription(start.minus(Duration.ofDays(30)));
        return f.ai.newCharge((String) sub.get("subscription_id"), "PERIOD", PV_PRO, start,
                start.plus(Duration.ofDays(30)), BillingFixture.PRO_BASE);
    }

    private Mandate activeUpiMandate(String sid) {
        Mandate m = new Mandate(UUID.randomUUID().toString(), INST, sid, "cust_1", "token_upi", "UPI", 1_500_000L,
                "as_presented", AiSubscriptionMandateStore.ACTIVE, null, null, null, null, null, Instant.now(), Instant.now());
        f.mandates.rows.put(m.id(), m);
        return m;
    }

    private boolean noticeSent() {
        ArgumentCaptor<Mail> c = ArgumentCaptor.forClass(Mail.class);
        try {
            verify(f.mailer, atLeast(0)).send(c.capture());
        } catch (AssertionError e) {
            return false;
        }
        return c.getAllValues().stream().anyMatch(m -> m != null && m.kind() == Kind.PRE_DEBIT_NOTICE);
    }

    @Test
    void tokenCancelledAtRazorpayGetsNoNoticeAndTheMandateIsCancelled() {
        Map<String, Object> charge = renewalCharge();
        Mandate m = activeUpiMandate((String) charge.get("subscription_id"));
        when(f.gateway.fetchTokens("cust_1")).thenReturn(List.of(new TokenInfo("token_upi", "upi", "cancelled", null, null)));

        Report r = f.collection.runOnce();

        assertEquals(1, r.counts.get("mandates_unusable_at_notice"), r.toString());
        assertNull(r.counts.get("pre_debit_notices"), r.toString());
        assertFalse(noticeSent());
        assertNull(charge.get("pre_debit_notice_sent_at"));
        assertEquals(AiSubscriptionMandateStore.CANCELLED, f.mandates.rows.get(m.id()).status());
    }

    @Test
    void tokenPausedAtRazorpayGetsNoNotice() {
        Map<String, Object> charge = renewalCharge();
        Mandate m = activeUpiMandate((String) charge.get("subscription_id"));
        when(f.gateway.fetchTokens("cust_1")).thenReturn(List.of(new TokenInfo("token_upi", "upi", "paused", null, null)));

        Report r = f.collection.runOnce();

        assertEquals(1, r.counts.get("mandates_unusable_at_notice"), r.toString());
        assertFalse(noticeSent());
        assertEquals(AiSubscriptionMandateStore.PAUSED, f.mandates.rows.get(m.id()).status());
    }

    @Test
    void expiredTokenIsMarkedExpired() {
        Map<String, Object> charge = renewalCharge();
        Mandate m = activeUpiMandate((String) charge.get("subscription_id"));
        long past = f.now.minus(Duration.ofDays(1)).getEpochSecond();
        when(f.gateway.fetchTokens("cust_1")).thenReturn(List.of(new TokenInfo("token_upi", "upi", "confirmed", null, past)));

        Report r = f.collection.runOnce();

        assertEquals(1, r.counts.get("mandates_unusable_at_notice"), r.toString());
        assertFalse(noticeSent());
        assertEquals(AiSubscriptionMandateStore.EXPIRED, f.mandates.rows.get(m.id()).status());
    }

    @Test
    void confirmedTokenGetsTheNoticeAsBefore() {
        Map<String, Object> charge = renewalCharge();
        activeUpiMandate((String) charge.get("subscription_id"));
        long future = f.now.plus(Duration.ofDays(365)).getEpochSecond();
        when(f.gateway.fetchTokens("cust_1")).thenReturn(List.of(new TokenInfo("token_upi", "upi", "confirmed", null, future)));

        Report r = f.collection.runOnce();

        assertEquals(1, r.counts.get("pre_debit_notices"), r.toString());
        assertNull(r.counts.get("mandates_unusable_at_notice"));
        assertTrue(noticeSent());
    }

    @Test
    void aFailedTokenLookupKeepsTheExistingPath() {
        Map<String, Object> charge = renewalCharge();
        Mandate m = activeUpiMandate((String) charge.get("subscription_id"));
        when(f.gateway.fetchTokens(anyString())).thenThrow(new RuntimeException("razorpay 503"));

        Report r = f.collection.runOnce();

        assertEquals(1, r.counts.get("pre_debit_notices"), r.toString());
        assertEquals(AiSubscriptionMandateStore.ACTIVE, f.mandates.rows.get(m.id()).status());
    }
}
