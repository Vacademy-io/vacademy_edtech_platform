package vacademy.io.notification_service.features.announcements;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.service.SSEConnectionManager;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * A dead emitter (send() throws) used to be dropped via iterator.remove() on a CopyOnWriteArraySet, which
 * throws UnsupportedOperationException — aborting the fan-out for every later recipient and leaving the
 * dead emitter registered, so the user stayed "online" and never got an offline push.
 */
class SSEConnectionManagerDeadEmitterTest {

    private SSEConnectionManager manager;

    @BeforeEach
    void setUp() {
        manager = new SSEConnectionManager();
        ReflectionTestUtils.setField(manager, "sseTimeout", 60_000L);
        ReflectionTestUtils.setField(manager, "maxConnectionsPerUser", 5);
    }

    private AnnouncementEvent chatEvent() {
        return AnnouncementEvent.builder()
                .type(EventType.CHAT_MESSAGE)
                .modeType(ModeType.CHAT)
                .instituteId("inst")
                .eventId("e1")
                .build();
    }

    @Test
    @DisplayName("a dead emitter is dropped without aborting delivery to later users")
    void deadEmitterDoesNotAbortFanout() {
        SseEmitter dead = manager.createConnection("u1", "inst");
        manager.createConnection("u2", "inst");
        dead.complete(); // any further send() now throws IllegalStateException

        assertThatCode(() -> manager.sendToUsers(List.of("u1", "u2"), chatEvent())).doesNotThrowAnyException();

        assertThat(manager.isUserOnline("u1")).as("dead-only user is no longer reported online").isFalse();
        assertThat(manager.isUserOnline("u2")).isTrue();
    }

    @Test
    @DisplayName("only the dead emitter is removed when a user has several connections")
    void keepsLiveConnectionsOfSameUser() {
        SseEmitter dead = manager.createConnection("u1", "inst");
        manager.createConnection("u1", "inst");
        dead.complete();

        manager.sendToUser("u1", chatEvent());

        assertThat(manager.isUserOnline("u1")).isTrue();
    }
}
