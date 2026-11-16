package vacademy.io.admin_core_service.features.commerce.order.desk;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository.ShortCandidate;

import java.util.Date;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * Marks open orders "stock short" when promised units of a variant left the shelf of the
 * location that fulfils them (a damage entry, a count, a receipt reversal), and when a ship is
 * refused by the ledger.
 *
 * <p>Always after the posting has committed, in a short transaction of its own: flagging inside
 * the posting would take an order row after {@code stock_level}, the reverse of the order
 * desk's lock order. It walks the open orders of the variant at the location, newest first,
 * locking each order and then its line, and puts the short units on {@code stock_short_qty}
 * until the shortfall is covered. Never throws.
 */
@Slf4j
@Component
public class CommerceStockShortFlagger {

    private static final Set<CommerceOrderStatus> OPEN = EnumSet.of(CommerceOrderStatus.COD_PENDING_CONFIRMATION,
            CommerceOrderStatus.CONFIRMED, CommerceOrderStatus.PACKED);

    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderLineRepository lineRepository;
    private final TransactionTemplate ownTransaction;

    @PersistenceContext
    private EntityManager entityManager;

    public CommerceStockShortFlagger(CommerceOrderRepository orderRepository, CommerceOrderLineRepository lineRepository,
                                     PlatformTransactionManager transactionManager) {
        this.orderRepository = orderRepository;
        this.lineRepository = lineRepository;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * After the current transaction commits (at once when there is none): {@code shortfall}
     * promised units of the variant left {@code locationId}.
     */
    public void afterCommit(String instituteId, String locationId, String packageSessionId, int shortfall) {
        if (shortfall <= 0 || instituteId == null || locationId == null || packageSessionId == null) {
            return;
        }
        Runnable flag = () -> flagShortfall(instituteId, locationId, packageSessionId, shortfall);
        try {
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        flag.run();
                    }
                });
            } else {
                flag.run();
            }
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT stock_short_not_flagged institute={} variant={} location={}", instituteId,
                    packageSessionId, locationId, e);
        }
    }

    /**
     * Flags the open orders; returns the units put on orders. In its own transaction; never throws.
     */
    public int flagShortfall(String instituteId, String locationId, String packageSessionId, int shortfall) {
        try {
            Integer flagged = ownTransaction.execute(status -> {
                int left = shortfall;
                List<ShortCandidate> candidates = orderRepository.findShortCandidates(instituteId, locationId,
                        packageSessionId);
                for (ShortCandidate candidate : candidates) {
                    if (left <= 0) {
                        break;
                    }
                    CommerceOrder order = lockFresh(candidate.getOrderId());
                    if (order == null || !OPEN.contains(CommerceOrderStatus.of(order.getStatus()))) {
                        continue;
                    }
                    CommerceOrderLine line = lineRepository.findById(candidate.getLineId()).orElse(null);
                    if (line == null) {
                        continue;
                    }
                    if (entityManager != null) {
                        entityManager.refresh(line);
                    }
                    int unflagged = line.openQuantity() - (line.getStockShortQty() == null ? 0 : line.getStockShortQty());
                    if (unflagged <= 0) {
                        continue;
                    }
                    int take = Math.min(unflagged, left);
                    line.setStockShortQty((line.getStockShortQty() == null ? 0 : line.getStockShortQty()) + take);
                    lineRepository.save(line);
                    if (!Boolean.TRUE.equals(order.getStockShort())) {
                        order.setStockShort(true);
                        order.setStockShortAt(new Date());
                        orderRepository.save(order);
                    }
                    left -= take;
                }
                return shortfall - left;
            });
            int done = flagged == null ? 0 : flagged;
            log.warn("COMMERCE_ALERT stock_short institute={} variant={} location={} short={} flagged_on_orders={}",
                    instituteId, packageSessionId, locationId, shortfall, done);
            return done;
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT stock_short_not_flagged institute={} variant={} location={}", instituteId,
                    packageSessionId, locationId, e);
            return 0;
        }
    }

    /** A ship the ledger refused: the order is flagged, in its own transaction. Never throws. */
    public void flagOrder(String instituteId, String orderId) {
        try {
            ownTransaction.executeWithoutResult(status -> {
                CommerceOrder order = lockFresh(orderId);
                if (order == null || !instituteId.equals(order.getInstituteId())
                        || Boolean.TRUE.equals(order.getStockShort())) {
                    return;
                }
                order.setStockShort(true);
                order.setStockShortAt(new Date());
                orderRepository.save(order);
            });
            log.warn("COMMERCE_ALERT stock_short_on_ship institute={} order={}", instituteId, orderId);
        } catch (RuntimeException e) {
            log.error("COMMERCE_ALERT stock_short_not_flagged institute={} order={}", instituteId, orderId, e);
        }
    }

    private CommerceOrder lockFresh(String orderId) {
        CommerceOrder order = orderRepository.lockById(orderId).orElse(null);
        if (order != null && entityManager != null) {
            entityManager.refresh(order);
        }
        return order;
    }
}
