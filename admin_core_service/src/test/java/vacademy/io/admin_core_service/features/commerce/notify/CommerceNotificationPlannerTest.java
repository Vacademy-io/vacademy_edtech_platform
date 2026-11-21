package vacademy.io.admin_core_service.features.commerce.notify;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationDelivery;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The planner's decisions for one outbox row (§5.1): the kill switch, the institute's commerce
 * feature (off: skipped for good; unknown: asked again in 5 minutes), the shop's switch, the
 * trigger's own rules, an active workflow standing in, the channel switches, the 24-hour
 * expiry, and a second plan of the same row that writes nothing.
 */
class CommerceNotificationPlannerTest {

    private final DispatcherFixture f = new DispatcherFixture();

    private InMemoryNotificationStore.Event ev(String id) {
        return f.store.events.get(id);
    }

    private List<String> channels(String eventId) {
        return f.store.deliveriesOf(eventId).stream().map(d -> d.channel).toList();
    }

    @Test
    void withTheKillSwitchOffNothingIsPlannedOrSentAndTheRowWaits() {
        DispatcherFixture off = new DispatcherFixture(false, DispatcherFixture.LINK_SECRET);
        String id = off.event("ORDER_CONFIRMED", "");

        assertNull(off.dispatcher.plan(off.store.row(id)));
        off.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);

        assertEquals("PENDING", off.store.events.get(id).status);
        assertTrue(off.store.deliveries.isEmpty());
        verifyNoInteractions(off.notificationService, off.accessGuard);
        // A delivery that exists is held, not sent.
        String delivery = "dl-held";
        InMemoryNotificationStore.Delivery d = new InMemoryNotificationStore.Delivery();
        d.id = delivery;
        d.eventId = id;
        d.instituteId = DispatcherFixture.INST;
        d.orderId = DispatcherFixture.ORDER;
        d.triggerCode = "ORDER_CONFIRMED";
        d.channel = CommerceNotificationDelivery.EMAIL;
        d.locale = "en";
        off.store.deliveries.put(delivery, d);
        assertEquals(CommerceNotificationDispatcher.Result.HELD, off.dispatcher.send(delivery));
        assertEquals("PENDING", d.status);
        verifyNoInteractions(off.notificationService);
    }

    @Test
    void withCommerceOffTheEventIsSkippedForGoodAndTheSendApiIsNeverCalled() {
        when(f.accessGuard.featureState(DispatcherFixture.INST, CommerceFeature.ORDERS))
                .thenReturn(CommerceAccessGuard.FeatureState.OFF);
        String id = f.event("ORDER_SHIPPED", "ship-1");

        f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
        f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);

        assertEquals("SKIPPED", ev(id).status);
        assertEquals("COMMERCE_OFF", ev(id).skipReason);
        assertTrue(f.store.deliveries.isEmpty());
        verify(f.notificationService, never()).sendUnified(any());
        verifyNoInteractions(f.workflowService);
    }

    @Test
    void aCounterBillOfAPosSaleAsksForThePosFeature() {
        f.order.channel = "POS";
        f.order.put();
        when(f.accessGuard.featureState(DispatcherFixture.INST, CommerceFeature.POS))
                .thenReturn(CommerceAccessGuard.FeatureState.OFF);
        String pos = f.planned("POS_BILL_ISSUED", "");
        assertEquals("COMMERCE_OFF", ev(pos).skipReason);
        verify(f.accessGuard).featureState(DispatcherFixture.INST, CommerceFeature.POS);

        // The same bill of a staff order (not a POS sale) asks for orders.
        DispatcherFixture g = new DispatcherFixture();
        g.order.channel = "ADMIN";
        g.order.put();
        g.planned("POS_BILL_ISSUED", "");
        verify(g.accessGuard).featureState(DispatcherFixture.INST, CommerceFeature.ORDERS);
        verify(g.accessGuard, never()).featureState(DispatcherFixture.INST, CommerceFeature.POS);
    }

    @Test
    void anUnknownFeatureStateAsksAgainInFiveMinutes() {
        when(f.accessGuard.featureState(anyString(), any())).thenReturn(CommerceAccessGuard.FeatureState.UNKNOWN);
        String id = f.event("ORDER_CONFIRMED", "");

        assertNull(f.dispatcher.plan(f.store.row(id)));

        assertEquals("PENDING", ev(id).status);
        assertEquals(1, ev(id).attempts);
        assertEquals(5, ev(id).dueInMinutes);
        assertTrue(f.store.deliveries.isEmpty());
        // Not due again until then.
        f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER);
        assertEquals(1, ev(id).attempts);

        when(f.accessGuard.featureState(anyString(), any())).thenReturn(null);
        ev(id).dueInMinutes = 0;
        assertNull(f.dispatcher.plan(f.store.row(id)));
        assertEquals(2, ev(id).attempts);
        verify(f.notificationService, never()).sendUnified(any());
    }

    @Test
    void aTriggerSwitchedOffIsSkipped() {
        CommerceNotificationSetting s = f.setting("ORDER_DELIVERED");
        s.setEnabled(false);
        String id = f.planned("ORDER_DELIVERED", "ship-1");
        assertEquals("SKIPPED", ev(id).status);
        assertEquals("TRIGGER_OFF", ev(id).skipReason);
        assertTrue(f.store.deliveries.isEmpty());
    }

    @Test
    void aCodConfirmationMessageIsPlannedOnlyWhileTheOrderStillWaitsForTheCall() {
        f.order.status = "CONFIRMED";
        f.order.put();
        String stale = f.planned("COD_CONFIRMATION_NEEDED", "");
        assertEquals("STALE", ev(stale).skipReason);

        DispatcherFixture g = new DispatcherFixture();
        g.order.status = "COD_PENDING_CONFIRMATION";
        g.order.put();
        String waiting = g.planned("COD_CONFIRMATION_NEEDED", "");
        assertEquals("PLANNED", g.store.events.get(waiting).status);
        assertEquals(List.of("WHATSAPP", "EMAIL"), g.store.deliveriesOf(waiting).stream().map(d -> d.channel)
                .toList());
    }

    @Test
    void aRefundIsMessagedOnlyForGatewayBankTransferAndUpi() {
        for (String method : List.of("GATEWAY", "BANK_TRANSFER", "UPI", "CASH", "EXCHANGE_CREDIT")) {
            DispatcherFixture g = new DispatcherFixture();
            g.store.refunds.put(DispatcherFixture.ORDER + "|refund-" + method, Map.of("method", method,
                    "amount", new java.math.BigDecimal("500.00")));
            String id = g.planned("REFUND_PROCESSED", "refund-" + method);
            boolean messaged = !method.equals("CASH") && !method.equals("EXCHANGE_CREDIT");
            assertEquals(messaged ? "PLANNED" : "SKIPPED", g.store.events.get(id).status, method);
            if (!messaged) {
                assertEquals("NOT_APPLICABLE", g.store.events.get(id).skipReason, method);
            }
        }
        // A refund row that cannot be found is not messaged either.
        String missing = f.planned("REFUND_PROCESSED", "refund-gone");
        assertEquals("NOT_APPLICABLE", ev(missing).skipReason);
    }

    @Test
    void anActiveWorkflowStandsInWithOneWorkflowRow() {
        when(f.workflowService.hasActiveWorkflow("ORDER_SHIPPED", DispatcherFixture.ORDER, DispatcherFixture.INST))
                .thenReturn(true);
        String id = f.planned("ORDER_SHIPPED", "ship-1");
        assertEquals("PLANNED", ev(id).status);
        assertEquals(List.of("WORKFLOW"), channels(id));
        assertNull(f.store.deliveriesOf(id).get(0).templateName);
    }

    @Test
    void aWorkflowLookupErrorLeavesTheDefaults() {
        when(f.workflowService.hasActiveWorkflow(anyString(), anyString(), anyString()))
                .thenThrow(new IllegalStateException("lookup failed"));
        String id = f.planned("ORDER_CANCELLED", "");
        assertEquals("PLANNED", ev(id).status);
        assertEquals(List.of("WHATSAPP", "EMAIL"), channels(id));

        // No engine at all: the defaults too.
        DispatcherFixture g = new DispatcherFixture();
        when(g.workflows.getIfAvailable()).thenReturn(null);
        String other = g.planned("ORDER_CANCELLED", "");
        assertEquals(List.of("WHATSAPP", "EMAIL"), g.store.deliveriesOf(other).stream().map(d -> d.channel).toList());
    }

    @Test
    void theChannelSwitchesDecideTheRows() {
        String defaults = f.planned("ORDER_CONFIRMED", "");
        assertEquals(List.of("WHATSAPP", "EMAIL"), channels(defaults));
        InMemoryNotificationStore.Delivery whatsapp = f.store.delivery(defaults, "WHATSAPP");
        assertEquals("commerce_order_confirmed", whatsapp.templateName);
        assertEquals("en", whatsapp.locale);
        assertNull(f.store.delivery(defaults, "EMAIL").templateName);

        CommerceNotificationSetting noWhatsApp = f.setting("ORDER_SHIPPED");
        noWhatsApp.setWhatsappEnabled(false);
        assertEquals(List.of("EMAIL"), channels(f.planned("ORDER_SHIPPED", "ship-1")));

        CommerceNotificationSetting noEmail = f.setting("ORDER_DELIVERED");
        noEmail.setEmailEnabled(false);
        noEmail.setWhatsappTemplateName("shop_delivered_v2");
        String delivered = f.planned("ORDER_DELIVERED", "ship-1");
        assertEquals(List.of("WHATSAPP"), channels(delivered));
        assertEquals("shop_delivered_v2", f.store.delivery(delivered, "WHATSAPP").templateName);

        CommerceNotificationSetting none = f.setting("ORDER_RTO");
        none.setEmailEnabled(false);
        none.setWhatsappEnabled(false);
        String rto = f.planned("ORDER_RTO", "ship-1");
        assertEquals("SKIPPED", ev(rto).status);
        assertEquals("NO_CHANNEL", ev(rto).skipReason);
    }

    @Test
    void theRowsAreInTheOrdersLanguageElseTheShopsElseHindi() {
        f.order.locale = "hi-IN";
        f.order.put();
        assertEquals("hi", f.store.deliveriesOf(f.planned("ORDER_CONFIRMED", "")).get(0).locale);

        DispatcherFixture g = new DispatcherFixture();
        g.order.locale = null;
        g.order.put();
        StorefrontSettings shop = mock(StorefrontSettings.class);
        when(shop.baseLocale()).thenReturn("en_IN");
        when(g.storefrontSettings.read(DispatcherFixture.INST)).thenReturn(shop);
        assertEquals("en", g.store.deliveriesOf(g.planned("ORDER_CONFIRMED", "")).get(0).locale);

        DispatcherFixture h = new DispatcherFixture();
        h.order.locale = "ta";
        h.order.put();
        when(h.storefrontSettings.read(anyString())).thenThrow(new IllegalStateException("unreadable"));
        assertEquals("hi", h.store.deliveriesOf(h.planned("ORDER_CONFIRMED", "")).get(0).locale);
    }

    @Test
    void anEventOlderThanADayIsExpiredAndNothingIsSent() {
        String id = f.event("ORDER_CONFIRMED", "");
        ev(id).expired = true;
        assertEquals("EXPIRED", f.dispatcher.plan(f.store.row(id)));
        assertEquals("SKIPPED", ev(id).status);
        assertEquals("EXPIRED", ev(id).skipReason);
        assertTrue(f.store.deliveries.isEmpty());

        // A planned delivery whose event has passed the day expires instead of being sent.
        String planned = f.planned("ORDER_CANCELLED", "");
        ev(planned).expired = true;
        String delivery = f.delivery(planned, "EMAIL");
        assertEquals(CommerceNotificationDispatcher.Result.EXPIRED, f.dispatcher.send(delivery));
        assertEquals("EXPIRED", f.row(delivery).status);
        assertEquals(0, f.row(delivery).attempts, "never claimed");
        verify(f.notificationService, never()).sendUnified(any());
    }

    @Test
    void aSecondPlanOfTheSameEventWritesNothing() {
        String id = f.event("ORDER_CONFIRMED", "");
        var row = f.store.row(id);
        assertEquals("PLANNED", f.dispatcher.plan(row));
        assertEquals(2, f.store.deliveryInsertsApplied);

        // Another pod with the same row in hand.
        f.dispatcher.plan(row);
        assertEquals(2, f.store.deliveries.size());
        assertEquals(2, f.store.deliveryInsertsApplied);
        assertEquals(2, f.store.deliveryInsertsIgnored);
        assertEquals("PLANNED", ev(id).status);

        // And the same event written twice is one row.
        assertEquals(0, f.store.insertEvent(DispatcherFixture.INST, DispatcherFixture.ORDER, "ORDER_CONFIRMED", null));
        assertEquals(1, f.store.events.size());
        // Another ref is another event.
        assertEquals(1, f.store.insertEvent(DispatcherFixture.INST, DispatcherFixture.ORDER, "ORDER_SHIPPED", "s-2"));
    }

    @Test
    void anUnknownTriggerOrAMissingOrderIsNotApplicable() {
        String unknown = f.store.event(DispatcherFixture.INST, DispatcherFixture.ORDER, "SOMETHING", "");
        assertEquals("NOT_APPLICABLE", f.dispatcher.plan(f.store.row(unknown)));
        String gone = f.store.event(DispatcherFixture.INST, "order-404", "ORDER_CONFIRMED", "");
        assertEquals("NOT_APPLICABLE", f.dispatcher.plan(f.store.row(gone)));
        assertTrue(f.store.deliveries.isEmpty());
    }

    @Test
    void thePlannerNeverRunsInsideATransaction() {
        String id = f.event("ORDER_CONFIRMED", "");
        FakeTransactions outer = new FakeTransactions();
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(outer).executeWithoutResult(
                status -> f.dispatcher.plan(f.store.row(id))));
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(outer).executeWithoutResult(
                status -> f.dispatcher.dispatchOrder(DispatcherFixture.INST, DispatcherFixture.ORDER)));
        assertEquals("PENDING", ev(id).status);
    }
}
