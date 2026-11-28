package vacademy.io.admin_core_service.features.fee_reminder;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportSelector;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.user_subscription.dto.ChangeMemberPriceRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.MemberPriceResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.AdminManualRenewalService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Database-backed proof of the payment reminder schedule and member price on a local Postgres
 * with the real Flyway chain (V750) and Spring context. Skipped unless BREAKS_IT_PG_URL names a
 * throwaway local database (same harness as EnrolmentBreakDatabaseProofIT).
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(FeeReminderDatabaseProofIT.CommerceHarness.class)
@EnabledIfEnvironmentVariable(named = "BREAKS_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class FeeReminderDatabaseProofIT {

    static class CommerceHarness implements ImportSelector {
        @Override
        public String[] selectImports(AnnotationMetadata metadata) {
            return new String[] { "vacademy.io.admin_core_service.features.commerce.CommerceM1DatabaseProofIT$LocalOnly" };
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) throws Exception {
        Class<?> c = Class.forName("vacademy.io.admin_core_service.features.commerce.CommerceM1DatabaseProofIT");
        Method m = c.getDeclaredMethod("database", DynamicPropertyRegistry.class);
        m.setAccessible(true);
        m.invoke(null, registry);
    }

    @Autowired private JdbcTemplate db;
    @Autowired private FeeReminderService service;
    @Autowired private AdminManualRenewalService renewalService;
    @Autowired private EnrolmentBreakGuard guard;

    @MockBean private AuthService authService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private InvoiceService invoiceService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final String run = UUID.randomUUID().toString().substring(0, 8);
    private final String inst = "fr-inst-" + run;
    private final String invite = "fr-inv-" + run;
    private LocalDate today;

    private static vacademy.io.common.auth.model.CustomUserDetails admin() {
        vacademy.io.common.auth.model.CustomUserDetails a = mock(vacademy.io.common.auth.model.CustomUserDetails.class);
        when(a.getUserId()).thenReturn("proof-admin");
        when(a.getUsername()).thenReturn("proof-admin");
        when(a.getFullName()).thenReturn("Proof Admin");
        return a;
    }

    private String plan(String suffix, LocalDate due, boolean autopay) {
        String id = "fr-plan-" + suffix + "-" + run;
        db.update("INSERT INTO user_plan (id, user_id, status, start_date, end_date, auto_renewal_enabled, enroll_invite_id, "
                        + "payment_option_id, plan_id, quantity) VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, 1)",
                id, "fr-user-" + suffix + "-" + run, Timestamp.valueOf(due.minusDays(30).atStartOfDay()),
                Timestamp.valueOf(due.atTime(23, 59, 59)), autopay, invite, "fr-po-" + run, "fr-pp-" + run);
        return id;
    }

    @BeforeAll
    void seed() {
        today = LocalDate.now(IST);
        String setting = "{\"setting\":{\"FEE_REMINDER_SETTING\":{\"key\":\"FEE_REMINDER_SETTING\",\"name\":\"Payment reminders\","
                + "\"data\":{\"enabled\":true,\"days_before\":[7],\"on_due_date\":true,\"overdue_every_days\":2,"
                + "\"red_list_after_days\":15,\"send_hour\":0}}}}";
        db.update("INSERT INTO institutes (id, name, setting_json, learner_portal_base_url) VALUES (?, ?, ?, ?)",
                inst, "Reminder proof " + run, setting, "learn.example.com");
        db.update("INSERT INTO enroll_invite (id, name, institute_id, status) VALUES (?, 'Monthly', ?, 'ACTIVE')", invite, inst);
        db.update("INSERT INTO payment_option (id, name, type, status) VALUES (?, 'Monthly', 'SUBSCRIPTION', 'ACTIVE')", "fr-po-" + run);
        db.update("INSERT INTO payment_plan (id, name, status, validity_in_days, actual_price, elevated_price, currency, payment_option_id) "
                + "VALUES (?, 'Monthly', 'ACTIVE', 30, 2600, 2600, 'INR', ?)", "fr-pp-" + run, "fr-po-" + run);
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            return ids.stream().map(uid -> {
                UserDTO u = new UserDTO();
                u.setId(uid);
                u.setUsername("u_" + uid);
                u.setFullName("Learner " + uid);
                return u;
            }).toList();
        });
    }

    @Test
    @Order(1)
    void stepsFireOnTheRightDaysAndOnlyOnce() {
        plan("before7", today.plusDays(7), false);
        plan("before6", today.plusDays(6), false);      // nothing today
        plan("due", today, false);
        plan("over4", today.minusDays(4), false);
        plan("over3", today.minusDays(3), false);       // odd day: nothing
        plan("red", today.minusDays(15), false);        // 15 is odd: no overdue step, but red list
        plan("autopay", today, true);                   // autopay skipped by default
        String held = plan("held", today, false);
        db.update("INSERT INTO enrolment_break (id, institute_id, user_id, user_plan_id, kind, stop_class_reminders, "
                        + "stop_fee_reminders, remove_access, starts_on, ends_on, status) VALUES (?, ?, ?, ?, 'HOLD', true, true, false, ?, ?, 'ACTIVE')",
                "fr-brk-" + run, inst, "fr-user-held-" + run, held, Date.valueOf(today.minusDays(1)), Date.valueOf(today.plusDays(3)));
        guard.invalidate();

        FeeReminderService.InstituteRow row = service.institutesWithSchedule().stream()
                .filter(r -> r.id().equals(inst)).findFirst().orElseThrow();
        int fired = service.runInstitute(row, today, IST);

        ArgumentCaptor<String> event = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> eventId = ArgumentCaptor.forClass(String.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> ctx = ArgumentCaptor.forClass(Map.class);
        verify(workflowTriggerService, times(4)).handleTriggerEvents(event.capture(), eventId.capture(), eq(inst), ctx.capture());
        assertEquals(4, fired);
        List<String> steps = ctx.getAllValues().stream().map(c -> (String) c.get("step")).sorted().toList();
        assertEquals(List.of("BEFORE_7", "DUE", "OVERDUE_4", "RED_LIST"), steps);
        assertTrue(event.getAllValues().contains("MEMBERSHIP_PAYMENT_RED_LIST"));
        Map<String, Object> due = ctx.getAllValues().stream().filter(c -> "DUE".equals(c.get("step"))).findFirst().orElseThrow();
        assertEquals("2600", due.get("amount"));
        assertEquals("INR", due.get("currency"));
        assertEquals("https://learn.example.com/subscriptions/u_fr-user-due-" + run, due.get("payLink"));
        assertEquals(today.toString(), due.get("dueDate"));

        // A second pass the same day sends nothing again.
        reset(workflowTriggerService);
        assertEquals(0, service.runInstitute(row, today, IST));
        verify(workflowTriggerService, never()).handleTriggerEvents(any(), any(), any(), any());
    }

    @Test
    @Order(2)
    void memberPriceIsWhatTheNextReminderAsksFor() {
        String p = plan("price", today.plusDays(7), false);
        MemberPriceResultDTO r = renewalService.changeMemberPrice(p, inst,
                ChangeMemberPriceRequestDTO.builder().price(new BigDecimal("2125")).remarks("joined at the old rate").build(), admin());
        assertEquals(0, new BigDecimal("2125").compareTo(r.getNewPrice()));
        assertEquals(0, new BigDecimal("2600").compareTo(r.getListPrice()));
        assertFalse(r.isUsesListPrice());
        assertEquals("INR", db.queryForObject("SELECT regional_currency FROM user_plan WHERE id = ?", String.class, p));

        reset(workflowTriggerService);
        FeeReminderService.InstituteRow row = service.institutesWithSchedule().stream()
                .filter(x -> x.id().equals(inst)).findFirst().orElseThrow();
        service.runInstitute(row, today, IST);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> ctx = ArgumentCaptor.forClass(Map.class);
        verify(workflowTriggerService, atLeastOnce()).handleTriggerEvents(any(), any(), eq(inst), ctx.capture());
        Map<String, Object> mine = ctx.getAllValues().stream().filter(c -> p.equals(c.get("userPlanId"))).findFirst().orElseThrow();
        assertEquals("2125", mine.get("amount"));

        // Back to the list price clears the lock.
        MemberPriceResultDTO back = renewalService.changeMemberPrice(p, inst,
                ChangeMemberPriceRequestDTO.builder().price(null).remarks("standardised").build(), admin());
        assertTrue(back.isUsesListPrice());
        assertNull(db.queryForObject("SELECT regional_price FROM user_plan WHERE id = ?", BigDecimal.class, p));
    }
}
