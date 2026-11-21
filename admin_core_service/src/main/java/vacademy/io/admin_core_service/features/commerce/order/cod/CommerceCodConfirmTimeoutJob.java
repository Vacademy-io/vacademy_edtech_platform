package vacademy.io.admin_core_service.features.commerce.order.cod;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderInvoiceBacklog;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.enums.CancelReason;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.common.logging.SentryLogger;

import java.util.Date;
import java.util.List;

/**
 * Cancels a cash-on-delivery order that staff did not confirm in time
 * ({@code cod.confirmWithinHours} after it was placed; {@code cod_confirm_due_at}). Every five
 * minutes, at most {@value #BATCH} orders a run, each in its own transaction: the order is
 * locked and read again, and only an order still COD_PENDING_CONFIRMATION and due is cancelled
 * (row 2 of the desk table, reason COD_NOT_CONFIRMED, no actor): its stock goes back on sale in
 * that transaction, the COD tender is voided, the plans are cancelled and the coupon use given
 * back. One order that fails does not stop the others; it is left alone for 1 h, 4 h, 16 h,
 * then 24 h ({@code sweep_failures}, {@code sweep_retry_after}) and read after the orders that
 * never failed, so orders that always fail never fill the batch ahead of the orders of other
 * shops. A cancel clears the count. The ShedLock keeps the pods from running the same sweep.
 */
@Slf4j
@Component
public class CommerceCodConfirmTimeoutJob {

    static final int BATCH = 100;

    private final CommerceCodRemittanceRepository queries;
    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderDeskService desk;
    private final TransactionTemplate ownTransaction;

    public CommerceCodConfirmTimeoutJob(CommerceCodRemittanceRepository queries,
                                        CommerceOrderRepository orderRepository, CommerceOrderDeskService desk,
                                        PlatformTransactionManager transactionManager) {
        this.queries = queries;
        this.orderRepository = orderRepository;
        this.desk = desk;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Scheduled(cron = "${commerce.cod-confirm-timeout.cron:40 */5 * * * *}")
    @SchedulerLock(name = "CommerceCodConfirmTimeoutJob", lockAtMostFor = "PT4M", lockAtLeastFor = "PT20S")
    public void run() {
        try {
            sweep(new Date());
        } catch (Exception e) {
            log.error("COMMERCE_ALERT COD confirmation timeout job failed: {}", e.getMessage(), e);
            SentryLogger.logError(e, "Commerce COD confirmation timeout job failed");
        }
    }

    /** One run; returns how many orders were cancelled. Package-visible for the test. */
    int sweep(Date now) {
        List<String> due = ownTransaction.execute(status -> queries.findOrdersPastConfirmation(now, BATCH));
        int cancelled = 0;
        for (String orderId : due == null ? List.<String>of() : due) {
            try {
                Boolean done = ownTransaction.execute(status -> cancelIfDue(orderId, now));
                if (Boolean.TRUE.equals(done)) {
                    cancelled++;
                }
            } catch (Exception e) {
                log.error("COMMERCE_ALERT COD order {} is past its confirmation time and could not be cancelled: {}",
                        orderId, e.getMessage(), e);
                deferQuietly(orderId, now);
            }
        }
        if (cancelled > 0) {
            log.info("Commerce COD confirmation timeout: {} order(s) cancelled", cancelled);
        }
        return cancelled;
    }

    /** The failed order is left alone for a while; a failure to note that changes nothing else. */
    private void deferQuietly(String orderId, Date now) {
        CommerceOrderInvoiceBacklog.deferQuietly(orderRepository, ownTransaction, orderId, now, "cod_confirm");
    }

    /** Inside the order's transaction: cancelled only when still waiting and still due. */
    boolean cancelIfDue(String orderId, Date now) {
        CommerceOrder found = orderRepository.findById(orderId).orElse(null);
        if (found == null) {
            return false;
        }
        CommerceOrder order = desk.lockOrder(found.getInstituteId(), orderId);
        if (!CommerceOrderStatus.COD_PENDING_CONFIRMATION.name().equals(order.getStatus())
                || order.getCodConfirmDueAt() == null || order.getCodConfirmDueAt().after(now)) {
            return false; // confirmed, cancelled or given more time meanwhile
        }
        desk.cancel(order, desk.freshLines(orderId), CancelReason.COD_NOT_CONFIRMED, null,
                "Not confirmed in time");
        orderRepository.clearSweep(orderId);
        return true;
    }
}
