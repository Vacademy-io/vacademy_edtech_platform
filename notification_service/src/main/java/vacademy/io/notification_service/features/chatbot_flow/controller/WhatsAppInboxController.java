package vacademy.io.notification_service.features.chatbot_flow.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.chatbot_flow.dto.EscalationDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxConversationDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxMessageDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxSendRequest;
import vacademy.io.notification_service.features.chatbot_flow.dto.SessionWindowDTO;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppInboundMediaService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppInboxService;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notification-service/v1/inbox")
@RequiredArgsConstructor
@Slf4j
public class WhatsAppInboxController {

    private final WhatsAppInboxService inboxService;
    private final ChatbotEscalationService escalationService;
    private final WhatsAppInboundMediaService inboundMediaService;

    /**
     * @param filter UNANSWERED — only conversations where the learner spoke last and nobody has
     *               replied, plus any open chatbot hand-over; FAILED — only conversations with an
     *               undelivered message; omitted or ALL — everything.
     */
    @GetMapping("/conversations")
    public ResponseEntity<List<InboxConversationDTO>> getConversations(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "30") int limit,
            @RequestParam(required = false) String filter) {
        List<InboxConversationDTO> conversations =
                inboxService.getConversations(instituteId, offset, limit, filter);
        return ResponseEntity.ok(conversations);
    }

    @GetMapping("/conversations/{phone}/messages")
    public ResponseEntity<List<InboxMessageDTO>> getMessages(
            @PathVariable String phone,
            @RequestParam String instituteId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        List<InboxMessageDTO> messages = inboxService.getMessages(phone, instituteId, cursor, limit);
        return ResponseEntity.ok(messages);
    }

    /**
     * The photo, sticker, voice note, video or document a learner sent, fetched from WhatsApp/WATI
     * with the institute's token. 404: no attachment; 410: WhatsApp no longer keeps it (~30 days);
     * 409: WhatsApp not configured; 413: too large to preview; 502: provider did not answer.
     */
    @GetMapping("/messages/{messageId}/media")
    public ResponseEntity<byte[]> getInboundMedia(
            @PathVariable String messageId,
            @RequestParam String instituteId) {
        WhatsAppInboundMediaService.MediaFile file = inboundMediaService.fetch(messageId, instituteId);
        ResponseEntity.BodyBuilder response = ResponseEntity.ok()
                .contentType(mediaTypeOf(file.contentType()))
                // A learner's file never changes, but it is personal: browser cache only.
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePrivate());
        if (file.filename() != null) {
            response.header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline()
                    .filename(file.filename(), StandardCharsets.UTF_8).build().toString());
        }
        return response.body(file.bytes());
    }

    @GetMapping("/conversations/search")
    public ResponseEntity<List<InboxConversationDTO>> searchConversations(
            @RequestParam String instituteId,
            @RequestParam String q) {
        List<InboxConversationDTO> results = inboxService.searchConversations(instituteId, q);
        return ResponseEntity.ok(results);
    }

    /**
     * Send a reply on an open conversation.
     * <p>
     * Text-only requests are unchanged. Adding {@code mediaType} + {@code mediaUrl} sends an image,
     * video, audio clip or document instead, with {@code text} as its caption — free-form media is
     * allowed inside Meta's 24-hour customer service window with no template and no approval.
     */
    @PostMapping("/send")
    public ResponseEntity<InboxMessageDTO> sendReply(@RequestBody InboxSendRequest request) {
        if (isBlank(request.getPhone()) || isBlank(request.getInstituteId())) {
            return ResponseEntity.badRequest().build();
        }

        // Either half can carry the message: text alone, or media with the text as its caption.
        if (request.hasMedia()) {
            // Sending the reply also resolves any open escalation on this conversation.
            return ResponseEntity.ok(inboxService.sendMediaReply(request));
        }

        if (isBlank(request.getText())) {
            return ResponseEntity.badRequest().build();
        }
        InboxMessageDTO sent = inboxService.sendReply(
                request.getPhone(), request.getText(), request.getInstituteId(), request.getRepliedBy());
        return ResponseEntity.ok(sent);
    }

    /**
     * Whether free-form replies (text and media) are still allowed on this conversation, so the UI
     * can show the remaining time and disable the attachment button once the window lapses.
     */
    @GetMapping("/conversations/{phone}/session-window")
    public ResponseEntity<SessionWindowDTO> getSessionWindow(
            @PathVariable String phone,
            @RequestParam String instituteId) {
        return ResponseEntity.ok(inboxService.sessionWindow(phone, instituteId));
    }

    // ==================== Escalations (learners waiting for a human) ====================

    /**
     * Conversations the chatbot handed over. Defaults to the open ones — that is the work list.
     */
    @GetMapping("/escalations")
    public ResponseEntity<List<EscalationDTO>> listEscalations(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "PENDING") String status) {
        List<EscalationDTO> escalations = escalationService.listEscalations(instituteId, status)
                .stream().map(EscalationDTO::from).toList();
        return ResponseEntity.ok(escalations);
    }

    /** Dismiss a hand-over without replying (handled on a call, no longer relevant, ...). */
    @PostMapping("/escalations/{escalationId}/resolve")
    public ResponseEntity<Map<String, Object>> resolveEscalation(
            @PathVariable String escalationId,
            @RequestBody(required = false) Map<String, String> body) {
        String resolvedBy = body != null ? body.get("resolvedBy") : null;
        boolean resolved = escalationService.resolveById(escalationId, resolvedBy);
        if (!resolved) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of("id", escalationId, "status", "RESOLVED"));
    }

    private static MediaType mediaTypeOf(String contentType) {
        try {
            return MediaType.parseMediaType(contentType);
        } catch (Exception e) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
