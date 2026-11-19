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
}
