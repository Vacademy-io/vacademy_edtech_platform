package vacademy.io.notification_service.features.chat.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.chat.dto.*;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.security.ChatIdentity;
import vacademy.io.notification_service.features.chat.service.ChatBatchService;
import vacademy.io.notification_service.features.chat.service.ChatConversationService;
import vacademy.io.notification_service.features.chat.service.ChatMessageService;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Identity (userId / instituteId / role / name) is derived from the authenticated principal + the
 * verified clientId header — never from request params. Any userId/userRole/instituteId query params
 * a client still sends are ignored.
 */
@RestController
@RequestMapping("/notification-service/v1/chat")
@RequiredArgsConstructor
@Slf4j
@Validated
@CrossOrigin(origins = "*")
public class ChatConversationController {

    private final ChatConversationService conversationService;
    private final ChatMessageService messageService;
    private final ChatBatchService batchService;

    @GetMapping("/conversations")
    public ResponseEntity<List<ChatConversationResponse>> listConversations(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "30") int limit) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(
                conversationService.listConversations(id.userId(), id.instituteId(), id.role(), type, limit));
    }

    /** Unread total for the sidebar badge — a cheap aggregate, so clients don't poll the full list. */
    @GetMapping("/conversations/unread-count")
    public ResponseEntity<Map<String, Long>> unreadCount(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(Map.of("count", conversationService.getUnreadTotal(id.userId(), id.instituteId())));
    }

    @GetMapping("/conversations/{conversationId}/messages")
    public ResponseEntity<ChatMessagePageResponse> getMessages(
            @PathVariable String conversationId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam(required = false) Long beforeCursor,
            @RequestParam(required = false) Long sinceCursor,
            @RequestParam(defaultValue = "40") int limit) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(messageService.getMessages(conversationId, id.userId(), beforeCursor, sinceCursor, limit));
    }

    @PostMapping("/conversations/{conversationId}/messages")
    public ResponseEntity<ChatMessageResponse> sendMessage(
            @PathVariable String conversationId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @Valid @RequestBody SendChatMessageRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        try {
            return ResponseEntity.ok(messageService.send(conversationId, id.userId(), id.role(), id.name(), request));
        } catch (DataIntegrityViolationException race) {
            // Lost an idempotency race on clientDedupKey — return the message the winner persisted.
            String key = request.getClientDedupKey();
            if (key != null && !key.isBlank()) {
                return ResponseEntity.ok(messageService.getByDedupKey(conversationId, id.userId(), key));
            }
            throw race;
        }
    }

    /** Edit the body of a message you sent. Sender-only; see ChatMessageService#editMessage. */
    @PatchMapping("/conversations/{conversationId}/messages/{messageId}")
    public ResponseEntity<ChatMessageResponse> editMessage(
            @PathVariable String conversationId,
            @PathVariable String messageId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @Valid @RequestBody EditChatMessageRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(
                messageService.editMessage(conversationId, messageId, id.userId(), id.role(), request));
    }

    @DeleteMapping("/conversations/{conversationId}/messages/{messageId}")
    public ResponseEntity<ChatMessageResponse> deleteMessage(
            @PathVariable String conversationId,
            @PathVariable String messageId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(
                messageService.deleteMessage(conversationId, messageId, id.userId(), id.role(), id.instituteId()));
    }

    @PostMapping("/conversations/{conversationId}/read")
    public ResponseEntity<Map<String, Object>> markRead(
            @PathVariable String conversationId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestBody(required = false) MarkReadRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        conversationService.markRead(conversationId, id.userId(), request != null ? request.getUpToMessageId() : null);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PostMapping("/conversations/direct")
    public ResponseEntity<ChatConversationResponse> startOrGetDirect(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestBody StartDirectRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        ChatConversation conv = provisionWithRetry(
                () -> conversationService.findOrCreateDirect(id.instituteId(), id.userId(), id.role(), id.name(), request));
        return ResponseEntity.ok(conversationService.describe(conv, id.userId(), id.role()));
    }

    @PostMapping("/conversations/batch/{packageSessionId}")
    public ResponseEntity<ChatConversationResponse> openBatch(
            @PathVariable String packageSessionId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        ChatConversation conv = provisionWithRetry(
                () -> conversationService.getOrProvisionBatch(id.instituteId(), packageSessionId, id.userId(), id.role(), id.name()));
        return ResponseEntity.ok(conversationService.describe(conv, id.userId(), id.role()));
    }

    /**
     * Search batches to start/open a batch conversation. Role-scoped: admin = all institute batches,
     * teacher = faculty-mapped batches, students = none. Returns batches with an existing conversation
     * id when one already exists (else the FE provisions on open via /conversations/batch/{id}).
     */
    @PostMapping("/batches/search")
    public ResponseEntity<ChatBatchSearchResponse> searchBatches(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestBody(required = false) ChatBatchSearchRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        String nameQuery = request != null ? request.getNameQuery() : null;
        int pageSize = request != null ? request.getPageSize() : 30;
        return ResponseEntity.ok(
                batchService.search(id.instituteId(), id.userId(), id.role(), nameQuery, pageSize));
    }

    @PostMapping("/conversations/community")
    public ResponseEntity<ChatConversationResponse> openCommunity(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        ChatConversation conv = provisionWithRetry(
                () -> conversationService.getOrProvisionCommunity(id.instituteId(), id.userId(), id.role(), id.name()));
        return ResponseEntity.ok(conversationService.describe(conv, id.userId(), id.role()));
    }

    /**
     * Get-or-create provisioning races on the conversation unique indexes. The first attempt's
     * DataIntegrityViolationException propagates out of its (now rollback-only) transaction; retrying
     * runs a fresh transaction that finds the winner's committed row via the "existing" branch.
     */
    private ChatConversation provisionWithRetry(Supplier<ChatConversation> op) {
        try {
            return op.get();
        } catch (DataIntegrityViolationException race) {
            return op.get();
        }
    }

    @GetMapping("/conversations/{conversationId}/rules")
    public ResponseEntity<ChatRulesResponse> getRules(
            @PathVariable String conversationId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(conversationService.getRules(conversationId, id.userId()));
    }

    @PutMapping("/conversations/{conversationId}/rules")
    public ResponseEntity<ChatRulesResponse> updateRules(
            @PathVariable String conversationId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestBody UpdateRulesRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(conversationService.updateRules(conversationId, id.userId(), request.getRules()));
    }

    @PostMapping("/conversations/{conversationId}/rules/acknowledge")
    public ResponseEntity<ChatRulesResponse> acknowledgeRules(
            @PathVariable String conversationId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(conversationService.acknowledgeRules(conversationId, id.userId(), id.role(), id.name()));
    }
}
