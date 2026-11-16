package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderWriter;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPeriodGuard;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The courier remittance (WP-31, §7.4): validation, replay by key and by reference, the order
 * checks under the locks, the sum and its reason, and what is settled per order: exactly the
 * logs of the lines that still have units, the COD tender, the conditional "remitted" mark.
 */
class CommerceCodRemittanceServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 16);

    private CommerceCodRemittanceRepository remittances;
    private CommerceOrderTenderRepository tenders;
    private CommerceOrderDeskService desk;
    private PaymentLogService paymentLogService;
    private UserPlanService userPlanService;
    private CommerceOrderWriter writer;
    private CommerceAuditService audit;
    private CommerceAccessGuard accessGuard;
    private CommerceCodRemittanceService service;
    private CustomUserDetails user;

    private final Map<String, CommerceOrder> orders = new HashMap<>();
    private final Map<String, List<CommerceOrderLine>> lines = new HashMap<>();
    private final Map<String, List<CommerceOrderTender>> orderTenders = new HashMap<>();
    private final List<CommerceCodRemittance> saved = new ArrayList<>();

    @BeforeEach
    void setUp() {
        remittances = mock(CommerceCodRemittanceRepository.class);
        tenders = mock(CommerceOrderTenderRepository.class);
        desk = mock(CommerceOrderDeskService.class);
        paymentLogService = mock(PaymentLogService.class);
        userPlanService = mock(UserPlanService.class);
        writer = mock(CommerceOrderWriter.class);
        audit = mock(CommerceAuditService.class);
        accessGuard = mock(CommerceAccessGuard.class);
        DocumentClock clock = mock(DocumentClock.class);
        when(clock.today(INSTITUTE)).thenReturn(TODAY);
        @SuppressWarnings("unchecked")
        ObjectProvider<StockPeriodGuard> periodGuard = mock(ObjectProvider.class);
        service = new CommerceCodRemittanceService(remittances, tenders, desk, paymentLogService, userPlanService,
                writer, audit, accessGuard, clock, periodGuard, mock(PlatformTransactionManager.class));
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("acct-1");

        when(remittances.findOrderIdsOfInstitute(eq(INSTITUTE), anyCollection())).thenAnswer(call ->
                ((Collection<String>) call.getArgument(1)).stream().filter(orders::containsKey).toList());
        when(desk.readOrder(eq(INSTITUTE), anyString())).thenAnswer(call -> orders.get(call.getArgument(1)));
        when(desk.lockOrder(eq(INSTITUTE), anyString())).thenAnswer(call -> orders.get(call.getArgument(1)));
        when(desk.freshLines(anyString())).thenAnswer(call -> lines.get(call.getArgument(0)));
        when(tenders.findByOrderIdOrderByCreatedAtAsc(anyString())).thenAnswer(call ->
                orderTenders.getOrDefault(call.getArgument(0), List.of()));
        when(tenders.settleOne(anyString(), eq("RECEIVED"), any(), anyString())).thenReturn(1);
        when(remittances.markRemitted(eq(INSTITUTE), anyString(), anyString(), any())).thenReturn(1);
        when(remittances.saveAndFlush(any(CommerceCodRemittance.class))).thenAnswer(call -> {
            CommerceCodRemittance r = call.getArgument(0);
            saved.add(r);
            return r;
        });
        when(remittances.findByIdAndInstituteId(anyString(), eq(INSTITUTE))).thenAnswer(call ->
                saved.stream().filter(r -> r.getId().equals(call.getArgument(0))).findFirst());
        when(remittances.findByInstituteIdAndClientRequestId(eq(INSTITUTE), anyString())).thenReturn(Optional.empty());
        when(remittances.findByInstituteIdAndReference(eq(INSTITUTE), anyString())).thenReturn(Optional.empty());
        when(paymentLogService.markCommerceLogsPaid(anyCollection())).thenAnswer(call ->
                new ArrayList<>((Collection<String>) call.getArgument(0)));
        when(userPlanService.findById(anyString())).thenAnswer(call -> {
            UserPlan plan = new UserPlan();
            plan.setId(call.getArgument(0));
            return plan;
        });
    }

    // ------------------------------------------------------------------ fixtures

    /** A delivered COD order with {@code items} item lines of one unit each, COD tender pending. */
    private CommerceOrder delivered(String id, String number, String codAmount, int items) {
        CommerceOrder order = new CommerceOrder();
        order.setId(id);
        order.setInstituteId(INSTITUTE);
        order.setOrderNumber(number);
        order.setPaymentMethod("COD");
        order.setStatus(CommerceOrderStatus.DELIVERED.name());
        order.setPaymentStatus("UNPAID");
        order.setCodAmount(new BigDecimal(codAmount));
        order.setFulfilmentLocationId("loc-1");
        orders.put(id, order);
        List<CommerceOrderLine> ls = new ArrayList<>();
        for (int i = 1; i <= items; i++) {
            CommerceOrderLine line = new CommerceOrderLine();
            line.setId(id + "-l" + i);
            line.setLineType(CommerceOrderLine.TYPE_ITEM);
            line.setQuantity(1);
            line.setPaymentLogId("log-" + id + "-" + i);
            line.setUserPlanId("plan-" + id + "-" + i);
            ls.add(line);
        }
        CommerceOrderLine cod = new CommerceOrderLine();
        cod.setId(id + "-cod");
        cod.setLineType(CommerceOrderLine.TYPE_COD_CHARGE);
        cod.setQuantity(1);
        ls.add(cod);
        lines.put(id, ls);
        CommerceOrderTender tender = new CommerceOrderTender();
        tender.setId("t-" + id);
        tender.setMode("COD");
        tender.setStatus("PENDING");
        tender.setAmount(new BigDecimal(codAmount));
        orderTenders.put(id, new ArrayList<>(List.of(tender)));
        return order;
    }

    private static CodRemittanceDtos.RemittanceRequest request(String gross, String deductions, String net,
                                                               String... orderIds) {
        return CodRemittanceDtos.RemittanceRequest.builder().clientRequestId("remit-key-0001")
                .reference("COURIER-STMT-0001").courierName("Courier").receivedOn(TODAY)
                .grossAmount(new BigDecimal(gross)).deductions(deductions == null ? null : new BigDecimal(deductions))
                .netAmount(new BigDecimal(net)).orderIds(List.of(orderIds)).build();
    }

    private void nothingWritten() {
        verify(remittances, never()).saveAndFlush(any());
        verify(remittances, never()).markRemitted(anyString(), anyString(), anyString(), any());
        verify(paymentLogService, never()).markCommerceLogsPaid(anyCollection());
        verify(tenders, never()).settleOne(anyString(), anyString(), any(), any());
        verify(audit, never()).record(anyString(), anyString(), any(), anyString(), anyString(), anyString(), any(),
                any(), any());
    }

    // ------------------------------------------------------------------ validation

    @Test
    void aRemittanceThatDoesNotAddUpIsRefused() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        delivered("o-2", "ORD-2", "500.00", 1);
        // net is not gross minus deductions: 400 before anything is read.
        InvalidRequestException net = assertThrows(InvalidRequestException.class,
                () -> service.record(user, INSTITUTE, request("1590.00", "30.00", "1590.00", "o-1", "o-2")));
        assertTrue(net.getMessage().startsWith("VALIDATION: net_amount"), net.getMessage());
        verifyNoInteractions(desk);

        // gross is not the sum of the orders and no reason is given: 400, nothing written.
        InvalidRequestException gap = assertThrows(InvalidRequestException.class,
                () -> service.record(user, INSTITUTE, request("1500.00", "30.00", "1470.00", "o-1", "o-2")));
        assertTrue(gap.getMessage().startsWith(CommerceCodRemittanceService.REMITTANCE_DIFFERENCE_REASON_REQUIRED),
                gap.getMessage());
        assertTrue(gap.getMessage().contains("1590.00"));
        nothingWritten();
    }

    @Test
    void withAWrittenReasonAShortPaymentIsRecordedAndTheOrdersReadPaidInFull() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        CodRemittanceDtos.RemittanceRequest short_ = request("1000.00", "0", "1000.00", "o-1");
        short_.setDifferenceReason("Courier short-paid; claim raised");

        CommerceCodRemittanceService.Recorded recorded = service.record(user, INSTITUTE, short_);

        assertTrue(recorded.created());
        CommerceCodRemittance row = saved.get(0);
        assertEquals(new BigDecimal("1090.00"), row.getOrdersTotal());
        assertEquals(new BigDecimal("1000.00"), row.getGrossAmount());
        assertEquals("Courier short-paid; claim raised", row.getDifferenceReason());
        verify(remittances).markRemitted(eq(INSTITUTE), eq("o-1"), eq(row.getId()), any());
    }

    @Test
    void badBodiesAre400() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        List<CodRemittanceDtos.RemittanceRequest> bad = new ArrayList<>();
        CodRemittanceDtos.RemittanceRequest future = request("1090.00", "0", "1090.00", "o-1");
        future.setReceivedOn(TODAY.plusDays(1));
        bad.add(future);
        CodRemittanceDtos.RemittanceRequest twice = request("1090.00", "0", "1090.00", "o-1", "o-1");
        bad.add(twice);
        CodRemittanceDtos.RemittanceRequest none = request("1090.00", "0", "1090.00");
        bad.add(none);
        CodRemittanceDtos.RemittanceRequest noRef = request("1090.00", "0", "1090.00", "o-1");
        noRef.setReference(" ");
        bad.add(noRef);
        bad.add(request("1090.00", "-1.00", "1091.00", "o-1"));
        bad.add(request("1090.001", "0", "1090.001", "o-1"));
        CodRemittanceDtos.RemittanceRequest noKey = request("1090.00", "0", "1090.00", "o-1");
        noKey.setClientRequestId("short");
        bad.add(noKey);
        List<String> many = new ArrayList<>();
        for (int i = 0; i <= CommerceCodRemittanceService.MAX_ORDERS; i++) {
            many.add("o-" + i);
        }
        CodRemittanceDtos.RemittanceRequest tooMany = request("1090.00", "0", "1090.00", "o-1");
        tooMany.setOrderIds(many);
        bad.add(tooMany);
        for (CodRemittanceDtos.RemittanceRequest body : bad) {
            assertThrows(InvalidRequestException.class, () -> service.record(user, INSTITUTE, body));
        }
        assertThrows(InvalidRequestException.class, () -> service.record(user, INSTITUTE, null));
        nothingWritten();
    }

    @Test
    void onlyAStoreManagerOrAnAccountantMayRecordOne() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(accessGuard).require(user, INSTITUTE, CommerceFeature.ORDERS, CommerceCodRemittanceService.MONEY);
        assertThrows(CommerceAccessDeniedException.class,
                () -> service.record(user, INSTITUTE, request("1090.00", "0", "1090.00", "o-1")));
        verifyNoInteractions(desk);
        nothingWritten();
    }

    @Test
    void eachOrdersLocationIsCheckedBeforeAnythingIsLocked() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, "no"))
                .when(desk).authorize(user, INSTITUTE, "loc-1", CommerceCodRemittanceService.MONEY);
        assertThrows(CommerceAccessDeniedException.class,
                () -> service.record(user, INSTITUTE, request("1090.00", "0", "1090.00", "o-1")));
        verify(desk, never()).lockOrder(anyString(), anyString());
        nothingWritten();
    }

    // ------------------------------------------------------------------ the orders

    @Test
    void anOrderThatIsNotADeliveredUnpaidCodOrderStopsTheWholeRemittance() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        CommerceOrder shipped = delivered("o-2", "ORD-2", "500.00", 1);
        shipped.setStatus("SHIPPED");
        ConflictException e = assertThrows(ConflictException.class,
                () -> service.record(user, INSTITUTE, request("1590.00", "0", "1590.00", "o-1", "o-2")));
        assertTrue(e.getMessage().startsWith(CommerceCodRemittanceService.REMITTANCE_ORDER_NOT_DUE + ": order ORD-2"),
                e.getMessage());
        nothingWritten();

        for (java.util.function.Consumer<CommerceOrder> notDue : List.<java.util.function.Consumer<CommerceOrder>>of(
                o -> o.setPaymentMethod("PREPAID"), o -> o.setPaymentStatus("PAID"),
                o -> o.setCodRemittanceId("rem-0"), o -> o.setStatus("RTO"))) {
            CommerceOrder order = delivered("o-3", "ORD-3", "200.00", 1);
            notDue.accept(order);
            assertThrows(ConflictException.class, () -> CommerceCodRemittanceService.requireDue(order));
        }
        CommerceCodRemittanceService.requireDue(delivered("o-4", "ORD-4", "200.00", 1));
    }

    @Test
    void aRemittanceForAnOrderWithOneCancelledLineLeavesThatLinesLogUnpaid() {
        delivered("o-1", "ORD-1", "1090.00", 3);
        CommerceOrderLine cancelled = lines.get("o-1").get(1);
        cancelled.setQtyCancelled(1);

        service.record(user, INSTITUTE, request("1090.00", "0", "1090.00", "o-1"));

        ArgumentCaptor<Collection<String>> claimed = ArgumentCaptor.forClass(Collection.class);
        verify(paymentLogService).markCommerceLogsPaid(claimed.capture());
        assertEquals(List.of("log-o-1-1", "log-o-1-3"), new ArrayList<>(claimed.getValue()));
        assertFalse(claimed.getValue().contains("log-o-1-2"));
        verify(userPlanService, org.mockito.Mockito.times(2)).activateCommercePlan(any(UserPlan.class));
        verify(userPlanService).findById("plan-o-1-1");
        verify(userPlanService).findById("plan-o-1-3");
        verify(userPlanService, never()).findById("plan-o-1-2");
    }

    @Test
    void eachOrderIsSettledInIdOrderWithItsCodTenderAndTheRemittedMark() {
        delivered("o-b", "ORD-B", "500.00", 1);
        delivered("o-a", "ORD-A", "1090.00", 2);

        CommerceCodRemittanceService.Recorded recorded = service.record(user, INSTITUTE,
                request("1590.00", "30.00", "1560.00", "o-b", "o-a"));

        assertTrue(recorded.created());
        CommerceCodRemittance row = saved.get(0);
        assertEquals(new BigDecimal("1590.00"), row.getOrdersTotal());
        assertEquals(2, row.getOrderCount());
        assertEquals(new BigDecimal("1560.00"), row.getNetAmount());
        assertEquals("acct-1", row.getRecordedBy());
        assertEquals("remit-key-0001", row.getClientRequestId());
        assertEquals(64, row.getRequestHash().length());

        InOrder order = inOrder(desk, remittances, paymentLogService, tenders);
        order.verify(desk).lockOrder(INSTITUTE, "o-a");
        order.verify(desk).lockOrder(INSTITUTE, "o-b");
        order.verify(remittances).saveAndFlush(row);
        order.verify(paymentLogService).markCommerceLogsPaid(anyCollection());
        order.verify(tenders).settleOne(eq("t-o-a"), eq("RECEIVED"), any(), eq("COURIER-STMT-0001"));
        order.verify(remittances).markRemitted(eq(INSTITUTE), eq("o-a"), eq(row.getId()), any());
        order.verify(paymentLogService).markCommerceLogsPaid(anyCollection());
        order.verify(tenders).settleOne(eq("t-o-b"), eq("RECEIVED"), any(), eq("COURIER-STMT-0001"));
        order.verify(remittances).markRemitted(eq(INSTITUTE), eq("o-b"), eq(row.getId()), any());
        verify(writer).history(eq(orders.get("o-a")), eq(CommerceOrderStatus.DELIVERED),
                eq(CommerceOrderStatus.DELIVERED), eq("acct-1"), anyString());
        verify(audit).record(eq(INSTITUTE), eq("acct-1"), any(), eq("COD_REMITTANCE_RECORDED"),
                eq("COD_REMITTANCE"), eq(row.getId()), any(), anyString(), any());
        verify(desk).afterCommitMoney(any());
    }

    @Test
    void anOrderAnotherRemittanceTookMeanwhileIsA409() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        when(remittances.markRemitted(eq(INSTITUTE), eq("o-1"), anyString(), any())).thenReturn(0);
        ConflictException e = assertThrows(ConflictException.class,
                () -> service.record(user, INSTITUTE, request("1090.00", "0", "1090.00", "o-1")));
        assertTrue(e.getMessage().startsWith(CommerceCodRemittanceService.REMITTANCE_ORDER_NOT_DUE), e.getMessage());
    }

    @Test
    void aCodTenderThatChangedOrALogThatWasAlreadyClaimedStopsTheRemittance() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        orderTenders.get("o-1").get(0).setAmount(new BigDecimal("1000.00"));
        assertThrows(ConflictException.class,
                () -> service.record(user, INSTITUTE, request("1090.00", "0", "1090.00", "o-1")));

        delivered("o-2", "ORD-2", "1090.00", 1);
        when(paymentLogService.markCommerceLogsPaid(anyCollection())).thenReturn(List.of());
        CodRemittanceDtos.RemittanceRequest other = request("1090.00", "0", "1090.00", "o-2");
        other.setClientRequestId("remit-key-0002");
        other.setReference("COURIER-STMT-0002");
        assertThrows(ConflictException.class, () -> service.record(user, INSTITUTE, other));
        verify(remittances, never()).markRemitted(anyString(), anyString(), anyString(), any());
    }

    // ------------------------------------------------------------------ replay

    @Test
    void theSameRequestAgainAnswersTheFirstRemittanceAndAnotherBodyIsRefused() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        CommerceCodRemittanceService.Recorded first = service.record(user, INSTITUTE,
                request("1090.00", "0", "1090.00", "o-1"));
        CommerceCodRemittance row = saved.get(0);
        when(remittances.findByInstituteIdAndClientRequestId(INSTITUTE, "remit-key-0001")).thenReturn(Optional.of(row));
        when(remittances.findByInstituteIdAndReference(INSTITUTE, "COURIER-STMT-0001")).thenReturn(Optional.of(row));

        CommerceCodRemittanceService.Recorded again = service.record(user, INSTITUTE,
                request("1090.00", "0.00", "1090.00", "o-1"));
        assertFalse(again.created());
        assertEquals(first.view().getId(), again.view().getId());
        assertEquals(Boolean.TRUE, again.view().getReplayed());
        verify(remittances).saveAndFlush(any());

        ConflictException mismatch = assertThrows(ConflictException.class,
                () -> service.record(user, INSTITUTE, request("1090.00", "10.00", "1080.00", "o-1")));
        assertTrue(mismatch.getMessage().startsWith("IDEMPOTENCY_MISMATCH"), mismatch.getMessage());

        // Another key with the reference of a recorded remittance and another body.
        CodRemittanceDtos.RemittanceRequest reused = request("1090.00", "10.00", "1080.00", "o-1");
        reused.setClientRequestId("remit-key-0009");
        ConflictException e = assertThrows(ConflictException.class, () -> service.record(user, INSTITUTE, reused));
        assertTrue(e.getMessage().startsWith(CommerceCodRemittanceService.REMITTANCE_REFERENCE_REUSED), e.getMessage());
        verify(remittances).saveAndFlush(any());
    }

    @Test
    void aTwinThatWonTheRaceIsTheAnswerNotTheRefusal() {
        delivered("o-1", "ORD-1", "1090.00", 1);
        CommerceCodRemittance winner = new CommerceCodRemittance();
        winner.setId("rem-w");
        winner.setInstituteId(INSTITUTE);
        winner.setReference("COURIER-STMT-0001");
        winner.setReceivedOn(TODAY);
        winner.setRequestHash(CommerceCodRemittanceService.validate(request("1090.00", "0", "1090.00", "o-1"), TODAY)
                .hash());
        saved.add(winner);
        when(remittances.saveAndFlush(any(CommerceCodRemittance.class)))
                .thenThrow(new DataIntegrityViolationException("uq_commerce_cod_remittance_request"));
        when(remittances.findByInstituteIdAndClientRequestId(INSTITUTE, "remit-key-0001"))
                .thenReturn(Optional.empty(), Optional.of(winner));

        CommerceCodRemittanceService.Recorded answer = service.record(user, INSTITUTE,
                request("1090.00", "0", "1090.00", "o-1"));
        assertFalse(answer.created());
        assertEquals("rem-w", answer.view().getId());
    }

    @Test
    void theHashIgnoresTheOrderOfTheIdsAndTrailingZeros() {
        String a = CommerceCodRemittanceService.validate(request("1590.00", "30", "1560.0", "o-1", "o-2"), TODAY)
                .hash();
        String b = CommerceCodRemittanceService.validate(request("1590", "30.00", "1560.00", "o-2", "o-1"), TODAY)
                .hash();
        assertEquals(a, b);
        assertFalse(a.equals(CommerceCodRemittanceService.validate(request("1590", "30.00", "1560.00", "o-2"), TODAY)
                .hash()));
    }
}
