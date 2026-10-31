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
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.announcements.repository.RichTextDataRepository;
import vacademy.io.notification_service.features.chat.dto.ChatMessageResponse;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatConversationMember;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.enums.ChatMemberRole;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who may delete a chat message. The regression this guards: moderation used to be granted ONLY by an
 * active MODERATOR/OWNER member row, but an institute admin is shown every batch group whether or not
 * they ever joined one — so the admin of the institute was 403'd out of moderating it.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ChatMessageDeletePermissionTest {

    private static final String INSTITUTE = "inst-1";
    private static final String CONV = "conv-1";
    private static final String MSG = "msg-1";
    private static final String STUDENT = "student-1";
    private static final String ADMIN = "admin-1";

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

    private ChatConversation conversation(String type) {
        return ChatConversation.builder()
                .id(CONV).type(type).instituteId(INSTITUTE).lastMessageSeq(1L).build();
    }

    private void given(String convType, ChatConversationMember callerMember, String callerId) {
        when(convRepo.findById(CONV)).thenReturn(Optional.of(conversation(convType)));
        when(messageRepo.findById(MSG)).thenReturn(Optional.of(ChatMessage.builder()
                .id(MSG).conversationId(CONV).senderId(STUDENT).seq(1L).isDeleted(false).build()));
        when(messageRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(messageMapper.toResponse(any(ChatMessage.class)))
                .thenReturn(ChatMessageResponse.builder().id(MSG).conversationId(CONV).build());
        when(conversationService.getActiveMemberIds(CONV)).thenReturn(Collections.emptyList());
        when(memberRepo.findByConversationIdAndUserId(CONV, callerId))
                .thenReturn(Optional.ofNullable(callerMember));
        when(permissionService.canDeleteOwnMessage(any(), any())).thenReturn(true);
    }

    private ChatConversationMember member(String userId, ChatMemberRole role, boolean active) {
        return ChatConversationMember.builder()
                .conversationId(CONV).userId(userId).memberRole(role.name()).isActive(active).build();
    }

    @Test
    @DisplayName("the sender can always delete their own message")
    void senderDeletesOwn() {
        given(ChatConversationType.BATCH_GROUP.name(), member(STUDENT, ChatMemberRole.MEMBER, true), STUDENT);

        ChatMessageResponse res = service.deleteMessage(CONV, MSG, STUDENT, "STUDENT", INSTITUTE);

        assertThat(res.getId()).isEqualTo(MSG);
    }

    @Test
    @DisplayName("an institute admin with NO member row can still moderate a batch group")
    void observingAdminMayModerate() {
        given(ChatConversationType.BATCH_GROUP.name(), null, ADMIN);

        service.deleteMessage(CONV, MSG, ADMIN, "ADMIN", INSTITUTE);
    }

    @Test
    @DisplayName("an admin whose row is a plain MEMBER can still moderate a batch group")
    void adminStuckAsPlainMemberMayModerate() {
        given(ChatConversationType.BATCH_GROUP.name(), member(ADMIN, ChatMemberRole.MEMBER, true), ADMIN);

        service.deleteMessage(CONV, MSG, ADMIN, "ADMIN", INSTITUTE);
    }

    @Test
    @DisplayName("moderating NEVER rewrites the caller's membership row")
    void moderationDoesNotMutateMembership() {
        // The reconciler exempts every non-MEMBER row from batch roster clean-up, so persisting the
        // institute-role grant as a MODERATOR row would make that person un-removable from the batch.
        given(ChatConversationType.BATCH_GROUP.name(), member(ADMIN, ChatMemberRole.MEMBER, true), ADMIN);

        service.deleteMessage(CONV, MSG, ADMIN, "ADMIN", INSTITUTE);

        verify(conversationService, never()).ensureMember(any(), any(), any(), any());
        verify(memberRepo, never()).save(any());
    }

    @Test
    @DisplayName("an admin of ANOTHER institute cannot moderate this conversation")
    void crossTenantAdminRejected() {
        given(ChatConversationType.BATCH_GROUP.name(), null, ADMIN);

        assertThatThrownBy(() -> service.deleteMessage(CONV, MSG, ADMIN, "ADMIN", "other-institute"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("NOT_ALLOWED")
                .extracting(e -> ((ResponseStatusException) e).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("an admin cannot moderate a DIRECT thread they are not part of")
    void adminCannotModerateForeignDm() {
        given(ChatConversationType.DIRECT.name(), null, ADMIN);

        assertThatThrownBy(() -> service.deleteMessage(CONV, MSG, ADMIN, "ADMIN", INSTITUTE))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("NOT_ALLOWED");
    }

    @Test
    @DisplayName("DM behaviour is unchanged: even a participating admin cannot delete the other side's message")
    void adminCannotModerateOwnDm() {
        given(ChatConversationType.DIRECT.name(), member(ADMIN, ChatMemberRole.MEMBER, true), ADMIN);

        assertThatThrownBy(() -> service.deleteMessage(CONV, MSG, ADMIN, "ADMIN", INSTITUTE))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("NOT_ALLOWED");
    }

    @Test
    @DisplayName("an institute that turns off student self-delete is enforced server-side")
    void studentDeleteCanBeTurnedOffPerInstitute() {
        given(ChatConversationType.BATCH_GROUP.name(), member(STUDENT, ChatMemberRole.MEMBER, true), STUDENT);
        when(permissionService.canDeleteOwnMessage(INSTITUTE, "STUDENT")).thenReturn(false);

        assertThatThrownBy(() -> service.deleteMessage(CONV, MSG, STUDENT, "STUDENT", INSTITUTE))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("DELETE_NOT_ALLOWED");
    }

    @Test
    @DisplayName("turning off student self-delete never disarms a moderator deleting their own message")
    void selfDeleteFlagDoesNotDisarmModerators() {
        // The flag is student-scoped, but guard the interaction explicitly: a moderator's own message
        // must stay deletable even if the flag is somehow false for them.
        given(ChatConversationType.BATCH_GROUP.name(), member(STUDENT, ChatMemberRole.MODERATOR, true), STUDENT);
        when(permissionService.canDeleteOwnMessage(INSTITUTE, "ADMIN")).thenReturn(false);

        service.deleteMessage(CONV, MSG, STUDENT, "ADMIN", INSTITUTE);
    }

    @Test
    @DisplayName("a plain member cannot delete someone else's message")
    void memberCannotDeleteOthers() {
        given(ChatConversationType.BATCH_GROUP.name(), member("other-1", ChatMemberRole.MEMBER, true), "other-1");

        assertThatThrownBy(() -> service.deleteMessage(CONV, MSG, "other-1", "STUDENT", INSTITUTE))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("NOT_ALLOWED");
    }

    @Test
    @DisplayName("a DEACTIVATED moderator loses moderation rights")
    void inactiveModeratorRejected() {
        given(ChatConversationType.BATCH_GROUP.name(), member("mod-1", ChatMemberRole.MODERATOR, false), "mod-1");

        assertThatThrownBy(() -> service.deleteMessage(CONV, MSG, "mod-1", "TEACHER", INSTITUTE))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("NOT_ALLOWED");
    }
}
