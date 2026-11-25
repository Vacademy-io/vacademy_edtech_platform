package vacademy.io.admin_core_service.features.syllabus_progress.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * Syllabus progress: a course stage's syllabus (week blocks of numbered points) and each learner's
 * progress through it in their batch, marked by teachers and shown to the learner.
 *
 * <p>The syllabus belongs to a course stage (package + level), so every batch of that stage shares
 * it; progress belongs to a learner in a batch (user + package_session). Off per institute
 * ({@code SYLLABUS_PROGRESS_SETTING.data.enabled}). Nothing here sends a message.
 */
@Service
@RequiredArgsConstructor
public class SyllabusProgressService {

    public static final String SETTING_KEY = "SYLLABUS_PROGRESS_SETTING";
    public static final List<String> STATUSES = List.of("NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED");
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    public boolean isEnabled(String instituteId) {
        List<String> json = jdbc.queryForList("SELECT setting_json FROM institutes WHERE id = ?", String.class, instituteId);
        if (json.isEmpty() || json.get(0) == null) return false;
        try {
            return MAPPER.readTree(json.get(0)).path("setting").path(SETTING_KEY).path("data").path("enabled").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /** Batches of this institute whose course stage has a syllabus, with their learner counts. */
    public List<Map<String, Object>> batches(String instituteId) {
        return jdbc.queryForList("""
                SELECT ps.id AS package_session_id, p.package_name AS course_name, l.level_name, s.session_name AS batch_name,
                       (SELECT COUNT(*) FROM student_session_institute_group_mapping m
                         WHERE m.package_session_id = ps.id AND m.institute_id = ? AND m.status = 'ACTIVE') AS learners,
                       (SELECT COUNT(*) FROM syllabus_block b WHERE b.package_id = ps.package_id AND b.level_id = ps.level_id
                           AND b.status = 'ACTIVE') AS blocks
                  FROM package_session ps
                  JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = ?
                  JOIN package p ON p.id = ps.package_id
                  JOIN level l ON l.id = ps.level_id
                  JOIN session s ON s.id = ps.session_id
                 WHERE ps.status = 'ACTIVE'
                   AND EXISTS (SELECT 1 FROM syllabus_block b WHERE b.package_id = ps.package_id AND b.level_id = ps.level_id
                                  AND b.status = 'ACTIVE')
                 ORDER BY p.package_name, l.level_name, s.session_name
                """, instituteId, instituteId);
    }

    /** One batch: its syllabus, its current learners and their progress cells. */
    public Map<String, Object> batch(String instituteId, String packageSessionId) {
        Map<String, Object> ps = batchRow(instituteId, packageSessionId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("package_session_id", packageSessionId);
        out.put("course_name", ps.get("course_name"));
        out.put("level_name", ps.get("level_name"));
        out.put("batch_name", ps.get("batch_name"));
        out.put("blocks", blocks((String) ps.get("package_id"), (String) ps.get("level_id")));
        out.put("learners", jdbc.queryForList("""
                SELECT DISTINCT ON (m.user_id) m.user_id, COALESCE(st.full_name, '') AS full_name,
                       m.institute_enrollment_number AS enrollment_number
                  FROM student_session_institute_group_mapping m
                  LEFT JOIN LATERAL (SELECT full_name FROM student WHERE user_id = m.user_id ORDER BY created_at DESC NULLS LAST LIMIT 1) st ON true
                 WHERE m.package_session_id = ? AND m.institute_id = ? AND m.status = 'ACTIVE'
                 ORDER BY m.user_id
                """, packageSessionId, instituteId).stream()
                .sorted(Comparator.comparing(r -> String.valueOf(r.get("full_name")).toLowerCase()))
                .toList());
        out.put("progress", jdbc.queryForList("""
                SELECT user_id, block_id, status, started_on, completed_on, points_done, teacher_note, marked_by_name, updated_at
                  FROM learner_syllabus_progress WHERE package_session_id = ? AND institute_id = ?
                """, packageSessionId, instituteId).stream().map(SyllabusProgressService::cell).toList());
        return out;
    }

    /**
     * Marks blocks for learners of one batch. {@code pointsDone} (point numbers) is kept only when
     * one block is marked; COMPLETED fills the completed date, IN_PROGRESS the started date.
     */
    @Transactional
    public int mark(String instituteId, String packageSessionId, List<String> blockIds, List<String> userIds, String status,
                    List<Integer> pointsDone, String note, String byUserId, String byName) {
        if (!STATUSES.contains(status)) throw new VacademyException("Unknown status: " + status);
        if (blockIds == null || blockIds.isEmpty() || userIds == null || userIds.isEmpty()) {
            throw new VacademyException("Choose at least one learner and one week");
        }
        if (blockIds.size() > 60 || userIds.size() > 300) throw new VacademyException("Too many at once");
        Map<String, Object> ps = batchRow(instituteId, packageSessionId);
        Set<String> validBlocks = new HashSet<>(jdbc.queryForList(
                "SELECT id FROM syllabus_block WHERE package_id = ? AND level_id = ? AND status = 'ACTIVE'",
                String.class, ps.get("package_id"), ps.get("level_id")));
        Set<String> validUsers = new HashSet<>(jdbc.queryForList("""
                SELECT user_id FROM student_session_institute_group_mapping
                 WHERE package_session_id = ? AND institute_id = ? AND status IN ('ACTIVE', 'INACTIVE')
                """, String.class, packageSessionId, instituteId));
        if (!validBlocks.containsAll(blockIds)) throw new VacademyException("A week does not belong to this batch's syllabus");
        if (!validUsers.containsAll(userIds)) throw new VacademyException("A learner is not in this batch");
        String points = pointsDone == null || blockIds.size() != 1 ? null
                : String.join(",", pointsDone.stream().distinct().sorted().map(String::valueOf).toList());
        // null = leave the note as it is; "" = clear it; text = set it.
        String cleanNote = note == null ? null : note.trim();
        if (cleanNote != null && cleanNote.length() > 2000) throw new VacademyException("The note is too long");
        Date today = Date.valueOf(LocalDate.now(IST));
        int n = 0;
        for (String block : blockIds) {
            for (String user : userIds) {
                n += upsert(instituteId, user, packageSessionId, block, status, today, points, cleanNote, byUserId, byName,
                        null, null);
            }
        }
        return n;
    }

    /** One progress row, created or changed; dates may be given (import) or follow the status. */
    public int upsert(String instituteId, String userId, String packageSessionId, String blockId, String status, Date today,
                      String points, String note, String byUserId, String byName, Date startedOn, Date completedOn) {
        Date started = startedOn != null ? startedOn : ("NOT_STARTED".equals(status) ? null : today);
        Date completed = completedOn != null ? completedOn : ("COMPLETED".equals(status) ? today : null);
        return jdbc.update("""
                INSERT INTO learner_syllabus_progress (id, institute_id, user_id, package_session_id, block_id, status,
                       started_on, completed_on, points_done, teacher_note, marked_by_user_id, marked_by_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, package_session_id, block_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    started_on = CASE WHEN EXCLUDED.status = 'NOT_STARTED' THEN NULL
                                      ELSE COALESCE(learner_syllabus_progress.started_on, EXCLUDED.started_on) END,
                    completed_on = CASE WHEN EXCLUDED.status = 'COMPLETED'
                                        THEN COALESCE(learner_syllabus_progress.completed_on, EXCLUDED.completed_on) ELSE NULL END,
                    points_done = COALESCE(EXCLUDED.points_done, learner_syllabus_progress.points_done),
                    teacher_note = CASE WHEN EXCLUDED.teacher_note IS NULL THEN learner_syllabus_progress.teacher_note
                                        ELSE NULLIF(EXCLUDED.teacher_note, '') END,
                    marked_by_user_id = EXCLUDED.marked_by_user_id,
                    marked_by_name = EXCLUDED.marked_by_name,
                    updated_at = CURRENT_TIMESTAMP
                """, UUID.randomUUID().toString(), instituteId, userId, packageSessionId, blockId, status, started, completed,
                points, note, byUserId, byName);
    }

    /** The learner's own progress in each of their current batches that has a syllabus. */
    public Map<String, Object> mine(String instituteId, String userId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", isEnabled(instituteId));
        List<Map<String, Object>> courses = new ArrayList<>();
        if (Boolean.TRUE.equals(out.get("enabled"))) {
            List<Map<String, Object>> batches = jdbc.queryForList("""
                    SELECT DISTINCT ps.id AS package_session_id, ps.package_id, ps.level_id, p.package_name AS course_name,
                           l.level_name, s.session_name AS batch_name
                      FROM student_session_institute_group_mapping m
                      JOIN package_session ps ON ps.id = m.package_session_id
                      JOIN package p ON p.id = ps.package_id
                      JOIN level l ON l.id = ps.level_id
                      JOIN session s ON s.id = ps.session_id
                     WHERE m.user_id = ? AND m.institute_id = ? AND m.status = 'ACTIVE'
                       AND EXISTS (SELECT 1 FROM syllabus_block b WHERE b.package_id = ps.package_id AND b.level_id = ps.level_id
                                      AND b.status = 'ACTIVE')
                    """, userId, instituteId);
            for (Map<String, Object> b : batches) {
                String psId = (String) b.get("package_session_id");
                List<Map<String, Object>> blocks = blocks((String) b.get("package_id"), (String) b.get("level_id"));
                Map<String, Map<String, Object>> cells = new HashMap<>();
                for (Map<String, Object> r : jdbc.queryForList("""
                        SELECT block_id, status, started_on, completed_on, points_done, teacher_note, marked_by_name, updated_at
                          FROM learner_syllabus_progress WHERE user_id = ? AND package_session_id = ?
                        """, userId, psId)) {
                    cells.put((String) r.get("block_id"), cell(r));
                }
                int completed = 0;
                String current = null;
                for (Map<String, Object> blk : blocks) {
                    Map<String, Object> c = cells.get(blk.get("id"));
                    String st = c == null ? "NOT_STARTED" : (String) c.get("status");
                    blk.put("status", st);
                    blk.put("completed_on", c == null ? null : c.get("completed_on"));
                    blk.put("points_done", c == null ? List.of() : c.get("points_done"));
                    blk.put("teacher_note", c == null ? null : c.get("teacher_note"));
                    blk.put("marked_by_name", c == null ? null : c.get("marked_by_name"));
                    blk.put("updated_at", c == null ? null : c.get("updated_at"));
                    if ("COMPLETED".equals(st) || "SKIPPED".equals(st)) completed++;
                    else if (current == null) current = (String) blk.get("id");
                }
                Map<String, Object> course = new LinkedHashMap<>();
                course.put("package_session_id", psId);
                course.put("course_name", b.get("course_name"));
                course.put("level_name", b.get("level_name"));
                course.put("level_id", b.get("level_id"));
                course.put("levels", courseLevels((String) b.get("package_id")));
                course.put("batch_name", b.get("batch_name"));
                course.put("total_blocks", blocks.size());
                course.put("completed_blocks", completed);
                course.put("current_block_id", current);
                course.put("blocks", blocks);
                courses.add(course);
            }
        }
        out.put("courses", courses);
        return out;
    }

    /**
     * The course's stages (levels) in teaching order, for the learner's stage path. Levels carry no
     * order of their own, so a stage's place is where its syllabus starts (its first week), then
     * when it was created; stages without a syllabus come last. The placeholder level "DEFAULT"
     * (a course with no real stages) is left out.
     */
    private List<Map<String, Object>> courseLevels(String packageId) {
        return jdbc.queryForList("""
                SELECT l.id, l.level_name AS name
                  FROM level l
                 WHERE l.id IN (SELECT ps.level_id FROM package_session ps
                                 WHERE ps.package_id = ? AND ps.status <> 'DELETED')
                   AND COALESCE(l.status, 'ACTIVE') <> 'DELETED'
                   AND UPPER(COALESCE(l.level_name, '')) <> 'DEFAULT'
                 ORDER BY (SELECT MIN(b.week_from) FROM syllabus_block b
                            WHERE b.package_id = ? AND b.level_id = l.id AND b.status = 'ACTIVE') NULLS LAST,
                          l.created_at NULLS LAST, l.level_name
                """, packageId, packageId);
    }

    private Map<String, Object> batchRow(String instituteId, String packageSessionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT ps.id, ps.package_id, ps.level_id, p.package_name AS course_name, l.level_name, s.session_name AS batch_name
                  FROM package_session ps
                  JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = ?
                  JOIN package p ON p.id = ps.package_id
                  JOIN level l ON l.id = ps.level_id
                  JOIN session s ON s.id = ps.session_id
                 WHERE ps.id = ?
                """, instituteId, packageSessionId);
        if (rows.isEmpty()) throw new VacademyException("Batch not found in this institute");
        return rows.get(0);
    }

    private List<Map<String, Object>> blocks(String packageId, String levelId) {
        List<Map<String, Object>> blocks = new ArrayList<>(jdbc.queryForList("""
                SELECT id, trimester, month_no, week_from, week_to, block_order
                  FROM syllabus_block WHERE package_id = ? AND level_id = ? AND status = 'ACTIVE'
                 ORDER BY block_order, week_from
                """, packageId, levelId).stream().map(m -> (Map<String, Object>) new LinkedHashMap<>(m)).toList());
        if (blocks.isEmpty()) return blocks;
        Map<String, List<Map<String, Object>>> points = new HashMap<>();
        List<Object> ids = new ArrayList<>(blocks.stream().map(b -> b.get("id")).toList());
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        for (Map<String, Object> p : jdbc.queryForList(
                "SELECT block_id, seq, text FROM syllabus_point WHERE block_id IN (" + in + ") ORDER BY seq", ids.toArray())) {
            Map<String, Object> pt = new LinkedHashMap<>();
            pt.put("seq", p.get("seq"));
            pt.put("text", p.get("text"));
            points.computeIfAbsent((String) p.get("block_id"), k -> new ArrayList<>()).add(pt);
        }
        for (Map<String, Object> b : blocks) b.put("points", points.getOrDefault((String) b.get("id"), List.of()));
        return blocks;
    }

    private static Map<String, Object> cell(Map<String, Object> r) {
        Map<String, Object> c = new LinkedHashMap<>(r);
        Object pts = r.get("points_done");
        List<Integer> list = new ArrayList<>();
        if (pts instanceof String s && !s.isBlank()) {
            for (String x : s.split("[,\\s]+")) {
                try {
                    list.add(Integer.parseInt(x));
                } catch (NumberFormatException ignored) {
                    // a stray value from an import is dropped
                }
            }
        }
        c.put("points_done", list);
        return c;
    }
}
