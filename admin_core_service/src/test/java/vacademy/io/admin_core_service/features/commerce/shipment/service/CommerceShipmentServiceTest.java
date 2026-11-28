package vacademy.io.admin_core_service.features.commerce.shipment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixtureAccess;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pack (pieces set aside, the invoice, no movement), ship (SALE keys with the ship count, holds
 * closed, cost of the goods), deliver, RTO (no movement, COD money and refusals, the credit
 * note) and RTO received (RETURN, and DAMAGE after it for a damaged unit), with their refusals.
 */
class CommerceShipmentServiceTest {

    private static final String INST = "inst-1";
    private static final String ORDER = "order-1";

    private DeskFixtureAccess f;
    private CommerceShipmentService service;
    private final CustomUserDetails manager = DeskFixtureAccess.manager();
    private CommerceOrderLine a;

    @BeforeEach
    void setUp() {
        f = new DeskFixtureAccess();
        service = f.shipments();
        a = f.line("l1", 2, "1000.00");
        f.snapshot();
        f.order().setAmountPaid(f.order().getTotal());
        f.facts("ps-l1", "TRACKED", "QUANTITY");
        f.soldHold(a, 2);
    }

    private static String code(RuntimeException e) {
        return e.getMessage().substring(0, e.getMessage().indexOf(':'));
    }

    private ShipmentDtos.PackRequest pack(ShipmentDtos.PackLine... lines) {
        return ShipmentDtos.PackRequest.builder().clientRequestId("pack-key-1").orderId(ORDER).fromStatus("CONFIRMED")
                .lines(List.of(lines)).build();
    }

    private static ShipmentDtos.PackLine packLine(String lineId, int quantity, List<String> codes) {
        return ShipmentDtos.PackLine.builder().orderLineId(lineId).quantity(quantity).pieceCodes(codes).build();
    }

    private void ship() {
        service.ship(manager, INST, "sh-1", ShipmentDtos.ShipRequest.builder().clientRequestId("ship-key-1")
                .carrierName("India Post").trackingNumber("EM1IN").notifyCustomer(false).build());
    }

    private static PieceRow piece(String id, String code, String status) {
        PieceRow row = mock(PieceRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getCode()).thenReturn(code);
        when(row.getStatus()).thenReturn(status);
        when(row.getPackageSessionId()).thenReturn("ps-l1");
        return row;
    }

    // ------------------------------------------------------------------ pack

    @Test
    void packSetsTheParcelAsideAndIssuesTheInvoiceWithNoMovement() {
        service.pack(manager, INST, pack(packLine("l1", 2, null)));

        assertEquals("PACKED", f.order().getStatus());
        assertNotNull(f.order().getPackedAt());
        assertEquals("PACKED", f.shipment().getStatus());
        assertEquals(1, f.shipmentLines().size());
        assertEquals(2, f.shipmentLines().get(0).getQuantity());
        ArgumentCaptor<CommerceInvoiceRequest> invoice = ArgumentCaptor.forClass(CommerceInvoiceRequest.class);
        verify(f.invoiceService()).issue(eq(INST), invoice.capture());
        assertTrue(invoice.getValue().isAllowAfterFullCredit(), "a re-pack after an unpack is invoiced again");
        assertEquals(List.of("log-l1"), invoice.getValue().getPaymentLogIds());
        assertEquals(0, invoice.getValue().getTax().getTotal().compareTo(f.order().getTotal()),
                "invoice total = order total at pack");
        assertNotNull(f.shipment().getInvoiceId());
        assertTrue(f.posted().isEmpty());
    }

    @Test
    void packOfOneOfAKindStockReservesTheScannedPieces() {
        f.facts("ps-l1", "TRACKED", "PIECE");
        a.setQuantity(1);
        f.soldHold(a, 1);
        PieceRow p = piece("pc-1", "PC-0001", "IN_STOCK");
        when(f.pieceRepository().findRowByCode(INST, "PC-0001")).thenReturn(Optional.of(p));
        when(f.pieceRepository().reserveForLine(INST, "pc-1", "loc-1", "l1")).thenReturn(1);
        service.pack(manager, INST, pack(packLine("l1", 1, List.of("pc-0001"))));
        verify(f.pieceRepository()).reserveForLine(INST, "pc-1", "loc-1", "l1");
        assertEquals("pc-1", a.getPieceId());
    }

    @Test
    void packRefusals() {
        assertEquals("NOT_FULLY_PACKED", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 1, null))))));
        f.line("l2", 1, "500.00");
        f.facts("ps-l2", "UNTRACKED", "QUANTITY");
        assertEquals("NOT_FULLY_PACKED", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 2, null))))));
        f.lines().remove(1);

        f.facts("ps-l1", "TRACKED", "PIECE");
        PieceRow first = piece("pc-1", "PC-0001", "IN_STOCK");
        when(f.pieceRepository().findRowByCode(INST, "PC-0001")).thenReturn(Optional.of(first));
        assertEquals("PIECE_SCAN_REQUIRED", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 2, List.of("PC-0001")))))));
        PieceRow second = piece("pc-2", "PC-0002", "SOLD");
        when(f.pieceRepository().findRowByCode(INST, "PC-0002")).thenReturn(Optional.of(second));
        when(f.pieceRepository().reserveForLine(anyString(), anyString(), anyString(), anyString())).thenReturn(0);
        assertEquals("PIECE_NOT_AVAILABLE", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 2, List.of("PC-0001", "PC-0002")))))));
        f.facts("ps-l1", "TRACKED", "QUANTITY");

        f.location().setSellsOnline(false);
        assertEquals("LOCATION_NOT_ONLINE", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 2, null))))));
        f.location().setSellsOnline(true);
        f.order().setFulfilmentLocationId(null);
        assertEquals("NO_FULFILMENT_LOCATION", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 2, null))))));
        f.order().setFulfilmentLocationId("loc-1");
        f.soldHold(a, 1);
        assertEquals("STOCK_NOT_SETTLED", code(assertThrows(ConflictException.class,
                () -> service.pack(manager, INST, pack(packLine("l1", 2, null))))));
        assertEquals("CONFIRMED", f.order().getStatus());
        verify(f.invoiceService(), never()).issue(anyString(), any());
    }

    // ------------------------------------------------------------------ ship

    @Test
    void shipPostsOneSaleKeyedWithTheShipCountClosesTheHoldAndPricesTheGoods() {
        f.order().setStatus("PACKED");
        f.order().setStockShort(true);
        a.setStockShortQty(1);
        f.shipment("PACKED");
        f.shipmentLine(a, 2);
        ship();

        assertEquals(1, f.posted().size());
        StockPosting sale = f.posted().get(0);
        assertEquals(StockMovementType.SALE, sale.getType());
        assertEquals(-2, sale.getQuantityDelta());
        assertEquals("SALE:shl-l1:1", sale.getIdempotencyKey());
        assertEquals("SHIPMENT_LINE", sale.getReferenceType());
        assertEquals("loc-1", sale.getLocationId());
        verify(f.stockHoldService()).closeWithoutGiveBack("plan-l1", "ps-l1", "SHIPPED");
        assertEquals(2, a.getQtyShipped());
        assertEquals(new BigDecimal("200.00"), a.getCostTotal(), "2 x 100.00 from the SALE row");
        assertEquals(1, f.shipment().getShipCount());
        assertEquals("SHIPPED", f.shipment().getStatus());
        assertEquals("India Post", f.shipment().getCarrierName());
        assertEquals("SHIPPED", f.order().getStatus());
        assertFalse(f.order().getStockShort(), "ship clears the stock-short flag");
        assertEquals(0, a.getStockShortQty());
        ArgumentCaptor<CommerceOrderEvents.OrderEvent> event = ArgumentCaptor.forClass(CommerceOrderEvents.OrderEvent.class);
        verify(f.events()).afterCommit(event.capture());
        assertEquals(CommerceOrderEvents.ORDER_SHIPPED, event.getValue().type());
        assertFalse(event.getValue().notifyCustomer());
    }

    @Test
    void aShipAfterAnUndoPostsNewKeysAndPiecesAreKeyedOneByOne() {
        f.facts("ps-l1", "TRACKED", "PIECE");
        f.order().setStatus("PACKED");
        f.shipment("PACKED");
        f.shipment().setShipCount(1);
        f.shipmentLine(a, 2);
        List<PieceRow> reserved = List.of(piece("pc-1", "A1", "RESERVED"), piece("pc-2", "A2", "RESERVED"));
        when(f.pieceRepository().findRowsByOrderLine(INST, "l1")).thenReturn(reserved);
        ship();
        assertEquals(List.of("SALE:shl-l1:pc-1:2", "SALE:shl-l1:pc-2:2"),
                f.posted().stream().map(StockPosting::getIdempotencyKey).toList());
        assertTrue(f.posted().stream().allMatch(p -> p.getQuantityDelta() == -1));
        assertEquals(2, f.shipment().getShipCount());
    }

    @Test
    void aShipTheLedgerRefusesRollsBackAndFlagsTheOrderStockShort() {
        f.order().setStatus("PACKED");
        f.shipment("PACKED");
        f.shipmentLine(a, 2);
        when(f.ledger().postAll(anyList())).thenThrow(new ConflictException("NOT_IN_STOCK: only 1 on hand"));
        assertEquals("NOT_IN_STOCK", code(assertThrows(ConflictException.class, this::ship)));
        verify(f.stockShortFlagger()).flagOrder(INST, ORDER);
        verify(f.stockHoldService(), never()).closeWithoutGiveBack(anyString(), anyString(), anyString());
        assertEquals("PACKED", f.order().getStatus());
    }

    @Test
    void shipNeedsACourierAndATrackingNumber() {
        assertThrows(InvalidRequestException.class, () -> service.ship(manager, INST, "sh-1",
                ShipmentDtos.ShipRequest.builder().clientRequestId("ship-key-1").carrierName("India Post").build()));
        verify(f.requestGuard(), never()).run(any(), any(), any());
    }

    // ------------------------------------------------------------------ deliver, RTO

    private void status(ShipmentDtos.StatusRequest.StatusRequestBuilder body) {
        service.status(manager, INST, "sh-1", body.clientRequestId("status-key-1").build());
    }

    @Test
    void deliveredOnIsNotInTheFutureNorBeforeTheShipDate() {
        f.order().setStatus("SHIPPED");
        f.shipment("SHIPPED");
        assertThrows(InvalidRequestException.class, () -> status(ShipmentDtos.StatusRequest.builder().to("DELIVERED")
                .deliveredOn(f.today().plusDays(1))));
        assertThrows(InvalidRequestException.class, () -> status(ShipmentDtos.StatusRequest.builder().to("DELIVERED")
                .deliveredOn(f.today().minusDays(5))));
        status(ShipmentDtos.StatusRequest.builder().to("delivered"));
        assertEquals("DELIVERED", f.order().getStatus());
        assertEquals(f.today(), f.shipment().getDeliveredOn());
        assertNotNull(f.order().getDeliveredAt());
    }

    @Test
    void aCodRtoVoidsTheCashTenderCountsARefusalAndCreditsTheInvoiceWithNoMovement() {
        f.order().setStatus("SHIPPED");
        f.order().setPaymentMethod("COD");
        f.order().setPaymentStatus("UNPAID");
        f.order().setCustomerPhone("919876500001");
        f.order().setAmountPaid(BigDecimal.ZERO.setScale(2));
        CommerceOrderTender cod = f.tender("COD", "PENDING", "1060.00");
        f.shipment("SHIPPED");
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        when(f.invoiceService().liveDocument(eq(INST), anyList())).thenReturn(Optional.of(invoice));
        status(ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("refused"));

        assertEquals("RTO", f.order().getStatus());
        assertEquals("RTO", f.shipment().getStatus());
        assertEquals("REFUSED", f.shipment().getRtoReason());
        assertEquals("VOID", cod.getStatus());
        verify(f.legacyRepository()).cancelPendingPlans(List.of("plan-l1"));
        verify(f.orderRepository()).incrementCodRefusals(INST, "919876500001");
        ArgumentCaptor<CreditNoteRequest> note = ArgumentCaptor.forClass(CreditNoteRequest.class);
        verify(f.creditNoteService()).issue(eq(INST), eq("user-1"), note.capture());
        assertEquals("RTO:sh-1", note.getValue().getClientRequestId());
        assertTrue(f.posted().isEmpty(), "the parcel is in a van, not on a shelf");
        assertThrows(InvalidRequestException.class, () -> status(ShipmentDtos.StatusRequest.builder().to("RTO")));
    }

    @Test
    void aStaffOrderRtoVoidsWhatIsStillOnCreditAndCancelsTheUnpaidPlansWithNoRefusal() {
        f.order().setStatus("SHIPPED");
        f.order().setChannel("ADMIN");
        f.order().setPaymentMethod("OFFLINE");
        f.order().setPaymentStatus("PARTIALLY_PAID");
        f.order().setCustomerPhone("919876500002");
        f.order().setAmountPaid(new BigDecimal("400.00"));
        CommerceOrderTender cash = f.tender("CASH", "RECEIVED", "400.00");
        CommerceOrderTender onCredit = f.tender("CREDIT", "PENDING", "660.00");
        f.shipment("SHIPPED");
        status(ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("UNREACHABLE"));

        assertEquals("RTO", f.order().getStatus());
        assertEquals("VOID", onCredit.getStatus(), "nothing is left to collect for goods that came back");
        assertEquals("RECEIVED", cash.getStatus());
        verify(f.legacyRepository()).cancelPendingPlans(List.of("plan-l1"));
        verify(f.orderRepository(), never()).incrementCodRefusals(anyString(), anyString());
        assertTrue(f.posted().isEmpty());
    }

    @Test
    void aPaidStaffOrderRtoLeavesItsMoneyAndPlansAlone() {
        f.order().setStatus("SHIPPED");
        f.order().setChannel("ADMIN");
        f.order().setPaymentMethod("OFFLINE");
        f.order().setPaymentStatus("PAID");
        CommerceOrderTender cash = f.tender("CASH", "RECEIVED", "1060.00");
        f.shipment("SHIPPED");
        status(ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("UNREACHABLE"));
        assertEquals("RECEIVED", cash.getStatus());
        verify(f.legacyRepository(), never()).cancelPendingPlans(anyList());
        verify(f.orderRepository(), never()).incrementCodRefusals(anyString(), anyString());
    }

    @Test
    void aPrepaidRtoTouchesNoMoneyYet() {
        f.order().setStatus("SHIPPED");
        f.shipment("SHIPPED");
        status(ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("UNREACHABLE"));
        verify(f.orderRepository(), never()).incrementCodRefusals(anyString(), anyString());
        verify(f.legacyRepository(), never()).cancelPendingPlans(anyList());
        verify(f.refundHook(), never()).refundDue(any(), any(), any(), any(), any(), any(), any());
        assertEquals(0, f.order().getRefundDue().signum());
    }

    // ------------------------------------------------------------------ RTO received

    private void rtoReceivedSetUp() {
        f.order().setStatus("RTO");
        f.shipment("RTO");
        f.shipmentLine(a, 2);
        a.setQtyShipped(2);
        StockMovement sale = new StockMovement();
        sale.setId("mv-sale");
        sale.setType("SALE");
        sale.setQuantityDelta(-2);
        sale.setReferenceId("shl-l1");
        sale.setIdempotencyKey("SALE:shl-l1:1");
        sale.setUnitCost(new BigDecimal("87.50"));
        when(f.movementRepository().findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(eq(INST),
                eq("SHIPMENT_LINE"), any(Collection.class))).thenReturn(List.of(sale));
    }

    private static ShipmentDtos.StatusLine back(String condition, int quantity, String... pieces) {
        return ShipmentDtos.StatusLine.builder().orderLineId("l1").condition(condition).quantity(quantity)
                .pieceIds(pieces.length == 0 ? null : List.of(pieces)).build();
    }

    @Test
    void resaleableUnitsComeBackAtTheirSaleCostAndAPaidOrderIsDueItsMoney() {
        rtoReceivedSetUp();
        status(ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(back("RESALEABLE", 2))));

        assertEquals(1, f.posted().size());
        StockPosting back = f.posted().get(0);
        assertEquals(StockMovementType.RETURN, back.getType());
        assertEquals(2, back.getQuantityDelta());
        assertEquals("RTO_RET:shl-l1", back.getIdempotencyKey());
        assertEquals(new BigDecimal("87.50"), back.getUnitCost());
        assertEquals(StockPosting.CostTreatment.KNOWN, back.getCostTreatment());
        assertEquals("RTO_RECEIVED", f.shipment().getStatus());
        assertEquals("RTO", f.order().getStatus(), "the order stays RTO");
        assertEquals(f.order().getAmountPaid(), f.order().getRefundDue(), "the delivery charge is refunded too");
        verify(f.refundHook()).refundDue(eq(INST), eq(ORDER), any(), eq("RTO:sh-1"), eq(f.order().getAmountPaid()),
                eq("INR"), any());
        verify(f.auditService()).record(eq(INST), eq("user-1"), eq("loc-1"), eq("RTO_RECEIVED"), eq("SHIPMENT"),
                eq("sh-1"), any(), anyString(), any());
    }

    @Test
    void theShopKeepsTheDeliveryChargeWhenItsSettingSaysSo() {
        rtoReceivedSetUp();
        when(f.storefrontSettings().read(INST)).thenReturn(DeskFixtureAccess.settings(false));
        status(ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(back("RESALEABLE", 2))));
        assertEquals(f.order().getAmountPaid().subtract(f.order().getShipping()), f.order().getRefundDue());
    }

    @Test
    void damagedUnitsComeBackAndAreWrittenOffAtOnce() {
        rtoReceivedSetUp();
        status(ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(back("RESALEABLE", 1),
                back("DAMAGED", 1))));
        assertEquals(2, f.posted().size());
        assertEquals(StockMovementType.RETURN, f.posted().get(0).getType());
        assertEquals(2, f.posted().get(0).getQuantityDelta(), "every unit comes back first");
        assertNull(f.posted().get(0).getReason());
        assertEquals(StockMovementType.DAMAGE, f.posted().get(1).getType());
        assertEquals(-1, f.posted().get(1).getQuantityDelta());
        assertEquals("DAMAGED_IN_TRANSIT", f.posted().get(1).getReason());
        assertEquals("RTO_DMG:shl-l1", f.posted().get(1).getIdempotencyKey());
    }

    @Test
    void aResaleablePieceAfterADamagedOneComesBackWithoutTheDamageReason() {
        rtoReceivedSetUp();
        f.facts("ps-l1", "TRACKED", "PIECE");
        // Ordered by code: the damaged piece is posted first.
        List<PieceRow> sold = List.of(piece("pc-1", "A1", "SOLD"), piece("pc-2", "A2", "SOLD"));
        when(f.pieceRepository().findRowsByOrderLine(INST, "l1")).thenReturn(sold);
        status(ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(back("DAMAGED", 1, "pc-1"),
                back("RESALEABLE", 1, "pc-2"))));

        assertEquals(List.of("RTO_RET:shl-l1:pc-1", "RTO_DMG:shl-l1:pc-1", "RTO_RET:shl-l1:pc-2"),
                f.posted().stream().map(StockPosting::getIdempotencyKey).toList());
        assertNull(f.posted().get(0).getReason());
        assertEquals("DAMAGED_IN_TRANSIT", f.posted().get(1).getReason());
        assertEquals(StockMovementType.RETURN, f.posted().get(2).getType());
        assertEquals("pc-2", f.posted().get(2).getPieceId());
        assertNull(f.posted().get(2).getReason(), "a resaleable piece is not returned as damaged");
    }

    @Test
    void everyShippedUnitMustBeNamed() {
        rtoReceivedSetUp();
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> status(
                ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(back("RESALEABLE", 1)))));
        assertEquals("RTO_LINES_INCOMPLETE", code(e));
        assertThrows(InvalidRequestException.class, () -> status(ShipmentDtos.StatusRequest.builder()
                .to("RTO_RECEIVED")));
        assertTrue(f.posted().isEmpty());
        assertEquals("RTO", f.shipment().getStatus());
    }

    // ------------------------------------------------------------------ tracking, hand-over

    @Test
    void trackingIsCorrectedWhileInTransitWithAnAudit() {
        f.order().setStatus("SHIPPED");
        f.shipment("SHIPPED");
        f.shipment().setTrackingNumber("WRONG1");
        service.patch(manager, INST, "sh-1", ShipmentDtos.PatchRequest.builder().clientRequestId("patch-key-1")
                .trackingNumber("RIGHT1").build());
        assertEquals("RIGHT1", f.shipment().getTrackingNumber());
        verify(f.auditService()).record(eq(INST), eq("user-1"), eq("loc-1"), eq("TRACKING_EDITED"), eq("SHIPMENT"),
                eq("sh-1"), anyString(), anyString(), any());
        f.shipment().setStatus("DELIVERED");
        assertEquals("SHIPMENT_STATE_CHANGED", code(assertThrows(ConflictException.class, () -> service.patch(manager,
                INST, "sh-1", ShipmentDtos.PatchRequest.builder().clientRequestId("patch-key-2")
                        .trackingNumber("RIGHT2").build()))));
        assertThrows(InvalidRequestException.class, () -> service.patch(manager, INST, "sh-1",
                ShipmentDtos.PatchRequest.builder().clientRequestId("patch-key-3").build()));
    }

    @Test
    void aHandOverPacksShipsAndDeliversInOneGo() {
        service.handOverInside(f.order(), f.lines(), "user-1");
        assertEquals("DELIVERED", f.order().getStatus());
        assertEquals("DELIVERED", f.shipment().getStatus());
        assertEquals("HANDOVER", f.shipment().getCarrierCode());
        assertEquals(1, f.posted().size());
        assertEquals("SALE:shl-l1:1", f.posted().get(0).getIdempotencyKey());
        verify(f.invoiceService()).issue(eq(INST), any());
    }

    @Test
    void aHandOverOfOneOfAKindStockReservesAndSellsTheNamedPieces() {
        f.facts("ps-l1", "TRACKED", "PIECE");
        PieceRow p1 = piece("pc-1", "PC-0001", "IN_STOCK");
        PieceRow p2 = piece("pc-2", "PC-0002", "IN_STOCK");
        when(f.pieceRepository().findRow(INST, "pc-1")).thenReturn(Optional.of(p1));
        when(f.pieceRepository().findRowByCode(INST, "PC-0002")).thenReturn(Optional.of(p2));
        when(f.pieceRepository().reserveForLine(eq(INST), anyString(), eq("loc-1"), eq("l1"))).thenReturn(1);
        PieceRow r1 = piece("pc-1", "PC-0001", "RESERVED");
        PieceRow r2 = piece("pc-2", "PC-0002", "RESERVED");
        when(f.pieceRepository().findRowsByOrderLine(INST, "l1")).thenReturn(List.of(r1, r2));

        service.handOverInside(f.order(), f.lines(), Map.of("ref-l1",
                new CommerceShipmentService.PackLine(2, List.of("pc-1"), List.of("pc-0002"))), "user-1");

        verify(f.pieceRepository()).reserveForLine(INST, "pc-1", "loc-1", "l1");
        verify(f.pieceRepository()).reserveForLine(INST, "pc-2", "loc-1", "l1");
        assertEquals("DELIVERED", f.order().getStatus());
        assertEquals("HANDOVER", f.shipment().getCarrierCode());
        assertEquals(2, f.posted().size(), "one SALE row per piece");
        assertEquals("SALE:shl-l1:pc-1:1", f.posted().get(0).getIdempotencyKey());
        assertEquals("SALE:shl-l1:pc-2:1", f.posted().get(1).getIdempotencyKey());
    }

    @Test
    void aHandOverRefusesOneOfAKindStockWithoutItsPiecesAndPiecesOfALineItDoesNotHave() {
        f.facts("ps-l1", "TRACKED", "PIECE");
        assertEquals("PIECE_SCAN_REQUIRED", code(assertThrows(ConflictException.class,
                () -> service.handOverInside(f.order(), f.lines(), "user-1"))));
        assertEquals("PIECE_SCAN_REQUIRED", code(assertThrows(ConflictException.class,
                () -> service.handOverInside(f.order(), f.lines(), Map.of("ref-l1",
                        new CommerceShipmentService.PackLine(2, List.of(), List.of())), "user-1"))));
        assertThrows(InvalidRequestException.class, () -> service.handOverInside(f.order(), f.lines(),
                Map.of("ref-nope", new CommerceShipmentService.PackLine(1, List.of("pc-9"), List.of())),
                "user-1"));
        f.facts("ps-l1", "TRACKED", "QUANTITY");
        assertThrows(InvalidRequestException.class, () -> service.handOverInside(f.order(), f.lines(),
                Map.of("ref-l1", new CommerceShipmentService.PackLine(2, List.of("pc-1", "pc-2"),
                        List.of())), "user-1"));
        assertEquals("CONFIRMED", f.order().getStatus());
        verify(f.invoiceService(), never()).issue(anyString(), any());
    }
}
