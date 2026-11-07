package vacademy.io.notification_service.features.chat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.chat.dto.ChatMessagePayload;
import vacademy.io.notification_service.features.chat.dto.ChatMessageResponse;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.event.ChatFanoutEvent;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;
import vacademy.io.notification_service.features.chat.service.ChatOfflinePushService;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Push decision: DIRECT/BATCH push every unread message; COMMUNITY pushes once per read cycle (only members
 * who had read up to the previous LIVE message — deleted ones never hold anyone back); messages deleted in the
 * grace window are not pushed; community fan-out runs on its own executor.
 */
class ChatOfflinePushDecisionTest {

    private static final String CID = "conv-1";

    private PushNotificationService push;
    private ChatConversationMemberRepository members;
    private ChatMessageRepository messages;
    private final List<String> ranOn = new CopyOnWriteArrayList<>();
    private ChatOfflinePushService service;

    @BeforeEach
    void setUp() {
        push = mock(PushNotificationService.class);
        members = mock(ChatConversationMemberRepository.class);
        messages = mock(ChatMessageRepository.class);
        Executor dmExecutor = r -> { ranOn.add("dm"); r.run(); };
        Executor communityExecutor = r -> { ranOn.add("community"); r.run(); };
        // readGraceMs stays 0 (no Spring @Value here), so the grace task runs right away.
        service = new ChatOfflinePushService(push, members, messages, dmExecutor, communityExecutor);
        // @Value defaults (no Spring context here).
        org.springframework.test.util.ReflectionTestUtils.setField(service, "batchPushMaxRecipients", 200);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "communityPushMaxRecipients", 500);
    }

    private ChatMessage live(long seq) {
        ChatMessage m = new ChatMessage();
        m.setId("m" + seq);
        m.setConversationId(CID);
        m.setSeq(seq);
        m.setIsDeleted(false);
        return m;
    }

    private void fanout(String type, long seq) {
        ChatMessageResponse msg = ChatMessageResponse.builder()
                .id("m" + seq).seq(seq).senderId("sender").senderName("Tech Team").content("hello").build();
        AnnouncementEvent event = AnnouncementEvent.builder()
                .type(EventType.CHAT_MESSAGE)
                .data(ChatMessagePayload.builder().conversationId(CID).message(msg).build())
                .build();
        service.onChatFanout(new ChatFanoutEvent("inst-1", type, List.of(), event));
    }

    private void awaitPush() {
        verify(members, timeout(2000)).findMemberIdsToNotify(eq(CID), anyLong(), anyLong());
    }

    @Test
    @DisplayName("COMMUNITY: lower bound is the previous live message, skipping a deleted one")
    void communityUsesPreviousLiveMessage() {
        when(messages.findById("m12")).thenReturn(Optional.of(live(12)));
        // seq 11 was deleted; the newest live message before 12 is 10.
        when(messages.findFirstByConversationIdAndSeqLessThanAndIsDeletedFalseOrderBySeqDesc(CID, 12L))
                .thenReturn(Optional.of(live(10)));
        when(members.findMemberIdsToNotify(CID, 12L, 10L)).thenReturn(List.of("learner-1", "sender"));

        fanout("COMMUNITY", 12);

        awaitPush();
        verify(members).findMemberIdsToNotify(CID, 12L, 10L);
        verify(push, timeout(2000)).sendNotificationToUsers(eq("inst-1"), eq(List.of("learner-1")),
                eq("Tech Team · Community"), eq("hello"), anyMap());
        org.assertj.core.api.Assertions.assertThat(ranOn).containsExactly("community");
    }

    @Test
    @DisplayName("DIRECT: every unread message pushes (no lower bound), on the DM executor")
    void directPushesEveryUnread() {
        when(messages.findById("m7")).thenReturn(Optional.of(live(7)));
        when(members.findMemberIdsToNotify(CID, 7L, -1L)).thenReturn(List.of("learner-1"));

        fanout("DIRECT", 7);

        awaitPush();
        verify(members).findMemberIdsToNotify(CID, 7L, -1L);
        verify(messages, never()).findFirstByConversationIdAndSeqLessThanAndIsDeletedFalseOrderBySeqDesc(any(), any());
        verify(push, timeout(2000)).sendNotificationToUsers(eq("inst-1"), eq(List.of("learner-1")),
                eq("Tech Team"), eq("hello"), anyMap());
        org.assertj.core.api.Assertions.assertThat(ranOn).containsExactly("dm");
    }

    @Test
    @DisplayName("a message deleted during the grace window is not pushed")
    void deletedInGraceWindowNotPushed() throws Exception {
        ChatMessage deleted = live(8);
        deleted.setIsDeleted(true);
        when(messages.findById("m8")).thenReturn(Optional.of(deleted));

        fanout("DIRECT", 8);

        verify(messages, timeout(2000)).findById("m8");
        Thread.sleep(100);
        verifyNoInteractions(push);
        verify(members, never()).findMemberIdsToNotify(any(), any(), any());
    }
}
