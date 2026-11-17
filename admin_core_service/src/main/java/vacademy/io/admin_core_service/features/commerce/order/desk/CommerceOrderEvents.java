package vacademy.io.admin_core_service.features.commerce.order.desk;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationOutbox;

/**
 * Order events for the buyer's messages (WP-33). An event the buyer is told about first gets
 * its outbox row inside the transaction that made the change (so it commits with the change,
 * or not at all), then is published as a Spring event once that transaction has committed;
 * the listener sends at once and the notification job picks up whatever is left. Never throws
 * (the caller's pending changes are flushed before the outbox insert; a failure there is the
 * caller's own and surfaces as it would at its commit).
 */
@Slf4j
@Component
public class CommerceOrderEvents {

    public static final String ORDER_CONFIRMED = "ORDER_CONFIRMED";
    public static final String COD_CONFIRMATION_NEEDED = "COD_CONFIRMATION_NEEDED";
    public static final String ORDER_SHIPPED = "ORDER_SHIPPED";
    public static final String ORDER_DELIVERED = "ORDER_DELIVERED";
    public static final String ORDER_CANCELLED = "ORDER_CANCELLED";
    public static final String ORDER_RTO = "ORDER_RTO";
    /** A return was approved (WP-32): the buyer may send the goods. */
    public static final String RETURN_APPROVED = "RETURN_APPROVED";
    /** Money went back to the buyer (WP-32). */
    public static final String REFUND_PROCESSED = "REFUND_PROCESSED";
    /** A counter bill was issued to a buyer with a phone or e-mail (WP-33). */
    public static final String POS_BILL_ISSUED = "POS_BILL_ISSUED";

    /**
     * One event. {@code notifyCustomer} false: staff asked that the buyer is not told.
     * {@code refId}: the shipment, return or refund the event is about ('' for the order itself).
     */
    public record OrderEvent(String type, String instituteId, String orderId, String orderNumber,
                             String shipmentId, boolean notifyCustomer, String refId) {

        public OrderEvent {
            refId = refId == null ? "" : refId;
        }

        /** The six fields of before; the ref is the shipment. */
        public OrderEvent(String type, String instituteId, String orderId, String orderNumber, String shipmentId,
                          boolean notifyCustomer) {
            this(type, instituteId, orderId, orderNumber, shipmentId, notifyCustomer, shipmentId);
        }
    }

    private final ApplicationEventPublisher publisher;

    /** The outbox (absent in tests that build this class by hand). */
    private CommerceNotificationOutbox outbox;

    public CommerceOrderEvents(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Autowired(required = false)
    public void setOutbox(CommerceNotificationOutbox outbox) {
        this.outbox = outbox;
    }

    /**
     * Writes the outbox row (when the buyer is told), then publishes after the current transaction
     * commits; at once when there is none.
     */
    public void afterCommit(OrderEvent event) {
        if (event == null) {
            return;
        }
        if (outbox != null) {
            // Never fails the order change; only the flush of the caller's own pending changes
            // (which would fail at its commit anyway) can throw here.
            outbox.record(event);
        }
        try {
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        publish(event);
                    }
                });
            } else {
                publish(event);
            }
        } catch (RuntimeException e) {
            log.warn("Commerce order event {} of order {} not registered: {}", event.type(), event.orderId(),
                    e.getClass().getSimpleName());
        }
    }

    private void publish(OrderEvent event) {
        try {
            publisher.publishEvent(event);
        } catch (RuntimeException e) {
            log.warn("Commerce order event {} of order {} failed: {}", event.type(), event.orderId(),
                    e.getClass().getSimpleName());
        }
    }
}
