package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusProgressService;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static vacademy.io.admin_core_service.features.institute_import.service.ImportContext.*;

/** A course stage's syllabus (week blocks of points) and each learner's progress through it. */
@Component
@RequiredArgsConstructor
public class ImportSyllabusSteps {

    private final SyllabusProgressService progressService;

    /**
     * Body: { "<course> | <stage>": [ { trimester, month, week_from, week_to, seq, text } ] }
     * Points sharing a week range form one block; blocks are ordered by their first week.
     */
    public void syllabus(ImportContext c, JsonNode body) {
        Iterator<Map.Entry<String, JsonNode>> it = body.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            c.item(e.getKey(), () -> {
                String[] parts = e.getKey().split("\\s*\\|\\s*", 2);
                if (parts.length != 2) {
                    c.fail(e.getKey(), "key must be '<course> | <stage>'");
                    return;
                }
                Optional<String> packageId = c.ref("COURSE", parts[0]);
                Optional<String> levelId = c.ref("LEVEL", parts[0] + "|" + parts[1]);
                if (packageId.isEmpty() || levelId.isEmpty()) {
                    c.fail(e.getKey(), "course or stage not imported yet");
                    return;
                }
                Map<String, List<JsonNode>> byRange = new LinkedHashMap<>();
                for (JsonNode p : e.getValue()) {
                    byRange.computeIfAbsent(p.path("week_from").asInt() + "-" + p.path("week_to").asInt(), k -> new ArrayList<>()).add(p);
                }
                boolean existed = false;
                for (Map.Entry<String, List<JsonNode>> r : byRange.entrySet()) {
                    JsonNode first = r.getValue().get(0);
                    int from = first.path("week_from").asInt(), to = first.path("week_to").asInt();
                    String key = e.getKey() + "|" + r.getKey();
                    String blockId = c.ref("SYL_BLOCK", key).orElse(null);
                    if (blockId != null) {
                        existed = true;
                    } else {
                        blockId = newId();
                        c.getJdbc().update("""
                                INSERT INTO syllabus_block (id, institute_id, package_id, level_id, trimester, month_no, week_from, week_to, block_order)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT (package_id, level_id, week_from, week_to) DO NOTHING
                                """, blockId, c.getInstituteId(), packageId.get(), levelId.get(), text(first, "trimester"),
                                first.hasNonNull("month") ? first.get("month").asInt() : null, from, to, from);
                        blockId = c.getJdbc().queryForObject(
                                "SELECT id FROM syllabus_block WHERE package_id = ? AND level_id = ? AND week_from = ? AND week_to = ?",
                                String.class, packageId.get(), levelId.get(), from, to);
                        c.putRef("SYL_BLOCK", key, blockId);
                    }
                    for (JsonNode p : r.getValue()) {
                        c.getJdbc().update("""
                                INSERT INTO syllabus_point (id, block_id, seq, text) VALUES (?, ?, ?, ?)
                                ON CONFLICT (block_id, seq) DO UPDATE SET text = EXCLUDED.text
                                """, newId(), blockId, p.path("seq").asInt(), text(p, "text"));
                    }
                }
                if (existed) c.updated(); else c.created();
            });
        }
    }

    /**
     * Body: [ { enrollment_external_id, course, level, week_from, week_to, status, started_on,
     *           completed_on, points, marked_by, note } ]
     * Progress is kept against the learner's batch from that enrolment.
     */
    public void progress(ImportContext c, JsonNode body) {
        for (JsonNode p : body) {
            String key = text(p, "enrollment_external_id") + "|" + text(p, "course") + "|" + text(p, "level") + "|"
                    + text(p, "week_from") + "-" + text(p, "week_to");
            c.item(key, () -> {
                Optional<String> ssigm = c.ref("ACCESS", text(p, "enrollment_external_id"));
                Optional<String> block = c.ref("SYL_BLOCK", text(p, "course") + " | " + text(p, "level") + "|"
                        + p.path("week_from").asInt() + "-" + p.path("week_to").asInt());
                if (ssigm.isEmpty()) {
                    c.fail(key, "enrolment not imported yet");
                    return;
                }
                if (block.isEmpty()) {
                    c.fail(key, "no such week in the syllabus");
                    return;
                }
                Map<String, Object> row = c.getJdbc().queryForMap(
                        "SELECT user_id, package_session_id FROM student_session_institute_group_mapping WHERE id = ?", ssigm.get());
                String status = switch (Optional.ofNullable(text(p, "status")).orElse("").toLowerCase()) {
                    case "completed" -> "COMPLETED";
                    case "in progress" -> "IN_PROGRESS";
                    case "skipped" -> "SKIPPED";
                    default -> "NOT_STARTED";
                };
                String by = text(p, "marked_by");
                String byUser = by == null ? null : c.ref("STAFF", by).orElse(null);
                String byName = by == null ? null : c.ref("STAFF_NAME", by).orElse(null);
                LocalDate started = date(p, "started_on"), completed = date(p, "completed_on");
                String points = text(p, "points");
                boolean existed = c.getJdbc().queryForObject("""
                        SELECT COUNT(*) FROM learner_syllabus_progress WHERE user_id = ? AND package_session_id = ? AND block_id = ?
                        """, Integer.class, row.get("user_id"), row.get("package_session_id"), block.get()) > 0;
                progressService.upsert(c.getInstituteId(), (String) row.get("user_id"), (String) row.get("package_session_id"),
                        block.get(), status, sqlDate(c.getToday()), points == null ? null : points.replace(" ", ""),
                        text(p, "note"), byUser, byName, sqlDate(started), sqlDate(completed));
                if (existed) c.updated(); else c.created();
            });
        }
    }
}
