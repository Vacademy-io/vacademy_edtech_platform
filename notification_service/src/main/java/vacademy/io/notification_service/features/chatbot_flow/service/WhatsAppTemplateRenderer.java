package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxTemplateButtonDTO;
import vacademy.io.notification_service.features.chatbot_flow.entity.NotificationTemplate;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Rebuilds the real message a recipient saw for an outgoing WhatsApp <b>template</b> send.
 *
 * <p>Template sends are stored on {@link NotificationLog} with an opaque summary body
 * ("WhatsApp Template: launchoffer | Provider: META | Status: SUCCESS | Params: {...}"), while the
 * structured send context (templateName + bodyParams + provider) is preserved separately on
 * {@link NotificationLog#getMessagePayload()}. Joining that payload with the stored template body and
 * substituting the params reconstructs the actual text — retroactively for every historical row and
 * without ever mutating stored data.
 *
 * <p>Shared by every surface that lists these logs (WhatsApp Inbox, per-student communication
 * timeline) so the substitution logic lives in exactly one place. Callers create a short-lived
 * {@link #newCache()} per request and pass it into each {@link #render} call so templates are loaded
 * once per institute, not once per message.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WhatsAppTemplateRenderer {

    private final NotificationTemplateRepository notificationTemplateRepository;

    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final String CHATBOT_FLOW_SOURCE = "CHATBOT_FLOW";
    /** Body line ChatbotFlowEngine writes for a template send. */
    private static final String CHATBOT_TEMPLATE_BODY_PREFIX = "Template: ";
    /** Matches {{1}} / {{ name }} placeholders (token filled in per-call). */
    private static final String PLACEHOLDER_FMT = "\\{\\{\\s*%s\\s*\\}\\}";

    // Used to pull a media URL out of a template's header_sample_url, which is sometimes stored as
    // raw HTML (e.g. <a href="..."><img src="..."></a>) rather than a plain URL.
    private static final Pattern IMG_SRC = Pattern.compile("<img[^>]*\\ssrc=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern HREF = Pattern.compile("href=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern ANY_URL = Pattern.compile("https?://[^\\s\"'<>]+");

    /** Result of rebuilding a template message. */
    public static class Rendered {
        /** Rebuilt message text, or {@code null} when the template is no longer on file. */
        public String body;
        public String templateName;
        /** Meta's category for the template (MARKETING / UTILITY / AUTHENTICATION), when on file. */
        public String category;
        public String provider;
        /** SUCCESS or FAILED — whether the provider accepted the send. */
        public String deliveryStatus;
        /** Provider rejection reason, when deliveryStatus == FAILED. */
        public String error;
        /** Template header type: NONE, TEXT, IMAGE, VIDEO, DOCUMENT. */
        public String headerType;
        /** Actual media URL for an IMAGE/VIDEO/DOCUMENT header, so the UI can display it. */
        public String headerMediaUrl;
        /** The template's buttons, as WhatsApp draws them under the message. Null when none. */
        public List<InboxTemplateButtonDTO> buttons;
    }

    /** Create a fresh per-request template cache (institute id → its templates). */
    public Map<String, InstituteTemplates> newCache() {
        return new HashMap<>();
    }

    /**
     * Rebuilds the message body for an outgoing template send. Returns {@code null} for anything
     * that isn't a structured template send or an older chatbot "Template: name" row (incoming
     * messages, free-text replies, other payload shapes), and a {@link Rendered} whose
     * {@code body} is {@code null} when the template can't be
     * found (caller then falls back to the stored summary body).
     *
     * @param fallbackInstituteId used when the log row itself has no institute stamped (legacy rows)
     */
    public Rendered render(NotificationLog nl, String fallbackInstituteId,
                           Map<String, InstituteTemplates> cache) {
        if (nl == null || nl.getNotificationType() == null
                || !nl.getNotificationType().contains("OUTGOING")) {
            return null;
        }
        String payloadJson = nl.getMessagePayload();

        try {
            Map<String, Object> payload = (payloadJson == null || payloadJson.isBlank())
                    ? Map.of()
                    : objectMapper.readValue(payloadJson, new TypeReference<Map<String, Object>>() {});
            Object templateNameObj = payload.get("templateName");
            String templateName = templateNameObj != null
                    ? templateNameObj.toString() : legacyChatbotTemplateName(nl);
            if (templateName == null) return null;

            Rendered rm = new Rendered();
            rm.templateName = templateName;
            rm.provider = asString(payload.get("provider"));
            rm.error = asString(payload.get("error"));
            rm.deliveryStatus = rm.error != null ? "FAILED" : "SUCCESS";

            Map<String, String> bodyParams = asStringMap(payload.get("bodyParams"));
            Map<String, String> headerParams = asStringMap(payload.get("headerParams"));
            String language = asString(payload.get("languageCode"));

            String instituteId = (nl.getInstituteId() != null && !nl.getInstituteId().isBlank())
                    ? nl.getInstituteId() : fallbackInstituteId;

            NotificationTemplate tmpl = lookupTemplate(instituteId, rm.templateName, language, cache);

            // Header type: prefer the per-send payload value (WATI/Meta store it lowercase, e.g.
            // "image"), else the template's header_type. Normalised to upper case for the UI.
            String headerType = asString(payload.get("headerType"));
            if ((headerType == null || headerType.isBlank()) && tmpl != null) {
                headerType = tmpl.getHeaderType();
            }
            rm.headerType = (headerType != null && !headerType.isBlank()) ? headerType.toUpperCase() : null;

            // Media header (image/video/document): resolve the real media URL so the UI can render
            // the actual attachment instead of an "[Image]" placeholder.
            if (isMediaHeader(rm.headerType)) {
                rm.headerMediaUrl = resolveHeaderMediaUrl(bodyParams, headerParams, tmpl);
            }

            if (tmpl != null) {
                rm.category = blankToNull(tmpl.getCategory());
                rm.body = composeMessage(tmpl, bodyParams, headerParams);
                rm.buttons = parseButtons(tmpl.getButtonsConfig(), asStringMap(payload.get("buttonParams")));
            }
            return rm;
        } catch (Exception e) {
            log.debug("Failed to render template message {}: {}", nl.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * Template name of a chatbot send logged before the bot kept its payload: those rows carry
     * only the body line {@code "Template: <name>"} written by {@code ChatbotFlowEngine}. Their
     * params were never stored, so a template with variables renders with its {{N}} left in.
     */
    static String legacyChatbotTemplateName(NotificationLog nl) {
        String body = nl.getBody();
        if (!CHATBOT_FLOW_SOURCE.equals(nl.getSource()) || body == null
                || !body.startsWith(CHATBOT_TEMPLATE_BODY_PREFIX)) {
            return null;
        }
        String name = body.substring(CHATBOT_TEMPLATE_BODY_PREFIX.length()).trim();
        return name.isEmpty() ? null : name;
    }

    /** Convenience: rendered message text, or the stored body when it can't be rebuilt. */
    public String displayBody(NotificationLog nl, String fallbackInstituteId,
                              Map<String, InstituteTemplates> cache) {
        Rendered rm = render(nl, fallbackInstituteId, cache);
        return (rm != null && rm.body != null) ? rm.body : (nl != null ? nl.getBody() : null);
    }

    // ==================== Rendering ====================

    /** Header text + substituted body + footer, joined the way it renders in WhatsApp. */
    private String composeMessage(NotificationTemplate tmpl, Map<String, String> bodyParams,
                                  Map<String, String> headerParams) {
        StringBuilder sb = new StringBuilder();

        // TEXT header becomes a bold-ish first line; media headers (IMAGE/VIDEO/DOCUMENT) are NOT
        // inlined as text here — they're surfaced as a real media URL for the UI to render.
        String headerType = tmpl.getHeaderType();
        if ("TEXT".equalsIgnoreCase(headerType) && isNotBlank(tmpl.getHeaderText())) {
            String header = substitute(tmpl.getHeaderText(), null, headerParams).trim();
            if (!header.isEmpty()) sb.append(header).append("\n\n");
        }

        String body = substitute(tmpl.getBodyText(), tmpl.getBodyVariableNames(), bodyParams);
        if (isNotBlank(body)) sb.append(body.trim());

        if (isNotBlank(tmpl.getFooterText())) {
            sb.append("\n\n").append(tmpl.getFooterText().trim());
        }

        String out = sb.toString().trim();
        return out.isEmpty() ? null : out;
    }

    /**
     * Substitutes template placeholders with param values. Covers both flavours WhatsApp templates
     * use: named ({@code {{name}}}) and positional ({@code {{1}}}). Positional mapping uses the
     * template's ordered variable-name array — position i maps to {@code {{i+1}}}.
     */
    private String substitute(String text, String orderingJson, Map<String, String> params) {
        if (text == null || params == null || params.isEmpty()) return text;

        String result = text;
        // Named-style placeholders — also covers positional templates whose params are keyed "1","2".
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (e.getKey() == null) continue;
            String value = e.getValue() != null ? e.getValue() : "";
            result = replacePlaceholder(result, e.getKey(), value);
            result = replacePlaceholder(result, cleanName(e.getKey()), value);
        }
        // Positional placeholders resolved through the ordered variable names.
        List<String> ordering = parseStringArray(orderingJson);
        for (int i = 0; i < ordering.size(); i++) {
            String value = lookupParam(params, ordering.get(i));
            if (value != null) {
                result = replacePlaceholder(result, String.valueOf(i + 1), value);
            }
        }
        return result;
    }

    /**
     * The template's buttons from {@code buttons_config}. A URL button's link is only kept when it
     * is a complete http(s) URL: a dynamic {{1}} suffix is filled from the send's
     * {@code buttonParams} (keyed by button index), and one that cannot be filled is shown as a
     * plain label rather than a broken link. Buttons with no text are skipped — WhatsApp would not
     * have drawn them either.
     */
    private List<InboxTemplateButtonDTO> parseButtons(String buttonsJson, Map<String, String> buttonParams) {
        if (buttonsJson == null || buttonsJson.isBlank()) return null;
        List<Map<String, Object>> raw;
        try {
            raw = objectMapper.readValue(buttonsJson, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return null;
        }
        List<InboxTemplateButtonDTO> buttons = new ArrayList<>();
        for (int i = 0; i < raw.size(); i++) {
            Map<String, Object> b = raw.get(i);
            String text = asString(b.get("text"));
            if (!isNotBlank(text)) continue;
            String type = isNotBlank(asString(b.get("type"))) ? asString(b.get("type")).toUpperCase() : null;

            String url = asString(b.get("url"));
            if (url != null && buttonParams.containsKey(String.valueOf(i))) {
                url = replacePlaceholder(url, "1", buttonParams.get(String.valueOf(i)));
            }
            if (url != null && (url.contains("{{") || !isUrl(url))) url = null;

            buttons.add(InboxTemplateButtonDTO.builder()
                    .type(type)
                    .text(text.trim())
                    .url(url != null ? url.trim() : null)
                    .phoneNumber(asString(b.get("phoneNumber")))
                    .build());
        }
        return buttons.isEmpty() ? null : buttons;
    }

    private String replacePlaceholder(String text, String token, String value) {
        if (token == null || token.isEmpty()) return text;
        Pattern p = Pattern.compile(String.format(PLACEHOLDER_FMT, Pattern.quote(token)));
        return p.matcher(text).replaceAll(Matcher.quoteReplacement(value));
    }

    private String lookupParam(Map<String, String> params, String name) {
        if (name == null) return null;
        if (params.containsKey(name)) return params.get(name);
        String clean = cleanName(name);
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (cleanName(e.getKey()).equals(clean)) return e.getValue();
        }
        return null;
    }

    /** Same normalisation the unified send path uses for named→positional resolution. */
    private String cleanName(String name) {
        return name == null ? "" : name.trim().toLowerCase().replaceAll("[^a-z0-9_]", "_");
    }

    private List<String> parseStringArray(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return Arrays.asList(objectMapper.readValue(json, String[].class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private Map<String, String> asStringMap(Object obj) {
        Map<String, String> out = new LinkedHashMap<>();
        if (obj instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (e.getKey() != null && e.getValue() != null) {
                    out.put(e.getKey().toString(), e.getValue().toString());
                }
            }
        }
        return out;
    }

    private String asString(Object obj) {
        return obj != null ? obj.toString() : null;
    }

    private boolean isNotBlank(String s) {
        return s != null && !s.isBlank();
    }

    private String blankToNull(String s) {
        return isNotBlank(s) ? s.trim().toUpperCase() : null;
    }

    private boolean isMediaHeader(String headerType) {
        return "IMAGE".equalsIgnoreCase(headerType)
                || "VIDEO".equalsIgnoreCase(headerType)
                || "DOCUMENT".equalsIgnoreCase(headerType);
    }

    // ==================== Media header URL resolution ====================

    /**
     * Resolves the real media URL for an image/video/document header. Prefers the per-send dynamic
     * URL (WATI stores it as {@code bodyParams._headerUrl} / {@code headerParams.link}; Meta passes
     * it in {@code headerParams}), then falls back to the template's static {@code header_sample_url}
     * (which is sometimes stored as HTML). Returns {@code null} when no usable URL is found — the UI
     * then simply shows the message text without a media attachment.
     */
    private String resolveHeaderMediaUrl(Map<String, String> bodyParams, Map<String, String> headerParams,
                                         NotificationTemplate tmpl) {
        String url = firstUrl(
                bodyParams.get("_headerUrl"),
                headerParams.get("link"),
                headerParams.get("header"),
                headerParams.get("url"),
                headerParams.get("image"),
                headerParams.get("video"),
                headerParams.get("document"));
        if (url == null) {
            // Any header-param value that looks like a URL (covers provider-specific key names).
            for (String v : headerParams.values()) {
                if (isUrl(v)) { url = v.trim(); break; }
            }
        }
        if (url == null && tmpl != null) {
            url = extractUrl(tmpl.getHeaderSampleUrl());
        }
        return url;
    }

    private String firstUrl(String... candidates) {
        for (String c : candidates) {
            if (isUrl(c)) return c.trim();
        }
        return null;
    }

    private boolean isUrl(String s) {
        if (s == null) return false;
        String t = s.trim();
        return t.startsWith("http://") || t.startsWith("https://");
    }

    /** Pulls a media URL out of a header_sample_url that may be a plain URL or raw HTML. */
    private String extractUrl(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String s = raw.trim();
        if (isUrl(s) && !s.contains("<")) return s;
        // Prefer <img src="..."> (the direct media) over <a href="..."> (a landing page).
        Matcher img = IMG_SRC.matcher(s);
        if (img.find()) return img.group(1);
        Matcher href = HREF.matcher(s);
        if (href.find()) return href.group(1);
        Matcher any = ANY_URL.matcher(s);
        if (any.find()) return any.group();
        return null;
    }

    // ==================== Template lookup (cached per institute) ====================

    private NotificationTemplate lookupTemplate(String instituteId, String templateName,
                                                String language, Map<String, InstituteTemplates> cache) {
        if (instituteId == null || instituteId.isBlank() || templateName == null) return null;
        InstituteTemplates templates = cache.computeIfAbsent(instituteId, this::loadInstituteTemplates);
        return templates.find(templateName, language);
    }

    /** Loads every template for an institute once, so per-message rendering is a map lookup. */
    private InstituteTemplates loadInstituteTemplates(String instituteId) {
        Map<String, NotificationTemplate> byName = new HashMap<>();
        Map<String, NotificationTemplate> byNameLang = new HashMap<>();
        try {
            for (NotificationTemplate t : notificationTemplateRepository
                    .findByInstituteIdOrderByUpdatedAtDesc(instituteId)) {
                if (t.getName() == null) continue;
                String nameLower = t.getName().toLowerCase();
                byName.putIfAbsent(nameLower, t); // most-recently-updated wins
                String lang = t.getLanguage() != null ? t.getLanguage().toLowerCase() : "en";
                byNameLang.putIfAbsent(nameLower + "|" + lang, t);
            }
        } catch (Exception e) {
            log.warn("Failed to load templates for institute {}: {}", instituteId, e.getMessage());
        }
        return new InstituteTemplates(byName, byNameLang);
    }

    /** Case-insensitive template resolver for a single institute, preferring an exact language match. */
    public record InstituteTemplates(Map<String, NotificationTemplate> byName,
                                     Map<String, NotificationTemplate> byNameLang) {
        NotificationTemplate find(String name, String language) {
            if (name == null) return null;
            String nameLower = name.toLowerCase();
            if (language != null && !language.isBlank()) {
                NotificationTemplate t = byNameLang.get(nameLower + "|" + language.toLowerCase());
                if (t != null) return t;
            }
            return byName.get(nameLower);
        }
    }
}
