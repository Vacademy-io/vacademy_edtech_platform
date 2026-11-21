package vacademy.io.admin_core_service.features.enrolment_break;

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
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enrolment_break.dto.BreakPreviewDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakEndRequestDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakRequestDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.LearnerBreaksDTO;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard.Category;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Method;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Database-backed proof of breaks and holds (docs/ENROLMENT_BREAKS.md) on a local Postgres with the
 * real Flyway chain and the real Spring context: create, preview, pause (access row off, billing
 * skipped, reminders held), resume with dates moved by the days paused (membership end, next charge,
 * access expiry, unpaid instalments; a paid instalment and an abandoned-cart row left alone), the
 * hourly sweep's scheduled start and end, cancel, and an institute with the switch off refused.
 *
 * <p>Skipped unless BREAKS_IT_PG_URL names a throwaway database on this machine that already holds
 * the migrated schema (same harness as the commerce proofs). It writes rows and leaves them.
 * <pre>
 * BREAKS_IT_PG_URL=jdbc:postgresql://127.0.0.1:55471/breaksit COMMERCE_IT_PG_URL=$BREAKS_IT_PG_URL \
 *   mvn -pl admin_core_service -am test -o -Dsentry.skip=true -Dsurefire.failIfNoSpecifiedTests=false \
 *   -Dtest=EnrolmentBreakDatabaseProofIT -Denvironment=stage
 * </pre>
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(EnrolmentBreakDatabaseProofIT.CommerceHarness.class)
@org.springframework.boot.test.autoconfigure.filter.TypeExcludeFilters(EnrolmentBreakDatabaseProofIT.OtherProofConfigs.class)
@EnabledIfEnvironmentVariable(named = "BREAKS_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class EnrolmentBreakDatabaseProofIT {

    /**
     * Other proofs nest their own @Configuration (one declares a second dataSource); component scanning
     * of the application would pick them up. Keep every test class's nested configuration out of this
     * context; the commerce harness below is imported explicitly.
     */
    static class OtherProofConfigs extends org.springframework.boot.context.TypeExcludeFilter {
        @Override
        public boolean match(org.springframework.core.type.classreading.MetadataReader reader,
                             org.springframework.core.type.classreading.MetadataReaderFactory factory) {
            String name = reader.getClassMetadata().getClassName();
            int dollar = name.indexOf('$');
            if (dollar < 0) return false;
            String outer = name.substring(0, dollar);
            return (outer.endsWith("IT") || outer.endsWith("Test")) && !outer.endsWith("EnrolmentBreakDatabaseProofIT");
        }

        @Override
        public boolean equals(Object o) { return o != null && o.getClass() == getClass(); }

        @Override
        public int hashCode() { return getClass().hashCode(); }
    }

    /** Reuses the commerce proof's no-jobs / local-only configuration (package-private there). */
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
    @Autowired private EnrolmentBreakService service;
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
    private final String inst = "inst-" + run;
    private final String instOff = "instoff-" + run;
    private final String user = "user-" + run;
    private final String other = "other-" + run;
    private final String ps = "ps-" + run;
    private final String plan = "plan-" + run;
    private final String row = "ssigm-" + run;
    private final String cartRow = "cart-" + run;
    private final String otherRow = "ssigm-other-" + run;
    private final String sfpUnpaid = "sfp-u-" + run;
    private final String sfpPaid = "sfp-p-" + run;
    private LocalDate today;

    @BeforeAll
    void seed() {
        today = LocalDate.now(IST);
        String on = "{\"setting\":{\"ENROLMENT_BREAK_SETTING\":{\"key\":\"ENROLMENT_BREAK_SETTING\",\"name\":\"Breaks\",\"data\":{\"enabled\":true}}}}";
        db.update("INSERT INTO institutes (id, name, setting_json) VALUES (?, ?, ?)", inst, "Breaks proof " + run, on);
        db.update("INSERT INTO institutes (id, name, setting_json) VALUES (?, ?, ?)", instOff, "Breaks off " + run, "{}");
        db.update("INSERT INTO package (id, package_name, status) VALUES (?, ?, 'ACTIVE')", "pk-" + run, "Bharatanatyam");
        db.update("INSERT INTO level (id, level_name) VALUES (?, 'Adya')", "lv-" + run);
        db.update("INSERT INTO session (id, session_name) VALUES (?, 'Tue & Wed 9 AM')", "se-" + run);
        db.update("INSERT INTO package_session (id, package_id, level_id, session_id, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
                ps, "pk-" + run, "lv-" + run, "se-" + run);
        db.update("INSERT INTO payment_option (id, name, type, status) VALUES (?, 'Monthly', 'CPO', 'ACTIVE')", "po-" + run);
        Timestamp end = Timestamp.valueOf(today.plusDays(20).atTime(23, 59, 59));
        db.update("INSERT INTO user_plan (id, user_id, status, start_date, end_date, next_charge_at, auto_renewal_enabled, "
                        + "payment_option_id, quantity) VALUES (?, ?, 'ACTIVE', ?, ?, ?, true, ?, 1)",
                plan, user, Timestamp.valueOf(today.minusDays(10).atStartOfDay()), end, end, "po-" + run);
        db.update("INSERT INTO student_session_institute_group_mapping (id, user_id, institute_id, package_session_id, status, "
                        + "expiry_date, user_plan_id, enrolled_date) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)",
                row, user, inst, ps, end, plan, Timestamp.valueOf(today.minusDays(10).atStartOfDay()));
        // An abandoned checkout row for the same course: never treated as a live enrolment.
        db.update("INSERT INTO student_session_institute_group_mapping (id, user_id, institute_id, package_session_id, status, "
                + "type) VALUES (?, ?, ?, ?, 'ACTIVE', 'ABANDONED_CART')", cartRow, user, inst, ps);
        // Another learner in the same course: must never be touched.
        db.update("INSERT INTO student_session_institute_group_mapping (id, user_id, institute_id, package_session_id, status, "
                + "expiry_date) VALUES (?, ?, ?, ?, 'ACTIVE', ?)", otherRow, other, inst, ps, end);
        db.update("INSERT INTO complex_payment_option (id, name, institute_id) VALUES (?, 'Monthly fee', ?)", "cpo-" + run, inst);
        db.update("INSERT INTO fee_type (id, name, code, cpo_id) VALUES (?, 'Tuition', 'TUITION', ?)", "ft-" + run, "cpo-" + run);
        db.update("INSERT INTO assigned_fee_value (id, fee_type_id, amount) VALUES (?, ?, 2600)", "asv-" + run, "ft-" + run);
        db.update("INSERT INTO student_fee_payment (id, user_id, user_plan_id, cpo_id, asv_id, amount_expected, status, due_date, "
                        + "start_date) VALUES (?, ?, ?, 'cpo-" + run + "', 'asv-" + run + "', 2600, 'PENDING', ?, ?)",
                sfpUnpaid, user, plan, Date.valueOf(today.plusDays(10)), Date.valueOf(today.plusDays(10)));
        db.update("INSERT INTO student_fee_payment (id, user_id, user_plan_id, cpo_id, asv_id, amount_expected, status, due_date) "
                + "VALUES (?, ?, ?, 'cpo-" + run + "', 'asv-" + run + "', 2600, 'PAID', ?)", sfpPaid, user, plan, Date.valueOf(today.minusDays(20)));
    }

    private EnrolmentBreakRequestDTO req(String kind, String course, LocalDate from, LocalDate to) {
        return EnrolmentBreakRequestDTO.builder().userId(user).kind(kind).packageSessionId(course)
                .startsOn(from).endsOn(to).reason("TRAVEL").note("proof").build();
    }

    @Test
    @Order(1)
    void learnerViewListsTheCourseWithItsMembership() {
        LearnerBreaksDTO view = service.forLearner(user, inst);
        assertTrue(view.isEnabled());
        assertEquals(1, view.getCourses().size(), "the abandoned cart row is not a course");
        assertEquals("Bharatanatyam · Adya · Tue & Wed 9 AM", view.getCourses().get(0).getCourseLabel());
        assertEquals(plan, view.getCourses().get(0).getUserPlanId());
        assertEquals(1, view.getCourses().get(0).getUnpaidInstalments());
        assertTrue(view.getBreaks().isEmpty());
    }

    @Test
    @Order(2)
    void previewWorksOutTheDatesAndSavesNothing() {
        BreakPreviewDTO p = service.preview(req("PAUSE", ps, today, today.plusDays(9)), inst);
        assertTrue(p.getBlockers().isEmpty(), p.getBlockers().toString());
        assertEquals(10, p.getDays());
        assertTrue(p.isStopBilling());
        assertTrue(p.getWarnings().contains("AUTOPAY_ON"));
        assertTrue(p.getWarnings().contains("INSTALMENTS_MOVE_ON_RESUME"));
        assertEquals(Timestamp.valueOf(today.plusDays(30).atTime(23, 59, 59)).getTime(), p.getPlanEndAfter().getTime());
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM enrolment_break WHERE user_id = ?", Integer.class, user));

        BreakPreviewDTO bad = service.preview(req("PAUSE", null, today.minusDays(1), today.minusDays(3)), inst);
        assertTrue(bad.getBlockers().containsAll(java.util.List.of("PAUSE_NEEDS_COURSE", "START_IN_PAST", "END_BEFORE_START")));
    }

    @Test
    @Order(3)
    void switchedOffInstituteIsRefused() {
        assertThrows(VacademyException.class, () -> service.create(req("HOLD", null, today, today.plusDays(3)), instOff, null));
    }

    @Test
    @Order(4)
    void pauseSwitchesOnlyThisLearnersAccessOffAndHoldsRemindersAndBilling() {
        EnrolmentBreakDTO b = service.create(req("PAUSE", ps, today, today.plusDays(9)), inst, null);
        assertEquals("ACTIVE", b.getStatus());
        assertEquals(plan, b.getUserPlanId());
        assertEquals("INACTIVE", status(row));
        assertEquals("ACTIVE", status(cartRow), "the cart row is not ours to switch");
        assertEquals("ACTIVE", status(otherRow), "another learner is never touched");
        assertEquals(row, db.queryForObject("SELECT paused_access_ids FROM enrolment_break WHERE id = ?", String.class, b.getId()));
        assertTrue(guard.isPlanPaused(plan));
        assertTrue(guard.isHeld(inst, user, Category.CLASS, ps, null));
        assertTrue(guard.isFeeHeldForPlan(inst, user, plan));
        assertFalse(guard.isHeld(inst, other, Category.CLASS, ps, null));
        assertTrue(guard.isCourseAccessPaused(user, ps));
        // The paused course still shows in the panel (so it can be resumed).
        assertEquals("INACTIVE", service.forLearner(user, inst).getCourses().get(0).getAccessStatus());
        // A second break on the same dates is refused.
        assertThrows(VacademyException.class, () -> service.create(req("HOLD", ps, today.plusDays(2), today.plusDays(4)), inst, null));
    }

    @Test
    @Order(5)
    void resumeMovesEveryDateByTheDaysPausedAndTurnsAccessBackOn() {
        String id = db.queryForObject("SELECT id FROM enrolment_break WHERE user_id = ? AND status = 'ACTIVE'", String.class, user);
        // Pretend the pause began 10 days ago.
        db.update("UPDATE enrolment_break SET starts_on = ? WHERE id = ?", Date.valueOf(today.minusDays(10)), id);
        guard.invalidate();

        BreakPreviewDTO p = service.endPreview(id, null, inst);
        assertEquals(10, p.getPausedDays());
        assertEquals(1, p.getUnpaidInstalmentsMoved());

        EnrolmentBreakDTO ended = service.end(id, EnrolmentBreakEndRequestDTO.builder()
                .resumeMode("SHIFT_BY_PAUSED_DAYS").note("back from travel").build(), inst, null);
        assertEquals("ENDED", ended.getStatus());
        assertEquals(10, ended.getShiftedDays());

        Timestamp expected = Timestamp.valueOf(today.plusDays(30).atTime(23, 59, 59));
        assertEquals(expected, db.queryForObject("SELECT end_date FROM user_plan WHERE id = ?", Timestamp.class, plan));
        assertEquals(expected, db.queryForObject("SELECT next_charge_at FROM user_plan WHERE id = ?", Timestamp.class, plan));
        assertEquals("ACTIVE", status(row));
        assertEquals(expected, db.queryForObject("SELECT expiry_date FROM student_session_institute_group_mapping WHERE id = ?",
                Timestamp.class, row));
        assertEquals(Date.valueOf(today.plusDays(20)), db.queryForObject("SELECT due_date FROM student_fee_payment WHERE id = ?",
                Date.class, sfpUnpaid));
        assertEquals(Date.valueOf(today.minusDays(20)), db.queryForObject("SELECT due_date FROM student_fee_payment WHERE id = ?",
                Date.class, sfpPaid), "a paid instalment never moves");
        assertFalse(guard.isPlanPaused(plan));
        assertTrue(db.queryForObject("SELECT COUNT(*) FROM timeline_event WHERE type = 'ENROLMENT_BREAK' AND type_id = ?",
                Integer.class, user) >= 2);
    }

    @Test
    @Order(6)
    void hourlySweepStartsAndEndsScheduledBreaks() {
        EnrolmentBreakDTO b = service.create(req("HOLD", null, today.plusDays(1), today.plusDays(3)), inst, null);
        assertEquals("SCHEDULED", b.getStatus());
        assertFalse(guard.isHeld(inst, user, Category.FEE, null, plan), "starts tomorrow");
        service.sweep();
        assertEquals("SCHEDULED", breakStatus(b.getId()));

        db.update("UPDATE enrolment_break SET starts_on = ?, ends_on = ? WHERE id = ?",
                Date.valueOf(today), Date.valueOf(today.plusDays(2)), b.getId());
        guard.invalidate();
        service.sweep();
        assertEquals("ACTIVE", breakStatus(b.getId()));
        assertTrue(guard.isHeld(inst, user, Category.FEE, null, plan));
        assertEquals("ACTIVE", status(row), "a hold never touches access");

        db.update("UPDATE enrolment_break SET starts_on = ?, ends_on = ? WHERE id = ?",
                Date.valueOf(today.minusDays(5)), Date.valueOf(today.minusDays(1)), b.getId());
        guard.invalidate();
        service.sweep();
        Map<String, Object> r = db.queryForMap("SELECT status, end_kind FROM enrolment_break WHERE id = ?", b.getId());
        assertEquals("ENDED", r.get("status"));
        assertEquals("SCHEDULED", r.get("end_kind"));
        assertFalse(guard.isHeld(inst, user, Category.FEE, null, plan));
    }

    @Test
    @Order(7)
    void scheduledBreakCanBeCancelledButARunningOneCannot() {
        EnrolmentBreakDTO b = service.create(req("HOLD", ps, today.plusDays(5), today.plusDays(8)), inst, null);
        assertEquals("CANCELLED", service.cancel(b.getId(), inst, null).getStatus());
        assertThrows(VacademyException.class, () -> service.cancel(b.getId(), inst, null));
        // Another institute cannot see or touch it.
        assertThrows(VacademyException.class, () -> service.cancel(b.getId(), instOff, null));
    }

    private String status(String mappingId) {
        return db.queryForObject("SELECT status FROM student_session_institute_group_mapping WHERE id = ?", String.class, mappingId);
    }

    private String breakStatus(String id) {
        return db.queryForObject("SELECT status FROM enrolment_break WHERE id = ?", String.class, id);
    }
}
