package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationSettingRepository;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;

/**
 * The buyer-message settings of a shop: per trigger (on/off, channels, another WhatsApp template,
 * the email texts per language) and shop-wide (the order-link address, how long a link works,
 * the shop's name in the messages).
 *
 * <p>A trigger is saved with a version check: the client sends the version it read; a missing
 * row is version 0 and is inserted as version 1; any other mismatch is 409
 * {@code SETTING_VERSION_CONFLICT}. The shop-wide values are written only through
 * {@link CommerceCheckoutSettingsService#updateNotifications}, the one writer of
 * {@code COMMERCE_SETTING}. The audit row of a change names the keys that changed, never a text.
 */
@Slf4j
@Service
public class CommerceNotificationSettingsService {

    public static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    public static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    public static final String VERSION_CONFLICT = "SETTING_VERSION_CONFLICT";
    public static final String LINK_BASE_NOT_VERIFIED = "LINK_BASE_NOT_VERIFIED";
    public static final int MAX_SUBJECT = 150;
    public static final int MAX_BODY = 2000;
    private static final String TEMPLATE_NAME = "[a-z0-9_]{1,100}";

    private final CommerceSetupAccess setupAccess;
    private final CommerceNotificationSettingRepository settings;
    private final JdbcTemplate jdbc;
    private final CommerceWhatsAppTemplateStatus templates;
    private final ObjectProvider<WorkflowTriggerService> workflows;
    private final CommerceNotificationShopSettings shopSettings;
    private final CommerceStorefrontSettings storefrontSettings;
    private final CommerceOrderLinkTokens linkTokens;
    private final CommerceNotificationDispatcher dispatcher;
    private final CommerceCheckoutSettingsService checkoutSettings;
    private final CommerceAuditService auditService;
    private final CommerceNotificationStore store;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transaction;

    public CommerceNotificationSettingsService(CommerceSetupAccess setupAccess,
                                               CommerceNotificationSettingRepository settings,
                                               JdbcTemplate jdbc,
                                               CommerceWhatsAppTemplateStatus templates,
                                               ObjectProvider<WorkflowTriggerService> workflows,
                                               CommerceNotificationShopSettings shopSettings,
                                               CommerceStorefrontSettings storefrontSettings,
                                               CommerceOrderLinkTokens linkTokens,
                                               CommerceNotificationDispatcher dispatcher,
                                               CommerceCheckoutSettingsService checkoutSettings,
                                               CommerceAuditService auditService,
                                               CommerceNotificationStore store,
                                               ObjectMapper objectMapper,
                                               PlatformTransactionManager transactionManager) {
        this.setupAccess = setupAccess;
        this.settings = settings;
        this.jdbc = jdbc;
        this.templates = templates;
        this.workflows = workflows;
        this.shopSettings = shopSettings;
        this.storefrontSettings = storefrontSettings;
        this.linkTokens = linkTokens;
        this.dispatcher = dispatcher;
        this.checkoutSettings = checkoutSettings;
        this.auditService = auditService;
        this.store = store;
        this.objectMapper = objectMapper;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    // ================================================================== read

    /** {@code GET /notification-settings}: the shop block and the nine triggers in their fixed order. */
    public NotificationSettingsDtos.SettingsView get(CustomUserDetails user, String instituteId) {
        setupAccess.require(user, instituteId, READ);
        Map<String, CommerceNotificationSetting> rows = new LinkedHashMap<>();
        for (CommerceNotificationSetting row : settings.findByInstituteId(instituteId)) {
            rows.put(row.getTriggerCode(), row);
        }
        List<NotificationSettingsDtos.TriggerView> triggers = new ArrayList<>();
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            triggers.add(triggerView(instituteId, trigger, rows.get(trigger.name())));
        }
        return NotificationSettingsDtos.SettingsView.builder().shop(shopView(instituteId)).triggers(triggers).build();
    }

    /** The placeholders a text of the trigger may use: its message variables, then its email-only ones. */
    public static List<String> variables(CommerceNotificationTrigger trigger) {
        List<String> out = new ArrayList<>(trigger.variables());
        out.addAll(trigger.emailOnly());
        return out;
    }

    NotificationSettingsDtos.TriggerView triggerView(String instituteId, CommerceNotificationTrigger trigger,
                                                     CommerceNotificationSetting row) {
        CommerceNotificationSetting s = row == null ? defaults(instituteId, trigger) : row;
        String templateName = CommerceNotificationDispatcher.templateName(trigger, s);
        Map<String, String> status = new LinkedHashMap<>();
        Map<String, String> text = new LinkedHashMap<>();
        Map<String, String> subject = new LinkedHashMap<>();
        Map<String, String> body = new LinkedHashMap<>();
        Map<String, Boolean> overridden = new LinkedHashMap<>();
        for (String locale : CommerceNotificationTexts.LOCALES) {
            CommerceNotificationTexts.Text defaults = CommerceNotificationTexts.of(trigger, locale);
            status.put(locale, templateStatus(instituteId, templateName, locale));
            text.put(locale, defaults.body());
            subject.put(locale, s.subject(locale) != null ? s.subject(locale) : defaults.subject());
            body.put(locale, s.body(locale) != null ? s.body(locale) : defaults.body());
            overridden.put(locale, s.subject(locale) != null || s.body(locale) != null);
        }
        return NotificationSettingsDtos.TriggerView.builder()
                .trigger(trigger.name())
                .enabled(!Boolean.FALSE.equals(s.getEnabled()))
                .emailEnabled(!Boolean.FALSE.equals(s.getEmailEnabled()))
                .whatsappEnabled(!Boolean.FALSE.equals(s.getWhatsappEnabled()))
                .handledByWorkflow(handledByWorkflow(instituteId, trigger))
                .version(s.getVersion() == null ? 0 : s.getVersion())
                .variables(variables(trigger))
                .whatsapp(NotificationSettingsDtos.WhatsAppView.builder().templateName(templateName)
                        .defaultTemplateName(trigger.templateName()).status(status).text(text).build())
                .email(NotificationSettingsDtos.EmailView.builder().subject(subject).body(body)
                        .overridden(overridden).build())
                .build();
    }

    private String templateStatus(String instituteId, String name, String locale) {
        try {
            return templates.status(instituteId, name, locale);
        } catch (RuntimeException e) {
            return CommerceWhatsAppTemplateStatus.UNKNOWN;
        }
    }

    private boolean handledByWorkflow(String instituteId, CommerceNotificationTrigger trigger) {
        try {
            WorkflowTriggerService engine = workflows == null ? null : workflows.getIfAvailable();
            return engine != null && engine.hasActiveWorkflow(trigger.name(), null, instituteId);
        } catch (RuntimeException e) {
            log.warn("Workflow lookup for trigger {} of institute {} failed: {}", trigger, instituteId,
                    e.getClass().getSimpleName());
            return false;
        }
    }

    private static CommerceNotificationSetting defaults(String instituteId, CommerceNotificationTrigger trigger) {
        CommerceNotificationSetting s = new CommerceNotificationSetting();
        s.setInstituteId(instituteId);
        s.setTriggerCode(trigger.name());
        s.setVersion(0);
        return s;
    }

    NotificationSettingsDtos.ShopView shopView(String instituteId) {
        CommerceNotificationShopSettings.Shop shop = shopSettings.read(instituteId);
        String base = null;
        try {
            base = storefrontSettings.read(instituteId).baseLocale();
        } catch (RuntimeException e) {
            base = null;
        }
        String instituteName = null;
        try {
            instituteName = store.instituteName(instituteId);
        } catch (RuntimeException e) {
            instituteName = null;
        }
        return NotificationSettingsDtos.ShopView.builder()
                .linkBaseUrl(shop.linkBaseUrl())
                .linkBaseCandidates(shopSettings.candidates(instituteId))
                .linkDays(shop.linkDays())
                .shopName(new LinkedHashMap<>(shop.shopName()))
                .shopNameDefault(instituteName)
                .baseLocale(CommerceNotificationValues.messageLocale(null, base))
                .linkSecretConfigured(linkTokens.isConfigured())
                .sendingEnabled(dispatcher.enabled())
                .build();
    }

    // ================================================================== PUT trigger

    /** {@code PUT /notification-settings/triggers/{trigger}}. */
    public NotificationSettingsDtos.TriggerView updateTrigger(CustomUserDetails user, String instituteId,
                                                              String triggerCode, JsonNode body) {
        setupAccess.require(user, instituteId, WRITE);
        CommerceNotificationTrigger trigger = CommerceNotificationTrigger.of(triggerCode);
        if (trigger == null) {
            throw invalid("unknown trigger");
        }
        if (body == null || !body.isObject()) {
            throw invalid("the body is a JSON object");
        }
        JsonNode versionNode = body.get("version");
        if (versionNode == null || !versionNode.isIntegralNumber() || versionNode.asLong() < 0
                || versionNode.asLong() > Integer.MAX_VALUE) {
            throw invalid("version is required: the version of the setting you read (0 when it was never changed)");
        }
        int version = versionNode.asInt();

        CommerceNotificationSetting current = settings.findByInstituteIdAndTriggerCode(instituteId, trigger.name())
                .orElse(null);
        int currentVersion = current == null || current.getVersion() == null ? 0 : current.getVersion();
        if (currentVersion != version) {
            throw conflict();
        }
        CommerceNotificationSetting before = current == null ? defaults(instituteId, trigger) : copy(current);
        CommerceNotificationSetting after = copy(before);

        if (body.has("enabled")) {
            after.setEnabled(bool(body.get("enabled"), "enabled"));
        }
        if (body.has("email_enabled")) {
            after.setEmailEnabled(bool(body.get("email_enabled"), "email_enabled"));
        }
        if (body.has("whatsapp_enabled")) {
            after.setWhatsappEnabled(bool(body.get("whatsapp_enabled"), "whatsapp_enabled"));
        }
        if (body.has("whatsapp_template_name")) {
            after.setWhatsappTemplateName(templateName(instituteId, trigger, body.get("whatsapp_template_name")));
        }
        if (body.has("email")) {
            applyEmail(trigger, body.get("email"), after);
        }

        List<String> changed = changedKeys(before, after);
        int written = transaction.execute(status -> {
            Integer v = write(instituteId, trigger, version, after, user.getUserId());
            if (v == null) {
                throw conflict();
            }
            auditService.record(instituteId, user.getUserId(), null, "NOTIFY_SETTING_CHANGED", "NOTIFY_TRIGGER",
                    trigger.name(), null, auditJson(trigger.name(), changed), null);
            return v;
        });
        after.setVersion(written);
        return triggerView(instituteId, trigger, after);
    }

    private static VacademyException conflict() {
        return new VacademyException(HttpStatus.CONFLICT, VERSION_CONFLICT
                + ": the setting was changed by someone else; read it again");
    }

    static InvalidRequestException invalid(String message) {
        return new InvalidRequestException("invalid_request: " + message);
    }

    private static Boolean bool(JsonNode node, String field) {
        if (node == null || !node.isBoolean()) {
            throw invalid(field + " is true or false");
        }
        return node.asBoolean();
    }

    /**
     * The template name to store: null for the default (or a reset); refused when it asks for a variable the
     * trigger lacks, or when it is not a UTILITY template (order messages are transactional).
     */
    private String templateName(String instituteId, CommerceNotificationTrigger trigger, JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isTextual()) {
            throw invalid("whatsapp_template_name is text");
        }
        String name = node.asText().trim();
        if (name.isEmpty() || name.equals(trigger.templateName())) {
            return null;
        }
        if (!name.matches(TEMPLATE_NAME)) {
            throw invalid("whatsapp_template_name is lower-case letters, digits and _ (at most 100)");
        }
        for (String locale : CommerceNotificationTexts.LOCALES) {
            CommerceWhatsAppTemplateStatus.Template template;
            try {
                template = templates.read(instituteId, name, locale);
            } catch (RuntimeException e) {
                // Not readable now: accepted; the test send shows the problem.
                continue;
            }
            List<String> names = template == null ? null : template.bodyVariableNames();
            if (names != null && !trigger.variables().containsAll(names)) {
                throw invalid("the template " + name + " (" + locale + ") asks for a variable this trigger does "
                        + "not have; allowed: " + String.join(", ", trigger.variables()));
            }
            String category = template == null ? null : template.category();
            if (category != null && !CommerceWhatsAppTemplateStatus.isUtility(category)) {
                throw invalid("the template " + name + " (" + locale + ") is of the category " + category
                        + "; order messages use UTILITY templates only");
            }
        }
        return name;
    }

    private void applyEmail(CommerceNotificationTrigger trigger, JsonNode email, CommerceNotificationSetting s) {
        if (email == null || email.isNull()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                setEmail(s, locale, null, null);
            }
            return;
        }
        if (!email.isObject()) {
            throw invalid("email is a JSON object with the keys hi and en");
        }
        Iterator<Map.Entry<String, JsonNode>> fields = email.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            String locale = field.getKey();
            if (!CommerceNotificationTexts.LOCALES.contains(locale)) {
                throw invalid("unknown locale " + clip(locale) + "; email has the keys hi and en");
            }
            JsonNode value = field.getValue();
            if (value == null || value.isNull()) {
                setEmail(s, locale, null, null);
                continue;
            }
            if (!value.isObject()) {
                throw invalid("email." + locale + " is null or an object with subject and body");
            }
            Iterator<String> keys = value.fieldNames();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!"subject".equals(key) && !"body".equals(key)) {
                    throw invalid("email." + locale + " has the keys subject and body");
                }
            }
            String subject = s.subject(locale);
            String body = s.body(locale);
            if (value.has("subject")) {
                subject = emailText(trigger, value.get("subject"), "email." + locale + ".subject", true);
            }
            if (value.has("body")) {
                body = emailText(trigger, value.get("body"), "email." + locale + ".body", false);
            }
            setEmail(s, locale, subject, body);
        }
    }

    private static void setEmail(CommerceNotificationSetting s, String locale, String subject, String body) {
        if (CommerceNotificationTexts.EN.equals(locale)) {
            s.setEmailSubjectEn(subject);
            s.setEmailBodyEn(body);
        } else {
            s.setEmailSubjectHi(subject);
            s.setEmailBodyHi(body);
        }
    }

    /** A staff text as stored: control characters removed (a body keeps its line breaks), checked; null resets. */
    static String emailText(CommerceNotificationTrigger trigger, JsonNode node, String field, boolean subject) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isTextual()) {
            throw invalid(field + " is text");
        }
        String text = withoutControls(node.asText(), subject).trim();
        if (text.isEmpty()) {
            return null;
        }
        int max = subject ? MAX_SUBJECT : MAX_BODY;
        if (text.codePointCount(0, text.length()) > max) {
            throw invalid(field + " is at most " + max + " characters");
        }
        Set<String> allowed = new LinkedHashSet<>(variables(trigger));
        Matcher m = CommerceNotificationTexts.PLACEHOLDER.matcher(text);
        while (m.find()) {
            if (!allowed.contains(m.group(1))) {
                throw invalid(field + " uses an unknown placeholder {{" + clip(m.group(1)) + "}}; allowed: "
                        + String.join(", ", allowed));
            }
        }
        String rest = CommerceNotificationTexts.PLACEHOLDER.matcher(text).replaceAll("");
        if (rest.contains("{{") || rest.contains("}}")) {
            throw invalid(field + " has a {{ or }} that is not a placeholder");
        }
        return text;
    }

    /** Every control character removed, except a line feed in a body; a subject's line breaks become spaces. */
    static String withoutControls(String raw, boolean oneLine) {
        StringBuilder out = new StringBuilder(raw.length());
        raw.codePoints().forEach(cp -> {
            if (cp == '\n') {
                out.append(oneLine ? " " : "\n");
            } else if (cp == '\r' && oneLine) {
                out.append(' ');
            } else if (Character.getType(cp) != Character.CONTROL) {
                out.appendCodePoint(cp);
            }
        });
        return out.toString();
    }

    private static String clip(String value) {
        if (value == null) {
            return "";
        }
        return value.length() > 40 ? value.substring(0, 40) : value;
    }

    static List<String> changedKeys(CommerceNotificationSetting a, CommerceNotificationSetting b) {
        List<String> out = new ArrayList<>();
        if (!Objects.equals(on(a.getEnabled()), on(b.getEnabled()))) {
            out.add("enabled");
        }
        if (!Objects.equals(on(a.getEmailEnabled()), on(b.getEmailEnabled()))) {
            out.add("email_enabled");
        }
        if (!Objects.equals(on(a.getWhatsappEnabled()), on(b.getWhatsappEnabled()))) {
            out.add("whatsapp_enabled");
        }
        if (!Objects.equals(a.getWhatsappTemplateName(), b.getWhatsappTemplateName())) {
            out.add("whatsapp_template_name");
        }
        for (String locale : CommerceNotificationTexts.LOCALES) {
            if (!Objects.equals(a.subject(locale), b.subject(locale))) {
                out.add("email." + locale + ".subject");
            }
            if (!Objects.equals(a.body(locale), b.body(locale))) {
                out.add("email." + locale + ".body");
            }
        }
        return out;
    }

    private static boolean on(Boolean value) {
        return !Boolean.FALSE.equals(value);
    }

    private static CommerceNotificationSetting copy(CommerceNotificationSetting s) {
        CommerceNotificationSetting c = new CommerceNotificationSetting();
        c.setInstituteId(s.getInstituteId());
        c.setTriggerCode(s.getTriggerCode());
        c.setEnabled(on(s.getEnabled()));
        c.setEmailEnabled(on(s.getEmailEnabled()));
        c.setWhatsappEnabled(on(s.getWhatsappEnabled()));
        c.setWhatsappTemplateName(s.getWhatsappTemplateName());
        c.setEmailSubjectHi(s.getEmailSubjectHi());
        c.setEmailBodyHi(s.getEmailBodyHi());
        c.setEmailSubjectEn(s.getEmailSubjectEn());
        c.setEmailBodyEn(s.getEmailBodyEn());
        c.setVersion(s.getVersion() == null ? 0 : s.getVersion());
        c.setUpdatedBy(s.getUpdatedBy());
        c.setUpdatedAt(s.getUpdatedAt());
        return c;
    }

    static final String UPSERT = "INSERT INTO commerce_notification_setting (institute_id, trigger_code, enabled, "
            + "email_enabled, whatsapp_enabled, whatsapp_template_name, email_subject_hi, email_body_hi, "
            + "email_subject_en, email_body_en, version, updated_by, updated_at) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, now()) "
            + "ON CONFLICT (institute_id, trigger_code) DO UPDATE SET enabled = EXCLUDED.enabled, "
            + "email_enabled = EXCLUDED.email_enabled, whatsapp_enabled = EXCLUDED.whatsapp_enabled, "
            + "whatsapp_template_name = EXCLUDED.whatsapp_template_name, "
            + "email_subject_hi = EXCLUDED.email_subject_hi, email_body_hi = EXCLUDED.email_body_hi, "
            + "email_subject_en = EXCLUDED.email_subject_en, email_body_en = EXCLUDED.email_body_en, "
            + "version = commerce_notification_setting.version + 1, updated_by = EXCLUDED.updated_by, "
            + "updated_at = now() WHERE commerce_notification_setting.version = ? RETURNING version";

    static final String UPDATE = "UPDATE commerce_notification_setting SET enabled = ?, email_enabled = ?, "
            + "whatsapp_enabled = ?, whatsapp_template_name = ?, email_subject_hi = ?, email_body_hi = ?, "
            + "email_subject_en = ?, email_body_en = ?, version = version + 1, updated_by = ?, updated_at = now() "
            + "WHERE institute_id = ? AND trigger_code = ? AND version = ? RETURNING version";

    /**
     * The version-checked write. Version 0: insert (as version 1), or update a row still at 0;
     * any other version: update only the row at that version (never an insert). The new
     * version, or null when nothing matched (409).
     */
    Integer write(String instituteId, CommerceNotificationTrigger trigger, int expected,
                  CommerceNotificationSetting s, String userId) {
        List<Integer> rows;
        if (expected == 0) {
            rows = jdbc.queryForList(UPSERT, Integer.class, instituteId, trigger.name(), on(s.getEnabled()),
                    on(s.getEmailEnabled()), on(s.getWhatsappEnabled()), s.getWhatsappTemplateName(),
                    s.getEmailSubjectHi(), s.getEmailBodyHi(), s.getEmailSubjectEn(), s.getEmailBodyEn(), userId,
                    expected);
        } else {
            rows = jdbc.queryForList(UPDATE, Integer.class, on(s.getEnabled()), on(s.getEmailEnabled()),
                    on(s.getWhatsappEnabled()), s.getWhatsappTemplateName(), s.getEmailSubjectHi(),
                    s.getEmailBodyHi(), s.getEmailSubjectEn(), s.getEmailBodyEn(), userId, instituteId,
                    trigger.name(), expected);
        }
        return rows == null || rows.isEmpty() ? null : rows.get(0);
    }

    private String auditJson(String subject, List<String> changed) {
        ObjectNode node = objectMapper.createObjectNode();
        if (subject != null) {
            node.put("trigger", subject);
        }
        node.putPOJO("changed", changed);
        try {
            return objectMapper.writeValueAsString(node);
        } catch (Exception e) {
            return "{}";
        }
    }

    // ================================================================== PUT shop

    /** {@code PUT /notification-settings/shop}: keys optional; null resets a key. */
    public NotificationSettingsDtos.ShopView updateShop(CustomUserDetails user, String instituteId, JsonNode body) {
        setupAccess.require(user, instituteId, WRITE);
        if (body == null || !body.isObject()) {
            throw invalid("the body is a JSON object");
        }
        ObjectNode patch = objectMapper.createObjectNode();
        if (body.has("link_base_url")) {
            JsonNode node = body.get("link_base_url");
            if (node == null || node.isNull()) {
                patch.putNull("linkBaseUrl");
            } else if (!node.isTextual()) {
                throw invalid("link_base_url is an https address or null");
            } else {
                String base;
                try {
                    base = CommerceNotificationShopSettings.shape(node.asText());
                } catch (IllegalArgumentException e) {
                    throw invalid(e.getMessage());
                }
                if (!shopSettings.verified(instituteId, base)) {
                    throw new InvalidRequestException(LINK_BASE_NOT_VERIFIED
                            + ": the address is not on a verified website of this institute");
                }
                patch.put("linkBaseUrl", base);
            }
        }
        if (body.has("link_days")) {
            JsonNode node = body.get("link_days");
            if (node == null || node.isNull()) {
                patch.putNull("linkDays");
            } else if (!node.isIntegralNumber() || node.asLong() < CommerceNotificationShopSettings.MIN_LINK_DAYS
                    || node.asLong() > CommerceNotificationShopSettings.MAX_LINK_DAYS) {
                throw invalid("link_days is a whole number from " + CommerceNotificationShopSettings.MIN_LINK_DAYS
                        + " to " + CommerceNotificationShopSettings.MAX_LINK_DAYS);
            } else {
                patch.put("linkDays", node.asInt());
            }
        }
        if (body.has("shop_name")) {
            JsonNode node = body.get("shop_name");
            ObjectNode names = patch.putObject("shopName");
            if (node == null || node.isNull()) {
                for (String locale : CommerceNotificationTexts.LOCALES) {
                    names.putNull(locale);
                }
            } else if (!node.isObject()) {
                throw invalid("shop_name is an object with the keys hi and en");
            } else {
                Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    if (!CommerceNotificationTexts.LOCALES.contains(field.getKey())) {
                        throw invalid("unknown locale " + clip(field.getKey()) + "; shop_name has the keys hi and en");
                    }
                    names.set(field.getKey(), shopName(field.getValue(), "shop_name." + field.getKey()));
                }
            }
        }
        if (patch.isEmpty()) {
            return shopView(instituteId);
        }
        CommerceNotificationShopSettings.Shop before = shopSettings.read(instituteId);
        transaction.execute(status -> {
            JsonNode written = checkoutSettings.updateNotifications(instituteId, user.getUserId(), patch);
            CommerceNotificationShopSettings.Shop after = CommerceNotificationShopSettings.parse(written);
            auditService.record(instituteId, user.getUserId(), null, "NOTIFY_SHOP_CHANGED", "COMMERCE_SETTING",
                    CommerceNotificationShopSettings.KEY, null, auditJson(null, changedShopKeys(before, after)), null);
            return null;
        });
        return shopView(instituteId);
    }

    private JsonNode shopName(JsonNode value, String field) {
        if (value == null || value.isNull()) {
            return objectMapper.nullNode();
        }
        if (!value.isTextual()) {
            throw invalid(field + " is text or null");
        }
        String name = value.asText();
        for (int i = 0; i < name.length(); i++) {
            if (Character.getType(name.charAt(i)) == Character.CONTROL) {
                throw invalid(field + " is one line of text");
            }
        }
        name = name.trim();
        if (name.isEmpty()) {
            return objectMapper.nullNode();
        }
        if (name.codePointCount(0, name.length()) > CommerceNotificationShopSettings.MAX_SHOP_NAME) {
            throw invalid(field + " is at most " + CommerceNotificationShopSettings.MAX_SHOP_NAME + " characters");
        }
        return objectMapper.getNodeFactory().textNode(name);
    }

    static List<String> changedShopKeys(CommerceNotificationShopSettings.Shop a, CommerceNotificationShopSettings.Shop b) {
        List<String> out = new ArrayList<>();
        if (!Objects.equals(a.linkBaseUrl(), b.linkBaseUrl())) {
            out.add("link_base_url");
        }
        if (a.linkDays() != b.linkDays()) {
            out.add("link_days");
        }
        for (String locale : CommerceNotificationTexts.LOCALES) {
            if (!Objects.equals(a.shopName().get(locale), b.shopName().get(locale))) {
                out.add("shop_name." + locale);
            }
        }
        return out;
    }
}
