package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The template request: drafts only for the missing rows, the draft is the positional body with
 * its names and neutral samples, WATI is not supported, three calls an hour, and never inside a
 * transaction.
 */
@SuppressWarnings("unchecked")
class CommerceNotificationTemplateSubmitTest {

    private static final String INST = "inst-1";
    private static final ObjectMapper JSON = new ObjectMapper();

    private CommerceSetupAccess setupAccess;
    private CommerceRateLimiter rateLimiter;
    private CommerceWhatsAppTemplateStatus templates;
    private EngagementInternalClients client;
    private CommerceAuditService audit;
    private CommerceNotificationTemplateSubmitService service;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        setupAccess = mock(CommerceSetupAccess.class);
        rateLimiter = mock(CommerceRateLimiter.class);
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(Duration.class), anyInt())).thenReturn(true);
        templates = mock(CommerceWhatsAppTemplateStatus.class);
        when(templates.provider(INST)).thenReturn("META");
        client = mock(EngagementInternalClients.class);
        when(client.getWhatsAppTemplateByName(eq(INST), anyString(), anyString())).thenReturn(JSON.createObjectNode());
        when(client.createWhatsAppTemplateDraft(any())).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            return JSON.createObjectNode().put("id", "tpl-new");
        });
        when(client.submitWhatsAppTemplate("tpl-new")).thenReturn(JSON.createObjectNode().put("status", "PENDING"));
        audit = mock(CommerceAuditService.class);
        service = new CommerceNotificationTemplateSubmitService(setupAccess, rateLimiter, templates, client, audit,
                JSON);
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("staff-1");
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private static JsonNode body(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    @Test
    void onlyTheMissingRowsAreCreatedAndSubmitted() {
        when(client.getWhatsAppTemplateByName(INST, "commerce_order_shipped", "hi"))
                .thenReturn(JSON.createObjectNode().put("id", "tpl-old").put("status", "APPROVED"));

        NotificationSettingsDtos.TemplateSubmitAnswer answer = service.submit(user, INST,
                body("{\"triggers\":[\"ORDER_SHIPPED\"],\"locales\":[\"hi\",\"en\"]}"));

        verify(setupAccess).require(user, INST, CommerceNotificationSettingsService.WRITE);
        assertEquals(2, answer.getItems().size());
        NotificationSettingsDtos.TemplateSubmitItem hi = answer.getItems().get(0);
        assertEquals("EXISTS", hi.getCode());
        assertEquals("APPROVED", hi.getStatus());
        NotificationSettingsDtos.TemplateSubmitItem en = answer.getItems().get(1);
        assertEquals("CREATED_AND_SUBMITTED", en.getCode());
        assertEquals("PENDING", en.getStatus());
        assertEquals("commerce_order_shipped", en.getTemplateName());
        verify(client, times(1)).createWhatsAppTemplateDraft(any());
        verify(client, times(1)).submitWhatsAppTemplate("tpl-new");
        verify(templates).forget(INST);
        verify(audit).record(eq(INST), eq("staff-1"), eq(null), eq("NOTIFY_TEMPLATES_SUBMITTED"), anyString(),
                eq(null), eq(null), anyString(), eq(null));
    }

    @Test
    void theDraftIsThePositionalBodyWithItsNamesAndNeutralSamples() {
        service.submit(user, INST, body("{\"triggers\":[\"ORDER_SHIPPED\"],\"locales\":[\"en\"]}"));

        ArgumentCaptor<Map<String, Object>> draft = ArgumentCaptor.forClass(Map.class);
        verify(client).createWhatsAppTemplateDraft(draft.capture());
        Map<String, Object> d = draft.getValue();
        CommerceNotificationTexts.Positional positional = CommerceNotificationTexts.positional(
                CommerceNotificationTexts.of(CommerceNotificationTrigger.ORDER_SHIPPED, "en").body());
        assertEquals(INST, d.get("instituteId"));
        assertEquals("commerce_order_shipped", d.get("name"));
        assertEquals("en", d.get("language"));
        assertEquals("UTILITY", d.get("category"));
        assertEquals("NONE", d.get("headerType"));
        assertEquals(positional.body(), d.get("bodyText"));
        assertFalse(((String) d.get("bodyText")).contains("{{customer_name}}"));
        assertTrue(((String) d.get("bodyText")).contains("{{1}}"));
        assertEquals(positional.names(), d.get("bodyVariableNames"));
        List<String> samples = (List<String>) d.get("bodySampleValues");
        assertEquals(positional.names().size(), samples.size());
        assertEquals(List.of("Asha", "SH-000123", "India Post", "EZ123456789IN", "₹0",
                "https://shop.example.com/order#l=sample"), samples);
    }

    @Test
    void nullTriggersMeansAllNineInBothLanguages() {
        NotificationSettingsDtos.TemplateSubmitAnswer answer = service.submit(user, INST, body("{\"triggers\":null}"));
        assertEquals(18, answer.getItems().size());
        assertTrue(answer.getItems().stream().allMatch(i -> "CREATED_AND_SUBMITTED".equals(i.getCode())));
    }

    @Test
    void aWatiInstituteGetsProviderNotSupportedWithTheTextToPaste() {
        when(templates.provider(INST)).thenReturn("WATI");

        NotificationSettingsDtos.TemplateSubmitAnswer answer = service.submit(user, INST,
                body("{\"triggers\":[\"ORDER_CONFIRMED\"],\"locales\":[\"hi\"]}"));

        NotificationSettingsDtos.TemplateSubmitItem item = answer.getItems().get(0);
        assertEquals("PROVIDER_NOT_SUPPORTED", item.getCode());
        assertTrue(item.getText().contains("{{1}}"));
        assertEquals(List.of("customer_name", "shop_name", "order_number", "order_total", "order_link"),
                item.getVariableNames());
        verify(client, never()).createWhatsAppTemplateDraft(any());
        verify(client, never()).getWhatsAppTemplateByName(anyString(), anyString(), anyString());
    }

    @Test
    void aProviderFailureIsReportedPerItem() {
        when(client.submitWhatsAppTemplate("tpl-new")).thenThrow(new IllegalStateException("meta down"));

        NotificationSettingsDtos.TemplateSubmitAnswer answer = service.submit(user, INST,
                body("{\"triggers\":[\"ORDER_RTO\"],\"locales\":[\"en\"]}"));

        assertEquals("PROVIDER_ERROR", answer.getItems().get(0).getCode());
        assertEquals("DRAFT", answer.getItems().get(0).getStatus());
    }

    @Test
    void threeCallsPerInstitutePerHour() {
        when(rateLimiter.allow(INST, "notify_templates", CommerceRateLimiter.ALL, Duration.ofHours(1), 3))
                .thenReturn(false);
        CommerceNotifyRateLimitedException e = assertThrows(CommerceNotifyRateLimitedException.class,
                () -> service.submit(user, INST, body("{}")));
        assertTrue(e.getRetryAfterSeconds() >= 1);
        verifyNoInteractions(client);
    }

    @Test
    void badTriggersOrLocalesAre400() {
        for (String bad : List.of("{\"triggers\":[\"NOPE\"]}", "{\"locales\":[\"fr\"]}", "{\"triggers\":\"ORDER_RTO\"}",
                "{\"locales\":[]}")) {
            assertThrows(InvalidRequestException.class, () -> service.submit(user, INST, body(bad)), bad);
        }
        verifyNoInteractions(client, rateLimiter);
    }

    @Test
    void neverInsideATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        assertThrows(IllegalStateException.class, () -> service.submit(user, INST, body("{}")));
        verifyNoInteractions(client);
    }
}
