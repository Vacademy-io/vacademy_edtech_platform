package vacademy.io.admin_core_service.features.commerce.order.desk;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Order events for the buyer's messages (WP-33): published as Spring events once the
 * transaction that made the change has committed, so a rolled-back change sends nothing. No
 * listener exists yet. Never throws.
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

    /** One event. {@code notifyCustomer} false: staff asked that the buyer is not told. */
    public record OrderEvent(String type, String instituteId, String orderId, String orderNumber,
                             String shipmentId, boolean notifyCustomer) {
    }

    private final ApplicationEventPublisher publisher;

    public CommerceOrderEvents(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    /** Publishes after the current transaction commits; at once when there is none. */
    public void afterCommit(OrderEvent event) {
        if (event == null) {
            return;
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
