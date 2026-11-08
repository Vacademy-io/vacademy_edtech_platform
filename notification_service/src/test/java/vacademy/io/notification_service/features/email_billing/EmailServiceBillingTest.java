package vacademy.io.notification_service.features.email_billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.announcements.service.InstituteAnnouncementSettingsService;
import vacademy.io.notification_service.features.email_sending_controls.service.DeferredEmailService;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailDailyQuotaService;
import vacademy.io.notification_service.features.email_sending_controls.service.EmailUnsubscribeService;
import vacademy.io.notification_service.features.email_sending_controls.service.UnsubscribeMailer;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;
import vacademy.io.notification_service.service.EmailDispatcher;
import vacademy.io.notification_service.service.EmailService;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The billing hooks in EmailService: a blocked email never reaches the dispatcher and is kept for
 * a resend; an allowed one is counted only after the SMTP send succeeded.
 */
class EmailServiceBillingTest {

    private static final String INST = "inst-1";
    private static final String TO = "learner@gmail.com";

    private JavaMailSender mailSender;
    private EmailDispatcher dispatcher;
    private EmailBillingGate gate;
    private EmailUsageStore usage;
    private BlockedEmailStore blocked;
    private NotificationLogRepository logs;
    private EmailService service;

    @BeforeEach
    void setUp() throws Exception {
        mailSender = mock(JavaMailSender.class);
        dispatcher = mock(EmailDispatcher.class);
        gate = mock(EmailBillingGate.class);
        usage = mock(EmailUsageStore.class);
        blocked = mock(BlockedEmailStore.class);
        logs = mock(NotificationLogRepository.class);
        service = new EmailService(mailSender, mock(InstituteInternalService.class), new ObjectMapper(), dispatcher,
                mock(InstituteAnnouncementSettingsService.class), mock(EmailConfigurationService.class),
                mock(BouncedEmailService.class), logs, mock(EmailDailyQuotaService.class),
                mock(DeferredEmailService.class), mock(EmailUnsubscribeService.class), mock(UnsubscribeMailer.class),
                gate, usage, blocked);
        ReflectionTestUtils.setField(service, "from", "Vacademy <noreply@vacademy.io>");
        ReflectionTestUtils.setField(service, "sesConfigurationSet", "cs");
        ReflectionTestUtils.setField(service, "awsSqsEnabled", false);
        // Run what the dispatcher is given straight away.
        doAnswer(inv -> {
            ((Runnable) inv.getArgument(0)).run();
            return null;
        }).when(dispatcher).sendEmail(any());
        when(mailSender.createMimeMessage()).thenReturn(mock(MimeMessage.class));
    }

    @Test
    void aBlockedEmailIsKeptAndNeverSent() throws Exception {
        when(gate.allows(INST, EmailBillingClass.BILLABLE, 3)).thenReturn(false);

        EmailService.SendOutcome outcome = service.sendHtmlEmail(TO, "Webinar", "unified-send", "<p>hi</p>", INST,
                null, null, "UTILITY_EMAIL", null, "user-1", List.of("a@gmail.com", "b@gmail.com"), "BCC",
                EmailBillingClass.BILLABLE);

        assertEquals(EmailService.SendOutcome.SKIPPED_NO_CREDITS, outcome);
        verify(blocked).save(eq(INST), eq(TO), eq(List.of("a@gmail.com", "b@gmail.com")), eq("BCC"), eq("Webinar"),
                eq("<p>hi</p>"), eq("UTILITY_EMAIL"), eq("unified-send"), isNull(), isNull(), eq("user-1"), isNull(),
                eq(3));
        verify(dispatcher, never()).sendEmail(any());
        verify(usage, never()).recordSent(any(), any(), anyInt());
    }

    @Test
    void anAllowedEmailIsCountedAfterItIsSent() throws Exception {
        when(gate.allows(any(), any(), anyInt())).thenReturn(true);

        EmailService.SendOutcome outcome = service.sendHtmlEmail(TO, "Class today", "unified-send", "<p>hi</p>",
                INST, null, null, "UTILITY_EMAIL", null, null, List.of("a@gmail.com", "b@gmail.com"), "BCC",
                EmailBillingClass.BILLABLE);

        assertEquals(EmailService.SendOutcome.SENT, outcome);
        var order = inOrder(mailSender, usage);
        order.verify(mailSender).send(any(MimeMessage.class));
        order.verify(usage).recordSent(INST, EmailBillingClass.BILLABLE, 3);
        verifyNoInteractions(blocked);
    }

    @Test
    void aFailedSendIsNotCounted() throws Exception {
        when(gate.allows(any(), any(), anyInt())).thenReturn(true);
        doThrow(new org.springframework.mail.MailSendException("smtp down")).when(mailSender).send(any(MimeMessage.class));

        try {
            service.sendHtmlEmail(TO, "s", "unified-send", "b", INST, null, null, null, null, null, null, null,
                    EmailBillingClass.BILLABLE);
        } catch (RuntimeException expected) {
            // the dispatcher task rethrows; the caller's catch handles it today
        }
        verify(usage, never()).recordSent(any(), any(), anyInt());
    }

    @Test
    void withoutAClassTheSourceDecides() throws Exception {
        when(gate.allows(any(), any(), anyInt())).thenReturn(true);

        service.sendHtmlEmail(TO, "s", "ENGAGEMENT_ENGINE", "b", INST, null, null, null, "action-1", null, null, null);

        verify(gate).allows(INST, EmailBillingClass.EXCLUDED, 1);
        verify(usage).recordSent(INST, EmailBillingClass.EXCLUDED, 1);
    }

    @Test
    void attachmentsAreMeteredAndTheInstituteIsNowLogged() throws Exception {
        when(gate.allows(any(), any(), anyInt())).thenReturn(true);
        byte[] twoMb = new byte[(int) (2 * EmailUnits.MIB)];

        EmailService.SendOutcome outcome = service.sendAttachmentEmail(TO, "Receipt", "unified-send", "<p>paid</p>",
                Map.of("receipt.pdf", twoMb), INST, "UTILITY_EMAIL", null, null, EmailBillingClass.ESSENTIAL);

        assertEquals(EmailService.SendOutcome.SENT, outcome);
        verify(gate).allows(INST, EmailBillingClass.ESSENTIAL, 3);
        verify(usage).recordSent(INST, EmailBillingClass.ESSENTIAL, 3);
        ArgumentCaptor<NotificationLog> row = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logs).save(row.capture());
        assertEquals(INST, row.getValue().getInstituteId());
    }

    @Test
    void anOtpIsCountedAsFree() throws Exception {
        service.sendEmailOtp(TO, "Your code", "auth", "Asha", "123456", INST);

        verify(usage).recordSent(INST, EmailBillingClass.FREE, 1);
        verify(gate, never()).allows(any(), any(), anyInt());
    }
}
