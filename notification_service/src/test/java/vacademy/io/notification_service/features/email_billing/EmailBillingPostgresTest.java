package vacademy.io.notification_service.features.email_billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.service.EmailService;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The email-billing SQL against a real Postgres with the V40 schema. Runs only when
 * EMAIL_BILLING_PG_URL points at a scratch database (e.g. jdbc:postgresql://localhost:55433/billing_test);
 * it truncates the email-billing tables there.
 */
class EmailBillingPostgresTest {

    private static final String INST = "inst-pg";
    private static final String EXEMPT = "inst-exempt";

    private JdbcTemplate jdbc;
    private TransactionTemplate tx;
    private CreditLedgerClient ledger;
    private EmailUsageStore store;
    private String month;

    @BeforeEach
    void setUp() {
        String url = System.getenv("EMAIL_BILLING_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "EMAIL_BILLING_PG_URL not set");
        DriverManagerDataSource ds = new DriverManagerDataSource(url, "postgres", "");
        jdbc = new JdbcTemplate(ds);
        tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        jdbc.execute("TRUNCATE email_usage_daily, email_billing_month, email_billing_charge, email_blocked, "
                + "email_billing_exemption");
        jdbc.update("UPDATE email_billing_settings SET enforce_enabled = TRUE, charge_enabled = TRUE, "
                + "notify_enabled = FALSE, free_units_per_month = 1000, credits_per_unit = 0.04 WHERE id = 1");
        ledger = mock(CreditLedgerClient.class);
        store = new EmailUsageStore(jdbc);
        month = EmailBillingSettings.currentMonth();
    }

    private EmailBillingSettings settings() {
        return new EmailBillingSettings(jdbc); // fresh: no cached switches
    }

    private EmailBillingGate gate() {
        return new EmailBillingGate(settings(), store, ledger);
    }

    private EmailBillingChargeJob job() {
        return new EmailBillingChargeJob(jdbc, tx, settings(), ledger, mock(EmailBillingNotifier.class));
    }

    private void send(String institute, EmailBillingClass cls, int units, int times) {
        for (int i = 0; i < times; i++) {
            store.recordSent(institute, cls, units);
        }
    }

    @Test
    void usageIsCountedPerDayClassAndMonth() {
        send(INST, EmailBillingClass.BILLABLE, 10, 3);
        send(INST, EmailBillingClass.ESSENTIAL, 1, 2);
        send(INST, EmailBillingClass.FREE, 1, 4);
        send(INST, EmailBillingClass.EXCLUDED, 1, 1);

        EmailUsageStore.MonthTotals t = store.monthTotals(INST, month);
        assertEquals(32, t.chargeableUnits()); // BILLABLE + ESSENTIAL only
        List<EmailUsageStore.DailyRow> days = store.daily(INST, EmailBillingSettings.today(), EmailBillingSettings.today());
        assertEquals(4, days.size());
        assertEquals(3, days.stream().filter(d -> d.billingClass().equals("BILLABLE")).findFirst().orElseThrow().emails());
    }

    @Test
    void gateUsesFreeAllowanceThenWalletLessUnchargedUsage() {
        when(ledger.balance(INST)).thenReturn(Optional.of(new BigDecimal("1.00")));
        send(INST, EmailBillingClass.BILLABLE, 1, 1000);
        assertTrue(gate().allows(INST, EmailBillingClass.BILLABLE, 1));

        send(INST, EmailBillingClass.BILLABLE, 1, 20); // 0.80 uncharged
        assertTrue(gate().allows(INST, EmailBillingClass.BILLABLE, 1));
        send(INST, EmailBillingClass.BILLABLE, 1, 10); // 1.20 uncharged > 1.00
        assertFalse(gate().allows(INST, EmailBillingClass.BILLABLE, 1));
        assertTrue(gate().allows(INST, EmailBillingClass.ESSENTIAL, 1));
    }

    @Test
    void theJobChargesOnceAndRetriesWithTheSameKey() {
        send(INST, EmailBillingClass.BILLABLE, 1, 1030);
        when(ledger.charge(eq(INST), any(), anyLong(), anyString(), anyString())).thenReturn(false, true);

        job().run();
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM email_billing_charge");
        assertEquals("PENDING", row.get("status"));
        assertEquals(0, ((BigDecimal) row.get("credits")).compareTo(new BigDecimal("1.20")));
        assertEquals(30L, store.monthTotals(INST, month).chargedUnits());

        job().run(); // retry, no new usage
        job().run(); // nothing left
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM email_billing_charge", Integer.class));
        assertEquals("CHARGED", jdbc.queryForObject("SELECT status FROM email_billing_charge", String.class));
        String key = "email:" + INST + ":" + month + ":0-30";
        verify(ledger, times(2)).charge(INST, new BigDecimal("1.20"), 30L, month, key);

        send(INST, EmailBillingClass.ESSENTIAL, 1, 5);
        job().run();
        verify(ledger).charge(INST, new BigDecimal("0.20"), 5L, month, "email:" + INST + ":" + month + ":30-35");
    }

    @Test
    void exemptInstitutesAreWrittenOffNotCharged() {
        jdbc.update("INSERT INTO email_billing_exemption (institute_id, reason) VALUES (?, 'deal')", EXEMPT);
        send(EXEMPT, EmailBillingClass.BILLABLE, 1, 1100);
        when(ledger.balance(EXEMPT)).thenReturn(Optional.of(BigDecimal.ZERO));

        assertTrue(gate().allows(EXEMPT, EmailBillingClass.BILLABLE, 1));
        job().run();

        verify(ledger, never()).charge(any(), any(), anyLong(), any(), any());
        assertEquals(100L, store.monthTotals(EXEMPT, month).chargedUnits());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM email_billing_charge", Integer.class));
    }

    @Test
    void chargingOffMeansNoCharges() {
        jdbc.update("UPDATE email_billing_settings SET charge_enabled = FALSE");
        send(INST, EmailBillingClass.BILLABLE, 1, 1500);
        job().run();
        verifyNoInteractions(ledger);
        assertEquals(0L, store.monthTotals(INST, month).chargedUnits());
    }

    @Test
    void blockedEmailsAreKeptListedAndResolvedOnce() {
        BlockedEmailStore blocked = new BlockedEmailStore(jdbc, new ObjectMapper(), mock(ApplicationEventPublisher.class));
        blocked.save(INST, "a@gmail.com", List.of("acc@x.com"), "BCC", "Subj", "<p>b</p>", "UTILITY_EMAIL",
                "unified-send", null, null, "u1", Map.of("r.pdf", new byte[]{1, 2, 3}), 2);
        blocked.save(INST, "b@gmail.com", null, null, "Big", "<p>b</p>", null, "unified-send", null, null, null,
                Map.of("huge.pdf", new byte[(int) BlockedEmailStore.MAX_KEPT_ATTACHMENT_BYTES + 1]), 12);

        assertEquals(2, blocked.count(INST, "BLOCKED"));
        BlockedEmailStore.BlockedEmail small = blocked.list(INST, "BLOCKED", 10, 0).stream()
                .filter(b -> b.toEmail().equals("a@gmail.com")).findFirst().orElseThrow();
        assertArrayEquals(new byte[]{1, 2, 3}, small.attachments().get("r.pdf"));
        assertEquals(List.of("acc@x.com"), small.cc());
        assertTrue(blocked.list(INST, "BLOCKED", 10, 0).stream().anyMatch(BlockedEmailStore.BlockedEmail::attachmentsDropped));

        assertTrue(blocked.resolve(INST, small.id(), "RESENT"));
        assertFalse(blocked.resolve(INST, small.id(), "DISCARDED"));
        assertFalse(blocked.resolve("other-inst", small.id(), "DISCARDED"));
        assertEquals(1, blocked.count(INST, "BLOCKED"));
    }

    @Test
    void noticesGoOutOncePerWindowAndThreshold() {
        jdbc.update("UPDATE email_billing_settings SET notify_enabled = TRUE");
        InstituteInternalService institutes = mock(InstituteInternalService.class);
        InstituteInfoDTO info = new InstituteInfoDTO();
        info.setEmail("office@school.in");
        info.setInstituteName("School");
        when(institutes.getInstituteByInstituteId(INST)).thenReturn(info);
        EmailService email = mock(EmailService.class);
        EmailBillingNotifier notifier = new EmailBillingNotifier(jdbc, settings(), institutes, email);
        org.springframework.test.util.ReflectionTestUtils.setField(notifier, "defaultDashboardUrl", "https://dash.vacademy.io");

        notifier.onEmailBlocked(new BlockedEmailStore.EmailBlockedEvent(INST));
        notifier.onEmailBlocked(new BlockedEmailStore.EmailBlockedEvent(INST));
        verify(email, times(1)).sendHtmlEmail(eq("office@school.in"), contains("paused"), eq("EMAIL_BILLING_NOTICE"),
                contains("settings?selectedTab=emailUsage"), eq(INST), isNull(), isNull(), eq("UTILITY_EMAIL"),
                isNull(), isNull(), isNull(), isNull(), eq(EmailBillingClass.FREE));

        send(INST, EmailBillingClass.BILLABLE, 1, 850);
        notifier.sendAllowanceNotices(settings().get());
        notifier.sendAllowanceNotices(settings().get());
        verify(email, times(1)).sendHtmlEmail(any(), contains("80%"), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
        verify(email, never()).sendHtmlEmail(any(), contains("used up"), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
    }
}
