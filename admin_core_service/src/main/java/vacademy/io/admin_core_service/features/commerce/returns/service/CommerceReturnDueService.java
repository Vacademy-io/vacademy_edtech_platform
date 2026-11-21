package vacademy.io.admin_core_service.features.commerce.returns.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnStatus;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceRefundRepository;
import vacademy.io.admin_core_service.features.commerce.returns.repository.CommerceReturnRepository;

import java.math.BigDecimal;
import java.util.Date;

/**
 * The money of received returns on their order, in the caller's transaction and under the
 * caller's lock of the order row:
 * <ul>
 *   <li>{@link #raiseDeferred}: a cash-on-delivery order returned before the courier paid us had
 *       nothing to give back; when its remittance is recorded the rest of each return's credit is
 *       raised into {@code refund_due} (key {@code RET:<return>:R}).</li>
 *   <li>{@link #closeReady}: a RECEIVED return is CLOSED once its money went back: the refunds
 *       naming it reach what it raised, or the order's whole due is refunded.</li>
 * </ul>
 */
@Slf4j
@Service
public class CommerceReturnDueService {

    private final CommerceReturnRepository returnRepository;
    private final CommerceRefundRepository refundRepository;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderDeskService desk;

    public CommerceReturnDueService(CommerceReturnRepository returnRepository,
                                    CommerceRefundRepository refundRepository,
                                    CommerceOrderRepository orderRepository, CommerceOrderDeskService desk) {
        this.returnRepository = returnRepository;
        this.refundRepository = refundRepository;
        this.orderRepository = orderRepository;
        this.desk = desk;
    }

    /** True while a cash-on-delivery order waits for its remittance: what it owes back waits too. */
    public static boolean dueDeferred(CommerceOrder order) {
        return "COD".equals(order.getPaymentMethod()) && "UNPAID".equals(order.getPaymentStatus())
                && !StringUtils.hasText(order.getCodRemittanceId());
    }

    /**
     * Called by the COD remittance after the order was marked paid (same transaction, order
     * locked): every RECEIVED return of the order with credit not yet raised, oldest first, raises
     * the rest (capped by what was paid). Saves the order when it changed.
     */
    public void raiseDeferred(CommerceOrder order) {
        boolean changed = false;
        for (CommerceReturn ret : returnRepository.lockReceivedOfOrder(order.getId())) {
            BigDecimal rest = ret.getCreditTotal().subtract(ret.getDueRaised());
            if (rest.signum() <= 0) {
                continue;
            }
            BigDecimal before = nz(order.getRefundDue());
            desk.raiseRefundDue(order, rest, "RET:" + ret.getId() + ":R",
                    "A returned cash-on-delivery order was remitted.");
            BigDecimal raised = nz(order.getRefundDue()).subtract(before);
            if (raised.signum() > 0) {
                ret.setDueRaised(ret.getDueRaised().add(raised));
                returnRepository.save(ret);
                changed = true;
                log.info("Commerce return {} of order {}: {} raised at remittance", ret.getReturnNumber(),
                        order.getOrderNumber(), raised);
            }
        }
        if (changed) {
            orderRepository.save(order);
        }
    }

    /**
     * CLOSES each RECEIVED return of the order whose money went back. A return of a COD order not
     * yet remitted waits for the remittance (its due is not raised yet), unless it is worth
     * nothing. Returns how many were closed.
     */
    public int closeReady(CommerceOrder order) {
        int closed = 0;
        boolean orderSettled = nz(order.getAmountRefunded()).compareTo(nz(order.getRefundDue())) == 0
                && nz(order.getRefundCommitted()).compareTo(nz(order.getRefundDue())) == 0;
        for (CommerceReturn ret : returnRepository.lockReceivedOfOrder(order.getId())) {
            if (readyToClose(order, ret, orderSettled)) {
                ret.setStatus(ReturnStatus.CLOSED.name());
                ret.setClosedAt(new Date());
                returnRepository.save(ret);
                closed++;
            }
        }
        return closed;
    }

    boolean readyToClose(CommerceOrder order, CommerceReturn ret, boolean orderSettled) {
        if (!ReturnStatus.RECEIVED.name().equals(ret.getStatus())) {
            return false;
        }
        if (ret.getCreditTotal().signum() == 0) {
            return true;
        }
        if (dueDeferred(order)) {
            return false;
        }
        if (orderSettled) {
            return true;
        }
        BigDecimal paidBack = refundRepository.sumProcessedOfReturn(ret.getId());
        return paidBack != null && paidBack.compareTo(ret.getDueRaised()) >= 0;
    }

    static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO.setScale(2) : value;
    }
}
