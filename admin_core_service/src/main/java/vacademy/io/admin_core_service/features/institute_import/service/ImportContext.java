package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * One run of one import step: the institute, who runs it, whether it is a dry run, the
 * (kind, external id) → row map that makes re-runs update instead of duplicate, and the tally.
 */
@Getter
public class ImportContext {

    /** All dates in the source are the school's local dates; Nrithya runs everything in IST. */
    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final String instituteId;
    private final String runByUserId;
    private final boolean dryRun;
    private final LocalDate today = LocalDate.now(ZONE);

    private int requested, created, updated, skipped, failed;
    private final List<Map<String, Object>> problems = new ArrayList<>();

    /** Real run: each record commits on its own transaction. Unused in a dry run (see item). */
    private final TransactionTemplate itemTx;

    ImportContext(JdbcTemplate jdbc, TransactionTemplate itemTx, String instituteId, String runByUserId, boolean dryRun) {
        this.jdbc = jdbc;
        this.itemTx = itemTx;
        this.instituteId = instituteId;
        this.runByUserId = runByUserId;
        this.dryRun = dryRun;
    }

    // ---------- references ----------

    public Optional<String> ref(String kind, String externalId) {
        if (externalId == null || externalId.isBlank()) return Optional.empty();
        List<String> ids = jdbc.queryForList(
                "SELECT internal_id FROM institute_import_ref WHERE institute_id = ? AND kind = ? AND external_id = ?",
                String.class, instituteId, kind, externalId);
        return ids.isEmpty() ? Optional.empty() : Optional.of(ids.get(0));
    }

    public void putRef(String kind, String externalId, String internalId) {
        jdbc.update("""
                INSERT INTO institute_import_ref (id, institute_id, kind, external_id, internal_id)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (institute_id, kind, external_id)
                DO UPDATE SET internal_id = EXCLUDED.internal_id, updated_at = CURRENT_TIMESTAMP
                """, UUID.randomUUID().toString(), instituteId, kind, externalId, internalId);
    }

    // ---------- per record ----------

    /** Runs one record; a failure is recorded against it and the step carries on with the next. */
    public void item(String key, Runnable work) {
        requested++;
        try {
            if (dryRun) {
                // Inside the step's single rolled-back transaction: a savepoint per record, so one
                // bad record does not abort the rest of the preview.
                jdbc.execute("SAVEPOINT import_item");
                try {
                    work.run();
                    jdbc.execute("RELEASE SAVEPOINT import_item");
                } catch (RuntimeException e) {
                    jdbc.execute("ROLLBACK TO SAVEPOINT import_item");
                    throw e;
                }
            } else {
                itemTx.executeWithoutResult(s -> work.run());
            }
        } catch (Exception e) {
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) root = root.getCause();
            fail(key, root.getMessage() == null ? root.getClass().getSimpleName() : root.getMessage());
        }
    }

    /** A short label for a record in the result: its own id where it has one. */
    public static String keyOf(JsonNode n) {
        for (String f : new String[]{"external_id", "ref", "enrollment_external_id", "student_external_id", "name"}) {
            String v = text(n, f);
            if (v != null) return v;
        }
        return n.toString().length() > 80 ? n.toString().substring(0, 80) : n.toString();
    }

    // ---------- tally ----------

    public void created() { created++; }
    public void updated() { updated++; }

    public void skip(String key, String why) {
        skipped++;
        note("skipped", key, why);
    }

    public void fail(String key, String why) {
        failed++;
        note("failed", key, why);
    }

    private void note(String outcome, String key, String why) {
        if (problems.size() >= 500) return;
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("outcome", outcome);
        p.put("key", key);
        p.put("reason", why);
        problems.add(p);
    }

    public Map<String, Object> summary(String step) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("step", step);
        m.put("dry_run", dryRun);
        m.put("requested", requested);
        m.put("created", created);
        m.put("updated", updated);
        m.put("skipped", skipped);
        m.put("failed", failed);
        m.put("problems", problems);
        return m;
    }

    // ---------- json helpers ----------

    public static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        if (v == null || v.isNull()) return null;
        String s = v.asText().trim();
        return s.isEmpty() ? null : s;
    }

    public static Double number(JsonNode n, String field) {
        JsonNode v = n.get(field);
        if (v == null || v.isNull() || (v.isTextual() && v.asText().isBlank())) return null;
        return v.asDouble();
    }

    public static boolean bool(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v != null && v.asBoolean(false);
    }

    public static LocalDate date(JsonNode n, String field) {
        String s = text(n, field);
        if (s == null) return null;
        return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
    }

    public static Date sqlDate(LocalDate d) {
        return d == null ? null : Date.valueOf(d);
    }

    /** Start of the school's day, stored as the server's UTC wall clock like every other timestamp. */
    public static Timestamp startOfDay(LocalDate d) {
        return d == null ? null : Timestamp.from(d.atStartOfDay(ZONE).toInstant());
    }

    /** Last second of the school's day: a membership paid until the 12th runs to the end of the 12th. */
    public static Timestamp endOfDay(LocalDate d) {
        return d == null ? null : Timestamp.from(d.atTime(23, 59, 59).atZone(ZONE).toInstant());
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }
}
