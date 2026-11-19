package vacademy.io.notification_service.features.combot.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.external.VendorCallLog;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.combot.constants.CombotWebhookKeys;
import vacademy.io.notification_service.features.combot.dto.InactivePhonesRequest;
import vacademy.io.notification_service.features.combot.dto.InactiveUsersRequest;
import vacademy.io.notification_service.features.combot.dto.LogSequenceRequest;
import vacademy.io.notification_service.features.combot.dto.UsersByMessagesRequest;
import vacademy.io.notification_service.features.combot.dto.WhatsAppTemplateRequest;
import vacademy.io.notification_service.features.combot.dto.WhatsAppTemplateResponse;
import vacademy.io.notification_service.features.combot.enums.WhatsAppProvider;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.util.*;

/**
 * Service for sending WhatsApp messages via Com.bot API
 * Fetches Com.bot credentials from institute settings.
 *
 * @deprecated Prefer {@link vacademy.io.notification_service.features.chatbot_flow.engine.provider.CombotMessageProvider}
 *             for new code. This class is retained for CombotWebhookService response pipeline,
 *             EngagementTriggerService, and CombotMessagingController until those are migrated.
 */
@Deprecated
@Service
@RequiredArgsConstructor
@Slf4j
public class CombotMessagingService {

    private final RestTemplate restTemplate;
    private final CombotWebhookService webhookService;
    private final InstituteInternalService instituteInternalService;
    private final ObjectMapper objectMapper;
    private final UserAnnouncementPreferenceService preferenceService;
    private final NotificationLogRepository notificationLogRepository;

    /**
     * Send WhatsApp template messages using Com.bot
     * Falls back to Meta if Com.bot not configured
     */

    public ResponseEntity<WhatsAppTemplateResponse> sendTemplateMessage(
            @RequestBody WhatsAppTemplateRequest request) {

        log.info("Received Com.bot template send request for institute: {}, messages: {}",
                request.getInstituteId(),
                request.getMessages() != null ? request.getMessages().size() : 0);

        // Validate request
        if (request.getInstituteId() == null || request.getInstituteId().isEmpty()) {
            return ResponseEntity.badRequest().body(
                    WhatsAppTemplateResponse.builder()
                            .success(false)
                            .message("instituteId is required")
                            .build()
            );
        }

        if (request.getMessages() == null || request.getMessages().isEmpty()) {
            return ResponseEntity.badRequest().body(
                    WhatsAppTemplateResponse.builder()
                            .success(false)
                            .message("messages array is required and cannot be empty")
                            .build()
            );
        }

        try {
            WhatsAppTemplateResponse response = sendTemplateMessages(request);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Failed to send template messages for institute: {}", request.getInstituteId(), e);
            return ResponseEntity.status(500).body(
                    WhatsAppTemplateResponse.builder()
                            .success(false)
                            .message("Internal server error: " + e.getMessage())
                            .instituteId(request.getInstituteId())
                            .build()
            );
        }
    }

    public WhatsAppTemplateResponse sendTemplateMessages(WhatsAppTemplateRequest request) {
        String instituteId = request.getInstituteId();
        
        log.info("Starting Com.bot template message send for institute: {}, messages: {}", 
                instituteId, request.getMessages().size());

        try {
            // Fetch institute settings with caching
            CombotConfig config = getCombotConfig(instituteId);
            
            if (config == null || !config.isConfigured()) {
                log.warn("Com.bot not configured for institute: {}. Attempting Meta fallback.", instituteId);
                return handleMetaFallback(instituteId, request);
            }

            List<WhatsAppTemplateResponse.MessageResult> results = new ArrayList<>();
            int successCount = 0;
            int failureCount = 0;

            // Send each message
            for (WhatsAppTemplateRequest.MessageInfo message : request.getMessages()) {
                try {
                    // --- PREFERENCE CHECK ---
                    if (message.getUserId() != null &&
                            preferenceService.isWhatsAppUnsubscribed(message.getUserId(), instituteId,(String)message.getPayload().get("to"))) {

                        log.info("Skipping WhatsApp message for user {} (Opted Out)", message.getUserId());
                        results.add(WhatsAppTemplateResponse.MessageResult.builder()
                                .success(false)
                                .status("SKIPPED_OPT_OUT")
                                .error("User opted out of WhatsApp notifications")
                                .build());
                        failureCount++;
                        continue;
                    }
                    WhatsAppTemplateResponse.MessageResult result = sendSingleMessage(
                            message,
                            config
                    );

                    results.add(result);

                    if (result.getSuccess()) {
                        successCount++;
                    } else {
                        failureCount++;
                    }

                    // Small delay to avoid rate limiting
                    Thread.sleep(100);

                } catch (Exception e) {
                    log.error("Error sending message: {}", e.getMessage());
                    Map<String, Object> payload = message.getPayload();
                    String phone = payload != null ? (String) payload.get("to") : "unknown";
                    
                    results.add(WhatsAppTemplateResponse.MessageResult.builder()
                            .phone(phone)
                            .success(false)
                            .error(e.getMessage())
                            .build());
                    failureCount++;
                }
            }

            return WhatsAppTemplateResponse.builder()
                    .success(true)
                    .message("Template message send completed via Com.bot")
                    .instituteId(instituteId)
                    .total(request.getMessages().size())
                    .successCount(successCount)
                    .failureCount(failureCount)
                    .results(results)
                    .build();

        } catch (Exception e) {
            log.error("Failed to send template messages for institute: {}", instituteId, e);
            return WhatsAppTemplateResponse.builder()
                    .success(false)
                    .message("Failed to send messages: " + e.getMessage())
                    .instituteId(instituteId)
                    .build();
        }
    }

    /**
     * Send a single message via Com.bot
     */
    private WhatsAppTemplateResponse.MessageResult sendSingleMessage(
            WhatsAppTemplateRequest.MessageInfo message,
            CombotConfig config) {
        
        try {
            Map<String, Object> payload = message.getPayload();
            String userId = message.getUserId();
            String phone = (String) payload.get("to");
            String channelId=config.getPhoneNumberId();

            // Build Com.bot API URL
            String requestUrl = config.getApiUrl() + "/" + config.getPhoneNumberId() + "/messages";

            log.info("Sending to {} via Com.bot", phone);
            log.debug("URL: {}, Payload: {}", requestUrl, payload);

            // Set headers
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Authorization", "Bearer " + config.getApiKey());

            HttpEntity<Map<String, Object>> httpRequest = new HttpEntity<>(payload, headers);

            // Make API call
            ResponseEntity<Map> apiResponse = restTemplate.postForEntity(requestUrl, httpRequest, Map.class);

            log.info("Com.bot API Response for {}: {}", phone, apiResponse.getBody());

            Map<String, Object> responseBody = apiResponse.getBody();
            String queueId = null;
            String messageStatus = null;

            if (responseBody != null) {
                // Com.bot response structure: {messaging_channel, message: {queue_id, message_status}}
                if (responseBody.containsKey(CombotWebhookKeys.MESSAGE)) {
                    Map<String, Object> messageData = (Map<String, Object>) responseBody.get(CombotWebhookKeys.MESSAGE);
                    queueId = (String) messageData.get(CombotWebhookKeys.QUEUE_ID);
                    messageStatus = (String) messageData.get(CombotWebhookKeys.MESSAGE_STATUS);
                }

                // Extract template name from payload for logging
                String templateName = extractTemplateName(payload);
                
                // Log outgoing message
                webhookService.logOutgoingMessage(
                        queueId,
                        phone,
                        templateName,
                        userId,
                        payload,
                        channelId

                );
            }

            return WhatsAppTemplateResponse.MessageResult.builder()
                    .phone(phone)
                    .success(true)
                    .queueId(queueId)
                    .status(messageStatus)
                    .fullResponse(responseBody)
                    .build();

        } catch (HttpClientErrorException e) {
            VendorCallLog.failed(config.getApiUrl(), "send template message", message.getPayload(), e);
            log.error("Com.bot API error: {}", e.getResponseBodyAsString());
            Map<String, Object> payload = message.getPayload();
            String phone = payload != null ? (String) payload.get("to") : "unknown";
            
            return WhatsAppTemplateResponse.MessageResult.builder()
                    .phone(phone)
                    .success(false)
                    .error(e.getResponseBodyAsString())
                    .fullResponse(Map.of("statusCode", e.getStatusCode().value()))
                    .build();
        }
    }

    public List<String> filterUsersByStrictSequence(LogSequenceRequest request) {
        log.info("Filtering users by strict sequence: {} -> {}",
                request.getAnchorMessageBody(), request.getReactionMessageBody());

        if (request.getAnchorMessageBody() == null || request.getReactionMessageBody() == null) {
            log.warn("Invalid sequence request: Bodies cannot be null");
            return Collections.emptyList();
        }

        return notificationLogRepository.findUserIdsByAdjacentMessagePair(
                request.getAnchorMessageType(),
                request.getAnchorMessageBody(),
                request.getReactionMessageType(),
                request.getReactionMessageBody()
        );
    }

    /**
     * Find inactive users who received a template but didn't respond within X days
     * @param request Contains messageType, senderBusinessChannelId, days, templateName
     * @return List of user IDs who didn't respond
     */
    public List<String> findInactiveUsers(InactiveUsersRequest request) {
        log.info("Finding inactive users for template: {} within {} days on channel: {}",
                request.getTemplateName(), request.getDays(), request.getSenderBusinessChannelId());

        // Validate request
        if (request.getMessageType() == null || request.getMessageType().isEmpty()) {
            log.warn("Invalid request: messageType is required");
            return Collections.emptyList();
        }
        if (request.getSenderBusinessChannelId() == null || request.getSenderBusinessChannelId().isEmpty()) {
            log.warn("Invalid request: senderBusinessChannelId is required");
            return Collections.emptyList();
        }
        if (request.getDays() == null || request.getDays() <= 0) {
            log.warn("Invalid request: days must be positive");
            return Collections.emptyList();
        }
        if (request.getTemplateName() == null || request.getTemplateName().isEmpty()) {
            log.warn("Invalid request: templateName is required");
            return Collections.emptyList();
        }

        List<String> inactiveUserIds = notificationLogRepository.findInactiveUsers(
                request.getMessageType(),
                request.getSenderBusinessChannelId(),
                request.getTemplateName(),
                request.getDays()
        );

        log.info("Found {} inactive users for template: {}",
                inactiveUserIds.size(), request.getTemplateName());

        return inactiveUserIds;
    }

    /**
     * Find phone numbers that received outgoing WhatsApp on a channel within the lookback
     * window but sent no inbound reply in that window. Phone-based, so it is unaffected by
     * missing outgoing user_id. Used by the inactivity opt-out scan.
     *
     * @param request Contains senderBusinessChannelId and days (defaults to 3 if unset)
     * @return List of recipient phone numbers (channel_id) with no inbound reply
     */
    public List<String> findInactivePhones(InactivePhonesRequest request) {
        if (request.getSenderBusinessChannelId() == null || request.getSenderBusinessChannelId().isEmpty()) {
            log.warn("findInactivePhones: senderBusinessChannelId is required");
            return Collections.emptyList();
        }
        int days = (request.getDays() == null || request.getDays() <= 0) ? 3 : request.getDays();

        List<String> phones = notificationLogRepository.findInactivePhones(
                request.getSenderBusinessChannelId(), days);

        log.info("Found {} inactive phone(s) on channel {} ({}d without an inbound reply)",
                phones.size(), request.getSenderBusinessChannelId(), days);

        return phones;
    }

    /**
     * Find users who have sent ALL messages from the given list
     * Returns userId from the most recent OUTGOING message
     * @param request Contains messageList, messageType, senderBusinessChannelId
     * @return List of user IDs who sent all messages
     */
    public List<String> findUsersByAllMessages(UsersByMessagesRequest request) {
        log.info("Finding users who sent all messages: {} of type: {} on channel: {}",
                request.getMessageList(), request.getMessageType(), request.getSenderBusinessChannelId());

        // Validate request
        if (request.getMessageList() == null || request.getMessageList().isEmpty()) {
            log.warn("Invalid request: messageList is required and cannot be empty");
            return Collections.emptyList();
        }
        if (request.getMessageType() == null || request.getMessageType().isEmpty()) {
            log.warn("Invalid request: messageType is required");
            return Collections.emptyList();
        }
        if (request.getSenderBusinessChannelId() == null || request.getSenderBusinessChannelId().isEmpty()) {
            log.warn("Invalid request: senderBusinessChannelId is required");
            return Collections.emptyList();
        }

        String[] messageArray = request.getMessageList().toArray(new String[0]);
        Integer messageCount = request.getMessageList().size();

        List<String> userIds = notificationLogRepository.findUsersByAllMessages(
                request.getMessageType(),
                request.getSenderBusinessChannelId(),
                messageArray,
                messageCount
        );

        log.info("Found {} users who sent all {} messages",
                userIds.size(), messageCount);

        return userIds;
    }

    /**
     * Get Com.bot configuration from institute settings (cached)
     */

    public CombotConfig getCombotConfig(String instituteId) {
        try {
            log.info("Fetching Com.bot config for institute: {}", instituteId);
            
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            String settingsJson = institute.getSetting();

            JsonNode root = objectMapper.readTree(settingsJson);
            JsonNode whatsappSetting = root.path(NotificationConstants.SETTING)
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);

            // Check provider
            String provider = whatsappSetting.path(NotificationConstants.PROVIDER).asText(WhatsAppProvider.META.getProvider()).toUpperCase();
            
            if (!WhatsAppProvider.COMBOT.getProvider().equals(provider)) {
                log.info("Provider is {} for institute {}, not COMBOT", provider, instituteId);
                return null;
            }

            // Extract Com.bot config
            JsonNode combotConfig = whatsappSetting.path(NotificationConstants.COMBOT);
            
            if (combotConfig.isMissingNode()) {
                log.warn("Com.bot config not found for institute: {}", instituteId);
                return null;
            }

            String apiUrl = combotConfig.path(NotificationConstants.API_URL).asText();
            String apiKey = combotConfig.path(NotificationConstants.API_KEY).asText();
            String phoneNumberId = combotConfig.path(NotificationConstants.PHONE_NUMBER_ID).asText();

            if (apiUrl.isEmpty() || apiKey.isEmpty() || phoneNumberId.isEmpty()) {
                log.warn("Com.bot config incomplete for institute: {}", instituteId);
                return null;
            }

            log.info("Com.bot config loaded successfully for institute: {}", instituteId);
            return new CombotConfig(apiUrl, apiKey, phoneNumberId);

        } catch (Exception e) {
            log.error("Failed to fetch Com.bot config for institute: {}", instituteId, e);
            return null;
        }
    }

    /**
     * Fallback to Meta when Com.bot not configured
     */
    private WhatsAppTemplateResponse handleMetaFallback(String instituteId, WhatsAppTemplateRequest request) {
        log.info("Falling back to Meta provider for institute: {}", instituteId);
        
        // Return error - Meta fallback should be handled by WhatsAppService
        return WhatsAppTemplateResponse.builder()
                .success(false)
                .message("Com.bot not configured for institute. Please use Meta/WATI provider or configure Com.bot.")
                .instituteId(instituteId)
                .total(request.getMessages().size())
                .successCount(0)
                .failureCount(request.getMessages().size())
                .build();
    }

    /**
     * Extract template name from payload for logging
     */
    private String extractTemplateName(Map<String, Object> payload) {
        try {
            Map<String, Object> template = (Map<String, Object>) payload.get("template");
            if (template != null) {
                return (String) template.get("name");
            }
        } catch (Exception e) {
            log.debug("Could not extract template name from payload");
        }
        return "unknown";
    }

    /**
     * Com.bot configuration holder
     */
    @lombok.Data
    @lombok.AllArgsConstructor
    public static class CombotConfig {
        private String apiUrl;
        private String apiKey;
        private String phoneNumberId;

        public boolean isConfigured() {
            return apiUrl != null && !apiUrl.isEmpty() &&
                   apiKey != null && !apiKey.isEmpty() &&
                   phoneNumberId != null && !phoneNumberId.isEmpty();
        }
    }
}
