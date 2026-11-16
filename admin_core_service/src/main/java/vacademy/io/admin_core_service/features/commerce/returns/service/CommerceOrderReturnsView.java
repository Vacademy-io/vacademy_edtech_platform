package vacademy.io.admin_core_service.features.commerce.returns.service;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The returns and refunds of orders as the order views show them: the derived
 * {@code refund_state} and {@code return_state}, the open due, the returns and refunds of an order
 * and the desk actions CREATE_RETURN and REFUND. Read only; called inside the views' transaction.
 */
@Component
public class CommerceOrderReturnsView {

    private final CommerceReturnRepository returnRepository;
    private final CommerceRefundRepository refundRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final CommerceReturnService returnService;
    private final CommerceRefundService refundService;

    public CommerceOrderReturnsView(CommerceReturnRepository returnRepository,
                                    CommerceRefundRepository refundRepository,
                                    CommerceOrderLineRepository lineRepository,
                                    CommerceReturnService returnService, CommerceRefundService refundService) {
        this.returnRepository = returnRepository;
        this.refundRepository = refundRepository;
        this.lineRepository = lineRepository;
        this.returnService = returnService;
        this.refundService = refundService;
    }

    /** NONE, PENDING (committed above refunded), PART or FULL (refunded = paid). Payment status keeps meaning "collected". */
    public static String refundState(BigDecimal amountPaid, BigDecimal committed, BigDecimal refunded) {
        BigDecimal paid = nz(amountPaid);
        BigDecimal c = nz(committed);
        BigDecimal r = nz(refunded);
        if (c.compareTo(r) > 0) {
            return "PENDING";
        }
        if (r.signum() > 0 && r.compareTo(paid) >= 0) {
            return "FULL";
        }
        return r.signum() > 0 ? "PART" : "NONE";
    }

    /** IN_PROGRESS (a return REQUESTED or APPROVED), FULL (every shipped unit back), PART, else NONE. */
    public static String returnState(List<CommerceOrderLine> lines, List<CommerceReturn> returns) {
        for (CommerceReturn r : returns) {
            if (ReturnStatus.REQUESTED.name().equals(r.getStatus()) || ReturnStatus.APPROVED.name().equals(r.getStatus())) {
                return "IN_PROGRESS";
            }
        }
        int shipped = 0;
        int returned = 0;
        for (CommerceOrderLine line : lines) {
            if (CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                shipped += line.getQtyShipped() == null ? 0 : line.getQtyShipped();
                returned += line.getQtyReturned() == null ? 0 : line.getQtyReturned();
            }
        }
        if (returned > 0 && returned >= shipped) {
            return "FULL";
        }
        return returned > 0 ? "PART" : "NONE";
    }

    /** The staff detail of an order gains its money-back facts, returns, refunds and actions. */
    public void enrich(StaffOrderDtos.StaffOrderDetail detail, CommerceOrder order, List<CommerceOrderLine> lines,
                       Set<CommerceRole> roles, boolean admin) {
        List<CommerceReturn> returns = returnRepository.findByOrderIdOrderByCreatedAtAsc(order.getId());
        BigDecimal open = nz(order.getRefundDue()).subtract(nz(order.getRefundCommitted()));
        detail.setRefundCommitted(nz(order.getRefundCommitted()));
        detail.setAmountRefunded(nz(order.getAmountRefunded()));
        detail.setRefundOpen(open);
        detail.setRefundState(refundState(order.getAmountPaid(), order.getRefundCommitted(),
                order.getAmountRefunded()));
        detail.setReturnState(returnState(lines, returns));
        detail.setReturns(returnService.summaries(returns));
        detail.setRefunds(refundService.summaries(refundRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())));
        detail.setExchangeOfOrderId(order.getExchangeOfOrderId());
        if (detail.getOrder() != null) {
            row(detail.getOrder(), order, lines, returns);
        }
        boolean manager = admin || (roles != null && roles.contains(CommerceRole.STORE_MANAGER));
        if (manager) {
            List<String> actions = detail.getNextActions() == null ? new ArrayList<>()
                    : new ArrayList<>(detail.getNextActions());
            if (returnable(order, lines, returns)) {
                actions.add("CREATE_RETURN");
            }
            if (open.signum() > 0) {
                actions.add("REFUND");
            }
            detail.setNextActions(actions);
        }
    }

    /** The rows of a staff list page gain the open due and both states. */
    public void enrichRows(List<StaffOrderDtos.StaffOrderRow> rows, List<CommerceOrder> orders) {
        if (orders.isEmpty()) {
            return;
        }
        Collection<String> ids = orders.stream().map(CommerceOrder::getId).toList();
        Map<String, List<CommerceOrderLine>> linesOf = new HashMap<>();
        for (CommerceOrderLine line : lineRepository.findByOrderIdInOrderByOrderIdAscLineNoAsc(ids)) {
            linesOf.computeIfAbsent(line.getOrderId(), k -> new ArrayList<>()).add(line);
        }
        Map<String, List<CommerceReturn>> returnsOf = new HashMap<>();
        for (CommerceReturn r : returnRepository.findByOrderIdInOrderByCreatedAtAsc(ids)) {
            returnsOf.computeIfAbsent(r.getOrderId(), k -> new ArrayList<>()).add(r);
        }
        for (int i = 0; i < rows.size() && i < orders.size(); i++) {
            CommerceOrder order = orders.get(i);
            row(rows.get(i), order, linesOf.getOrDefault(order.getId(), List.of()),
                    returnsOf.getOrDefault(order.getId(), List.of()));
        }
    }

    /** The buyer's view of an order gains its return and refund state. */
    public void enrich(CheckoutDtos.OrderView view, CommerceOrder order, List<CommerceOrderLine> lines) {
        view.setReturnState(returnState(lines, returnRepository.findByOrderIdOrderByCreatedAtAsc(order.getId())));
        view.setRefundState(refundState(order.getAmountPaid(), order.getRefundCommitted(), order.getAmountRefunded()));
        view.setRefundedAmount(nz(order.getAmountRefunded()));
    }

    private static void row(StaffOrderDtos.StaffOrderRow row, CommerceOrder order, List<CommerceOrderLine> lines,
                            List<CommerceReturn> returns) {
        row.setRefundOpen(nz(order.getRefundDue()).subtract(nz(order.getRefundCommitted())));
        row.setRefundState(refundState(order.getAmountPaid(), order.getRefundCommitted(), order.getAmountRefunded()));
        row.setReturnState(returnState(lines, returns));
    }

    private static boolean returnable(CommerceOrder order, List<CommerceOrderLine> lines,
                                      List<CommerceReturn> returns) {
        if (!"DELIVERED".equals(order.getStatus()) || "POS".equals(order.getChannel())) {
            return false;
        }
        if (!"PAID".equals(order.getPaymentStatus()) && !CommerceReturnDueService.dueDeferred(order)) {
            return false;
        }
        int shipped = 0;
        int returned = 0;
        for (CommerceOrderLine line : lines) {
            if (CommerceOrderLine.TYPE_ITEM.equals(line.getLineType())) {
                shipped += line.getQtyShipped() == null ? 0 : line.getQtyShipped();
                returned += line.getQtyReturned() == null ? 0 : line.getQtyReturned();
            }
        }
        return returned < shipped;
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(2) : value;
    }
}
