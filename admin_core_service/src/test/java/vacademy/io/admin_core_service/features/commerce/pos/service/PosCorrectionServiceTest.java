package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The void and the tender change: a cashier is asked for a PIN before anything is written; the
 * void puts back exactly the bill's POS_SALE movements, voids the tenders, cancels the plans,
 * lines, order and document (its number kept), and is refused once the session closed, after a
 * return, or on an exchange bill.
 */
class PosCorrectionServiceTest {

    private static final String INST = "inst-1";
    private static final String ORDER = "order-1";
    private static final String LOC = "loc-1";
    private static final String KEY = "void-key-0001";

    private final PosAccess access = mock(PosAccess.class);
    private final PosReceiptService receipts = mock(PosReceiptService.class);
    private final PosSessionRepository sessions = mock(PosSessionRepository.class);
    private final PosReadRepository reads = mock(PosReadRepository.class);
    private final CommerceOrderDeskService desk = mock(CommerceOrderDeskService.class);
    private final CommerceOrderWriter writer = mock(CommerceOrderWriter.class);
    private final CommerceOrderRepository orders = mock(CommerceOrderRepository.class);
    private final CommerceOrderLineRepository lineRepository = mock(CommerceOrderLineRepository.class);
    private final CommerceOrderTenderRepository tenderRepository = mock(CommerceOrderTenderRepository.class);
    private final CommerceOrderLegacyRepository legacy = mock(CommerceOrderLegacyRepository.class);
    private final CommerceOrderEvents events = mock(CommerceOrderEvents.class);
    private final StockMovementRepository movements = mock(StockMovementRepository.class);
    private final StockLedgerService ledger = mock(StockLedgerService.class);
    private final CommercePieceRepository pieces = mock(CommercePieceRepository.class);
    private final CommerceReturnRepository returns = mock(CommerceReturnRepository.class);
    private final CommerceInvoiceService invoices = mock(CommerceInvoiceService.class);
    private final CommerceApprovalService approvals = mock(CommerceApprovalService.class);
    private final CommerceAuditService audit = mock(CommerceAuditService.class);
    private final CommerceRequestGuard guard = mock(CommerceRequestGuard.class);
    private PosCorrectionService service;

    private final CommerceOrder order = new CommerceOrder();
    private final PosSession session = new PosSession();
    private final List<CommerceOrderLine> lines = new ArrayList<>();
    private final List<CommerceOrderTender> tenders = new ArrayList<>();
    private final List<StockMovement> sales = new ArrayList<>();

    @BeforeEach
    void setUp() {
        service = new PosCorrectionService(access, receipts, sessions, reads, desk, writer, orders, lineRepository,
                tenderRepository, legacy, events, movements, ledger, pieces, returns, invoices, approvals, audit,
                guard);
        order.setId(ORDER);
        order.setInstituteId(INST);
        order.setChannel("POS");
        order.setStatus("DELIVERED");
        order.setOrderNumber("ORD-000101");
        order.setTotal(new BigDecimal("1350.00"));
        order.setAmountPaid(new BigDecimal("1350.00"));
        order.setPaymentStatus("PAID");
        order.setFulfilmentLocationId(LOC);
        order.setPosSessionId("s-1");
        session.setId("s-1");
        session.setStatus("OPEN");
        session.setCashierUserId("cashier-1");
        lenient().when(receipts.readPosOrder(INST, ORDER)).thenReturn(order);
        lenient().when(desk.lockOrder(INST, ORDER)).thenReturn(order);
        lenient().when(sessions.lockForShare(INST, "s-1")).thenReturn(Optional.of(session));
        lenient().when(desk.freshLines(ORDER)).thenReturn(lines);
        lenient().when(returns.findByOrderIdOrderByCreatedAtAsc(ORDER)).thenReturn(new ArrayList<>());
        lenient().when(tenderRepository.findByOrderIdOrderByCreatedAtAsc(ORDER)).thenReturn(tenders);
        lenient().when(movements.findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(eq(INST),
                eq("ORDER_LINE"), anyCollection())).thenReturn(sales);
        lenient().when(pieces.unlinkFromLine(anyString(), anyString(), anyString())).thenReturn(1);
        lenient().when(orders.save(any(CommerceOrder.class))).thenAnswer(call -> call.getArgument(0));
        lenient().when(reads.invoicesOf(eq(INST), anyCollection())).thenReturn(List.of(
                new PosReadRepository.InvoiceFact("inv-1", ORDER, "R1/0007", null, false, null)));
    }

    private static CustomUserDetails user(String id, String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        lenient().when(user.getUserId()).thenReturn(id);
        List<GrantedAuthority> granted = new ArrayList<>();
        for (String a : authorities) {
            granted.add(new SimpleGrantedAuthority(a));
        }
        lenient().when(user.getAuthorities()).thenAnswer(call -> granted);
        return user;
    }

    private CommerceOrderLine line(String id, int quantity, String userPlanId) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setOrderId(ORDER);
        line.setLineType(CommerceOrderLine.TYPE_ITEM);
        line.setQuantity(quantity);
        line.setQtyShipped(quantity);
        line.setUserPlanId(userPlanId);
        lines.add(line);
        return line;
    }

    private StockMovement sale(String id, String lineId, int delta, String pieceId) {
        StockMovement m = new StockMovement();
        m.setId(id);
        m.setInstituteId(INST);
        m.setLocationId(LOC);
        m.setPackageSessionId("ps-" + lineId);
        m.setPieceId(pieceId);
        m.setType("POS_SALE");
        m.setQuantityDelta(delta);
        m.setReferenceType("ORDER_LINE");
        m.setReferenceId(lineId);
        sales.add(m);
        return m;
    }

    private CommerceOrderTender tender(String id, String mode, String amount, String status) {
        CommerceOrderTender t = new CommerceOrderTender();
        t.setId(id);
        t.setOrderId(ORDER);
        t.setMode(mode);
        t.setAmount(new BigDecimal(amount));
        t.setStatus(status);
        t.setPosSessionId("s-1");
        tenders.add(t);
        return t;
    }

    private static PosDtos.Approval pin() {
        return new PosDtos.Approval("manager-1", "4321", null);
    }

    // ================================================================== the PIN comes first

    @Test
    void aCashierIsAskedForAPinBeforeAnythingIsWritten() {
        CustomUserDetails cashier = user("cashier-1", "COMMERCE_POS_CASHIER");
        ConflictException v = assertThrows(ConflictException.class, () -> service.voidSale(cashier, INST, ORDER,
                new PosDtos.VoidRequest(KEY, "Wrong item keyed", null)));
        assertTrue(v.getMessage().startsWith("APPROVAL_REQUIRED: POS_VOID"), v.getMessage());
        ConflictException t = assertThrows(ConflictException.class, () -> service.changeTender(cashier, INST, ORDER,
                "t-1", new PosDtos.TenderChangeRequest(KEY, "UPI", "UPI 4411", null)));
        assertTrue(t.getMessage().startsWith("APPROVAL_REQUIRED: POS_TENDER_CHANGE"), t.getMessage());
        verify(guard, never()).run(any(), any(), any());
        verify(access, org.mockito.Mockito.times(2)).requireAt(cashier, INST, PosAccess.TILL, LOC);
    }

    @Test
    void aVoidedBillAnswersARepeatWithoutAPin() {
        order.setStatus("CANCELLED");
        order.setCancelReason("POS_VOID");
        CustomUserDetails cashier = user("cashier-1", "COMMERCE_POS_CASHIER");
        when(guard.run(any(), any(), any())).thenAnswer(call -> new CommerceRequestGuard.Outcome<>(
                ((java.util.function.Supplier<?>) call.getArgument(1)).get(), false));
        service.voidSale(cashier, INST, ORDER, new PosDtos.VoidRequest(KEY, "Wrong item keyed", null));
        verify(ledger, never()).postAll(anyList());
        verify(approvals, never()).approve(any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void theBodiesAreChecked() {
        CustomUserDetails manager = user("manager-1", "COMMERCE_STORE_MANAGER");
        assertTrue(assertThrows(InvalidRequestException.class, () -> service.voidSale(manager, INST, ORDER,
                new PosDtos.VoidRequest(KEY, " ", null))).getMessage().startsWith("VALIDATION"));
        assertTrue(assertThrows(InvalidRequestException.class, () -> service.voidSale(manager, INST, ORDER,
                new PosDtos.VoidRequest("short", "Wrong item", null))).getMessage().startsWith("VALIDATION"));
        for (String mode : List.of("CREDIT_NOTE", "GATEWAY", "COD", "nonsense")) {
            assertTrue(assertThrows(InvalidRequestException.class, () -> service.changeTender(manager, INST, ORDER,
                    "t-1", new PosDtos.TenderChangeRequest(KEY, mode, "R1", null))).getMessage()
                    .startsWith("VALIDATION"), mode);
        }
        assertThrows(InvalidRequestException.class, () -> service.changeTender(manager, INST, ORDER, "t-1",
                new PosDtos.TenderChangeRequest(KEY, "UPI", null, null)));
        assertThrows(InvalidRequestException.class, () -> service.changeTender(manager, INST, ORDER, "t-1",
                new PosDtos.TenderChangeRequest(KEY, "CARD", "ref<script>", null)));
        verify(guard, never()).run(any(), any(), any());
    }

    @Test
    void theRequestHashIgnoresThePin() {
        assertEquals(CommerceRequestGuard.hash("POS_VOID", new PosDtos.VoidRequest(KEY, "x", pin()).withoutApproval(),
                        ORDER),
                CommerceRequestGuard.hash("POS_VOID", new PosDtos.VoidRequest(KEY, "x", null).withoutApproval(), ORDER));
    }

    // ================================================================== the void

    @Test
    void theVoidPutsBackExactlyTheBillsCounterSalesAndCancelsEverything() {
        CommerceOrderLine bottle = line("l-1", 2, "plan-1");
        CommerceOrderLine scarf = line("l-2", 1, "plan-2");
        scarf.setPieceId("piece-1");
        sale("m-1", "l-1", -2, null);
        sale("m-2", "l-2", -1, "piece-1");
        StockMovement already = sale("m-3", "l-1", 2, null);
        already.setReversesMovementId("m-0");
        CommerceOrderTender cash = tender("t-1", "CASH", "1000.00", "RECEIVED");
        CommerceOrderTender upi = tender("t-2", "UPI", "350.00", "RECEIVED");

        assertEquals(ORDER, service.voidInside(INST, ORDER, "Wrong item keyed", pin(), false, "cashier-1"));

        verify(approvals).approve(INST, LOC, "cashier-1", "manager-1", "4321", "POS_VOID", "ORDER", ORDER,
                new BigDecimal("1350.00"), "Wrong item keyed");
        ArgumentCaptor<List<StockPosting>> posted = ArgumentCaptor.forClass(List.class);
        verify(ledger).postAll(posted.capture());
        assertEquals(2, posted.getValue().size(), "the reversal row m-3 is not reversed again");
        StockPosting back = posted.getValue().get(0);
        assertEquals("POS_SALE", back.getType().name());
        assertEquals(2, back.getQuantityDelta());
        assertEquals("m-1", back.getReversesMovementId());
        assertEquals("POS_VOID:m-1", back.getIdempotencyKey());
        assertEquals("POS_VOID", back.getReason());
        assertEquals("ORDER_LINE", back.getReferenceType());
        assertEquals("l-1", back.getReferenceId());
        assertEquals(LOC, back.getLocationId());
        StockPosting piece = posted.getValue().get(1);
        assertEquals("piece-1", piece.getPieceId());
        assertEquals(1, piece.getQuantityDelta());
        verify(pieces).unlinkFromLine(INST, "piece-1", "l-2");

        assertEquals("VOID", cash.getStatus());
        assertEquals("VOID", upi.getStatus());
        ArgumentCaptor<Collection<String>> plans = ArgumentCaptor.forClass(Collection.class);
        verify(legacy).cancelPlans(plans.capture());
        assertEquals(List.of("plan-1", "plan-2"), new ArrayList<>(plans.getValue()));
        assertEquals(0, bottle.getQtyShipped());
        assertEquals(2, bottle.getQtyCancelled());
        assertNull(scarf.getPieceId());
        assertEquals("CANCELLED", order.getStatus());
        assertEquals("POS_VOID", order.getCancelReason());
        assertEquals(0, BigDecimal.ZERO.compareTo(order.getAmountPaid()));
        assertEquals("UNPAID", order.getPaymentStatus());
        assertTrue(order.getCancelledAt() != null);
        verify(invoices).cancel(INST, "cashier-1", "inv-1", "POS_VOID: Wrong item keyed");
        verify(writer).history(order, CommerceOrderStatus.DELIVERED, CommerceOrderStatus.CANCELLED, "cashier-1",
                "POS_VOID: Wrong item keyed");
        verify(audit).record(eq(INST), eq("cashier-1"), eq(LOC), eq("POS_VOID"), eq("ORDER"), eq(ORDER), any(), any(),
                eq("Wrong item keyed"));
        verify(desk).event(CommerceOrderEvents.ORDER_CANCELLED, order, null, false);
        verify(desk, org.mockito.Mockito.times(2)).afterCommitMoney(any());
    }

    @Test
    void aManagerVoidsWithoutAPin() {
        line("l-1", 1, null);
        sale("m-1", "l-1", -1, null);
        tender("t-1", "CASH", "1350.00", "RECEIVED");
        service.voidInside(INST, ORDER, "Customer changed mind", null, true, "manager-1");
        verify(approvals, never()).approve(any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        assertEquals("CANCELLED", order.getStatus());
    }

    @Test
    void aVoidIsRefusedAfterTheCloseAfterAReturnAndOnAnExchangeBill() {
        line("l-1", 1, null);
        session.setStatus("CLOSED");
        assertTrue(assertThrows(ConflictException.class, () -> service.voidInside(INST, ORDER, "x", null, true,
                "manager-1")).getMessage().startsWith("VOID_SESSION_CLOSED"));
        session.setStatus("OPEN");

        CommerceReturn ret = new CommerceReturn();
        ret.setStatus("RECEIVED");
        when(returns.findByOrderIdOrderByCreatedAtAsc(ORDER)).thenReturn(List.of(ret));
        assertTrue(assertThrows(ConflictException.class, () -> service.voidInside(INST, ORDER, "x", null, true,
                "manager-1")).getMessage().startsWith("VOID_HAS_RETURNS"));
        ret.setStatus("REJECTED");

        tender("t-9", "CREDIT_NOTE", "200.00", "RECEIVED");
        assertTrue(assertThrows(ConflictException.class, () -> service.voidInside(INST, ORDER, "x", null, true,
                "manager-1")).getMessage().startsWith("VOID_HAS_EXCHANGE"));
        tenders.clear();

        order.setStatus("SHIPPED");
        assertTrue(assertThrows(ConflictException.class, () -> service.voidInside(INST, ORDER, "x", null, true,
                "manager-1")).getMessage().startsWith("ORDER_STATE_CHANGED"));
        verify(ledger, never()).postAll(anyList());
        verify(invoices, never()).cancel(any(), any(), any(), any());
    }

    // ================================================================== the tender change

    @Test
    void aTenderChangeVoidsTheOldPaymentAndRecordsTheSameAmountByTheNewMode() {
        CommerceOrderTender cash = tender("t-1", "CASH", "1350.00", "RECEIVED");
        cash.setCashTendered(new BigDecimal("1500.00"));
        when(tenderRepository.findById("t-1")).thenReturn(Optional.of(cash));
        List<CommerceOrderTender> saved = new ArrayList<>();
        when(tenderRepository.save(any(CommerceOrderTender.class))).thenAnswer(call -> {
            CommerceOrderTender t = call.getArgument(0);
            saved.add(t);
            return t;
        });

        service.changeInside(INST, ORDER, "t-1", vacademy.io.admin_core_service.features.commerce.order.enums
                .TenderMode.UPI, "UPI 4411", pin(), false, "cashier-1");

        verify(approvals).approve(INST, LOC, "cashier-1", "manager-1", "4321", "POS_TENDER_CHANGE", "ORDER_TENDER",
                "t-1", new BigDecimal("1350.00"), null);
        assertEquals("VOID", cash.getStatus());
        CommerceOrderTender now = saved.get(saved.size() - 1);
        assertEquals("UPI", now.getMode());
        assertEquals("RECEIVED", now.getStatus());
        assertEquals(0, new BigDecimal("1350.00").compareTo(now.getAmount()));
        assertEquals("UPI 4411", now.getReference());
        assertEquals("s-1", now.getPosSessionId());
        assertNull(now.getCashTendered());
        verify(audit).record(eq(INST), eq("cashier-1"), eq(LOC), eq("POS_TENDER_CHANGED"), eq("ORDER"), eq(ORDER),
                any(), any(), any());
    }

    @Test
    void aTenderChangeIsRefusedForACreditNoteAVoidedPaymentNothingNewOrAClosedCounter() {
        CommerceOrderTender credit = tender("t-1", "CREDIT_NOTE", "200.00", "RECEIVED");
        when(tenderRepository.findById("t-1")).thenReturn(Optional.of(credit));
        assertTrue(assertThrows(ConflictException.class, () -> service.changeInside(INST, ORDER, "t-1",
                vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode.CASH, null, null, true,
                "manager-1")).getMessage().startsWith("TENDER_STATE_CHANGED"));
        CommerceOrderTender cash = tender("t-2", "CASH", "100.00", "VOID");
        when(tenderRepository.findById("t-2")).thenReturn(Optional.of(cash));
        assertTrue(assertThrows(ConflictException.class, () -> service.changeInside(INST, ORDER, "t-2",
                vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode.UPI, "U1", null, true,
                "manager-1")).getMessage().startsWith("TENDER_STATE_CHANGED"));
        cash.setStatus("RECEIVED");
        assertTrue(assertThrows(InvalidRequestException.class, () -> service.changeInside(INST, ORDER, "t-2",
                vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode.CASH, null, null, true,
                "manager-1")).getMessage().startsWith("VALIDATION: nothing changes"));
        session.setStatus("CLOSED");
        assertTrue(assertThrows(ConflictException.class, () -> service.changeInside(INST, ORDER, "t-2",
                vacademy.io.admin_core_service.features.commerce.order.enums.TenderMode.UPI, "U1", null, true,
                "manager-1")).getMessage().startsWith("SESSION_NOT_OPEN"));
        verify(tenderRepository, never()).save(any());
    }
}
