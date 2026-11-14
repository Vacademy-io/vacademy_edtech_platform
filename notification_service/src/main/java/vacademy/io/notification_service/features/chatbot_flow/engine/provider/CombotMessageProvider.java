package vacademy.io.notification_service.features.chatbot_flow.engine.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * COMBOT provider — uses Meta WhatsApp Cloud API format via Com.bot proxy.
 * Also handles direct META channel type since the payload format is identical.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CombotMessageProvider implements ChatbotMessageProvider {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final InstituteInternalService instituteInternalService;

    /** Config cache: instituteId → {config, fetchedAt}. TTL = 5 minutes. */
    private Map<String, CachedConfig> configCache = new ConcurrentHashMap<>();
    private static final long CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes

    private record CachedConfig(ProviderConfig config, long fetchedAt) {
        boolean isExpired() { return System.currentTimeMillis() - fetchedAt > CONFIG_TTL_MS; }
    }

    /** Evict cached config for an institute (called when provider settings change). */
    public void evictConfig(String instituteId) {
        configCache.remove(instituteId);
        log.info("Evicted COMBOT/META config cache for institute {}", instituteId);
    }

    /** Evict all cached configs. */
    public void evictAllConfigs() {
        configCache.clear();
        log.info("Evicted all COMBOT/META config caches");
    }

    @Override
    public boolean supports(String channelType) {
        return "WHATSAPP_COMBOT".equalsIgnoreCase(channelType)
                || "WHATSAPP_META".equalsIgnoreCase(channelType)
                || "WHATSAPP".equalsIgnoreCase(channelType);
    }

    @Override
    public String sendTemplate(String phone, Map<String, Object> templatePayload,
                               String instituteId, String businessChannelId) {
        ProviderConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("COMBOT/META config not found for institute: " + instituteId);

        String templateName = (String) templatePayload.get("templateName");
        String languageCode = (String) templatePayload.getOrDefault("languageCode", "en");

        @SuppressWarnings("unchecked")
        List<String> bodyParams = (List<String>) templatePayload.get("bodyParams");
        @SuppressWarnings("unchecked")
        Map<String, Object> headerConfig = (Map<String, Object>) templatePayload.get("headerConfig");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> buttonConfig = (List<Map<String, Object>>) templatePayload.get("buttonConfig");

        // Build Meta API components
        List<Map<String, Object>> components = new ArrayList<>();

        // Header component
        if (headerConfig != null) {
            String headerType = (String) headerConfig.getOrDefault("type", "none");
            if (!"none".equals(headerType)) {
                Map<String, Object> headerComponent = new LinkedHashMap<>();
                headerComponent.put("type", "header");
                String url = (String) headerConfig.get("url");
                String filename = (String) headerConfig.get("filename");

                Map<String, Object> param = new LinkedHashMap<>();
                param.put("type", headerType);
                Map<String, Object> mediaObj = new LinkedHashMap<>();
                mediaObj.put("link", url);
                if ("document".equals(headerType) && filename != null) {
                    mediaObj.put("filename", filename);
                }
                param.put(headerType, mediaObj);
                headerComponent.put("parameters", List.of(param));
                components.add(headerComponent);
            }
        }

        // Body component
        if (bodyParams != null && !bodyParams.isEmpty()) {
            Map<String, Object> bodyComponent = new LinkedHashMap<>();
            bodyComponent.put("type", "body");
            List<Map<String, String>> parameters = new ArrayList<>();
            for (String val : bodyParams) {
                parameters.add(Map.of("type", "text", "text", val));
            }
            bodyComponent.put("parameters", parameters);
            components.add(bodyComponent);
        }

        // Button components
        if (buttonConfig != null) {
            for (Map<String, Object> btn : buttonConfig) {
                String btnType = (String) btn.get("type");
                int index = btn.get("index") instanceof Number ? ((Number) btn.get("index")).intValue() : 0;
                Map<String, Object> buttonComponent = new LinkedHashMap<>();
                buttonComponent.put("type", "button");

                if ("url".equals(btnType)) {
                    buttonComponent.put("sub_type", "url");
                    buttonComponent.put("index", String.valueOf(index));
                    buttonComponent.put("parameters", List.of(
                            Map.of("type", "text", "text", btn.getOrDefault("urlSuffix", ""))));
                } else if ("quick_reply".equals(btnType)) {
                    buttonComponent.put("sub_type", "quick_reply");
                    buttonComponent.put("index", String.valueOf(index));
                    buttonComponent.put("parameters", List.of(
                            Map.of("type", "payload", "payload", btn.getOrDefault("payload", ""))));
                }
                components.add(buttonComponent);
            }
        }

        // Build final payload
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("to", phone);
        payload.put("type", "template");
        payload.put("template", Map.of(
                "name", templateName,
                "language", Map.of("code", languageCode),
                "components", components
        ));

        return sendPayload(config, payload);
    }

    @Override
    public String sendInteractive(String phone, Map<String, Object> interactivePayload,
                                   String instituteId, String businessChannelId) {
        ProviderConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("COMBOT/META config not found for institute: " + instituteId);

        String interactiveType = (String) interactivePayload.getOrDefault("interactiveType", "button");

        Map<String, Object> interactive = new LinkedHashMap<>();
        interactive.put("type", interactiveType);

        // Header
        @SuppressWarnings("unchecked")
        Map<String, Object> header = (Map<String, Object>) interactivePayload.get("header");
        if (header != null) {
            interactive.put("header", header);
        }

        // Body
        String body = (String) interactivePayload.get("body");
        if (body != null) {
            interactive.put("body", Map.of("text", body));
        }

        // Footer
        String footer = (String) interactivePayload.get("footer");
        if (footer != null) {
            interactive.put("footer", Map.of("text", footer));
        }

        // Action (buttons or sections)
        Map<String, Object> action = new LinkedHashMap<>();
        if ("button".equals(interactiveType)) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> buttons = (List<Map<String, Object>>) interactivePayload.get("buttons");
            if (buttons != null) {
                List<Map<String, Object>> apiButtons = new ArrayList<>();
                for (Map<String, Object> btn : buttons) {
                    apiButtons.add(Map.of("type", "reply", "reply",
                            Map.of("id", btn.get("id"), "title", btn.get("title"))));
                }
                action.put("buttons", apiButtons);
            }
        } else if ("list".equals(interactiveType)) {
            action.put("button", interactivePayload.getOrDefault("listButtonText", "Select"));
            action.put("sections", interactivePayload.get("sections"));
        }
        interactive.put("action", action);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("to", phone);
        payload.put("type", "interactive");
        payload.put("interactive", interactive);

        return sendPayload(config, payload);
    }

    @Override
    public String sendText(String phone, String text, String instituteId, String businessChannelId) {
        ProviderConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("COMBOT/META config not found for institute: " + instituteId);

        Map<String, Object> payload = Map.of(
                "messaging_product", "whatsapp",
                "to", phone,
                "type", "text",
                "text", Map.of("body", text)
        );

        return sendPayload(config, payload);
    }

    @Override
    public String sendMedia(String phone, String mediaType, String mediaUrl, String caption,
                           String filename, String instituteId, String businessChannelId) {
        ProviderConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("COMBOT/META config not found for institute: " + instituteId);

        // Meta API: type determines the media object key
        // { "messaging_product": "whatsapp", "to": "...", "type": "image", "image": { "link": "..." } }
        Map<String, Object> mediaObj = new LinkedHashMap<>();
        mediaObj.put("link", mediaUrl);
        if (caption != null && !caption.isBlank() && !"audio".equals(mediaType)) {
            mediaObj.put("caption", caption);
        }
        if (filename != null && !filename.isBlank() && "document".equals(mediaType)) {
            mediaObj.put("filename", filename);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("to", phone);
        payload.put("type", mediaType);
        payload.put(mediaType, mediaObj); // "image": {...}, "video": {...}, etc.

        return sendPayload(config, payload);
    }

    /**
     * Base URL + token for reading this institute's inbound WhatsApp media (Meta Graph API, or the Com.bot proxy when the institute sends through Com.bot).
     * Null when the institute has no usable configuration.
     */
    public ProviderMediaCredentials mediaCredentials(String instituteId) {
        ProviderConfig config = resolveConfig(instituteId);
        if (config == null || config.apiUrl == null || config.apiUrl.isBlank()
                || config.apiKey == null || config.apiKey.isBlank()) {
            return null;
        }
        return new ProviderMediaCredentials(config.apiUrl, config.apiKey);
    }

    private String sendPayload(ProviderConfig config, Map<String, Object> payload) {
        String url = config.apiUrl + "/" + config.phoneNumberId + "/messages";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + config.apiKey);

        // Log payload summary at INFO, full payload at DEBUG
        log.info("Sending to Meta API: to={}, type={}", payload.get("to"), payload.get("type"));
        if (log.isDebugEnabled()) {
            try {
                log.debug("Full Meta payload: {}", objectMapper.writeValueAsString(payload));
            } catch (Exception ignored) {}
        }

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);
        try {
            ResponseEntity<String> response = restTemplate.postForEntity(url, request, String.class);
            if (!response.getStatusCode().is2xxSuccessful()) {
                log.error("COMBOT/META API error: status={}, body={}", response.getStatusCode(), response.getBody());
                throw new RuntimeException("WhatsApp API returned " + response.getStatusCode());
            }
            log.debug("COMBOT/META message sent successfully to {}", payload.get("to"));
            return extractMessageId(response.getBody());
        } catch (Exception e) {
            log.error("Failed to send message via COMBOT/META: {}", e.getMessage());
            throw e;
        }
    }

    /**
     * Pulls the provider-assigned message id out of a send response so status webhooks
     * (sent/delivered/read/failed) can be joined back to the exact outbound row.
     * Meta Cloud API: {"messages":[{"id":"wamid..."}]}. Com.bot proxy: {"message":{"queue_id":"..."}}.
     * Never throws — a missing id degrades status attribution, it must not fail the send.
     */
    private String extractMessageId(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) return null;
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            String metaId = root.path("messages").path(0).path("id").asText(null);
            if (metaId != null && !metaId.isBlank()) return metaId;
            String queueId = root.path("message").path("queue_id").asText(null);
            if (queueId != null && !queueId.isBlank()) return queueId;
            return null;
        } catch (Exception e) {
            log.warn("Could not parse message id from provider response: {}", e.getMessage());
            return null;
        }
    }

    private ProviderConfig resolveConfig(String instituteId) {
        // Check cache first
        CachedConfig cached = configCache.get(instituteId);
        if (cached != null && !cached.isExpired()) {
            return cached.config();
        }

        try {
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            String jsonString = institute.getSetting();
            JsonNode root = objectMapper.readTree(jsonString);

            // Navigate: setting.WHATSAPP_SETTING.data.UTILITY_WHATSAPP
            JsonNode whatsappSetting = root.path("setting")
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);

            if (whatsappSetting.isMissingNode()) {
                // Try without "setting" wrapper
                whatsappSetting = root.path(NotificationConstants.WHATSAPP_SETTING)
                        .path(NotificationConstants.DATA)
                        .path(NotificationConstants.UTILITY_WHATSAPP);
            }

            String provider = whatsappSetting.path("provider").asText("META").toUpperCase();
            ProviderConfig config;

            if ("COMBOT".equals(provider)) {
                JsonNode combot = whatsappSetting.path("combot");
                config = new ProviderConfig(
                        combot.path("apiUrl").asText(combot.path("api_url").asText()),
                        combot.path("apiKey").asText(combot.path("api_key").asText()),
                        combot.path("phone_number_id").asText(combot.path("phoneNumberId").asText())
                );
            } else {
                // Direct META
                JsonNode meta = whatsappSetting.path("meta");
                String accessToken = meta.path("access_token").asText(meta.path("accessToken").asText(
                        whatsappSetting.path("accessToken").asText(whatsappSetting.path("access_token").asText())));
                String phoneNumberId = meta.path("appId").asText(meta.path("phoneNumberId").asText(
                        whatsappSetting.path("appId").asText()));
                config = new ProviderConfig(
                        "https://graph.facebook.com/v22.0",
                        accessToken,
                        phoneNumberId
                );
            }

            // Cache the resolved config
            configCache.put(instituteId, new CachedConfig(config, System.currentTimeMillis()));
            return config;

        } catch (Exception e) {
            log.error("Failed to resolve provider config for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private record ProviderConfig(String apiUrl, String apiKey, String phoneNumberId) {}
}
