package vacademy.io.notification_service.features.webhook.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.common.logging.SentryLogger;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.combot.action.dto.FlowContext;
import vacademy.io.notification_service.features.combot.action.service.FlowActionRouter;
import vacademy.io.notification_service.features.combot.service.CombotWebhookService;
import vacademy.io.notification_service.features.combot.entity.ChannelFlowConfig;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.repository.ChannelFlowConfigRepository;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.webhook.dto.UnifiedWebhookEvent;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Central service that processes UnifiedWebhookEvent.
 * Logs all webhook events to notification_log table and
 * delegates to appropriate handlers based on event type.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WebhookEventProcessor {

    private final NotificationLogRepository notificationLogRepository;
    private final ObjectMapper objectMapper;
    private final FlowActionRouter flowActionRouter;
    private final ChannelToInstituteMappingRepository channelMappingRepository;
    private final ChannelFlowConfigRepository flowConfigRepository;
    private final ChatbotFlowEngine chatbotFlowEngine;

    // @Lazy to keep the existing constructor-injected graph cycle-free; reused for opt-out
    // keyword handling (which historically lived only on the COMBOT webhook path).
    @Lazy
    @Autowired
    private CombotWebhookService combotWebhookService;

    // Notification types for webhook events
    private static final String WHATSAPP_STATUS_EVENT = "WHATSAPP_STATUS_EVENT";
    private static final String WHATSAPP_INCOMING_MESSAGE = "WHATSAPP_MESSAGE_INCOMING";
    private static final String WHATSAPP_VERIFICATION = "WHATSAPP_VERIFICATION";

    // Dedup: WATI sends to both /{channelId} and /{channelId}/incoming
    private final ConcurrentHashMap<String, Long> processedMessageIds = new ConcurrentHashMap<>();

    /**
     * Provider error codes that mean the ACCOUNT cannot send at all, not that one recipient could
     * not be reached. Recipient-level codes (131026 undeliverable, 131047 re-engagement window,
     * 131049 per-user marketing cap) are deliberately absent — they are normal traffic and alerting
     * on them would bury the ones that need a human.
     * <p>
     * 131042 business eligibility / payment method, 131031 account restricted or locked,
     * 131045 phone number not registered or certificate problem.
     */
    private static final Set<String> ACCOUNT_LEVEL_FAILURE_CODES = Set.of("131042", "131031", "131045");

    private static final long ACCOUNT_FAILURE_ALERT_WINDOW_MS = 30 * 60 * 1000L;

    // institute:errorCode → last alert time, so a dead account raises one Sentry event per half
    // hour instead of one per rejected message.
    private final ConcurrentHashMap<String, Long> accountFailureAlertedAt = new ConcurrentHashMap<>();

    /**
     * Process a unified webhook event from any vendor.
     * 1. Logs the event to notification_log table (with businessChannelId)
     * 2. Routes to appropriate handler based on event type
     *
     * @param event Unified webhook event
     */
    public void processEvent(UnifiedWebhookEvent event) {
        // Dedup: skip if same messageId was processed in last 30 seconds
        String msgId = event.getExternalMessageId();
        if (msgId != null) {
            Long prev = processedMessageIds.putIfAbsent(msgId, System.currentTimeMillis());
            if (prev != null) {
                log.info("Skipping duplicate webhook: messageId={}", msgId);
                return;
            }
            // Evict old entries (>60s) to prevent memory leak
            long cutoff = System.currentTimeMillis() - 60_000;
            processedMessageIds.entrySet().removeIf(e -> e.getValue() < cutoff);
        }

        log.info("Processing webhook event: vendor={}, type={}, messageId={}, phone={}, businessChannelId={}",
                event.getVendor(),
                event.getEventType(),
                event.getExternalMessageId(),
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId());

        // Step 1: Log to notification_log table
        NotificationLog savedLog = saveWebhookToNotificationLog(event);
        log.debug("Saved webhook event to notification_log: id={}", savedLog.getId());

        // Step 2: Process based on event type
        switch (event.getEventType()) {
            case SENT -> handleMessageSent(event, savedLog);
            case DELIVERED -> handleMessageDelivered(event, savedLog);
            case READ -> handleMessageRead(event, savedLog);
            case FAILED -> handleMessageFailed(event, savedLog);
            case REPLY -> handleUserReply(event, savedLog);
            case VERIFICATION_RESPONSE -> handleVerificationResponse(event, savedLog);
            case UNKNOWN -> handleUnknownEvent(event, savedLog);
        }
    }

    /**
     * Save webhook event to notification_log table
     */
    private NotificationLog saveWebhookToNotificationLog(UnifiedWebhookEvent event) {
        NotificationLog notificationLog = new NotificationLog();

        // Determine notification type based on event
        String notificationType = determineNotificationType(event);
        notificationLog.setNotificationType(notificationType);

        // Channel ID is the phone number for WhatsApp
        notificationLog.setChannelId(event.getPhoneNumber());

        // Body contains event details
        notificationLog.setBody(buildEventBody(event));

        // Source is the vendor name (WATI, META, etc.)
        notificationLog.setSource(event.getVendor());

        // Source ID is the external message ID
        notificationLog.setSourceId(event.getExternalMessageId());

        // Business channel ID - identifies which business account
        notificationLog.setSenderBusinessChannelId(event.getBusinessChannelId());

        // Sender name from WhatsApp profile (for inbox display)
        if (event.getSenderName() != null && !event.getSenderName().isBlank()) {
            notificationLog.setSenderName(event.getSenderName());
        }

        // Notification date from event timestamp
        notificationLog.setNotificationDate(
                event.getTimestamp() != null ? event.getTimestamp() : Instant.now());

        // Resolve institute_id from the business channel id so the Hub's WA Inbox can
        // scope by institute without re-joining channel_to_institute_mapping at read time.
        if (event.getBusinessChannelId() != null) {
            channelMappingRepository.findById(event.getBusinessChannelId())
                    .ifPresent(m -> notificationLog.setInstituteId(m.getInstituteId()));
        }

        // Record the verdict this event carried on the row itself. Without it the status lives
        // only inside the raw payload, in a different shape per vendor, so nothing can later ask
        // "what did the provider say about this message" — which is exactly what a send row that
        // was written AFTER its own status webhook needs to ask. See
        // NotificationLogRepository#backfillDeliveryStatusFromRecordedEvents.
        switch (event.getEventType()) {
            case SENT, DELIVERED, READ, FAILED -> {
                notificationLog.setDeliveryStatus(event.getEventType().name());
                notificationLog.setDeliveryErrorCode(truncate(event.getErrorCode(), 50));
                notificationLog.setDeliveryErrorMessage(truncate(event.getErrorMessage(), 500));
                notificationLog.setDeliveryUpdatedAt(
                        event.getTimestamp() != null ? event.getTimestamp() : Instant.now());
            }
            default -> { /* replies and verification responses are not delivery statuses */ }
        }

        // Store raw payload as JSON
        try {
            if (event.getRawPayload() != null) {
                notificationLog.setMessagePayload(objectMapper.writeValueAsString(event.getRawPayload()));
            }
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize raw payload: {}", e.getMessage());
            notificationLog.setMessagePayload("{}");
        }

        return notificationLogRepository.save(notificationLog);
    }

    /**
     * Determine notification type based on event type
     */
    private String determineNotificationType(UnifiedWebhookEvent event) {
        return switch (event.getEventType()) {
            case SENT, DELIVERED, READ, FAILED -> WHATSAPP_STATUS_EVENT;
            case REPLY -> WHATSAPP_INCOMING_MESSAGE;
            case VERIFICATION_RESPONSE -> WHATSAPP_VERIFICATION;
            case UNKNOWN -> "WEBHOOK_UNKNOWN";
        };
    }

    /**
     * Build human-readable body from event
     */
    private String buildEventBody(UnifiedWebhookEvent event) {
        StringBuilder body = new StringBuilder();

        if (event.getMessageText() != null) {
            // Inbound REPLY text is stored IN FULL (matching the Combot webhook path, which already
            // stores full bodies): the Engagement Engine's auto-reply classifies money/anger/refund
            // on this text, and a 100-char preview can cut the message BEFORE the money word —
            // auto-answering a refund question the design mandates escalating. Status events keep
            // the compact preview.
            if (event.getEventType() == UnifiedWebhookEvent.EventType.REPLY) {
                body.append(event.getMessageText());
            } else {
                body.append(truncateText(event.getMessageText(), 100));
            }
        }

        if (event.getErrorMessage() != null) {
            body.append(" [ERROR: ").append(event.getErrorMessage()).append("]");
        }

        return body.toString();
    }

    private void handleMessageSent(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.info("Message sent - externalId={}, phone={}, businessChannel={}, logId={}",
                event.getExternalMessageId(),
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId(),
                logEntry.getId());
        reconcileOutboundRow(event, "SENT");
    }

    private void handleMessageDelivered(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.info("Message delivered - externalId={}, phone={}, businessChannel={}, logId={}",
                event.getExternalMessageId(),
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId(),
                logEntry.getId());
        reconcileOutboundRow(event, "DELIVERED");
    }

    private void handleMessageRead(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.info("Message read - externalId={}, phone={}, businessChannel={}, logId={}",
                event.getExternalMessageId(),
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId(),
                logEntry.getId());
        reconcileOutboundRow(event, "READ");
    }

    private void handleMessageFailed(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.error("Message failed - externalId={}, phone={}, businessChannel={}, error={} ({}), logId={}",
                event.getExternalMessageId(),
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId(),
                event.getErrorMessage(),
                event.getErrorCode(),
                logEntry.getId());
        reconcileOutboundRow(event, "FAILED");
        alertIfAccountLevelFailure(event, logEntry);
    }

    /**
     * Stamp the provider's verdict onto the outbound row that sent the message, so the Inbox and the
     * communication timeline stop reporting a rejected message as delivered. A provider 2xx is only
     * an acceptance receipt; this webhook is the first and only place the real outcome is known.
     * <p>
     * Best-effort by contract: the status row has already been persisted by the caller, so a failure
     * here loses an annotation, never an event. Webhook processing must not break because a
     * reconciliation UPDATE did.
     */
    private void reconcileOutboundRow(UnifiedWebhookEvent event, String status) {
        String providerMessageId = event.getExternalMessageId();
        if (providerMessageId == null || providerMessageId.isBlank()) {
            return;
        }
        try {
            int updated = notificationLogRepository.applyDeliveryStatusByProviderMessageId(
                    providerMessageId,
                    status,
                    event.getErrorCode(),
                    event.getErrorMessage(),
                    event.getTimestamp() != null ? event.getTimestamp() : Instant.now());
            if (updated == 0) {
                // Normal for a status that outran its own send row, or a send path that stores no
                // wamid — worth a debug line when tracing "why is this message still unmarked".
                log.debug("No outbound row to mark {} for messageId={}", status, providerMessageId);
            }
        } catch (Exception e) {
            log.warn("Could not stamp delivery status {} on outbound row for messageId={}: {}",
                    status, providerMessageId, e.getMessage());
        }
    }

    /**
     * Raise a Sentry event for failures that are ACCOUNT-level rather than recipient-level. These
     * kill every send on the number until a human fixes billing or the account itself, and they are
     * invisible everywhere else: the send API still returns success, and Meta's own health_status
     * keeps reporting can_send_message=AVAILABLE throughout. HCCA lost 202 messages over three weeks
     * to 131042 with nothing to alert on.
     * <p>
     * Throttled to one event per institute+code per 30 minutes — a broken account fails EVERY send,
     * so an unthrottled alert would be a few hundred identical Sentry events an hour.
     */
    private void alertIfAccountLevelFailure(UnifiedWebhookEvent event, NotificationLog logEntry) {
        String code = event.getErrorCode();
        if (code == null || !ACCOUNT_LEVEL_FAILURE_CODES.contains(code.trim())) {
            return;
        }
        String instituteId = logEntry.getInstituteId() != null ? logEntry.getInstituteId() : "unknown";
        String throttleKey = instituteId + ":" + code.trim();
        long now = System.currentTimeMillis();
        Long lastAlert = accountFailureAlertedAt.get(throttleKey);
        if (lastAlert != null && now - lastAlert < ACCOUNT_FAILURE_ALERT_WINDOW_MS) {
            return;
        }
        accountFailureAlertedAt.put(throttleKey, now);
        accountFailureAlertedAt.entrySet()
                .removeIf(e -> now - e.getValue() > ACCOUNT_FAILURE_ALERT_WINDOW_MS * 2);

        SentryLogger.logError(
                new IllegalStateException("WhatsApp account-level send failure: " + code),
                "WhatsApp sends are failing for the whole account — every message on this number is "
                        + "being rejected by the provider, while the send API still reports success",
                Map.of(
                        "institute.id", instituteId,
                        "whatsapp.error.code", code.trim(),
                        "whatsapp.error.message",
                        event.getErrorMessage() != null ? event.getErrorMessage() : "unknown",
                        "whatsapp.business.channel.id",
                        event.getBusinessChannelId() != null ? event.getBusinessChannelId() : "unknown",
                        "vendor", event.getVendor() != null ? event.getVendor() : "unknown"));
    }

    /**
     * Handle user reply - routes through action_template_config if configured
     */
    private void handleUserReply(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.info("User reply received - phone={}, businessChannel={}, text={}, logId={}",
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId(),
                truncateText(event.getMessageText(), 50),
                logEntry.getId());

        // Route through FlowActionRouter for WATI webhooks
        routeIncomingMessage(event);
    }

    private void handleVerificationResponse(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.info("Verification response received - phone={}, businessChannel={}, text={}, logId={}",
                maskPhoneNumber(event.getPhoneNumber()),
                event.getBusinessChannelId(),
                event.getMessageText(),
                logEntry.getId());

        // Also route verification responses through action router
        routeIncomingMessage(event);
    }

    /**
     * Route incoming message through FlowActionRouter based on
     * action_template_config
     */

    // Ensure you have ObjectMapper injected in this class
    // @Autowired
    // private ObjectMapper objectMapper;

    private void routeIncomingMessage(UnifiedWebhookEvent event) {
        String businessChannelId = event.getBusinessChannelId();

        if (businessChannelId == null || businessChannelId.isBlank()) {
            log.debug("No businessChannelId available, skipping action routing");
            return;
        }

        try {
            // 1. Get institute from channel mapping
            Optional<ChannelToInstituteMapping> mappingOpt = channelMappingRepository.findById(businessChannelId);
            if (mappingOpt.isEmpty()) {
                log.debug("No channel mapping found for businessChannelId={}", businessChannelId);
                return;
            }

            ChannelToInstituteMapping mapping = mappingOpt.get();
            String instituteId = mapping.getInstituteId();
            String channelType = mapping.getChannelType();

            // 1a. Opt-out keywords take precedence over any flow ("Opt out of challenge",
            // STOP / OPT OUT / UNSUBSCRIBE). Opt-out detection historically lived only on the
            // COMBOT webhook path, so WATI inbounds never opted anyone out — handle it here.
            if (combotWebhookService.handleOptOutKeyword(event.getMessageText(),
                    event.getPhoneNumber(), instituteId)) {
                log.info("Opt-out handled for phone={} on channel {}",
                        maskPhoneNumber(event.getPhoneNumber()), businessChannelId);
                return;
            }

            // 1b. NEW: Try chatbot flow engine first (graph-based flows)
            boolean handledByNewFlow = chatbotFlowEngine.handleIncomingMessage(
                    instituteId, channelType, event.getPhoneNumber(), event.getMessageText(),
                    businessChannelId, event.getMessageType(),
                    event.getButtonId(), event.getButtonPayload(), event.getListReplyId());
            if (handledByNewFlow) {
                log.info("Message handled by chatbot flow engine for phone={} via {}",
                        maskPhoneNumber(event.getPhoneNumber()), event.getVendor());
                return;
            }

            // 2. Fall back to legacy: find config with action_template_config for this channel
            Optional<ChannelFlowConfig> configOpt = flowConfigRepository
                    .findAllByInstituteIdAndChannelTypeAndIsActiveTrue(instituteId, channelType)
                    .stream()
                    .filter(c -> c.getActionTemplateConfig() != null && !c.getActionTemplateConfig().isBlank())
                    .findFirst();

            // Fallback for sharing Jumpstart Flow configurations across Whatsapp providers
            if (configOpt.isEmpty() && (channelType.equals("WHATSAPP_WATI") || channelType.equals("WHATSAPP_META"))) {
                log.debug("No active flow config for {}, falling back to WHATSAPP_COMBOT for {} rules sharing",
                        channelType, instituteId);
                configOpt = flowConfigRepository
                        .findAllByInstituteIdAndChannelTypeAndIsActiveTrue(instituteId, "WHATSAPP_COMBOT")
                        .stream()
                        .filter(c -> c.getActionTemplateConfig() != null && !c.getActionTemplateConfig().isBlank())
                        .findFirst();
            }

            if (configOpt.isEmpty()) {
                log.debug("No active flow config with action_template_config for instituteId={}, channelType={}",
                        instituteId, channelType);
                return;
            }

            ChannelFlowConfig config = configOpt.get();

            // 3. Check if action_template_config exists
            String actionConfigJson = config.getActionTemplateConfig();
            if (actionConfigJson == null || actionConfigJson.isBlank()) {
                log.debug("No action_template_config for instituteId={}", instituteId);
                return;
            }

            // ==================================================================================
            // NEW CODE: Parse JSON to extract session IDs before building context
            // ==================================================================================
            String packageSessionId = null;
            String destinationPackageSessionId = null;

            try {
                JsonNode rootNode = objectMapper.readTree(actionConfigJson);

                if (rootNode.has("package_session_id")) {
                    packageSessionId = rootNode.get("package_session_id").asText();
                }

                if (rootNode.has("destination_package_session_id")) {
                    destinationPackageSessionId = rootNode.get("destination_package_session_id").asText();
                }
            } catch (Exception e) {
                log.error("Failed to parse action_template_config JSON for extra fields", e);
                // We continue execution; the fields will just be null
            }
            // ==================================================================================

            // 4. Build flow context (Added the new fields here)
            FlowContext flowContext = FlowContext.builder()
                    .phoneNumber(event.getPhoneNumber())
                    .instituteId(instituteId)
                    .businessChannelId(businessChannelId)
                    .channelType(channelType)
                    .messageText(event.getMessageText())
                    .packageSessionId(packageSessionId) // <--- NEW
                    .destinationPackageSessionId(destinationPackageSessionId) // <--- NEW
                    .build();

            // 5. Route actions
            boolean actionsExecuted = flowActionRouter.routeActions(
                    actionConfigJson,
                    event.getMessageText(),
                    flowContext);

            if (actionsExecuted) {
                log.info("Actions executed for phone={} from WATI webhook",
                        maskPhoneNumber(event.getPhoneNumber()));
            }

        } catch (Exception e) {
            log.error("Error routing incoming message: {}", e.getMessage(), e);
        }
    }

    private void handleUnknownEvent(UnifiedWebhookEvent event, NotificationLog logEntry) {
        log.warn("Unknown event type received - vendor={}, businessChannel={}, logId={}",
                event.getVendor(),
                event.getBusinessChannelId(),
                logEntry.getId());
    }

    private String maskPhoneNumber(String phone) {
        if (phone == null || phone.length() < 4) {
            return "***";
        }
        return "***" + phone.substring(phone.length() - 4);
    }

    private String truncateText(String text, int maxLength) {
        if (text == null)
            return null;
        return text.length() <= maxLength ? text : text.substring(0, maxLength) + "...";
    }

    /**
     * Hard cut to a column's width — no ellipsis, unlike {@link #truncateText}. A value that
     * overflowed delivery_error_code/message would abort the insert and lose the whole event.
     */
    private static String truncate(String value, int maxLength) {
        if (value == null) return null;
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
