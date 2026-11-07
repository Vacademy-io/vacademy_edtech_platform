package vacademy.io.admin_core_service.features.ai_plans_billing.notify;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Kind;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer.Mail;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.common.institute.entity.Institute;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Brand rules of the lifecycle emails (D1/D2): NEUTRAL never says Vacademy nor links to a Vacademy host. */
class AiPlansBillingMailerTest {

    InstituteRepository institutes = mock(InstituteRepository.class);
    BrandModeService brand = mock(BrandModeService.class);
    PlatformPaymentConfigService config = mock(PlatformPaymentConfigService.class);
    NotificationService notifications = mock(NotificationService.class);
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    AiPlansBillingMailer mailer;
    Institute inst = new Institute();
    PlatformPaymentConfig cfg = new PlatformPaymentConfig();

    @BeforeEach
    void setUp() {
        inst.setId("i1");
        inst.setEmail("admin@inst.test");
        inst.setInstituteName("Inst One");
        when(institutes.findById("i1")).thenReturn(Optional.of(inst));
        when(jdbc.queryForList(anyString(), eq(String.class), any())).thenReturn(List.of("accounts@inst.test"));
        cfg.setTradeName("Vacademy");
        cfg.setBillingSupportEmail("billing@vacademy.io");
        cfg.setBillingFromName("Billing Desk");
        cfg.setBillingFromEmail("billing@vidyayatan.in");
        when(config.load()).thenReturn(cfg);
        when(brand.isVacademyOwnedHost(anyString())).thenAnswer(i -> i.<String>getArgument(0).endsWith("vacademy.io"));
        mailer = new AiPlansBillingMailer(institutes, brand, config, notifications, jdbc);
    }

    Mail mail(String plan) {
        return new Mail(Kind.RENEWAL_LINK, "i1", plan, "₹5,900", "https://rzp.io/l/1", Instant.parse("2026-12-01T00:00:00Z"),
                Instant.parse("2026-12-08T00:00:00Z"), null, null);
    }

    @Test
    void neutralHasNoBrandNoVacademyLinkAndUsesTheNeutralSender() {
        when(brand.resolve("i1")).thenReturn(BrandMode.NEUTRAL);
        when(brand.adminLinkBase(any(), eq(BrandMode.NEUTRAL))).thenReturn(null);
        assertEquals(2, mailer.send(mail("AI Pro")));
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(notifications, times(2)).sendHtmlEmailViaUnified(anyString(), subject.capture(), body.capture(),
                eq("i1"), eq("billing@vidyayatan.in"), eq("Billing Desk"), eq("UTILITY_EMAIL"));
        assertFalse(subject.getValue().toLowerCase().contains("vacademy"));
        assertFalse(body.getValue().toLowerCase().contains("vacademy"), body.getValue());
        assertFalse(body.getValue().contains("dash."), "no fallback admin link for NEUTRAL");
        assertTrue(body.getValue().contains("https://rzp.io/l/1"));
    }

    @Test
    void neutralUsesThePlatformSenderElseTheInstitutesOwnElseWithholds() {
        when(brand.resolve("i1")).thenReturn(BrandMode.NEUTRAL);
        // a name with no address would go out from the platform default (support@vacademy.io)
        cfg.setBillingFromEmail(null);
        assertEquals(0, mailer.send(mail("AI Pro")));
        verifyNoInteractions(notifications);
        // owner decision 2026-10-16: the platform billing sender is used even when it is a Vacademy address
        cfg.setBillingFromEmail("billing@vacademy.io");
        assertEquals(2, mailer.send(mail("AI Pro")));
        verify(notifications, times(2)).sendHtmlEmailViaUnified(anyString(), anyString(), anyString(), eq("i1"),
                eq("billing@vacademy.io"), anyString(), eq("UTILITY_EMAIL"));
        org.mockito.Mockito.clearInvocations(notifications);
        // the institute's own brand-free UTILITY_EMAIL sender: sent with no override
        cfg.setBillingFromEmail(null);
        inst.setSetting("{\"setting\":{\"EMAIL_SETTING\":{\"data\":{\"UTILITY_EMAIL\":"
                + "{\"from\":\"Inst One <office@inst.test>\"}}}}}");
        assertEquals(2, mailer.send(mail("AI Pro")));
        verify(notifications, times(2)).sendHtmlEmailViaUnified(anyString(), anyString(), anyString(), eq("i1"),
                isNull(), isNull(), eq("UTILITY_EMAIL"));
    }

    @Test
    void neutralEmailWithABrandWordIsWithheld() {
        when(brand.resolve("i1")).thenReturn(BrandMode.NEUTRAL);
        assertEquals(0, mailer.send(mail("Vacademy AI Pro")));
        verifyNoInteractions(notifications);
    }

    @Test
    void vacademyModeShowsTheTradeNameAndFallsBackToTheVacademyDashboard() {
        when(brand.resolve("i1")).thenReturn(BrandMode.VACADEMY);
        when(brand.adminLinkBase(any(), eq(BrandMode.VACADEMY))).thenReturn(null);
        mailer.send(mail("AI Pro"));
        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(notifications, atLeastOnce()).sendHtmlEmailViaUnified(anyString(), subject.capture(), body.capture(),
                anyString(), isNull(), isNull(), anyString());
        assertTrue(subject.getValue().startsWith("Vacademy: "));
        assertTrue(body.getValue().contains("https://dash.vacademy.io/settings"));
        assertTrue(body.getValue().contains("billing@vacademy.io"));
    }

    @Test
    void moneyUsesIndianGrouping() {
        assertEquals("₹5,900", AiPlansBillingMailer.money(590_000L, "INR"));
        assertEquals("₹1,25,000.50", AiPlansBillingMailer.money(12_500_050L, "INR"));
    }

    @Test
    void neverThrows() {
        when(brand.resolve("i1")).thenThrow(new RuntimeException("db down"));
        assertEquals(0, mailer.send(mail("AI Pro")));
    }
}
