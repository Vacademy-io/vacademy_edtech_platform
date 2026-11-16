package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

/**
 * A line cancel: stock back now, the value off the totals, the logs of an unpaid order split
 * again (sums equal the total, a fully cancelled line's log carries 0), the pending tender
 * replaced, a paid order's value due back, a packed parcel and its pieces shrunk, and a whole
 * order cancelled when nothing is left.
 */
class CommerceLineCancelTest {

    private DeskFixture f;
    private CommerceStaffOrderService staffOrders;
    private CommerceLineCancelService service;
    private final CustomUserDetails manager = DeskFixture.manager();
    private CommerceOrderLine a;
    private CommerceOrderLine b;

    @BeforeEach
    void setUp() {
        f = new DeskFixture();
        staffOrders = mock(CommerceStaffOrderService.class);
        service = new CommerceLineCancelService(f.desk, f.orderRepository, f.lineRepository, f.tenderRepository,
                f.legacyRepository, f.shipmentLineRepository, f.pieceRepository, f.variantRepository,
                f.stockHoldService, staffOrders, f.auditService, f.requestGuard);
        a = f.line("l1", 3, "1500.00");
        b = f.line("l2", 1, "500.00");
        f.snapshot();
        // A staff order on credit: nothing paid, the whole total on one CREDIT tender.
        f.order.setChannel("ADMIN");
        f.order.setPaymentMethod("OFFLINE");
        f.order.setPaymentStatus("UNPAID");
        f.order.setAmountPaid(BigDecimal.ZERO.setScale(2));
        f.order.setTax(new BigDecimal("95.24"));
        a.setLogAmount(new BigDecimal("1560.00"));
        f.tender("CREDIT", "PENDING", "2060.00");
        f.facts("ps-l1", "TRACKED", "QUANTITY");
        f.facts("ps-l2", "TRACKED", "QUANTITY");
        f.soldHold(a, 3);
        f.soldHold(b, 1);
    }

    private void cancel(String lineId, int quantity, String... pieces) {
        service.cancelLine(manager, INST, ORDER, lineId, OrderDeskDtos.LineCancelRequest.builder()
                .clientRequestId("cancel-key-1").quantity(quantity).reason("customer changed mind")
                .pieceIds(pieces.length == 0 ? null : List.of(pieces)).build());
    }

    private BigDecimal pendingTotal() {
        return f.tenders.stream().filter(t -> "PENDING".equals(t.getStatus())).map(CommerceOrderTender::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static String code(RuntimeException e) {
        return e.getMessage().substring(0, e.getMessage().indexOf(':'));
    }

    @Test
    void oneOfThreeOnAnUnpaidOrderSplitsTheLogsAgainAndReplacesTheCredit() {
        cancel("l1", 1);

        verify(f.stockHoldService).giveBackSold("plan-l1", "ps-l1", 1, "LINE_CANCELLED");
        assertEquals(1, a.getQtyCancelled());
        assertEquals(new BigDecimal("500.00"), a.getCancelledValue());
        assertEquals(new BigDecimal("1560.00"), f.order.getTotal());
        assertEquals(new BigDecimal("1500.00"), f.order.getSubtotal());
        // Logs: l1 keeps its two units and the delivery (largest line), l2 its own total.
        verify(f.legacyRepository).setLogAmount("log-l1", "group-1", new BigDecimal("1060.00"));
        verify(f.legacyRepository, never()).setLogAmount(eq("log-l2"), anyString(), any());
        assertEquals(0, a.getLogAmount().add(b.getLogAmount()).compareTo(f.order.getTotal()),
                "the logs sum to the order total");
        assertEquals(new BigDecimal("1560.00"), pendingTotal(), "pending = total - paid");
        assertEquals(2, f.tenders.stream().filter(t -> "CREDIT".equals(t.getMode())).count());
        verify(f.legacyRepository, never()).cancelPlans(anyList());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("LINE_CANCELLED"), eq("ORDER_LINE"),
                eq("l1"), anyString(), anyString(), any());
        verify(f.accessGuard).require(manager, INST, CommerceFeature.ORDERS, Set.of(CommerceRole.STORE_MANAGER), LOC);
        verify(f.creditNoteService, never()).issue(anyString(), any(), any());
    }

    @Test
    void aFullyCancelledLineLeavesALogOfZeroAndItsPlanCancelled() {
        cancel("l2", 1);
        verify(f.legacyRepository).setLogAmount("log-l2", "group-1", new BigDecimal("0.00"));
        verify(f.legacyRepository, never()).setLogAmount(eq("log-l1"), anyString(), any());
        assertEquals(new BigDecimal("1560.00"), a.getLogAmount(), "l1 already carried the delivery");
        verify(f.legacyRepository).cancelPlans(List.of("plan-l2"));
        assertEquals(new BigDecimal("1560.00"), f.order.getTotal());
        assertEquals(new BigDecimal("1560.00"), pendingTotal());
        assertEquals("CONFIRMED", f.order.getStatus());
    }

    @Test
    void aCodOrderCollectsTheNewTotal() {
        f.order.setChannel("ONLINE");
        f.order.setPaymentMethod("COD");
        f.order.setCodAmount(new BigDecimal("2060.00"));
        f.tenders.get(0).setMode("COD");
        cancel("l1", 1);
        assertEquals(new BigDecimal("1560.00"), f.order.getCodAmount());
        assertTrue(f.tenders.stream().anyMatch(t -> "COD".equals(t.getMode()) && "PENDING".equals(t.getStatus())
                && t.getAmount().compareTo(new BigDecimal("1560.00")) == 0));
    }

    @Test
    void aPaidOrderKeepsItsLogsAndRecordsTheValueAsDueBack() {
        f.order.setPaymentStatus("PAID");
        f.order.setAmountPaid(new BigDecimal("2060.00"));
        f.tenders.clear();
        cancel("l1", 1);
        verify(f.legacyRepository, never()).setLogAmount(anyString(), anyString(), any());
        assertEquals(new BigDecimal("500.00"), f.order.getRefundDue());
        assertEquals(0, f.order.getRefundDue().compareTo(f.order.getAmountPaid().subtract(f.order.getTotal())),
                "refund_due = amount_paid - total");
        verify(f.refundHook).refundDue(INST, ORDER, "ORD-000001", "LCAN:l1:1", new BigDecimal("500.00"), "INR",
                "A line of the paid order was cancelled.");
    }

    @Test
    void whatWasPaidCoveringTheSmallerOrderMakesItPaidWithTheRestDueBack() {
        f.order.setPaymentStatus("PARTIALLY_PAID");
        f.order.setAmountPaid(new BigDecimal("1800.00"));
        f.tenders.get(0).setAmount(new BigDecimal("260.00"));
        cancel("l1", 1);
        assertEquals("PAID", f.order.getPaymentStatus());
        verify(staffOrders).settlePaid(f.order, f.lines);
        assertEquals(new BigDecimal("240.00"), f.order.getRefundDue());
        assertEquals(0, pendingTotal().signum(), "nothing is due any more");
        assertEquals(0, a.getLogAmount().add(b.getLogAmount()).compareTo(new BigDecimal("1800.00")),
                "the logs carry what was paid");
    }

    @Test
    void cancellingEveryLineCancelsTheOrder() {
        f.order.setAppliedCouponDiscountId("acd-1");
        cancel("l2", 1);
        cancel("l1", 3);
        assertEquals("CANCELLED", f.order.getStatus());
        assertEquals("LINES_CANCELLED", f.order.getCancelReason());
        assertEquals(0, pendingTotal().signum());
        verify(f.legacyRepository).giveCouponUseBack("acd-1");
    }

    @Test
    void onlyUnitsNotShippedNorCancelledCanBeCancelledBeforeTheOrderShips() {
        assertEquals("LINE_NOT_CANCELLABLE", code(assertThrows(ConflictException.class, () -> cancel("l1", 4))));
        f.order.setStatus("SHIPPED");
        assertEquals("LINE_NOT_CANCELLABLE", code(assertThrows(ConflictException.class, () -> cancel("l1", 1))));
        f.order.setStatus("CONFIRMED");
        assertThrows(vacademy.io.common.exceptions.VacademyException.class, () -> cancel("nope", 1));
        assertThrows(InvalidRequestException.class, () -> cancel("l1", 0));
        assertThrows(InvalidRequestException.class, () -> cancel("l1", 1, "pc-1"));
        verify(f.stockHoldService, never()).giveBackSold(anyString(), anyString(), anyInt(), any());
    }

    @Test
    void atPackedTheParcelShrinksTheNamedPiecesGoBackAndTheInvoiceIsCredited() {
        f.facts("ps-l1", "TRACKED", "PIECE");
        f.order.setStatus("PACKED");
        f.shipment("PACKED");
        f.shipmentLine(a, 3);
        f.shipmentLine(b, 1);
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        when(f.invoiceService.liveDocument(eq(INST), anyList())).thenReturn(Optional.of(invoice));
        InvoiceLineItem item = new InvoiceLineItem();
        item.setId("il-1");
        item.setSourceId("ref-l1");
        item.setQuantity(3);
        when(f.invoiceLineItemRepository.findByInvoiceId("inv-1")).thenReturn(List.of(item));

        assertEquals("PIECE_SCAN_REQUIRED", code(assertThrows(ConflictException.class, () -> cancel("l1", 1))));
        when(f.pieceRepository.unreserve(INST, "pc-2", "l1")).thenReturn(1);
        cancel("l1", 1, "pc-2");

        verify(f.pieceRepository).unreserve(INST, "pc-2", "l1");
        assertEquals(2, f.shipmentLines.get(0).getQuantity());
        verify(f.shipmentLineRepository).save(f.shipmentLines.get(0));
        ArgumentCaptor<CreditNoteRequest> note = ArgumentCaptor.forClass(CreditNoteRequest.class);
        verify(f.creditNoteService).issue(eq(INST), eq("user-1"), note.capture());
        assertEquals("LCAN:l1:1", note.getValue().getClientRequestId());
        assertFalse(note.getValue().getFull());
        assertEquals(1, note.getValue().getLines().size());
        assertEquals("il-1", note.getValue().getLines().get(0).getInvoiceLineItemId());
        assertEquals(1, note.getValue().getLines().get(0).getQuantity());

        // The last unit of a line leaves the parcel line altogether.
        cancel("l2", 1);
        verify(f.shipmentLineRepository).delete(f.shipmentLines.get(1));
    }

    @Test
    void theStockShortCountNeverExceedsWhatIsLeftToShip() {
        f.order.setStockShort(true);
        a.setStockShortQty(3);
        cancel("l1", 2);
        assertEquals(1, a.getStockShortQty());
        assertTrue(f.order.getStockShort());
        cancel("l1", 1);
        assertEquals(0, a.getStockShortQty());
        assertFalse(f.order.getStockShort());
        verify(f.pieceRepository, never()).unreserve(anyString(), anyString(), anyString());
    }
}
