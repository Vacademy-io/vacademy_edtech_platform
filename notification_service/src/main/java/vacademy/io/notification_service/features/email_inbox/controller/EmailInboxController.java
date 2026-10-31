package vacademy.io.notification_service.features.email_inbox.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.email_inbox.dto.EmailConversationDTO;
import vacademy.io.notification_service.features.email_inbox.dto.EmailMessageDTO;
import vacademy.io.notification_service.features.email_inbox.dto.EmailReplyRequest;
import vacademy.io.notification_service.features.email_inbox.security.EmailInboxAccess;
import vacademy.io.notification_service.features.email_inbox.service.EmailInboxService;
import vacademy.io.notification_service.features.email_inbox.service.InboundEmailContentService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Email inbox — conversations of outbound EMAIL + inbound INBOUND_EMAIL rows, grouped by
 * counterparty email and scoped to the institute via its configured from-addresses.
 * Mirrors {@code WhatsAppInboxController}. Every endpoint requires institute staff of the
 * {@code instituteId} it names (see {@link EmailInboxAccess}).
 */
@Slf4j
@RestController
@RequestMapping("/notification-service/v1/email-inbox")
@RequiredArgsConstructor
public class EmailInboxController {

    private final EmailInboxService emailInboxService;
    /** Absent when inbound email is disabled (no S3 client) — attachments then 404. */
    private final ObjectProvider<InboundEmailContentService> inboundContent;

    @GetMapping("/conversations")
    public ResponseEntity<List<EmailConversationDTO>> getConversations(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "30") int limit,
            @RequestParam(required = false) String instituteAddress,
            @RequestParam(required = false) String direction,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(emailInboxService.getConversations(
                instituteId, offset, limit, instituteAddress, direction));
    }

    @GetMapping("/conversations/{email}/messages")
    public ResponseEntity<List<EmailMessageDTO>> getMessages(
            @PathVariable String email,
            @RequestParam String instituteId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String instituteAddress,
            @RequestParam(required = false) String direction,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(emailInboxService.getMessages(
                instituteId, email, cursor, limit, instituteAddress, direction));
    }

    @GetMapping("/conversations/search")
    public ResponseEntity<List<EmailConversationDTO>> searchConversations(
            @RequestParam String instituteId,
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "30") int limit,
            @RequestParam(required = false) String instituteAddress,
            @RequestParam(required = false) String direction,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(emailInboxService.searchConversations(
                instituteId, q, offset, limit, instituteAddress, direction));
    }

    /**
     * One attachment of an inbound email, streamed from the raw email in S3. Always served as a
     * download ({@code Content-Disposition: attachment}, nosniff) — the admin UI previews images
     * and PDFs from the bytes itself, so a hostile file never renders on the API origin.
     */
    @GetMapping("/messages/{messageId}/attachment")
    public ResponseEntity<byte[]> getAttachment(
            @PathVariable String messageId,
            @RequestParam String instituteId,
            @RequestParam String part,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        InboundEmailContentService content = inboundContentOr404();
        NotificationLog row = inboundRowOr404(instituteId, messageId);
        InboundEmailContentService.AttachmentContent file = content.readAttachment(row, part)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "ATTACHMENT_NOT_FOUND"));

        MediaType type;
        try {
            type = MediaType.parseMediaType(file.contentType());
        } catch (Exception e) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.ok()
                .contentType(type)
                .contentLength(file.bytes().length)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(file.filename(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .cacheControl(CacheControl.noStore())
                .body(file.bytes());
    }

    /**
     * The inbound email's original HTML body (cid: images inlined), for the admin UI to render
     * in a sandboxed iframe. {@code html} is null when the email has no HTML part.
     */
    @GetMapping("/messages/{messageId}/html")
    public ResponseEntity<Map<String, String>> getHtml(
            @PathVariable String messageId,
            @RequestParam String instituteId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        InboundEmailContentService content = inboundContentOr404();
        NotificationLog row = inboundRowOr404(instituteId, messageId);
        Map<String, String> body = new HashMap<>();
        body.put("html", content.renderHtml(row).orElse(null));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }

    /**
     * 200 when the reply was accepted for dispatch; 202 when it was queued behind the sender's
     * daily cap (deliveryStatus=DEFERRED — it will appear in the thread once it goes out);
     * 422 when the recipient cannot be mailed (blocklisted / unsubscribed); 502 on a provider
     * failure. The service raises the error statuses.
     */
    @PostMapping("/reply")
    public ResponseEntity<EmailMessageDTO> sendReply(
            @RequestBody EmailReplyRequest request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, request.getInstituteId());
        EmailMessageDTO sent = emailInboxService.sendReply(request);
        HttpStatus status = "DEFERRED".equals(sent.getDeliveryStatus()) ? HttpStatus.ACCEPTED : HttpStatus.OK;
        return ResponseEntity.status(status).body(sent);
    }

    /**
     * Lightweight gate: does this institute have inbound email wired up (active row in
     * email_address_mapping)? The UI hides the "Incoming" affordances when false.
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Boolean>> getStatus(
            @RequestParam String instituteId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(Map.of(
                "inboundConfigured", emailInboxService.isInboundConfigured(instituteId)
        ));
    }

    /**
     * Configured institute sender addresses — used to populate the sender filter dropdown.
     */
    @GetMapping("/senders")
    public ResponseEntity<List<String>> getSenders(
            @RequestParam String instituteId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        EmailInboxAccess.requireStaff(user, clientId, instituteId);
        return ResponseEntity.ok(emailInboxService.getInstituteSenderAddresses(instituteId));
    }

    private InboundEmailContentService inboundContentOr404() {
        InboundEmailContentService content = inboundContent.getIfAvailable();
        if (content == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "INBOUND_EMAIL_DISABLED");
        return content;
    }

    private NotificationLog inboundRowOr404(String instituteId, String messageId) {
        return emailInboxService.findInboundEmail(instituteId, messageId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND"));
    }
}
