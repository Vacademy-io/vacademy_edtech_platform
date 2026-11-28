package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * Asks Meta to approve the default WhatsApp templates of the buyer messages: for each trigger and
 * language asked whose default template does not exist yet at notification_service, a draft
 * (category UTILITY, no header, the positional body with its variable names and neutral sample
 * values) is made and submitted. A template that exists is reported with its status and left
 * alone. A WATI institute makes its templates in WATI: each item says so and carries the text.
 * Runs outside any transaction; three calls per institute per hour.
 */
@Slf4j
@Service
public class CommerceNotificationTemplateSubmitService {

    public static final String CREATED_AND_SUBMITTED = "CREATED_AND_SUBMITTED";
    public static final String EXISTS = "EXISTS";
    public static final String PROVIDER_NOT_SUPPORTED = "PROVIDER_NOT_SUPPORTED";
    public static final String PROVIDER_ERROR = "PROVIDER_ERROR";
    static final String SCOPE = "notify_templates";
    static final Duration WINDOW = Duration.ofHours(1);
    static final int LIMIT = 3;

    private final CommerceSetupAccess setupAccess;
    private final CommerceRateLimiter rateLimiter;
    private final CommerceWhatsAppTemplateStatus templates;
    private final EngagementInternalClients client;
    private final CommerceAuditService auditService;
    private final ObjectMapper objectMapper;
    private LongSupplier clock = System::currentTimeMillis;

    public CommerceNotificationTemplateSubmitService(CommerceSetupAccess setupAccess, CommerceRateLimiter rateLimiter,
                                                     CommerceWhatsAppTemplateStatus templates,
                                                     EngagementInternalClients client,
                                                     CommerceAuditService auditService, ObjectMapper objectMapper) {
        this.setupAccess = setupAccess;
        this.rateLimiter = rateLimiter;
        this.templates = templates;
        this.client = client;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
    }

    void setClock(LongSupplier clock) {
        this.clock = clock;
    }

    /** {@code POST /notification-settings/whatsapp-templates}. */
    public NotificationSettingsDtos.TemplateSubmitAnswer submit(CustomUserDetails user, String instituteId,
                                                                JsonNode body) {
        setupAccess.require(user, instituteId, CommerceNotificationSettingsService.WRITE);
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("templates are submitted outside any transaction");
        }
        List<CommerceNotificationTrigger> triggers = triggers(body);
        List<String> locales = locales(body);
        if (!rateLimiter.allow(instituteId, SCOPE, CommerceRateLimiter.ALL, WINDOW, LIMIT)) {
            throw new CommerceNotifyRateLimitedException("at most " + LIMIT + " template requests per hour",
                    CommerceRateLimiter.secondsToNextWindow(WINDOW, clock.getAsLong()));
        }
        boolean wati = "WATI".equals(templates.provider(instituteId));
        List<NotificationSettingsDtos.TemplateSubmitItem> items = new ArrayList<>();
        try {
            for (CommerceNotificationTrigger trigger : triggers) {
                for (String locale : locales) {
                    items.add(wati ? notSupported(trigger, locale) : one(instituteId, user, trigger, locale));
                }
            }
        } finally {
            templates.forget(instituteId);
        }
        audit(instituteId, user, items);
        return NotificationSettingsDtos.TemplateSubmitAnswer.builder().items(items).build();
    }

    static List<CommerceNotificationTrigger> triggers(JsonNode body) {
        JsonNode node = body == null ? null : body.get("triggers");
        if (body != null && !body.isNull() && !body.isObject()) {
            throw CommerceNotificationSettingsService.invalid("the body is a JSON object");
        }
        if (node == null || node.isNull()) {
            return List.of(CommerceNotificationTrigger.values());
        }
        if (!node.isArray()) {
            throw CommerceNotificationSettingsService.invalid("triggers is null or a list of trigger codes");
        }
        Set<CommerceNotificationTrigger> out = new LinkedHashSet<>();
        for (JsonNode item : node) {
            CommerceNotificationTrigger t = item != null && item.isTextual()
                    ? CommerceNotificationTrigger.of(item.asText().trim()) : null;
            if (t == null) {
                throw CommerceNotificationSettingsService.invalid("unknown trigger");
            }
            out.add(t);
        }
        return new ArrayList<>(out);
    }

    static List<String> locales(JsonNode body) {
        JsonNode node = body == null ? null : body.get("locales");
        if (node == null || node.isNull()) {
            return CommerceNotificationTexts.LOCALES;
        }
        if (!node.isArray() || node.isEmpty()) {
            throw CommerceNotificationSettingsService.invalid("locales is a list of hi and en");
        }
        Set<String> out = new LinkedHashSet<>();
        for (JsonNode item : node) {
            String l = item != null && item.isTextual() ? item.asText().trim().toLowerCase(Locale.ROOT) : "";
            if (!CommerceNotificationTexts.LOCALES.contains(l)) {
                throw CommerceNotificationSettingsService.invalid("locales is a list of hi and en");
            }
            out.add(l);
        }
        return new ArrayList<>(out);
    }

    private static NotificationSettingsDtos.TemplateSubmitItem notSupported(CommerceNotificationTrigger trigger,
                                                                           String locale) {
        CommerceNotificationTexts.Positional positional = CommerceNotificationTexts.positional(
                CommerceNotificationTexts.of(trigger, locale).body());
        return NotificationSettingsDtos.TemplateSubmitItem.builder().trigger(trigger.name()).locale(locale)
                .templateName(trigger.templateName()).code(PROVIDER_NOT_SUPPORTED).text(positional.body())
                .variableNames(positional.names()).build();
    }

    private NotificationSettingsDtos.TemplateSubmitItem one(String instituteId, CustomUserDetails user,
                                                            CommerceNotificationTrigger trigger, String locale) {
        String name = trigger.templateName();
        NotificationSettingsDtos.TemplateSubmitItem.TemplateSubmitItemBuilder item =
                NotificationSettingsDtos.TemplateSubmitItem.builder().trigger(trigger.name()).locale(locale)
                        .templateName(name);
        try {
            JsonNode existing = client.getWhatsAppTemplateByName(instituteId, name, locale);
            if (existing != null && existing.hasNonNull("id")) {
                String status = existing.path("status").asText("").trim().toUpperCase(Locale.ROOT);
                return item.status(status.isEmpty() ? CommerceWhatsAppTemplateStatus.UNKNOWN : status).code(EXISTS)
                        .build();
            }
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY template {} ({}) of institute {} not read: {}", name, locale, instituteId,
                    e.getClass().getSimpleName());
            return item.status(CommerceWhatsAppTemplateStatus.UNKNOWN).code(PROVIDER_ERROR).build();
        }
        String id = null;
        try {
            JsonNode created = client.createWhatsAppTemplateDraft(draft(instituteId, user.getUserId(), trigger,
                    locale));
            id = created == null ? null : created.path("id").asText(null);
            if (id == null || id.isBlank()) {
                return item.status(CommerceWhatsAppTemplateStatus.UNKNOWN).code(PROVIDER_ERROR).build();
            }
            JsonNode submitted = client.submitWhatsAppTemplate(id);
            String status = submitted == null ? "" : submitted.path("status").asText("").trim()
                    .toUpperCase(Locale.ROOT);
            return item.status(status.isEmpty() ? "PENDING" : status).code(CREATED_AND_SUBMITTED).build();
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY template {} ({}) of institute {} not submitted: {}", name, locale, instituteId,
                    e.getClass().getSimpleName());
            return item.status(id == null ? CommerceWhatsAppTemplateStatus.UNKNOWN : "DRAFT").code(PROVIDER_ERROR)
                    .build();
        }
    }

    /** The draft of one default template, in the shape of notification_service's template DTO. */
    static Map<String, Object> draft(String instituteId, String userId, CommerceNotificationTrigger trigger,
                                     String locale) {
        CommerceNotificationTexts.Positional positional = CommerceNotificationTexts.positional(
                CommerceNotificationTexts.of(trigger, locale).body());
        List<String> samples = new ArrayList<>();
        for (String name : positional.names()) {
            samples.add(sample(name, locale));
        }
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("instituteId", instituteId);
        dto.put("name", trigger.templateName());
        dto.put("language", locale);
        dto.put("category", "UTILITY");
        dto.put("headerType", "NONE");
        dto.put("bodyText", positional.body());
        dto.put("bodyVariableNames", positional.names());
        dto.put("bodySampleValues", samples);
        dto.put("createdBy", userId);
        return dto;
    }

    /** Neutral sample values Meta reviews the template with. */
    static String sample(String variable, String locale) {
        return switch (variable) {
            case "customer_name" -> "Asha";
            case "shop_name" -> "Example Shop";
            case "order_number" -> "SH-000123";
            case "order_total", "refund_amount" -> "₹1,499";
            case "order_link" -> "https://shop.example.com/order#l=sample";
            case "courier" -> "India Post";
            case "tracking_number" -> "EZ123456789IN";
            case "amount_due" -> "₹0";
            case "cancel_reason" -> CommerceNotificationValues.cancelReason("STAFF_CANCELLED", locale);
            case "return_number" -> "R-000045";
            case "refund_method" -> "UPI";
            default -> "-";
        };
    }

    private void audit(String instituteId, CustomUserDetails user,
                       List<NotificationSettingsDtos.TemplateSubmitItem> items) {
        try {
            ObjectNode detail = objectMapper.createObjectNode();
            ObjectNode counts = detail.putObject("codes");
            for (NotificationSettingsDtos.TemplateSubmitItem i : items) {
                counts.put(i.getCode(), counts.path(i.getCode()).asInt(0) + 1);
            }
            detail.put("items", items.size());
            auditService.record(instituteId, user.getUserId(), null, "NOTIFY_TEMPLATES_SUBMITTED", "WHATSAPP_TEMPLATE",
                    null, null, objectMapper.writeValueAsString(detail), null);
        } catch (Exception e) {
            log.warn("Template request audit row not written: {}", e.getClass().getSimpleName());
        }
    }
}
