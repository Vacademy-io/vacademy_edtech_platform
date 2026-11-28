package vacademy.io.notification_service.features.chat.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.entity.RichTextData;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.repository.RichTextDataRepository;
import vacademy.io.notification_service.features.chat.dto.ChatMessagePageResponse;
import vacademy.io.notification_service.features.chat.dto.EditChatMessageRequest;
import vacademy.io.notification_service.features.chat.dto.ChatMessagePayload;
import vacademy.io.notification_service.features.chat.dto.ChatMessageResponse;
import vacademy.io.notification_service.features.chat.dto.SendChatMessageRequest;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatConversationMember;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.enums.ChatMemberRole;
import vacademy.io.notification_service.features.chat.event.ChatFanoutEvent;
import vacademy.io.notification_service.features.chat.repository.ChatConversationMemberRepository;
import vacademy.io.notification_service.features.chat.repository.ChatConversationRepository;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatMessageService {

    private final ChatConversationRepository convRepo;
    private final ChatConversationMemberRepository memberRepo;
    private final ChatMessageRepository messageRepo;
    private final RichTextDataRepository richTextRepo;
    private final ChatConversationService conversationService;
    private final ChatPermissionService permissionService;
    private final ChatRulesService rulesService;
    private final ChatReportService reportService;
    private final ChatMessageMapper messageMapper;
    private final ApplicationEventPublisher eventPublisher;

    // ---------------------------------------------------------------------
    // Send
    // ---------------------------------------------------------------------

    @Transactional
    public ChatMessageResponse send(String conversationId, String userId, String userRole, String userName,
                                    SendChatMessageRequest req) {
        // Idempotency: a retried POST with the same key returns the original message.
        if (req.getClientDedupKey() != null && !req.getClientDedupKey().isBlank()) {
            Optional<ChatMessage> dup = messageRepo.findByConversationIdAndSenderIdAndClientDedupKey(
                    conversationId, userId, req.getClientDedupKey());
            if (dup.isPresent()) {
                return messageMapper.toResponse(dup.get());
            }
        }

        // Lock the conversation row to serialize seq assignment.
        ChatConversation conv = convRepo.findByIdForUpdate(conversationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));

        // Institute kill-switch: settings.chat.enabled = false disables all sends.
        if (!permissionService.isChatEnabled(conv.getInstituteId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CHAT_DISABLED");
        }

        ChatConversationMember member = resolveCallerMemberForSend(conv, userId, userRole, userName);
        enforcePostPermission(conv, userRole, member);

        boolean hasText = req.getText() != null && !req.getText().isBlank();
        boolean hasAttachment = req.getAttachmentUrl() != null && !req.getAttachmentUrl().isBlank();
        if (!hasText && !hasAttachment) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "EMPTY_MESSAGE");
        }

        // Reply target must be a live message in THIS conversation (no cross-conversation leakage).
        if (req.getReplyToMessageId() != null && !req.getReplyToMessageId().isBlank()) {
            ChatMessage replyTarget = messageRepo.findById(req.getReplyToMessageId()).orElse(null);
            if (replyTarget == null || Boolean.TRUE.equals(replyTarget.getIsDeleted())
                    || !conversationId.equals(replyTarget.getConversationId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "REPLY_TARGET_INVALID");
            }
        }

        // Community rules (acknowledgement, slow-mode, links/attachments, banned keywords).
        ChatRulesService.ModerationResult moderation =
                rulesService.enforceBeforeSend(conv, member, req.getContentType(), req.getText(), hasAttachment);

        // Institute attachment rules.
        String attachErr = permissionService.checkAttachment(conv.getInstituteId(), req.getContentType(), req.getAttachmentSize());
        if (attachErr != null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, attachErr);
        }

        String richTextId = null;
        if (hasText) {
            RichTextData rt = new RichTextData(req.getRichTextType() != null ? req.getRichTextType() : "text", req.getText());
            richTextId = richTextRepo.save(rt).getId();
        }

        long seq = (conv.getLastMessageSeq() == null ? 0L : conv.getLastMessageSeq()) + 1;

        ChatMessage msg = ChatMessage.builder()
                .conversationId(conversationId)
                .senderId(userId)
                .senderName(userName)
                .senderRole(ChatPermissionService.normalizeRole(userRole).toUpperCase())
                .contentType(req.getContentType() == null ? "TEXT" : req.getContentType().toUpperCase())
                .richTextId(richTextId)
                .attachmentUrl(req.getAttachmentUrl())
                .attachmentName(req.getAttachmentName())
                .attachmentMime(req.getAttachmentMime())
                .attachmentSize(req.getAttachmentSize())
                .replyToMessageId(req.getReplyToMessageId())
                .clientDedupKey(req.getClientDedupKey())
                .seq(seq)
                .isEdited(false)
                .isDeleted(false)
                .isFlagged(moderation.flagged())
                .flagReason(moderation.reason())
                .createdAt(LocalDateTime.now())
                .updatedAt(LocalDateTime.now())
                .build();

        // On a concurrent dedup-key race the unique index throws DataIntegrityViolationException, which
        // poisons this transaction (rollback-only). We must NOT recover here — let it propagate and have
        // the controller re-query the winning message in a fresh transaction (see getByDedupKey).
        msg = messageRepo.saveAndFlush(msg);

        // Denormalized conversation summary for the list view.
        conv.setLastMessageSeq(seq);
        conv.setLastMessageAt(msg.getCreatedAt());
        conv.setLastMessagePreview(buildPreview(req.getText(), msg.getContentType()));
        conv.setLastMessageSenderId(userId);
        convRepo.save(conv);

        // Sender has implicitly read their own message.
        member.setLastReadSeq(seq);
        member.setLastReadMessageId(msg.getId());
        member.setLastReadAt(LocalDateTime.now());
        memberRepo.save(member);

        if (moderation.flagged()) {
            reportService.createSystemFlag(conv, msg, moderation.reason());
        }

        ChatMessageResponse response = messageMapper.toResponse(msg, req.getText());
        publishFanout(conv, userId, response);
        return response;
    }

    /**
     * Fresh-transaction recovery for a lost idempotency race: returns the message the winner persisted
     * for this (conversation, sender, clientDedupKey). Used by the controller after a
     * DataIntegrityViolationException from send().
     */
    @Transactional(readOnly = true)
    public ChatMessageResponse getByDedupKey(String conversationId, String userId, String clientDedupKey) {
        return messageRepo.findByConversationIdAndSenderIdAndClientDedupKey(conversationId, userId, clientDedupKey)
                .map(messageMapper::toResponse)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "MESSAGE_CREATE_RACE"));
    }

    // ---------------------------------------------------------------------
    // Edit
    // ---------------------------------------------------------------------

    /**
     * Rewrite the body of a message you sent — the "sent it by mistake" fix.
     *
     * SENDER ONLY, deliberately: a moderator can take a message down, but nobody may put different
     * words in someone else's mouth. The edit is marked with {@code isEdited} so readers can see the
     * message changed, keeps its seq/created_at (so it stays put in the thread rather than jumping to
     * the bottom), and re-runs the CONTENT moderation rules so an edit can't smuggle past the banned
     * keyword / link filters.
     */
    @Transactional
    public ChatMessageResponse editMessage(String conversationId, String messageId, String userId,
                                           String userRole, EditChatMessageRequest req) {
        ChatConversation conv = convRepo.findById(conversationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));

        // Institute kill-switch: if chat is off, it is off for edits too.
        if (!permissionService.isChatEnabled(conv.getInstituteId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CHAT_DISABLED");
        }

        ChatMessage msg = messageRepo.findById(messageId)
                .filter(m -> conversationId.equals(m.getConversationId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND"));

        if (!userId.equals(msg.getSenderId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_THE_SENDER");
        }
        // Institute setting (students only) — enforced HERE, not just hidden in the client.
        if (!permissionService.canEditOwnMessage(conv.getInstituteId(), userRole)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "EDIT_NOT_ALLOWED");
        }
        if (Boolean.TRUE.equals(msg.getIsDeleted())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MESSAGE_DELETED");
        }

        String text = req.getText() == null ? "" : req.getText().trim();
        if (text.isBlank()) {
            // Clearing the body would leave a blank bubble; deleting is the way to remove a message.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "EMPTY_MESSAGE");
        }

        // No-op edit: don't burn an "edited" marker (or a fan-out) on unchanged text.
        String current = msg.getRichTextId() == null ? null
                : richTextRepo.findById(msg.getRichTextId()).map(RichTextData::getContent).orElse(null);
        if (text.equals(current)) {
            return messageMapper.toResponse(msg, current);
        }

        ChatRulesService.ModerationResult moderation = rulesService.enforceBeforeEdit(conv, text);

        if (msg.getRichTextId() != null) {
            RichTextData rt = richTextRepo.findById(msg.getRichTextId()).orElse(null);
            if (rt != null) {
                rt.setContent(text);
                if (req.getRichTextType() != null) {
                    rt.setType(req.getRichTextType());
                }
                richTextRepo.save(rt);
            } else {
                msg.setRichTextId(richTextRepo.save(
                        new RichTextData(req.getRichTextType() != null ? req.getRichTextType() : "text", text)).getId());
            }
        } else {
            // Attachment-only message gaining a caption.
            msg.setRichTextId(richTextRepo.save(
                    new RichTextData(req.getRichTextType() != null ? req.getRichTextType() : "text", text)).getId());
        }

        msg.setIsEdited(true);
        if (moderation.flagged()) {
            msg.setIsFlagged(true);
            msg.setFlagReason(moderation.reason());
        }
        msg = messageRepo.save(msg);

        // The list view's denormalized preview is only this message's if it is still the latest one.
        if (msg.getSeq() != null && msg.getSeq().equals(conv.getLastMessageSeq())) {
            conv.setLastMessagePreview(buildPreview(text, msg.getContentType()));
            convRepo.save(conv);
        }

        if (moderation.flagged()) {
            reportService.createSystemFlag(conv, msg, moderation.reason());
        }

        ChatMessageResponse response = messageMapper.toResponse(msg, text);
        publishUpdateFanout(conv, userId, msg, response);
        return response;
    }

    // ---------------------------------------------------------------------
    // Soft delete (tombstone)
    // ---------------------------------------------------------------------

    @Transactional
    public ChatMessageResponse deleteMessage(String conversationId, String messageId, String userId,
                                             String userRole, String instituteId) {
        ChatConversation conv = convRepo.findById(conversationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));
        ChatMessage msg = messageRepo.findById(messageId)
                .filter(m -> conversationId.equals(m.getConversationId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND"));

        // Sender may delete their own message; otherwise the caller must be able to moderate here.
        boolean isSender = userId.equals(msg.getSenderId());
        if (isSender) {
            // Institute setting (students only). A moderator deleting their OWN message is unaffected:
            // the flag never applies to teachers/admins, and moderation is a separate authority below.
            if (!permissionService.canDeleteOwnMessage(conv.getInstituteId(), userRole)
                    && !canModerate(conv, userId, userRole, instituteId)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "DELETE_NOT_ALLOWED");
            }
        } else if (!canModerate(conv, userId, userRole, instituteId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_ALLOWED");
        }

        msg.setIsDeleted(true);
        msg.setRichTextId(null);
        msg.setAttachmentUrl(null);
        msg.setAttachmentName(null);
        msg.setAttachmentMime(null);
        msg.setAttachmentSize(null);
        msg = messageRepo.save(msg);

        // Re-render the tombstone on every other client.
        ChatMessageResponse response = messageMapper.toResponse(msg);
        publishUpdateFanout(conv, userId, msg, response);
        return response;
    }

    /**
     * Can this caller moderate (delete anyone's message in) this conversation?
     *
     * TWO independent grants, because the member row alone is not enough:
     *   1. an active MODERATOR/OWNER member row, or
     *   2. the institute ADMIN role, scoped to this conversation's institute, on a GROUP channel.
     *
     * (2) exists because an admin sees every batch group in the institute whether or not they ever
     * joined one ({@code addRoleVisibleBatches}) — with no member row a member-only check 403s the
     * institute's own administrator out of moderating their own institute.
     *
     * Deliberately evaluated from the token on every request and NOT written back as a MODERATOR
     * member row: the reconciler exempts non-MEMBER rows from roster clean-up, so persisting the grant
     * would make anyone it touched permanently un-removable from the batch — and an admin whose role
     * is later revoked would keep moderating. DIRECT threads are excluded outright; a DM is private to
     * its two participants and only its sender may delete from it, exactly as before.
     */
    private boolean canModerate(ChatConversation conv, String userId, String userRole, String instituteId) {
        boolean isConversationModerator = memberRepo.findByConversationIdAndUserId(conv.getId(), userId)
                .filter(m -> Boolean.TRUE.equals(m.getIsActive()))
                .map(m -> ChatMemberRole.MODERATOR.name().equals(m.getMemberRole())
                        || ChatMemberRole.OWNER.name().equals(m.getMemberRole()))
                .orElse(false);
        if (isConversationModerator) {
            return true;
        }
        return "admin".equals(ChatPermissionService.normalizeRole(userRole))
                && instituteId != null && instituteId.equals(conv.getInstituteId())
                && !ChatConversationType.DIRECT.name().equals(conv.getType());
    }

    private ChatConversationMember resolveCallerMemberForSend(ChatConversation conv, String userId, String userRole, String userName) {
        if (ChatConversationType.COMMUNITY.name().equals(conv.getType())) {
            ChatMemberRole role = "admin".equals(ChatPermissionService.normalizeRole(userRole))
                    ? ChatMemberRole.MODERATOR : ChatMemberRole.MEMBER;
            return conversationService.ensureMember(conv, userId, userRole, role);
        }
        // DIRECT / BATCH_GROUP: caller must already be an active member (re-validated at send-time).
        ChatConversationMember member = memberRepo.findByConversationIdAndUserId(conv.getId(), userId)
                .filter(m -> Boolean.TRUE.equals(m.getIsActive())).orElse(null);
        if (member != null) {
            return member;
        }
        // An admin posting into a batch they can see but never opened: self-heal as MODERATOR (mirrors
        // getOrProvisionBatch), so the "admin sees every batch + can post" flow never 403s even if the
        // FE didn't provision membership first.
        if (ChatConversationType.BATCH_GROUP.name().equals(conv.getType())
                && "admin".equals(ChatPermissionService.normalizeRole(userRole))) {
            return conversationService.ensureMember(conv, userId, userRole, ChatMemberRole.MODERATOR);
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
    }

    private void enforcePostPermission(ChatConversation conv, String callerRole, ChatConversationMember member) {
        if (ChatConversationType.DIRECT.name().equals(conv.getType())) {
            ChatConversationMember other = memberRepo.findByConversationIdAndIsActiveTrue(conv.getId()).stream()
                    .filter(m -> !m.getUserId().equals(member.getUserId())).findFirst().orElse(null);
            if (!permissionService.canDirectMessage(conv.getInstituteId(), callerRole, other != null ? other.getUserRole() : null)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "DM_NOT_ALLOWED");
            }
        } else if (ChatConversationType.BATCH_GROUP.name().equals(conv.getType())) {
            if (!permissionService.canPostToBatch(conv.getInstituteId(), callerRole)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "POST_NOT_ALLOWED");
            }
        } else {
            if (!permissionService.canPostToCommunity(conv.getInstituteId(), callerRole)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "POST_NOT_ALLOWED");
            }
        }
    }

    private void publishFanout(ChatConversation conv, String senderId, ChatMessageResponse response) {
        publishFanout(conv, senderId, response, EventType.CHAT_MESSAGE, "chatmsg_" + response.getId());
    }

    /**
     * Fan out an in-place change to an existing message (edit / tombstone) as CHAT_MESSAGE_UPDATED.
     * Never as CHAT_MESSAGE — see the enum's javadoc: a client that treats this as a new arrival bumps
     * unread badges and rewrites the conversation-list preview with an older message.
     */
    private void publishUpdateFanout(ChatConversation conv, String actorId, ChatMessage msg,
                                     ChatMessageResponse response) {
        long stamp = msg.getUpdatedAt() == null ? 0L
                : msg.getUpdatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        publishFanout(conv, actorId, response, EventType.CHAT_MESSAGE_UPDATED,
                "chatmsgupd_" + response.getId() + "_" + stamp);
    }

    private void publishFanout(ChatConversation conv, String senderId, ChatMessageResponse response,
                               EventType type, String eventId) {
        AnnouncementEvent event = AnnouncementEvent.builder()
                .type(type)
                .modeType(ModeType.CHAT)
                .instituteId(conv.getInstituteId())
                .data(ChatMessagePayload.builder()
                        .conversationId(conv.getId())
                        .conversationType(conv.getType())
                        .message(response)
                        .build())
                .timestamp(LocalDateTime.now())
                .priority("MEDIUM")
                .eventId(eventId)
                .build();

        List<String> memberIds = ChatConversationType.COMMUNITY.name().equals(conv.getType())
                ? Collections.emptyList()
                : conversationService.getActiveMemberIds(conv.getId());
        eventPublisher.publishEvent(new ChatFanoutEvent(conv.getInstituteId(), conv.getType(), memberIds, event));
    }

    private String buildPreview(String text, String contentType) {
        if (text != null && !text.isBlank()) {
            String trimmed = text.trim();
            return trimmed.length() > 120 ? trimmed.substring(0, 120) : trimmed;
        }
        return switch (contentType == null ? "TEXT" : contentType.toUpperCase()) {
            case "IMAGE" -> "📷 Photo";
            case "FILE" -> "📎 Attachment";
            default -> "";
        };
    }

    // ---------------------------------------------------------------------
    // Fetch (keyset pagination)
    // ---------------------------------------------------------------------

    @Transactional(readOnly = true)
    public ChatMessagePageResponse getMessages(String conversationId, String userId, Long beforeCursor, Long sinceCursor, int limit) {
        ChatConversation conv = convRepo.findById(conversationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND"));
        // Membership gate (community is open to institute members who have a row once opened).
        if (!ChatConversationType.COMMUNITY.name().equals(conv.getType())
                && !memberRepo.existsByConversationIdAndUserIdAndIsActiveTrue(conversationId, userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        }

        int size = limit <= 0 ? 40 : Math.min(limit, 100);
        PageRequest page = PageRequest.of(0, size);
        List<ChatMessage> rows;
        boolean hasMore = false;

        if (sinceCursor != null) {
            // Catch-up: messages newer than the cursor (oldest first).
            rows = messageRepo.findByConversationIdAndSeqGreaterThanAndIsDeletedFalseOrderBySeqAsc(conversationId, sinceCursor, page);
        } else if (beforeCursor != null) {
            // Older page (newest-first from DB, reversed for rendering).
            rows = messageRepo.findByConversationIdAndSeqLessThanAndIsDeletedFalseOrderBySeqDesc(conversationId, beforeCursor, page);
            hasMore = rows.size() == size;
            Collections.reverse(rows);
        } else {
            // Latest page.
            rows = messageRepo.findByConversationIdAndIsDeletedFalseOrderBySeqDesc(conversationId, page);
            hasMore = rows.size() == size;
            Collections.reverse(rows);
        }

        List<ChatMessageResponse> messages = new ArrayList<>(rows.stream().map(messageMapper::toResponse).toList());
        Long oldestSeq = messages.isEmpty() ? null : messages.get(0).getSeq();
        Long latestSeq = messages.isEmpty() ? null : messages.get(messages.size() - 1).getSeq();
        return new ChatMessagePageResponse(messages, hasMore, oldestSeq, latestSeq);
    }
}
