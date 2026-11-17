package vacademy.io.admin_core_service.features.commerce.returns;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturnLine;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnPolicy;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnSettings;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnDueService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentLineRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.repository.CommerceShipmentRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.ORDER;

/**
 * Returns R1 to R5: create (quantities under the lock, the policy warning, the override,
 * approve-now), approve and reject, receive (stock postings, the credit note, the due and its COD
 * deferral, the lines), and when a return closes.
 */
@SuppressWarnings("unchecked")
class CommerceReturnServiceTest {

    private RefundFixture f;
    private final CommerceReturnLineRepository lineRepository = mock(CommerceReturnLineRepository.class);
    private final CommerceOrderLineRepository orderLineRepository = mock(CommerceOrderLineRepository.class);
    private final StockLocationRepository locations = mock(StockLocationRepository.class);
    private final CommerceShipmentRepository shipments = mock(CommerceShipmentRepository.class);
    private final CommerceShipmentLineRepository shipmentLines = mock(CommerceShipmentLineRepository.class);
    private final CommercePieceRepository pieces = mock(CommercePieceRepository.class);
    private final StockVariantRepository variants = mock(StockVariantRepository.class);
    private final StockLedgerService ledger = mock(StockLedgerService.class);
    private final CommerceCreditNoteService creditNotes = mock(CommerceCreditNoteService.class);
    private final CommerceCreditNoteRepository creditNoteRepository = mock(CommerceCreditNoteRepository.class);
    private final CommerceCounterService counter = mock(CommerceCounterService.class);
    private final CommerceReturnSettings settings = mock(CommerceReturnSettings.class);
    private final CommerceShipmentService shipmentService = mock(CommerceShipmentService.class);
    private CommerceReturnDueService dueService;
    private CommerceReturnService service;

    private final List<CommerceOrderLine> lines = new ArrayList<>();
    private final List<CommerceReturnLine> returnLines = new ArrayList<>();
    private final List<StockPosting> posted = new ArrayList<>();
    private final List<InvoiceLineItem> invoiceLines = new ArrayList<>();
    private final List<TaxLineResult> taxLines = new ArrayList<>();
    private final StockLocation location = new StockLocation();
    private CommerceShipment delivered;

    @BeforeEach
    void setUp() {
        f = new RefundFixture();
        dueService = new CommerceReturnDueService(f.returnRepository, f.refundRepository, f.orderRepository, f.desk);
        ObjectProvider<CommerceShipmentService> shipmentProvider = mock(ObjectProvider.class);
        when(shipmentProvider.getObject()).thenReturn(shipmentService);
        service = new CommerceReturnService(f.desk, f.service, dueService, f.returnRepository, lineRepository,
                f.refundRepository, f.orderRepository, orderLineRepository, locations, shipments, shipmentLines,
                pieces, variants, ledger, creditNotes, creditNoteRepository, counter, settings, f.requestGuard,
                f.accessGuard, f.auditService, f.events, shipmentProvider, f.clock, new ObjectMapper(),
                f.transactionManager);
        f.order.setRefundDue(BigDecimal.ZERO.setScale(2));
        f.order.setAmountPaid(new BigDecimal("5000.00"));
        f.order.setTotal(new BigDecimal("5000.00"));
        f.order.setDeliveredAt(new java.util.Date());
        when(settings.read(INST)).thenReturn(CommerceReturnPolicy.defaults());
        // No collection sets a window (MIN over no rows is null).
        lenient().when(f.returnRepository.smallestCollectionWindow(anyString(), any(Collection.class))).thenReturn(null);
        when(counter.nextNumber(INST, "RET")).thenReturn("RET-000001");
        location.setId(LOC);
        location.setStatus("ACTIVE");
        lenient().when(locations.findByInstituteIdAndId(eq(INST), anyString())).thenAnswer(call ->
                LOC.equals(call.getArgument(1)) || "loc-2".equals(call.getArgument(1)) ? Optional.of(location)
                        : Optional.empty());
        lenient().when(f.desk.freshLines(ORDER)).thenReturn(lines);
        lenient().when(orderLineRepository.findByOrderIdOrderByLineNoAsc(ORDER)).thenReturn(lines);
        lenient().when(f.orderRepository.findByIdAndInstituteId(ORDER, INST)).thenReturn(Optional.of(f.order));
        lenient().when(f.returnRepository.saveAndFlush(any(CommerceReturn.class))).thenAnswer(call -> {
            CommerceReturn r = call.getArgument(0);
            r.setId("ret-" + (f.returns.size() + 1));
            f.returns.add(r);
            return r;
        });
        lenient().when(f.returnRepository.save(any(CommerceReturn.class))).thenAnswer(call -> call.getArgument(0));
        lenient().when(f.returnRepository.findByInstituteIdAndClientRequestId(eq(INST), anyString()))
                .thenAnswer(call -> f.returns.stream().filter(r -> call.getArgument(1).equals(r.getClientRequestId()))
                        .findFirst());
        lenient().when(f.returnRepository.openQuantity(anyString())).thenAnswer(call -> returnLines.stream()
                .filter(l -> l.getOrderLineId().equals(call.getArgument(0)))
                .filter(l -> f.returns.stream().anyMatch(r -> r.getId().equals(l.getReturnId())
                        && List.of("REQUESTED", "APPROVED").contains(r.getStatus())))
                .mapToLong(CommerceReturnLine::getQuantity).sum());
        lenient().when(f.returnRepository.lockReceivedOfOrder(ORDER)).thenAnswer(call -> f.returns.stream()
                .filter(r -> "RECEIVED".equals(r.getStatus())).toList());
        lenient().when(f.returnRepository.findByOrderIdOrderByCreatedAtAsc(ORDER)).thenAnswer(call -> f.returns);
        lenient().when(lineRepository.save(any(CommerceReturnLine.class))).thenAnswer(call -> {
            CommerceReturnLine l = call.getArgument(0);
            if (l.getId() == null) {
                l.setId("rl-" + l.getOrderLineId());
                returnLines.add(l);
            }
            return l;
        });
        lenient().when(lineRepository.findByReturnIdOrderByCreatedAtAscIdAsc(anyString())).thenAnswer(call ->
                returnLines.stream().filter(l -> l.getReturnId().equals(call.getArgument(0))).toList());
        lenient().when(ledger.postAll(anyList())).thenAnswer(call -> {
            posted.addAll(call.getArgument(0));
            return List.of();
        });
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        lenient().when(f.desk.liveInvoice(any(), anyList())).thenReturn(invoice);
        lenient().when(f.desk.invoiceLines("inv-1")).thenReturn(invoiceLines);
        lenient().when(f.desk.placementTax(any())).thenAnswer(call -> TaxResult.builder()
                .taxHead(TaxHead.CGST_SGST).lines(taxLines).build());
        lenient().when(creditNotes.issue(eq(INST), any(), any())).thenAnswer(call -> {
            CreditNoteRequest asked = call.getArgument(2);
            List<CreditNoteLineDTO> out = new ArrayList<>();
            BigDecimal total = BigDecimal.ZERO.setScale(2);
            for (CreditNoteLineRequest l : asked.getLines()) {
                InvoiceLineItem item = invoiceLines.stream().filter(i -> i.getId().equals(l.getInvoiceLineItemId()))
                        .findFirst().orElseThrow();
                BigDecimal amount = item.getAmount().multiply(BigDecimal.valueOf(l.getQuantity()))
                        .divide(BigDecimal.valueOf(item.getQuantity()), 2, RoundingMode.HALF_UP);
                out.add(CreditNoteLineDTO.builder().id("cnl-" + item.getId()).invoiceLineItemId(item.getId())
                        .quantity(l.getQuantity()).amount(amount).build());
                total = total.add(amount);
            }
            return CreditNoteDTO.builder().id("cn-1").invoiceId("inv-1").total(total).lines(out).build();
        });
        delivered = new CommerceShipment();
        delivered.setId("sh-1");
        delivered.setStatus("DELIVERED");
        delivered.setShipCount(1);
        delivered.setDeliveredOn(f.today.minusDays(2));
        lenient().when(shipments.findByOrderIdOrderByCreatedAtAsc(ORDER)).thenReturn(List.of(delivered));
    }

    /** An item line shipped in full, its invoice line and its placement tax line (5 %). */
    private CommerceOrderLine line(String id, int quantity, String total) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setInstituteId(INST);
        line.setOrderId(ORDER);
        line.setLineNo(lines.size() + 1);
        line.setLineType(CommerceOrderLine.TYPE_ITEM);
        line.setLineRef("ref-" + id);
        line.setPackageSessionId("ps-" + id);
        line.setPackageId("pkg-" + id);
        line.setQuantity(quantity);
        line.setQtyShipped(quantity);
        line.setLineTotal(new BigDecimal(total));
        line.setCostTotal(new BigDecimal("100.00").multiply(BigDecimal.valueOf(quantity)));
        lines.add(line);
        InvoiceLineItem item = new InvoiceLineItem();
        item.setId("il-" + id);
        item.setSourceId(line.getLineRef());
        item.setQuantity(quantity);
        item.setAmount(new BigDecimal(total));
        invoiceLines.add(item);
        taxLines.add(TaxLineResult.builder().lineRef(line.getLineRef()).lineType(TaxLineType.ITEM).quantity(quantity)
                .qtyScale(1).net(new BigDecimal(total)).gross(new BigDecimal(total)).build());
        tracked(line, "QUANTITY");
        CommerceShipmentLine shipped = new CommerceShipmentLine();
        shipped.setId("shl-" + id);
        shipped.setOrderLineId(id);
        shipped.setQuantity(quantity);
        List<CommerceShipmentLine> all = new ArrayList<>(shipmentLinesOf());
        all.add(shipped);
        lenient().when(shipmentLines.findByShipmentIdOrderByCreatedAtAscIdAsc("sh-1")).thenReturn(all);
        return line;
    }

    private List<CommerceShipmentLine> shipmentLinesOf() {
        List<CommerceShipmentLine> current = shipmentLines.findByShipmentIdOrderByCreatedAtAscIdAsc("sh-1");
        return current == null ? List.of() : current;
    }

    private void tracked(CommerceOrderLine line, String mode) {
        StockVariantRepository.VariantFacts facts = mock(StockVariantRepository.VariantFacts.class);
        lenient().when(facts.getStockPolicy()).thenReturn("TRACKED");
        lenient().when(facts.getStockMode()).thenReturn(mode);
        lenient().when(variants.findFacts(INST, line.getPackageSessionId())).thenReturn(Optional.of(facts));
    }

    private ReturnDtos.CreateReturnRequest.CreateReturnRequestBuilder create(String lineId, int quantity) {
        return ReturnDtos.CreateReturnRequest.builder().clientRequestId("return-key-" + (f.returns.size() + 1))
                .orderId(ORDER).reason("DEFECTIVE")
                .lines(List.of(ReturnDtos.LineRequest.builder().orderLineId(lineId).quantity(quantity).build()));
    }

    private ReturnDtos.ReturnView created(ReturnDtos.CreateReturnRequest.CreateReturnRequestBuilder b) {
        return service.create(RefundFixture.manager(), INST, b.build());
    }

    private ReturnDtos.ReceiveLine named(String lineId, String condition, int quantity, String... pieceIds) {
        return ReturnDtos.ReceiveLine.builder().orderLineId(lineId).condition(condition).quantity(quantity)
                .pieceIds(pieceIds.length == 0 ? null : List.of(pieceIds)).build();
    }

    private ReturnDtos.ReturnView receive(String returnId, ReturnDtos.ReceiveLine... named) {
        return service.receive(RefundFixture.manager(), INST, returnId, ReturnDtos.ReceiveRequest.builder()
                .clientRequestId("receive-key-1").fromStatus("APPROVED").lines(List.of(named)).build());
    }

    // ------------------------------------------------------------------ R1

    @Test
    void r1_aDeliveredPaidOrderGetsAReturnRequestedWithItsNumberAndAudit() {
        line("l1", 2, "1050.00");
        ReturnDtos.ReturnView view = created(create("l1", 1));
        assertEquals("REQUESTED", view.getStatus());
        CommerceReturn ret = f.returns.get(0);
        assertEquals("RET-000001", ret.getReturnNumber());
        assertEquals(LOC, ret.getLocationId(), "the order's location by default");
        assertEquals("PHONE", ret.getRequestedVia());
        assertEquals(1, returnLines.get(0).getQuantity());
        verify(f.desk).lockOrder(INST, ORDER);
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("RETURN_CREATED"), eq("RETURN"),
                eq(ret.getId()), any(), any(), any());
    }

    @Test
    void r1_onlyADeliveredPaidOrderNotSoldAtTheCounterIsReturned() {
        line("l1", 2, "1050.00");
        f.order.setStatus("SHIPPED");
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1))).getMessage()
                .startsWith("ORDER_NOT_RETURNABLE"));
        f.order.setStatus("DELIVERED");
        f.order.setChannel("POS");
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1))).getMessage()
                .startsWith("ORDER_NOT_RETURNABLE"));
        f.order.setChannel("ADMIN");
        f.order.setPaymentStatus("PARTIALLY_PAID");
        f.order.setPaymentMethod("OFFLINE");
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1))).getMessage()
                .startsWith("ORDER_NOT_PAID"));
        // A COD order waiting for its remittance may be returned.
        f.order.setPaymentMethod("COD");
        f.order.setPaymentStatus("UNPAID");
        assertEquals("REQUESTED", created(create("l1", 1)).getStatus());
    }

    @Test
    void r1_theOpenQuantityCountsReturnsStillOpenAndUnitsAlreadyBack() {
        CommerceOrderLine l1 = line("l1", 3, "1500.00");
        created(create("l1", 2));
        ConflictException e = assertThrows(ConflictException.class, () -> created(create("l1", 2)));
        assertTrue(e.getMessage().startsWith("RETURN_QTY_EXCEEDED"), e.getMessage());
        l1.setQtyReturned(1);
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1))).getMessage()
                .startsWith("RETURN_QTY_EXCEEDED"));
        // A rejected return frees its units.
        f.returns.get(0).setStatus("REJECTED");
        assertEquals("REQUESTED", created(create("l1", 2)).getStatus());
        assertThrows(InvalidRequestException.class, () -> created(create("not-a-line", 1)));
    }

    @Test
    void r1_aWarningRefusesWithNothingWrittenAndAnOverrideIsAudited() {
        line("l1", 2, "1050.00");
        ConflictException e = assertThrows(ConflictException.class, () -> created(create("l1", 1)
                .reason("CHANGED_MIND")));
        assertTrue(e.getMessage().startsWith("RETURN_POLICY_WARNING: REASON_NOT_ALLOWED"), e.getMessage());
        assertTrue(f.returns.isEmpty());
        assertTrue(returnLines.isEmpty());
        delivered.setDeliveredOn(f.today.minusDays(8));
        e = assertThrows(ConflictException.class, () -> created(create("l1", 1)));
        assertTrue(e.getMessage().contains("OUTSIDE_WINDOW"));

        ReturnDtos.ReturnView view = created(create("l1", 1).reason("CHANGED_MIND")
                .overrideReason("Loyal buyer, manager agreed"));
        assertEquals(List.of("OUTSIDE_WINDOW", "REASON_NOT_ALLOWED"), view.getPolicyWarnings());
        verify(f.auditService).record(eq(INST), any(), any(), eq("RETURN_POLICY_OVERRIDE"), eq("RETURN"), any(),
                any(), any(), eq("Loyal buyer, manager agreed"));
    }

    @Test
    void r1_theStrictestCollectionWindowApplies() {
        line("l1", 2, "1050.00");
        when(f.returnRepository.smallestCollectionWindow(eq(INST), any(Collection.class))).thenReturn(1);
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1))).getMessage()
                .contains("OUTSIDE_WINDOW"));
    }

    @Test
    void r1_anInactiveOrForeignLocationIsRefused() {
        line("l1", 2, "1050.00");
        location.setStatus("INACTIVE");
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1))).getMessage()
                .startsWith("LOCATION_INACTIVE"));
        location.setStatus("ACTIVE");
        assertTrue(assertThrows(ConflictException.class, () -> created(create("l1", 1).locationId("loc-x")))
                .getMessage().startsWith("LOCATION_INACTIVE"));
    }

    @Test
    void r1_aCallerRefusedByTheGuardWritesNothing() {
        line("l1", 2, "1050.00");
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, "no"))
                .when(f.desk).authorize(any(), eq(INST), eq(LOC), any());
        assertThrows(CommerceAccessDeniedException.class, () -> created(create("l1", 1)));
        assertTrue(f.returns.isEmpty());
        verify(counter, never()).nextNumber(anyString(), anyString());
    }

    @Test
    void r1_approveNowApprovesInTheSameTransaction() {
        line("l1", 2, "1050.00");
        ReturnDtos.ReturnView view = created(create("l1", 1).approveNow(true));
        assertEquals("APPROVED", view.getStatus());
        assertTrue(f.eventTypes.contains(CommerceOrderEvents.RETURN_APPROVED));
    }

    // ------------------------------------------------------------------ R2, R3

    @Test
    void r2_r3_approveAndRejectCompareTheStatusTheClientSaw() {
        line("l1", 2, "1050.00");
        String id = created(create("l1", 1)).getId();
        ConflictException stale = assertThrows(ConflictException.class, () -> service.approve(RefundFixture.manager(),
                INST, id, ReturnDtos.ApproveRequest.builder().clientRequestId("approve-key-1").fromStatus("APPROVED")
                        .build()));
        assertTrue(stale.getMessage().startsWith("RETURN_STATE_CHANGED"));
        assertEquals("APPROVED", service.approve(RefundFixture.manager(), INST, id, ReturnDtos.ApproveRequest.builder()
                .clientRequestId("approve-key-2").fromStatus("REQUESTED").build()).getStatus());
        assertThrows(InvalidRequestException.class, () -> service.reject(RefundFixture.manager(), INST, id,
                ReturnDtos.RejectRequest.builder().clientRequestId("reject-key-1").fromStatus("APPROVED").build()));
        ReturnDtos.ReturnView rejected = service.reject(RefundFixture.manager(), INST, id, ReturnDtos.RejectRequest
                .builder().clientRequestId("reject-key-2").fromStatus("APPROVED").reason("Not bought here").build());
        assertEquals("REJECTED", rejected.getStatus());
        assertEquals("Not bought here", rejected.getRejectReason());
    }

    // ------------------------------------------------------------------ R4

    private String approved(String lineId, int quantity) {
        String id = created(create(lineId, quantity).approveNow(true)).getId();
        return id;
    }

    @Test
    void r4_aQuantityLineComesBackPartResaleablePartDamagedAtTheSaleCost() {
        line("l1", 2, "1050.00");
        StockMovement sale = new StockMovement();
        sale.setReferenceId("shl-l1");
        sale.setUnitCost(new BigDecimal("95.00"));
        when(f.desk.currentSales(eq(INST), eq(delivered), anyList())).thenReturn(List.of(sale));
        String id = approved("l1", 2);
        f.order.setRefundDue(BigDecimal.ZERO.setScale(2));

        ReturnDtos.ReturnView view = receive(id, named("l1", "RESALEABLE", 1), named("l1", "DAMAGED", 1));

        CommerceReturnLine rl = returnLines.get(0);
        assertEquals(2, posted.size());
        StockPosting back = posted.get(0);
        assertEquals("RETURN", back.getType().name());
        assertEquals(2, back.getQuantityDelta());
        assertEquals("RET:" + rl.getId(), back.getIdempotencyKey());
        assertEquals("RETURN_LINE", back.getReferenceType());
        assertEquals(rl.getId(), back.getReferenceId());
        assertEquals(new BigDecimal("95.00"), back.getUnitCost());
        assertEquals(StockPosting.CostTreatment.KNOWN, back.getCostTreatment());
        StockPosting damage = posted.get(1);
        assertEquals("DAMAGE", damage.getType().name());
        assertEquals(-1, damage.getQuantityDelta());
        assertEquals("RETURN_DAMAGED", damage.getReason());
        assertEquals("RET_DMG:" + rl.getId(), damage.getIdempotencyKey());
        assertEquals(1, rl.getQtyResaleable());
        assertEquals(1, rl.getQtyDamaged());

        ArgumentCaptor<CreditNoteRequest> note = ArgumentCaptor.forClass(CreditNoteRequest.class);
        verify(creditNotes).issue(eq(INST), eq("user-1"), note.capture());
        assertEquals("RET:" + id, note.getValue().getClientRequestId());
        assertEquals(id, note.getValue().getReturnId());
        assertEquals(Boolean.FALSE, note.getValue().getFull());
        assertEquals(2, note.getValue().getLines().get(0).getQuantity());
        assertEquals("RECEIVED", view.getStatus());
        assertEquals(0, new BigDecimal("1050.00").compareTo(view.getCreditTotal()));
        assertEquals(0, new BigDecimal("1050.00").compareTo(view.getDueRaised()));
        assertEquals(0, new BigDecimal("1050.00").compareTo(f.order.getRefundDue()));
        verify(f.desk).raiseRefundDue(eq(f.order), any(), eq("RET:" + id), any());
        assertEquals(2, lines.get(0).getQtyReturned());
        assertEquals(0, new BigDecimal("1050.00").compareTo(lines.get(0).getReturnedValue()));
        assertEquals(0, new BigDecimal("200.00").compareTo(rl.getCostTotal()));
        ArgumentCaptor<Map<String, BigDecimal>> costs = ArgumentCaptor.forClass(Map.class);
        verify(f.desk).setCreditCosts(eq(INST), any(), costs.capture());
        assertEquals(0, new BigDecimal("200.00").compareTo(costs.getValue().get("il-l1")));
        verify(shipmentService).requirePeriodOpen(INST);
    }

    @Test
    void r4_withoutAKnownSaleCostTheLedgerTakesItsAverage() {
        line("l1", 2, "1050.00");
        when(f.desk.currentSales(any(), any(), anyList())).thenReturn(List.of());
        String id = approved("l1", 1);
        receive(id, named("l1", "RESALEABLE", 1));
        assertNull(posted.get(0).getUnitCost());
        assertNull(posted.get(0).getCostTreatment());
        assertEquals(0, new BigDecimal("100.00").compareTo(returnLines.get(0).getCostTotal()),
                "the order line's cost for 1 of 2 units");
    }

    @Test
    void r4_aSetLineIsCreditedByItsOwnPerUnitCountsWhateverTheRowOrder() {
        CommerceOrderLine set = line("set", 2, "2000.00");
        // The set has two parts per unit: A (1 per unit) and B (2 per unit); the invoice rows come B first.
        invoiceLines.clear();
        taxLines.clear();
        InvoiceLineItem b = new InvoiceLineItem();
        b.setId("il-b");
        b.setSourceId(set.getLineRef());
        b.setQuantity(4);
        b.setAmount(new BigDecimal("1200.00"));
        InvoiceLineItem a = new InvoiceLineItem();
        a.setId("il-a");
        a.setSourceId(set.getLineRef());
        a.setQuantity(2);
        a.setAmount(new BigDecimal("800.00"));
        invoiceLines.add(b);
        invoiceLines.add(a);
        taxLines.add(TaxLineResult.builder().lineRef(set.getLineRef()).componentRef("A").lineType(TaxLineType.ITEM)
                .quantity(2).qtyScale(1).net(new BigDecimal("800.00")).build());
        taxLines.add(TaxLineResult.builder().lineRef(set.getLineRef()).componentRef("B").lineType(TaxLineType.ITEM)
                .quantity(4).qtyScale(1).net(new BigDecimal("1200.00")).build());
        String id = approved("set", 1);
        receive(id, named("set", "RESALEABLE", 1));
        ArgumentCaptor<CreditNoteRequest> note = ArgumentCaptor.forClass(CreditNoteRequest.class);
        verify(creditNotes).issue(eq(INST), any(), note.capture());
        Map<String, Integer> quantities = new java.util.HashMap<>();
        note.getValue().getLines().forEach(l -> quantities.put(l.getInvoiceLineItemId(), l.getQuantity()));
        assertEquals(Map.of("il-b", 2, "il-a", 1), quantities);
        // 1 of 2 units: cost 100.00, shared by credited amount (600 : 400), the last row takes the rest.
        ArgumentCaptor<Map<String, BigDecimal>> costs = ArgumentCaptor.forClass(Map.class);
        verify(f.desk).setCreditCosts(eq(INST), any(), costs.capture());
        assertEquals(0, new BigDecimal("60.00").compareTo(costs.getValue().get("il-b")));
        assertEquals(0, new BigDecimal("40.00").compareTo(costs.getValue().get("il-a")));
    }

    @Test
    void r4_piecesComeBackByIdAndADamagedPieceIsWrittenOff() {
        CommerceOrderLine piece = line("p1", 2, "1400.00");
        tracked(piece, "PIECE");
        CommercePieceRepository.PieceRow a = pieceRow("pc-a", "SOLD");
        CommercePieceRepository.PieceRow b = pieceRow("pc-b", "SOLD");
        when(pieces.findRowsByOrderLine(INST, "p1")).thenReturn(List.of(a, b));
        String id = approved("p1", 2);
        receive(id, named("p1", "RESALEABLE", 1, "pc-a"), named("p1", "DAMAGED", 1, "pc-b"));
        String rl = returnLines.get(0).getId();
        assertEquals(List.of("RET:" + rl + ":pc-a", "RET:" + rl + ":pc-b", "RET_DMG:" + rl + ":pc-b"),
                posted.stream().map(StockPosting::getIdempotencyKey).toList());
        assertEquals(List.of("RETURN", "RETURN", "DAMAGE"), posted.stream().map(p -> p.getType().name()).toList());
        assertNull(posted.get(1).getReason(), "a RETURN never carries the damage reason");
        assertEquals("RETURN_DAMAGED", posted.get(2).getReason());
    }

    @Test
    void r4_piecesMustBeTheLinesSoldPiecesOneForEachUnit() {
        CommerceOrderLine piece = line("p1", 2, "1400.00");
        tracked(piece, "PIECE");
        CommercePieceRepository.PieceRow a = pieceRow("pc-a", "SOLD");
        CommercePieceRepository.PieceRow b = pieceRow("pc-b", "IN_STOCK");
        when(pieces.findRowsByOrderLine(INST, "p1")).thenReturn(List.of(a, b));
        String id = approved("p1", 2);
        InvalidRequestException missing = assertThrows(InvalidRequestException.class, () -> receive(id,
                named("p1", "RESALEABLE", 2, "pc-a")));
        assertTrue(missing.getMessage().startsWith("RETURN_LINES_INCOMPLETE"));
        assertTrue(assertThrows(InvalidRequestException.class, () -> receive(id,
                named("p1", "RESALEABLE", 2, "pc-a", "pc-zz"))).getMessage().startsWith("RETURN_LINES_INCOMPLETE"));
        ConflictException state = assertThrows(ConflictException.class, () -> receive(id,
                named("p1", "RESALEABLE", 2, "pc-a", "pc-b")));
        assertTrue(state.getMessage().startsWith("PIECE_STATE"));
        assertTrue(posted.isEmpty());
    }

    @Test
    void r4_everyUnitIsNamedTheInvoiceExistsAndTheOrderIsStillDelivered() {
        line("l1", 2, "1050.00");
        String id = approved("l1", 2);
        assertTrue(assertThrows(InvalidRequestException.class, () -> receive(id, named("l1", "RESALEABLE", 1)))
                .getMessage().startsWith("RETURN_LINES_INCOMPLETE"));
        assertThrows(InvalidRequestException.class, () -> receive(id, named("l1", "RESALEABLE", 1),
                named("l1", "RESALEABLE", 1)));
        when(f.desk.liveInvoice(any(), anyList())).thenReturn(null);
        assertTrue(assertThrows(ConflictException.class, () -> receive(id, named("l1", "RESALEABLE", 2)))
                .getMessage().startsWith("INVOICE_MISSING"));
        f.order.setStatus("RTO");
        assertTrue(assertThrows(ConflictException.class, () -> receive(id, named("l1", "RESALEABLE", 2)))
                .getMessage().startsWith("ORDER_STATE_CHANGED"));
        assertTrue(posted.isEmpty());
        verify(creditNotes, never()).issue(anyString(), any(), any());
    }

    @Test
    void r4_theGoodsMayArriveAtAnotherLocation() {
        line("l1", 2, "1050.00");
        String id = approved("l1", 1);
        service.receive(RefundFixture.manager(), INST, id, ReturnDtos.ReceiveRequest.builder()
                .clientRequestId("receive-key-1").fromStatus("APPROVED").locationId("loc-2")
                .lines(List.of(named("l1", "RESALEABLE", 1))).build());
        assertEquals("loc-2", posted.get(0).getLocationId());
        assertEquals("loc-2", f.returns.get(0).getLocationId());
        verify(f.desk).authorize(any(), eq(INST), eq("loc-2"), any());
    }

    // ------------------------------------------------------------------ money and R5

    @Test
    void aCodReturnBeforeRemittanceRaisesNothingUntilTheRemittance() {
        line("l1", 2, "1050.00");
        f.order.setPaymentMethod("COD");
        f.order.setPaymentStatus("UNPAID");
        f.order.setAmountPaid(BigDecimal.ZERO.setScale(2));
        String id = approved("l1", 1);
        ReturnDtos.ReturnView view = receive(id, named("l1", "RESALEABLE", 1));
        assertEquals("RECEIVED", view.getStatus(), "it waits for the money");
        assertEquals(0, BigDecimal.ZERO.compareTo(view.getDueRaised()));
        assertEquals(0, BigDecimal.ZERO.compareTo(f.order.getRefundDue()));

        // The courier pays: the remittance marks the order paid, then the return's credit is due.
        f.order.setPaymentStatus("PAID");
        f.order.setCodRemittanceId("rem-1");
        f.order.setAmountPaid(new BigDecimal("1050.00"));
        dueService.raiseDeferred(f.order);
        CommerceReturn ret = f.returns.get(0);
        assertEquals(0, new BigDecimal("525.00").compareTo(ret.getDueRaised()));
        assertEquals(0, new BigDecimal("525.00").compareTo(f.order.getRefundDue()));
        verify(f.desk).raiseRefundDue(eq(f.order), any(), eq("RET:" + id + ":R"), any());
        dueService.raiseDeferred(f.order);
        assertEquals(0, new BigDecimal("525.00").compareTo(f.order.getRefundDue()), "raised once");
    }

    @Test
    void r5_aReturnClosesWhenItsRefundsReachWhatItRaised() {
        line("l1", 2, "1050.00");
        String id = approved("l1", 1);
        receive(id, named("l1", "RESALEABLE", 1));
        CommerceReturn ret = f.returns.get(0);
        assertEquals(0, dueService.closeReady(f.order));
        CommerceRefund refund = new CommerceRefund();
        refund.setId("rf-1");
        refund.setReturnId(id);
        refund.setStatus("PROCESSED");
        refund.setAmount(new BigDecimal("525.00"));
        refund.setMethod("CASH");
        f.refunds.add(refund);
        assertEquals(1, dueService.closeReady(f.order));
        assertEquals("CLOSED", ret.getStatus());
    }

    @Test
    void r5_aReturnWorthNothingClosesAtOnce() {
        CommerceOrderLine free = line("free", 1, "0.00");
        free.setCostTotal(null);
        invoiceLines.clear();
        String id = approved("free", 1);
        ReturnDtos.ReturnView view = receive(id, named("free", "RESALEABLE", 1));
        assertEquals("CLOSED", view.getStatus());
        verify(creditNotes, never()).issue(anyString(), any(), any());
    }

    @Test
    void anotherInstitutesReturnIsNotFound() {
        assertThrows(vacademy.io.common.exceptions.VacademyException.class, () -> service.get(
                RefundFixture.manager(), INST, "ret-of-someone-else"));
    }

    private static CommercePieceRepository.PieceRow pieceRow(String id, String status) {
        CommercePieceRepository.PieceRow row = mock(CommercePieceRepository.PieceRow.class);
        lenient().when(row.getId()).thenReturn(id);
        lenient().when(row.getStatus()).thenReturn(status);
        lenient().when(row.getCode()).thenReturn("CODE-" + id);
        return row;
    }

    // ------------------------------------------------------------------ buyer messages (WP-33)

    private java.util.List<String> refsOf(String type) {
        java.util.List<String> refs = new java.util.ArrayList<>();
        for (int i = 0; i < f.eventTypes.size(); i++) {
            if (type.equals(f.eventTypes.get(i))) {
                refs.add(f.eventRefs.get(i));
            }
        }
        return refs;
    }

    @Test
    void anApprovedReturnTellsTheBuyerWithTheReturnIdAsTheRef() {
        line("l1", 2, "1050.00");
        ReturnDtos.ReturnView now = created(create("l1", 1).approveNow(true));
        assertEquals(java.util.List.of(now.getId()), refsOf(CommerceOrderEvents.RETURN_APPROVED));

        String later = created(create("l1", 1)).getId();
        assertEquals(1, refsOf(CommerceOrderEvents.RETURN_APPROVED).size(), "a requested return tells nothing yet");
        service.approve(RefundFixture.manager(), INST, later, ReturnDtos.ApproveRequest.builder()
                .clientRequestId("approve-key-9").fromStatus("REQUESTED").build());
        assertEquals(java.util.List.of(now.getId(), later), refsOf(CommerceOrderEvents.RETURN_APPROVED));

        org.mockito.ArgumentCaptor<CommerceOrderEvents.OrderEvent> published = org.mockito.ArgumentCaptor.forClass(
                CommerceOrderEvents.OrderEvent.class);
        verify(f.events, org.mockito.Mockito.atLeast(0)).afterCommit(published.capture());
        java.util.List<String> publishedRefs = published.getAllValues().stream()
                .filter(e -> CommerceOrderEvents.RETURN_APPROVED.equals(e.type()))
                .map(CommerceOrderEvents.OrderEvent::refId).toList();
        assertEquals(java.util.List.of(now.getId(), later), publishedRefs);
    }
}
