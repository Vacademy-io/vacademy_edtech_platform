package vacademy.io.notification_service.features.combot.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.combot.constants.CombotConstants;
import vacademy.io.notification_service.features.combot.constants.CombotWebhookKeys;
import vacademy.io.notification_service.features.combot.dto.WhatsAppTemplateRequest;
import vacademy.io.notification_service.features.combot.entity.ChannelFlowConfig;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.action.dto.FlowContext;
import vacademy.io.notification_service.features.combot.action.service.FlowActionRouter;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotFlowEngine;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.combot.enums.CombotNotificationType;
import vacademy.io.notification_service.features.combot.enums.WhatsAppMessageType;
import vacademy.io.notification_service.features.combot.repository.ChannelFlowConfigRepository;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.*;

/**
 * FINAL FULLY CORRECTED SERVICE
 * Handles:
 * - Outgoing logs
 * - Incoming message logs & Interactive Flow (State Machine)
 * - Message status events
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CombotWebhookService {

    @Value("${admin.core.service.baseurl:http://admin-core-service.vacademy.svc.cluster.local:8072}")
    private String adminCoreServiceBaseUrl;

    @Value("${spring.application.name:notification_service}")
    private String clientName;

    private final InternalClientUtils internalClientUtils;
    private final NotificationLogRepository notificationLogRepository;
    private final ChannelToInstituteMappingRepository mappingRepository;
    private final ChannelFlowConfigRepository flowConfigRepository;
    private final ObjectMapper objectMapper;
    private final UserAnnouncementPreferenceService preferenceService;
    private final FlowActionRouter flowActionRouter;
    private final AdminCoreServiceClient adminCoreServiceClient;

    /** Inbound types that can carry a user-typed caption. */
    private static final Set<String> MEDIA_TYPES = Set.of("image", "video", "document");

    // --- FIX: CIRCULAR DEPENDENCY BREAKER ---
    // 1. Remove 'final' so Lombok doesn't put it in the constructor
    // 2. Add @Autowired to inject it after bean construction
    // 3. Keep @Lazy to ensure a proxy is used if needed
    @Autowired
    @Lazy
    private CombotMessagingService messagingService;

    @Autowired
    @Lazy
    private ChatbotFlowEngine chatbotFlowEngine;

    // ========================================================================
    // 1️⃣ OUTGOING MESSAGE LOGGING
    // ========================================================================
    @Transactional
    public NotificationLog logOutgoingMessage(String messageId, String toPhone, String messageBody, String userId,
                                              Map<String, Object> rawPayloadSent, String channelId) {
        NotificationLog out = new NotificationLog();
        out.setNotificationType(CombotNotificationType.WHATSAPP_OUTGOING.getType());
        out.setChannelId(toPhone);
        out.setBody(messageBody);
        out.setSource(CombotConstants.SOURCE_COMBOT);
        out.setSourceId(messageId);
        out.setUserId(userId);
        out.setNotificationDate(Instant.now());
        out.setSenderBusinessChannelId(channelId);
        if (channelId != null) {
            mappingRepository.findById(channelId).ifPresent(m -> out.setInstituteId(m.getInstituteId()));
        }

        try {
            if (rawPayloadSent != null) {
                out.setMessagePayload(objectMapper.writeValueAsString(rawPayloadSent));
            }
        } catch (Exception e) {
            log.warn("Failed to serialize message payload", e);
            out.setMessagePayload(String.valueOf(rawPayloadSent));
        }

        NotificationLog saved = notificationLogRepository.save(out);
        log.info("Logged outgoing WhatsApp message to {} -> {}", toPhone, messageBody);
        return saved;
    }

    @Transactional
    public void processCombotStatusWebhook(String messageId, String phone, String status, Map<String, Object> raw) {
        log.info("Processing Com.bot simple status webhook: messageId={}, phone={}, status={}",
                messageId, phone, status);

        if (messageId == null) {
            log.error("Com.bot webhook missing messageId");
            return;
        }

        String notificationType = CombotNotificationType.fromStatus(status).getType();

        Optional<NotificationLog> originalOpt = findOutgoingByMessageId(messageId);
        boolean exactJoin = originalOpt.isPresent();
        if (originalOpt.isEmpty() && phone != null) {
            originalOpt = findOutgoingByPhone(phone);
        }

        NotificationLog statusLog = new NotificationLog();
        statusLog.setNotificationType(notificationType);
        statusLog.setChannelId(phone);
        statusLog.setBody("Status: " + status);
        statusLog.setSourceId(messageId);
        statusLog.setNotificationDate(Instant.now());

        originalOpt.ifPresent(original -> {
            statusLog.setSource(original.getId());
            statusLog.setUserId(original.getUserId());
            // Preserve sender channel ID + institute for context
            statusLog.setSenderBusinessChannelId(original.getSenderBusinessChannelId());
            statusLog.setInstituteId(original.getInstituteId());
            // Carry the correlation key ONLY on the exact message-id join. The phone fallback
            // returns "most recent outbound to this phone" — stamping ITS correlation here would
            // attribute this status to a different decision (e.g. an old Engagement Engine send).
            if (exactJoin) {
                statusLog.setCorrelationId(original.getCorrelationId());
            }
        });

        notificationLogRepository.save(statusLog);
        reconcileOutboundDeliveryStatus(messageId, deliveryStatusFor(status), null, null);
        log.info("Saved Com.bot status event: {} → {}", messageId, notificationType);
    }

    // ========================================================================
    // 3️⃣ PROCESS WhatsApp Cloud API STATUS WEBHOOK
    // ========================================================================
    @Transactional
    public void processMessageStatusFromWebhook(Map<String, Object> value, Map<String, Object> entry) {
        List<Map<String, Object>> statuses = (List<Map<String, Object>>) value.get("statuses");
        if (statuses == null || statuses.isEmpty())
            return;

        for (Map<String, Object> status : statuses) {
            String messageId = (String) status.get("id");
            String statusValue = (String) status.get(CombotWebhookKeys.STATUS);
            String recipientId = (String) status.get(CombotWebhookKeys.RECIPIENT_ID);

            String notificationType = CombotNotificationType.fromStatus(statusValue).getType();

            Optional<NotificationLog> originalOpt = findOutgoingByMessageId(messageId);
            boolean exactJoin = originalOpt.isPresent();
            if (originalOpt.isEmpty()) {
                originalOpt = findOutgoingByPhone(recipientId);
            }

            NotificationLog st = new NotificationLog();
            st.setNotificationType(notificationType);
            st.setChannelId(recipientId);
            st.setBody("Status: " + statusValue);
            st.setSourceId(messageId);
            st.setNotificationDate(Instant.now());

            originalOpt.ifPresent(original -> {
                st.setSource(original.getId());
                st.setUserId(original.getUserId());
                st.setSenderBusinessChannelId(original.getSenderBusinessChannelId());
                st.setInstituteId(original.getInstituteId());
                // Carry the correlation key ONLY on the exact message-id join. The phone fallback
                // returns "most recent outbound to this phone" — stamping ITS correlation here
                // would attribute this status to a different decision.
                if (exactJoin) {
                    st.setCorrelationId(original.getCorrelationId());
                }
            });

            notificationLogRepository.save(st);
            // Carry the verdict onto the row that SENT the message, not just this status row.
            // "failed" is deliberately left to processMessageFailedFromWebhook below: it has the
            // error code and message, and a bare FAILED stamped here would win the monotonic
            // guard and lose them.
            if (!"failed".equalsIgnoreCase(statusValue)) {
                reconcileOutboundDeliveryStatus(messageId, deliveryStatusFor(statusValue), null, null);
            }
            log.info("Stored WhatsApp status {} for message {}", statusValue, messageId);

            if ("failed".equalsIgnoreCase(statusValue)) {
                Object errorsRaw = status.get(CombotWebhookKeys.ERRORS);
                Map<String, Object> errors = null;
                if (errorsRaw instanceof List<?> list && !((List<?>) list).isEmpty()) {
                    Object first = ((List<?>) list).get(0);
                    if (first instanceof Map<?, ?>) {
                        //noinspection unchecked
                        errors = (Map<String, Object>) first;
                    }
                } else if (errorsRaw instanceof Map<?, ?>) {
                    //noinspection unchecked
                    errors = (Map<String, Object>) errorsRaw;
                }
                processMessageFailedFromWebhook(messageId, recipientId, errors, entry);
            }
        }
    }

    // ========================================================================
    // 4️⃣ FAILED MESSAGE PROCESSING
    // ========================================================================
    @Transactional
    public void processMessageFailedFromWebhook(String messageId, String recipientId,
                                                Map<String, Object> errorData, Map<String, Object> entry) {
        String errorCode = extractErrorCode(errorData);
        String errorMessage = extractErrorMessage(errorData);

        Optional<NotificationLog> originalOpt = findOutgoingByMessageId(messageId);

        NotificationLog fail = new NotificationLog();
        fail.setNotificationType(CombotNotificationType.WHATSAPP_FAILED.getType());
        fail.setChannelId(recipientId);
        fail.setBody("Error: " + errorMessage + " (code=" + errorCode + ")");
        fail.setSourceId(messageId);
        fail.setNotificationDate(Instant.now());
        // The reason also goes in the delivery columns, not only the body: when this webhook beats
        // the send to its own row, the send-side backfill copies the verdict from these event rows
        // later, and it reads the columns — a reason left only in the body was lost there.
        fail.setDeliveryStatus("FAILED");
        fail.setDeliveryErrorCode(truncateTo(errorCode, 50));
        fail.setDeliveryErrorMessage(truncateTo(errorMessage, 500));

        originalOpt.ifPresent(original -> {
            fail.setSource(original.getId());
            fail.setUserId(original.getUserId());
            fail.setSenderBusinessChannelId(original.getSenderBusinessChannelId());
            fail.setInstituteId(original.getInstituteId());
            // Carry the caller's correlation key so ledger reads can join failure → decision directly
            fail.setCorrelationId(original.getCorrelationId());
        });

        notificationLogRepository.save(fail);
        reconcileOutboundDeliveryStatus(messageId, "FAILED", errorCode, errorMessage);
        log.warn("Stored FAILED event for message {} → {}", messageId, errorMessage);
    }

    /**
     * Stamp the provider's verdict onto the WHATSAPP_MESSAGE_OUTGOING row that sent the message.
     * <p>
     * The status row saved above is what the Inbox and the communication timeline read, but anything
     * asking "what happened to THIS message" — /unified-send/delivery-status, and the send dialog
     * that polls it — reads notification_log.delivery_status on the outbound row itself. Without
     * this, every message whose statuses arrive on the Com.bot / Meta Cloud webhook stayed PENDING
     * forever: the dialog could only ever say "accepted, awaiting confirmation" for a message
     * WhatsApp had already reported delivered seconds earlier. Only the WATI/Meta unified webhook
     * path did this reconciliation.
     * <p>
     * Best-effort by contract: the status row is already persisted, so a failure here loses an
     * annotation, never an event.
     */
    private void reconcileOutboundDeliveryStatus(String providerMessageId, String status,
                                                 String errorCode, String errorMessage) {
        if (providerMessageId == null || providerMessageId.isBlank() || status == null) {
            return;
        }
        try {
            int updated = notificationLogRepository.applyDeliveryStatusByProviderMessageId(
                    providerMessageId, status, errorCode, errorMessage, Instant.now());
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

    /** Webhook status word → the delivery_status vocabulary. Null for anything unrecognised. */
    private String deliveryStatusFor(String statusValue) {
        if (statusValue == null) return null;
        return switch (statusValue.toLowerCase()) {
            case "sent" -> "SENT";
            case "delivered" -> "DELIVERED";
            case "read" -> "READ";
            case "failed" -> "FAILED";
            default -> null;
        };
    }

    // ========================================================================
    // 5️⃣ PROCESS INCOMING MESSAGES (Interactive Flow)
    // ========================================================================

    @Transactional
    public void processIncomingMessageFromWebhook(Map<String, Object> value, Map<String, Object> entry) {
        try {
            // 1. Identify Institute
            String receivingPhoneId = extractPhoneNumberId(value);
            if (receivingPhoneId == null) {
                log.warn("Received webhook without phone_number_id in metadata");
                return;
            }

            Optional<ChannelToInstituteMapping> mappingOpt = mappingRepository.findById(receivingPhoneId);
            if (mappingOpt.isEmpty()) {
                log.warn("No institute mapped for Channel ID: {}", receivingPhoneId);
                return;
            }

            ChannelToInstituteMapping mapping = mappingOpt.get();
            String instituteId = mapping.getInstituteId();
            String channelType = mapping.getChannelType();

            // 2. Process Messages
            List<Map<String, Object>> messages = (List<Map<String, Object>>) value.get(CombotWebhookKeys.MESSAGES);
            if (messages == null)
                return;

            for (Map<String, Object> message : messages) {
                String userPhone = (String) message.get(CombotWebhookKeys.FROM);
                String userText = extractMessageText(message);
                String messageId = (String) message.get(CombotWebhookKeys.MESSAGE_ID);

                // Extract sender name from contacts[0].profile.name
                String senderName = extractSenderName(value);

                // What the Inbox shows: the user's text, or a typed placeholder for a message that
                // carries none (voice note, photo, location) so the bubble is never blank.
                String displayBody = describeIncomingMessage(message, userText);
                if (userText == null || userText.isBlank()) {
                    log.warn("Inbound message carries no text: type={}, phone={}, messageId={}, displayedAs={}",
                            message.get(CombotWebhookKeys.TYPE), userPhone, messageId, displayBody);
                }

                // Log Incoming
                logIncomingMessage(messageId, userPhone, displayBody, receivingPhoneId, senderName, message);

                // --- KEYWORD CHECK FOR OPT OUT ---
                if (isOptOutKeyword(userText)) {
                    log.info("Opt-out keyword received from {}", userPhone);
                    handleOptOut(userPhone, instituteId);
                    continue; // Stop flow processing
                }

                // --- KEYWORD CHECK FOR OPT IN ---
                if (isOptInKeyword(userText)) {
                    log.info("Opt-in keyword received from {}", userPhone);
                    handleOptIn(userPhone, instituteId);
                    continue; // Stop flow processing
                }

                // 3. NEW: Try chatbot flow engine (graph-based) first
                String msgType = message.get(CombotWebhookKeys.TYPE) != null
                        ? message.get(CombotWebhookKeys.TYPE).toString() : "text";
                String btnId = extractInteractiveButtonId(message);
                String btnPayload = extractButtonPayload(message);
                String listId = extractListReplyId(message);

                boolean handledByNewFlow = chatbotFlowEngine.handleIncomingMessage(
                        instituteId, channelType, userPhone, userText, receivingPhoneId,
                        msgType, btnId, btnPayload, listId);
                if (handledByNewFlow) {
                    log.info("Message handled by chatbot flow engine: phone={}", userPhone);
                    continue; // Skip legacy ChannelFlowConfig processing
                }

                // 4. Fall back to legacy ChannelFlowConfig (Existing logic)
                Optional<NotificationLog> lastLogOpt = notificationLogRepository
                        .findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                                userPhone, receivingPhoneId, CombotNotificationType.WHATSAPP_OUTGOING.getType());

                // Fallback: outgoing logs from whatsapp-service may not have senderBusinessChannelId set,
                // so filter by provider in the body field to only match COMBOT messages
                if (lastLogOpt.isEmpty()) {
                    lastLogOpt = notificationLogRepository
                            .findLatestOutgoingByChannelIdAndProvider(
                                    userPhone, CombotNotificationType.WHATSAPP_OUTGOING.getType(), "COMBOT");
                }

                String lastTemplate = CombotConstants.DEFAULT_TEMPLATE;
                if (lastLogOpt.isPresent()) {
                    lastTemplate = legacyFlowTemplateOf(lastLogOpt.get());
                }
                log.info("Flow lookup: phone={}, lastTemplate={}, instituteId={}, channelType={}",
                        userPhone, lastTemplate, instituteId, channelType);

                Optional<ChannelFlowConfig> flowConfigOpt = flowConfigRepository
                        .findByInstituteIdAndCurrentTemplateNameAndChannelTypeAndIsActiveTrue(
                                instituteId, lastTemplate, channelType);

                if (flowConfigOpt.isPresent()) {
                    log.info("Flow config found: id={}, responseConfig={}, actionConfig={}",
                            flowConfigOpt.get().getId(),
                            flowConfigOpt.get().getResponseTemplateConfig(),
                            flowConfigOpt.get().getActionTemplateConfig());
                    executeFlowRule(flowConfigOpt.get(), userText, userPhone, instituteId);
                } else {
                    log.warn("No flow config found for phone={}, lastTemplate={}, instituteId={}, channelType={}",
                            userPhone, lastTemplate, instituteId, channelType);
                }
            }
        } catch (Exception e) {
            log.error("Error processing incoming webhook", e);
        }
    }

    private boolean isOptOutKeyword(String text) {
        if (text == null)
            return false;
        String normalized = text.trim().toUpperCase();
        return normalized.equals("STOP") || normalized.equals("OPT OUT") || normalized.equals("UNSUBSCRIBE")
                || normalized.equals("OPT OUT OF CHALLENGE");
    }

    /**
     * Public entry point so non-COMBOT inbound paths (e.g. WATI via WebhookEventProcessor)
     * can run the same opt-out detection + handling — the keyword check + handleOptOut used to
     * live only on the COMBOT webhook path, so WATI inbounds never opted anyone out.
     *
     * @return true if {@code userText} was an opt-out keyword and was handled (the caller should
     *         then stop further routing); false otherwise.
     */
    public boolean handleOptOutKeyword(String userText, String userPhone, String instituteId) {
        if (!isOptOutKeyword(userText)) {
            return false;
        }
        handleOptOut(userPhone, instituteId);
        return true;
    }

    private boolean isOptInKeyword(String text) {
        if (text == null)
            return false;
        String normalized = text.trim().toUpperCase();
        return normalized.equals("START") || normalized.equals("OPT IN") || normalized.equals("SUBSCRIBE");
    }

    private void handleOptOut(String userPhone, String instituteId) {
        try {
            // 1. Get User ID from Phone
            Map<String, Object> userDetails = getUserDetailsByPhoneNumber(userPhone);
            Object userObj = userDetails.get("user");
            if (userObj == null) {
                log.warn("User object missing in details for phone {}", userPhone);
                return;
            }

            // Assuming you have imported UserDTO
            UserDTO user = objectMapper.convertValue(userObj, UserDTO.class);
            String userId = user.getId();

            if (userId != null) {
                // 2. Record opt-out in user_announcement_settings
                preferenceService.setWhatsAppSubscriptionStatus(userId, instituteId, true, userPhone);

                // 3. Move user to opt-out audience in admin_core_service (fire-and-forget)
                adminCoreServiceClient.moveToOptOutAudience(userId, instituteId, "WHATSAPP");

                log.info("Successfully unsubscribed user {} from institute {}", userPhone, instituteId);
            } else {
                log.warn("Could not resolve user ID for phone {} during opt-out", userPhone);
            }
        } catch (Exception e) {
            log.error("Error handling opt-out for {}", userPhone, e);
        }
    }

    private void handleOptIn(String userPhone, String instituteId) {
        try {
            Map<String, Object> userDetails = getUserDetailsByPhoneNumber(userPhone);
            Object userObj = userDetails.get("user");
            if (userObj == null) {
                log.warn("User object missing in details for phone {}", userPhone);
                return;
            }

            // Assuming you have imported UserDTO
            UserDTO user = objectMapper.convertValue(userObj, UserDTO.class);
            String userId = user.getId();
            if (userId != null) {
                preferenceService.setWhatsAppSubscriptionStatus(userId, instituteId, false, userPhone);
                log.info("Successfully resubscribed user {} for institute {}", userPhone, instituteId);
            }
        } catch (Exception e) {
            log.error("Error handling opt-in for {}", userPhone, e);
        }
    }

    // ========================================================================
    // 6️⃣ FLOW LOGIC EXECUTION
    // ========================================================================
    private void executeFlowRule(ChannelFlowConfig config, String userText, String userPhone, String instituteId) {
        try {
            // B. Fetch Dynamic Data from Admin Core (moved up for context building)
            Map<String, Object> userDetails = getUserDetailsByPhoneNumber(userPhone);
            Object userObj = userDetails.get("user");

            // Handle both existing users and first-time users
            String userId;
            if (userObj == null) {
                log.info("First-time user or user not found in system for phone {}. Using anonymous user ID.",
                        userPhone);
                userId = CombotConstants.ANONYMOUS_USER;
                // Populate minimal user details for first-time users
                userDetails.put("phone", userPhone);
                userDetails.put("mobile_number", userPhone);
            } else {
                // Existing user - convert to UserDTO
                UserDTO user = objectMapper.convertValue(userObj, UserDTO.class);
                userId = user.getId();
            }

            // ========================================================================
            // A. FIRST: Process action_template_config (NEW - for workflows, verification)
            // ========================================================================
            if (config.getActionTemplateConfig() != null && !config.getActionTemplateConfig().isBlank()) {
                log.debug("Processing action_template_config for phone={}", userPhone);

                FlowContext flowContext = FlowContext.builder()
                        .phoneNumber(userPhone)
                        .instituteId(instituteId)
                        .userId(userId)
                        .channelType(config.getChannelType())
                        .messageText(userText)
                        .userDetails(userDetails)
                        .build();

                boolean actionsExecuted = flowActionRouter.routeActions(
                        config.getActionTemplateConfig(),
                        userText,
                        flowContext);

                if (actionsExecuted) {
                    log.info("Actions executed from action_template_config for phone={}", userPhone);
                }
            }

            // ========================================================================
            // B. THEN: Process response_template_config (EXISTING - for templates)
            // ========================================================================
            List<String> nextTemplates = determineNextTemplates(config.getResponseTemplateConfig(), userText);

            if (nextTemplates.isEmpty()) {
                log.debug("No templates to send for phone={}", userPhone);
                return;
            }

            // C. Send Each Template in Sequence
            Map<String, List<String>> varConfigMap = parseJsonMap(config.getVariableConfig());

            // D. Parse Fixed Variables Config (if present)
            Map<String, Map<String, String>> fixedVarsMap = parseFixedVariablesConfig(config.getFixedVariablesConfig());

            for (String templateName : nextTemplates) {
                // Get required variables for this template
                List<String> requiredVars = varConfigMap.getOrDefault(templateName, Collections.emptyList());

                // Get fixed variables for this template (if any)
                Map<String, String> fixedVarsForTemplate = fixedVarsMap.getOrDefault(templateName,
                        Collections.emptyMap());

                // Map Data to Variables (supports both dynamic and fixed)
                List<String> paramValues = resolveVariables(requiredVars, userDetails, userPhone, fixedVarsForTemplate);

                log.info("Triggering Auto-Reply: Template={} Params={} for userId={}", templateName, paramValues,
                        userId);

                // Send Message (pass variable names for media detection)
                sendAutoReply(instituteId, userPhone, templateName, requiredVars, paramValues, userId);

                Thread.sleep(CombotConstants.DELAY_BETWEEN_AUTO_REPLIES);
            }

        } catch (Exception e) {
            log.error("Error executing flow rule for user {}", userPhone, e);
        }
    }

    // ========================================================================
    // 7️⃣ HELPER FUNCTIONS & API CALLS
    // ========================================================================

    /**
     * Call Admin Core to get User Details
     */
    public Map<String, Object> getUserDetailsByPhoneNumber(String phoneNumber) {
        String normalizedPhone = phoneNumber.replaceAll("[^0-9]", "");
        try {
            // Using internal client utils for HMAC call
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    adminCoreServiceBaseUrl,
                    "/admin-core-service/internal/user/by-phone?phoneNumber=" + normalizedPhone,
                    null);

            if (response.getBody() == null)
                return new HashMap<>();
            return objectMapper.readValue(response.getBody(), new TypeReference<Map<String, Object>>() {
            });

        } catch (Exception e) {
            log.error("Error fetching user details for phone {}", normalizedPhone, e);
            return new HashMap<>();
        }
    }

    /**
     * Send Auto Reply via Messaging Service
     * Supports both text-only templates and media templates (document, image,
     * video)
     */
    private void sendAutoReply(String instituteId, String toPhone, String templateName,
                               List<String> variableNames, List<String> paramValues, String userId) {
        try {
            WhatsAppTemplateRequest request = new WhatsAppTemplateRequest();
            request.setInstituteId(instituteId);

            WhatsAppTemplateRequest.MessageInfo msg = new WhatsAppTemplateRequest.MessageInfo();
            msg.setUserId(userId);

            Map<String, Object> payload = new HashMap<>();
            payload.put("messaging_product", "whatsapp");
            payload.put("to", toPhone);
            payload.put("type", "template");

            Map<String, Object> template = new HashMap<>();
            template.put("name", templateName);
            template.put("language", Map.of("code", "en"));

            if (!paramValues.isEmpty()) {
                List<Map<String, Object>> components = buildTemplateComponents(variableNames, paramValues);
                template.put("components", components);
            }

            payload.put("template", template);
            msg.setPayload(payload);
            request.setMessages(List.of(msg));

            log.debug("Sending WhatsApp template: {}", templateName);
            // Calls messaging service
            messagingService.sendTemplateMessages(request);

        } catch (Exception e) {
            log.error("Failed to send auto-reply to {}", toPhone, e);
        }
    }

    /**
     * Build template components based on variable types
     * Detects document/image/video templates and formats accordingly
     */
    private List<Map<String, Object>> buildTemplateComponents(List<String> variableNames, List<String> paramValues) {
        List<Map<String, Object>> components = new ArrayList<>();

        // Detect if this is a media template
        MediaTemplateType mediaType = detectMediaTemplateType(variableNames);

        if (mediaType != MediaTemplateType.NONE) {
            // Build header component for media (document/image/video)
            Map<String, Object> headerComponent = buildMediaHeaderComponent(variableNames, paramValues, mediaType);
            if (headerComponent != null) {
                components.add(headerComponent);
            }

            // Add any remaining text parameters to body (if present)
            List<String> remainingTextParams = extractRemainingTextParams(variableNames, paramValues, mediaType);
            if (!remainingTextParams.isEmpty()) {
                components.add(buildBodyComponent(remainingTextParams));
            }
        } else {
            // Standard text-only template - backward compatible
            components.add(buildBodyComponent(paramValues));
        }

        return components;
    }

    /**
     * Detect media template type based on variable name patterns
     */
    private MediaTemplateType detectMediaTemplateType(List<String> variableNames) {
        boolean hasLink = false;
        boolean hasFilename = false;

        for (String varName : variableNames) {
            String lowerName = varName.toLowerCase().trim();

            // Document: requires both 'link' and 'filename'
            if (lowerName.equals("link") || lowerName.equals("document_link")) {
                hasLink = true;
            }
            if (lowerName.equals("filename") || lowerName.equals("document_filename")) {
                hasFilename = true;
            }

            // Image: 'image_link' or 'image_url'
            if (lowerName.equals("image_link") || lowerName.equals("image_url") || lowerName.equals("image")) {
                return MediaTemplateType.IMAGE;
            }

            // Video: 'video_link' or 'video_url'
            if (lowerName.equals("video_link") || lowerName.equals("video_url") || lowerName.equals("video")) {
                return MediaTemplateType.VIDEO;
            }
        }

        // Document detected if both link and filename present
        if (hasLink && hasFilename) {
            return MediaTemplateType.DOCUMENT;
        }

        return MediaTemplateType.NONE;
    }

    /**
     * Build header component for media templates
     */
    private Map<String, Object> buildMediaHeaderComponent(List<String> variableNames,
                                                          List<String> paramValues,
                                                          MediaTemplateType mediaType) {
        Map<String, Object> headerComponent = new HashMap<>();
        headerComponent.put(CombotWebhookKeys.TYPE, "header");

        List<Map<String, Object>> parameters = new ArrayList<>();
        Map<String, Object> mediaParam = new HashMap<>();

        switch (mediaType) {
            case DOCUMENT:
                mediaParam.put(CombotWebhookKeys.TYPE, "document");
                Map<String, Object> documentObj = new HashMap<>();

                // Extract link and filename from paramValues
                for (int i = 0; i < variableNames.size(); i++) {
                    String varName = variableNames.get(i).toLowerCase().trim();
                    if (varName.equals("link") || varName.equals("document_link")) {
                        documentObj.put("link", paramValues.get(i));
                    } else if (varName.equals("filename") || varName.equals("document_filename")) {
                        documentObj.put("filename", paramValues.get(i));
                    }
                }

                mediaParam.put("document", documentObj);
                break;

            case IMAGE:
                mediaParam.put(CombotWebhookKeys.TYPE, "image");
                Map<String, Object> imageObj = new HashMap<>();

                // Find image link
                for (int i = 0; i < variableNames.size(); i++) {
                    String varName = variableNames.get(i).toLowerCase().trim();
                    if (varName.equals("image_link") || varName.equals("image_url") || varName.equals("image")) {
                        imageObj.put("link", paramValues.get(i));
                        break;
                    }
                }

                mediaParam.put("image", imageObj);
                break;

            case VIDEO:
                mediaParam.put(CombotWebhookKeys.TYPE, "video");
                Map<String, Object> videoObj = new HashMap<>();

                // Find video link
                for (int i = 0; i < variableNames.size(); i++) {
                    String varName = variableNames.get(i).toLowerCase().trim();
                    if (varName.equals("video_link") || varName.equals("video_url") || varName.equals("video")) {
                        videoObj.put("link", paramValues.get(i));
                        break;
                    }
                }

                mediaParam.put("video", videoObj);
                break;

            default:
                return null;
        }

        parameters.add(mediaParam);
        headerComponent.put(CombotWebhookKeys.PARAMETERS, parameters);

        return headerComponent;
    }

    /**
     * Build standard body component for text parameters
     */
    private Map<String, Object> buildBodyComponent(List<String> textParams) {
        Map<String, Object> bodyComponent = new HashMap<>();
        bodyComponent.put(CombotWebhookKeys.TYPE, CombotWebhookKeys.BODY);

        List<Map<String, String>> parameters = new ArrayList<>();
        for (String paramVal : textParams) {
            parameters.add(Map.of(
                    CombotWebhookKeys.TYPE, WhatsAppMessageType.TEXT.getType(),
                    CombotWebhookKeys.TEXT, paramVal));
        }

        bodyComponent.put(CombotWebhookKeys.PARAMETERS, parameters);
        return bodyComponent;
    }

    /**
     * Extract text parameters that are not part of media component
     */
    private List<String> extractRemainingTextParams(List<String> variableNames,
                                                    List<String> paramValues,
                                                    MediaTemplateType mediaType) {
        List<String> remainingParams = new ArrayList<>();

        for (int i = 0; i < variableNames.size(); i++) {
            String varName = variableNames.get(i).toLowerCase().trim();

            // Skip media-specific variables
            boolean isMediaVar = false;
            switch (mediaType) {
                case DOCUMENT:
                    isMediaVar = varName.equals("link") || varName.equals("filename") ||
                            varName.equals("document_link") || varName.equals("document_filename");
                    break;
                case IMAGE:
                    isMediaVar = varName.equals("image_link") || varName.equals("image_url") || varName.equals("image");
                    break;
                case VIDEO:
                    isMediaVar = varName.equals("video_link") || varName.equals("video_url") || varName.equals("video");
                    break;
            }

            if (!isMediaVar) {
                remainingParams.add(paramValues.get(i));
            }
        }

        return remainingParams;
    }

    /**
     * Enum for media template types
     */
    private enum MediaTemplateType {
        NONE, // Text-only template
        DOCUMENT, // Document template (requires link + filename)
        IMAGE, // Image template (requires image_link)
        VIDEO // Video template (requires video_link)
    }

    // --- Data Resolvers ---

    /**
     * Resolve variables with support for both dynamic (user data) and fixed (DB
     * stored) values
     * Priority: 1) User Direct Fields, 2) User Custom Fields, 3) Fixed Variables,
     * 4) System Defaults
     */
    private List<String> resolveVariables(List<String> keys, Map<String, Object> userData, String fallbackPhone,
                                          Map<String, String> fixedVariables) {
        List<String> values = new ArrayList<>();
        for (String key : keys) {
            // 1. Direct Field Match from User Data
            if (userData.containsKey(key)) {
                values.add(String.valueOf(userData.get(key)));
                continue;
            }
            // 2. Custom Field Match from User Data
            Map<String, Object> customFields = (Map<String, Object>) userData.get(CombotConstants.FIELD_CUSTOM_FIELDS);
            if (customFields != null && customFields.containsKey(key)) {
                values.add(String.valueOf(customFields.get(key)));
                continue;
            }
            // 3. Fixed Variables from Database (NEW)
            if (fixedVariables.containsKey(key)) {
                values.add(fixedVariables.get(key));
                continue;
            }
            // 4. System Defaults
            switch (key.toLowerCase()) {
                case CombotConstants.FIELD_MOBILE_NUMBER:
                case CombotConstants.FIELD_PHONE:
                    values.add(fallbackPhone);
                    break;
                case CombotConstants.FIELD_INSTITUTE_NAME:
                    values.add(userData.getOrDefault(CombotConstants.FIELD_INSTITUTE_NAME,
                            CombotConstants.DEFAULT_FALLBACK_INSTITUTE_NAME).toString());
                    break;
                default:
                    values.add(CombotConstants.DEFAULT_FALLBACK_NAME); // Fallback
            }
        }
        return values;
    }

    private List<String> determineNextTemplates(String jsonConfig, String userText) {
        try {
            Map<String, List<String>> rules = objectMapper.readValue(jsonConfig, new TypeReference<>() {
            });
            String input = userText.trim().toLowerCase();
            log.info("determineNextTemplates: input='{}', rules={}", input, rules.keySet());

            for (Map.Entry<String, List<String>> entry : rules.entrySet()) {
                String keyword = entry.getKey().toLowerCase();
                if (!keyword.equals("default") && input.contains(keyword)) {
                    log.info("Matched keyword '{}' -> templates={}", keyword, entry.getValue());
                    return entry.getValue();
                }
            }
            List<String> defaultTemplates = rules.getOrDefault("default", Collections.emptyList());
            log.info("No keyword matched, using default -> templates={}", defaultTemplates);
            return defaultTemplates;
        } catch (Exception e) {
            log.error("Failed to parse flow config", e);
            return Collections.emptyList();
        }
    }

    // --- Log & Extraction Helpers ---

    /**
     * @param text    what the Inbox displays — see {@link #describeIncomingMessage}
     * @param rawMessage the webhook's message object, stored verbatim on the row. Without it an
     *                   inbound message we failed to render is undiagnosable after the fact.
     */
    private void logIncomingMessage(String messageId, String fromPhone, String text,
                                     String receivingChannelId, String senderName,
                                     Map<String, Object> rawMessage) {
        try {
            NotificationLog logEntry = new NotificationLog();
            logEntry.setNotificationType(CombotNotificationType.WHATSAPP_INCOMING.getType());
            logEntry.setChannelId(fromPhone);
            logEntry.setSource(CombotConstants.SOURCE_COMBOT);
            logEntry.setSourceId(messageId);
            logEntry.setBody(text);
            if (rawMessage != null) {
                try {
                    logEntry.setMessagePayload(objectMapper.writeValueAsString(rawMessage));
                } catch (Exception e) {
                    log.warn("Failed to serialize incoming message payload", e);
                    logEntry.setMessagePayload(String.valueOf(rawMessage));
                }
            }
            logEntry.setSenderBusinessChannelId(receivingChannelId);
            if (receivingChannelId != null) {
                mappingRepository.findById(receivingChannelId)
                        .ifPresent(m -> logEntry.setInstituteId(m.getInstituteId()));
            }
            logEntry.setNotificationDate(Instant.now());
            if (senderName != null && !senderName.isBlank()) {
                logEntry.setSenderName(senderName);
            }

            // Find last outgoing message to this user to get userId
            Optional<NotificationLog> lastOutgoingOpt = notificationLogRepository
                    .findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                            fromPhone, receivingChannelId, CombotNotificationType.WHATSAPP_OUTGOING.getType());

            // Set userId if found from previous outgoing message
            lastOutgoingOpt.ifPresent(outgoing -> {
                logEntry.setUserId(outgoing.getUserId());
                log.debug("Associated incoming message with userId: {}", outgoing.getUserId());
            });

            notificationLogRepository.save(logEntry);
        } catch (Exception e) {
            log.error("Failed to log incoming message from {}", fromPhone, e);
        }
    }

    @SuppressWarnings("unchecked")
    private String extractSenderName(Map<String, Object> value) {
        try {
            List<Map<String, Object>> contacts = (List<Map<String, Object>>) value.get("contacts");
            if (contacts != null && !contacts.isEmpty()) {
                Map<String, Object> contact = contacts.get(0);
                Map<String, Object> profile = (Map<String, Object>) contact.get("profile");
                if (profile != null) {
                    return (String) profile.get("name");
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String extractPhoneNumberId(Map<String, Object> value) {
        try {
            return (String) ((Map<?, ?>) value.get(CombotWebhookKeys.METADATA)).get(CombotWebhookKeys.PHONE_NUMBER_ID);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The "last template" a legacy ChannelFlowConfig keys on, for the last message we sent.
     * <p>
     * A chatbot-flow row now records its template and flow on message_payload so the Inbox can
     * show them — but that must not re-route legacy flows. Those rows always read here as they did
     * when they carried no payload: a sent one as {@code DEFAULT_TEMPLATE}, a refused one (FAILED
     * marker) as {@code UNKNOWN_TEMPLATE}.
     */
    String legacyFlowTemplateOf(NotificationLog lastLog) {
        if ("CHATBOT_FLOW".equals(lastLog.getSource())) {
            String payload = lastLog.getMessagePayload();
            boolean refused = payload != null && payload.contains(
                    "\"deliveryStatus\":\"" + WhatsAppSendFailureService.FAILED_STATUS + "\"");
            return refused ? CombotConstants.UNKNOWN_TEMPLATE : CombotConstants.DEFAULT_TEMPLATE;
        }
        return extractTemplateNameFromPayload(lastLog.getMessagePayload());
    }

    private String extractTemplateNameFromPayload(String payloadJson) {
        if (payloadJson == null)
            return CombotConstants.DEFAULT_TEMPLATE;
        try {
            Map<String, Object> payload = objectMapper.readValue(payloadJson, new TypeReference<>() {
            });
            // Format 1: Combot format - {"template": {"name": "..."}}
            Map<String, Object> template = (Map<String, Object>) payload.get(CombotWebhookKeys.TEMPLATE);
            if (template != null) {
                return (String) template.get(CombotWebhookKeys.NAME);
            }
            // Format 2: whatsapp-service format - {"templateName": "..."}
            String templateName = (String) payload.get("templateName");
            if (templateName != null) {
                return templateName;
            }
            return CombotConstants.UNKNOWN_TEMPLATE;
        } catch (Exception e) {
            return CombotConstants.UNKNOWN_TEMPLATE;
        }
    }

    /**
     * The user's own words, for flow routing and keyword matching — text, a tapped button/list
     * title, or the caption typed alongside an image/video/document. Deliberately "" for a message
     * that carries no text (a voice note, a bare photo): the flow engine and the opt-in/opt-out
     * checks must not see a synthesised placeholder as if the user had typed it. Use
     * {@link #describeIncomingMessage} for what the Inbox should display.
     */
    private String extractMessageText(Map<String, Object> message) {
        try {
            String type = (String) message.get(CombotWebhookKeys.TYPE);
            if (WhatsAppMessageType.TEXT.getType().equals(type))
                return (String) ((Map) message.get(WhatsAppMessageType.TEXT.getType())).get(CombotWebhookKeys.BODY);
            if (WhatsAppMessageType.BUTTON.getType().equals(type))
                return (String) ((Map) message.get(WhatsAppMessageType.BUTTON.getType()))
                        .get(WhatsAppMessageType.TEXT.getType());
            if (WhatsAppMessageType.INTERACTIVE.getType().equals(type)) {
                Map<String, Object> interactive = (Map<String, Object>) message
                        .get(WhatsAppMessageType.INTERACTIVE.getType());
                if (interactive.containsKey(CombotWebhookKeys.LIST_REPLY))
                    return (String) ((Map) interactive.get(CombotWebhookKeys.LIST_REPLY)).get(CombotWebhookKeys.TITLE);
                if (interactive.containsKey(CombotWebhookKeys.BUTTON_REPLY))
                    return (String) ((Map) interactive.get(CombotWebhookKeys.BUTTON_REPLY)).get(CombotWebhookKeys.TITLE);
            }
            // A caption on an image/video/document IS text the user typed, so it routes like text.
            String caption = mediaCaption(message, type);
            if (caption != null)
                return caption;
            return "";
        } catch (Exception e) {
            return "";
        }
    }

    /** The caption typed alongside a media message, or null when there is none. */
    @SuppressWarnings("unchecked")
    private String mediaCaption(Map<String, Object> message, String type) {
        if (!MEDIA_TYPES.contains(type))
            return null;
        Object media = message.get(type);
        if (!(media instanceof Map))
            return null;
        Object caption = ((Map<String, Object>) media).get(CombotWebhookKeys.CAPTION);
        if (caption == null || caption.toString().isBlank())
            return null;
        return caption.toString();
    }

    /**
     * What the WhatsApp Inbox shows for an inbound message. Falls back to a typed placeholder
     * ("[voice note]", "[document: invoice.pdf]") whenever the message carries no text, so a
     * received photo or voice note renders as something rather than an empty bubble.
     */
    @SuppressWarnings("unchecked")
    private String describeIncomingMessage(Map<String, Object> message, String text) {
        if (text != null && !text.isBlank())
            return text;
        try {
            String type = (String) message.get(CombotWebhookKeys.TYPE);
            if (type == null || type.isBlank())
                return "";
            switch (type) {
                case "image":
                    return "[image]";
                case "video":
                    return "[video]";
                case "sticker":
                    return "[sticker]";
                case "audio": {
                    Object audio = message.get("audio");
                    boolean voice = audio instanceof Map
                            && Boolean.TRUE.equals(((Map<String, Object>) audio).get("voice"));
                    return voice ? "[voice note]" : "[audio]";
                }
                case "document": {
                    Object doc = message.get("document");
                    Object filename = doc instanceof Map ? ((Map<String, Object>) doc).get("filename") : null;
                    return filename == null || filename.toString().isBlank()
                            ? "[document]" : "[document: " + filename + "]";
                }
                case "location": {
                    Object loc = message.get("location");
                    Object name = loc instanceof Map ? ((Map<String, Object>) loc).get(CombotWebhookKeys.NAME) : null;
                    return name == null || name.toString().isBlank()
                            ? "[location]" : "[location: " + name + "]";
                }
                case "contacts":
                    return "[contact card]";
                case "reaction": {
                    Object reaction = message.get("reaction");
                    Object emoji = reaction instanceof Map ? ((Map<String, Object>) reaction).get("emoji") : null;
                    return emoji == null || emoji.toString().isBlank()
                            ? "[reaction]" : "[reaction: " + emoji + "]";
                }
                case "interactive": {
                    Object interactive = message.get(CombotWebhookKeys.INTERACTIVE);
                    if (interactive instanceof Map && ((Map<String, Object>) interactive).containsKey("nfm_reply"))
                        return "[form response]";
                    return "[interactive reply]";
                }
                case "order":
                    return "[order]";
                case "unsupported":
                    return "[unsupported message]";
                default:
                    return "[" + type + "]";
            }
        } catch (Exception e) {
            return "";
        }
    }

    @SuppressWarnings("unchecked")
    private String extractInteractiveButtonId(Map<String, Object> message) {
        try {
            String type = (String) message.get(CombotWebhookKeys.TYPE);
            if ("interactive".equals(type)) {
                Map<String, Object> interactive = (Map<String, Object>) message.get("interactive");
                if (interactive != null && interactive.containsKey("button_reply")) {
                    return (String) ((Map<String, Object>) interactive.get("button_reply")).get("id");
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    @SuppressWarnings("unchecked")
    private String extractButtonPayload(Map<String, Object> message) {
        try {
            String type = (String) message.get(CombotWebhookKeys.TYPE);
            if ("button".equals(type)) {
                Map<String, Object> button = (Map<String, Object>) message.get("button");
                if (button != null) return (String) button.get("payload");
            }
        } catch (Exception ignored) {}
        return null;
    }

    @SuppressWarnings("unchecked")
    private String extractListReplyId(Map<String, Object> message) {
        try {
            String type = (String) message.get(CombotWebhookKeys.TYPE);
            if ("interactive".equals(type)) {
                Map<String, Object> interactive = (Map<String, Object>) message.get("interactive");
                if (interactive != null && interactive.containsKey("list_reply")) {
                    return (String) ((Map<String, Object>) interactive.get("list_reply")).get("id");
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private Map<String, List<String>> parseJsonMap(String json) {
        if (json == null || json.isEmpty())
            return Collections.emptyMap();
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    /**
     * Parse fixed variables config JSON
     * Expected format: {"template_name": {"var_name": "value", "var_name2":
     * "value2"}}
     * Returns empty map if null/invalid for backward compatibility
     */
    private Map<String, Map<String, String>> parseFixedVariablesConfig(String json) {
        if (json == null || json.trim().isEmpty())
            return Collections.emptyMap();
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            log.warn("Failed to parse fixed_variables_config, using empty map", e);
            return Collections.emptyMap();
        }
    }

    // --- Legacy Helpers ---

    private Optional<NotificationLog> findOutgoingByMessageId(String messageId) {
        try {
            return notificationLogRepository.findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc(
                    CombotNotificationType.WHATSAPP_OUTGOING.getType(), messageId);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private Optional<NotificationLog> findOutgoingByPhone(String phone) {
        try {
            return notificationLogRepository.findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(phone,
                    CombotNotificationType.WHATSAPP_OUTGOING.getType());
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private String extractErrorCode(Map<String, Object> errorData) {
        if (errorData == null)
            return CombotConstants.ERROR_CODE_UNKNOWN;
        Object code = errorData.get(CombotWebhookKeys.CODE);
        return code != null ? code.toString() : CombotConstants.ERROR_CODE_UNKNOWN;
    }

    /**
     * Meta's status errors always carry a short {@code title}, only sometimes a {@code message}, and
     * put the specific reason under {@code error_data.details}. Reading "message" alone stored
     * "Unknown error" for the codes that matter most — 131042 payment, 131049 marketing cap — and
     * that string is what the send dialog and the Inbox show the admin.
     */
    private String extractErrorMessage(Map<String, Object> errorData) {
        if (errorData == null)
            return "Unknown error";
        Object msg = errorData.get("message");
        if (msg == null) {
            msg = errorData.get(CombotWebhookKeys.TITLE);
        }
        if (msg == null && errorData.get("error_data") instanceof Map<?, ?> errorDetail) {
            msg = errorDetail.get("details");
        }
        return msg != null ? msg.toString() : "Unknown error";
    }

    private static String truncateTo(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }
}