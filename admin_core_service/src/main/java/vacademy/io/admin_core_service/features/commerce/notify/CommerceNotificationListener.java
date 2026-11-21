package vacademy.io.admin_core_service.features.commerce.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskExecutor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;

/**
 * After an order change commits, its messages are sent on the notification executor, so the
 * request that made the change never waits for them. When the executor is full the task is
 * dropped: the notification job sends the rows within a minute.
 */
@Slf4j
@Component
public class CommerceNotificationListener {

    private final CommerceNotificationDispatcher dispatcher;
    private final TaskExecutor executor;

    public CommerceNotificationListener(CommerceNotificationDispatcher dispatcher,
                                        @Qualifier("commerceNotifyExecutor") TaskExecutor executor) {
        this.dispatcher = dispatcher;
        this.executor = executor;
    }

    @EventListener
    public void on(CommerceOrderEvents.OrderEvent event) {
        if (!CommerceNotificationOutbox.wanted(event) || !dispatcher.enabled()) {
            return;
        }
        String instituteId = event.instituteId();
        String orderId = event.orderId();
        try {
            executor.execute(() -> {
                try {
                    dispatcher.dispatchOrder(instituteId, orderId);
                } catch (RuntimeException e) {
                    log.warn("COMMERCE_NOTIFY dispatch of order {} failed: {}; the job retries", orderId,
                            e.getClass().getSimpleName());
                }
            });
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY executor full: order {} trigger {} left to the job", orderId, event.type());
        }
    }
}
