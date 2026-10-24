package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxConversationDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxMessageDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxSendRequest;
import vacademy.io.notification_service.features.chatbot_flow.dto.SessionWindowDTO;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotEscalation;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class WhatsAppInboxService {

    /** Conversation list filters. */
    public static final String FILTER_UNANSWERED = "UNANSWERED";
    public static final String FILTER_FAILED = "FAILED";

    private static final String INCOMING = "WHATSAPP_MESSAGE_INCOMING";
    private static final String OUTGOING = "WHATSAPP_MESSAGE_OUTGOING";

    /**
     * Placeholder for "no phones": SQL rejects an empty {@code IN ()}, so the clause is given a
     * value no phone number can equal and matches nothing. Deliberately NOT the empty string —
     * production has ~1,000 WhatsApp rows with a blank channel_id, and an empty-string sentinel
     * would pull that blank "conversation" into the Unanswered tab.
     */
    private static final List<String> NO_PHONES = List.of("__no_pending_escalations__");

    /**
     * Meta's customer service window: free-form text and media are allowed for 24 hours after the
     * learner's last inbound message, and only an approved template can re-open the conversation
     * once it lapses.
     */
    static final Duration SESSION_WINDOW = Duration.ofHours(24);

    private final NotificationLogRepository notificationLogRepository;
    private final ChannelToInstituteMappingRepository channelMappingRepository;
    private final WhatsAppTemplateRenderer templateRenderer;
    private final ChatbotEscalationService escalationService;
    private final WhatsAppSendFailureService sendFailureService;
    private final WhatsAppMediaPolicy mediaPolicy;
    private final ObjectMapper objectMapper;
    private final List<ChatbotMessageProvider> messageProviders;

    /**
     * Who sent each outgoing message (workflow / chatbot flow). Setter-injected and optional, so
     * the constructor callers already have keep compiling; null simply means no origin is shown.
     */
    private WhatsAppMessageOriginResolver originResolver;

    @Autowired(required = false)
    public void setOriginResolver(WhatsAppMessageOriginResolver originResolver) {
        this.originResolver = originResolver;
    }

    public List<InboxConversationDTO> getConversations(String instituteId, int offset, int limit) {
        return getConversations(instituteId, offset, limit, null);
    }

    /**
     * One page of the conversation list.
     *
     * @param filter {@code UNANSWERED} — only conversations where the learner spoke last and
     *               nobody has replied (plus any open chatbot hand-over); {@code FAILED} — only
     *               conversations containing a message that never reached the learner; null/blank/
     *               ALL — everything.
     */
    public List<InboxConversationDTO> getConversations(String instituteId, int offset, int limit,
                                                       String filter) {
        if (instituteId == null || instituteId.isBlank()) return List.of();

        List<NotificationLog> logs = loadConversationPage(instituteId, offset, limit, filter);
        if (logs.isEmpty()) return List.of();

        Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache = templateRenderer.newCache();

        // Batch unread counts (single query, not N+1)
        List<String> phones = logs.stream().map(NotificationLog::getChannelId).collect(Collectors.toList());
        Map<String, Long> unreadMap = new HashMap<>();
        try {
            List<Object[]> unreadRows = notificationLogRepository.batchCountUnreadMessages(phones);
            for (Object[] row : unreadRows) {
                unreadMap.put((String) row[0], ((Number) row[1]).longValue());
            }
        } catch (Exception e) {
            log.warn("Failed to fetch unread counts: {}", e.getMessage());
        }

        // Two more batched lookups (still no N+1): who is waiting on a human, and where a send
        // was refused. Both drive badges on the conversation row so an admin sees them without
        // opening every chat.
        Map<String, ChatbotEscalation> pending = escalationService.findPendingByPhone(instituteId, phones);
        Map<String, Long> failedMap = batchFailedCounts(instituteId, phones);

        return logs.stream()
                .map(nl -> toConversation(nl, instituteId, templateCache,
                        pending.get(nl.getChannelId()),
                        unreadMap.getOrDefault(nl.getChannelId(), 0L),
                        failedMap.getOrDefault(nl.getChannelId(), 0L)))
                .collect(Collectors.toList());
    }

    /** Applies the requested filter to the conversation page query. */
    private List<NotificationLog> loadConversationPage(String instituteId, int offset, int limit,
                                                        String filter) {
        String normalized = filter == null ? "" : filter.trim().toUpperCase();

        if (FILTER_UNANSWERED.equals(normalized)) {
            // Unanswered means what it says: the learner spoke last and nobody replied. Deriving it
            // from notification_log rather than from the escalation table is what makes the tab work
            // for every institute — most run no chatbot, so there are no escalations to list.
            // Open hand-overs are still folded in, because a hand-over the bot itself answered last
            // is work nobody has picked up.
            List<String> waiting = new ArrayList<>(escalationService.findPendingPhones(instituteId));
            return notificationLogRepository.findUnansweredConversations(
                    instituteId, waiting.isEmpty() ? NO_PHONES : waiting, limit, offset);
        }

        if (FILTER_FAILED.equals(normalized)) {
            return notificationLogRepository.findConversationsWithFailedSends(
                    instituteId, WhatsAppSendFailureService.FAILED_PAYLOAD_LIKE, limit, offset);
        }

        return notificationLogRepository.findConversationsForInbox(instituteId, limit, offset);
    }

    /** One conversation row, however it was found — listed, filtered or searched. */
    private InboxConversationDTO toConversation(NotificationLog nl, String instituteId,
                                                Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache,
                                                ChatbotEscalation escalation,
                                                long unreadCount, long failedCount) {
        boolean lastFromLearner = !nl.getNotificationType().contains("OUTGOING");
        String preview = templateRenderer.displayBody(nl, instituteId, templateCache);
        String lastKind = null;
        if (lastFromLearner) {
            // "[sticker]" / "[reaction: 👍]" / blank → a kind the list can label properly.
            InboundWhatsAppMessage in = InboundWhatsAppMessage.parse(nl.getMessagePayload(), objectMapper);
            if (in != null && STRUCTURED_KINDS.contains(in.kind())) {
                lastKind = in.kind();
                preview = in.isReaction() ? in.emoji() : in.text();
            }
        }
        return InboxConversationDTO.builder()
                .phone(nl.getChannelId())
                .senderName(nl.getSenderName())
                .userId(nl.getUserId())
                .lastMessage(truncate(preview, 60))
                .lastMessageType(lastFromLearner ? "INCOMING" : "OUTGOING")
                .lastMessageKind(lastKind)
                .lastMessageTime(nl.getNotificationDate())
                .lastMessageStatus(lastFromLearner ? null : lastMessageStatus(nl))
                .unreadCount(unreadCount)
                // Same rule the Unanswered filter selects on, so the badge, the header count
                // and the tab can never disagree about which conversations are waiting.
                .awaitingReply(escalation != null || lastFromLearner)
                .escalationId(escalation != null ? escalation.getId() : null)
                .escalationReason(escalation != null ? escalation.getReason() : null)
                .escalationMessage(escalation != null ? truncate(escalation.getUserMessage(), 140) : null)
                .escalatedAt(escalation != null && escalation.getCreatedAt() != null
                        ? escalation.getCreatedAt().toInstant() : null)
                .failedCount(failedCount)
                .build();
    }

    /**
     * What the provider said about this outgoing message, for the ticks on a conversation row.
     * <p>
     * {@code delivery_status} is WhatsApp's own verdict from its status webhook. A send the
     * provider refused outright never gets a webhook at all, so its only record is the FAILED
     * marker on message_payload — the same one the "Not delivered" filter counts, read here so the
     * two agree. Null means nothing has been reported, which the UI draws as a single tick.
     */
    private String lastMessageStatus(NotificationLog nl) {
        if (nl.getDeliveryStatus() != null) return nl.getDeliveryStatus();
        String payload = nl.getMessagePayload();
        boolean refusedOnSend = payload != null
                && payload.contains("\"deliveryStatus\":\"" + WhatsAppSendFailureService.FAILED_STATUS + "\"");
        return refusedOnSend ? WhatsAppSendFailureService.FAILED_STATUS : null;
    }

    private Map<String, Long> batchFailedCounts(String instituteId, List<String> phones) {
        Map<String, Long> failedMap = new HashMap<>();
        try {
            for (Object[] row : notificationLogRepository.batchCountFailedMessages(
                    instituteId, phones, WhatsAppSendFailureService.FAILED_PAYLOAD_LIKE)) {
                failedMap.put((String) row[0], ((Number) row[1]).longValue());
            }
        } catch (Exception e) {
            log.warn("Failed to fetch undelivered message counts: {}", e.getMessage());
        }
        return failedMap;
    }

    public List<InboxMessageDTO> getMessages(String phone, String instituteId, String cursor, int limit) {
        if (instituteId == null || instituteId.isBlank()) return List.of();

        List<NotificationLog> logs = notificationLogRepository.findMessagesForPhone(phone, instituteId, cursor, limit);

        Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache = templateRenderer.newCache();
        WhatsAppMessageOriginResolver.Cache originCache = originResolver != null ? originResolver.newCache() : null;

        // What each learner message really was, read from the provider's raw JSON on the row: the
        // stored body is only a summary ("[sticker]", "[reaction: 👍]") or, on the Meta and WATI
        // webhook paths, nothing at all — which drew an empty bubble.
        Map<String, InboundWhatsAppMessage> inbound = new HashMap<>();
        for (NotificationLog nl : logs) {
            if (isOutgoing(nl)) continue;
            InboundWhatsAppMessage parsed = InboundWhatsAppMessage.parse(nl.getMessagePayload(), objectMapper);
            if (parsed != null) inbound.put(nl.getId(), parsed);
        }
        Map<String, NotificationLog> reactionTargets = loadReactionTargets(instituteId, inbound.values());
        Map<String, String> recoveredReasons = recoverFailureReasons(phone, logs);

        return logs.stream().map(nl -> {
            WhatsAppTemplateRenderer.Rendered rm = templateRenderer.render(nl, instituteId, templateCache);
            // When we can rebuild the real template text, show it; otherwise fall back to the
            // stored body (free-text replies, incoming messages, or template no longer on file).
            String body = (rm != null && rm.body != null) ? rm.body : nl.getBody();

            // Free-text / interactive / media sends the provider refused carry the same
            // deliveryStatus + error contract on message_payload, but no templateName — so the
            // template renderer returns null for them. Read the marker directly.
            SendFailure failure = rm == null ? readSendFailure(nl.getMessagePayload()) : null;

            // Free-form media sent from the Inbox: the URL rides on message_payload, so a photo the
            // admin sent renders as a photo when the thread is reloaded, not as its caption alone.
            // Learner media is described by `in` below and fetched through the media endpoint.
            boolean outgoing = isOutgoing(nl);
            MediaMeta media = (rm == null && outgoing) ? readMediaMeta(nl.getMessagePayload()) : null;

            // What the SEND said (rm/failure) vs. what the PROVIDER later did (delivery_status,
            // stamped by the status webhook). The webhook wins whenever it has spoken: a send the
            // provider accepted reads SUCCESS here forever, even when the message was rejected
            // seconds later, so preferring the send-time value would keep showing a green bubble for
            // a message that never arrived. Null delivery_status → nothing was reported → legacy
            // behaviour, unchanged.
            String sendTimeStatus = rm != null ? rm.deliveryStatus : (failure != null ? failure.status : null);
            String sendTimeError = rm != null ? rm.error : (failure != null ? failure.error : null);
            boolean providerReported = nl.getDeliveryStatus() != null;

            InboxMessageDTO.InboxMessageDTOBuilder dto = InboxMessageDTO.builder()
                    .id(nl.getId())
                    .body(body)
                    .direction(outgoing ? "OUTGOING" : "INCOMING")
                    .timestamp(nl.getNotificationDate())
                    .source(nl.getSource())
                    .senderName(nl.getSenderName())
                    .status(nl.getNotificationType())
                    .templateName(rm != null ? rm.templateName : null)
                    .templateCategory(rm != null ? rm.category : null)
                    .provider(rm != null ? rm.provider : null)
                    .deliveryStatus(providerReported ? nl.getDeliveryStatus() : sendTimeStatus)
                    .error(providerReported ? deliveryFailureReason(nl, recoveredReasons) : sendTimeError)
                    .headerType(rm != null ? rm.headerType : null)
                    .headerMediaUrl(rm != null ? rm.headerMediaUrl : null)
                    .buttons(rm != null ? rm.buttons : null)
                    .origin(originResolver != null ? originResolver.resolve(nl, instituteId, originCache) : null)
                    .attemptedType(failure != null ? failure.attemptedType : null)
                    .mediaType(media != null ? media.type() : null)
                    .mediaUrl(media != null ? media.url() : null)
                    .mediaFilename(media != null ? media.filename() : null);

            InboundWhatsAppMessage in = inbound.get(nl.getId());
            if (in != null) applyInbound(dto, nl, in, reactionTargets, instituteId, templateCache);
            return dto.build();
        }).collect(Collectors.toList());
    }

    private static boolean isOutgoing(NotificationLog nl) {
        return nl.getNotificationType() != null && nl.getNotificationType().contains("OUTGOING");
    }

    /** Kinds the Inbox draws from structured fields, so the stored "[sticker]"-style body is dropped. */
    private static final Set<String> STRUCTURED_KINDS = Set.of(
            "image", "video", "audio", "voice", "sticker", "document", "location", "contacts",
            InboundWhatsAppMessage.KIND_REACTION);

    /** Fills the DTO from what the learner actually sent. */
    private void applyInbound(InboxMessageDTO.InboxMessageDTOBuilder dto, NotificationLog nl,
                              InboundWhatsAppMessage in, Map<String, NotificationLog> reactionTargets,
                              String instituteId,
                              Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache) {
        dto.messageKind(in.kind());

        if (in.isOwnTemplateEvent()) {
            // WATI's report of OUR template send, logged as incoming: draw it as ours.
            dto.direction("OUTGOING").senderName(null);
            if (InboundWhatsAppMessage.KIND_TEMPLATE_FAILED.equals(in.kind())) {
                dto.deliveryStatus(WhatsAppSendFailureService.FAILED_STATUS)
                        .error(failureReason(in.failedCode(), in.failedDetail()))
                        .attemptedType("template");
            }
            return;
        }

        if (in.text() != null) {
            dto.body(in.text());
        } else if (STRUCTURED_KINDS.contains(in.kind())) {
            dto.body(null);
        }

        if (in.hasMedia()) {
            dto.mediaType(in.kind())
                    .mediaFilename(in.filename())
                    .mediaFetchable(true);
        }
        if (in.isReaction()) {
            dto.reactionEmoji(in.emoji() != null ? in.emoji() : "");
            NotificationLog target = in.reactedToProviderId() != null
                    ? reactionTargets.get(in.reactedToProviderId()) : null;
            if (target != null) {
                dto.reactedToMessageId(target.getId())
                        .reactedToPreview(truncate(templateRenderer.displayBody(target, instituteId, templateCache), 80));
            }
        }
        if (in.latitude() != null || in.locationName() != null || in.locationAddress() != null) {
            dto.latitude(in.latitude())
                    .longitude(in.longitude())
                    .locationName(in.locationName())
                    .locationAddress(in.locationAddress());
        }
        if (!in.contactNames().isEmpty()) dto.contactNames(in.contactNames());
    }

    /** Our messages the learner reacted to on this page, keyed by provider message id. */
    private Map<String, NotificationLog> loadReactionTargets(String instituteId,
                                                             Collection<InboundWhatsAppMessage> inbound) {
        String[] ids = inbound.stream()
                .filter(InboundWhatsAppMessage::isReaction)
                .map(InboundWhatsAppMessage::reactedToProviderId)
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toArray(String[]::new);
        if (ids.length == 0) return Map.of();
        try {
            Map<String, NotificationLog> out = new HashMap<>();
            for (NotificationLog t : notificationLogRepository.findOutgoingBySourceIds(instituteId, ids)) {
                out.putIfAbsent(t.getSourceId(), t);
            }
            return out;
        } catch (Exception e) {
            // A reaction without its target still renders — as a standalone "reacted 👍" line.
            log.warn("Could not load reaction targets: {}", e.getMessage());
            return Map.of();
        }
    }

    /** "Error: Message undeliverable (code=131026)" — the body the Com.bot path writes. */
    private static final java.util.regex.Pattern FAILED_EVENT_BODY =
            java.util.regex.Pattern.compile("^Error:\\s*(.*?)\\s*\\(code=([^)]*)\\)\\s*$", java.util.regex.Pattern.DOTALL);

    /**
     * Reasons for FAILED messages whose own row lost them, keyed by provider message id.
     * <p>
     * WhatsApp's "failed" webhook can arrive before the send has written its row (a bulk send
     * answered in ~1s). The status path then has nothing to stamp, and the send-side backfill later
     * marks the row FAILED from the status events — which carry the reason only in their body —
     * so the row ends up FAILED with no code and no message, and the Inbox could only say "Not
     * delivered". The reason is still on the failure event; read it from there.
     */
    private Map<String, String> recoverFailureReasons(String phone, List<NotificationLog> logs) {
        String[] ids = logs.stream()
                .filter(nl -> "FAILED".equals(nl.getDeliveryStatus())
                        && isBlank(nl.getDeliveryErrorCode()) && isBlank(nl.getDeliveryErrorMessage())
                        && !isBlank(nl.getSourceId()))
                .map(NotificationLog::getSourceId)
                .distinct()
                .toArray(String[]::new);
        if (ids.length == 0) return Map.of();
        Map<String, String> out = new HashMap<>();
        try {
            for (Object[] row : notificationLogRepository.findFailureEventsBySourceIds(phone, ids)) {
                String sourceId = (String) row[0];
                if (out.containsKey(sourceId)) continue;
                String reason = failureReason((String) row[2], (String) row[3]);
                if (reason == null) reason = reasonFromEventBody((String) row[1]);
                if (reason != null) out.put(sourceId, reason);
            }
        } catch (Exception e) {
            log.warn("Could not recover failure reasons for {}: {}", phone, e.getMessage());
        }
        return out;
    }

    static String reasonFromEventBody(String body) {
        if (body == null) return null;
        java.util.regex.Matcher m = FAILED_EVENT_BODY.matcher(body.trim());
        if (!m.matches()) return null;
        String message = m.group(1);
        String code = m.group(2);
        if ("Unknown error".equalsIgnoreCase(message)) message = null;
        if ("null".equalsIgnoreCase(code)) code = null;
        return failureReason(code, message);
    }

    /** "Message undeliverable (131026)"; just the code or just the message when that is all there is. */
    private static String failureReason(String code, String message) {
        boolean hasCode = !isBlank(code);
        boolean hasMessage = !isBlank(message);
        if (hasMessage && hasCode) return message.trim() + " (" + code.trim() + ")";
        if (hasMessage) return message.trim();
        if (hasCode) return "(" + code.trim() + ")";
        return null;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * Reason line for a message the provider rejected after accepting it, e.g.
     * "Business eligibility payment issue (131042)". Null for any other delivery status — a
     * delivered or read message has nothing to explain — and null when WhatsApp gave no reason
     * anywhere we can find, so the UI says that instead of "Not delivered" twice.
     */
    private String deliveryFailureReason(NotificationLog nl, Map<String, String> recoveredReasons) {
        if (!"FAILED".equals(nl.getDeliveryStatus())) return null;
        String reason = failureReason(nl.getDeliveryErrorCode(), nl.getDeliveryErrorMessage());
        if (reason == null && nl.getSourceId() != null) reason = recoveredReasons.get(nl.getSourceId());
        return reason;
    }

    /** The FAILED marker {@code WhatsAppSendFailureService} writes on non-template sends. */
    private record SendFailure(String status, String error, String attemptedType) {}

    private SendFailure readSendFailure(String messagePayload) {
        if (messagePayload == null || messagePayload.isBlank()) return null;
        if (!messagePayload.contains(WhatsAppSendFailureService.FAILED_STATUS)) return null;
        try {
            Map<String, Object> payload = objectMapper.readValue(messagePayload,
                    new TypeReference<Map<String, Object>>() {});
            Object status = payload.get("deliveryStatus");
            if (status == null || !WhatsAppSendFailureService.FAILED_STATUS.equals(status.toString())) {
                return null;
            }
            Object error = payload.get("error");
            Object attemptedType = payload.get("attemptedType");
            return new SendFailure(status.toString(),
                    error != null ? error.toString() : null,
                    attemptedType != null ? attemptedType.toString() : null);
        } catch (Exception e) {
            log.debug("Unparseable message payload on log row: {}", e.getMessage());
            return null;
        }
    }

    public List<InboxConversationDTO> searchConversations(String instituteId, String query) {
        if (instituteId == null || instituteId.isBlank()) return List.of();

        String safeQuery = "%" + query.replace("%", "\\%").replace("_", "\\_") + "%";
        List<NotificationLog> logs = notificationLogRepository.searchConversations(instituteId, safeQuery);

        Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache = templateRenderer.newCache();

        List<String> phones = logs.stream().map(NotificationLog::getChannelId).collect(Collectors.toList());
        Map<String, ChatbotEscalation> pending = escalationService.findPendingByPhone(instituteId, phones);
        Map<String, Long> failedMap = batchFailedCounts(instituteId, phones);

        // Built by the same method as the listed rows, so a searched conversation and a listed one
        // can never describe the same chat differently. Search carries no unread count — it is not
        // a work list, and the extra batch query would buy nothing.
        return logs.stream()
                .map(nl -> toConversation(nl, instituteId, templateCache,
                        pending.get(nl.getChannelId()), 0L,
                        failedMap.getOrDefault(nl.getChannelId(), 0L)))
                .collect(Collectors.toList());
    }

    public InboxMessageDTO sendReply(String phone, String text, String instituteId) {
        return sendReply(phone, text, instituteId, null);
    }

    /**
     * Human reply from the WhatsApp Inbox. Two things beyond the send itself:
     * <ul>
     *   <li>A provider refusal is written to notification_log as FAILED before the error is
     *       rethrown, so the attempt is visible in the thread instead of only in a toast the admin
     *       may already have dismissed.</li>
     *   <li>A successful reply resolves any open escalation on this conversation — the reply IS
     *       the answer the learner was waiting for, so the "Unanswered" badge clears on its own.</li>
     * </ul>
     *
     * @param repliedBy admin user id for the escalation audit trail; null falls back to INBOX_REPLY
     */
    public InboxMessageDTO sendReply(String phone, String text, String instituteId, String repliedBy) {
        List<ChannelToInstituteMapping> mappings = channelMappingRepository.findAllByInstituteId(instituteId);
        if (mappings.isEmpty()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    "No WhatsApp channel configured for this institute");
        }

        // Validate text length (WhatsApp limit)
        if (text.length() > 4096) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    "Message too long. Maximum 4096 characters.");
        }

        Channel channel = resolveChannel(mappings);
        ChatbotMessageProvider provider = channel.provider();
        String businessChannelId = channel.businessChannelId();

        String providerMessageId;
        try {
            providerMessageId = provider.sendText(phone, text, instituteId, businessChannelId);
        } catch (Exception e) {
            // Record the undelivered reply, then let the caller surface the error.
            sendFailureService.logFailure(instituteId, phone, businessChannelId, null,
                    "text", text, "INBOX", e.getMessage());
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_GATEWAY,
                    "WhatsApp rejected the message: " + e.getMessage());
        }

        NotificationLog outLog = saveOutgoingLog(phone, instituteId, businessChannelId, text,
                providerMessageId, null);

        // A human has now answered — clear the "Unanswered" flag on this conversation.
        escalationService.resolveForPhone(instituteId, phone, repliedBy);

        return InboxMessageDTO.builder()
                .id(outLog.getId())
                .body(text)
                .direction("OUTGOING")
                .timestamp(outLog.getNotificationDate())
                .source("INBOX")
                .build();
    }

    /**
     * Send a free-form WhatsApp session reply ON BEHALF OF the Engagement Engine (auto-reply or a
     * human answering an escalated reply task). Same session-text primitive as {@link #sendReply},
     * but the outgoing log is stamped source=ENGAGEMENT_ENGINE + correlation_id=<engagement action
     * id> so the Phase-0 ledger attributes it to the engine (engine-gated correlation, §6.3). Legal
     * only inside Meta's 24h window — the caller (the engine) guarantees that. Returns the wamid.
     */
    public String sendEngagementReply(String phone, String text, String instituteId, String correlationId) {
        List<ChannelToInstituteMapping> mappings = channelMappingRepository.findAllByInstituteId(instituteId);
        if (mappings.isEmpty()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    "No WhatsApp channel configured for this institute");
        }
        if (text == null || text.isBlank()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "Reply text is required");
        }
        if (text.length() > 4096) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "Message too long. Maximum 4096 characters.");
        }

        Channel channel = resolveChannel(mappings);
        ChatbotMessageProvider provider = channel.provider();
        String businessChannelId = channel.businessChannelId();

        String providerMessageId;
        try {
            providerMessageId = provider.sendText(phone, text, instituteId, businessChannelId);
        } catch (Exception e) {
            sendFailureService.logFailure(instituteId, phone, businessChannelId, null,
                    "text", text, "ENGAGEMENT_ENGINE", e.getMessage());
            throw e;
        }

        NotificationLog outLog = new NotificationLog();
        outLog.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        outLog.setChannelId(phone);
        outLog.setBody(text);
        outLog.setSource("ENGAGEMENT_ENGINE");   // engine-gated: Phase-0 correlation stamping keys on this
        outLog.setSourceId(providerMessageId);   // wamid → exact join for the sent/delivered/read webhooks
        outLog.setCorrelationId(correlationId);  // the engagement action id → ledger attribution
        outLog.setSenderBusinessChannelId(businessChannelId);
        outLog.setInstituteId(instituteId);
        outLog.setNotificationDate(Instant.now());
        try {
            notificationLogRepository
                    .findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(phone, "WHATSAPP_MESSAGE_OUTGOING")
                    .ifPresent(prev -> outLog.setUserId(prev.getUserId()));
        } catch (Exception ignored) {}
        notificationLogRepository.save(outLog);
        return providerMessageId;
    }

    // ==================== Media replies (free-form, 24h window) ====================

    /**
     * Send an image, video, audio clip or document from the Inbox.
     * <p>
     * Meta allows this with no template and no approval, but only inside the 24-hour customer
     * service window, so the window is checked before anything is handed to a provider — a refusal
     * here reads "the learner last replied 3 days ago" instead of the provider's opaque 500. The
     * caller can override that check ({@link InboxSendRequest#isForce()}) for the cases our own
     * record cannot see: a 72-hour click-to-WhatsApp conversation, or an inbound message that never
     * reached our webhook.
     * <p>
     * {@code text} on the request travels as the caption. Audio carries none — WhatsApp has no
     * caption on an audio bubble.
     */
    public InboxMessageDTO sendMediaReply(InboxSendRequest request) {
        String phone = request.getPhone();
        String instituteId = request.getInstituteId();

        Channel channel = resolveChannel(instituteId);
        WhatsAppMediaPolicy.Media media = mediaPolicy.validate(
                request.getMediaType(), request.getMediaUrl(), request.getText(), request.getFilename());

        if (!request.isForce()) {
            SessionWindowDTO window = sessionWindow(phone, instituteId);
            // Unknown (no inbound on record) is not the same as closed: we cannot prove the window
            // is shut, so we let Meta be the authority and attempt the send.
            if (!window.isOpen() && !window.isUnknown()) {
                throw new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.CONFLICT,
                        "WhatsApp's 24-hour reply window has closed for this conversation ("
                                + describeAge(window.getLastInboundAt())
                                + "). Send an approved template instead, or ask them to message first.");
            }
        }

        mediaPolicy.checkSize(media);

        String providerMessageId;
        try {
            providerMessageId = channel.provider().sendMedia(phone, media.type(), media.url(),
                    media.caption(), media.filename(), instituteId, channel.businessChannelId());
        } catch (Exception e) {
            // Same contract as a failed text reply: the attempt stays in the thread, carrying enough
            // of the media to show WHICH attachment was refused.
            sendFailureService.logFailure(instituteId, phone, channel.businessChannelId(), null,
                    media.type(), mediaPolicy.summaryBody(media), "INBOX", e.getMessage(),
                    mediaPolicy.toLogPayload(media));
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_GATEWAY,
                    "WhatsApp rejected the " + media.type() + ": " + e.getMessage());
        }

        String payloadJson = null;
        try {
            payloadJson = objectMapper.writeValueAsString(mediaPolicy.toLogPayload(media));
        } catch (Exception e) {
            // A thread bubble without its attachment is a cosmetic loss; a send we already made and
            // failed to record would be worse.
            log.warn("Could not serialise media payload for {}: {}", phone, e.getMessage());
        }

        NotificationLog outLog = saveOutgoingLog(phone, instituteId, channel.businessChannelId(),
                mediaPolicy.summaryBody(media), providerMessageId, payloadJson);

        escalationService.resolveForPhone(instituteId, phone, request.getRepliedBy());

        return InboxMessageDTO.builder()
                .id(outLog.getId())
                .body(outLog.getBody())
                .direction("OUTGOING")
                .timestamp(outLog.getNotificationDate())
                .source("INBOX")
                .mediaType(media.type())
                .mediaUrl(media.url())
                .mediaFilename(media.filename())
                .build();
    }

    // ==================== Session window ====================

    /**
     * Whether free-form replies are still allowed on this conversation, measured from the learner's
     * last inbound message.
     * <p>
     * With no inbound message on record the answer is {@code unknown}, not closed — the conversation
     * may predate inbound logging, or the webhook may have missed a message. Callers must not treat
     * unknown as a refusal.
     */
    public SessionWindowDTO sessionWindow(String phone, String instituteId) {
        Instant lastInbound = notificationLogRepository
                .findTopByChannelIdAndInstituteIdAndNotificationTypeOrderByNotificationDateDesc(
                        phone, instituteId, INCOMING)
                .map(NotificationLog::getNotificationDate)
                .orElse(null);

        if (lastInbound == null) {
            return SessionWindowDTO.builder().open(false).unknown(true).build();
        }

        Instant expiresAt = lastInbound.plus(SESSION_WINDOW);
        long minutesLeft = Duration.between(Instant.now(), expiresAt).toMinutes();
        return SessionWindowDTO.builder()
                .open(minutesLeft > 0)
                .lastInboundAt(lastInbound)
                .expiresAt(expiresAt)
                .minutesRemaining(Math.max(minutesLeft, 0))
                .unknown(false)
                .build();
    }

    /** "the learner last replied 3 days ago", for a refusal an admin can act on. */
    private String describeAge(Instant lastInboundAt) {
        if (lastInboundAt == null) return "no reply on record";
        long hours = Duration.between(lastInboundAt, Instant.now()).toHours();
        if (hours < 48) return "they last replied " + hours + " hours ago";
        return "they last replied " + (hours / 24) + " days ago";
    }

    // ==================== Shared send plumbing ====================

    /** The WhatsApp channel an institute sends through, and the provider that talks to it. */
    private record Channel(ChatbotMessageProvider provider, String businessChannelId) {}

    private Channel resolveChannel(String instituteId) {
        List<ChannelToInstituteMapping> mappings = channelMappingRepository.findAllByInstituteId(instituteId);
        if (mappings.isEmpty()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    "No WhatsApp channel configured for this institute");
        }
        return resolveChannel(mappings);
    }

    /**
     * First mapping wins, and a provider that does not claim the mapping's channel type falls back
     * to whichever one handles plain "WHATSAPP" — the behaviour every sender here has always had.
     */
    private Channel resolveChannel(List<ChannelToInstituteMapping> mappings) {
        ChannelToInstituteMapping mapping = mappings.get(0);
        String channelType = mapping.getChannelType();

        ChatbotMessageProvider provider = messageProviders.stream()
                .filter(p -> p.supports(channelType))
                .findFirst()
                .orElse(messageProviders.stream()
                        .filter(p -> p.supports("WHATSAPP"))
                        .findFirst()
                        .orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(
                                org.springframework.http.HttpStatus.BAD_REQUEST, "No WhatsApp provider found")));

        return new Channel(provider, mapping.getChannelId());
    }

    /**
     * The outbound row every Inbox send writes. {@code providerMessageId} lands on source_id so the
     * sent/delivered/read webhooks join THIS message rather than the most recent outbound to the
     * same phone.
     */
    private NotificationLog saveOutgoingLog(String phone, String instituteId, String businessChannelId,
                                            String body, String providerMessageId, String messagePayload) {
        NotificationLog outLog = new NotificationLog();
        outLog.setNotificationType(OUTGOING);
        outLog.setChannelId(phone);
        outLog.setBody(body);
        outLog.setSource("INBOX");
        outLog.setSourceId(providerMessageId);
        outLog.setSenderBusinessChannelId(businessChannelId);
        outLog.setInstituteId(instituteId);
        outLog.setNotificationDate(Instant.now());
        outLog.setMessagePayload(messagePayload);

        // Link userId from previous messages
        try {
            notificationLogRepository
                    .findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(phone, OUTGOING)
                    .ifPresent(prev -> outLog.setUserId(prev.getUserId()));
        } catch (Exception ignored) {}

        notificationLogRepository.save(outLog);
        return outLog;
    }

    /** Free-form media recorded on an outgoing row, read back so the thread can re-render it. */
    private record MediaMeta(String type, String url, String filename) {}

    private MediaMeta readMediaMeta(String messagePayload) {
        if (messagePayload == null || !messagePayload.contains("mediaUrl")) return null;
        try {
            Map<String, Object> payload = objectMapper.readValue(messagePayload,
                    new TypeReference<Map<String, Object>>() {});
            Object url = payload.get("mediaUrl");
            if (url == null || url.toString().isBlank()) return null;
            Object type = payload.get("mediaType");
            Object filename = payload.get("filename");
            return new MediaMeta(type != null ? type.toString() : null, url.toString(),
                    filename != null ? filename.toString() : null);
        } catch (Exception e) {
            log.debug("Unparseable media payload on log row: {}", e.getMessage());
            return null;
        }
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return null;
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
