package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService.Report;

import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static vacademy.io.admin_core_service.features.ai_plans_billing.service.BillingFixture.PV_PRO;

/**
 * A super-admin assign with "send link" (or the portal's Send link) queues a first-purchase charge
 * by setting next_attempt_at. The job must create and email its link; before this it only expired
 * stale checkouts, so the link was never sent. A storefront checkout (no next_attempt_at) is left to
 * its own request.
 */
class QueuedCheckoutLinkTest {

    private BillingFixture f;

    @BeforeEach
    void setUp() {
        f = new BillingFixture();
    }

    private Map<String, Object> pendingCharge(boolean queued) {
        Map<String, Object> sub = f.ai.activeSubscription(f.now);
        sub.put("status", "PENDING");
        Map<String, Object> c = f.ai.newCharge((String) sub.get("subscription_id"), "PERIOD", PV_PRO, f.now,
                f.now.plus(Duration.ofDays(30)), 1_000L);
        if (queued) {
            c.put("next_attempt_at", f.now.toString());
        }
        return c;
    }

    @Test
    void staffQueuedFirstPurchaseGetsALinkAndAnEmail() {
        Map<String, Object> c = pendingCharge(true);

        Report r = f.collection.runOnce();

        assertEquals(1, r.counts.get("links_created"), r.toString());
        assertEquals("LINK_SENT", c.get("status"));
        assertNotNull(c.get("payment_link_url"));
        ArgumentCaptor<Mail> mail = ArgumentCaptor.forClass(Mail.class);
        verify(f.mailer).send(mail.capture());
        assertEquals(Kind.PAYMENT_LINK, mail.getValue().kind());
        assertEquals(c.get("payment_link_url"), mail.getValue().payUrl());
    }

    @Test
    void theNextRunDoesNotMakeASecondLink() {
        pendingCharge(true);
        f.collection.runOnce();
        f.advance(Duration.ofHours(1));

        Report r = f.collection.runOnce();

        assertNull(r.counts.get("links_created"), r.toString());
        verify(f.gateway, times(1)).createPaymentLink(any());
    }

    @Test
    void aStorefrontCheckoutWithoutAQueueIsLeftAlone() {
        Map<String, Object> c = pendingCharge(false);

        Report r = f.collection.runOnce();

        assertNull(r.counts.get("links_created"), r.toString());
        assertEquals("DUE", c.get("status"));
        verify(f.gateway, never()).createPaymentLink(any());
    }
}
