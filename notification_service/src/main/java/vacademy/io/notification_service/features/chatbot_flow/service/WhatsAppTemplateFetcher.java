package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.external.VendorCallLog;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.chatbot_flow.dto.WhatsAppTemplateInfoDTO;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fetches WhatsApp message templates from Meta or WATI APIs.
 * Normalizes results into a common format for the flow builder UI.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class WhatsAppTemplateFetcher {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final InstituteInternalService instituteInternalService;

    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\{\\{\\d+}}");

    public List<WhatsAppTemplateInfoDTO> fetchTemplates(String instituteId) {
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

            String provider = whatsappSetting.path("provider").asText("META").toUpperCase();

            return switch (provider) {
                case "WATI" -> fetchFromWati(whatsappSetting);
                case "COMBOT" -> fetchFromMeta(whatsappSetting, true);
                default -> fetchFromMeta(whatsappSetting, false);
            };
        } catch (Exception e) {
            log.error("Failed to fetch templates for institute {}: {}", instituteId, e.getMessage(), e);
            return List.of();
        }
    }

    /**
     * Fetch from Meta Graph API: GET /v22.0/{WABA_ID}/message_templates
     */
    private List<WhatsAppTemplateInfoDTO> fetchFromMeta(JsonNode whatsappSetting, boolean isCombot) {
        String accessToken;
        String wabaId;

        if (isCombot) {
            JsonNode combot = whatsappSetting.path("combot");
            accessToken = combot.path("apiKey").asText(combot.path("api_key").asText());
            // COMBOT uses phone_number_id, but for template listing we need WABA ID
            // Fall back to meta credentials if available
            JsonNode meta = whatsappSetting.path("meta");
            wabaId = meta.path("wabaId").asText(meta.path("waba_id").asText(
                    combot.path("wabaId").asText(combot.path("waba_id").asText(""))));
            if (wabaId.isBlank()) {
                // Try phoneNumberId as fallback (won't work for template listing, but best effort)
                log.warn("WABA ID not configured for COMBOT, template listing may fail");
                return List.of();
            }
        } else {
            JsonNode meta = whatsappSetting.path("meta");
            accessToken = meta.path("access_token").asText(meta.path("accessToken").asText(
                    whatsappSetting.path("accessToken").asText(whatsappSetting.path("access_token").asText(""))));
            wabaId = meta.path("wabaId").asText(meta.path("waba_id").asText(
                    meta.path("appId").asText(whatsappSetting.path("appId").asText(""))));
        }

        if (accessToken.isBlank() || wabaId.isBlank()) {
            log.warn("Meta credentials incomplete for template listing");
            return List.of();
        }

        try {
            String url = "https://graph.facebook.com/v22.0/" + wabaId + "/message_templates?limit=100&status=APPROVED";

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(accessToken);

            ResponseEntity<String> response;
            try {
                response = restTemplate.exchange(url, HttpMethod.GET,
                        new HttpEntity<>(headers), String.class);
            } catch (RestClientException e) {
                VendorCallLog.failed(url, "list message templates", null, e);
                throw e;
            }

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Meta template API returned {}", response.getStatusCode());
                return List.of();
            }

            JsonNode body = objectMapper.readTree(response.getBody());
            JsonNode data = body.path("data");
            if (!data.isArray()) return List.of();

            List<WhatsAppTemplateInfoDTO> templates = new ArrayList<>();
            for (JsonNode tmpl : data) {
                templates.add(parseMetaTemplate(tmpl));
            }

            log.info("Fetched {} templates from Meta API", templates.size());
            return templates;

        } catch (Exception e) {
            log.error("Failed to fetch Meta templates: {}", e.getMessage());
            return List.of();
        }
    }

    private WhatsAppTemplateInfoDTO parseMetaTemplate(JsonNode tmpl) {
        String name = tmpl.path("name").asText();
        String language = tmpl.path("language").asText();
        String category = tmpl.path("category").asText();
        String status = tmpl.path("status").asText();

        String headerType = "none";
        String headerText = null;
        String bodyText = null;
        String footerText = null;
        int bodyParamCount = 0;
        List<WhatsAppTemplateInfoDTO.ButtonInfo> buttons = new ArrayList<>();

        JsonNode components = tmpl.path("components");
        if (components.isArray()) {
            for (JsonNode comp : components) {
                String type = comp.path("type").asText().toUpperCase();
                switch (type) {
                    case "HEADER" -> {
                        String format = comp.path("format").asText("TEXT").toUpperCase();
                        headerType = format.toLowerCase();
                        if ("TEXT".equals(format)) {
                            headerText = comp.path("text").asText(null);
                        }
                    }
                    case "BODY" -> {
                        bodyText = comp.path("text").asText(null);
                        if (bodyText != null) {
                            Matcher m = PLACEHOLDER_PATTERN.matcher(bodyText);
                            while (m.find()) bodyParamCount++;
                        }
                    }
                    case "FOOTER" -> footerText = comp.path("text").asText(null);
                    case "BUTTONS" -> {
                        JsonNode btns = comp.path("buttons");
                        if (btns.isArray()) {
                            for (JsonNode btn : btns) {
                                String btnType = btn.path("type").asText();
                                String btnText = btn.path("text").asText();
                                String btnUrl = btn.path("url").asText(null);
                                boolean hasDynamic = btnUrl != null && btnUrl.contains("{{");

                                buttons.add(WhatsAppTemplateInfoDTO.ButtonInfo.builder()
                                        .type(btnType)
                                        .text(btnText)
                                        .url(btnUrl)
                                        .hasDynamicUrl(hasDynamic)
                                        .build());
                            }
                        }
                    }
                }
            }
        }

        return WhatsAppTemplateInfoDTO.builder()
                .name(name)
                .language(language)
                .category(category)
                .status(status)
                .headerType(headerType)
                .headerText(headerText)
                .bodyText(bodyText)
                .footerText(footerText)
                .bodyParamCount(bodyParamCount)
                .buttons(buttons.isEmpty() ? null : buttons)
                .build();
    }

    /**
     * Fetch from WATI: GET /api/v1/getMessageTemplates
     */
    private List<WhatsAppTemplateInfoDTO> fetchFromWati(JsonNode whatsappSetting) {
        JsonNode wati = whatsappSetting.path("wati");
        String apiUrl = wati.path("apiUrl").asText(wati.path("api_url").asText("https://live-server.wati.io"));
        String apiKey = wati.path("apiKey").asText(wati.path("api_key").asText(""));

        if (apiKey.isBlank()) {
            log.warn("WATI API key not configured for template listing");
            return List.of();
        }

        try {
            String url = apiUrl + "/api/v1/getMessageTemplates";

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + apiKey);

            ResponseEntity<String> response;
            try {
                response = restTemplate.exchange(url, HttpMethod.GET,
                        new HttpEntity<>(headers), String.class);
            } catch (RestClientException e) {
                VendorCallLog.failed(url, "list message templates", null, e);
                throw e;
            }

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("WATI template API returned {}", response.getStatusCode());
                return List.of();
            }

            JsonNode body = objectMapper.readTree(response.getBody());
            // WATI returns: { "messageTemplates": [...] } or { "result": [...] }
            JsonNode templateArray = body.path("messageTemplates");
            if (!templateArray.isArray()) {
                templateArray = body.path("result");
            }
            if (!templateArray.isArray()) return List.of();

            List<WhatsAppTemplateInfoDTO> templates = new ArrayList<>();
            for (JsonNode tmpl : templateArray) {
                templates.add(parseWatiTemplate(tmpl));
            }

            log.info("Fetched {} templates from WATI API", templates.size());
            return templates;

        } catch (Exception e) {
            log.error("Failed to fetch WATI templates: {}", e.getMessage());
            return List.of();
        }
    }

    private WhatsAppTemplateInfoDTO parseWatiTemplate(JsonNode tmpl) {
        String name = tmpl.path("elementName").asText(tmpl.path("name").asText());
        String language = tmpl.path("languageCode").asText(tmpl.path("language").asText("en"));
        String category = tmpl.path("category").asText("");
        String status = tmpl.path("status").asText("APPROVED");

        String bodyText = tmpl.path("body").asText(tmpl.path("bodyOriginal").asText(null));
        int bodyParamCount = 0;
        if (bodyText != null) {
            Matcher m = PLACEHOLDER_PATTERN.matcher(bodyText);
            while (m.find()) bodyParamCount++;
        }

        String headerType = "none";
        String headerText = null;
        JsonNode headerNode = tmpl.path("header");
        if (!headerNode.isMissingNode()) {
            String format = headerNode.path("format").asText(headerNode.path("type").asText("TEXT")).toUpperCase();
            headerType = format.toLowerCase();
            if ("TEXT".equals(format)) {
                headerText = headerNode.path("text").asText(null);
            }
        }

        // Footer can be a string or an object { "text": "..." }
        JsonNode footerNode = tmpl.path("footer");
        String footerText = null;
        if (!footerNode.isMissingNode()) {
            if (footerNode.isTextual()) {
                footerText = footerNode.asText(null);
            } else if (footerNode.isObject()) {
                footerText = footerNode.path("text").asText(null);
            }
        }

        List<WhatsAppTemplateInfoDTO.ButtonInfo> buttons = new ArrayList<>();
        JsonNode buttonsNode = tmpl.path("buttons");
        if (buttonsNode.isArray()) {
            for (JsonNode btn : buttonsNode) {
                String btnType = btn.path("type").asText();
                String btnText = btn.path("text").asText();
                String btnUrl = btn.path("url").asText(null);
                buttons.add(WhatsAppTemplateInfoDTO.ButtonInfo.builder()
                        .type(btnType)
                        .text(btnText)
                        .url(btnUrl)
                        .hasDynamicUrl(btnUrl != null && btnUrl.contains("{{"))
                        .build());
            }
        }

        return WhatsAppTemplateInfoDTO.builder()
                .name(name)
                .language(language)
                .category(category)
                .status(status)
                .headerType(headerType)
                .headerText(headerText)
                .bodyText(bodyText)
                .footerText(footerText)
                .bodyParamCount(bodyParamCount)
                .buttons(buttons.isEmpty() ? null : buttons)
                .build();
    }
}
