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
 * {@code allowAfterFullCredit}. Only orders changed within the last {@value #LOOKBACK_DAYS} days
 * are read (a pack that failed to invoice is noticed within minutes). An order whose repair
 * fails is left alone for {@value #RETRY_AFTER_MINUTES} minutes ({@code sweep_retry_after}), so
 * a few orders that always fail never hold up the orders of other shops behind them.
 */
@Slf4j
@Component
public class CommerceOrderInvoiceBacklog implements CommerceInvoiceBacklog {

    /** An order is left to its own transaction this long before the job looks at it. */
    static final long GRACE_MILLIS = 10L * 60 * 1000;
    static final int LOOKBACK_DAYS = 7;
    static final int RETRY_AFTER_MINUTES = 60;
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
        log.info("Commerce order {} ({}) got its invoice {} from the backlog", order.getOrderNumber(), orderId,
                invoice.getInvoiceNumber());
    }

    /** The failed order is left alone for a while; a failure to note that changes nothing else. */
    private void deferQuietly(String orderId) {
        try {
            Date until = new Date(System.currentTimeMillis() + RETRY_AFTER_MINUTES * 60L * 1000);
            ownTransaction.executeWithoutResult(status -> orderRepository.deferSweep(orderId, until));
        } catch (RuntimeException e) {
            log.warn("Commerce order {}: could not defer the invoice backlog retry: {}", orderId, e.getMessage());
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
