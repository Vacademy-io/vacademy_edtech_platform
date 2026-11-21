package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.LOC;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

/**
 * Money received on a staff order left on credit: never above the due, the credit replaced for
 * the rest, the order paid in full settles its logs and plans; COD and closed orders refused.
 */
class CommerceReceiptServiceTest {

    private DeskFixture f;
    private CommerceStaffOrderService staffOrders;
    private CommerceReceiptService service;
    private final CustomUserDetails accountant = DeskFixture.user("COMMERCE_ACCOUNTANT");

    @BeforeEach
    void setUp() {
        f = new DeskFixture();
        staffOrders = mock(CommerceStaffOrderService.class);
        service = new CommerceReceiptService(f.desk, f.orderRepository, f.tenderRepository, staffOrders,
                f.auditService, f.requestGuard, f.clock);
        f.line("l1", 1, "1000.00");
        f.snapshot();
        f.order.setChannel("ADMIN");
        f.order.setPaymentMethod("OFFLINE");
        f.order.setPaymentStatus("PARTIALLY_PAID");
        f.order.setAmountPaid(new BigDecimal("300.00"));
        f.tender("CASH", "RECEIVED", "300.00");
        f.tender("CREDIT", "PENDING", "760.00");
    }

    private void receive(String amount) {
        service.record(accountant, INST, ORDER, OrderDeskDtos.ReceiptRequest.builder().clientRequestId("receipt-key-1")
                .mode("upi").amount(new BigDecimal(amount)).reference("UPI-REF-1").build());
    }

    private BigDecimal sum(String status) {
        return f.tenders.stream().filter(t -> status.equals(t.getStatus())).map(CommerceOrderTender::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static String code(RuntimeException e) {
        return e.getMessage().substring(0, e.getMessage().indexOf(':'));
    }

    @Test
    void aPartReceiptReplacesTheCreditForTheRest() {
        receive("500.00");
        assertEquals(new BigDecimal("800.00"), f.order.getAmountPaid());
        assertEquals("PARTIALLY_PAID", f.order.getPaymentStatus());
        assertEquals(0, sum("RECEIVED").compareTo(f.order.getAmountPaid()), "received tenders = amount paid");
        assertEquals(0, sum("PENDING").compareTo(f.order.getTotal().subtract(f.order.getAmountPaid())),
                "pending = total - paid");
        verify(staffOrders, never()).settlePaid(any(), any());
        verify(f.auditService).record(eq(INST), eq("user-1"), eq(LOC), eq("RECEIPT_RECORDED"), eq("ORDER"), eq(ORDER),
                any(), anyString(), any());
        verify(f.accessGuard).require(accountant, INST, CommerceFeature.ORDERS,
                Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT), LOC);
    }

    @Test
    void theLastReceiptPaysTheOrderAndSettlesItsLogsAndPlans() {
        receive("760.00");
        assertEquals("PAID", f.order.getPaymentStatus());
        assertEquals(0, sum("PENDING").signum());
        verify(staffOrders).settlePaid(f.order, f.lines);
    }

    /**
     * F1: a credit order of 1000 with goods worth 300 returned before any payment (the return's
     * credit was not owed back as money) owes 700: a receipt of 1000 is refused, 700 settles it.
     */
    @Test
    void aReturnBeforePaymentLowersWhatIsDue() {
        f.order.setTotal(new BigDecimal("1000.00"));
        f.order.setAmountPaid(BigDecimal.ZERO.setScale(2));
        f.order.setPaymentStatus("UNPAID");
        f.tenders.clear();
        f.tender("CREDIT", "PENDING", "1000.00");
        org.mockito.Mockito.when(f.orderRepository.sumReturnCreditNotRaised(ORDER))
                .thenReturn(new BigDecimal("300.00"));

        assertEquals(new BigDecimal("700.00"), CommerceReceiptService.amountDue(f.order.getTotal(),
                f.order.getAmountPaid(), new BigDecimal("300.00")));
        ConflictException above = assertThrows(ConflictException.class, () -> receive("1000.00"));
        assertEquals("RECEIPT_ABOVE_DUE", code(above));
        assertEquals("RECEIPT_ABOVE_DUE: 700.00 is due on this order", above.getMessage());
        assertThrows(ConflictException.class, () -> receive("700.01"));
        assertEquals(0, f.order.getAmountPaid().signum(), "a refused receipt changes nothing");

        receive("700.00");
        assertEquals(new BigDecimal("700.00"), f.order.getAmountPaid());
        assertEquals("PAID", f.order.getPaymentStatus());
        assertEquals(0, sum("PENDING").signum(), "no credit is left pending");
        assertEquals(new BigDecimal("700.00"), sum("RECEIVED"));
        verify(staffOrders).settlePaid(f.order, f.lines);
    }

    @Test
    void theDueIsNeverBelowZero() {
        assertEquals(new BigDecimal("0.00"), CommerceReceiptService.amountDue(new BigDecimal("1000.00"),
                new BigDecimal("800.00"), new BigDecimal("300.00")));
        assertEquals(new BigDecimal("1000.00"), CommerceReceiptService.amountDue(new BigDecimal("1000.00"),
                null, null));
    }

    @Test
    void refusals() {
        assertEquals("RECEIPT_ABOVE_DUE", code(assertThrows(ConflictException.class, () -> receive("760.01"))));
        f.order.setPaymentMethod("COD");
        assertEquals("USE_COD_REMITTANCE", code(assertThrows(ConflictException.class, () -> receive("10.00"))));
        f.order.setPaymentMethod("OFFLINE");
        f.order.setStatus("CANCELLED");
        assertEquals("ORDER_STATE_CHANGED", code(assertThrows(ConflictException.class, () -> receive("10.00"))));
        f.order.setStatus("CONFIRMED");
        f.order.setChannel("ONLINE");
        assertEquals("ORDER_STATE_CHANGED", code(assertThrows(ConflictException.class, () -> receive("10.00"))));
        assertThrows(InvalidRequestException.class, () -> receive("0"));
        assertThrows(InvalidRequestException.class, () -> receive("10.001"));
        assertThrows(InvalidRequestException.class, () -> service.record(accountant, INST, ORDER,
                OrderDeskDtos.ReceiptRequest.builder().clientRequestId("receipt-key-1").mode("GATEWAY")
                        .amount(BigDecimal.TEN).build()));
        assertThrows(InvalidRequestException.class, () -> service.record(accountant, INST, ORDER,
                OrderDeskDtos.ReceiptRequest.builder().clientRequestId("receipt-key-1").mode("CASH")
                        .amount(BigDecimal.TEN).receivedOn(f.today.plusDays(1)).build()));
        assertEquals(new BigDecimal("300.00"), f.order.getAmountPaid());
    }
}
