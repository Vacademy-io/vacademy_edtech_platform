package vacademy.io.admin_core_service.features.commerce.returns;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundKind;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundSource;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceExchangeService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;

/**
 * WP-42: a refund names the counter session whose drawer the money left. The 16-argument
 * {@code NewRefund} (every existing caller) writes no session; the 17-argument form stamps it;
 * an exchange at the till stamps its remainder refund, never the credit used on the new bill.
 */
class CommerceRefundServiceSessionTest {

    private RefundFixture f;

    @BeforeEach
    void setUp() {
        f = new RefundFixture();
        f.order.setRefundDue(new BigDecimal("600.00"));
        f.order.setAmountPaid(new BigDecimal("600.00"));
    }

    private static CommerceRefundService.NewRefund cash(String key, String session) {
        return new CommerceRefundService.NewRefund(RefundKind.ORDER, RefundSource.STAFF, RefundMethod.CASH,
                RefundStatus.PROCESSED, new BigDecimal("100.00"), "ret-1", "cn-1", null, null, null, null, null,
                LocalDate.of(2026, 11, 18), "Counter return", key, "cashier-1", session);
    }

    @Test
    void theSixteenArgumentFormIsUnchangedAndWritesNoSession() {
        CommerceRefundService.NewRefund old = new CommerceRefundService.NewRefund(RefundKind.ORDER,
                RefundSource.STAFF, RefundMethod.CASH, RefundStatus.PROCESSED, new BigDecimal("100.00"), "ret-1",
                "cn-1", null, null, null, null, null, LocalDate.of(2026, 11, 18), "Cash back", "K-1", "user-1");
        assertNull(old.posSessionId());
        assertEquals("user-1", old.actor());
        assertEquals("K-1", old.idempotencyKey());
        CommerceRefund refund = f.service.insertInside(f.order, old);
        assertNull(refund.getPosSessionId());
    }

    @Test
    void theSeventeenArgumentFormStampsTheSession() {
        CommerceRefund refund = f.service.insertInside(f.order, cash("POSRET:ret-1", "session-1"));
        assertEquals("session-1", refund.getPosSessionId());
        assertEquals("CASH", refund.getMethod());
        assertEquals("PROCESSED", refund.getStatus());
        assertEquals(0, new BigDecimal("100.00").compareTo(f.order.getAmountRefunded()));
        assertEquals(0, new BigDecimal("100.00").compareTo(f.order.getRefundCommitted()));
    }

    @Test
    void anExchangeAtTheTillStampsItsRemainderRefundOnly() {
        CommerceExchangeService exchange = new CommerceExchangeService(f.desk, f.service, f.dueService,
                f.returnRepository, f.refundRepository, mock(CommerceCreditNoteRepository.class), f.auditService,
                f.clock);
        f.received("ret-1", "600.00", "600.00");
        CommerceOrder newOrder = new CommerceOrder();
        newOrder.setId("new-1");
        newOrder.setOrderNumber("ORD-000002");
        newOrder.setTotal(new BigDecimal("450.00"));
        CommerceExchangeService.Ask ask = new CommerceExchangeService.Ask("ret-1", RefundMethod.CASH, null);

        exchange.apply(exchange.lock(INST, ask), newOrder, ask, "cashier-1", "session-1");
        assertEquals(2, f.refunds.size());
        assertEquals("EXCHANGE_CREDIT", f.refunds.get(0).getMethod());
        assertNull(f.refunds.get(0).getPosSessionId(), "no money moves for the credit used");
        CommerceRefund rest = f.refunds.get(1);
        assertEquals("CASH", rest.getMethod());
        assertEquals(0, new BigDecimal("150.00").compareTo(rest.getAmount()));
        assertEquals("session-1", rest.getPosSessionId());
    }

    @Test
    void theStaffOrderExchangeKeepsWritingNoSession() {
        CommerceExchangeService exchange = new CommerceExchangeService(f.desk, f.service, f.dueService,
                f.returnRepository, f.refundRepository, mock(CommerceCreditNoteRepository.class), f.auditService,
                f.clock);
        f.received("ret-1", "600.00", "600.00");
        CommerceOrder newOrder = new CommerceOrder();
        newOrder.setId("new-2");
        newOrder.setOrderNumber("ORD-000003");
        newOrder.setTotal(new BigDecimal("450.00"));
        CommerceExchangeService.Ask ask = new CommerceExchangeService.Ask("ret-1", RefundMethod.CASH, null);

        exchange.apply(exchange.lock(INST, ask), newOrder, ask, "user-1");
        assertEquals(2, f.refunds.size());
        assertNull(f.refunds.get(1).getPosSessionId());
    }
}
