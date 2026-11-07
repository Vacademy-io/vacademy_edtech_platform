package vacademy.io.admin_core_service.features.platform_billing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService.PlatformBillingEmail;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService.PlatformDocumentType;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Billing email brand rules: NEUTRAL mail never says Vacademy (subject, body, links, sender);
 * VACADEMY mail may; links go to the institute's own admin host.
 */
class PlatformDocumentMailServiceTest {

    static final Pattern BRAND = Pattern.compile("(?i)vacademy");

    InstituteRepository instituteRepo = mock(InstituteRepository.class);
    PlatformPaymentConfigService configService = mock(PlatformPaymentConfigService.class);
    PlatformInvoicePdfService pdfService = mock(PlatformInvoicePdfService.class);
    PlatformInvoiceLineItemRepository lineRepo = mock(PlatformInvoiceLineItemRepository.class);
    PlatformPaymentRepository paymentRepo = mock(PlatformPaymentRepository.class);
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    NotificationService notificationService = mock(NotificationService.class);
    BrandModeService brand;
    PaymentNotificatonService notifier;
    PlatformDocumentMailService mail;
    PlatformPaymentConfig cfg;
    Institute institute;

    @BeforeEach
    void setUp() {
        brand = spy(new BrandModeService(mock(vacademy.io.admin_core_service.features.domain_routing.repository
                .InstituteDomainRoutingRepository.class), jdbc, "vacademy.io"));
        notifier = new PaymentNotificatonService();
        ReflectionTestUtils.setField(notifier, "notificationService", notificationService);
        mail = new PlatformDocumentMailService(instituteRepo, configService, brand, pdfService, notifier, lineRepo,
                paymentRepo, jdbc);
        cfg = PlatformInvoiceServiceTest.config();
        cfg.setTradeName("Vacademy");
        cfg.setBillingSupportEmail("billing@vacademy.io");
        when(configService.load()).thenReturn(cfg);
        institute = PlatformInvoiceServiceTest.institute("27", null);
        institute.setEmail("owner@myschool.com");
        when(instituteRepo.findById("inst-1")).thenReturn(Optional.of(institute));
        when(jdbc.queryForList(eq(PlatformDocumentMailService.SELECT_BILLING_EMAIL), eq(String.class), eq("inst-1")))
                .thenReturn(List.of("Accounts@MySchool.com", "OWNER@myschool.com"));
        when(lineRepo.findByPlatformInvoiceId(anyString())).thenReturn(List.of(PlatformInvoicePdfServiceTest.line()));
        when(pdfService.renderPdf(any(PlatformInvoice.class))).thenReturn(new byte[] { 1, 2, 3 });
        when(pdfService.fileName(any(PlatformInvoice.class))).thenReturn("VT-2627-I00042.pdf");
        when(paymentRepo.findById(anyString())).thenReturn(Optional.empty());
    }

    PlatformInvoice invoice(String mode) {
        PlatformInvoice inv = PlatformInvoicePdfServiceTest.subscriptionInvoice();
        inv.setBrandMode(mode);
        return inv;
    }

    static final String OWN_SENDER = "{\"setting\":{\"EMAIL_SETTING\":{\"data\":{\"UTILITY_EMAIL\":"
            + "{\"from\":\"My School <office@myschool.com>\"}}}}}";

    @Test
    void neutralWithoutNamedSenderAttachesPdfAndNeverSaysVacademy() {
        institute.setAdminPortalBaseUrl("https://dash.vacademy.io");
        institute.setSetting(OWN_SENDER); // the institute's own, brand-free UTILITY_EMAIL sender
        assertTrue(mail.sendInvoiceEmail(invoice("NEUTRAL")));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<AttachmentNotificationDTO>> cap = ArgumentCaptor.forClass(List.class);
        verify(notificationService).sendAttachmentEmailViaUnified(cap.capture(), eq("inst-1"));
        AttachmentNotificationDTO dto = cap.getValue().get(0);
        assertFalse(BRAND.matcher(dto.getSubject()).find(), dto.getSubject());
        assertFalse(BRAND.matcher(dto.getBody()).find(), dto.getBody());
        assertTrue(dto.getSubject().contains("VT/2627/I00042"));
        assertTrue(dto.getBody().contains("attached"));
        assertEquals(2, dto.getUsers().size(), "institute + billing email, de-duplicated");
        assertEquals("VT-2627-I00042.pdf", dto.getAttachmentName());
        verify(notificationService, never()).sendHtmlEmailViaUnified(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void neutralWithNamedSenderUsesItAndLinksTheOwnAdminHost() {
        cfg.setBillingFromName("Vidyayatan Billing");
        cfg.setBillingFromEmail("billing@vidyayatan.in");
        institute.setAdminPortalBaseUrl("https://admin.myschool.com");
        assertTrue(mail.sendInvoiceEmail(invoice("NEUTRAL")));

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        verify(notificationService, times(2)).sendHtmlEmailViaUnified(anyString(), subject.capture(), body.capture(),
                eq("inst-1"), eq("billing@vidyayatan.in"), eq("Vidyayatan Billing"), eq("UTILITY_EMAIL"));
        assertFalse(BRAND.matcher(subject.getValue() + body.getValue()).find());
        assertTrue(body.getValue().contains("https://admin.myschool.com/settings?selectedTab=aiSettings"));
        verify(notificationService, never()).sendAttachmentEmailViaUnified(any(), any());
    }

    @Test
    void neutralWithNoNeutralSenderIsWithheldNeverSentAsVacademySupport() {
        // default config: billing_from_* NULL, and the institute has no sender of its own, so
        // notification_service would send it as "Vacademy Support <support@vacademy.io>"
        assertFalse(mail.sendInvoiceEmail(invoice("NEUTRAL")));
        verifyNoInteractions(notificationService);
        // a name without an address is not a sender either
        cfg.setBillingFromName("Vidyayatan Billing");
        assertFalse(mail.sendInvoiceEmail(invoice("NEUTRAL")));
        // an institute sender that carries the brand does not count
        institute.setSetting(OWN_SENDER.replace("My School <office@myschool.com>", "Vacademy <noreply@vacademy.io>"));
        assertFalse(mail.sendInvoiceEmail(invoice("NEUTRAL")));
        verifyNoInteractions(notificationService);
        // VACADEMY mode is unchanged: the platform sender is fine there
        assertTrue(mail.sendInvoiceEmail(invoice("VACADEMY")));
    }

    @Test
    void neutralUsesThePlatformSenderEvenWhenItCarriesTheBrand() {
        // owner decision 2026-10-16: white-labelled admins may get billing mail from the Vacademy sender
        cfg.setBillingFromName("Vacademy Billing");
        cfg.setBillingFromEmail("billing@vacademy.io");
        institute.setSetting(OWN_SENDER);
        mail.sendInvoiceEmail(invoice("NEUTRAL"));
        verify(notificationService, org.mockito.Mockito.atLeastOnce()).sendHtmlEmailViaUnified(any(), any(), any(),
                eq("inst-1"), eq("billing@vacademy.io"), eq("Vacademy Billing"), eq("UTILITY_EMAIL"));
        assertNull(PlatformDocumentMailService.neutralText("Team VACADEMY"));
        assertNull(mail.supportEmailFor("help@vacademy.io", BrandMode.NEUTRAL));
        assertEquals("help@vacademy.io", mail.supportEmailFor("help@vacademy.io", BrandMode.VACADEMY));
    }

    @Test
    void vacademyModePrefixesTradeNameAndFallsBackToDash() {
        assertTrue(mail.sendInvoiceEmail(invoice("VACADEMY")));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<AttachmentNotificationDTO>> cap = ArgumentCaptor.forClass(List.class);
        verify(notificationService).sendAttachmentEmailViaUnified(cap.capture(), eq("inst-1"));
        AttachmentNotificationDTO dto = cap.getValue().get(0);
        assertTrue(dto.getSubject().startsWith("Vacademy: "), dto.getSubject());
        assertTrue(dto.getBody().contains("https://dash.vacademy.io/settings"));
        assertTrue(dto.getBody().contains("billing@vacademy.io"));
    }

    @Test
    void creditNoteTemplateNamesTheInvoice() throws Exception {
        PlatformBillingEmail e = PlatformBillingEmail.builder()
                .instituteId("inst-1").recipients(List.of("a@b.com")).brandMode(BrandMode.NEUTRAL)
                .documentType(PlatformDocumentType.CREDIT_NOTE).itemKind("AI_SUBSCRIPTION")
                .documentNumber("VT/2627/C00003").againstInvoiceNumber("VT/2627/I00042")
                .description("AI Pro subscription").amountDisplay("₹1,180.00").reason("Refund").build();
        String subject = (String) staticCall("platformBillingSubject", e);
        String body = (String) staticCall("platformBillingBody", e, false);
        assertEquals("Credit note VT/2627/C00003 for invoice VT/2627/I00042", subject);
        assertTrue(body.contains("VT/2627/I00042"));
        assertTrue(body.contains("Amount credited"));
        assertFalse(BRAND.matcher(subject + body).find());
    }

    @Test
    void noPdfFallsBackToPlainEmail() {
        when(pdfService.renderPdf(any(PlatformInvoice.class))).thenThrow(new RuntimeException("render failed"));
        institute.setSetting(OWN_SENDER);
        assertTrue(mail.sendInvoiceEmail(invoice("NEUTRAL")));
        ArgumentCaptor<NotificationDTO> cap = ArgumentCaptor.forClass(NotificationDTO.class);
        verify(notificationService).sendEmailViaUnified(cap.capture(), eq("inst-1"));
        assertFalse(cap.getValue().getBody().contains("attached"));
    }

    @Test
    void noRecipientNoEmail() {
        institute.setEmail(null);
        when(jdbc.queryForList(eq(PlatformDocumentMailService.SELECT_BILLING_EMAIL), eq(String.class), eq("inst-1")))
                .thenReturn(List.of());
        assertFalse(mail.sendInvoiceEmail(invoice("NEUTRAL")));
        verifyNoInteractions(notificationService);
    }

    private static Object staticCall(String name, Object... args) throws Exception {
        for (Method m : PaymentNotificatonService.class.getDeclaredMethods()) {
            if (m.getName().equals(name) && m.getParameterCount() == args.length) {
                m.setAccessible(true);
                return m.invoke(null, args);
            }
        }
        throw new NoSuchMethodException(name);
    }
}
