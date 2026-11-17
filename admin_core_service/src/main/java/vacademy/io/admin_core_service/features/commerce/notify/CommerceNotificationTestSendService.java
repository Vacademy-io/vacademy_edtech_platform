package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationSettingRepository;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.LongSupplier;

/**
 * A staff member's test message: one trigger in one language, sent at once to the caller's own
 * e-mail address and mobile number as auth_service has them (the body carries no recipient).
 * Fixed sample data, the shop's current texts, and the same request a real message makes. It
 * works while the trigger is off; WhatsApp goes only through an approved template. Nothing is
 * written but the audit row; no delivery row.
 */
@Slf4j
@Service
public class CommerceNotificationTestSendService {

    public static final String EMAIL = "EMAIL";
    public static final String WHATSAPP = "WHATSAPP";
    public static final String NO_TEST_CONTACT = "NO_TEST_CONTACT";
    static final String SCOPE_USER = "notify_test_user";
    static final String SCOPE_INSTITUTE = "notify_test_institute";
    static final Duration USER_WINDOW = Duration.ofHours(1);
    static final int USER_LIMIT = 5;
    static final Duration INSTITUTE_WINDOW = Duration.ofDays(1);
    static final int INSTITUTE_LIMIT = 30;
    private static final Set<String> BODY_KEYS = Set.of("trigger", "locale", "channels");

    private final CommerceSetupAccess setupAccess;
    private final CommerceRateLimiter rateLimiter;
    private final AuthService authService;
    private final CommerceNotificationSettingRepository settings;
    private final CommerceWhatsAppTemplateStatus templates;
    private final CommerceNotificationShopSettings shopSettings;
    private final CommerceNotificationStore store;
    private final CommerceNotificationMessages messages;
    private final NotificationService notificationService;
    private final CommerceAuditService auditService;
    private final ObjectMapper objectMapper;
    private LongSupplier clock = System::currentTimeMillis;

    public CommerceNotificationTestSendService(CommerceSetupAccess setupAccess, CommerceRateLimiter rateLimiter,
                                               AuthService authService,
                                               CommerceNotificationSettingRepository settings,
                                               CommerceWhatsAppTemplateStatus templates,
                                               CommerceNotificationShopSettings shopSettings,
                                               CommerceNotificationStore store,
                                               CommerceNotificationMessages messages,
                                               NotificationService notificationService,
                                               CommerceAuditService auditService, ObjectMapper objectMapper) {
        this.setupAccess = setupAccess;
        this.rateLimiter = rateLimiter;
        this.authService = authService;
        this.settings = settings;
        this.templates = templates;
        this.shopSettings = shopSettings;
        this.store = store;
        this.messages = messages;
        this.notificationService = notificationService;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
    }

    void setClock(LongSupplier clock) {
        this.clock = clock;
    }

    /** {@code POST /notification-settings/test-send}. */
    public NotificationSettingsDtos.TestSendAnswer send(CustomUserDetails user, String instituteId, JsonNode body) {
        setupAccess.require(user, instituteId, CommerceNotificationSettingsService.WRITE);
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("a test message is sent outside any transaction");
        }
        Request request = parse(body);

        if (!rateLimiter.allow(instituteId, SCOPE_USER, user.getUserId(), USER_WINDOW, USER_LIMIT)) {
            throw new CommerceNotifyRateLimitedException("at most " + USER_LIMIT + " test messages per hour",
                    CommerceRateLimiter.secondsToNextWindow(USER_WINDOW, clock.getAsLong()));
        }
        if (!rateLimiter.allow(instituteId, SCOPE_INSTITUTE, CommerceRateLimiter.ALL, INSTITUTE_WINDOW,
                INSTITUTE_LIMIT)) {
            throw new CommerceNotifyRateLimitedException("at most " + INSTITUTE_LIMIT
                    + " test messages per shop per day",
                    CommerceRateLimiter.secondsToNextWindow(INSTITUTE_WINDOW, clock.getAsLong()));
        }

        Contact contact = contact(user);
        boolean any = false;
        for (String channel : request.channels()) {
            any |= EMAIL.equals(channel) ? contact.email() != null : contact.phone() != null;
        }
        if (!any) {
            throw new VacademyException(HttpStatus.UNPROCESSABLE_ENTITY, NO_TEST_CONTACT
                    + ": your account has no usable e-mail address or mobile number for the channels asked");
        }

        CommerceNotificationSetting setting = settings.findByInstituteIdAndTriggerCode(instituteId,
                request.trigger().name()).orElse(null);
        CommerceNotificationShopSettings.Shop shop = shopSettings.read(instituteId);
        String linkBase = shopSettings.linkBase(instituteId, shop);
        CommerceNotificationMessages.Facts facts = sample(instituteId, request.locale(), shop, linkBase);

        List<NotificationSettingsDtos.TestSendResult> results = new ArrayList<>();
        for (String channel : request.channels()) {
            NotificationSettingsDtos.TestSendResult result = EMAIL.equals(channel)
                    ? email(instituteId, user, request, contact, facts, setting)
                    : whatsapp(instituteId, user, request, contact, facts, setting);
            results.add(result);
            audit(instituteId, user, request, result);
        }
        return NotificationSettingsDtos.TestSendAnswer.builder().results(results).build();
    }

    record Request(CommerceNotificationTrigger trigger, String locale, List<String> channels) {
    }

    /** The body: {@code trigger}, {@code locale}, {@code channels}; any other key is refused. */
    static Request parse(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw CommerceNotificationSettingsService.invalid("the body is a JSON object");
        }
        Iterator<String> names = body.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!BODY_KEYS.contains(name)) {
                throw CommerceNotificationSettingsService.invalid("unknown field; the body has trigger, locale "
                        + "and channels only (the message goes to your own contacts)");
            }
        }
        JsonNode t = body.get("trigger");
        CommerceNotificationTrigger trigger = t != null && t.isTextual() ? CommerceNotificationTrigger.of(t.asText())
                : null;
        if (trigger == null) {
            throw CommerceNotificationSettingsService.invalid("unknown trigger");
        }
        JsonNode l = body.get("locale");
        String locale = l != null && l.isTextual() ? l.asText().trim() : null;
        if (locale == null || !CommerceNotificationTexts.LOCALES.contains(locale)) {
            throw CommerceNotificationSettingsService.invalid("locale is hi or en");
        }
        List<String> channels = new ArrayList<>();
        JsonNode c = body.get("channels");
        if (c == null || c.isNull()) {
            channels.add(EMAIL);
            channels.add(WHATSAPP);
        } else {
            if (!c.isArray() || c.isEmpty()) {
                throw CommerceNotificationSettingsService.invalid("channels is a list of EMAIL and WHATSAPP");
            }
            Set<String> seen = new LinkedHashSet<>();
            for (JsonNode item : c) {
                String channel = item != null && item.isTextual() ? item.asText().trim().toUpperCase(Locale.ROOT)
                        : "";
                if (!EMAIL.equals(channel) && !WHATSAPP.equals(channel)) {
                    throw CommerceNotificationSettingsService.invalid("channels is a list of EMAIL and WHATSAPP");
                }
                seen.add(channel);
            }
            channels.addAll(seen);
        }
        return new Request(trigger, locale, List.copyOf(channels));
    }

    /** The caller's own contacts as auth_service has them; an address that cannot be written to is none. */
    record Contact(String email, String phone, String userId) {
    }

    private Contact contact(CustomUserDetails user) {
        List<UserDTO> users;
        try {
            users = authService.getUsersFromAuthServiceByUserIds(List.of(user.getUserId()));
        } catch (RuntimeException e) {
            log.warn("Test message: the caller's contacts could not be read: {}", e.getClass().getSimpleName());
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Your contact details could not be read right now. Try again in a minute.");
        }
        UserDTO me = null;
        if (users != null) {
            for (UserDTO u : users) {
                if (u != null && user.getUserId().equals(u.getId())) {
                    me = u;
                    break;
                }
            }
        }
        if (me == null) {
            return new Contact(null, null, user.getUserId());
        }
        String email = CommerceEmails.deliverable(me.getEmail()) ? me.getEmail().trim() : null;
        String phone = CommercePhones.normalise(me.getMobileNumber());
        return new Contact(email, phone, user.getUserId());
    }

    /** The fixed sample of a test message. */
    CommerceNotificationMessages.Facts sample(String instituteId, String locale,
                                              CommerceNotificationShopSettings.Shop shop, String linkBase) {
        boolean en = CommerceNotificationTexts.EN.equals(locale);
        String shopName = shop.shopName().get(locale);
        if (!StringUtils.hasText(shopName)) {
            try {
                shopName = store.instituteName(instituteId);
            } catch (RuntimeException e) {
                shopName = null;
            }
        }
        String total = CommerceNotificationValues.money(new BigDecimal("1499"), "INR");
        String link = linkBase == null ? null : linkBase + "/track-order";
        List<CommerceNotificationEmailRenderer.Item> items = List.of(new CommerceNotificationEmailRenderer.Item(
                en ? "Test item" : "परीक्षण सामान", null, "1", total));
        return new CommerceNotificationMessages.Facts(en ? "Test customer" : "परीक्षण ग्राहक", shopName, "TEST-0001",
                total, link, "Test courier", "TEST123", CommerceNotificationValues.money(BigDecimal.ZERO, "INR"),
                "STAFF_CANCELLED", "R-TEST", total, "UPI", null, null, items, total);
    }

    private NotificationSettingsDtos.TestSendResult email(String instituteId, CustomUserDetails user, Request r,
                                                          Contact contact, CommerceNotificationMessages.Facts facts,
                                                          CommerceNotificationSetting setting) {
        if (contact.email() == null) {
            return result(EMAIL, "SKIPPED", "NO_EMAIL", null);
        }
        String masked = CommerceMasks.email(contact.email());
        CommerceNotificationEmailRenderer.Email rendered = messages.email(r.trigger(), r.locale(), facts, setting);
        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId)
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder().email(contact.email())
                        .userId(contact.userId()).build()))
                .options(UnifiedSendRequest.SendOptions.builder().emailSubject(rendered.subject())
                        .emailBody(rendered.html()).emailType("UTILITY_EMAIL")
                        .source(CommerceNotificationDispatcher.SOURCE).sourceId(testSourceId()).build())
                .build();
        return call(EMAIL, request, masked);
    }

    private NotificationSettingsDtos.TestSendResult whatsapp(String instituteId, CustomUserDetails user, Request r,
                                                             Contact contact, CommerceNotificationMessages.Facts facts,
                                                             CommerceNotificationSetting setting) {
        if (contact.phone() == null) {
            return result(WHATSAPP, "SKIPPED", "NO_PHONE", null);
        }
        String masked = CommerceMasks.phone(contact.phone());
        String templateName = CommerceNotificationDispatcher.templateName(r.trigger(), setting);
        String status;
        try {
            status = templates.status(instituteId, templateName, r.locale());
        } catch (RuntimeException e) {
            status = CommerceWhatsAppTemplateStatus.UNKNOWN;
        }
        if (!CommerceWhatsAppTemplateStatus.APPROVED.equals(status)) {
            return result(WHATSAPP, "SKIPPED", "TEMPLATE_NOT_APPROVED", masked);
        }
        if (facts.link() == null) {
            return result(WHATSAPP, "SKIPPED", "NO_SHOP_URL", masked);
        }
        Map<String, String> variables = CommerceNotificationMessages.whatsappVariables(r.trigger(), r.locale(),
                facts);
        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(instituteId)
                .channel("WHATSAPP")
                .templateName(templateName)
                .languageCode(r.locale())
                .recipients(List.of(UnifiedSendRequest.Recipient.builder().phone(contact.phone())
                        .userId(contact.userId()).variables(variables).build()))
                .options(UnifiedSendRequest.SendOptions.builder().source(CommerceNotificationDispatcher.SOURCE)
                        .sourceId(testSourceId()).originType("COMMERCE").originName(r.trigger().name()).build())
                .build();
        return call(WHATSAPP, request, masked);
    }

    private static String testSourceId() {
        return "test-" + UUID.randomUUID();
    }

    private NotificationSettingsDtos.TestSendResult call(String channel, UnifiedSendRequest request, String masked) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("a test message is sent outside any transaction");
        }
        UnifiedSendResponse response;
        try {
            response = notificationService.sendUnified(request);
        } catch (RuntimeException e) {
            log.warn("Test message on {} failed: {}", channel, e.getClass().getSimpleName());
            return result(channel, "FAILED", "PLATFORM_ERROR", masked);
        }
        UnifiedSendResponse.RecipientResult first = response == null || response.getResults() == null
                || response.getResults().isEmpty() ? null : response.getResults().get(0);
        if (first == null) {
            return result(channel, "FAILED", "ANSWER_UNREADABLE", masked);
        }
        String status = first.getStatus() == null ? "" : first.getStatus().trim().toUpperCase(Locale.ROOT);
        return switch (status) {
            case "SENT" -> result(channel, "SENT", null, masked);
            case "QUEUED" -> result(channel, "SENT", "QUEUED_BY_PLATFORM", masked);
            case "SKIPPED_UNSUBSCRIBED" -> result(channel, "SKIPPED", "UNSUBSCRIBED", masked);
            case "BLOCKED_NO_CREDITS" -> result(channel, "FAILED", "NO_CREDITS", masked);
            case "FAILED" -> result(channel, "FAILED", "PROVIDER_REJECTED", masked);
            default -> first.isSuccess() ? result(channel, "SENT", null, masked)
                    : result(channel, "FAILED", "ANSWER_UNREADABLE", masked);
        };
    }

    private static NotificationSettingsDtos.TestSendResult result(String channel, String status, String code,
                                                                  String masked) {
        return NotificationSettingsDtos.TestSendResult.builder().channel(channel).status(status).code(code)
                .recipientMasked(masked).build();
    }

    private void audit(String instituteId, CustomUserDetails user, Request r,
                       NotificationSettingsDtos.TestSendResult result) {
        try {
            ObjectNode detail = objectMapper.createObjectNode();
            detail.put("trigger", r.trigger().name());
            detail.put("channel", result.getChannel());
            detail.put("locale", r.locale());
            detail.put("recipient_masked", result.getRecipientMasked());
            detail.put("status", result.getStatus());
            detail.put("code", result.getCode());
            auditService.record(instituteId, user.getUserId(), null, "NOTIFY_TEST_SENT", "NOTIFY_TRIGGER",
                    r.trigger().name(), null, objectMapper.writeValueAsString(detail), null);
        } catch (Exception e) {
            log.warn("Test message audit row not written: {}", e.getClass().getSimpleName());
        }
    }
}
