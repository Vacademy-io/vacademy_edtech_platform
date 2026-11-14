package vacademy.io.notification_service.features.chatbot_flow.engine.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WATI provider — converts generic payloads to WATI's flat API format.
 *
 * Key differences from Meta:
 * - Template params: flat name/value array (not nested components[])
 * - Phone number: query parameter (not in body)
 * - Interactive: dedicated endpoints (/sendInteractiveButtonsMessage, /sendInteractiveListMessage)
 * - Text: /sendSessionMessage/{phone}
 * - Bulk send: native receivers[] array
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class WatiMessageProvider implements ChatbotMessageProvider {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final InstituteInternalService instituteInternalService;

    /** Config cache: instituteId → {config, fetchedAt}. TTL = 5 minutes. */
    private Map<String, CachedConfig> configCache = new ConcurrentHashMap<>();
    private static final long CONFIG_TTL_MS = 5 * 60 * 1000;

    private record CachedConfig(WatiConfig config, long fetchedAt) {
        boolean isExpired() { return System.currentTimeMillis() - fetchedAt > CONFIG_TTL_MS; }
    }

    public void evictConfig(String instituteId) {
        configCache.remove(instituteId);
        log.info("Evicted WATI config cache for institute {}", instituteId);
    }

    @Override
    public boolean supports(String channelType) {
        return "WHATSAPP_WATI".equalsIgnoreCase(channelType);
    }

    @Override
    public String sendTemplate(String phone, Map<String, Object> templatePayload,
                               String instituteId, String businessChannelId) {
        WatiConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("WATI config not found for institute: " + instituteId);

        String templateName = (String) templatePayload.get("templateName");

        // Convert body params to WATI's flat name/value format
        @SuppressWarnings("unchecked")
        List<String> bodyParams = (List<String>) templatePayload.getOrDefault("bodyParams", List.of());

        List<Map<String, String>> parameters = new ArrayList<>();

        // Add header media param if present
        @SuppressWarnings("unchecked")
        Map<String, Object> headerConfig = (Map<String, Object>) templatePayload.get("headerConfig");
        if (headerConfig != null) {
            String headerType = (String) headerConfig.getOrDefault("type", "none");
            String url = (String) headerConfig.get("url");
            if (!"none".equals(headerType) && url != null) {
                // WATI convention: header media passed as parameter with descriptive name
                switch (headerType) {
                    case "image" -> parameters.add(Map.of("name", "header_image_url", "value", url));
                    case "video" -> parameters.add(Map.of("name", "header_video_url", "value", url));
                    case "document" -> {
                        parameters.add(Map.of("name", "header_document_url", "value", url));
                        String filename = (String) headerConfig.get("filename");
                        if (filename != null) {
                            parameters.add(Map.of("name", "header_document_filename", "value", filename));
                        }
                    }
                }
            }
        }

        // Add body params as positional (1, 2, 3...)
        for (int i = 0; i < bodyParams.size(); i++) {
            parameters.add(Map.of("name", String.valueOf(i + 1), "value", bodyParams.get(i)));
        }

        // Add button URL suffix params if present
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> buttonConfig = (List<Map<String, Object>>) templatePayload.get("buttonConfig");
        if (buttonConfig != null) {
            for (Map<String, Object> btn : buttonConfig) {
                String btnType = (String) btn.get("type");
                if ("url".equals(btnType)) {
                    String suffix = (String) btn.getOrDefault("urlSuffix", "");
                    parameters.add(Map.of("name", "button_url_suffix", "value", suffix));
                }
            }
        }

        // Build WATI single template request
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("broadcast_name", "chatbot_flow_" + templateName);
        payload.put("template_name", templateName);
        payload.put("parameters", parameters);

        String formattedPhone = phone.replaceAll("[^0-9]", "");
        String url = config.apiUrl + "/api/v1/sendTemplateMessage?whatsappNumber=" + formattedPhone;

        sendRequest(config, url, payload);
        // WATI's send response carries no per-message id usable for status joins;
        // read/delivery attribution for WATI stays phone-based (the pre-existing heuristic).
        return null;
    }

    @Override
    public String sendInteractive(String phone, Map<String, Object> interactivePayload,
                                   String instituteId, String businessChannelId) {
        WatiConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("WATI config not found for institute: " + instituteId);

        String formattedPhone = phone.replaceAll("[^0-9]", "");
        String interactiveType = (String) interactivePayload.getOrDefault("interactiveType", "button");

        if ("button".equals(interactiveType)) {
            sendInteractiveButtons(config, formattedPhone, interactivePayload);
        } else if ("list".equals(interactiveType)) {
            sendInteractiveList(config, formattedPhone, interactivePayload);
        }
        // WATI's interactive endpoints report no message id, same as its other sends here.
        return null;
    }

    private void sendInteractiveButtons(WatiConfig config, String phone, Map<String, Object> payload) {
        // WATI interactive buttons format (flat, not Meta Cloud API format)
        // Docs: https://docs.wati.io/reference/post_api-v1-sendinteractivebuttonsmessage
        Map<String, Object> watiPayload = new LinkedHashMap<>();

        // Header: WATI expects {type: "Text", text: "..."} object
        @SuppressWarnings("unchecked")
        Map<String, Object> header = (Map<String, Object>) payload.get("header");
        if (header != null) {
            String headerType = (String) header.getOrDefault("type", "Text");
            String headerText = (String) header.getOrDefault("text", "");
            watiPayload.put("header", Map.of("type", headerType, "text", headerText));
        } else {
            // Default text header if body is present
            watiPayload.put("header", Map.of("type", "Text", "text", ""));
        }

        // Body: WATI expects plain string, not {text: "..."}
        String body = (String) payload.getOrDefault("body", "");
        watiPayload.put("body", body);

        // Footer: WATI expects plain string
        String footer = (String) payload.get("footer");
        if (footer != null) {
            watiPayload.put("footer", footer);
        }

        // Buttons: WATI expects [{text: "Button Label"}] (max 3, max 20 chars each)
        // NOT the Meta format [{type:"reply", reply:{id, title}}]
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> buttons = (List<Map<String, Object>>) payload.getOrDefault("buttons", List.of());
        List<Map<String, String>> watiButtons = new ArrayList<>();
        for (Map<String, Object> btn : buttons) {
            String text = (String) btn.getOrDefault("title", btn.getOrDefault("text", ""));
            watiButtons.add(Map.of("text", text));
        }
        watiPayload.put("buttons", watiButtons);

        String url = config.apiUrl + "/api/v1/sendInteractiveButtonsMessage?whatsappNumber=" + phone;
        sendRequest(config, url, watiPayload);
    }

    @SuppressWarnings("unchecked")
    private void sendInteractiveList(WatiConfig config, String phone, Map<String, Object> payload) {
        // WATI interactive list format (flat strings, no nested objects)
        // Docs: https://docs.wati.io/reference/post_api-v1-sendinteractivelistmessage
        Map<String, Object> watiPayload = new LinkedHashMap<>();

        String header = (String) payload.getOrDefault("header", "");
        String body = (String) payload.getOrDefault("body", "");
        String footer = (String) payload.get("footer");
        String buttonText = (String) payload.getOrDefault("listButtonText", "Select");

        watiPayload.put("header", header);
        watiPayload.put("body", body);
        if (footer != null) watiPayload.put("footer", footer);
        watiPayload.put("buttonText", buttonText);

        // Sanitize sections: WATI rows only have "title" and "description" (no "id")
        List<Map<String, Object>> sections = (List<Map<String, Object>>)
                payload.getOrDefault("sections", List.of());
        List<Map<String, Object>> watiSections = new ArrayList<>();
        for (Map<String, Object> section : sections) {
            Map<String, Object> watiSection = new LinkedHashMap<>();
            watiSection.put("title", section.getOrDefault("title", ""));
            List<Map<String, Object>> rows = (List<Map<String, Object>>)
                    section.getOrDefault("rows", List.of());
            List<Map<String, String>> watiRows = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Map<String, String> watiRow = new LinkedHashMap<>();
                watiRow.put("title", String.valueOf(row.getOrDefault("title", "")));
                Object desc = row.get("description");
                if (desc != null && !desc.toString().isBlank()) {
                    watiRow.put("description", desc.toString());
                }
                watiRows.add(watiRow);
            }
            watiSection.put("rows", watiRows);
            watiSections.add(watiSection);
        }
        watiPayload.put("sections", watiSections);

        String url = config.apiUrl + "/api/v1/sendInteractiveListMessage?whatsappNumber=" + phone;
        sendRequest(config, url, watiPayload);
    }

    @Override
    public String sendText(String phone, String text, String instituteId, String businessChannelId) {
        WatiConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("WATI config not found for institute: " + instituteId);

        String formattedPhone = phone.replaceAll("[^0-9]", "");
        // WATI sendSessionMessage: messageText is a QUERY PARAMETER, not JSON body
        // encode() handles spaces, newlines, special chars properly
        String url = org.springframework.web.util.UriComponentsBuilder
                .fromHttpUrl(config.apiUrl + "/api/v1/sendSessionMessage/" + formattedPhone)
                .queryParam("messageText", text)
                .encode()
                .toUriString();

        sendRequestWithRawUrl(config, url, Map.of());
        return null; // no per-message id in WATI session-message responses
    }

    @Override
    public String sendMedia(String phone, String mediaType, String mediaUrl, String caption,
                           String filename, String instituteId, String businessChannelId) {
        WatiConfig config = resolveConfig(instituteId);
        if (config == null) throw new RuntimeException("WATI config not found for institute: " + instituteId);

        String formattedPhone = phone.replaceAll("[^0-9]", "");

        // WATI has no JSON "send media by URL" endpoint for session messages — the old
        // /api/ext/v3/conversations/messages/fileViaUrl returns 404. The working path is
        // /api/v1/sendSessionFile/{whatsappNumber} with a multipart file upload. So download
        // the media bytes first, then upload them.
        byte[] fileBytes;
        try {
            fileBytes = restTemplate.getForObject(mediaUrl, byte[].class);
        } catch (Exception e) {
            log.error("Failed to download media for WATI session file: url={}, error={}", mediaUrl, e.getMessage());
            throw new RuntimeException("Could not download media: " + e.getMessage());
        }
        if (fileBytes == null || fileBytes.length == 0) {
            throw new RuntimeException("Downloaded media is empty: " + mediaUrl);
        }

        String safeName = (filename != null && !filename.isBlank()) ? filename : "file";
        ByteArrayResource resource = new ByteArrayResource(fileBytes) {
            @Override
            public String getFilename() {
                return safeName;
            }
        };
        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("file", resource);

        String url = config.apiUrl + "/api/v1/sendSessionFile/" + formattedPhone;
        if (caption != null && !caption.isBlank()) {
            url += "?caption=" + URLEncoder.encode(caption, StandardCharsets.UTF_8);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        headers.set("Authorization", "Bearer " + config.apiKey);

        HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(form, headers);
        try {
            ResponseEntity<String> response = restTemplate.postForEntity(url, request, String.class);
            log.info("WATI sendSessionFile response: status={}, body={}", response.getStatusCode(), response.getBody());
            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new RuntimeException("WATI sendSessionFile returned " + response.getStatusCode());
            }
            // WATI returns HTTP 200 even on failure — check the "result" flag.
            if (response.getBody() != null) {
                JsonNode respJson = objectMapper.readTree(response.getBody());
                if (respJson.has("result") && respJson.path("result").isBoolean()
                        && !respJson.path("result").booleanValue()) {
                    throw new RuntimeException("WATI sendSessionFile result=false: "
                            + failureReason(respJson));
                }
                // Session-file sends usually carry no per-message id; return it when they do so
                // the caller can attribute delivered/read webhooks to this exact message.
                String messageId = respJson.path("message").path("whatsappMessageId").asText(null);
                if (messageId != null && !messageId.isBlank()) return messageId;
            }
            return null;
        } catch (RuntimeException e) {
            log.error("Failed to send document via WATI sendSessionFile: url={}, error={}", url, e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Failed to send document via WATI sendSessionFile: url={}, error={}", url, e.getMessage());
            throw new RuntimeException(e);
        }
    }

    /**
     * Why WATI refused a send. The reason lives in {@code errors.error}; {@code info} is usually
     * absent on a refusal, so reading it alone reported "unknown error" and once hid a three-day
     * out-of-credits outage. Order: errors.error → info → the whole errors node.
     */
    private String failureReason(JsonNode respJson) {
        String error = respJson.path("errors").path("error").asText(null);
        if (error != null && !error.isBlank()) return error;

        String info = respJson.path("info").asText(null);
        if (info != null && !info.isBlank()) return info;

        JsonNode errors = respJson.path("errors");
        if (!errors.isMissingNode() && !errors.isNull()) return errors.toString();

        return "unknown error";
    }

    private void sendRequest(WatiConfig config, String url, Map<String, Object> payload) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + config.apiKey);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);
        try {
            ResponseEntity<String> response = restTemplate.postForEntity(url, request, String.class);
            log.info("WATI API response: url={}, status={}, body={}", url, response.getStatusCode(), response.getBody());
            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new RuntimeException("WATI API returned " + response.getStatusCode());
            }
            // WATI returns HTTP 200 even on failure — check "result" and "ok" fields
            if (response.getBody() != null) {
                try {
                    JsonNode respJson = objectMapper.readTree(response.getBody());
                    // Some WATI endpoints use "result", others use "ok"
                    boolean hasResult = respJson.has("result");
                    boolean hasOk = respJson.has("ok");
                    JsonNode resultNode = respJson.path("result");
                    if (hasResult && resultNode.isBoolean() && !resultNode.booleanValue()) {
                        throw new RuntimeException("WATI API result=false: " + failureReason(respJson));
                    }
                    if (hasOk && !respJson.path("ok").asBoolean(true)) {
                        String errors = respJson.path("errors").toString();
                        throw new RuntimeException("WATI API ok=false: " + errors);
                    }
                } catch (RuntimeException re) {
                    throw re;
                } catch (Exception parseEx) {
                    log.warn("Could not parse WATI response body: {}", parseEx.getMessage());
                }
            }
        } catch (RuntimeException e) {
            log.error("Failed to send message via WATI: url={}, error={}", url, e.getMessage());
            throw e;
        }
    }

    /**
     * Like sendRequest but takes a pre-encoded URL string (as URI) to prevent
     * RestTemplate from double-encoding query parameters.
     */
    private void sendRequestWithRawUrl(WatiConfig config, String url, Map<String, Object> payload) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + config.apiKey);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);
        try {
            java.net.URI uri = java.net.URI.create(url);
            ResponseEntity<String> response = restTemplate.postForEntity(uri, request, String.class);
            log.info("WATI API response: status={}, body={}", response.getStatusCode(), response.getBody());
            if (!response.getStatusCode().is2xxSuccessful()) {
                throw new RuntimeException("WATI API returned " + response.getStatusCode());
            }
            if (response.getBody() != null) {
                try {
                    JsonNode respJson = objectMapper.readTree(response.getBody());
                    boolean hasResult = respJson.has("result");
                    boolean hasOk = respJson.has("ok");
                    JsonNode resultNode = respJson.path("result");
                    if (hasResult && resultNode.isBoolean() && !resultNode.booleanValue()) {
                        throw new RuntimeException("WATI API result=false: " + failureReason(respJson));
                    }
                    if (hasOk && !respJson.path("ok").asBoolean(true)) {
                        String errors = respJson.path("errors").toString();
                        throw new RuntimeException("WATI API ok=false: " + errors);
                    }
                } catch (RuntimeException re) {
                    throw re;
                } catch (Exception parseEx) {
                    log.warn("Could not parse WATI response body: {}", parseEx.getMessage());
                }
            }
        } catch (RuntimeException e) {
            log.error("Failed to send message via WATI: url={}, error={}", url, e.getMessage());
            throw e;
        }
    }

    /**
     * Base URL + token for reading this institute's inbound WhatsApp media (the institute's WATI tenant).
     * Null when the institute has no usable configuration.
     */
    public ProviderMediaCredentials mediaCredentials(String instituteId) {
        WatiConfig config = resolveConfig(instituteId);
        if (config == null || config.apiUrl == null || config.apiUrl.isBlank()
                || config.apiKey == null || config.apiKey.isBlank()) {
            return null;
        }
        return new ProviderMediaCredentials(config.apiUrl, config.apiKey);
    }

    private WatiConfig resolveConfig(String instituteId) {
        // Check cache first
        CachedConfig cached = configCache.get(instituteId);
        if (cached != null && !cached.isExpired()) {
            return cached.config();
        }

        try {
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            String jsonString = institute.getSetting();
            JsonNode root = objectMapper.readTree(jsonString);

            JsonNode whatsappSetting = root.path("setting")
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);

            if (whatsappSetting.isMissingNode()) {
                whatsappSetting = root.path(NotificationConstants.WHATSAPP_SETTING)
                        .path(NotificationConstants.DATA)
                        .path(NotificationConstants.UTILITY_WHATSAPP);
            }

            WatiConfig config;
            JsonNode wati = whatsappSetting.path("wati");
            if (wati.isMissingNode()) {
                config = new WatiConfig(
                        whatsappSetting.path("apiUrl").asText(whatsappSetting.path("api_url").asText("https://live-server.wati.io")),
                        whatsappSetting.path("apiKey").asText(whatsappSetting.path("api_key").asText("")),
                        whatsappSetting.path("whatsappNumber").asText(whatsappSetting.path("whatsapp_number").asText(""))
                );
            } else {
                config = new WatiConfig(
                        wati.path("apiUrl").asText(wati.path("api_url").asText("https://live-server.wati.io")),
                        wati.path("apiKey").asText(wati.path("api_key").asText("")),
                        wati.path("whatsappNumber").asText(wati.path("whatsapp_number").asText(""))
                );
            }

            configCache.put(instituteId, new CachedConfig(config, System.currentTimeMillis()));
            return config;
        } catch (Exception e) {
            log.error("Failed to resolve WATI config for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private record WatiConfig(String apiUrl, String apiKey, String whatsappNumber) {}
}
