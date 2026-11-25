package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BiConsumer;

/**
 * Moves a school's data in from its old system, one step at a time, keyed on the school's own
 * IDs (institute_import_ref) so every step can be re-run: records already imported are updated
 * or left alone, never duplicated.
 *
 * <p>Order: staff → courses → fee_plans → batches → learners → enrolments → breaks →
 * extra_classes → payments → live_classes → attendance. A step whose prerequisites are missing reports each record as failed
 * with the reason; nothing is half-written, because every record is its own transaction.
 *
 * <p>Dry run (the default) does the whole step inside one transaction and rolls it back, so the
 * result shows exactly what a real run would do. Accounts are not created in a dry run (that call
 * leaves the database), so steps after "learners" can only be previewed once learners are real.
 *
 * <p>Nothing here sends a message: no welcome mail, enrolment notice, workflow or receipt.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InstituteImportService {

    public static final List<String> STEPS = List.of("staff", "courses", "fee_plans", "batches", "learners",
            "enrolments", "breaks", "extra_classes", "payments", "live_classes", "attendance");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final JdbcTemplate jdbc;
    private final PlatformTransactionManager transactionManager;
    private final ImportStructureSteps structure;
    private final ImportPeopleSteps people;
    private final ImportMembershipSteps membership;
    private final ImportLiveClassSteps liveClasses;
    private final EnrolmentBreakGuard breakGuard;

    public Map<String, Object> run(String instituteId, String step, JsonNode body, boolean dryRun, String runByUserId) {
        BiConsumer<ImportContext, JsonNode> handler = switch (step) {
            case "staff" -> people::staff;
            case "courses" -> structure::courses;
            case "fee_plans" -> structure::feePlans;
            case "batches" -> structure::batches;
            case "learners" -> people::learners;
            case "enrolments" -> membership::enrolments;
            case "breaks" -> membership::breaks;
            case "extra_classes" -> membership::extraClasses;
            case "payments" -> membership::payments;
            case "live_classes" -> liveClasses::liveClasses;
            case "attendance" -> liveClasses::attendance;
            default -> throw new VacademyException("Unknown import step '" + step + "'. Steps: " + STEPS);
        };
        if (body == null || !(body.isArray() || body.isObject())) {
            throw new VacademyException("Send the step's records as a JSON array (courses: an object)");
        }
        Integer exists = jdbc.queryForObject("SELECT COUNT(*) FROM institutes WHERE id = ?", Integer.class, instituteId);
        if (exists == null || exists == 0) throw new VacademyException("Institute not found");

        ImportContext ctx;
        if (dryRun) {
            ctx = new ImportContext(jdbc, null, instituteId, runByUserId, true);
            TransactionTemplate outer = new TransactionTemplate(transactionManager);
            outer.executeWithoutResult(status -> {
                handler.accept(ctx, body);
                status.setRollbackOnly();
            });
        } else {
            TransactionTemplate own = new TransactionTemplate(transactionManager);
            own.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            ctx = new ImportContext(jdbc, own, instituteId, runByUserId, false);
            handler.accept(ctx, body);
            if ("breaks".equals(step)) breakGuard.invalidate();
        }

        Map<String, Object> summary = ctx.summary(step);
        log.info("[institute-import] institute {} step {} dryRun={} requested={} created={} updated={} skipped={} failed={}",
                instituteId, step, dryRun, ctx.getRequested(), ctx.getCreated(), ctx.getUpdated(), ctx.getSkipped(), ctx.getFailed());
        saveRun(ctx, step, summary);
        return summary;
    }

    /** INSTITUTE_IMPORT_SETTING.data.enabled in the institute's settings; absent = off. */
    public boolean isEnabledFor(String instituteId) {
        List<String> json = jdbc.queryForList("SELECT setting_json FROM institutes WHERE id = ?", String.class, instituteId);
        if (json.isEmpty() || json.get(0) == null) return false;
        try {
            return MAPPER.readTree(json.get(0)).path("setting").path("INSTITUTE_IMPORT_SETTING").path("data").path("enabled").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    private void saveRun(ImportContext ctx, String step, Map<String, Object> summary) {
        try {
            jdbc.update("""
                    INSERT INTO institute_import_run (id, institute_id, step, dry_run, requested, created, updated, skipped, failed, result_json, run_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID().toString(), ctx.getInstituteId(), step, ctx.isDryRun(), ctx.getRequested(),
                    ctx.getCreated(), ctx.getUpdated(), ctx.getSkipped(), ctx.getFailed(),
                    MAPPER.writeValueAsString(summary), ctx.getRunByUserId());
        } catch (Exception e) {
            log.warn("[institute-import] could not save run log: {}", e.getMessage());
        }
    }
}
