package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository.ShortCandidate;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Open orders of a variant at a location are flagged after the posting that made them short
 * commits, newest first, each up to its units still to ship, until the shortfall is covered;
 * a closed order is skipped; nothing here ever throws.
 */
class CommerceStockShortFlaggerTest {

    private CommerceOrderRepository orders;
    private CommerceOrderLineRepository lines;
    private PlatformTransactionManager transactionManager;
    private CommerceStockShortFlagger flagger;

    @BeforeEach
    void setUp() {
        orders = mock(CommerceOrderRepository.class);
        lines = mock(CommerceOrderLineRepository.class);
        transactionManager = mock(PlatformTransactionManager.class);
        flagger = new CommerceStockShortFlagger(orders, lines, transactionManager);
    }

    @AfterEach
    void clear() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private CommerceOrder order(String id, String status) {
        CommerceOrder order = new CommerceOrder();
        order.setId(id);
        order.setInstituteId("inst-1");
        order.setStatus(status);
        when(orders.lockById(id)).thenReturn(Optional.of(order));
        return order;
    }

    private CommerceOrderLine line(String id, int quantity, int shipped) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setQuantity(quantity);
        line.setQtyShipped(shipped);
        when(lines.findById(id)).thenReturn(Optional.of(line));
        return line;
    }

    private static ShortCandidate candidate(String orderId, String lineId) {
        ShortCandidate c = mock(ShortCandidate.class);
        when(c.getOrderId()).thenReturn(orderId);
        when(c.getLineId()).thenReturn(lineId);
        return c;
    }

    @Test
    void newestOrdersAreFlaggedUntilTheShortfallIsCovered() {
        CommerceOrder newest = order("o-3", "PACKED");
        CommerceOrder cancelled = order("o-2", "CANCELLED");
        CommerceOrder older = order("o-1", "CONFIRMED");
        CommerceOrder oldest = order("o-0", "CONFIRMED");
        CommerceOrderLine l3 = line("l3", 2, 0);
        line("l2", 5, 0);
        CommerceOrderLine l1 = line("l1", 4, 0);
        CommerceOrderLine l0 = line("l0", 1, 0);
        List<ShortCandidate> candidates = List.of(candidate("o-3", "l3"), candidate("o-2", "l2"),
                candidate("o-1", "l1"), candidate("o-0", "l0"));
        when(orders.findShortCandidates("inst-1", "loc-1", "ps-1")).thenReturn(candidates);

        assertEquals(3, flagger.flagShortfall("inst-1", "loc-1", "ps-1", 3));
        assertEquals(2, l3.getStockShortQty());
        assertEquals(1, l1.getStockShortQty());
        assertEquals(0, l0.getStockShortQty());
        assertTrue(newest.getStockShort());
        assertNotNull(newest.getStockShortAt());
        assertTrue(older.getStockShort());
        assertFalse(Boolean.TRUE.equals(cancelled.getStockShort()));
        assertFalse(Boolean.TRUE.equals(oldest.getStockShort()));
        verify(transactionManager).getTransaction(org.mockito.ArgumentMatchers.argThat(
                (TransactionDefinition d) -> d.getPropagationBehavior() == TransactionDefinition.PROPAGATION_REQUIRES_NEW));
    }

    @Test
    void unitsAlreadyFlaggedAreNotCountedTwice() {
        order("o-1", "CONFIRMED");
        CommerceOrderLine l1 = line("l1", 3, 0);
        l1.setStockShortQty(2);
        List<ShortCandidate> candidates = List.of(candidate("o-1", "l1"));
        when(orders.findShortCandidates("inst-1", "loc-1", "ps-1")).thenReturn(candidates);
        assertEquals(1, flagger.flagShortfall("inst-1", "loc-1", "ps-1", 5));
        assertEquals(3, l1.getStockShortQty());
    }

    @Test
    void afterCommitWaitsForTheCommitAndNothingEverThrows() {
        TransactionSynchronizationManager.initSynchronization();
        flagger.afterCommit("inst-1", "loc-1", "ps-1", 2);
        verify(orders, never()).findShortCandidates(anyString(), anyString(), anyString());
        List<TransactionSynchronization> registered = TransactionSynchronizationManager.getSynchronizations();
        assertEquals(1, registered.size());
        when(orders.findShortCandidates(anyString(), anyString(), anyString())).thenThrow(new IllegalStateException(
                "database gone"));
        registered.get(0).afterCommit();
        verify(orders).findShortCandidates("inst-1", "loc-1", "ps-1");

        flagger.afterCommit("inst-1", "loc-1", "ps-1", 0);
        assertEquals(1, TransactionSynchronizationManager.getSynchronizations().size(), "no shortfall, nothing to do");

        when(orders.lockById(any())).thenThrow(new IllegalStateException("database gone"));
        flagger.flagOrder("inst-1", "o-9");
    }

    @Test
    void aRefusedShipFlagsItsOrder() {
        CommerceOrder o = order("o-1", "PACKED");
        flagger.flagOrder("inst-1", "o-1");
        assertTrue(o.getStockShort());
        verify(orders).save(o);
        flagger.flagOrder("inst-2", "o-1");
        verify(orders).save(any());
    }
}
