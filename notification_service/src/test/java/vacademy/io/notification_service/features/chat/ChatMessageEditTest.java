package vacademy.io.notification_service.features.chat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.announcements.entity.RichTextData;
import vacademy.io.notification_service.features.announcements.repository.RichTextDataRepository;
import vacademy.io.notification_service.features.chat.dto.ChatMessageResponse;
import vacademy.io.notification_service.features.chat.dto.EditChatMessageRequest;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;
import vacademy.io.notification_service.features.chat.repository.ChatConversationRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;
import vacademy.io.notification_service.features.chat.service.ChatConversationService;
import vacademy.io.notification_service.features.chat.service.ChatMessageMapper;
import vacademy.io.notification_service.features.chat.service.ChatMessageService;
import vacademy.io.notification_service.features.chat.service.ChatPermissionService;
import vacademy.io.notification_service.features.chat.service.ChatReportService;
import vacademy.io.notification_service.features.chat.service.ChatRulesService;

import java.util.Collections;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Editing a message you sent by mistake: who may do it, and what an edit must not become. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ChatMessageEditTest {

    private static final String INSTITUTE = "inst-1";
    private static final String CONV = "conv-1";
    private static final String MSG = "msg-1";
    private static final String RT = "rt-1";
    private static final String SENDER = "sender-1";

    @Mock private ChatConversationRepository convRepo;
    @Mock private ChatConversationMemberRepository memberRepo;
    @Mock private ChatMessageRepository messageRepo;
    @Mock private RichTextDataRepository richTextRepo;
    @Mock private ChatConversationService conversationService;
    @Mock private ChatPermissionService permissionService;
    @Mock private ChatRulesService rulesService;
    @Mock private ChatReportService reportService;
    @Mock private ChatMessageMapper messageMapper;
    @Mock private ApplicationEventPublisher eventPublisher;

    @InjectMocks private ChatMessageService service;

    private RichTextData richText;

    private ChatMessage given(boolean deleted, long seq) {
        when(convRepo.findById(CONV)).thenReturn(Optional.of(ChatConversation.builder()
                .id(CONV).type(ChatConversationType.BATCH_GROUP.name())
                .instituteId(INSTITUTE).lastMessageSeq(seq).build()));
        when(permissionService.isChatEnabled(INSTITUTE)).thenReturn(true);

        ChatMessage msg = ChatMessage.builder()
                .id(MSG).conversationId(CONV).senderId(SENDER).richTextId(RT)
                .contentType("TEXT").seq(seq).isDeleted(deleted).isEdited(false).isFlagged(false).build();
        when(messageRepo.findById(MSG)).thenReturn(Optional.of(msg));
        when(messageRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        richText = new RichTextData("text", "teh meeting is at 5");
        when(richTextRepo.findById(RT)).thenReturn(Optional.of(richText));
        when(richTextRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        when(rulesService.enforceBeforeEdit(any(), anyString()))
                .thenReturn(ChatRulesService.ModerationResult.clean());
        when(permissionService.canEditOwnMessage(any(), any())).thenReturn(true);
        when(messageMapper.toResponse(any(ChatMessage.class), any()))
                .thenReturn(ChatMessageResponse.builder().id(MSG).conversationId(CONV).isEdited(true).build());
        when(messageMapper.toResponse(any(ChatMessage.class)))
                .thenReturn(ChatMessageResponse.builder().id(MSG).conversationId(CONV).build());
        when(conversationService.getActiveMemberIds(CONV)).thenReturn(Collections.emptyList());
        return msg;
    }

    private EditChatMessageRequest req(String text) {
        EditChatMessageRequest r = new EditChatMessageRequest();
        r.setText(text);
        return r;
    }

    @Test
    @DisplayName("the sender rewrites their own message and it is marked edited")
    void senderEditsOwnMessage() {
        ChatMessage msg = given(false, 1L);

        service.editMessage(CONV, MSG, SENDER, "STUDENT", req("the meeting is at 6"));

        assertThat(richText.getContent()).isEqualTo("the meeting is at 6");
        assertThat(msg.getIsEdited()).isTrue();
        // seq and created_at are untouched, so the message stays where it is in the thread.
        assertThat(msg.getSeq()).isEqualTo(1L);
    }

    @Test
    @DisplayName("nobody but the sender can edit — a moderator deletes, never rewrites")
    void othersCannotEdit() {
        given(false, 1L);

        assertThatThrownBy(() -> service.editMessage(CONV, MSG, "moderator-1", "ADMIN", req("different words")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("NOT_THE_SENDER");
        assertThat(richText.getContent()).isEqualTo("teh meeting is at 5");
    }

    @Test
    @DisplayName("a deleted message cannot be resurrected by editing it")
    void deletedMessageCannotBeEdited() {
        given(true, 1L);

        assertThatThrownBy(() -> service.editMessage(CONV, MSG, SENDER, "STUDENT", req("back again")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("MESSAGE_DELETED");
    }

    @Test
    @DisplayName("an edit cannot blank a message — deleting is how you remove one")
    void emptyEditRejected() {
        given(false, 1L);

        assertThatThrownBy(() -> service.editMessage(CONV, MSG, SENDER, "STUDENT", req("   ")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("EMPTY_MESSAGE");
    }

    @Test
    @DisplayName("re-saving the same text is a no-op: no edited marker, no fan-out")
    void unchangedTextIsANoOp() {
        ChatMessage msg = given(false, 1L);

        service.editMessage(CONV, MSG, SENDER, "STUDENT", req("teh meeting is at 5"));

        assertThat(msg.getIsEdited()).isFalse();
        verify(messageRepo, never()).save(any());
        verify(eventPublisher, never()).publishEvent(any());
    }

    @Test
    @DisplayName("editing re-runs the CONTENT rules, so it can't smuggle past the keyword filter")
    void editReRunsContentModeration() {
        ChatMessage msg = given(false, 1L);
        when(rulesService.enforceBeforeEdit(any(), anyString()))
                .thenReturn(new ChatRulesService.ModerationResult(true, "Matched banned keyword: spam"));

        service.editMessage(CONV, MSG, SENDER, "STUDENT", req("now with spam"));

        assertThat(msg.getIsFlagged()).isTrue();
        verify(reportService).createSystemFlag(any(), any(), anyString());
    }

    @Test
    @DisplayName("an institute that turns off student self-edit is enforced server-side")
    void studentEditCanBeTurnedOffPerInstitute() {
        given(false, 1L);
        when(permissionService.canEditOwnMessage(INSTITUTE, "STUDENT")).thenReturn(false);

        assertThatThrownBy(() -> service.editMessage(CONV, MSG, SENDER, "STUDENT", req("new text")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("EDIT_NOT_ALLOWED");
        assertThat(richText.getContent()).isEqualTo("teh meeting is at 5");
    }

    @Test
    @DisplayName("chat being switched off for the institute blocks edits too")
    void chatDisabledBlocksEdit() {
        given(false, 1L);
        when(permissionService.isChatEnabled(INSTITUTE)).thenReturn(false);

        assertThatThrownBy(() -> service.editMessage(CONV, MSG, SENDER, "STUDENT", req("anything")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("CHAT_DISABLED");
    }

    @Test
    @DisplayName("editing the newest message refreshes the conversation-list preview")
    void latestMessageRefreshesPreview() {
        given(false, 7L);

        service.editMessage(CONV, MSG, SENDER, "STUDENT", req("the meeting is at 6"));

        verify(convRepo).save(any());
    }

    @Test
    @DisplayName("editing an OLDER message leaves the list preview alone")
    void olderMessageLeavesPreviewAlone() {
        given(false, 3L);
        when(convRepo.findById(CONV)).thenReturn(Optional.of(ChatConversation.builder()
                .id(CONV).type(ChatConversationType.BATCH_GROUP.name())
                .instituteId(INSTITUTE).lastMessageSeq(9L).build()));

        service.editMessage(CONV, MSG, SENDER, "STUDENT", req("the meeting is at 6"));

        verify(convRepo, never()).save(any());
    }
}
