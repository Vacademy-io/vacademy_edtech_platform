package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

/**
 * The status moves of {@code POST /orders/{id}/transition} (rows 1, 2, 3, 5, 6, 8 and 10 of the
 * desk table), the stock-short clear and the bulk route: what each writes, the role and
 * location check before the lock, the status the client saw compared under it, and replays.
 */
class CommerceOrderDeskServiceTest {

    private DeskFixture f;
    private final CustomUserDetails manager = DeskFixture.manager();
    private CommerceOrderLine a;

    @BeforeEach
    void setUp() {
        f = new DeskFixture();
        a = f.line("l1", 2, "1000.00");
        f.snapshot();
        f.order.setAmountPaid(f.order.getTotal());
    }

    private StaffOrderDtos.StaffOrderDetail move(String from, String to) {
        return f.desk.transition(manager, INST, ORDER, OrderDeskDtos.TransitionRequest.builder()
                .clientRequestId(DeskFixture.KEY).fromStatus(from).toStatus(to).reason("asked by phone").build());
    }

    private static String code(RuntimeException e) {
        return e.getMessage().substring(0, e.getMessage().indexOf(':'));
    }

    // ------------------------------------------------------------------ row 1

    @Test
    void row1_aCodOrderIsConfirmedByAFloorRole() {
        f.order.setStatus("COD_PENDING_CONFIRMATION");
        f.order.setPaymentMethod("COD");
        f.order.setPaymentStatus("UNPAID");
        f.order.setCodConfirmDueAt(new java.util.Date());
        move("COD_PENDING_CONFIRMATION", "CONFIRMED");

        assertEquals("CONFIRMED", f.order.getStatus());
        assertNotNull(f.order.getConfirmedAt());
        assertNull(f.order.getCodConfirmDueAt());
        verify(f.writer).history(eq(f.order), eq(CommerceOrderStatus.COD_PENDING_CONFIRMATION),
                eq(CommerceOrderStatus.CONFIRMED), eq("user-1"), anyString());
        ArgumentCaptor<CommerceOrderEvents.OrderEvent> event = ArgumentCaptor.forClass(CommerceOrderEvents.OrderEvent.class);
        verify(f.events).afterCommit(event.capture());
        assertEquals(CommerceOrderEvents.ORDER_CONFIRMED, event.getValue().type());
        verify(f.accessGuard).require(manager, INST, CommerceFeature.ORDERS,
                Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF), LOC);
        verify(f.stockHoldService, never()).giveBackSold(anyString(), anyString(), anyInt(), any());
    }

    // ------------------------------------------------------------------ rows 2, 3, 6

    @Test
    void row2_aCodCancelGivesTheStockBackVoidsTheTenderAndTheCouponUse() {
        f.order.setStatus("COD_PENDING_CONFIRMATION");
        f.order.setPaymentMethod("COD");
        f.order.setPaymentStatus("UNPAID");
        f.order.setAmountPaid(BigDecimal.ZERO.setScale(2));
        f.order.setAppliedCouponDiscountId("acd-1");
        CommerceOrderTender cod = f.tender("COD", "PENDING", "1060.00");
        f.soldHold(a, 2);
        move("COD_PENDING_CONFIRMATION", "CANCELLED");

        assertEquals("CANCELLED", f.order.getStatus());
        assertEquals("STAFF_CANCELLED", f.order.getCancelReason());
        verify(f.stockHoldService).giveBackSold("plan-l1", "ps-l1", 2, "CANCELLED");
        verify(f.legacyRepository).cancelPlans(List.of("plan-l1"));
        assertEquals("VOID", cod.getStatus());
        verify(f.legacyRepository).giveCouponUseBack("acd-1");
        verify(f.refundHook, never()).refundDue(any(), any(), any(), any(), any(), any(), any());
        assertEquals(0, f.order.getRefundDue().signum());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("ORDER_CANCELLED"), eq("ORDER"), eq(ORDER),
                any(), anyString(), any());
    }

    @Test
    void row3_aPaidConfirmedCancelRecordsTheWholeAmountAsDueBackAndKeepsTheCoupon() {
        f.order.setAppliedCouponDiscountId("acd-1");
        f.soldHold(a, 2);
        // invoiceAt = CONFIRMED: the order already has its invoice.
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        when(f.invoiceService.liveDocument(eq(INST), anyList())).thenReturn(Optional.of(invoice));
        move("CONFIRMED", "CANCELLED");

        assertEquals("CANCELLED", f.order.getStatus());
        assertEquals(f.order.getAmountPaid(), f.order.getRefundDue());
        verify(f.refundHook).refundDue(INST, ORDER, "ORD-000001", "OCAN:" + ORDER, f.order.getAmountPaid(), "INR",
                "The order was cancelled after it was paid.");
        verify(f.legacyRepository, never()).giveCouponUseBack(anyString());
        verify(f.stockHoldService).giveBackSold("plan-l1", "ps-l1", 2, "CANCELLED");
        ArgumentCaptor<CreditNoteRequest> note = ArgumentCaptor.forClass(CreditNoteRequest.class);
        verify(f.creditNoteService).issue(eq(INST), eq("user-1"), note.capture());
        assertEquals("OCAN:" + ORDER, note.getValue().getClientRequestId());
        assertEquals(Boolean.TRUE, note.getValue().getFull());
    }

    @Test
    void row3_aWarehouseHandCannotCancelAConfirmedOrder() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(f.accessGuard).require(any(), eq(INST), eq(CommerceFeature.ORDERS),
                        eq(Set.of(CommerceRole.STORE_MANAGER)), eq(LOC));
        assertThrows(CommerceAccessDeniedException.class, () -> move("CONFIRMED", "CANCELLED"));
        verify(f.requestGuard, never()).run(any(), any(), any());
        verify(f.orderRepository, never()).lockById(anyString());
        assertEquals("CONFIRMED", f.order.getStatus());
    }

    @Test
    void row6_aPackedCancelUnpacksWithOneCreditNoteAndGivesTheUnitsBack() {
        f.order.setStatus("PACKED");
        f.shipment("PACKED");
        f.shipmentLine(a, 2);
        f.soldHold(a, 2);
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        when(f.invoiceService.liveDocument(eq(INST), anyList())).thenReturn(Optional.of(invoice));
        move("PACKED", "CANCELLED");

        assertEquals("CANCELLED", f.order.getStatus());
        assertEquals("CANCELLED", f.shipment.getStatus());
        ArgumentCaptor<CreditNoteRequest> note = ArgumentCaptor.forClass(CreditNoteRequest.class);
        verify(f.creditNoteService).issue(eq(INST), eq("user-1"), note.capture());
        assertEquals("UNPACK:sh-1:0", note.getValue().getClientRequestId(), "one note covers unpack and cancel");
        verify(f.stockHoldService).giveBackSold("plan-l1", "ps-l1", 2, "CANCELLED");
        assertEquals(f.order.getAmountPaid(), f.order.getRefundDue());
        assertTrue(f.posted.isEmpty(), "no movement before the goods leave");
    }

    // ------------------------------------------------------------------ row 5

    @Test
    void row5_unpackPutsPiecesBackIssuesTheCreditNoteAndKeepsTheHolds() {
        f.order.setStatus("PACKED");
        f.order.setPackedAt(new java.util.Date());
        f.shipment("PACKED");
        f.shipmentLine(a, 2);
        a.setPieceId(null);
        var piece = org.mockito.Mockito.mock(vacademy.io.admin_core_service.features.commerce.stock.repository
                .CommercePieceRepository.PieceRow.class);
        when(piece.getId()).thenReturn("pc-1");
        when(piece.getStatus()).thenReturn("RESERVED");
        when(f.pieceRepository.findRowsByOrderLine(INST, "l1")).thenReturn(List.of(piece));
        when(f.pieceRepository.unreserve(INST, "pc-1", "l1")).thenReturn(1);
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        when(f.invoiceService.liveDocument(eq(INST), anyList())).thenReturn(Optional.of(invoice));
        move("PACKED", "CONFIRMED");

        assertEquals("CONFIRMED", f.order.getStatus());
        assertNull(f.order.getPackedAt());
        assertEquals("CANCELLED", f.shipment.getStatus());
        verify(f.pieceRepository).unreserve(INST, "pc-1", "l1");
        verify(f.creditNoteService).issue(eq(INST), eq("user-1"), any(CreditNoteRequest.class));
        verify(f.stockHoldService, never()).giveBackSold(anyString(), anyString(), anyInt(), any());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("ORDER_UNPACKED"), eq("ORDER"), eq(ORDER),
                any(), any(), any());
    }

    // ------------------------------------------------------------------ row 8

    @Test
    void row8_undoShippedReversesEverySaleOfTheCurrentShipAndReopensTheHolds() {
        f.order.setStatus("SHIPPED");
        f.order.setShippedAt(new java.util.Date());
        f.shipment("SHIPPED");
        f.shipment.setShipCount(2);
        f.shipmentLine(a, 2);
        a.setQtyShipped(2);
        a.setCostTotal(new BigDecimal("200.00"));
        StockMovement first = sale("mv-old", "SALE:shl-l1:1");
        StockMovement current = sale("mv-now", "SALE:shl-l1:2");
        StockMovement reversal = sale("mv-rev", "SALE_UNDO:mv-old");
        reversal.setReversesMovementId("mv-old");
        when(f.movementRepository.findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(eq(INST),
                eq("SHIPMENT_LINE"), any(Collection.class))).thenReturn(List.of(first, reversal, current));
        move("SHIPPED", "PACKED");

        assertEquals(1, f.posted.size(), "only the current ship's sale is reversed");
        StockPosting undo = f.posted.get(0);
        assertEquals(StockMovementType.SALE, undo.getType());
        assertEquals(2, undo.getQuantityDelta());
        assertEquals("mv-now", undo.getReversesMovementId());
        assertEquals("SALE_UNDO:mv-now", undo.getIdempotencyKey());
        assertEquals("SHIP_UNDO", undo.getReason());
        verify(f.stockHoldService).reopenShipped("plan-l1", "ps-l1");
        assertEquals(0, a.getQtyShipped());
        assertNull(a.getCostTotal());
        assertEquals("PACKED", f.shipment.getStatus());
        assertNull(f.shipment.getShippedAt());
        assertEquals("PACKED", f.order.getStatus());
        assertNull(f.order.getShippedAt());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("SHIP_UNDONE"), eq("SHIPMENT"), eq("sh-1"),
                any(), anyString(), any());
        verify(f.creditNoteService, never()).issue(anyString(), any(), any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void row8_undoShippedIsRefusedInAClosedStockPeriodAsShipIs() {
        f.order.setStatus("SHIPPED");
        f.shipment("SHIPPED");
        f.shipmentLine(a, 2);
        a.setQtyShipped(2);
        when(f.movementRepository.findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(eq(INST),
                eq("SHIPMENT_LINE"), any(Collection.class))).thenReturn(List.of(sale("mv-now", "SALE:shl-l1:1")));
        StockPeriodGuard guard = org.mockito.Mockito.mock(StockPeriodGuard.class);
        doThrow(new ConflictException("PERIOD_LOCKED: the stock period is closed")).when(guard)
                .assertOpen(INST, f.today);
        doAnswer(call -> {
            ((Consumer<StockPeriodGuard>) call.getArgument(0)).accept(guard);
            return null;
        }).when(f.periodGuard).ifAvailable(any());

        assertEquals("PERIOD_LOCKED", code(assertThrows(ConflictException.class, () -> move("SHIPPED", "PACKED"))));
        verify(guard).assertOpen(INST, f.today);
        assertTrue(f.posted.isEmpty(), "no reversal is posted into a closed period");
        verify(f.stockHoldService, never()).reopenShipped(anyString(), anyString());
        assertEquals("SHIPPED", f.order.getStatus());
        assertEquals("SHIPPED", f.shipment.getStatus());
        assertEquals(2, a.getQtyShipped());
    }

    private static StockMovement sale(String id, String key) {
        StockMovement m = new StockMovement();
        m.setId(id);
        m.setType("SALE");
        m.setQuantityDelta(-2);
        m.setReferenceId("shl-l1");
        m.setLocationId(LOC);
        m.setPackageSessionId("ps-l1");
        m.setIdempotencyKey(key);
        return m;
    }

    // ------------------------------------------------------------------ row 10

    @Test
    void row10_aDeliveryMarkedByMistakeIsUndone() {
        f.order.setStatus("DELIVERED");
        f.shipment("DELIVERED");
        f.shipment.setDeliveredOn(f.today);
        move("DELIVERED", "SHIPPED");
        assertEquals("SHIPPED", f.order.getStatus());
        assertEquals("SHIPPED", f.shipment.getStatus());
        assertNull(f.shipment.getDeliveredOn());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("DELIVERY_UNDONE"), eq("SHIPMENT"),
                eq("sh-1"), anyString(), any(), any());
    }

    @Test
    void row10_isRefusedOnceCodCashIsInOrAReturnExists() {
        f.order.setStatus("DELIVERED");
        f.shipment("DELIVERED");
        f.order.setCodRemittanceId("rem-1");
        assertEquals("COD_COLLECTED", code(assertThrows(ConflictException.class, () -> move("DELIVERED", "SHIPPED"))));
        f.order.setCodRemittanceId(null);
        f.tender("COD", "RECEIVED", "1060.00");
        assertEquals("COD_COLLECTED", code(assertThrows(ConflictException.class, () -> move("DELIVERED", "SHIPPED"))));
        f.tenders.clear();
        a.setQtyReturned(1);
        assertEquals("HAS_RETURNS", code(assertThrows(ConflictException.class, () -> move("DELIVERED", "SHIPPED"))));
        assertEquals("DELIVERED", f.order.getStatus());
    }

    // ------------------------------------------------------------------ guards

    @Test
    void theStatusTheClientSawIsComparedUnderTheLockAndNothingIsWritten() {
        f.order.setStatus("PACKED");
        assertEquals("ORDER_STATE_CHANGED", code(assertThrows(ConflictException.class,
                () -> move("CONFIRMED", "CANCELLED"))));
        verify(f.orderRepository).lockById(ORDER);
        verify(f.orderRepository, never()).save(any());
        verify(f.stockHoldService, never()).giveBackSold(anyString(), anyString(), anyInt(), any());
    }

    @Test
    void aNonAdminOutsideTheOrdersLocationIsRefusedBeforeTheLock() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, "no"))
                .when(f.accessGuard).require(any(), eq(INST), eq(CommerceFeature.ORDERS), any(), eq(LOC));
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> move("CONFIRMED", "CANCELLED"));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, e.getCode());
        verify(f.orderRepository, never()).lockById(anyString());
    }

    @Test
    void aReplayIsAnsweredWithTheCurrentOrderAndAReusedKeyIsAMismatch() {
        org.mockito.Mockito.doReturn(new CommerceRequestGuard.Outcome<>(ORDER, true)).when(f.requestGuard)
                .run(any(), any(), any());
        StaffOrderDtos.StaffOrderDetail detail = move("CONFIRMED", "CANCELLED");
        assertEquals(Boolean.TRUE, detail.getReplayed());
        assertEquals("CONFIRMED", f.order.getStatus(), "a replay changes nothing");

        doThrow(new ConflictException("IDEMPOTENCY_MISMATCH: client_request_id was already used for another "
                + "request")).when(f.requestGuard).run(any(), any(), any());
        assertEquals("IDEMPOTENCY_MISMATCH", code(assertThrows(ConflictException.class,
                () -> move("CONFIRMED", "CANCELLED"))));
    }

    @Test
    void theKeyCarriesTheActionTheOrderAndAHashWithoutTheClientKey() {
        move("CONFIRMED", "CANCELLED");
        ArgumentCaptor<CommerceRequestGuard.Key> key = ArgumentCaptor.forClass(CommerceRequestGuard.Key.class);
        verify(f.requestGuard).run(key.capture(), any(), any());
        assertEquals("ORDER_TRANSITION", key.getValue().action());
        assertEquals(ORDER, key.getValue().referenceId());
        assertEquals(DeskFixture.KEY, key.getValue().clientRequestId());
        assertEquals(CommerceRequestGuard.hash("ORDER_TRANSITION", OrderDeskDtos.TransitionRequest.builder()
                .clientRequestId("another-key-9").fromStatus("CONFIRMED").toStatus("CANCELLED")
                .reason("asked by phone").build(), ORDER), key.getValue().requestHash());
    }

    @Test
    void aBadBodyIs400BeforeAnythingIsRead() {
        assertThrows(InvalidRequestException.class, () -> f.desk.transition(manager, INST, ORDER, null));
        assertThrows(InvalidRequestException.class, () -> f.desk.transition(manager, INST, ORDER,
                OrderDeskDtos.TransitionRequest.builder().clientRequestId("short").fromStatus("CONFIRMED")
                        .toStatus("CANCELLED").build()));
        assertThrows(InvalidRequestException.class, () -> f.desk.transition(manager, INST, ORDER,
                OrderDeskDtos.TransitionRequest.builder().clientRequestId(DeskFixture.KEY).fromStatus("PAID")
                        .toStatus("CANCELLED").build()));
        assertThrows(InvalidRequestException.class, () -> f.desk.transition(manager, INST, ORDER,
                OrderDeskDtos.TransitionRequest.builder().clientRequestId(DeskFixture.KEY).fromStatus("CONFIRMED")
                        .toStatus("CANCELLED").note("x".repeat(501)).build()));
        verify(f.orderRepository, never()).findByIdAndInstituteId(anyString(), anyString());
    }

    // ------------------------------------------------------------------ stock short, bulk

    @Test
    void theStockShortFlagIsClearedWithAnAudit() {
        f.order.setStockShort(true);
        a.setStockShortQty(1);
        f.desk.clearStockShort(manager, INST, ORDER, OrderDeskDtos.StockShortClearRequest.builder()
                .clientRequestId(DeskFixture.KEY).note("found it on shelf 3").build());
        assertFalse(f.order.getStockShort());
        assertEquals(0, a.getStockShortQty());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("STOCK_SHORT_CLEARED"), eq("ORDER"),
                eq(ORDER), anyString(), any(), eq("found it on shelf 3"));
        f.order.setStockShort(false);
        assertEquals("ORDER_STATE_CHANGED", code(assertThrows(ConflictException.class, () -> f.desk.clearStockShort(
                manager, INST, ORDER, OrderDeskDtos.StockShortClearRequest.builder().clientRequestId(DeskFixture.KEY)
                        .build()))));
    }

    @Test
    void bulkRunsEachOrderUnderItsOwnKeyAndOneFailureDoesNotStopTheOthers() {
        f.order.setStatus("COD_PENDING_CONFIRMATION");
        OrderDeskDtos.BulkResponse response = f.desk.bulk(manager, INST, OrderDeskDtos.BulkRequest.builder()
                .clientRequestId("bulk-0001").action("confirm")
                .items(List.of(OrderDeskDtos.BulkItem.builder().orderId(ORDER).fromStatus("COD_PENDING_CONFIRMATION")
                                .build(),
                        OrderDeskDtos.BulkItem.builder().orderId("order-missing").fromStatus("COD_PENDING_CONFIRMATION")
                                .build()))
                .build());
        assertEquals(2, response.getResults().size());
        assertTrue(response.getResults().get(0).isOk());
        assertFalse(response.getResults().get(1).isOk());
        assertEquals("ORDER_NOT_FOUND", response.getResults().get(1).getCode());
        assertEquals("CONFIRMED", f.order.getStatus());
        ArgumentCaptor<CommerceRequestGuard.Key> key = ArgumentCaptor.forClass(CommerceRequestGuard.Key.class);
        verify(f.requestGuard).run(key.capture(), any(), any());
        assertEquals("bulk-0001:" + ORDER, key.getValue().clientRequestId());
        verify(f.accessGuard).require(manager, INST, CommerceFeature.ORDERS,
                Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF));
    }

    @Test
    void bulkPackRefusesOneOfAKindStockAndBulkChecksItsBody() {
        f.facts("ps-l1", "TRACKED", "PIECE");
        OrderDeskDtos.BulkResponse response = f.desk.bulk(manager, INST, OrderDeskDtos.BulkRequest.builder()
                .clientRequestId("bulk-0002").action("PACK")
                .items(List.of(OrderDeskDtos.BulkItem.builder().orderId(ORDER).fromStatus("CONFIRMED").build()))
                .build());
        assertEquals("PIECE_SCAN_REQUIRED", response.getResults().get(0).getCode());
        assertEquals("CONFIRMED", f.order.getStatus());

        assertThrows(InvalidRequestException.class, () -> f.desk.bulk(manager, INST, OrderDeskDtos.BulkRequest
                .builder().clientRequestId("b".repeat(28)).action("PACK").items(List.of()).build()));
        assertThrows(InvalidRequestException.class, () -> f.desk.bulk(manager, INST, OrderDeskDtos.BulkRequest
                .builder().clientRequestId("bulk-0003").action("CANCEL").items(List.of()).build()));
        assertThrows(InvalidRequestException.class, () -> f.desk.bulk(manager, INST, OrderDeskDtos.BulkRequest
                .builder().clientRequestId("bulk-0003").action("PACK").items(List.of(
                        OrderDeskDtos.BulkItem.builder().orderId(ORDER).build(),
                        OrderDeskDtos.BulkItem.builder().orderId(ORDER).build())).build()));
    }
}
