package vacademy.io.admin_core_service.features.commerce.order.desk;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.document.job.CommerceInvoiceBacklog;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.tax.enums.InvoiceAt;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;

import java.util.Date;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * The orders that should have an invoice and have none, for {@code CommerceInvoiceRetryJob}:
 * PACKED, SHIPPED and DELIVERED orders (pack issues the invoice in its own transaction, so one
 * of these without a live document is a rare repair), and CONFIRMED orders of a shop that
 * invoices at confirmation ({@code invoiceAt = CONFIRMED}), which no confirm path issues itself.
 *
 * <p>Each order is issued in its own transaction under the order row lock, from the remaining
 * tax of the order (placement less the cancelled units), exactly as pack does.
 *
 * <p>Only orders that never had an invoice are repaired: an order whose invoice was credited in
 * full (by hand, an RTO, an unpack) is not billed again, and the issue here never passes
 * {@code allowAfterFullCredit}. PACKED and later orders are read only when changed within the
 * last {@value #LOOKBACK_DAYS} days (a pack that failed to invoice is noticed within minutes); a
 * CONFIRMED order of a shop that invoices at confirmation is read whatever its age, since only
 * this job issues its invoice. An order whose repair fails is left alone for 1 h, 4 h, 16 h,
 * then 24 h ({@code sweep_failures}, {@code sweep_retry_after}), and orders that never failed
 * are read first, so a few orders that always fail never hold up the orders of other shops.
 * A success clears the count.
 */
@Slf4j
@Component
public class CommerceOrderInvoiceBacklog implements CommerceInvoiceBacklog {

    /** An order is left to its own transaction this long before the job looks at it. */
    static final long GRACE_MILLIS = 10L * 60 * 1000;
    static final int LOOKBACK_DAYS = 7;
    /** The deferral that turns daily: one alert line when an order reaches it. */
    static final int DAILY_AFTER_FAILURES = 4;
    private static final Set<CommerceOrderStatus> AFTER_PACK = EnumSet.of(CommerceOrderStatus.PACKED,
            CommerceOrderStatus.SHIPPED, CommerceOrderStatus.DELIVERED);

    private final CommerceOrderRepository orderRepository;
    private final CommerceOrderDeskService desk;
    private final CommerceTaxSettingService taxSettingService;
    private final TransactionTemplate ownTransaction;

    public CommerceOrderInvoiceBacklog(CommerceOrderRepository orderRepository, CommerceOrderDeskService desk,
                                       CommerceTaxSettingService taxSettingService,
                                       PlatformTransactionManager transactionManager) {
        this.orderRepository = orderRepository;
        this.desk = desk;
        this.taxSettingService = taxSettingService;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public List<String> findOrderIdsMissingInvoice(int limit) {
        int rows = Math.max(1, Math.min(limit, 500));
        long nowMillis = System.currentTimeMillis();
        Date now = new Date(nowMillis);
        Date before = new Date(nowMillis - GRACE_MILLIS);
        Date since = new Date(nowMillis - LOOKBACK_DAYS * 24L * 60 * 60 * 1000);
        List<String> ids = ownTransaction.execute(status -> orderRepository.findOrderIdsMissingInvoice(before, since,
                now, rows));
        return ids == null ? List.of() : ids;
    }

    @Override
    public void issueInvoiceFor(String orderId) {
        try {
            ownTransaction.executeWithoutResult(status -> issueInside(orderId));
        } catch (RuntimeException e) {
            deferQuietly(orderId);
            throw e;
        }
    }

    private void issueInside(String orderId) {
        CommerceOrder found = orderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalStateException("order " + orderId + " is gone"));
        CommerceOrder order = desk.lockOrder(found.getInstituteId(), orderId);
        if (!due(order)) {
            return; // moved on since it was listed (cancelled, unpacked, RTO)
        }
        if (orderRepository.countInvoicesEver(orderId) > 0) {
            return; // issued meanwhile, or credited: never billed twice from here
        }
        List<CommerceOrderLine> lines = desk.freshLines(orderId);
        if (desk.liveInvoice(order, lines) != null) {
            return; // issued meanwhile
        }
        Invoice invoice = desk.issueInvoice(order, lines, null, false);
        orderRepository.clearSweep(orderId);
        log.info("Commerce order {} ({}) got its invoice {} from the backlog", order.getOrderNumber(), orderId,
                invoice.getInvoiceNumber());
    }

    /** The failed order is left alone for a while; a failure to note that changes nothing else. */
    private void deferQuietly(String orderId) {
        deferQuietly(orderRepository, ownTransaction, orderId, new Date(), "invoice");
    }

    /**
     * One more failure of a sweep on the order (its own transaction, after the failed one rolled
     * back): the order is deferred by the backoff of {@code deferSweep}. The deferral that turns
     * daily is said once in an alert line. Shared with the COD confirmation timer.
     */
    public static void deferQuietly(CommerceOrderRepository orders, TransactionTemplate transaction, String orderId,
                                    Date now, String sweep) {
        try {
            Integer failures = transaction.execute(status -> {
                orders.deferSweep(orderId, now);
                return orders.sweepFailures(orderId);
            });
            if (failures != null && failures == DAILY_AFTER_FAILURES) {
                log.error("COMMERCE_ALERT sweep_backoff_daily order={} sweep={}", orderId, sweep);
            }
        } catch (RuntimeException e) {
            log.warn("Commerce order {}: could not defer the {} sweep retry: {}", orderId, sweep, e.getMessage());
        }
    }

    /** True when the order is past its invoice point now. */
    boolean due(CommerceOrder order) {
        CommerceOrderStatus status = CommerceOrderStatus.of(order.getStatus());
        if (AFTER_PACK.contains(status)) {
            return true;
        }
        return status == CommerceOrderStatus.CONFIRMED
                && taxSettingService.context(order.getInstituteId()).getInvoiceAt() == InvoiceAt.CONFIRMED;
    }
}
