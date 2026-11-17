package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.catalog_api.website.InstituteWebsiteService;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationSettingRepository;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The settings of the buyer messages: the GET shape, the validation table, the version check,
 * resets per language, audit rows with key names only, the link-base host rule and the one
 * writer of {@code COMMERCE_SETTING} keeping every other key.
 */
@SuppressWarnings("unchecked")
class CommerceNotificationSettingsServiceTest {

    private static final String INST = "inst-1";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String STORED = """
            {"setting": {
               "COMMERCE_SETTING": {"key": "COMMERCE_SETTING", "name": "Commerce", "data": {
                  "holdMinutes": 20, "baseLocale": "hi", "botCheck": {"enabled": true},
                  "cod": {"enabled": false, "maxOrderValue": 4000, "blockedPincodes": ["190001"]},
                  "returns": {"windowDays": 7},
                  "notifications": {"linkDays": 10, "shopName": {"hi": "Old name", "en": null}, "other": 1}}},
               "NAMING_SETTING": {"key": "NAMING_SETTING", "data": {"x": 1}}}}
            """;

    private CommerceSetupAccess setupAccess;
    private CommerceNotificationSettingRepository repository;
    private JdbcTemplate jdbc;
    private CommerceWhatsAppTemplateStatus templates;
    private WorkflowTriggerService workflowService;
    private InstituteWebsiteService websites;
    private InstituteSettingService instituteSettings;
    private CommerceNotificationShopSettings shopSettings;
    private CommerceStorefrontSettings storefront;
    private CommerceOrderLinkTokens linkTokens;
    private CommerceNotificationDispatcher dispatcher;
    private InstituteRepository instituteRepository;
    private InstituteSettingWriter settingWriter;
    private CommerceAuditService audit;
    private CommerceNotificationStore store;
    private Institute institute;
    private CommerceNotificationSettingsService service;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        setupAccess = mock(CommerceSetupAccess.class);
        repository = mock(CommerceNotificationSettingRepository.class);
        when(repository.findByInstituteId(INST)).thenReturn(List.of());
        when(repository.findByInstituteIdAndTriggerCode(eq(INST), anyString())).thenReturn(Optional.empty());
        jdbc = mock(JdbcTemplate.class);
        templates = mock(CommerceWhatsAppTemplateStatus.class);
        when(templates.status(eq(INST), anyString(), anyString())).thenReturn(CommerceWhatsAppTemplateStatus.MISSING);
        when(templates.read(eq(INST), anyString(), anyString())).thenReturn(
                new CommerceWhatsAppTemplateStatus.Template(CommerceWhatsAppTemplateStatus.MISSING, null, null));
        workflowService = mock(WorkflowTriggerService.class);
        ObjectProvider<WorkflowTriggerService> workflows = mock(ObjectProvider.class);
        when(workflows.getIfAvailable()).thenReturn(workflowService);
        websites = mock(InstituteWebsiteService.class);
        when(websites.verifiedHosts(INST)).thenReturn(Set.of("shop.example.com"));
        instituteSettings = mock(InstituteSettingService.class);
        shopSettings = new CommerceNotificationShopSettings(instituteSettings, websites, JSON);
        storefront = mock(CommerceStorefrontSettings.class);
        when(storefront.read(INST)).thenReturn(StorefrontSettings.parse(JSON.createObjectNode().put("baseLocale", "en")));
        linkTokens = mock(CommerceOrderLinkTokens.class);
        when(linkTokens.isConfigured()).thenReturn(true);
        dispatcher = mock(CommerceNotificationDispatcher.class);
        when(dispatcher.enabled()).thenReturn(true);
        instituteRepository = mock(InstituteRepository.class);
        settingWriter = mock(InstituteSettingWriter.class);
        institute = new Institute();
        institute.setId(INST);
        institute.setSetting(STORED);
        when(instituteRepository.findByIdForUpdate(INST)).thenReturn(Optional.of(institute));
        CommerceCheckoutSettingsService checkoutSettings = new CommerceCheckoutSettingsService(instituteRepository,
                settingWriter, storefront);
        audit = mock(CommerceAuditService.class);
        store = mock(CommerceNotificationStore.class);
        when(store.instituteName(INST)).thenReturn("Example Shop");
        service = new CommerceNotificationSettingsService(setupAccess, repository, jdbc, templates, workflows,
                shopSettings, storefront, linkTokens, dispatcher, checkoutSettings, audit, store, JSON,
                mock(PlatformTransactionManager.class));
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("staff-1");
    }

    private static JsonNode body(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static CommerceNotificationSetting row(String trigger, int version) {
        CommerceNotificationSetting s = new CommerceNotificationSetting();
        s.setInstituteId(INST);
        s.setTriggerCode(trigger);
        s.setVersion(version);
        return s;
    }

    private void stored(CommerceNotificationSetting s) {
        when(repository.findByInstituteIdAndTriggerCode(INST, s.getTriggerCode())).thenReturn(Optional.of(s));
    }

    /** The bind values of the one write made with {@code sql}. */
    private Object[] writeArgs(String sql) {
        List<Object[]> found = new ArrayList<>();
        for (org.mockito.invocation.Invocation call : org.mockito.Mockito.mockingDetails(jdbc).getInvocations()) {
            if ("queryForList".equals(call.getMethod().getName()) && sql.equals(call.getRawArguments()[0])) {
                found.add((Object[]) call.getRawArguments()[2]);
            }
        }
        assertEquals(1, found.size(), "one write");
        return found.get(0);
    }

    // ================================================================== GET

    @Test
    void getAnswersNineTriggersInTheirOrderWithDefaultsAndTheShopBlock() {
        when(templates.status(INST, "commerce_order_confirmed", "hi")).thenReturn("APPROVED");
        when(workflowService.hasActiveWorkflow("ORDER_SHIPPED", null, INST)).thenReturn(true);
        when(workflowService.hasActiveWorkflow("ORDER_RTO", null, INST)).thenThrow(new IllegalStateException("x"));

        NotificationSettingsDtos.SettingsView view = service.get(user, INST);

        verify(setupAccess).require(user, INST, CommerceNotificationSettingsService.READ);
        assertEquals(List.of("ORDER_CONFIRMED", "COD_CONFIRMATION_NEEDED", "ORDER_SHIPPED", "ORDER_DELIVERED",
                        "ORDER_CANCELLED", "ORDER_RTO", "RETURN_APPROVED", "REFUND_PROCESSED", "POS_BILL_ISSUED"),
                view.getTriggers().stream().map(NotificationSettingsDtos.TriggerView::getTrigger).toList());
        NotificationSettingsDtos.TriggerView first = view.getTriggers().get(0);
        assertEquals(0, first.getVersion());
        assertTrue(first.getEnabled() && first.getEmailEnabled() && first.getWhatsappEnabled());
        assertEquals(List.of("customer_name", "shop_name", "order_number", "order_total", "order_link"),
                first.getVariables());
        assertEquals("commerce_order_confirmed", first.getWhatsapp().getTemplateName());
        assertEquals("APPROVED", first.getWhatsapp().getStatus().get("hi"));
        assertEquals("MISSING", first.getWhatsapp().getStatus().get("en"));
        assertEquals(CommerceNotificationTexts.of(CommerceNotificationTrigger.ORDER_CONFIRMED, "en").subject(),
                first.getEmail().getSubject().get("en"));
        assertFalse(first.getEmail().getOverridden().get("hi"));
        assertTrue(view.getTriggers().get(2).getHandledByWorkflow());
        assertFalse(view.getTriggers().get(5).getHandledByWorkflow(), "a lookup error reads as no workflow");
        assertEquals(List.of("customer_name", "shop_name", "order_number", "order_link", "return_days"),
                view.getTriggers().get(3).getVariables());

        NotificationSettingsDtos.ShopView shop = view.getShop();
        assertNull(shop.getLinkBaseUrl());
        assertEquals(List.of("https://shop.example.com"), shop.getLinkBaseCandidates());
        assertEquals(14, shop.getLinkDays());
        assertEquals("Example Shop", shop.getShopNameDefault());
        assertEquals("en", shop.getBaseLocale());
        assertTrue(shop.getLinkSecretConfigured());
        assertTrue(shop.getSendingEnabled());
    }

    @Test
    void anOverriddenLanguageShowsTheShopTextAndItsFlag() {
        CommerceNotificationSetting s = row("ORDER_SHIPPED", 4);
        s.setEmailSubjectEn("Your parcel {{order_number}}");
        s.setWhatsappTemplateName("shop_shipped_v2");
        when(repository.findByInstituteId(INST)).thenReturn(List.of(s));

        NotificationSettingsDtos.TriggerView shipped = service.get(user, INST).getTriggers().get(2);

        assertEquals(4, shipped.getVersion());
        assertEquals("Your parcel {{order_number}}", shipped.getEmail().getSubject().get("en"));
        assertTrue(shipped.getEmail().getOverridden().get("en"));
        assertFalse(shipped.getEmail().getOverridden().get("hi"));
        assertEquals("shop_shipped_v2", shipped.getWhatsapp().getTemplateName());
        assertEquals("commerce_order_shipped", shipped.getWhatsapp().getDefaultTemplateName());
    }

    // ================================================================== PUT trigger: validation

    @Test
    void theValidationTableIs400InvalidRequestAndWritesNothing() {
        String longSubject = "x".repeat(151);
        String longBody = "y".repeat(2001);
        List<String[]> cases = List.of(
                new String[] {"NO_SUCH_TRIGGER", "{\"version\":0}"},
                new String[] {"ORDER_SHIPPED", "{}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":-1}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":\"0\"}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"enabled\":\"yes\"}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":{\"fr\":null}}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":{\"en\":{\"body\":\"Hi {{refund_amount}}\"}}}"},
                new String[] {"ORDER_CONFIRMED", "{\"version\":0,\"email\":{\"en\":{\"body\":\"Items: {{items}}\"}}}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":{\"en\":{\"body\":\"Hi {{ x y }}\"}}}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":{\"en\":{\"subject\":\"" + longSubject + "\"}}}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":{\"hi\":{\"body\":\"" + longBody + "\"}}}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":{\"en\":{\"title\":\"x\"}}}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"email\":[]}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"whatsapp_template_name\":\"Bad Name\"}"},
                new String[] {"ORDER_SHIPPED", "{\"version\":0,\"whatsapp_template_name\":5}"});
        for (String[] c : cases) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> service.updateTrigger(user, INST, c[0], body(c[1])), c[0] + " " + c[1]);
            assertTrue(e.getMessage().startsWith("invalid_request: "), e.getMessage());
        }
        verifyNoInteractions(jdbc, audit);
    }

    @Test
    void controlCharactersAreRemovedAndASubjectStaysOneLine() {
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPSERT), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of(1));

        NotificationSettingsDtos.TriggerView view = service.updateTrigger(user, INST, "ORDER_SHIPPED",
                body("{\"version\":0,\"email\":{\"en\":{\"subject\":\"Sent\\n{{order_number}}\\u0007\","
                        + "\"body\":\"Line one\\r\\nLine {{courier}}\\u0000 two\"}}}"));

        assertEquals("Sent {{order_number}}", view.getEmail().getSubject().get("en"));
        assertEquals("Line one\nLine {{courier}} two", view.getEmail().getBody().get("en"));
        assertEquals(1, view.getVersion());
    }

    // ================================================================== PUT trigger: version check

    @Test
    void aMissingRowIsVersionZeroAndIsInsertedAsVersionOne() {
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPSERT), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of(1));

        NotificationSettingsDtos.TriggerView view = service.updateTrigger(user, INST, "ORDER_SHIPPED",
                body("{\"version\":0,\"email_enabled\":false}"));

        Object[] args = writeArgs(CommerceNotificationSettingsService.UPSERT);
        assertEquals(INST, args[0]);
        assertEquals("ORDER_SHIPPED", args[1]);
        assertEquals(true, args[2]);
        assertEquals(false, args[3]);
        assertEquals(0, args[args.length - 1], "ON CONFLICT ... WHERE version = 0");
        assertEquals(1, view.getVersion());
        assertFalse(view.getEmailEnabled());
        assertTrue(CommerceNotificationSettingsService.UPSERT.contains("ON CONFLICT (institute_id, trigger_code) DO "
                + "UPDATE SET"));
        assertTrue(CommerceNotificationSettingsService.UPSERT.contains("version = commerce_notification_setting.version "
                + "+ 1"));
        assertTrue(CommerceNotificationSettingsService.UPSERT.endsWith("WHERE commerce_notification_setting.version "
                + "= ? RETURNING version"));
    }

    @Test
    void anInsertWithAVersionOtherThanZeroIsRefused() {
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.updateTrigger(user, INST, "ORDER_SHIPPED", body("{\"version\":1,\"enabled\":false}")));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertTrue(e.getMessage().startsWith("SETTING_VERSION_CONFLICT"));
        verifyNoInteractions(jdbc, audit);
    }

    @Test
    void aStaleVersionIs409() {
        stored(row("ORDER_SHIPPED", 3));
        VacademyException stale = assertThrows(VacademyException.class,
                () -> service.updateTrigger(user, INST, "ORDER_SHIPPED", body("{\"version\":2,\"enabled\":false}")));
        assertEquals(HttpStatus.CONFLICT, stale.getStatus());
        verifyNoInteractions(jdbc);

        // Read at 3, but someone wrote between the read and the write: the update matches no row.
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPDATE), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of());
        VacademyException raced = assertThrows(VacademyException.class,
                () -> service.updateTrigger(user, INST, "ORDER_SHIPPED", body("{\"version\":3,\"enabled\":false}")));
        assertEquals(HttpStatus.CONFLICT, raced.getStatus());
        assertTrue(raced.getMessage().startsWith("SETTING_VERSION_CONFLICT"));
        verify(audit, never()).record(anyString(), any(), any(), anyString(), any(), any(), any(), any(), any());
    }

    // ================================================================== PUT trigger: resets and audit

    @Test
    void nullResetsOneLanguageAndAMissingKeyKeepsTheOther() {
        CommerceNotificationSetting s = row("ORDER_DELIVERED", 2);
        s.setEmailSubjectHi("ऑर्डर {{order_number}}");
        s.setEmailBodyHi("नमस्ते {{customer_name}}");
        s.setEmailSubjectEn("Delivered {{order_number}}");
        s.setWhatsappEnabled(false);
        stored(s);
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPDATE), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of(3));

        NotificationSettingsDtos.TriggerView view = service.updateTrigger(user, INST, "ORDER_DELIVERED",
                body("{\"version\":2,\"email\":{\"hi\":null}}"));

        Object[] args = writeArgs(CommerceNotificationSettingsService.UPDATE);
        // enabled, email_enabled, whatsapp_enabled, template, subject_hi, body_hi, subject_en, body_en, by, inst, trigger, version
        assertEquals(false, args[2], "whatsapp_enabled kept");
        assertNull(args[4]);
        assertNull(args[5]);
        assertEquals("Delivered {{order_number}}", args[6]);
        assertEquals(2, args[args.length - 1]);
        assertEquals(3, view.getVersion());
        assertFalse(view.getEmail().getOverridden().get("hi"));
        assertTrue(view.getEmail().getOverridden().get("en"));
    }

    @Test
    void theAuditRowNamesTheChangedKeysAndNeverAText() {
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPSERT), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of(1));

        service.updateTrigger(user, INST, "ORDER_CANCELLED", body("{\"version\":0,\"enabled\":false,"
                + "\"email_enabled\":true,\"email\":{\"en\":{\"subject\":\"Private subject words {{order_number}}\"}}}"));

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq("staff-1"), eq(null), eq("NOTIFY_SETTING_CHANGED"), eq("NOTIFY_TRIGGER"),
                eq("ORDER_CANCELLED"), eq(null), detail.capture(), eq(null));
        JsonNode node = body(detail.getValue());
        assertEquals("[\"enabled\",\"email.en.subject\"]", node.get("changed").toString());
        assertFalse(detail.getValue().contains("Private"));
    }

    @Test
    void aTemplateThatAsksForAnotherVariableIsRefusedAndAnUnreadableOneIsAccepted() {
        when(templates.read(INST, "shop_shipped_v2", "hi")).thenReturn(new CommerceWhatsAppTemplateStatus.Template(
                "APPROVED", List.of("customer_name", "refund_amount"), "t1"));
        InvalidRequestException refused = assertThrows(InvalidRequestException.class, () -> service.updateTrigger(user,
                INST, "ORDER_SHIPPED", body("{\"version\":0,\"whatsapp_template_name\":\"shop_shipped_v2\"}")));
        assertTrue(refused.getMessage().startsWith("invalid_request: "));
        verifyNoInteractions(jdbc);

        when(templates.read(INST, "shop_shipped_v3", "hi")).thenReturn(new CommerceWhatsAppTemplateStatus.Template(
                CommerceWhatsAppTemplateStatus.UNKNOWN, null, null));
        when(templates.read(INST, "shop_shipped_v3", "en")).thenThrow(new IllegalStateException("down"));
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPSERT), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of(1));
        NotificationSettingsDtos.TriggerView view = service.updateTrigger(user, INST, "ORDER_SHIPPED",
                body("{\"version\":0,\"whatsapp_template_name\":\"shop_shipped_v3\"}"));
        assertEquals("shop_shipped_v3", view.getWhatsapp().getTemplateName());
    }

    @Test
    void onlyAUtilityTemplateCanBeChosen() {
        for (String category : List.of("MARKETING", "AUTHENTICATION")) {
            when(templates.read(INST, "shop_offer", "hi")).thenReturn(new CommerceWhatsAppTemplateStatus.Template(
                    "APPROVED", List.of(), "t9", category));
            InvalidRequestException refused = assertThrows(InvalidRequestException.class, () -> service.updateTrigger(
                    user, INST, "ORDER_CONFIRMED", body("{\"version\":0,\"whatsapp_template_name\":\"shop_offer\"}")));
            assertTrue(refused.getMessage().startsWith("invalid_request: "), refused.getMessage());
            assertTrue(refused.getMessage().contains("UTILITY"), refused.getMessage());
        }
        verifyNoInteractions(jdbc);

        when(templates.read(INST, "shop_confirmed_v2", "hi")).thenReturn(new CommerceWhatsAppTemplateStatus.Template(
                "APPROVED", List.of("customer_name"), "t2", "UTILITY"));
        when(templates.read(INST, "shop_confirmed_v2", "en")).thenReturn(new CommerceWhatsAppTemplateStatus.Template(
                "APPROVED", List.of("customer_name"), "t3", "UTILITY"));
        when(jdbc.queryForList(eq(CommerceNotificationSettingsService.UPSERT), eq(Integer.class), any(Object[].class)))
                .thenReturn(List.of(1));
        NotificationSettingsDtos.TriggerView view = service.updateTrigger(user, INST, "ORDER_CONFIRMED",
                body("{\"version\":0,\"whatsapp_template_name\":\"shop_confirmed_v2\"}"));
        assertEquals("shop_confirmed_v2", view.getWhatsapp().getTemplateName());
    }

    // ================================================================== PUT shop

    @Test
    void theLinkBaseHostMustBeAVerifiedWebsite() {
        for (String ok : List.of("https://shop.example.com", "https://www.shop.example.com",
                "https://shop.example.com/store")) {
            service.updateShop(user, INST, body("{\"link_base_url\":\"" + ok + "\"}"));
        }
        InvalidRequestException other = assertThrows(InvalidRequestException.class,
                () -> service.updateShop(user, INST, body("{\"link_base_url\":\"https://other-shop.example.org\"}")));
        assertTrue(other.getMessage().startsWith("LINK_BASE_NOT_VERIFIED"));
        InvalidRequestException lookalike = assertThrows(InvalidRequestException.class,
                () -> service.updateShop(user, INST, body("{\"link_base_url\":\"https://myshop.example.com\"}")));
        assertTrue(lookalike.getMessage().startsWith("LINK_BASE_NOT_VERIFIED"));
        for (String bad : List.of("http://shop.example.com", "https://shop.example.com?x=1",
                "https://shop.example.com#top", "https://user@shop.example.com", "https://shop.example.com/",
                "https://shop.example.com:8443")) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> service.updateShop(user, INST, body("{\"link_base_url\":\"" + bad + "\"}")), bad);
            assertTrue(e.getMessage().startsWith("invalid_request: "), bad);
        }
    }

    @Test
    void theDefaultLinkBaseIsTheOneVerifiedWebsiteAndNoneWhenThereAreSeveral() {
        assertEquals("https://shop.example.com", shopSettings.linkBase(INST,
                CommerceNotificationShopSettings.Shop.defaults()));
        when(websites.verifiedHosts(INST)).thenReturn(Set.of("shop.example.com", "store.example.org"));
        assertNull(shopSettings.linkBase(INST, CommerceNotificationShopSettings.Shop.defaults()));
        when(websites.verifiedHosts(INST)).thenReturn(Set.of());
        assertNull(shopSettings.linkBase(INST, CommerceNotificationShopSettings.Shop.defaults()));
    }

    @Test
    void badShopValuesAre400AndNothingIsWritten() {
        for (String bad : List.of("{\"link_days\":0}", "{\"link_days\":31}", "{\"link_days\":\"7\"}",
                "{\"link_days\":7.5}", "{\"shop_name\":{\"hi\":\"" + "न".repeat(61) + "\"}}",
                "{\"shop_name\":{\"en\":\"Two\\nlines\"}}", "{\"shop_name\":{\"fr\":\"x\"}}",
                "{\"shop_name\":\"x\"}", "{\"link_base_url\":5}", "[]")) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> service.updateShop(user, INST, body(bad)), bad);
            assertTrue(e.getMessage().startsWith("invalid_request: "), bad);
        }
        verifyNoInteractions(settingWriter, audit);
    }

    @Test
    void updateNotificationsKeepsEveryOtherCommerceSettingKey() {
        service.updateShop(user, INST, body("{\"link_base_url\":\"https://shop.example.com\",\"link_days\":21,"
                + "\"shop_name\":{\"en\":\"Example Shop\",\"hi\":null}}"));

        ArgumentCaptor<JsonNode> entry = ArgumentCaptor.forClass(JsonNode.class);
        verify(settingWriter).putSettingKey(eq(institute), eq("COMMERCE_SETTING"), entry.capture(), any());
        JsonNode data = entry.getValue().get("data");
        assertEquals(20, data.get("holdMinutes").asInt());
        assertEquals("hi", data.get("baseLocale").asText());
        assertTrue(data.get("botCheck").get("enabled").asBoolean());
        assertEquals(4000, data.get("cod").get("maxOrderValue").asInt());
        assertEquals("190001", data.get("cod").get("blockedPincodes").get(0).asText());
        assertEquals(7, data.get("returns").get("windowDays").asInt());
        JsonNode n = data.get("notifications");
        assertEquals("https://shop.example.com", n.get("linkBaseUrl").asText());
        assertEquals(21, n.get("linkDays").asInt());
        assertEquals("Example Shop", n.get("shopName").get("en").asText());
        assertTrue(n.get("shopName").get("hi").isNull());
        assertEquals(1, n.get("other").asInt(), "an unknown key of notifications is kept too");

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq("staff-1"), eq(null), eq("NOTIFY_SHOP_CHANGED"), eq("COMMERCE_SETTING"),
                eq("notifications"), eq(null), detail.capture(), eq(null));
        assertFalse(detail.getValue().contains("example.com"), "key names only");
        assertTrue(detail.getValue().contains("link_base_url"));
    }

    @Test
    void nullResetsAShopKeyAndAMissingKeyKeepsIt() {
        service.updateShop(user, INST, body("{\"link_days\":null}"));

        ArgumentCaptor<JsonNode> entry = ArgumentCaptor.forClass(JsonNode.class);
        verify(settingWriter).putSettingKey(eq(institute), eq("COMMERCE_SETTING"), entry.capture(), any());
        JsonNode n = entry.getValue().get("data").get("notifications");
        assertNull(n.get("linkDays"));
        assertEquals("Old name", n.get("shopName").get("hi").asText());
    }
}
