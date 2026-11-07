package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.TokenInfo;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler.CapturedPayment;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.INST;

/**
 * token.confirmed can reach us a moment BEFORE the authorisation capture links the token to
 * the mandate; it is then acked as an unknown token. The capture now asks Razorpay for the
 * token's state, so the mandate turns ACTIVE at once instead of at the next hourly reconcile.
 */
class MandateTokenRaceTest {

    private BillingFixture f;

    @BeforeEach
    void setUp() {
        f = new BillingFixture();
    }

    private Mandate pendingMandate() {
        Mandate m = new Mandate(UUID.randomUUID().toString(), INST, "sub-1", "cust_1", null, "UPI", 1_500_000L,
                "as_presented", AiSubscriptionMandateStore.PENDING, null, null, null, null, null, Instant.now(),
                Instant.now());
        f.mandates.rows.put(m.id(), m);
        return m;
    }

    private void captureAuthorisation(Mandate m) {
        PlatformPayment p = new PlatformPayment();
        p.setId(UUID.randomUUID().toString());
        p.setInstituteId(INST);
        p.setPaymentSpecificData("{\"mandateId\":\"" + m.id() + "\",\"purpose\":\"MANDATE_AUTH\"}");
        f.handler.onPaymentCaptured(p, List.of(),
                new CapturedPayment("pay_auth", 100L, "INR", "upi", "order_1", null, "token_1", "cust_1", null, null));
    }

    @Test
    void confirmedTokenActivatesTheMandateAtCapture() {
        Mandate m = pendingMandate();
        when(f.gateway.fetchTokens("cust_1")).thenReturn(List.of(new TokenInfo("token_1", "upi", "confirmed", null, null)));

        captureAuthorisation(m);

        assertEquals(AiSubscriptionMandateStore.ACTIVE, f.mandates.rows.get(m.id()).status());
        assertEquals("token_1", f.mandates.rows.get(m.id()).tokenId());
    }

    @Test
    void aTokenNotYetConfirmedStaysPending() {
        Mandate m = pendingMandate();
        when(f.gateway.fetchTokens("cust_1")).thenReturn(List.of(new TokenInfo("token_1", "upi", "initiated", null, null)));

        captureAuthorisation(m);

        assertEquals(AiSubscriptionMandateStore.PENDING, f.mandates.rows.get(m.id()).status());
    }

    @Test
    void aFailedLookupLeavesItToTheReconcile() {
        Mandate m = pendingMandate();
        when(f.gateway.fetchTokens(anyString())).thenThrow(new RuntimeException("razorpay 503"));

        captureAuthorisation(m);

        assertEquals(AiSubscriptionMandateStore.PENDING, f.mandates.rows.get(m.id()).status());
        assertEquals("token_1", f.mandates.rows.get(m.id()).tokenId());
    }
}
