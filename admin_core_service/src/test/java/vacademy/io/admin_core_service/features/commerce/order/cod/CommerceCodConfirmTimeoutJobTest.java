package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.enums.CancelReason;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The COD confirmation timer: only an order still waiting and due is cancelled, each by itself. */
class CommerceCodConfirmTimeoutJobTest {

    private static final Date NOW = new Date(1_800_000_000_000L);

    private CommerceCodRemittanceRepository queries;
    private CommerceOrderDeskService desk;
    private CommerceCodConfirmTimeoutJob job;
    private CommerceOrderRepository orderRepository;
    private final Map<String, CommerceOrder> orders = new HashMap<>();
    private final List<CommerceOrderLine> lines = List.of(new CommerceOrderLine());

    @BeforeEach
    void setUp() {
        queries = mock(CommerceCodRemittanceRepository.class);
        orderRepository = mock(CommerceOrderRepository.class);
        desk = mock(CommerceOrderDeskService.class);
        job = new CommerceCodConfirmTimeoutJob(queries, orderRepository, desk, mock(PlatformTransactionManager.class));
        when(orderRepository.findById(anyString())).thenAnswer(call -> Optional.ofNullable(orders.get(call.getArgument(0))));
        when(desk.lockOrder(eq("inst-1"), anyString())).thenAnswer(call -> orders.get(call.getArgument(1)));
        when(desk.freshLines(anyString())).thenReturn(lines);
    }

    private CommerceOrder order(String id, String status, Date due) {
        CommerceOrder order = new CommerceOrder();
        order.setId(id);
        order.setInstituteId("inst-1");
        order.setStatus(status);
        order.setCodConfirmDueAt(due);
        orders.put(id, order);
        return order;
    }

    @Test
    void anOrderStillWaitingAndDueIsCancelledAsNotConfirmedWithNoActor() {
        CommerceOrder due = order("o-1", "COD_PENDING_CONFIRMATION", new Date(NOW.getTime() - 1));
        when(queries.findOrdersPastConfirmation(NOW, CommerceCodConfirmTimeoutJob.BATCH)).thenReturn(List.of("o-1"));

        assertEquals(1, job.sweep(NOW));
        verify(desk).cancel(eq(due), eq(lines), eq(CancelReason.COD_NOT_CONFIRMED), isNull(), anyString());
    }

    @Test
    void anOrderConfirmedOrGivenMoreTimeMeanwhileIsLeftAlone() {
        order("o-1", "CONFIRMED", null);
        order("o-2", "COD_PENDING_CONFIRMATION", new Date(NOW.getTime() + 60_000));
        order("o-3", "CANCELLED", new Date(NOW.getTime() - 1));
        when(queries.findOrdersPastConfirmation(NOW, CommerceCodConfirmTimeoutJob.BATCH))
                .thenReturn(List.of("o-1", "o-2", "o-3", "o-gone"));

        assertEquals(0, job.sweep(NOW));
        verify(desk, never()).cancel(any(), any(), any(), any(), any());
    }

    @Test
    void oneOrderThatFailsDoesNotStopTheOthers() {
        CommerceOrder bad = order("o-1", "COD_PENDING_CONFIRMATION", new Date(NOW.getTime() - 1));
        CommerceOrder good = order("o-2", "COD_PENDING_CONFIRMATION", new Date(NOW.getTime() - 1));
        when(queries.findOrdersPastConfirmation(NOW, CommerceCodConfirmTimeoutJob.BATCH))
                .thenReturn(List.of("o-1", "o-2"));
        doThrow(new IllegalStateException("boom")).when(desk).cancel(eq(bad), any(), any(), any(), any());

        assertEquals(1, job.sweep(NOW));
        verify(desk).cancel(eq(good), eq(lines), eq(CancelReason.COD_NOT_CONFIRMED), isNull(), anyString());
        // The failed order is left alone for an hour, so it cannot head every later batch.
        verify(orderRepository).deferSweep("o-1", new Date(NOW.getTime() + 60L * 60 * 1000));
        verify(orderRepository, never()).deferSweep(eq("o-2"), any());
    }

    @Test
    void aFailureToDeferAnOrderDoesNotStopTheRun() {
        CommerceOrder bad = order("o-1", "COD_PENDING_CONFIRMATION", new Date(NOW.getTime() - 1));
        CommerceOrder good = order("o-2", "COD_PENDING_CONFIRMATION", new Date(NOW.getTime() - 1));
        when(queries.findOrdersPastConfirmation(NOW, CommerceCodConfirmTimeoutJob.BATCH))
                .thenReturn(List.of("o-1", "o-2"));
        doThrow(new IllegalStateException("STOCK_NOT_SETTLED")).when(desk).cancel(eq(bad), any(), any(), any(), any());
        when(orderRepository.deferSweep(anyString(), any())).thenThrow(new IllegalStateException("db busy"));

        assertEquals(1, job.sweep(NOW));
        verify(desk).cancel(eq(good), eq(lines), eq(CancelReason.COD_NOT_CONFIRMED), isNull(), anyString());
        assertEquals(60, CommerceCodConfirmTimeoutJob.RETRY_AFTER_MINUTES);
    }

    @Test
    void aRunAsksForAtMostOneHundredOrdersAndNeverThrows() {
        when(queries.findOrdersPastConfirmation(any(), anyInt())).thenThrow(new IllegalStateException("db down"));
        job.run();
        assertEquals(100, CommerceCodConfirmTimeoutJob.BATCH);
    }
}
