package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentGuard.DueOrder;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;

import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The recovery path: paid orders that were not confirmed, unpaid orders past their hold time. */
class CommercePaidOrderReconcileJobTest {

    private CommercePaymentGuard guard;
    private CommercePaymentConfirmService confirmService;
    private CommerceOrderPaymentPort orders;
    private CommerceStockSettings settings;
    private CommercePaidOrderReconcileJob job;
    private final Date now = new Date(1_800_000_000_000L);

    @BeforeEach
    void setUp() {
        guard = mock(CommercePaymentGuard.class);
        confirmService = mock(CommercePaymentConfirmService.class);
        orders = mock(CommerceOrderPaymentPort.class);
        settings = mock(CommerceStockSettings.class);
        when(settings.holdMinutes("inst-1")).thenReturn(15);
        when(guard.paidOrdersNotConfirmed(any(), any(), anyInt())).thenReturn(List.of());
        when(guard.unpaidOrdersPastHold(any(), any(), any(), anyInt())).thenReturn(List.of());
        job = new CommercePaidOrderReconcileJob(guard, confirmService, orders, settings);
    }

    private Date minutesAgo(int minutes) {
        return new Date(now.getTime() - minutes * 60_000L);
    }

    @Test
    void aPaidOrderThatWasNotConfirmedIsConfirmedByTheJob() {
        when(guard.paidOrdersNotConfirmed(any(), any(), anyInt())).thenReturn(List.of("order-1", "order-2"));
        when(confirmService.ensureConfirmed("order-1")).thenReturn(true);
        when(confirmService.ensureConfirmed("order-2")).thenReturn(false);

        int[] counts = job.reconcile(now);

        assertArrayEquals(new int[] {1, 1, 0}, counts);
        verify(confirmService).ensureConfirmed("order-1");
        verify(confirmService).ensureConfirmed("order-2");
    }

    @Test
    void oneOrderThatThrowsDoesNotStopTheRest() {
        when(guard.paidOrdersNotConfirmed(any(), any(), anyInt())).thenReturn(List.of("order-1", "order-2"));
        when(confirmService.ensureConfirmed("order-1")).thenThrow(new IllegalStateException("boom"));
        when(confirmService.ensureConfirmed("order-2")).thenReturn(true);

        assertArrayEquals(new int[] {1, 1, 0}, job.reconcile(now));
    }

    @Test
    void anUnpaidOrderPastItsHoldTimeIsExpired() {
        when(guard.unpaidOrdersPastHold(any(), any(), any(), anyInt())).thenReturn(List.of(
                new DueOrder("order-1", "inst-1", minutesAgo(5), minutesAgo(20))));

        assertArrayEquals(new int[] {0, 0, 1}, job.reconcile(now));
        verify(orders).onHoldExpired("order-1");
    }

    @Test
    void anOrderWithoutAHoldTimeWaitsForTheHoldMinutesOfItsInstitute() {
        when(guard.unpaidOrdersPastHold(any(), any(), any(), anyInt())).thenReturn(List.of(
                new DueOrder("young", "inst-1", null, minutesAgo(10)),
                new DueOrder("old", "inst-1", null, minutesAgo(19))));

        assertArrayEquals(new int[] {0, 0, 1}, job.reconcile(now));
        verify(orders, never()).onHoldExpired("young");
        verify(orders).onHoldExpired("old");
    }

    @Test
    void anExpiryThatFailsIsLeftForTheNextRun() {
        when(guard.unpaidOrdersPastHold(any(), any(), any(), anyInt())).thenReturn(List.of(
                new DueOrder("order-1", "inst-1", minutesAgo(5), minutesAgo(20)),
                new DueOrder("order-2", "inst-1", minutesAgo(5), minutesAgo(20))));
        doThrow(new IllegalStateException("boom")).when(orders).onHoldExpired("order-1");

        assertArrayEquals(new int[] {0, 0, 1}, job.reconcile(now));
        verify(orders).onHoldExpired("order-2");
    }
}
