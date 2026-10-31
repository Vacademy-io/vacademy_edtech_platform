package vacademy.io.notification_service.features.announcements.event;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.enums.ModeType;

/**
 * Fired when a user reads or dismisses a message, so the SSE receipt can be emitted AFTER the
 * write transaction commits instead of inside it.
 *
 * <p>Emitting inline held a Hikari connection (pool size 3) for the whole fan-out, which is how a
 * single read on a 1116-row announcement blocked a connection for 14 seconds. Carries the ids the
 * listener needs so it never has to re-read the row on the async thread.
 */
@Getter
public class MessageInteractionEvent extends ApplicationEvent {

    private final String announcementId;
    private final String recipientMessageId;
    private final String userId;
    private final EventType type;
    private final ModeType modeType;

    public MessageInteractionEvent(Object source, String announcementId, String recipientMessageId,
                                   String userId, EventType type, ModeType modeType) {
        super(source);
        this.announcementId = announcementId;
        this.recipientMessageId = recipientMessageId;
        this.userId = userId;
        this.type = type;
        this.modeType = modeType;
    }
}
