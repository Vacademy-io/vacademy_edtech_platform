package vacademy.io.notification_service.features.engagement_ledger.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.notification_service.features.engagement_ledger.dto.LedgerBatchRequest;
import vacademy.io.notification_service.features.engagement_ledger.dto.LedgerBatchResponse;
import vacademy.io.notification_service.features.engagement_ledger.service.EngagementLedgerService;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Internal (service-to-service) ledger reads for the Engagement Engine in admin_core.
 *
 * SECURITY NOTE: this path is covered by WebSecurityConfig's permitAll on
 * "/notification-service/internal/**" — the service-wide convention (HmacAuthFilter exists as a
 * bean but is not wired into the filter chain, so every internal endpoint here is effectively
 * unauthenticated). admin_core calls it via InternalClientUtils.makeHmacRequest, which already
 * sends signed headers; when HMAC validation is wired into this service's chain, this endpoint
 * needs no caller changes. Tracked as part of the notification_service auth-posture cleanup —
 * do not add a bespoke one-off check here.
 */
@RestController
@RequestMapping("/notification-service/internal/v1/engagement")
@RequiredArgsConstructor
@Slf4j
public class EngagementLedgerInternalController {

    private final EngagementLedgerService engagementLedgerService;
    private final vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppInboxService whatsAppInboxService;

    /**
     * Send a free-form WhatsApp session reply on behalf of the Engagement Engine (auto-reply, or a
     * human answering an escalated reply). Body {instituteId, phone, text, correlationId(action id)}
     * → {wamid}. The engine guarantees the 24h window is open before calling. Same permitAll internal
     * posture as the rest of this controller (see class note above).
     */
    @PostMapping("/whatsapp-reply")
    public ResponseEntity<Map<String, Object>> whatsAppReply(@RequestBody Map<String, String> body) {
        try {
            String wamid = whatsAppInboxService.sendEngagementReply(
                    body.get("phone"), body.get("text"), body.get("instituteId"), body.get("correlationId"));
            // accepted=true is the success signal, NOT a non-blank wamid: WATI's session-message API
            // returns no per-message id (provider returns null) even though the message was delivered
            // — requiring a wamid would mislabel every WATI auto-reply as FAILED after a real send.
            return ResponseEntity.ok(Map.of(
                    "accepted", true,
                    "wamid", wamid != null ? wamid : ""));
        } catch (org.springframework.web.server.ResponseStatusException e) {
            log.warn("whatsapp-reply rejected: {}", e.getReason());
            return ResponseEntity.status(e.getStatusCode()).build();
        }
    }

    @PostMapping("/ledger-batch")
    public ResponseEntity<LedgerBatchResponse> ledgerBatch(@RequestBody LedgerBatchRequest request) {
        try {
            return ResponseEntity.ok(engagementLedgerService.ledgerBatch(request));
        } catch (IllegalArgumentException e) {
            log.warn("ledger-batch rejected: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Recent inbound WhatsApp replies since a cursor — the engine's reply-ingestion sweep.
     * {@code since} is epoch millis (plain digits survive the caller's URL re-encoding; an ISO
     * string would arrive double-encoded and fail to parse). {@code includeEmail=true} adds inbound
     * emails (channel=EMAIL rows); without it the response is WhatsApp only, as before.
     */
    @GetMapping("/inbound-since")
    public ResponseEntity<List<Map<String, Object>>> inboundSince(
            @RequestParam String instituteId,
            @RequestParam(required = false) Long since,
            @RequestParam(defaultValue = "false") boolean includeEmail) {
        try {
            Instant cursor = since != null ? Instant.ofEpochMilli(since) : null;
            return ResponseEntity.ok(engagementLedgerService.inboundSince(instituteId, cursor, includeEmail));
        } catch (IllegalArgumentException e) {
            log.warn("inbound-since rejected: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }
    }

    /** WhatsApp sends Meta reported as failed since a cursor (epoch millis) — the engine's delivery check. */
    @GetMapping("/delivery-failures-since")
    public ResponseEntity<List<Map<String, Object>>> deliveryFailuresSince(
            @RequestParam String instituteId,
            @RequestParam(required = false) Long since) {
        try {
            Instant cursor = since != null ? Instant.ofEpochMilli(since) : null;
            return ResponseEntity.ok(engagementLedgerService.deliveryFailuresSince(instituteId, cursor));
        } catch (IllegalArgumentException e) {
            log.warn("delivery-failures-since rejected: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }
    }
}
