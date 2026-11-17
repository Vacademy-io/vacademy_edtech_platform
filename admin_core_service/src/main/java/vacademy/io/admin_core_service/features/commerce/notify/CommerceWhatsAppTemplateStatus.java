package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * Whether a WhatsApp template of an institute is approved, read through notification_service's
 * {@code /by-name} (by institute, name and language). Cached: 10 minutes for APPROVED, 2 minutes
 * otherwise; a read error counts as not approved ({@code UNKNOWN}). Also the template's variable
 * names, and which WhatsApp provider the institute uses.
 */
@Slf4j
@Component
public class CommerceWhatsAppTemplateStatus {

    public static final String APPROVED = "APPROVED";
    public static final String MISSING = "MISSING";
    public static final String UNKNOWN = "UNKNOWN";
    static final long APPROVED_TTL_MS = 10 * 60_000L;
    static final long OTHER_TTL_MS = 2 * 60_000L;

    /** A template as read: status, variable names (null when unknown), its id (null when missing). */
    public record Template(String status, List<String> bodyVariableNames, String id) {
    }

    private record Cached(Template template, long until) {
    }

    private final EngagementInternalClients client;
    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private LongSupplier clock = System::currentTimeMillis;

    public CommerceWhatsAppTemplateStatus(EngagementInternalClients client,
                                          InstituteSettingService instituteSettingService, ObjectMapper objectMapper) {
        this.client = client;
        this.instituteSettingService = instituteSettingService;
        this.objectMapper = objectMapper;
    }

    void setClock(LongSupplier clock) {
        this.clock = clock;
    }

    /** APPROVED, PENDING, REJECTED, DRAFT, MISSING, or UNKNOWN when it could not be read. */
    public String status(String instituteId, String name, String locale) {
        return read(instituteId, name, locale).status();
    }

    public Template read(String instituteId, String name, String locale) {
        String key = instituteId + "|" + name + "|" + locale;
        long now = clock.getAsLong();
        Cached cached = cache.get(key);
        if (cached != null && cached.until() > now) {
            return cached.template();
        }
        Template template = fetch(instituteId, name, locale);
        long ttl = APPROVED.equals(template.status()) ? APPROVED_TTL_MS : OTHER_TTL_MS;
        if (cache.size() > 5000) {
            cache.clear();
        }
        cache.put(key, new Cached(template, now + ttl));
        return template;
    }

    /** Forgets what was read for the institute (after templates are submitted). */
    public void forget(String instituteId) {
        cache.keySet().removeIf(k -> k.startsWith(instituteId + "|"));
    }

    private Template fetch(String instituteId, String name, String locale) {
        if (name == null || !name.matches("[a-z0-9_]{1,100}")) {
            return new Template(MISSING, null, null);
        }
        try {
            JsonNode node = client.getWhatsAppTemplateByName(instituteId, name, locale);
            if (node == null || !node.hasNonNull("id")) {
                return new Template(MISSING, null, null);
            }
            String status = node.path("status").asText("").trim().toUpperCase(Locale.ROOT);
            List<String> names = null;
            JsonNode vars = node.get("bodyVariableNames");
            if (vars != null && vars.isArray()) {
                names = new ArrayList<>();
                for (JsonNode v : vars) {
                    names.add(v.asText());
                }
            }
            return new Template(status.isEmpty() ? UNKNOWN : status, names, node.path("id").asText());
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY template status of institute {} not read: {}", instituteId,
                    e.getClass().getSimpleName());
            return new Template(UNKNOWN, null, null);
        }
    }

    /** The WhatsApp provider of the institute's utility messages (META, WATI), or null when none is set. */
    public String provider(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, "WHATSAPP_SETTING");
            if (data == null) {
                return null;
            }
            JsonNode tree = objectMapper.valueToTree(data);
            String provider = tree.path("UTILITY_WHATSAPP").path("provider").asText("");
            return provider.isBlank() ? null : provider.trim().toUpperCase(Locale.ROOT);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
