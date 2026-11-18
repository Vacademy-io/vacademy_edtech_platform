package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The counter return's body rules, the PINs it needs (policy override, cash above the cashier's
 * limit) decided before any transaction, and the preview's answer.
 */
class PosReturnServiceTest {

    private static final String INST = "inst-1";
    private static final String KEY = "pos-ret-0001";

    private final PosAccess access = mock(PosAccess.class);
    private final PosSettingsService settings = mock(PosSettingsService.class);
    private final CommerceOrderDeskService desk = mock(CommerceOrderDeskService.class);
    private final CommerceReturnService returnService = mock(CommerceReturnService.class);
    private final CommerceReturnRepository returnRepository = mock(CommerceReturnRepository.class);
    private final CommerceRequestGuard guard = mock(CommerceRequestGuard.class);
    private final CommerceCounterService counter = mock(CommerceCounterService.class);
    private PosReturnService service;
    private final PosSession session = new PosSession();
    private ReturnDtos.ReturnPreview preview;

    @BeforeEach
    void setUp() {
        service = new PosReturnService(access, settings, mock(PosSessionRepository.class), desk, returnService,
                mock(CommerceRefundService.class), returnRepository, mock(CommerceRefundRepository.class),
                mock(CommerceCreditNoteRepository.class), counter, mock(CommerceApprovalService.class),
                mock(CommerceAuditService.class), guard, mock(DocumentClock.class),
                mock(PlatformTransactionManager.class));
        session.setId("s-1");
        session.setStatus("OPEN");
        session.setLocationId("loc-2");
        session.setCashierUserId("cashier-1");
        lenient().when(access.session(any(), eq(INST), eq("s-1"))).thenReturn(session);
        lenient().when(desk.readOrder(INST, "order-1")).thenReturn(new CommerceOrder());
        lenient().when(settings.limits(INST)).thenReturn(new PosSettingsService.Limits(new BigDecimal("5"),
                new BigDecimal("500.00"), BigDecimal.ZERO, true));
        preview = ReturnDtos.ReturnPreview.builder().warnings(new ArrayList<>()).creditEstimate(new BigDecimal("300.00"))
                .lines(List.of(ReturnDtos.ReturnableLine.builder().orderLineId("l-1").returnableQuantity(2).build()))
                .policy(ReturnDtos.Policy.builder().windowDays(7).build())
                .build();
        lenient().when(returnService.previewForCounter(eq(INST), any())).thenAnswer(call -> preview);
        lenient().when(counter.nextNumber(INST, "RET")).thenReturn("RET-000042");
        lenient().when(guard.run(any(), any(), any())).thenReturn(new CommerceRequestGuard.Outcome<>("ret-1", false));
        vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn made =
                new vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn();
        made.setId("ret-1");
        made.setReturnNumber("RET-000042");
        made.setStatus("RECEIVED");
        made.setCreditTotal(new BigDecimal("300.00"));
        lenient().when(returnRepository.findByIdAndInstituteId("ret-1", INST)).thenReturn(java.util.Optional.of(made));
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

    private static PosDtos.ReturnRequest body(PosDtos.Settle settle, String override, PosDtos.Approval approval,
                                              PosDtos.ReturnLine... lines) {
        return new PosDtos.ReturnRequest(KEY, "s-1", "order-1", List.of(lines), "SIZE", null, override, settle,
                approval);
    }

    private static PosDtos.ReturnLine line(String id, int quantity, String condition, String... pieces) {
        return new PosDtos.ReturnLine(id, quantity, condition, pieces.length == 0 ? null : List.of(pieces));
    }

    private static final PosDtos.Settle CASH = new PosDtos.Settle("REFUND", "CASH", null);

    // ================================================================== body

    @Test
    void conditionsOfOneLineAreMergedForTheReturnAndKeptApartForTheReceive() {
        PosReturnService.Clean clean = PosReturnService.validate(body(CASH, null, null,
                line("l-1", 2, "RESALEABLE"), line("l-1", 1, "DAMAGED"), line("l-2", 1, "resaleable", "piece-9")));
        assertEquals(2, clean.create().getLines().size());
        assertEquals(3, clean.create().getLines().get(0).getQuantity());
        assertEquals(3, clean.received().size());
        assertEquals("DAMAGED", clean.received().get(1).getCondition());
        assertEquals(List.of("piece-9"), clean.received().get(2).getPieceIds());
        assertEquals(KEY, clean.create().getClientRequestId());
        assertTrue(clean.settle().cashRefund());
    }

    @Test
    void theBodyRules() {
        List<Runnable> refused = List.of(
                () -> PosReturnService.validate(null),
                () -> PosReturnService.validate(new PosDtos.ReturnRequest("short", "s-1", "order-1",
                        List.of(line("l-1", 1, "RESALEABLE")), "SIZE", null, null, CASH, null)),
                () -> PosReturnService.validate(body(CASH, null, null)),
                () -> PosReturnService.validate(body(CASH, null, null, line("l-1", 0, "RESALEABLE"))),
                () -> PosReturnService.validate(body(CASH, null, null, line("l-1", 1, "BROKEN"))),
                () -> PosReturnService.validate(body(CASH, null, null, line("l-1", 1, "DAMAGED"),
                        line("l-1", 1, "DAMAGED"))),
                () -> PosReturnService.validate(body(null, null, null, line("l-1", 1, "RESALEABLE"))),
                () -> PosReturnService.validate(body(new PosDtos.Settle("REFUND", "CARD", "x"), null, null,
                        line("l-1", 1, "RESALEABLE"))),
                () -> PosReturnService.validate(body(new PosDtos.Settle("REFUND", "GATEWAY", null), null, null,
                        line("l-1", 1, "RESALEABLE"))),
                () -> PosReturnService.validate(body(new PosDtos.Settle("REFUND", "UPI", null), null, null,
                        line("l-1", 1, "RESALEABLE"))),
                () -> PosReturnService.validate(body(new PosDtos.Settle("REFUND", "CASH", "R1"), null, null,
                        line("l-1", 1, "RESALEABLE"))),
                () -> PosReturnService.validate(body(new PosDtos.Settle("EXCHANGE", "CASH", null), null, null,
                        line("l-1", 1, "RESALEABLE"))));
        for (Runnable call : refused) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class, call::run);
            assertTrue(e.getMessage().startsWith("VALIDATION"), e.getMessage());
        }
        PosReturnService.CleanSettle upi = PosReturnService.settle(new PosDtos.Settle("refund", "UPI", "UPI ref 7"));
        assertEquals(RefundMethod.UPI, upi.method());
        assertEquals("UPI ref 7", upi.reference());
        PosReturnService.CleanSettle exchange = PosReturnService.settle(new PosDtos.Settle("EXCHANGE", null, null));
        assertNull(exchange.method());
        assertTrue(!exchange.cashRefund());
    }

    @Test
    void theRequestHashIgnoresThePin() {
        PosDtos.ReturnRequest with = body(CASH, null, new PosDtos.Approval("m-1", "1234", null),
                line("l-1", 1, "RESALEABLE"));
        PosDtos.ReturnRequest without = body(CASH, null, null, line("l-1", 1, "RESALEABLE"));
        assertEquals(CommerceRequestGuard.hash("POS_RETURN", with.withoutApproval()),
                CommerceRequestGuard.hash("POS_RETURN", without.withoutApproval()));
    }

    // ================================================================== PINs, before any transaction

    @Test
    void theApprovalMatrix() {
        BigDecimal limit = new BigDecimal("500.00");
        assertEquals(List.of(), PosReturnService.needsApproval(true, List.of("OUTSIDE_WINDOW"), true,
                new BigDecimal("9000.00"), limit), "a manager needs no PIN");
        assertEquals(List.of(), PosReturnService.needsApproval(false, List.of(), true, new BigDecimal("500.00"),
                limit), "at the limit is allowed");
        assertEquals(List.of("POS_CASH_REFUND"), PosReturnService.needsApproval(false, List.of(), true,
                new BigDecimal("500.01"), limit), "one paisa over needs a PIN");
        assertEquals(List.of(), PosReturnService.needsApproval(false, List.of(), false, new BigDecimal("9000.00"),
                limit), "UPI back or an exchange is not cash");
        assertEquals(List.of("POS_RETURN_OVERRIDE", "POS_CASH_REFUND"), PosReturnService.needsApproval(false,
                List.of("OUTSIDE_WINDOW"), true, new BigDecimal("0.01"), null), "an unset limit is 0");
    }

    @Test
    void aWarningWithoutAnOverrideReasonIsRefusedForEveryone() {
        preview.setWarnings(List.of("OUTSIDE_WINDOW"));
        CustomUserDetails manager = user("manager-1", "COMMERCE_STORE_MANAGER");
        ConflictException e = assertThrows(ConflictException.class, () -> service.create(manager, INST,
                body(CASH, null, null, line("l-1", 1, "RESALEABLE"))));
        assertTrue(e.getMessage().startsWith("RETURN_POLICY_WARNING: OUTSIDE_WINDOW"), e.getMessage());
        verify(guard, never()).run(any(), any(), any());
    }

    @Test
    void aCashierNeedsAPinForAnOverrideAndForCashAboveTheLimit() {
        CustomUserDetails cashier = user("cashier-1", "COMMERCE_POS_CASHIER");
        preview.setWarnings(List.of("OUTSIDE_WINDOW"));
        ConflictException override = assertThrows(ConflictException.class, () -> service.create(cashier, INST,
                body(CASH, "Regular customer", null, line("l-1", 1, "RESALEABLE"))));
        assertTrue(override.getMessage().startsWith("APPROVAL_REQUIRED: POS_RETURN_OVERRIDE"), override.getMessage());

        preview.setWarnings(new ArrayList<>());
        preview.setCreditEstimate(new BigDecimal("800.00"));
        ConflictException cash = assertThrows(ConflictException.class, () -> service.create(cashier, INST,
                body(CASH, null, null, line("l-1", 1, "RESALEABLE"))));
        assertTrue(cash.getMessage().startsWith("APPROVAL_REQUIRED: POS_CASH_REFUND"), cash.getMessage());
        verify(guard, never()).run(any(), any(), any());
        verify(counter, never()).nextNumber(anyString(), anyString());

        // UPI back above the limit, or credit for a new bill, needs no PIN.
        service.create(cashier, INST, body(new PosDtos.Settle("REFUND", "UPI", "UPI 1"), null, null,
                line("l-1", 1, "RESALEABLE")));
        service.create(cashier, INST, body(new PosDtos.Settle("EXCHANGE", null, null), null, null,
                line("l-1", 1, "RESALEABLE")));
        verify(guard, org.mockito.Mockito.times(2)).run(any(), any(), any());
    }

    @Test
    void aClosedCounterTakesNoReturn() {
        session.setStatus("CLOSED");
        CustomUserDetails cashier = user("cashier-1", "COMMERCE_POS_CASHIER");
        assertTrue(assertThrows(ConflictException.class, () -> service.create(cashier, INST,
                body(CASH, null, null, line("l-1", 1, "RESALEABLE")))).getMessage().startsWith("SESSION_NOT_OPEN"));
    }

    // ================================================================== preview

    @Test
    void thePreviewAnswersReturnableUnitsAndThePinsAndIgnoresAMissingReason() {
        preview.setWarnings(new ArrayList<>(List.of("REASON_NOT_ALLOWED")));
        preview.setCreditEstimate(new BigDecimal("700.00"));
        CustomUserDetails cashier = user("cashier-1", "COMMERCE_POS_CASHIER");
        PosDtos.ReturnPreview answer = service.preview(cashier, INST, new PosDtos.ReturnPreviewRequest("s-1",
                "order-1", List.of(line("l-1", 1, null), line("l-1", 1, null)), null, null));
        assertEquals(List.of(), answer.warnings(), "no reason chosen yet: its warning waits for the reason");
        assertEquals(List.of("POS_CASH_REFUND"), answer.needsApproval());
        assertEquals(1, answer.returnable().size());
        assertEquals("l-1", answer.returnable().get(0).orderLineId());
        assertEquals(2, answer.returnable().get(0).returnable());
        assertEquals(0, new BigDecimal("700.00").compareTo(answer.creditEstimate()));
        verify(returnService).previewForCounter(eq(INST), org.mockito.ArgumentMatchers.argThat(r ->
                "OTHER".equals(r.getReason()) && r.getLines().size() == 1 && r.getLines().get(0).getQuantity() == 2));

        PosDtos.ReturnPreview upi = service.preview(cashier, INST, new PosDtos.ReturnPreviewRequest("s-1",
                "order-1", List.of(line("l-1", 1, null)), "SIZE", new PosDtos.Settle("REFUND", "UPI", "U1")));
        assertEquals(List.of("REASON_NOT_ALLOWED"), upi.warnings(), "a chosen reason keeps its warning");
        assertEquals(List.of("POS_RETURN_OVERRIDE"), upi.needsApproval());
        when(settings.limits(INST)).thenReturn(new PosSettingsService.Limits(new BigDecimal("5"),
                new BigDecimal("1000.00"), BigDecimal.ZERO, true));
        assertEquals(List.of(), service.preview(user("manager-1", "COMMERCE_STORE_MANAGER"), INST,
                new PosDtos.ReturnPreviewRequest("s-1", "order-1", List.of(line("l-1", 1, null)), "SIZE", null))
                .needsApproval());
    }
}
