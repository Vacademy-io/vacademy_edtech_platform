package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSender;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;
import vacademy.io.notification_service.features.announcements.service.InstituteAnnouncementSettingsService;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.email_billing.BlockedEmailStore;
import vacademy.io.notification_service.features.email_billing.EmailBillingGate;
import vacademy.io.notification_service.features.email_billing.EmailUsageStore;
import vacademy.io.notification_service.features.email_sending_controls.service.DeferredEmailService;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailDailyQuotaService;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailUnsubscribeService;
import vacademy.io.notification_service.features.email_sending_controls.service.UnsubscribeMailer;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.util.EmailDomainBlocklistUtil;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** An address under the reserved .invalid domain has no mailbox: it is never mailed. */
class EmailServiceInvalidRecipientTest {

    private final JavaMailSender mailSender = mock(JavaMailSender.class);
    private final InstituteInternalService internalService = mock(InstituteInternalService.class);
    private final BouncedEmailService bouncedEmailService = mock(BouncedEmailService.class);
    private final EmailBillingGate billingGate = mock(EmailBillingGate.class);
    private final EmailService service = new EmailService(mailSender, internalService, new ObjectMapper(),
            mock(EmailDispatcher.class), mock(InstituteAnnouncementSettingsService.class),
            mock(EmailConfigurationService.class), bouncedEmailService, mock(NotificationLogRepository.class),
            mock(EmailDailyQuotaService.class), mock(DeferredEmailService.class), mock(EmailUnsubscribeService.class),
            mock(UnsubscribeMailer.class), billingGate, mock(EmailUsageStore.class), mock(BlockedEmailStore.class));

    @Test
    @DisplayName("The reserved .invalid domain is recognised, in any case and inside angle brackets")
    void reservedDomainIsRecognised() {
        assertThat(EmailDomainBlocklistUtil.isReservedUndeliverable("b-0123456789abcdef01234567@buyer.invalid"))
                .isTrue();
        assertThat(EmailDomainBlocklistUtil.isReservedUndeliverable(" B-1@Buyer.INVALID ")).isTrue();
        assertThat(EmailDomainBlocklistUtil.isReservedUndeliverable("Shop <b-1@buyer.invalid>")).isTrue();
        assertThat(EmailDomainBlocklistUtil.isReservedUndeliverable("asha@example.com")).isFalse();
        assertThat(EmailDomainBlocklistUtil.isReservedUndeliverable("asha@invalid.example.com")).isFalse();
        assertThat(EmailDomainBlocklistUtil.isReservedUndeliverable(null)).isFalse();
    }

    @Test
    @DisplayName("A mail to a .invalid address is skipped before any sender, billing or bounce lookup")
    void primaryRecipientIsSkipped() {
        service.sendEmail("b-0123456789abcdef01234567@buyer.invalid", "Receipt", "text", "inst-1");

        verifyNoInteractions(mailSender, internalService, billingGate, bouncedEmailService);
    }

    @Test
    @DisplayName("A .invalid copy recipient is dropped and the other copies still go out")
    void copyRecipientIsDroppedOthersKept() throws Exception {
        when(bouncedEmailService.isEmailBlocked(anyString())).thenReturn(false);
        MimeMessage message = new MimeMessage(Session.getInstance(new Properties()));
        Method apply = EmailService.class.getDeclaredMethod("applyCopyRecipients", MimeMessage.class, List.class,
                String.class);
        apply.setAccessible(true);

        apply.invoke(service, message, List.of("b-0123456789abcdef01234567@buyer.invalid", "accounts@example.com"),
                "BCC");

        Address[] bcc = message.getRecipients(Message.RecipientType.BCC);
        assertThat(bcc).hasSize(1);
        assertThat(bcc[0].toString()).isEqualTo("accounts@example.com");
    }
}
