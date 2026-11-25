package vacademy.io.admin_core_service.features.institute_import;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
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
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_import.service.InstituteImportService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.io.File;
import java.lang.reflect.Method;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Database-backed proof of the institute import on a local Postgres with the real Flyway chain
 * (V758) and Spring context. Skipped unless BREAKS_IT_PG_URL names a throwaway local database.
 * Accounts come from a stub of auth_service (one id per email, like the real lookup). With
 * IMPORT_PLAN_DIR set, the last test also imports a full converter plan from that folder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(InstituteImportDatabaseProofIT.CommerceHarness.class)
@EnabledIfEnvironmentVariable(named = "BREAKS_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class InstituteImportDatabaseProofIT {

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
    @Autowired private InstituteImportService importer;

    @MockBean private AuthService authService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final String run = UUID.randomUUID().toString().substring(0, 8);
    private final String inst = "imp-inst-" + run;
    private final Map<String, String> accounts = new ConcurrentHashMap<>();
    private final LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    @BeforeAll
    void seed() {
        db.update("INSERT INTO institutes (id, name) VALUES (?, ?)", inst, "Import proof " + run);
    }

    /** @MockBean stubs are reset after every test, so the auth stub is set before each one. */
    @org.junit.jupiter.api.BeforeEach
    void stubAuth() {
        when(authService.createUserFromAuthService(any(UserDTO.class), anyString(), anyBoolean())).thenAnswer(inv -> {
            UserDTO in = inv.getArgument(0);
            UserDTO out = new UserDTO();
            out.setId(accounts.computeIfAbsent(in.getEmail(), e -> "u-" + UUID.randomUUID()));
            out.setEmail(in.getEmail());
            return out;
        });
    }

    private Map<String, Object> step(String step, String json, boolean dryRun) throws Exception {
        return importer.run(inst, step, MAPPER.readTree(json), dryRun, "proof-admin");
    }

    private int count(String sql, Object... args) {
        Integer n = db.queryForObject(sql, Integer.class, args);
        return n == null ? 0 : n;
    }

    @Test
    @Order(1)
    void dryRunWritesNothing() throws Exception {
        Map<String, Object> r = step("courses", "{\"Kathak (Fast Paced)\":{\"art_form\":\"Kathak\",\"levels\":{\"Adya\":{\"months\":12}}}}", true);
        assertEquals(1, r.get("created"));
        assertEquals(0, count("SELECT COUNT(*) FROM package_institute WHERE institute_id = ?", inst));
        assertEquals(0, count("SELECT COUNT(*) FROM institute_import_ref WHERE institute_id = ?", inst));
        assertEquals(1, count("SELECT COUNT(*) FROM institute_import_run WHERE institute_id = ? AND dry_run", inst));
        assertFalse(importer.isEnabledFor(inst), "the import is off for an institute until switched on");
    }

    @Test
    @Order(2)
    void fullChainOnASmallSchool() throws Exception {
        String due = today.plusDays(10).toString();
        String past = today.minusDays(30).toString();
        Map<String, Object> staff = step("staff", """
                [{"external_id":"T1","full_name":"Teacher One","email":"T1@Example.com","vacademy_roles":["TEACHER"]},
                 {"external_id":"T2","full_name":"No Email"}]""", false);
        assertEquals(1, staff.get("created"));
        assertEquals(1, staff.get("skipped"));
        assertTrue(accounts.containsKey("t1@example.com"), "emails are lowercased before the account lookup");
        step("courses", "{\"Kathak (Fast Paced)\":{\"art_form\":\"Kathak\",\"levels\":{\"Adya\":{\"months\":12},\"Madya\":{\"months\":12}}}}", false);
        step("fee_plans", "[{\"name\":\"Group class\",\"months\":1,\"price\":2600,\"currency\":\"INR\"}]", false);
        step("batches", """
                [{"external_id":"B1","name":"T1-KT-ADYA-MO7PM","course":"Kathak (Fast Paced)","level":"Adya","teacher_external_id":"T1","active":true},
                 {"external_id":"B2","name":"T1-KT-ADYA-TU7PM","course":"Kathak (Fast Paced)","level":"Adya","teacher_external_id":"T1","active":true},
                 {"external_id":"B9","name":"Old batch","course":"Kathak (Fast Paced)","level":"Madya","active":false}]""", false);
        step("learners", """
                [{"external_id":"S1","reg_number":"Nr1","full_name":"Learner One","email":"s1@example.com","health_issues":"asthma"},
                 {"external_id":"S2","reg_number":"Nr2","full_name":"Learner Two","email":"s2@example.com"},
                 {"external_id":"S3","full_name":"No Email"}]""", false);
        Map<String, Object> enr = step("enrolments", """
                [{"external_id":"E1","student_external_id":"S1","batch_external_id":"B1","course":"Kathak (Fast Paced)","reg_number":"Nr1",
                  "admission_date":"2024-01-05","fee_plan":"Group class","every_months":1,"list_price":2600,"price":2125,"currency":"INR","next_payment_date":"%s"},
                 {"external_id":"E2","student_external_id":"S2","batch_external_id":"B1","course":"Kathak (Fast Paced)",
                  "admission_date":"2024-02-01","fee_plan":"Group class","every_months":1,"list_price":2600,"price":2600,"currency":"INR","next_payment_date":"%s","tag":"Suspended"},
                 {"external_id":"E3","student_external_id":"S2","batch_external_id":"B2","course":"Kathak (Fast Paced)",
                  "admission_date":"2024-02-01","fee_plan":"Group class","every_months":2,"price":5000,"currency":"INR","next_payment_date":"%s"},
                 {"external_id":"E4","student_external_id":"S3","batch_external_id":"B1","price":1,"next_payment_date":"%s"}]
                """.formatted(due, past, due, due), false);
        assertEquals(3, enr.get("created"));
        assertEquals(1, enr.get("failed"));   // S3 has no account

        // Member price locked only where it differs from the list price; the plan carries the list price.
        assertEquals(0, new java.math.BigDecimal("2125").compareTo(db.queryForObject(
                "SELECT up.regional_price FROM user_plan up JOIN institute_import_ref r ON r.internal_id = up.id WHERE r.institute_id = ? AND r.kind = 'ENROLMENT' AND r.external_id = 'E1'",
                java.math.BigDecimal.class, inst)));
        assertNull(db.queryForObject(
                "SELECT up.regional_price FROM user_plan up JOIN institute_import_ref r ON r.internal_id = up.id WHERE r.institute_id = ? AND r.kind = 'ENROLMENT' AND r.external_id = 'E2'",
                java.math.BigDecimal.class, inst));
        // A cycle with no fee plan (every 2 months) gets its own option and plan.
        assertEquals(1, count("SELECT COUNT(*) FROM institute_import_ref WHERE institute_id = ? AND kind = 'FEE_OPTION' AND external_id = '2'", inst));
        // Enrolment number = school's student number; teacher on both active batches; old batch hidden.
        assertEquals("Nr1", db.queryForObject("SELECT m.institute_enrollment_number FROM student_session_institute_group_mapping m JOIN institute_import_ref r ON r.internal_id = m.id WHERE r.institute_id = ? AND r.kind = 'ACCESS' AND r.external_id = 'E1'", String.class, inst));
        assertEquals(2, count("SELECT COUNT(*) FROM faculty_subject_package_session_mapping f JOIN institute_import_ref r ON r.internal_id = f.package_session_id WHERE r.institute_id = ? AND r.kind = 'BATCH'", inst));
        assertEquals("HIDDEN", db.queryForObject("SELECT ps.status FROM package_session ps JOIN institute_import_ref r ON r.internal_id = ps.id WHERE r.institute_id = ? AND r.kind = 'BATCH' AND r.external_id = 'B9'", String.class, inst));
        assertEquals(1, count("SELECT COUNT(*) FROM user_tags ut JOIN tags t ON t.id = ut.tag_id WHERE ut.institute_id = ? AND t.tag_name = 'Suspended'", inst));
        assertEquals("asthma", db.queryForObject("SELECT medical_conditions FROM student WHERE user_id = ?", String.class, accounts.get("s1@example.com")));

        // Breaks: an open pause switches off that batch only; past breaks come in ENDED; leave is not a break.
        Map<String, Object> br = step("breaks", """
                [{"enrollment_external_id":"E2","type":"Suspension","kind":"PAUSE","from":"%s","to":null,"remove_access":true},
                 {"enrollment_external_id":"E1","type":"Temporary Break","kind":"HOLD","from":"2025-01-01","to":"2025-01-20"},
                 {"enrollment_external_id":"E1","type":"Informed leave","kind":"LEAVE","from":"2025-02-01","to":"2025-02-01"}]
                """.formatted(past), false);
        assertEquals(2, br.get("created"));
        assertEquals(1, br.get("skipped"));
        assertEquals("INACTIVE", db.queryForObject("SELECT m.status FROM student_session_institute_group_mapping m JOIN institute_import_ref r ON r.internal_id = m.id WHERE r.institute_id = ? AND r.kind = 'ACCESS' AND r.external_id = 'E2'", String.class, inst));
        assertEquals("ACTIVE", db.queryForObject("SELECT m.status FROM student_session_institute_group_mapping m JOIN institute_import_ref r ON r.internal_id = m.id WHERE r.institute_id = ? AND r.kind = 'ACCESS' AND r.external_id = 'E3'", String.class, inst));
        assertEquals(1, count("SELECT COUNT(*) FROM enrolment_break WHERE institute_id = ? AND status = 'ACTIVE' AND kind = 'PAUSE' AND paused_access_ids IS NOT NULL", inst));
        assertEquals(1, count("SELECT COUNT(*) FROM enrolment_break WHERE institute_id = ? AND status = 'ENDED' AND kind = 'HOLD'", inst));

        // Extra class and payments.
        assertEquals(1, step("extra_classes", "[{\"student_external_id\":\"S1\",\"enrollment_external_id\":\"E1\",\"batch_external_id\":\"B2\",\"from\":\"%s\",\"to\":null}]".formatted(today), false).get("created"));
        assertEquals(1, step("payments", "[{\"ref\":\"P1\",\"invoice_number\":\"Inv1\",\"enrollment_external_id\":\"E1\",\"date\":\"2026-10-01\",\"amount\":2125,\"currency\":\"INR\",\"mode\":\"UPI\"}]", false).get("created"));
        assertEquals(1, count("SELECT COUNT(*) FROM payment_log WHERE vendor = 'OFFLINE' AND vendor_id = 'P1' AND payment_status = 'PAID'"));

        // Re-running every step changes nothing: no duplicates.
        int plans = count("SELECT COUNT(*) FROM user_plan WHERE enroll_invite_id IN (SELECT id FROM enroll_invite WHERE institute_id = ?)", inst);
        int access = count("SELECT COUNT(*) FROM student_session_institute_group_mapping WHERE institute_id = ?", inst);
        int breaks = count("SELECT COUNT(*) FROM enrolment_break WHERE institute_id = ?", inst);
        step("learners", "[{\"external_id\":\"S1\",\"full_name\":\"Learner One\",\"email\":\"s1@example.com\"}]", false);
        step("enrolments", """
                [{"external_id":"E1","student_external_id":"S1","batch_external_id":"B1","course":"Kathak (Fast Paced)",
                  "admission_date":"2024-01-05","every_months":1,"list_price":2600,"price":2125,"next_payment_date":"%s"}]""".formatted(due), false);
        step("breaks", "[{\"enrollment_external_id\":\"E2\",\"type\":\"Suspension\",\"kind\":\"PAUSE\",\"from\":\"%s\",\"to\":null}]".formatted(past), false);
        assertEquals(plans, count("SELECT COUNT(*) FROM user_plan WHERE enroll_invite_id IN (SELECT id FROM enroll_invite WHERE institute_id = ?)", inst));
        assertEquals(access, count("SELECT COUNT(*) FROM student_session_institute_group_mapping WHERE institute_id = ?", inst));
        assertEquals(breaks, count("SELECT COUNT(*) FROM enrolment_break WHERE institute_id = ?", inst));

        // Nothing was announced.
        verifyNoInteractions(workflowTriggerService, paymentNotificatonService, dynamicNotificationService);
        verify(authService, never()).createUserFromAuthService(any(), anyString(), eq(true));
    }

    @Test
    @Order(3)
    @EnabledIfEnvironmentVariable(named = "IMPORT_PLAN_DIR", matches = ".+")
    void fullConverterPlan() throws Exception {
        String dir = System.getenv("IMPORT_PLAN_DIR");
        String planInst = inst + "-plan";
        db.update("INSERT INTO institutes (id, name) VALUES (?, ?)", planInst, "Import plan proof " + run);
        String[][] steps = {{"staff", "01_staff.json"}, {"courses", "02_courses.json"}, {"fee_plans", "05_fee_plans.json"},
                {"batches", "04_batches.json"}, {"learners", "06_learners.json"}, {"enrolments", "07_enrolments.json"},
                {"breaks", "09_breaks.json"}, {"extra_classes", "08_extra_classes.json"}, {"payments", "12_payments.json"}};
        StringBuilder report = new StringBuilder();
        for (String[] s : steps) {
            JsonNode body = MAPPER.readTree(new File(dir, s[1]));
            Map<String, Object> r = importer.run(planInst, s[0], body, false, "proof-admin");
            report.append(String.format("%-14s requested=%s created=%s updated=%s skipped=%s failed=%s%n", s[0],
                    r.get("requested"), r.get("created"), r.get("updated"), r.get("skipped"), r.get("failed")));
            if (((Integer) r.get("failed")) > 0) {
                report.append("   first problems: ").append(MAPPER.writeValueAsString(((java.util.List<?>) r.get("problems")).subList(0, Math.min(5, ((java.util.List<?>) r.get("problems")).size())))).append('\n');
            }
        }
        report.append("access ACTIVE=").append(count("SELECT COUNT(*) FROM student_session_institute_group_mapping WHERE institute_id = ? AND status = 'ACTIVE'", planInst))
                .append(" INACTIVE=").append(count("SELECT COUNT(*) FROM student_session_institute_group_mapping WHERE institute_id = ? AND status = 'INACTIVE'", planInst))
                .append(" member prices=").append(count("SELECT COUNT(*) FROM user_plan WHERE regional_price IS NOT NULL AND enroll_invite_id IN (SELECT id FROM enroll_invite WHERE institute_id = ?)", planInst))
                .append(" active pauses=").append(count("SELECT COUNT(*) FROM enrolment_break WHERE institute_id = ? AND status = 'ACTIVE' AND kind = 'PAUSE'", planInst))
                .append('\n');
        System.out.println("=== IMPORT PLAN PROOF ===\n" + report);
        java.nio.file.Files.writeString(java.nio.file.Path.of(dir, "proof_result.txt"), report.toString());
        verifyNoInteractions(workflowTriggerService, paymentNotificatonService, dynamicNotificationService);
    }
}
