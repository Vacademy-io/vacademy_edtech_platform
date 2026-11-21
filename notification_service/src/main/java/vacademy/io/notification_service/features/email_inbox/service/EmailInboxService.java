package vacademy.io.notification_service.features.email_inbox.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;
import vacademy.io.notification_service.features.email_inbox.dto.EmailAttachmentDTO;
import vacademy.io.notification_service.features.email_inbox.dto.EmailConversationDTO;
import vacademy.io.notification_service.features.email_inbox.dto.EmailMessageDTO;
import vacademy.io.notification_service.features.email_inbox.dto.EmailReplyRequest;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import vacademy.io.notification_service.service.EmailService;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class EmailInboxService {

    private static final int PREVIEW_MAX = 120;
    private static final int LIST_PREVIEW_MAX = 60;
    private static final String INBOUND_TYPE = "INBOUND_EMAIL";
    private static final String OUTBOUND_TYPE = "EMAIL";
    /**
     * Twin merging shrinks a raw page, and the FE treats a short page as "no more" and uses the
     * oldest returned timestamp as the next cursor. So raw rows are fetched in rounds until the
     * merged list is full AND the raw tail reaches TWIN_WINDOW past the last kept entry (its
     * twin, if any, is then guaranteed to be in the set). Bounded so a pathological thread
     * cannot loop forever.
     */
    private static final int MAX_FETCH_ROUNDS = 6;
    private static final int LOOKAHEAD_MAX_ROWS = 200;
    private static final Pattern UUID_PATTERN =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final NotificationLogRepository notificationLogRepository;
    private final EmailAddressMappingRepository emailAddressMappingRepository;
    private final EmailConfigurationService emailConfigurationService;
    private final UnifiedSendService unifiedSendService;
    private final ObjectMapper objectMapper;

    // ==================== Conversations ====================

    /**
     * @param instituteAddress optional — narrows results to one institute sender. null/blank = all.
     * @param direction        ALL | SENT | RECEIVED. null = ALL.
     */
    public List<EmailConversationDTO> getConversations(String instituteId, int offset, int limit,
                                                       String instituteAddress, String direction) {
        if (instituteId == null || instituteId.isBlank()) return List.of();

        String senderFilter = narrowSender(instituteId, instituteAddress);
        // narrowSender returned a sentinel ("__none__") to mean "address doesn't belong to this institute".
        if (NO_MATCH.equals(senderFilter)) return List.of();

        List<String> types = resolveTypes(direction);
        List<NotificationLog> latest = notificationLogRepository
                .findEmailConversationsForInbox(instituteId, senderFilter, types, limit, offset);
        if (latest.isEmpty()) return List.of();

        Map<String, Long> unread = batchUnread(latest);
        Map<String, String> names = batchInboundNames(instituteId, latest);
        Set<String> withFiles = batchWithAttachments(instituteId, latest);

        return latest.stream()
                .map(nl -> toConversation(nl, unread, names, withFiles))
                .collect(Collectors.toList());
    }

    public List<EmailConversationDTO> searchConversations(String instituteId, String rawQuery,
                                                          int offset, int limit,
                                                          String instituteAddress, String direction) {
        if (instituteId == null || instituteId.isBlank() || rawQuery == null || rawQuery.isBlank()) return List.of();

        String senderFilter = narrowSender(instituteId, instituteAddress);
        if (NO_MATCH.equals(senderFilter)) return List.of();

        String safe = "%" + rawQuery.replace("%", "\\%").replace("_", "\\_") + "%";
        List<String> types = resolveTypes(direction);
        int safeLimit = Math.max(1, Math.min(limit, 100));
        int safeOffset = Math.max(0, offset);
        List<NotificationLog> rows = notificationLogRepository
                .searchEmailConversations(instituteId, senderFilter, types, safe, safeLimit, safeOffset);
        Map<String, Long> unread = batchUnread(rows);
        Map<String, String> names = batchInboundNames(instituteId, rows);
        Set<String> withFiles = batchWithAttachments(instituteId, rows);
        return rows.stream().map(nl -> toConversation(nl, unread, names, withFiles)).collect(Collectors.toList());
    }

    private Map<String, Long> batchUnread(List<NotificationLog> rows) {
        List<String> emails = rows.stream()
                .map(NotificationLog::getChannelId)
                .filter(s -> s != null && !s.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (emails.isEmpty()) return Map.of();
        Map<String, Long> result = new HashMap<>();
        try {
            for (Object[] row : notificationLogRepository.batchCountUnreadEmailMessages(emails)) {
                result.put((String) row[0], ((Number) row[1]).longValue());
            }
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Failed to fetch unread counts: {}", e.getMessage());
        }
        return result;
    }

    /**
     * Latest inbound display name per counterparty. Outbound rows never carry sender_name, so
     * when the newest row is the institute's own reply (or a campaign) the list would otherwise
     * drop the person's name it showed a moment ago. Institute-scoped: one address can talk to
     * several institutes. Keyed by the row's channel_id as stored.
     */
    private Map<String, String> batchInboundNames(String instituteId, List<NotificationLog> rows) {
        List<String> emails = rows.stream()
                .filter(nl -> !INBOUND_TYPE.equals(nl.getNotificationType()) || blankToNull(nl.getSenderName()) == null)
                .map(NotificationLog::getChannelId)
                .filter(e -> e != null && !e.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (emails.isEmpty()) return Map.of();
        Map<String, String> result = new HashMap<>();
        try {
            for (Object[] row : notificationLogRepository.findLatestInboundSenderNames(instituteId, emails)) {
                if (row[0] != null && row[1] != null) result.put((String) row[0], (String) row[1]);
            }
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Failed to fetch inbound sender names: {}", e.getMessage());
        }
        return result;
    }

    /** Counterparties on this page who sent at least one email with a real attachment. */
    private Set<String> batchWithAttachments(String instituteId, List<NotificationLog> rows) {
        List<String> emails = rows.stream()
                .map(NotificationLog::getChannelId)
                .filter(e -> e != null && !e.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (emails.isEmpty()) return Set.of();
        try {
            return new HashSet<>(notificationLogRepository.findInboundCounterpartiesWithAttachments(instituteId, emails));
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Failed to fetch attachment flags: {}", e.getMessage());
            return Set.of();
        }
    }

    private EmailConversationDTO toConversation(NotificationLog nl, Map<String, Long> unread,
                                                Map<String, String> inboundNames, Set<String> withFiles) {
        boolean inbound = INBOUND_TYPE.equals(nl.getNotificationType());
        Optional<JsonNode> payload = parsePayload(nl);
        String subject = payload.map(p -> textOrNull(p, EmailService.SUBJECT_PAYLOAD_KEY)).orElse(null);
        // The announcement-service twin logs the campaign TITLE as its body — that is the subject.
        if (subject == null && EmailThreadMerger.isAnnouncementEmail(nl)) subject = blankToNull(nl.getBody());

        // Prefer the subject for list previews — that's what real mail clients show. A subject is
        // already plain text (never strip its angle brackets); only an outbound HTML body needs
        // the tag pipeline.
        String preview;
        if (subject != null) {
            preview = EmailTextUtils.truncate(EmailTextUtils.cleanText(subject), LIST_PREVIEW_MAX);
        } else if (inbound) {
            preview = EmailTextUtils.truncate(EmailTextUtils.cleanText(nl.getBody()), LIST_PREVIEW_MAX);
        } else {
            preview = EmailTextUtils.truncate(EmailTextUtils.toPlainText(nl.getBody()), LIST_PREVIEW_MAX);
        }

        String name = blankToNull(nl.getSenderName());
        if (name == null) name = inboundNames.get(nl.getChannelId());

        return EmailConversationDTO.builder()
                .email(nl.getChannelId())
                .name(name)
                .userId(nl.getUserId())
                .lastMessageDirection(inbound ? "INCOMING" : "OUTGOING")
                .lastMessageSubject(subject)
                .lastMessagePreview(preview)
                .lastMessageTime(nl.getNotificationDate())
                .unreadCount(unread.getOrDefault(nl.getChannelId(), 0L))
                .system(EmailTextUtils.isSystemSender(nl.getChannelId(), inbound ? subject : null))
                .hasAttachments(withFiles.contains(nl.getChannelId()))
                .build();
    }

    // ==================== Messages ====================

    public List<EmailMessageDTO> getMessages(String instituteId, String counterpartyEmail,
                                             String cursor, int limit,
                                             String instituteAddress, String direction) {
        if (instituteId == null || instituteId.isBlank()) return List.of();

        String senderFilter = narrowSender(instituteId, instituteAddress);
        if (NO_MATCH.equals(senderFilter)) return List.of();

        List<String> types = resolveTypes(direction);
        int safeLimit = Math.max(1, limit);
        boolean outboundIncluded = types.contains(OUTBOUND_TYPE);

        if (!outboundIncluded) {
            // Inbound-only view: nothing to merge, a raw page is a page.
            List<NotificationLog> rows = notificationLogRepository
                    .findEmailMessagesForConversation(counterpartyEmail, instituteId, senderFilter, types, cursor, safeLimit);
            return EmailThreadMerger.merge(rows).stream().map(this::toMessage).collect(Collectors.toList());
        }

        // A campaign send logs two EMAIL rows (announcement title + the real HTML send) — fold
        // them into one thread entry so the admin sees one card with a subject, not two.
        //
        // Merging shrinks the page, so over-fetch until the merged list is full and the raw tail
        // extends TWIN_WINDOW past the last kept entry (see MAX_FETCH_ROUNDS), then trim. The
        // FE derives hasMore from "page is full" and the next cursor from the oldest entry's
        // timestamp, so the response must stay exactly `limit` long while more rows exist.
        List<NotificationLog> raw = new ArrayList<>();
        int fetchSize = safeLimit * 2;
        String rawCursor = cursor;
        List<NotificationLog> context = null;
        List<EmailThreadMerger.MergedRow> merged = List.of();
        for (int round = 0; round < MAX_FETCH_ROUNDS; round++) {
            List<NotificationLog> batch = notificationLogRepository
                    .findEmailMessagesForConversation(counterpartyEmail, instituteId, senderFilter, types, rawCursor, fetchSize);
            raw.addAll(batch);
            boolean exhausted = batch.size() < fetchSize;
            if (context == null && raw.stream().anyMatch(EmailThreadMerger::isAnnouncementEmail)) {
                context = lookaheadContext(counterpartyEmail, instituteId, senderFilter, cursor);
            }
            merged = mergeWithLookahead(raw, context == null ? List.of() : context);
            if (exhausted || pageIsSettled(merged, raw, safeLimit)) break;
            Instant oldest = raw.get(raw.size() - 1).getNotificationDate();
            if (oldest == null) break;
            rawCursor = oldest.toString();
        }

        List<EmailThreadMerger.MergedRow> page = merged.size() > safeLimit ? merged.subList(0, safeLimit) : merged;
        return page.stream().map(this::toMessage).collect(Collectors.toList());
    }

    /**
     * True once the merged list holds at least {@code limit} entries AND the oldest raw row is
     * more than TWIN_WINDOW older than the entry that will close the page — every twin of a
     * kept row is then inside the fetched set, so trimming cannot split a pair across pages.
     */
    private static boolean pageIsSettled(List<EmailThreadMerger.MergedRow> merged, List<NotificationLog> raw, int limit) {
        if (merged.size() < limit || raw.isEmpty()) return false;
        Instant lastKept = merged.get(limit - 1).row().getNotificationDate();
        Instant oldestRaw = raw.get(raw.size() - 1).getNotificationDate();
        if (lastKept == null || oldestRaw == null) return true;
        return oldestRaw.isBefore(lastKept.minus(EmailThreadMerger.TWIN_WINDOW));
    }

    /**
     * Merge the page's raw rows together with the outbound rows the PREVIOUS page already
     * showed (those just newer than the cursor, within twice the twin window so their own
     * partners are present too). An announcement row that landed on this page while its HTML
     * twin was on the previous one is then folded away instead of appearing as a duplicate
     * title-only card; the context rows themselves are removed from the result again.
     */
    static List<EmailThreadMerger.MergedRow> mergeWithLookahead(List<NotificationLog> raw, List<NotificationLog> context) {
        if (context.isEmpty()) return EmailThreadMerger.merge(raw);

        Set<String> contextIds = new HashSet<>();
        List<NotificationLog> all = new ArrayList<>(context.size() + raw.size());
        for (NotificationLog c : context) {
            if (c.getId() != null) contextIds.add(c.getId());
            all.add(c);
        }
        all.addAll(raw);
        return EmailThreadMerger.merge(all).stream()
                .filter(m -> m.row().getId() == null || !contextIds.contains(m.row().getId()))
                .collect(Collectors.toList());
    }

    /** Outbound rows in {@code [cursor, cursor + 2 * TWIN_WINDOW]}; empty on the first page. */
    private List<NotificationLog> lookaheadContext(String counterpartyEmail, String instituteId,
                                                   String senderFilter, String cursor) {
        if (cursor == null || cursor.isBlank()) return List.of();
        Instant from;
        try {
            from = Instant.parse(cursor.trim());
        } catch (Exception e) {
            log.debug("[EMAIL-INBOX] Cursor '{}' is not an ISO instant; skipping twin lookahead", cursor);
            return List.of();
        }
        try {
            Instant to = from.plus(EmailThreadMerger.TWIN_WINDOW.multipliedBy(2));
            return notificationLogRepository.findOutboundEmailsInWindow(
                    counterpartyEmail, instituteId, senderFilter, from.toString(), to.toString(), LOOKAHEAD_MAX_ROWS);
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Twin lookahead failed for {}: {}", counterpartyEmail, e.getMessage());
            return List.of();
        }
    }

    private EmailMessageDTO toMessage(EmailThreadMerger.MergedRow merged) {
        NotificationLog nl = merged.row();
        boolean inbound = INBOUND_TYPE.equals(nl.getNotificationType());
        Optional<JsonNode> payload = parsePayload(nl);
        String subject = payload.map(p -> textOrNull(p, EmailService.SUBJECT_PAYLOAD_KEY)).orElse(null);
        String body = nl.getBody();

        if (inbound) {
            // INBOUND_EMAIL stores subject/body separately in messagePayload JSON; body column is the subject (truncated).
            String fullBody = payload.map(p -> textOrNull(p, "body")).orElse(null);
            if (fullBody != null) body = fullBody;
        } else {
            if (subject == null) subject = merged.derivedSubject();
            if (subject == null && EmailThreadMerger.isAnnouncementEmail(nl)) {
                // Un-twinned announcement row: its body IS the campaign title, there is no HTML.
                subject = blankToNull(body);
                body = null;
            }
        }

        // Outbound bodies are HTML → tag pipeline. Inbound bodies (text/plain, or tag-stripped at
        // ingest) and subjects are already plain text → entities/whitespace only, so a quoted
        // "<https://...>" or "a <b and c> d" keeps its words.
        String preview = body != null
                ? (inbound ? EmailTextUtils.cleanText(body) : EmailTextUtils.toPlainText(body))
                : EmailTextUtils.cleanText(subject);
        boolean system = inbound && EmailTextUtils.isSystemSender(nl.getChannelId(), subject);
        // For inbound rows the source column carries the parent outbound log id (InboundEmailService),
        // which is a link, not a label — expose it as inReplyToId and never as 'source'.
        String inReplyToId = inbound && nl.getSource() != null && UUID_PATTERN.matcher(nl.getSource()).matches()
                ? nl.getSource() : null;

        return EmailMessageDTO.builder()
                .id(nl.getId())
                .direction(inbound ? "INCOMING" : "OUTGOING")
                .subject(subject)
                .bodyPreview(EmailTextUtils.truncate(preview, PREVIEW_MAX))
                .body(body)
                .counterpartyEmail(nl.getChannelId())
                .counterpartyName(blankToNull(nl.getSenderName()))
                .instituteAddress(nl.getSenderBusinessChannelId())
                .timestamp(nl.getNotificationDate())
                .source(inbound ? null : nl.getSource())
                .origin(inbound ? inboundOrigin(system, inReplyToId) : outboundOrigin(nl.getSource(), merged.campaign()))
                .system(system)
                .inReplyToId(inReplyToId)
                // A FAILED announcement row (unsubscribed / missing address / thrown send) or a
                // provider failure must not read as a delivered email.
                .deliveryStatus(inbound ? null : blankToNull(nl.getDeliveryStatus()))
                .deliveryErrorMessage(inbound ? null : blankToNull(nl.getDeliveryErrorMessage()))
                .attachments(inbound ? attachmentsOf(payload) : List.of())
                .hasHtml(inbound && payload.map(p -> p.path(InboundMimeParts.HAS_HTML_KEY).asBoolean(false)).orElse(false))
                .build();
    }

    /** The attachment index ingest wrote into an inbound row's payload; empty when absent. */
    static List<EmailAttachmentDTO> attachmentsOf(Optional<JsonNode> payload) {
        JsonNode list = payload.map(p -> p.get(InboundMimeParts.ATTACHMENTS_KEY)).orElse(null);
        if (list == null || !list.isArray()) return List.of();
        List<EmailAttachmentDTO> out = new ArrayList<>();
        for (JsonNode a : list) {
            String id = a.path("id").asText(null);
            if (id == null || id.isBlank()) continue;
            out.add(EmailAttachmentDTO.builder()
                    .id(id)
                    .filename(a.path("filename").asText("attachment"))
                    .contentType(a.path("contentType").asText("application/octet-stream"))
                    .size(a.path("size").asLong(-1))
                    .inline(a.path("inline").asBoolean(false))
                    .build());
        }
        return out;
    }

    /**
     * An INBOUND_EMAIL row of this institute, for serving its attachments / HTML. Empty for any
     * other row — an id from another institute is indistinguishable from a missing one.
     */
    public Optional<NotificationLog> findInboundEmail(String instituteId, String messageId) {
        if (instituteId == null || instituteId.isBlank() || messageId == null || messageId.isBlank()) {
            return Optional.empty();
        }
        return notificationLogRepository.findById(messageId)
                .filter(nl -> INBOUND_TYPE.equals(nl.getNotificationType()))
                .filter(nl -> instituteId.equals(nl.getInstituteId()));
    }

    /** OUTGOING origin per the inbox contract. */
    static String outboundOrigin(String source, boolean campaign) {
        if (campaign) return "CAMPAIGN";
        if (source == null) return "EMAIL";
        String s = source.trim();
        if (EmailThreadMerger.ANNOUNCEMENT_SOURCE.equalsIgnoreCase(s)) return "CAMPAIGN";
        if (UnifiedSendService.INBOX_REPLY_SOURCE.equalsIgnoreCase(s)) return "INBOX_REPLY";
        if ("OTP_SERVICE".equalsIgnoreCase(s)) return "OTP";
        if (UnifiedSendService.ENGAGEMENT_ENGINE_SOURCE.equalsIgnoreCase(s)
                || s.toLowerCase().startsWith("event:")) return "AUTOMATION";
        return "EMAIL";
    }

    /** INCOMING origin per the inbox contract. */
    static String inboundOrigin(boolean system, String inReplyToId) {
        if (system) return "BOUNCE";
        return inReplyToId != null ? "REPLY" : "INCOMING";
    }

    // ==================== Reply ====================

    public EmailMessageDTO sendReply(EmailReplyRequest req) {
        if (req.getInstituteId() == null || req.getInstituteId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        if (req.getToEmail() == null || req.getToEmail().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "toEmail is required");
        }
        if (req.getBody() == null || req.getBody().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "body is required");
        }

        // Sender validation: must be one of the institute's configured senders.
        List<String> instituteSenders = emailConfigurationService.getInstituteConfiguredFromAddresses(req.getInstituteId());
        if (instituteSenders.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Institute has no configured email senders");
        }

        String fromEmail = req.getFromEmail();
        if (fromEmail == null || fromEmail.isBlank()) {
            fromEmail = instituteSenders.get(0);
        } else if (!instituteSenders.contains(fromEmail.toLowerCase().trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "fromEmail is not a configured sender for this institute");
        }

        String subject = req.getSubject() != null && !req.getSubject().isBlank()
                ? req.getSubject()
                : "Re: (no subject)";

        UnifiedSendRequest send = UnifiedSendRequest.builder()
                .instituteId(req.getInstituteId())
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                        .email(req.getToEmail())
                        .build()))
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject(subject)
                        .emailBody(req.getBody())
                        .fromEmail(fromEmail)
                        .source(UnifiedSendService.INBOX_REPLY_SOURCE)
                        .build())
                .build();

        UnifiedSendResponse response;
        try {
            response = unifiedSendService.routeSync(send);
        } catch (Exception e) {
            log.error("[EMAIL-INBOX] Reply send failed institute={} to={}: {}",
                    req.getInstituteId(), req.getToEmail(), e.getMessage(), e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to send reply: " + e.getMessage());
        }

        // routeSync never throws for a per-recipient outcome: a blocklisted / unsubscribed
        // address, a provider failure or a capped (deferred) send all come back as a result
        // row. Surface them, or the UI appends a "sent" bubble that the next fetch never returns.
        String deliveryStatus = assertReplyAccepted(response, req.getToEmail());

        // Return a shape that the UI can append optimistically.
        return EmailMessageDTO.builder()
                .direction("OUTGOING")
                .subject(subject)
                .bodyPreview(EmailTextUtils.truncate(EmailTextUtils.toPlainText(req.getBody()), PREVIEW_MAX))
                .body(req.getBody())
                .counterpartyEmail(req.getToEmail())
                .instituteAddress(fromEmail)
                .timestamp(Instant.now())
                .source(UnifiedSendService.INBOX_REPLY_SOURCE)
                .origin("INBOX_REPLY")
                .system(false)
                .deliveryStatus(deliveryStatus)
                .build();
    }

    /**
     * Maps the single recipient's result to the DTO's deliveryStatus (SENT / DEFERRED) or throws:
     * 422 for a recipient the platform refuses to mail (blocklisted, unsubscribed), 502 for a
     * provider failure or rate-limit. SENT means "accepted for dispatch" — the SMTP send itself
     * runs asynchronously with retries.
     */
    static String assertReplyAccepted(UnifiedSendResponse response, String toEmail) {
        UnifiedSendResponse.RecipientResult result = response == null || response.getResults() == null
                ? null
                : response.getResults().stream().findFirst().orElse(null);
        if (result == null) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Failed to send reply: no delivery result for " + toEmail);
        }
        String status = result.getStatus() == null ? "" : result.getStatus().trim().toUpperCase();
        String reason = result.getError() != null && !result.getError().isBlank() ? result.getError() : status;
        if (result.isSuccess() && "DEFERRED".equals(status)) return "DEFERRED";
        if (result.isSuccess()) return "SENT";
        if (status.startsWith("SKIPPED")) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Reply not sent: " + reason);
        }
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Failed to send reply: " + reason);
    }

    // ==================== Helpers ====================

    /**
     * Sentinel returned by {@link #narrowSender} when the caller-supplied sender doesn't belong
     * to this institute — the inbox must return zero rows in that case (don't fall back to "all").
     */
    private static final String NO_MATCH = "__no_match__";

    /**
     * Resolve the optional sender-narrowing filter passed to the repository queries.
     * <ul>
     *   <li>If {@code instituteAddress} is blank → {@code null} (no narrowing; all senders for
     *       this institute).</li>
     *   <li>If it's set AND belongs to the institute's configured from-addresses → the
     *       normalized address.</li>
     *   <li>If it's set but does NOT belong → {@link #NO_MATCH}, signalling the caller to
     *       short-circuit with an empty result (defends against an admin peeking into
     *       another institute's data via a crafted query param).</li>
     * </ul>
     */
    private String narrowSender(String instituteId, String instituteAddress) {
        if (instituteAddress == null || instituteAddress.isBlank()) return null;
        String normalized = instituteAddress.toLowerCase().trim();
        List<String> configured = emailConfigurationService.getInstituteConfiguredFromAddresses(instituteId);
        return configured.contains(normalized) ? normalized : NO_MATCH;
    }

    /**
     * Map the {@code direction} query param to the {@code notification_type} list used by the
     * repo queries. Anything other than SENT/RECEIVED falls back to both (ALL).
     */
    private List<String> resolveTypes(String direction) {
        if (direction == null) return List.of("EMAIL", "INBOUND_EMAIL");
        return switch (direction.trim().toUpperCase()) {
            case "SENT", "OUTGOING", "OUTBOUND" -> List.of("EMAIL");
            case "RECEIVED", "INCOMING", "INBOUND" -> List.of("INBOUND_EMAIL");
            default -> List.of("EMAIL", "INBOUND_EMAIL");
        };
    }

    /** True if the institute has at least one active inbound email mapping (for UI gating). */
    public boolean isInboundConfigured(String instituteId) {
        return emailAddressMappingRepository.existsByInstituteIdAndIsActiveTrue(instituteId);
    }

    /** Configured from-addresses for the sender dropdown in the UI. */
    public List<String> getInstituteSenderAddresses(String instituteId) {
        return emailConfigurationService.getInstituteConfiguredFromAddresses(instituteId);
    }

    /**
     * message_payload as JSON, parsed once per row. Empty when absent or not JSON — both the
     * inbound {@code {"subject","from","to","body",...}} and the outbound {@code {"subject"}}
     * shapes go through here.
     */
    private Optional<JsonNode> parsePayload(NotificationLog nl) {
        String raw = nl.getMessagePayload();
        if (raw == null || raw.isBlank()) return Optional.empty();
        try {
            JsonNode node = objectMapper.readTree(raw);
            return node != null && node.isObject() ? Optional.of(node) : Optional.empty();
        } catch (Exception e) {
            log.debug("[EMAIL-INBOX] Failed to parse payload for {}: {}", nl.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    private String textOrNull(JsonNode node, String field) {
        if (node == null) return null;
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) return null;
        String s = v.asText();
        return (s == null || s.isBlank()) ? null : s;
    }
}
