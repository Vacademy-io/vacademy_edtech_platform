package vacademy.io.notification_service.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.CombotMessageProvider;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.MessageOriginPayload;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.common.logging.SentryLogger;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * WhatsApp sending service — delegates to CombotMessageProvider (COMBOT/META) and
 * WatiMessageProvider (WATI) while maintaining backward-compatible API signatures.
 *
 * This class handles:
 * - Provider routing (WATI/COMBOT/META) based on institute settings
 * - Test phone number allowlist filtering
 * - Notification log persistence
 * - Result format mapping (provider exceptions → List<Map<String, Boolean>>)
 */
@Service
@Slf4j
public class WhatsAppService {

    private final ObjectMapper objectMapper;
    private final CombotMessageProvider combotMessageProvider;
    private final NotificationLogRepository notificationLogRepository;
    private final ChannelToInstituteMappingRepository channelMappingRepository;
    private final InstituteInternalService internalService;
    private final WatiService watiService; // kept for WATI bulk sends (WatiMessageProvider is single-message)

    @Autowired
    public WhatsAppService(CombotMessageProvider combotMessageProvider,
                           WatiService watiService,
                           InstituteInternalService internalService,
                           NotificationLogRepository notificationLogRepository,
                           ChannelToInstituteMappingRepository channelMappingRepository) {
        this.combotMessageProvider = combotMessageProvider;
        this.watiService = watiService;
        this.internalService = internalService;
        this.notificationLogRepository = notificationLogRepository;
        this.channelMappingRepository = channelMappingRepository;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
    }

    // ==================== Public API (unchanged signatures) ====================

    /**
     * Legacy signature — delegates to sendWhatsappMessagesExtended.
     * Used by: AnnouncementDeliveryService
     */
    public List<Map<String, Boolean>> sendWhatsappMessages(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            Map<String, Map<String, String>> headerParams,
            String languageCode, String headerType, String instituteId) {
        return sendWhatsappMessagesExtended(templateName, bodyParams, headerParams,
                null, null, null, languageCode, headerType, instituteId);
    }

    /**
     * Extended signature with video headers and button URL params.
     * Used by: WhatsappController, UnifiedSendService, (via sendWhatsappMessages) AnnouncementDeliveryService
     */
    public List<Map<String, Boolean>> sendWhatsappMessagesExtended(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            Map<String, Map<String, String>> headerParams,
            Map<String, String> headerVideoParams,
            Map<String, String> buttonUrlParams,
            Map<String, String> buttonIndexParams,
            String languageCode, String headerType, String instituteId) {
        return sendWhatsappMessagesExtended(templateName, bodyParams, headerParams,
                headerVideoParams, buttonUrlParams, buttonIndexParams,
                languageCode, headerType, instituteId, null, null);
    }

    /**
     * Full signature with caller attribution. {@code source} lands in notification_log.source
     * (defaults to "whatsapp-service" when null) and {@code correlationId} in
     * notification_log.correlation_id — the Engagement Engine stamps its action id there so the
     * read/reply ledger can answer "did THIS decision land / get read?" exactly.
     */
    public List<Map<String, Boolean>> sendWhatsappMessagesExtended(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            Map<String, Map<String, String>> headerParams,
            Map<String, String> headerVideoParams,
            Map<String, String> buttonUrlParams,
            Map<String, String> buttonIndexParams,
            String languageCode, String headerType, String instituteId,
            String source, String correlationId) {

        List<WhatsAppSendResult> detailed = sendWhatsappMessagesDetailed(templateName, bodyParams,
                headerParams, headerVideoParams, buttonUrlParams, buttonIndexParams,
                languageCode, headerType, instituteId, source, correlationId);
        if (detailed == null) return null;
        return detailed.stream()
                .map(r -> Collections.<String, Boolean>singletonMap(r.phone(), r.success()))
                .collect(Collectors.toList());
    }

    /**
     * Per-recipient send outcome including the provider's rejection reason.
     * <p>
     * The legacy {@code List<Map<String, Boolean>>} shape collapses every failure to {@code false},
     * which is why provider errors used to surface to API callers as {@code "error": null} —
     * undebuggable without digging through service logs. Callers that report failures to a user
     * or an HTTP response should use {@link #sendWhatsappMessagesDetailed} instead.
     */
    public record WhatsAppSendResult(String phone, boolean success, String error, String messageId) {}

    private static final Pattern BODY_PLACEHOLDER = Pattern.compile("\\{\\{\\s*([^{}]*?)\\s*\\}\\}");

    /**
     * Highest {{n}} in a WhatsApp template body (Meta numbers them 1..n), or null when it can't be
     * known: blank body, or a named placeholder ({{first_name}}) whose params aren't positional.
     */
    public static Integer countBodyPlaceholders(String bodyText) {
        if (bodyText == null || bodyText.isBlank()) return null;
        int max = 0;
        java.util.regex.Matcher m = BODY_PLACEHOLDER.matcher(bodyText);
        while (m.find()) {
            Integer pos = parsePosition(m.group(1));
            if (pos == null) return null;
            max = Math.max(max, pos);
        }
        return max;
    }

    /**
     * Applies {@link #keepDeclaredBodyParams} to each recipient that would send MORE body params
     * than declared. Recipients at or under the count are passed through untouched, so a send
     * that Meta accepts today is unchanged.
     */
    static List<Map<String, Map<String, String>>> trimToDeclaredBodyParams(
            List<Map<String, Map<String, String>>> bodyParams, Integer declared) {
        if (declared == null || bodyParams == null) return bodyParams;
        List<Map<String, Map<String, String>>> out = new ArrayList<>(bodyParams.size());
        for (Map<String, Map<String, String>> userDetail : bodyParams) {
            if (userDetail == null || userDetail.size() != 1) {
                out.add(userDetail);
                continue;
            }
            Map.Entry<String, Map<String, String>> e = userDetail.entrySet().iterator().next();
            Map<String, String> params = e.getValue();
            if (params == null || bodyParamCount(params) <= declared) {
                out.add(userDetail);
                continue;
            }
            Map<String, Map<String, String>> trimmed = new HashMap<>();
            trimmed.put(e.getKey(), keepDeclaredBodyParams(params, declared));
            out.add(trimmed);
        }
        return out;
    }

    /**
     * Trims params to what the approved body declares: "_" control keys plus positions
     * 1..declared. A position the caller left unfilled takes the next unmapped named value, in
     * the order the legacy pass-through would have sent it, so templates stored without
     * variable names keep working; whatever is left over is dropped.
     */
    static Map<String, String> keepDeclaredBodyParams(Map<String, String> params, int declared) {
        Map<String, String> kept = new HashMap<>();
        List<String> unmapped = new ArrayList<>();
        for (Map.Entry<String, String> e : params.entrySet()) {
            String key = e.getKey();
            if (key.startsWith("_")) {
                kept.put(key, e.getValue());
                continue;
            }
            Integer pos = parsePosition(key);
            if (pos == null) {
                unmapped.add(e.getValue());
            } else if (pos >= 1 && pos <= declared) {
                kept.put(key, e.getValue());
            }
        }
        Iterator<String> fill = unmapped.iterator();
        for (int pos = 1; pos <= declared && fill.hasNext(); pos++) {
            kept.putIfAbsent(String.valueOf(pos), fill.next());
        }
        return kept;
    }

    /** Number of values sent as body params — every key not prefixed "_" (see sendViaCombotProvider). */
    static long bodyParamCount(Map<String, String> params) {
        return params.keySet().stream().filter(k -> !k.startsWith("_")).count();
    }

    private static Integer parsePosition(String key) {
        try {
            return Integer.parseInt(key);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Same send path as {@link #sendWhatsappMessagesExtended}, but each result carries the
     * provider's error message. Returns {@code null} on the same whole-batch failures
     * (missing instituteId / missing settings / unexpected exception).
     */
    public List<WhatsAppSendResult> sendWhatsappMessagesDetailed(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            Map<String, Map<String, String>> headerParams,
            Map<String, String> headerVideoParams,
            Map<String, String> buttonUrlParams,
            Map<String, String> buttonIndexParams,
            String languageCode, String headerType, String instituteId,
            String source, String correlationId) {
        return sendWhatsappMessagesDetailed(templateName, bodyParams, headerParams, headerVideoParams,
                buttonUrlParams, buttonIndexParams, languageCode, headerType, instituteId,
                source, correlationId, null);
    }

    /**
     * @param declaredBodyParams number of {{n}} in the approved template body (see
     *        {@link #countBodyPlaceholders}), or null when unknown. Only used on the META/COMBOT
     *        path to drop body params the template does not declare.
     */
    public List<WhatsAppSendResult> sendWhatsappMessagesDetailed(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            Map<String, Map<String, String>> headerParams,
            Map<String, String> headerVideoParams,
            Map<String, String> buttonUrlParams,
            Map<String, String> buttonIndexParams,
            String languageCode, String headerType, String instituteId,
            String source, String correlationId, Integer declaredBodyParams) {

        if (instituteId == null) {
            log.error("Missing instituteId for WhatsApp message sending");
            SentryLogger.logError(new IllegalArgumentException("instituteId is null"),
                    "WhatsApp send called with null instituteId",
                    Map.of("template.name", templateName != null ? templateName : "unknown", "layer", "4-whatsapp-service"));
            return null;
        }

        try {
            InstituteInfoDTO instituteDTO = internalService.getInstituteByInstituteId(instituteId);
            String jsonString = instituteDTO.getSetting();
            if (jsonString == null || jsonString.isEmpty()) {
                log.error("No WhatsApp settings configured for institute {}", instituteId);
                SentryLogger.logError(new IllegalStateException("WhatsApp settings missing"),
                        "Institute has no WhatsApp settings — all sends will be dropped",
                        Map.of("institute.id", instituteId, "template.name", templateName != null ? templateName : "unknown",
                                "layer", "4-whatsapp-service"));
                return null;
            }
            log.info("Retrieved institute settings for: {}", instituteId);

            JsonNode root = objectMapper.readTree(jsonString);
            JsonNode whatsappSetting = root.path(NotificationConstants.SETTING)
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);

            // Apply test allowlist filter
            bodyParams = filterRecipientsByTestAllowListIfEnabled(root, bodyParams);
            if (bodyParams == null || bodyParams.isEmpty()) {
                log.info("TEST allowlist active and no recipients matched; skipping sends");
                return List.of();
            }

            // Route to provider
            String provider = whatsappSetting.path(NotificationConstants.PROVIDER).asText("META").toUpperCase();
            log.info("WhatsApp provider for institute {}: {}, recipients={}", instituteId, provider, bodyParams.size());

            List<WhatsAppSendResult> results;
            String senderChannelId = null;

            if ("WATI".equals(provider)) {
                senderChannelId = resolveWatiChannelId(whatsappSetting);
                // WATI bulk responses carry no per-message ids; status joins stay phone-based
                results = sendViaWati(templateName, bodyParams, languageCode, whatsappSetting).stream()
                        // Defensive: an entry-less map carries no recipient, so skip it rather
                        // than let iterator().next() throw and collapse the whole batch to null.
                        .filter(m -> m != null && !m.isEmpty())
                        .map(m -> {
                            Map.Entry<String, Boolean> e = m.entrySet().iterator().next();
                            boolean ok = Boolean.TRUE.equals(e.getValue());
                            return new WhatsAppSendResult(e.getKey(), ok,
                                    ok ? null : "WATI rejected the message (see service logs)", null);
                        })
                        .collect(Collectors.toList());
            } else {
                // COMBOT and META both go through CombotMessageProvider
                // Meta rejects the whole message (#132000) when the body param count differs from
                // the approved template — audience sends always carry name + email. WATI ignores
                // extras, so only this path is trimmed.
                bodyParams = trimToDeclaredBodyParams(bodyParams, declaredBodyParams);
                senderChannelId = resolveSenderChannelId(whatsappSetting, provider);
                results = sendViaCombotProvider(templateName, bodyParams, headerParams,
                        headerVideoParams, buttonUrlParams, buttonIndexParams,
                        languageCode, headerType, instituteId);
            }

            // Log to notification_log
            logWhatsAppMessages(templateName, bodyParams, headerParams, languageCode,
                    headerType, provider, results, senderChannelId,
                    source, correlationId, instituteId);

            return results;

        } catch (Exception e) {
            log.error("Exception occurred while sending WhatsApp messages for institute {}: {}",
                    instituteId, e.getMessage(), e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send WhatsApp messages")
                    .withTag("notification.type", "WHATSAPP")
                    .withTag("institute.id", instituteId)
                    .withTag("template.name", templateName != null ? templateName : "unknown")
                    .withTag("user.count", String.valueOf(bodyParams != null ? bodyParams.size() : 0))
                    .withTag("operation", "sendWhatsappMessages")
                    .send();
            return null;
        }
    }

    // ==================== Provider Delegates ====================

    /**
     * Delegates to CombotMessageProvider for both COMBOT and META providers.
     * Converts the legacy format (List<Map<phone, Map<key,value>>>) to the
     * provider's templatePayload format, one message at a time.
     * <p>
     * Each returned result carries the provider's rejection reason on failure, and the
     * provider message id (wamid) on success — the wamid is what lets the sent/delivered/read
     * webhooks join back to the exact outbound row instead of "most recent send to that phone".
     */
    private List<WhatsAppSendResult> sendViaCombotProvider(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            Map<String, Map<String, String>> headerParams,
            Map<String, String> headerVideoParams,
            Map<String, String> buttonUrlParams,
            Map<String, String> buttonIndexParams,
            String languageCode, String headerType, String instituteId) {

        List<WhatsAppSendResult> results = new ArrayList<>();

        for (Map<String, Map<String, String>> userDetail : bodyParams) {
            String phoneNumber = userDetail.keySet().iterator().next();
            Map<String, String> params = userDetail.get(phoneNumber);

            try {
                // Build templatePayload in the format CombotMessageProvider expects
                Map<String, Object> templatePayload = new HashMap<>();
                templatePayload.put("templateName", templateName);
                templatePayload.put("languageCode", languageCode != null ? languageCode : "en");

                // Body params: filter out special _prefixed keys, sort by numeric key → List<String>
                if (params != null && !params.isEmpty()) {
                    List<String> bodyParamList = params.entrySet().stream()
                            .filter(e -> !e.getKey().startsWith("_")) // skip _headerUrl, _buttonUrl etc.
                            .sorted(Comparator.comparingInt(e -> {
                                try { return Integer.parseInt(e.getKey()); }
                                catch (NumberFormatException ex) { return 999; }
                            }))
                            .map(Map.Entry::getValue)
                            .collect(Collectors.toList());
                    if (!bodyParamList.isEmpty()) {
                        templatePayload.put("bodyParams", bodyParamList);
                    }
                }

                // Header config
                Map<String, Object> headerConfig = buildHeaderConfig(phoneNumber,
                        headerParams, headerVideoParams, headerType);
                if (headerConfig != null) {
                    templatePayload.put("headerConfig", headerConfig);
                }

                // Button config
                List<Map<String, Object>> buttonConfig = buildButtonConfig(phoneNumber,
                        buttonUrlParams, buttonIndexParams);
                if (buttonConfig != null) {
                    templatePayload.put("buttonConfig", buttonConfig);
                }

                // Delegate to CombotMessageProvider
                String messageId = combotMessageProvider.sendTemplate(phoneNumber, templatePayload, instituteId, null);
                results.add(new WhatsAppSendResult(phoneNumber, true, null, messageId));

            } catch (Exception e) {
                // Keep the provider's message: for Meta this is the Graph API error body
                // (e.g. code 132000 "number of parameters does not match"), which is the
                // only thing that makes a failed send diagnosable by the caller.
                String reason = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                log.error("Failed to send to {} via provider: {}", phoneNumber, reason);
                results.add(new WhatsAppSendResult(phoneNumber, false, reason, null));
            }

            // Rate limit — OUTSIDE the send try/catch. An interrupt during the sleep must not
            // double-add entries for the recipient that already succeeded (that would shift the
            // wamid↔recipient alignment for every later row and credit read receipts to the
            // wrong person). Stop the batch cleanly instead; rows so far stay aligned.
            try {
                Thread.sleep(100);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                log.warn("WhatsApp batch send interrupted after {} of {} recipients", results.size(), bodyParams.size());
                break;
            }
        }

        return results;
    }

    /**
     * WATI uses bulk API via WatiService (WatiMessageProvider is single-message only).
     */
    private List<Map<String, Boolean>> sendViaWati(String templateName,
            List<Map<String, Map<String, String>>> bodyParams,
            String languageCode, JsonNode whatsappSetting) {
        try {
            JsonNode watiConfig = whatsappSetting.path(NotificationConstants.WATI);
            String apiKey = watiConfig.path(NotificationConstants.API_KEY).asText();
            String apiUrl = watiConfig.path(NotificationConstants.API_URL).asText("https://live-server.wati.io");

            if (apiKey == null || apiKey.isBlank()) {
                log.error("WATI API key not configured");
                SentryLogger.logError(new IllegalStateException("WATI API key missing"),
                        "WATI API key not configured for institute — all sends will fail",
                        Map.of("api.url", apiUrl, "template.name", templateName != null ? templateName : "unknown",
                                "layer", "4-whatsapp-service"));
                return bodyParams.stream()
                        .map(detail -> Map.of(detail.keySet().iterator().next(), false))
                        .collect(Collectors.toList());
            }

            log.info("Sending WhatsApp messages via WATI: template={}, recipients={}",
                    templateName, bodyParams.size());

            return watiService.sendTemplateMessages(
                    templateName, bodyParams,
                    languageCode != null ? languageCode : "en",
                    apiKey, apiUrl,
                    "Notification - " + templateName);

        } catch (Exception e) {
            log.error("Error sending via WATI: {}", e.getMessage(), e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send WhatsApp via WATI")
                    .withTag("notification.type", "WHATSAPP")
                    .withTag("whatsapp.provider", "WATI")
                    .withTag("template.name", templateName)
                    .withTag("user.count", String.valueOf(bodyParams != null ? bodyParams.size() : 0))
                    .withTag("operation", "sendViaWati")
                    .send();
            if (bodyParams == null) return List.of();
            return bodyParams.stream()
                    .map(detail -> Map.of(detail.keySet().iterator().next(), false))
                    .collect(Collectors.toList());
        }
    }

    // ==================== Helpers ====================

    private Map<String, Object> buildHeaderConfig(String phoneNumber,
            Map<String, Map<String, String>> headerParams,
            Map<String, String> headerVideoParams,
            String headerType) {

        // Video header takes precedence
        if (headerVideoParams != null && headerVideoParams.containsKey(phoneNumber)) {
            return Map.of(
                    "type", "video",
                    "url", headerVideoParams.get(phoneNumber));
        }

        // Image/document header
        if (headerParams != null && headerParams.containsKey(phoneNumber)) {
            Map<String, String> hp = headerParams.get(phoneNumber);
            if (hp == null || hp.isEmpty()) return null;
            String url = hp.getOrDefault("link", hp.values().iterator().next());
            String type = "image".equalsIgnoreCase(headerType) ? "image" : "document";
            Map<String, Object> config = new HashMap<>();
            config.put("type", type);
            config.put("url", url);
            if ("document".equals(type)) {
                config.put("filename", documentFilenameFromUrl(url));
            }
            return config;
        }

        return null;
    }

    private static final Pattern UPLOAD_KEY_PREFIX =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-");

    /**
     * The name WhatsApp shows on a document header — the recipient sees this in the chat, so it
     * should be the file's own name, not a placeholder. Our uploads are stored as
     * {@code <uuid>-<original name>}; the uuid prefix is stripped. Falls back to "file.pdf" when
     * the URL carries nothing usable (no path, no extension).
     */
    static String documentFilenameFromUrl(String url) {
        String fallback = "file.pdf";
        if (url == null || url.isBlank()) return fallback;
        String path = url;
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        int h = path.indexOf('#');
        if (h >= 0) path = path.substring(0, h);
        String segment = path.substring(path.lastIndexOf('/') + 1);
        try {
            // URLDecoder is form-decoding: a literal '+' in the name would become a space, so
            // shield it first. Anything that decodes to a path separator is dropped as well.
            segment = URLDecoder.decode(segment.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ignored) {
            // malformed %-escape: keep the raw segment
        }
        segment = segment.substring(segment.lastIndexOf('/') + 1);
        segment = UPLOAD_KEY_PREFIX.matcher(segment).replaceFirst("").trim();
        int dot = segment.lastIndexOf('.');
        if (segment.isEmpty() || dot <= 0 || dot == segment.length() - 1) return fallback;
        return segment;
    }

    private List<Map<String, Object>> buildButtonConfig(String phoneNumber,
            Map<String, String> buttonUrlParams,
            Map<String, String> buttonIndexParams) {

        if (buttonUrlParams == null || !buttonUrlParams.containsKey(phoneNumber)) {
            return null;
        }

        String urlSuffix = buttonUrlParams.get(phoneNumber);
        String index = buttonIndexParams != null
                ? buttonIndexParams.getOrDefault(phoneNumber, "0") : "0";

        int idx;
        try { idx = Integer.parseInt(index); }
        catch (NumberFormatException e) { idx = 0; }

        Map<String, Object> btn = new HashMap<>();
        btn.put("type", "url");
        btn.put("index", idx);
        btn.put("urlSuffix", urlSuffix);

        return List.of(btn);
    }

    private String resolveWatiChannelId(JsonNode whatsappSetting) {
        try {
            JsonNode wati = whatsappSetting.path(NotificationConstants.WATI);
            String number = wati.path("whatsappNumber").asText(
                    wati.path("whatsapp_number").asText(null));
            if (number != null && !number.isBlank()) return number;
            // Fallback: phone_number_id used in channel_to_institute_mapping
            return wati.path("phone_number_id").asText(
                    wati.path("phoneNumberId").asText(null));
        } catch (Exception e) {
            return null;
        }
    }

    private String resolveSenderChannelId(JsonNode whatsappSetting, String provider) {
        try {
            if ("COMBOT".equals(provider)) {
                return whatsappSetting.path(NotificationConstants.COMBOT)
                        .path(NotificationConstants.PHONE_NUMBER_ID).asText(null);
            } else {
                // META
                JsonNode meta = whatsappSetting.path(NotificationConstants.META);
                if (!meta.isMissingNode()) {
                    return meta.path(NotificationConstants.APP_ID).asText(null);
                }
                return whatsappSetting.path(NotificationConstants.APP_ID).asText(null);
            }
        } catch (Exception e) {
            return null;
        }
    }

    // ==================== Test Allowlist Filter ====================

    private List<Map<String, Map<String, String>>> filterRecipientsByTestAllowListIfEnabled(
            JsonNode root,
            List<Map<String, Map<String, String>>> bodyParams) {

        if (root == null || bodyParams == null || bodyParams.isEmpty())
            return bodyParams;

        JsonNode testConfig = root.path(NotificationConstants.SETTING)
                .path(NotificationConstants.TEST_PHONE_NUMBER);

        if (testConfig.isMissingNode()) {
            return bodyParams;
        }

        JsonNode dataNode = testConfig.path(NotificationConstants.DATA);
        boolean flagEnabled = false;
        JsonNode mobileNumbersNode = null;

        if (dataNode != null && !dataNode.isMissingNode() && dataNode.isObject()) {
            flagEnabled = dataNode.path(NotificationConstants.FLAG).asBoolean(false);
            mobileNumbersNode = dataNode.path("mobile_numbers");
        } else {
            flagEnabled = testConfig.path(NotificationConstants.FLAG).asBoolean(false);
            mobileNumbersNode = dataNode;
        }

        if (!flagEnabled) {
            return bodyParams;
        }

        if (mobileNumbersNode == null || mobileNumbersNode.isMissingNode() || !mobileNumbersNode.isArray()
                || mobileNumbersNode.size() == 0) {
            return bodyParams;
        }

        Set<String> allow = new HashSet<>();
        for (JsonNode node : mobileNumbersNode) {
            String raw = node.asText();
            if (raw != null && !raw.isBlank()) {
                allow.add(raw.replaceAll("[^0-9]", ""));
            }
        }
        if (allow.isEmpty())
            return bodyParams;

        List<Map<String, Map<String, String>>> filtered = bodyParams.stream()
                .filter(detail -> {
                    String phone = detail.keySet().iterator().next();
                    String normalized = phone.replaceAll("[^0-9]", "");
                    return allow.contains(normalized);
                })
                .collect(Collectors.toList());

        log.info("TEST allowlist enabled: {} of {} recipients will be sent", filtered.size(), bodyParams.size());
        return filtered;
    }

    /**
     * Catch the statuses that arrived before these rows did.
     *
     * <p>A batch sends every recipient and only then writes its notification_log rows, so for a
     * blast of any size WhatsApp's sent/delivered/read webhooks for the early recipients are
     * processed while their send row does not yet exist — the webhook finds nothing to stamp and
     * never runs again, leaving delivered messages on one grey tick. The rows exist now, so ask
     * once what the provider has already reported about them.
     *
     * <p>Best-effort by contract: the messages are sent and logged either way, and a tick that
     * stays grey is not worth failing a send over.
     */
    private void backfillStatusesReportedBeforeTheseRowsExisted(List<NotificationLog> logs,
                                                                String templateName,
                                                                String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return;
        try {
            String[] messageIds = logs.stream()
                    .map(NotificationLog::getSourceId)
                    // Only a real provider id can join. A send with none (WATI bulk, a refused
                    // send) stored the template name instead, and matching on that would drag in
                    // every other message ever sent from the same template.
                    .filter(id -> id != null && !id.equals(templateName))
                    .distinct()
                    .toArray(String[]::new);
            if (messageIds.length == 0) return;

            // How far back to look for statuses that already arrived. The batch's own oldest send
            // plus a margin — the status cannot predate its send, and keeping the window tight is
            // what makes this an indexed lookup instead of a scan of every status row on file.
            Instant since = logs.stream()
                    .map(NotificationLog::getNotificationDate)
                    .filter(Objects::nonNull)
                    .min(Instant::compareTo)
                    .orElse(Instant.now())
                    .minus(Duration.ofMinutes(15));

            int stamped = notificationLogRepository.backfillDeliveryStatusFromRecordedEvents(
                    instituteId, since, messageIds);
            if (stamped > 0) {
                log.info("Back-filled delivery status on {} of {} just-logged WhatsApp rows "
                        + "(status webhook arrived before the row)", stamped, messageIds.length);
            }
        } catch (Exception e) {
            log.warn("Could not back-fill delivery status for this batch: {}", e.getMessage());
        }
    }

    // ==================== Notification Logging ====================

    private void logWhatsAppMessages(String templateName,
                                    List<Map<String, Map<String, String>>> bodyParams,
                                    Map<String, Map<String, String>> headerParams,
                                    String languageCode,
                                    String headerType,
                                    String provider,
                                    List<WhatsAppSendResult> results,
                                    String senderBusinessChannelId,
                                    String source,
                                    String correlationId,
                                    String instituteId) {
        try {
            List<NotificationLog> logs = new ArrayList<>();

            for (int i = 0; i < bodyParams.size() && i < results.size(); i++) {
                Map<String, Map<String, String>> userDetail = bodyParams.get(i);
                WhatsAppSendResult result = results.get(i);

                String phoneNumber = userDetail.keySet().iterator().next();
                Map<String, String> params = userDetail.get(phoneNumber);

                String userId = params.getOrDefault("userId", params.getOrDefault("user_id", null));

                boolean success = result.success();

                Map<String, Object> payload = new HashMap<>();
                payload.put("templateName", templateName);
                payload.put("phoneNumber", phoneNumber);
                // Who sent it (workflow, ...) goes on the payload's top level, not in bodyParams —
                // a resend built from these params must not carry the original sender along.
                payload.put("bodyParams", MessageOriginPayload.withoutOrigin(params));
                MessageOriginPayload.liftToPayload(params, payload);
                payload.put("languageCode", languageCode);
                payload.put("headerType", headerType);
                payload.put("provider", provider);
                if (headerParams != null && headerParams.containsKey(phoneNumber)) {
                    payload.put("headerParams", headerParams.get(phoneNumber));
                }

                // Persist the provider's rejection reason on the row itself. Without it a failed
                // send can only be explained by correlating service logs by timestamp.
                // Must be set BEFORE the payload is serialized below.
                if (!success && result.error() != null) {
                    payload.put("error", result.error());
                }

                String payloadJson;
                try {
                    payloadJson = objectMapper.writeValueAsString(payload);
                } catch (Exception e) {
                    payloadJson = payload.toString();
                }

                String bodyMessage = String.format("WhatsApp Template: %s | Provider: %s | Status: %s | Params: %s",
                        templateName, provider, success ? "SUCCESS" : "FAILED", params);
                if (!success && result.error() != null) {
                    bodyMessage += " | Error: " + result.error();
                }

                // Provider message id (Meta wamid). With it, source_id lets the status webhooks
                // (findOutgoingByMessageId) join sent/delivered/read events to THIS exact row.
                // Without it (WATI, send failures), fall back to the legacy templateName value.
                String messageId = result.messageId();

                NotificationLog notifLog = new NotificationLog();
                notifLog.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
                notifLog.setChannelId(phoneNumber);
                notifLog.setBody(bodyMessage);
                notifLog.setSource(source != null && !source.isBlank() ? source : "whatsapp-service");
                notifLog.setSourceId(messageId != null ? messageId : templateName);
                notifLog.setCorrelationId(correlationId);
                notifLog.setUserId(userId);
                notifLog.setNotificationDate(Instant.now());
                notifLog.setMessagePayload(payloadJson);
                notifLog.setSenderBusinessChannelId(senderBusinessChannelId);
                // Stamp institute_id so the WA Inbox conversation query (which filters on
                // institute_id) surfaces this outgoing row. The caller's instituteId is
                // authoritative and always present; the WABA channel-mapping lookup is only a
                // fallback for legacy paths that don't pass it. Previously we relied solely on
                // the mapping lookup off senderBusinessChannelId (derived from meta.appId), which
                // came back empty for template/announcement sends and left the row invisible.
                if (instituteId != null && !instituteId.isBlank()) {
                    notifLog.setInstituteId(instituteId);
                } else if (senderBusinessChannelId != null) {
                    channelMappingRepository.findById(senderBusinessChannelId)
                            .ifPresent(m -> notifLog.setInstituteId(m.getInstituteId()));
                }

                logs.add(notifLog);
            }

            if (!logs.isEmpty()) {
                notificationLogRepository.saveAll(logs);
                log.info("Logged {} WhatsApp messages to notification_log table", logs.size());
                backfillStatusesReportedBeforeTheseRowsExisted(logs, templateName, instituteId);
            }

        } catch (Exception e) {
            log.error("Failed to log WhatsApp messages to notification_log: {}", e.getMessage(), e);
        }
    }
}
