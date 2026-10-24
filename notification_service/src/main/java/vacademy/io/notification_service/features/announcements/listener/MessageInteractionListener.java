package vacademy.io.notification_service.features.announcements.listener;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.event.MessageInteractionEvent;
import vacademy.io.notification_service.features.announcements.service.AnnouncementEventService;

import java.util.Map;

/**
 * Emits read/dismiss receipts over SSE after the interaction has committed, on the shared async
 * pool, so the learner's request returns without waiting on socket writes.
 *
 * <p>The receipt goes to the announcement's creator only. Broadcasting "user X read this" to all
 * recipients told 93 learners something none of them asked for, leaked one learner's id and
 * reading habits to the other 92, and was the fan-out behind the 14s markAsRead.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MessageInteractionListener {

    private final AnnouncementEventService eventService;

    @Async("announcementDeliveryExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onMessageInteraction(MessageInteractionEvent e) {
        try {
            AnnouncementEvent event = AnnouncementEvent.builder()
                    .type(e.getType())
                    .announcementId(e.getAnnouncementId())
                    .data(Map.of(
                            "recipientMessageId", e.getRecipientMessageId(),
                            "userId", e.getUserId()))
                    .build();
            event.setModeType(e.getModeType());

            eventService.sendToAnnouncementCreator(e.getAnnouncementId(), event);
        } catch (Exception ex) {
            log.warn("Failed to emit {} receipt for message {}: {}",
                    e.getType(), e.getRecipientMessageId(), ex.toString());
        }
    }
}
