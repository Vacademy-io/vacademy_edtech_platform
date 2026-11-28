package vacademy.io.notification_service.features.classroom.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.notification_service.features.classroom.dto.ClassroomWhatsAppRequest;
import vacademy.io.notification_service.service.MetaWhatsAppServiceProvider;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Sends the classroom panel WhatsApp messages (weekly usage summary, and the
 * alert count) from the platform's WhatsApp Business account, the same account
 * and send path as the admin app link.
 *
 * Off unless {@code classroom.whatsapp.enabled=true}. The template names and
 * language are properties, so a template can be replaced without a release.
 *
 * <h3>Template body parameters, in order</h3>
 * <ul>
 *   <li>WEEKLY_SUMMARY ({@code classroom.whatsapp.template-name}):
 *       institute name, panel hours, rooms used, rooms with a panel, idle rooms, link</li>
 *   <li>ALERTS ({@code classroom.whatsapp.alerts-template-name}, blank = not sent):
 *       institute name, number of new alerts, link</li>
 * </ul>
 * The approved templates must declare exactly these parameters in this order.
 */
@Service
@Slf4j
public class ClassroomWhatsAppService {

    public static final String KIND_WEEKLY_SUMMARY = "WEEKLY_SUMMARY";
    public static final String KIND_ALERTS = "ALERTS";

    /** The messaging API rejects long or multi-line template parameters. */
    static final int MAX_PARAM_LENGTH = 200;

    /** What happened to one request. */
    public enum Outcome { SENT, DISABLED, INVALID, NOT_CONFIGURED, FAILED }

    /** The template send, behind an interface so tests never reach the network. */
    @FunctionalInterface
    public interface TemplateSender {
        boolean send(String phoneNumberId, String accessToken, String phone, String templateName,
                     String languageCode, List<String> bodyParams);
    }

    private final boolean enabled;
    private final String weeklyTemplate;
    private final String alertsTemplate;
    private final String languageCode;
    private final String accessToken;
    private final String phoneNumberId;
    private final TemplateSender sender;

    @Autowired
    public ClassroomWhatsAppService(
            RestTemplate restTemplate,
            @Value("${meta.whatsapp.api.base.url:https://graph.facebook.com/v22.0}") String metaApiBaseUrl,
            @Value("${classroom.whatsapp.enabled:false}") boolean enabled,
            @Value("${classroom.whatsapp.template-name:classroom_weekly_summary}") String weeklyTemplate,
            @Value("${classroom.whatsapp.alerts-template-name:}") String alertsTemplate,
            @Value("${classroom.whatsapp.language-code:en}") String languageCode,
            @Value("${whatsapp.access-token.vidyayatan:}") String accessToken,
            @Value("${whatsapp.phone-number-id.vidyayatan:}") String phoneNumberId) {
        this(enabled, weeklyTemplate, alertsTemplate, languageCode, accessToken, phoneNumberId,
                (id, token, phone, template, lang, params) ->
                        new MetaWhatsAppServiceProvider(new ObjectMapper(), restTemplate, metaApiBaseUrl)
                                .sendTemplateMessage(id, token, phone, template, lang, params, null));
    }

    public ClassroomWhatsAppService(boolean enabled, String weeklyTemplate, String alertsTemplate,
                                    String languageCode, String accessToken, String phoneNumberId,
                                    TemplateSender sender) {
        this.enabled = enabled;
        this.weeklyTemplate = weeklyTemplate;
        this.alertsTemplate = alertsTemplate;
        this.languageCode = languageCode == null || languageCode.isBlank() ? "en" : languageCode.trim();
        this.accessToken = accessToken;
        this.phoneNumberId = phoneNumberId;
        this.sender = sender;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public Outcome send(ClassroomWhatsAppRequest request) {
        if (!enabled) return Outcome.DISABLED;
        if (request == null) return Outcome.INVALID;

        String phone = normalisePhone(request.phone());
        if (phone == null) return Outcome.INVALID;

        String kind = request.kind() == null || request.kind().isBlank()
                ? KIND_WEEKLY_SUMMARY : request.kind().trim().toUpperCase(Locale.ROOT);
        Map<String, String> v = request.variables() == null ? Map.of() : request.variables();
        String institute = param(request.instituteName(), "your institute");

        String template;
        List<String> params = new ArrayList<>();
        params.add(institute);
        switch (kind) {
            case KIND_WEEKLY_SUMMARY -> {
                template = weeklyTemplate;
                params.add(param(v.get("hours"), "0"));
                params.add(param(v.get("rooms_used"), "0"));
                params.add(param(v.get("rooms_total"), "0"));
                params.add(param(v.get("idle_rooms"), "0"));
                params.add(param(v.get("link"), "-"));
            }
            case KIND_ALERTS -> {
                template = alertsTemplate;
                params.add(param(v.get("alert_count"), "0"));
                params.add(param(v.get("link"), "-"));
            }
            default -> {
                return Outcome.INVALID;
            }
        }

        if (template == null || template.isBlank()
                || accessToken == null || accessToken.isBlank()
                || phoneNumberId == null || phoneNumberId.isBlank()) {
            log.warn("[classroom] WhatsApp {} not configured", kind);
            return Outcome.NOT_CONFIGURED;
        }

        try {
            boolean ok = sender.send(phoneNumberId, accessToken, phone, template.trim(), languageCode, params);
            if (!ok) log.warn("[classroom] WhatsApp {} was not accepted", kind);
            return ok ? Outcome.SENT : Outcome.FAILED;
        } catch (Exception e) {
            log.warn("[classroom] WhatsApp {} failed: {}", kind, e.getMessage());
            return Outcome.FAILED;
        }
    }

    /**
     * Digits only, with the country code, 8 to 15 digits; null when it cannot be a phone number.
     * A leading 0 is a national trunk prefix, never the start of a country code, so it is refused:
     * the caller adds the country code, this side does not guess one.
     */
    static String normalisePhone(String raw) {
        if (raw == null) return null;
        String trimmed = raw.trim();
        if (!trimmed.matches("\\+?[0-9 ()\\-]{8,24}")) return null;
        String digits = trimmed.replaceAll("[^0-9]", "");
        if (digits.startsWith("0")) return null;
        return digits.length() < 8 || digits.length() > 15 ? null : digits;
    }

    /** One line, bounded, never empty. */
    static String param(String raw, String fallback) {
        if (raw == null) return fallback;
        String v = raw.replaceAll("\\s+", " ").trim();
        if (v.isEmpty()) return fallback;
        return v.length() > MAX_PARAM_LENGTH ? v.substring(0, MAX_PARAM_LENGTH) : v;
    }
}
