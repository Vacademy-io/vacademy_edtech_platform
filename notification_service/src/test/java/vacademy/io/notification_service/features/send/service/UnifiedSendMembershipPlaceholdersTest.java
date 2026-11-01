package vacademy.io.notification_service.features.send.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.announcements.client.AdminCoreServiceClient;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;
import vacademy.io.notification_service.service.EmailService;
import vacademy.io.notification_service.service.WhatsAppService;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Membership merge tags in unified email sends (student side view, bulk email): resolved per
 * recipient from admin-core, so a renewal reminder sent by hand carries the same practice name,
 * end date and working subscriptions link as the automatic one.
 */
class UnifiedSendMembershipPlaceholdersTest {

    private static final String INSTITUTE = "inst-1";
    private static final String TO = "member@example.com";
    private static final String USER = "user-1";

    private EmailService emailService;
    private AdminCoreServiceClient adminCore;
    private UnifiedSendService service;

    @BeforeEach
    void setUp() {
        emailService = mock(EmailService.class);
        adminCore = mock(AdminCoreServiceClient.class);
        EmailCcResolver ccResolver = mock(EmailCcResolver.class);
        when(ccResolver.resolve(any(), any())).thenReturn(new EmailCcResolver.CopyRecipients(List.of(), "BCC"));
        when(emailService.sendHtmlEmail(anyString(), anyString(), anyString(), anyString(), any(), any(), any(), any(),
                any(), any(), any(), any())).thenReturn(EmailService.SendOutcome.SENT);
        service = new UnifiedSendService(
                mock(WhatsAppService.class),
                emailService,
                mock(PushNotificationService.class),
                mock(SendBatchRepository.class),
                new ObjectMapper(),
                mock(BatchProcessorService.class),
                mock(NotificationTemplateRepository.class),
                mock(UserAnnouncementPreferenceService.class),
                ccResolver,
                mock(NotificationLogRepository.class),
                adminCore);
    }

    private String sentBody(String body, Map<String, String> callerVariables) {
        service.routeSync(UnifiedSendRequest.builder()
                .instituteId(INSTITUTE)
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                        .email(TO).userId(USER).variables(callerVariables).build()))
                .options(UnifiedSendRequest.SendOptions.builder()
                        .emailSubject("Renewal").emailBody(body).build())
                .build());
        ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
        verify(emailService).sendHtmlEmail(eq(TO), anyString(), anyString(), sent.capture(), eq(INSTITUTE),
                any(), any(), any(), any(), any(), any(), any());
        return sent.getValue();
    }

    @Test
    @DisplayName("subscription link, practice and end date are filled from admin-core")
    void fillsMembershipTokens() {
        when(adminCore.getMembershipPlaceholders(eq(INSTITUTE), anyList())).thenReturn(Map.of(USER, Map.of(
                "subscription_link", "https://learner.example.com/subscriptions/member%40example.com",
                "practice_name", "Sunshine Vet Clinic",
                "expiry_date_long", "14 November 2026")));

        String body = sentBody("<a href=\"{{subscription_link}}\">here</a> {{practice_name}} {{expiry_date_long}}",
                Map.of());

        assertThat(body).isEqualTo("<a href=\"https://learner.example.com/subscriptions/member%40example.com\">here</a>"
                + " Sunshine Vet Clinic 14 November 2026");
    }

    @Test
    @DisplayName("a value the caller supplied wins; a blank one is filled")
    void callerValueWinsUnlessBlank() {
        when(adminCore.getMembershipPlaceholders(eq(INSTITUTE), anyList())).thenReturn(Map.of(USER, Map.of(
                "practice_name", "From admin-core",
                "subscription_link", "https://link")));

        String body = sentBody("{{practice_name}} {{subscription_link}}",
                Map.of("practice_name", "Typed by admin", "subscription_link", ""));

        assertThat(body).isEqualTo("Typed by admin https://link");
    }

    @Test
    @DisplayName("a message without membership tokens never calls admin-core")
    void noLookupWithoutTokens() {
        sentBody("<p>Hi {{first_name}}</p>", Map.of("first_name", "Asha"));

        verify(adminCore, never()).getMembershipPlaceholders(any(), any());
    }
}
