package vacademy.io.admin_core_service.features.commerce.returns;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceExchangeService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.returns.RefundFixture.ORDER;

/**
 * The refunds of an exchange on the old order: EXCHANGE_CREDIT for what the new order used and a
 * refund of any rest by the method staff chose; the return must be received, raised in full and
 * not refunded.
 */
class CommerceExchangeServiceTest {

    private RefundFixture f;
    private CommerceExchangeService exchange;
    private CommerceReturn ret;
    private final CommerceOrder newOrder = new CommerceOrder();

    @BeforeEach
    void setUp() {
        f = new RefundFixture();
        exchange = new CommerceExchangeService(f.desk, f.service, f.dueService, f.returnRepository,
                f.refundRepository, mock(CommerceCreditNoteRepository.class), f.auditService, f.clock);
        f.order.setRefundDue(new BigDecimal("600.00"));
        ret = f.received("ret-1", "600.00", "600.00");
        newOrder.setId("new-1");
        newOrder.setOrderNumber("ORD-000002");
    }

    private CommerceExchangeService.Locked lock() {
        return exchange.lock(INST, new CommerceExchangeService.Ask("ret-1", null, null));
    }

    @Test
    void aCreditBelowTheNewOrderIsUsedInFullAsExchangeCredit() {
        newOrder.setTotal(new BigDecimal("900.00"));
        CommerceExchangeService.Locked locked = lock();
        assertEquals(0, new BigDecimal("600.00").compareTo(locked.credit()));
        assertNull(exchange.apply(locked, newOrder, new CommerceExchangeService.Ask("ret-1", null, null), "user-1"));
        CommerceRefund credit = f.refunds.get(0);
        assertEquals("EXCHANGE_CREDIT", credit.getMethod());
        assertEquals("EXCHANGE", credit.getSource());
        assertEquals("PROCESSED", credit.getStatus());
        assertEquals("new-1", credit.getAppliedOrderId());
        assertEquals("EXCH:new-1", credit.getIdempotencyKey());
        assertEquals("ret-1", credit.getReturnId());
        assertEquals(0, new BigDecimal("600.00").compareTo(credit.getAmount()));
        assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getRefundCommitted()));
        assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getAmountRefunded()));
        assertEquals(1, f.refunds.size());
        verify(f.dueService, org.mockito.Mockito.atLeastOnce()).closeReady(f.order);
        verify(f.auditService).record(eq(INST), eq("user-1"), any(), eq("EXCHANGE_APPLIED"), eq("ORDER"), eq(ORDER),
                any(), any(), any());
    }

    @Test
    void aCreditAboveTheNewOrderRefundsTheRestByEachMethod() {
        newOrder.setTotal(new BigDecimal("450.00"));
        for (RefundMethod method : List.of(RefundMethod.CASH, RefundMethod.UPI, RefundMethod.GATEWAY)) {
            f.refunds.clear();
            f.order.setRefundCommitted(BigDecimal.ZERO.setScale(2));
            f.order.setAmountRefunded(BigDecimal.ZERO.setScale(2));
            newOrder.setId("new-" + method);
            String pending = exchange.apply(lock(), newOrder, new CommerceExchangeService.Ask("ret-1", method, null),
                    "user-1");
            assertEquals(2, f.refunds.size(), method.name());
            CommerceRefund rest = f.refunds.get(1);
            assertEquals("EXCH_REST:new-" + method, rest.getIdempotencyKey());
            assertEquals(0, new BigDecimal("150.00").compareTo(rest.getAmount()));
            assertEquals(method.name(), rest.getMethod());
            assertEquals(0, new BigDecimal("600.00").compareTo(f.order.getRefundCommitted()));
            switch (method) {
                case CASH -> {
                    assertEquals("PROCESSED", rest.getStatus());
                    assertNull(pending);
                }
                case UPI -> assertEquals("PENDING", rest.getStatus(), "no reference: paid out later");
                default -> {
                    assertEquals("PENDING", rest.getStatus());
                    assertEquals(rest.getId(), pending, "sent to the gateway after the commit");
                    assertEquals(RefundFixture.PAYMENT, rest.getGatewayPaymentId());
                }
            }
        }
        assertThrows(InvalidRequestException.class, () -> CommerceExchangeService.requireRemainder(
                new CommerceExchangeService.Ask("ret-1", null, null), new BigDecimal("600.00"),
                new BigDecimal("450.00")));
    }

    @Test
    void onlyAReceivedReturnRaisedInFullAndNotRefundedIsExchanged() {
        ret.setStatus("CLOSED");
        assertTrue(assertThrows(ConflictException.class, this::lock).getMessage().startsWith("EXCHANGE_NOT_AVAILABLE"));
        ret.setStatus("RECEIVED");
        ret.setDueRaised(BigDecimal.ZERO.setScale(2));
        assertTrue(assertThrows(ConflictException.class, this::lock).getMessage().startsWith("EXCHANGE_NOT_AVAILABLE"),
                "a COD return not yet remitted is not exchanged");
        ret.setDueRaised(new BigDecimal("600.00"));
        f.order.setRefundCommitted(new BigDecimal("100.00"));
        assertTrue(assertThrows(ConflictException.class, this::lock).getMessage().startsWith("EXCHANGE_NOT_AVAILABLE"),
                "the open due no longer covers the credit");
        f.order.setRefundCommitted(BigDecimal.ZERO.setScale(2));
        CommerceRefund earlier = f.pendingGateway("50.00");
        earlier.setReturnId("ret-1");
        assertTrue(assertThrows(ConflictException.class, this::lock).getMessage().startsWith("EXCHANGE_NOT_AVAILABLE"));
    }
}
