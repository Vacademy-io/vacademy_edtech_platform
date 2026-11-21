package vacademy.io.admin_core_service.features.commerce.returns.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * F1: the order detail shows what a staff order still owes after goods were returned before
 * payment (total less paid less the return credit that was not owed back as money).
 */
class CommerceOrderReturnsViewDueTest {

    private static CommerceReturn ret(String status, String credit, String raised) {
        CommerceReturn r = new CommerceReturn();
        r.setStatus(status);
        r.setCreditTotal(new BigDecimal(credit));
        r.setDueRaised(new BigDecimal(raised));
        return r;
    }

    private static CommerceReturn withOrder(CommerceReturn r) {
        r.setOrderId("order-1");
        return r;
    }

    @Test
    void theDetailShowsTheDueLessReturnsNotPaidBack() {
        CommerceReturnRepository returns = mock(CommerceReturnRepository.class);
        CommerceRefundRepository refunds = mock(CommerceRefundRepository.class);
        CommerceOrderReturnsView view = new CommerceOrderReturnsView(returns, refunds,
                mock(CommerceOrderLineRepository.class), mock(CommerceReturnService.class),
                mock(CommerceRefundService.class));
        CommerceOrder order = new CommerceOrder();
        order.setId("order-1");
        order.setTotal(new BigDecimal("1000.00"));
        order.setAmountPaid(new BigDecimal("0.00"));
        when(returns.findByOrderIdOrderByCreatedAtAsc("order-1")).thenReturn(List.of(
                ret("RECEIVED", "300.00", "0.00"),
                // A return still open has given no credit yet; a rejected one never will.
                ret("APPROVED", "0.00", "0.00"),
                ret("REJECTED", "0.00", "0.00")));
        StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder().build();

        view.enrich(detail, order, List.of(), Set.of(), false);
        assertEquals(new BigDecimal("700.00"), detail.getAmountDue());

        // Partly paid before the return: what was paid is owed back (raised), the rest lowers the due.
        order.setAmountPaid(new BigDecimal("200.00"));
        when(returns.findByOrderIdOrderByCreatedAtAsc("order-1")).thenReturn(List.of(
                ret("CLOSED", "500.00", "200.00")));
        view.enrich(detail, order, List.of(), Set.of(), false);
        assertEquals(new BigDecimal("500.00"), detail.getAmountDue());
    }

    @Test
    void aManagerMayReturnAStaffOrderOnCreditButNotAnUnpaidOnlineOrder() {
        CommerceReturnRepository returns = mock(CommerceReturnRepository.class);
        CommerceOrderReturnsView view = new CommerceOrderReturnsView(returns, mock(CommerceRefundRepository.class),
                mock(CommerceOrderLineRepository.class), mock(CommerceReturnService.class),
                mock(CommerceRefundService.class));
        CommerceOrder order = new CommerceOrder();
        order.setId("order-1");
        order.setStatus("DELIVERED");
        order.setChannel("ADMIN");
        order.setPaymentMethod("OFFLINE");
        order.setPaymentStatus("UNPAID");
        order.setTotal(new BigDecimal("1000.00"));
        order.setAmountPaid(new BigDecimal("0.00"));
        when(returns.findByOrderIdOrderByCreatedAtAsc("order-1")).thenReturn(List.of());
        vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine line =
                new vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine();
        line.setLineType(vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine.TYPE_ITEM);
        line.setQuantity(2);
        line.setQtyShipped(2);
        line.setQtyReturned(0);

        StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder().build();
        view.enrich(detail, order, List.of(line), Set.of(), true);
        assertTrue(detail.getNextActions().contains("CREATE_RETURN"), detail.getNextActions().toString());

        // The list row carries the same amount_due as the detail (the DUES column reads it).
        when(returns.findByOrderIdInOrderByCreatedAtAsc(org.mockito.ArgumentMatchers.anyCollection()))
                .thenReturn(List.of(withOrder(ret("RECEIVED", "300.00", "0.00"))));
        StaffOrderDtos.StaffOrderRow row = StaffOrderDtos.StaffOrderRow.builder().build();
        view.enrichRows(List.of(row), List.of(order));
        assertEquals(new BigDecimal("700.00"), row.getAmountDue());

        order.setChannel("ONLINE");
        order.setPaymentMethod("PREPAID");
        StaffOrderDtos.StaffOrderDetail online = StaffOrderDtos.StaffOrderDetail.builder().build();
        view.enrich(online, order, List.of(line), Set.of(), true);
        assertFalse(online.getNextActions().contains("CREATE_RETURN"), online.getNextActions().toString());
    }
}
