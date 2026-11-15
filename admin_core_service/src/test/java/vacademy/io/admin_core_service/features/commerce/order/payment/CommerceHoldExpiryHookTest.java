package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The hold code tells Commerce about an expired hold; a course hold is none of its business. */
class CommerceHoldExpiryHookTest {

    private CommercePaymentGuard guard;
    private CommerceGatewayOrderRepository gatewayOrders;
    private CommerceOrderPaymentPort orders;
    private CommerceHoldExpiryHook hook;

    @BeforeEach
    void setUp() {
        guard = mock(CommercePaymentGuard.class);
        gatewayOrders = mock(CommerceGatewayOrderRepository.class);
        orders = mock(CommerceOrderPaymentPort.class);
        // The cancel of a shopper release runs on a thread of its own; here it runs at once.
        hook = new CommerceHoldExpiryHook(guard, gatewayOrders, orders, Runnable::run);
        when(guard.orderIdOfPaymentLog("log-shop")).thenReturn("order-1");
        when(guard.orderIdOfPaymentLog("log-course")).thenReturn(null);
    }

    private static StockHoldRow hold(String paymentLogId) {
        StockHoldRow row = mock(StockHoldRow.class);
        when(row.getPaymentLogId()).thenReturn(paymentLogId);
        return row;
    }

    @Test
    void anExpiredHoldOfAShopOrderExpiresTheOrderOnceForAllItsLines() {
        hook.onHoldReleased(hold("log-shop"), "EXPIRED");
        hook.onHoldReleased(hold("log-shop"), "EXPIRED");
        hook.onHoldReleased(hold("log-shop"), "EXPIRED");

        verify(orders, times(1)).onHoldExpired("order-1");
    }

    @Test
    void anExpiredHoldOfACourseCheckoutDoesNothing() {
        hook.onHoldReleased(hold("log-course"), "EXPIRED");

        verifyNoInteractions(orders);
    }

    @Test
    void aReleaseByTheShopperCancelsTheOrderOnce_soItIsNotOfferedForPaymentAgain() {
        hook.onHoldReleased(hold("log-shop"), "SHOPPER");
        hook.onHoldReleased(hold("log-shop"), "SHOPPER");

        verify(orders, times(1)).onShopperReleased("order-1");
        verify(orders, org.mockito.Mockito.never()).onHoldExpired("order-1");
    }

    @Test
    void aShopperReleaseOfACourseCheckoutDoesNothing_andAnUnknownReasonDoesNothing() {
        hook.onHoldReleased(hold("log-course"), "SHOPPER");
        hook.onHoldReleased(hold("log-shop"), "SOMETHING_ELSE");

        verifyNoInteractions(orders);
    }

    @Test
    void theCancelOfAShopperReleaseDoesNotRunOnTheThreadThatReleased() {
        java.util.List<Runnable> queued = new java.util.ArrayList<>();
        CommerceHoldExpiryHook queueing = new CommerceHoldExpiryHook(guard, gatewayOrders, orders, queued::add);

        queueing.onHoldReleased(hold("log-shop"), "SHOPPER");

        // The release request still holds its database connections here: nothing ran yet.
        verifyNoInteractions(orders);
        assertEquals(1, queued.size());
        queued.get(0).run();
        verify(orders).onShopperReleased("order-1");
    }

    @Test
    void aCancelThatFailsIsLoggedAndTriedAgainOnTheNextRelease() {
        doThrow(new IllegalStateException("boom")).doNothing().when(orders).onShopperReleased("order-1");

        hook.onHoldReleased(hold("log-shop"), "SHOPPER");
        hook.onHoldReleased(hold("log-shop"), "SHOPPER");

        verify(orders, times(2)).onShopperReleased("order-1");
    }

    @Test
    void anExpiryThatFailsIsTriedAgainOnTheNextHold() {
        doThrow(new IllegalStateException("boom")).doNothing().when(orders).onHoldExpired("order-1");

        assertThrows(IllegalStateException.class, () -> hook.onHoldReleased(hold("log-shop"), "EXPIRED"));
        hook.onHoldReleased(hold("log-shop"), "EXPIRED");

        verify(orders, times(2)).onHoldExpired("order-1");
    }

    @Test
    void aReleaseIsHeldBackWhileAPaymentIsAuthorised() {
        when(gatewayOrders.countAuthorizedSince(eq("order-1"), any())).thenReturn(1L, 0L);

        assertTrue(hook.paymentInProgress("log-shop"));
        assertFalse(hook.paymentInProgress("log-shop"));
        assertFalse(hook.paymentInProgress("log-course"));
    }
}
