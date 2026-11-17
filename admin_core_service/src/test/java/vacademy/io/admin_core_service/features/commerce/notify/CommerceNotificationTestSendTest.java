package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
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
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
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
 * The test message: only to the caller's own contacts from auth_service, a body with any other
 * field refused, the two rate limits, works with the trigger off, WhatsApp only through an
 * approved template, 422 without a usable contact, and never sent inside a transaction.
 */
class CommerceNotificationTestSendTest {

    private static final String INST = "inst-1";
    private static final ObjectMapper JSON = new ObjectMapper();

    private CommerceSetupAccess setupAccess;
    private CommerceRateLimiter rateLimiter;
    private AuthService authService;
    private CommerceNotificationSettingRepository settings;
    private CommerceWhatsAppTemplateStatus templates;
    private CommerceNotificationShopSettings shopSettings;
    private NotificationService notificationService;
    private CommerceAuditService audit;
    private CommerceNotificationTestSendService service;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        setupAccess = mock(CommerceSetupAccess.class);
        rateLimiter = mock(CommerceRateLimiter.class);
        when(rateLimiter.allow(anyString(), anyString(), anyString(), any(Duration.class), anyInt())).thenReturn(true);
        authService = mock(AuthService.class);
        UserDTO me = new UserDTO();
        me.setId("staff-1");
        me.setEmail("asha@example.com");
        me.setMobileNumber("9876500010");
        when(authService.getUsersFromAuthServiceByUserIds(List.of("staff-1"))).thenReturn(List.of(me));
        settings = mock(CommerceNotificationSettingRepository.class);
        when(settings.findByInstituteIdAndTriggerCode(eq(INST), anyString())).thenReturn(Optional.empty());
        templates = mock(CommerceWhatsAppTemplateStatus.class);
        when(templates.status(eq(INST), anyString(), anyString())).thenReturn(CommerceWhatsAppTemplateStatus.APPROVED);
        when(templates.category(eq(INST), anyString(), anyString())).thenReturn(CommerceWhatsAppTemplateStatus.UTILITY);
        shopSettings = mock(CommerceNotificationShopSettings.class);
        when(shopSettings.read(INST)).thenReturn(CommerceNotificationShopSettings.Shop.defaults());
        when(shopSettings.linkBase(eq(INST), any())).thenReturn("https://shop.example.com");
        CommerceNotificationStore store = mock(CommerceNotificationStore.class);
        when(store.instituteName(INST)).thenReturn("Example Shop");
        notificationService = mock(NotificationService.class);
        when(notificationService.sendUnified(any())).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(),
                    "the send API is never called inside a transaction");
            return UnifiedSendResponse.builder().results(List.of(UnifiedSendResponse.RecipientResult.builder()
                    .success(true).status("SENT").build())).build();
        });
        audit = mock(CommerceAuditService.class);
        service = new CommerceNotificationTestSendService(setupAccess, rateLimiter, authService, settings, templates,
                shopSettings, store, new CommerceNotificationMessages(new CommerceNotificationEmailRenderer()),
                notificationService, audit, JSON);
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

    private List<UnifiedSendRequest> sent(int times) {
        ArgumentCaptor<UnifiedSendRequest> requests = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(notificationService, times(times)).sendUnified(requests.capture());
        return requests.getAllValues();
    }

    @Test
    void theMessageGoesOnlyToTheCallersOwnContactsAsARealMessageWould() {
        NotificationSettingsDtos.TestSendAnswer answer = service.send(user, INST, body(
                "{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\",\"channels\":[\"EMAIL\",\"WHATSAPP\"]}"));

        verify(setupAccess).require(user, INST, CommerceNotificationSettingsService.WRITE);
        List<UnifiedSendRequest> requests = sent(2);
        UnifiedSendRequest email = requests.get(0);
        assertEquals("EMAIL", email.getChannel());
        assertEquals(1, email.getRecipients().size());
        assertEquals("asha@example.com", email.getRecipients().get(0).getEmail());
        assertEquals("staff-1", email.getRecipients().get(0).getUserId());
        assertEquals("UTILITY_EMAIL", email.getOptions().getEmailType());
        assertEquals(CommerceNotificationDispatcher.SOURCE, email.getOptions().getSource());
        assertNull(email.getOptions().getFromEmail());
        assertNull(email.getOptions().getCc());
        assertFalse(email.getOptions().getEmailBody().contains("{{"));
        assertTrue(email.getOptions().getEmailBody().contains("TEST-0001"));
        assertTrue(email.getOptions().getEmailBody().contains("https://shop.example.com/track-order"));

        UnifiedSendRequest whatsapp = requests.get(1);
        assertEquals("WHATSAPP", whatsapp.getChannel());
        assertEquals("commerce_order_shipped", whatsapp.getTemplateName());
        assertEquals("en", whatsapp.getLanguageCode());
        assertEquals("staff-1", whatsapp.getRecipients().get(0).getUserId());
        assertTrue(whatsapp.getRecipients().get(0).getPhone().endsWith("9876500010"));
        assertEquals("https://shop.example.com/track-order",
                whatsapp.getRecipients().get(0).getVariables().get("order_link"));
        assertEquals("Test customer", whatsapp.getRecipients().get(0).getVariables().get("customer_name"));
        assertEquals("Test courier", whatsapp.getRecipients().get(0).getVariables().get("courier"));
        assertEquals("TEST123", whatsapp.getRecipients().get(0).getVariables().get("tracking_number"));
        assertEquals("₹0", whatsapp.getRecipients().get(0).getVariables().get("amount_due"));

        assertEquals(2, answer.getResults().size());
        assertEquals("SENT", answer.getResults().get(0).getStatus());
        assertEquals("a•••@example.com", answer.getResults().get(0).getRecipientMasked());
        assertEquals("SENT", answer.getResults().get(1).getStatus());
        assertFalse(answer.getResults().get(1).getRecipientMasked().contains("98765"));

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit, times(2)).record(eq(INST), eq("staff-1"), eq(null), eq("NOTIFY_TEST_SENT"),
                eq("NOTIFY_TRIGGER"), eq("ORDER_SHIPPED"), eq(null), detail.capture(), eq(null));
        for (String d : detail.getAllValues()) {
            assertFalse(d.contains("asha@"), d);
            assertFalse(d.contains("9876500010"), d);
            assertTrue(d.contains("\"locale\":\"en\""), d);
        }
    }

    @Test
    void aBodyWithARecipientOrAnyOtherFieldIs400() {
        for (String extra : List.of("\"email\":\"someone@example.com\"", "\"phone\":\"9876500011\"",
                "\"recipient\":\"x\"", "\"to\":[]")) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> service.send(user, INST,
                    body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\"," + extra + "}")), extra);
            assertTrue(e.getMessage().startsWith("invalid_request: "));
        }
        for (String bad : List.of("{\"trigger\":\"NOPE\",\"locale\":\"en\"}", "{\"trigger\":\"ORDER_SHIPPED\"}",
                "{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"fr\"}",
                "{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\",\"channels\":[\"SMS\"]}",
                "{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\",\"channels\":[]}")) {
            assertThrows(InvalidRequestException.class, () -> service.send(user, INST, body(bad)), bad);
        }
        verifyNoInteractions(rateLimiter, authService, notificationService, audit);
    }

    @Test
    void fivePerUserPerHourAndThirtyPerShopPerDay() {
        when(rateLimiter.allow(INST, "notify_test_user", "staff-1", Duration.ofHours(1), 5)).thenReturn(false);
        CommerceNotifyRateLimitedException perUser = assertThrows(CommerceNotifyRateLimitedException.class,
                () -> service.send(user, INST, body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\"}")));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, perUser.getStatus());
        assertTrue(perUser.getMessage().startsWith("rate_limited"));
        assertTrue(perUser.getRetryAfterSeconds() >= 1 && perUser.getRetryAfterSeconds() <= 3600);

        when(rateLimiter.allow(INST, "notify_test_user", "staff-1", Duration.ofHours(1), 5)).thenReturn(true);
        when(rateLimiter.allow(INST, "notify_test_institute", CommerceRateLimiter.ALL, Duration.ofDays(1), 30))
                .thenReturn(false);
        CommerceNotifyRateLimitedException perShop = assertThrows(CommerceNotifyRateLimitedException.class,
                () -> service.send(user, INST, body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\"}")));
        assertTrue(perShop.getRetryAfterSeconds() >= 1 && perShop.getRetryAfterSeconds() <= 86400);
        verifyNoInteractions(authService, notificationService);
    }

    @Test
    void itWorksWhileTheTriggerIsOff() {
        CommerceNotificationSetting off = new CommerceNotificationSetting();
        off.setInstituteId(INST);
        off.setTriggerCode("ORDER_CANCELLED");
        off.setEnabled(false);
        off.setEmailEnabled(false);
        off.setWhatsappEnabled(false);
        when(settings.findByInstituteIdAndTriggerCode(INST, "ORDER_CANCELLED")).thenReturn(Optional.of(off));

        NotificationSettingsDtos.TestSendAnswer answer = service.send(user, INST,
                body("{\"trigger\":\"ORDER_CANCELLED\",\"locale\":\"hi\",\"channels\":[\"EMAIL\"]}"));

        assertEquals("SENT", answer.getResults().get(0).getStatus());
        assertTrue(sent(1).get(0).getOptions().getEmailBody().contains("lang=\"hi\""));
    }

    @Test
    void aTemplateThatIsNotApprovedIsNotSent() {
        when(templates.status(INST, "commerce_order_rto", "hi")).thenReturn("PENDING");

        NotificationSettingsDtos.TestSendAnswer answer = service.send(user, INST,
                body("{\"trigger\":\"ORDER_RTO\",\"locale\":\"hi\",\"channels\":[\"WHATSAPP\"]}"));

        NotificationSettingsDtos.TestSendResult result = answer.getResults().get(0);
        assertEquals("SKIPPED", result.getStatus());
        assertEquals("TEMPLATE_NOT_APPROVED", result.getCode());
        verify(notificationService, never()).sendUnified(any());
    }

    @Test
    void noUsableContactIs422() {
        UserDTO holder = new UserDTO();
        holder.setId("staff-1");
        holder.setEmail("p-12345@phone.invalid");
        when(authService.getUsersFromAuthServiceByUserIds(List.of("staff-1"))).thenReturn(List.of(holder));

        VacademyException e = assertThrows(VacademyException.class, () -> service.send(user, INST,
                body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\"}")));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertTrue(e.getMessage().startsWith("NO_TEST_CONTACT"));

        // A phone but only e-mail asked: still no contact for the channel asked.
        holder.setMobileNumber("9876500010");
        VacademyException emailOnly = assertThrows(VacademyException.class, () -> service.send(user, INST,
                body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\",\"channels\":[\"EMAIL\"]}")));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, emailOnly.getStatus());
        verify(notificationService, never()).sendUnified(any());
    }

    @Test
    void aChannelWithoutAContactIsSkippedWhileTheOtherIsSent() {
        UserDTO noPhone = new UserDTO();
        noPhone.setId("staff-1");
        noPhone.setEmail("asha@example.com");
        when(authService.getUsersFromAuthServiceByUserIds(List.of("staff-1"))).thenReturn(List.of(noPhone));

        NotificationSettingsDtos.TestSendAnswer answer = service.send(user, INST,
                body("{\"trigger\":\"POS_BILL_ISSUED\",\"locale\":\"en\"}"));

        assertEquals("SENT", answer.getResults().get(0).getStatus());
        assertEquals("SKIPPED", answer.getResults().get(1).getStatus());
        assertEquals("NO_PHONE", answer.getResults().get(1).getCode());
        sent(1);
    }

    @Test
    void neverInsideATransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        assertThrows(IllegalStateException.class, () -> service.send(user, INST,
                body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\"}")));
        verifyNoInteractions(notificationService);
    }

    @Test
    void aTemplateThatIsNotUtilityIsNotSent() {
        for (String category : new String[] {"MARKETING", null}) {
            when(templates.category(INST, "commerce_order_rto", "hi")).thenReturn(category);

            NotificationSettingsDtos.TestSendAnswer answer = service.send(user, INST,
                    body("{\"trigger\":\"ORDER_RTO\",\"locale\":\"hi\",\"channels\":[\"WHATSAPP\"]}"));

            NotificationSettingsDtos.TestSendResult result = answer.getResults().get(0);
            assertEquals("SKIPPED", result.getStatus(), String.valueOf(category));
            assertEquals("TEMPLATE_NOT_UTILITY", result.getCode());
        }
        verify(notificationService, never()).sendUnified(any());
    }

    @Test
    void aBlockedAddressIsSkipped() {
        when(notificationService.sendUnified(any())).thenReturn(UnifiedSendResponse.builder().results(List.of(
                UnifiedSendResponse.RecipientResult.builder().success(false).status("SKIPPED_BLOCKED").build()))
                .build());

        NotificationSettingsDtos.TestSendAnswer answer = service.send(user, INST,
                body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\",\"channels\":[\"EMAIL\"]}"));

        NotificationSettingsDtos.TestSendResult result = answer.getResults().get(0);
        assertEquals("SKIPPED", result.getStatus());
        assertEquals("ADDRESS_BLOCKED", result.getCode());
    }
}
