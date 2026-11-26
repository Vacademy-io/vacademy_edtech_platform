package vacademy.io.admin_core_service.features.extra_class.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Extra classes: a learner linked to another batch of the institute for a few days (a make-up
 * class, a trial in a different slot), with no fee, no payment plan and no invoice.
 *
 * <p>An extra class is one access row (student_session_institute_group_mapping) marked
 * {@code source = 'EXTRA_CLASS'}, with {@code enrolled_date} = the first day and
 * {@code expiry_date} = the end of the last day in the institute's time zone, and no
 * {@code user_plan_id}: so the plan-based enrolment-policy sweep (expiry reminders, waiting period,
 * final expiry) never sees it. Rows imported from an institute's old system are found through
 * {@code institute_import_ref} (kind EXTRA).
 *
 * <p>Nothing here sends a message. The row is written with plain SQL (not through the enrolment
 * manager, which sends the enrolment notice and fires the enrolment workflow), and the timeline
 * entry is written with plain SQL too, so no timeline hook wakes the engagement engine. An
 * upcoming extra class is stored INACTIVE and {@link #sweep()} switches it on on its first day and
 * marks it EXPIRED after its last day, again with plain SQL.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ExtraClassService {

    public static final String SOURCE = "EXTRA_CLASS";
    public static final String TIMELINE_TYPE = "EXTRA_CLASS";
    public static final int MAX_DAYS = 90;
    /**
     * type_id on an extra class this service stored as upcoming (INACTIVE until its first day).
     * Only rows carrying it are switched on by {@link #sweep()}, so a row staff made inactive by
     * hand stays off. Cleared when the row starts.
     */
    public static final String UPCOMING_MARK = "EXTRA_CLASS_UPCOMING";
    private static final String IMPORT_KIND = "EXTRA";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final JdbcTemplate jdbc;
    private final EnrolmentBreakGuard guard;

    // ------------------------------------------------------------------ add

    /**
     * Links a learner to another batch of the institute from {@code from} to {@code to}
     * (whole days, inclusive, institute time). No fee, no plan, no message. Callable from Java by
     * other flows (e.g. re-entry); the per-institute switch is checked by the controller, not here.
     *
     * @return the id of the new access row
     */
    @Transactional
    public String add(String instituteId, String userId, String packageSessionId, LocalDate from, LocalDate to,
                      String note, String byUserId, String byName) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId) || !StringUtils.hasText(packageSessionId)) {
            throw new VacademyException("Choose the learner and the batch");
        }
        ZoneId zone = guard.zone(instituteId);
        LocalDate today = LocalDate.now(zone);
        validateDates(from, to, today);

        if (!learnerInInstitute(userId, instituteId)) {
            throw new VacademyException("This learner is not part of this institute");
        }
        Map<String, Object> batch = batchRow(instituteId, packageSessionId);
        if (batch == null) {
            throw new VacademyException("That batch was not found in this institute, or it is not active");
        }
        if (overlapsExisting(userId, instituteId, packageSessionId, from, to, zone)) {
            throw new VacademyException("The learner is already in this batch on some of these dates");
        }

        boolean started = !from.isAfter(today);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, institute_id,
                             enrolled_date, expiry_date, status, source, type_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
                """, id, userId, packageSessionId, instituteId, java.sql.Date.valueOf(from), endOfDay(to, zone),
                started ? "ACTIVE" : "INACTIVE", SOURCE, started ? null : UPCOMING_MARK);

        String label = label(batch);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("access_id", id);
        meta.put("package_session_id", packageSessionId);
        meta.put("batch", label);
        meta.put("from", from.toString());
        meta.put("to", to.toString());
        meta.put("note", StringUtils.hasText(note) ? note.trim() : null);
        timeline(instituteId, userId, "EXTRA_CLASS_ADDED", byUserId, byName,
                "Extra class added: " + label,
                from + " to " + to + (StringUtils.hasText(note) ? "\n" + note.trim() : ""), meta);
        return id;
    }

    /** First and last day rules, shared by every caller. */
    static void validateDates(LocalDate from, LocalDate to, LocalDate today) {
        if (from == null || to == null) throw new VacademyException("Choose the first and the last day");
        if (to.isBefore(from)) throw new VacademyException("The last day must be on or after the first day");
        if (to.isBefore(today)) throw new VacademyException("The last day cannot be in the past");
        if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_DAYS) {
            throw new VacademyException("An extra class can last at most " + MAX_DAYS + " days");
        }
    }

    // ------------------------------------------------------------------ end / remove

    /**
     * Ends an extra class now (access off, status EXPIRED), or deletes it when it has not started.
     *
     * @return "REMOVED" or "ENDED"
     */
    @Transactional
    public String end(String instituteId, String accessId, String byUserId, String byName) {
        Map<String, Object> row = loadExtra(instituteId, accessId);
        ZoneId zone = guard.zone(instituteId);
        LocalDate today = LocalDate.now(zone);
        LocalDate from = toDay(row.get("enrolled_date"), zone);
        String status = (String) row.get("status");
        String userId = (String) row.get("user_id");
        String label = label(row);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("access_id", accessId);
        meta.put("package_session_id", row.get("package_session_id"));
        meta.put("batch", label);

        if (from != null && from.isAfter(today) && !"EXPIRED".equals(status)) {
            jdbc.update("DELETE FROM student_session_institute_group_mapping WHERE id = ?", accessId);
            timeline(instituteId, userId, "EXTRA_CLASS_REMOVED", byUserId, byName,
                    "Extra class removed: " + label, "Removed before it started", meta);
            return "REMOVED";
        }
        if (!"ACTIVE".equals(status) && !"INACTIVE".equals(status)) {
            throw new VacademyException("This extra class is already over");
        }
        jdbc.update("""
                UPDATE student_session_institute_group_mapping
                   SET status = 'EXPIRED', expiry_date = ?, updated_at = now()
                 WHERE id = ?
                """, new Timestamp(System.currentTimeMillis()), accessId);
        timeline(instituteId, userId, "EXTRA_CLASS_ENDED", byUserId, byName,
                "Extra class ended: " + label, "Ended early on " + today, meta);
        return "ENDED";
    }

    // ------------------------------------------------------------------ read

    /** The learner's extra classes, upcoming and current first, then past ones. */
    public List<Map<String, Object>> forLearner(String instituteId, String userId) {
        ZoneId zone = guard.zone(instituteId);
        LocalDate today = LocalDate.now(zone);
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT m.id, m.package_session_id, m.status, m.enrolled_date, m.expiry_date, m.source, m.created_at,
                       p.package_name AS course_name, l.level_name, s.session_name AS batch_name
                  FROM student_session_institute_group_mapping m
                  JOIN package_session ps ON ps.id = m.package_session_id
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE m.user_id = ? AND m.institute_id = ?
                   AND (m.source = 'EXTRA_CLASS'
                        OR m.id IN (SELECT r.internal_id FROM institute_import_ref r
                                     WHERE r.institute_id = ? AND r.kind = 'EXTRA'))
                 ORDER BY m.enrolled_date DESC NULLS LAST
                """, userId, instituteId, instituteId);
        Map<String, Map<String, Object>> added = addedEvents(instituteId, userId);
        List<Map<String, Object>> current = new ArrayList<>();
        List<Map<String, Object>> past = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            String id = (String) r.get("id");
            LocalDate from = toDay(r.get("enrolled_date"), zone);
            LocalDate to = toDay(r.get("expiry_date"), zone);
            String state = state((String) r.get("status"), from, to, today);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("package_session_id", r.get("package_session_id"));
            out.put("batch_label", label(r));
            out.put("course_name", r.get("course_name"));
            out.put("level_name", r.get("level_name"));
            out.put("batch_name", r.get("batch_name"));
            out.put("from", from == null ? null : from.toString());
            out.put("to", to == null ? null : to.toString());
            out.put("state", state);
            out.put("access_status", r.get("status"));
            out.put("imported", !SOURCE.equals(r.get("source")));
            Map<String, Object> ev = added.get(id);
            out.put("note", ev == null ? null : ev.get("note"));
            out.put("added_by", ev == null ? null : ev.get("actor_name"));
            out.put("added_at", ev == null ? r.get("created_at") : ev.get("created_at"));
            ("ENDED".equals(state) ? past : current).add(out);
        }
        // Current ones by first day (soonest first); past ones stay newest first.
        current.sort((a, b) -> String.valueOf(a.get("from")).compareTo(String.valueOf(b.get("from"))));
        List<Map<String, Object>> all = new ArrayList<>(current);
        all.addAll(past);
        return all;
    }

    /** UPCOMING (not started), CURRENT (attending now) or ENDED. */
    static String state(String status, LocalDate from, LocalDate to, LocalDate today) {
        if ("EXPIRED".equals(status) || "TERMINATED".equals(status) || "DELETED".equals(status)) return "ENDED";
        if (to != null && to.isBefore(today)) return "ENDED";
        if (from != null && from.isAfter(today)) return "UPCOMING";
        return "CURRENT";
    }

    /** The institute's active batches an extra class can point at. */
    public List<Map<String, Object>> batches(String instituteId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT ps.id AS package_session_id, p.package_name AS course_name, l.level_name, s.session_name AS batch_name
                  FROM package_session ps
                  JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = ?
                  JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE ps.status = 'ACTIVE'
                 ORDER BY p.package_name, l.level_name, s.session_name
                """, instituteId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>(r);
            m.put("label", label(r));
            out.add(m);
        }
        return out;
    }

    // ------------------------------------------------------------------ daily sweep

    /**
     * Switches on upcoming extra classes whose first day has come and marks finished ones
     * EXPIRED, each by its institute's own date. Plain SQL, no message, no workflow.
     * Only rows stored as upcoming ({@link #UPCOMING_MARK}) are switched on, and not while the
     * learner has a running pause on that batch or a pause switched the row off. Only rows whose
     * last day is before the institute's today are expired.
     *
     * @return {started, expired}
     */
    @Transactional
    public int[] sweep() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT m.id, m.institute_id, m.status, m.enrolled_date, m.expiry_date, m.type_id
                  FROM student_session_institute_group_mapping m
                 WHERE m.source = 'EXTRA_CLASS' AND m.status IN ('ACTIVE', 'INACTIVE')
                UNION
                SELECT m.id, m.institute_id, m.status, m.enrolled_date, m.expiry_date, m.type_id
                  FROM institute_import_ref r
                  JOIN student_session_institute_group_mapping m ON m.id = r.internal_id
                 WHERE r.kind = 'EXTRA' AND m.status = 'ACTIVE'
                """);
        int started = 0;
        int expired = 0;
        Map<String, LocalDate> todayByInstitute = new HashMap<>();
        for (Map<String, Object> r : rows) {
            String instituteId = (String) r.get("institute_id");
            ZoneId zone = guard.zone(instituteId);
            LocalDate today = todayByInstitute.computeIfAbsent(instituteId, i -> LocalDate.now(zone));
            LocalDate from = toDay(r.get("enrolled_date"), zone);
            LocalDate to = toDay(r.get("expiry_date"), zone);
            String id = (String) r.get("id");
            if (to != null && to.isBefore(today)) {
                expired += jdbc.update("""
                        UPDATE student_session_institute_group_mapping SET status = 'EXPIRED', updated_at = now()
                         WHERE id = ? AND status IN ('ACTIVE', 'INACTIVE')
                        """, id);
            } else if (to != null && "INACTIVE".equals(r.get("status")) && UPCOMING_MARK.equals(r.get("type_id"))
                    && (from == null || !from.isAfter(today))) {
                started += jdbc.update("""
                        UPDATE student_session_institute_group_mapping m
                           SET status = 'ACTIVE', type_id = NULL, updated_at = now()
                         WHERE m.id = ? AND m.status = 'INACTIVE' AND m.type_id = ?
                           AND NOT EXISTS (SELECT 1 FROM enrolment_break b
                                            WHERE b.status = 'ACTIVE'
                                              AND ((b.kind = 'PAUSE' AND b.user_id = m.user_id
                                                    AND b.institute_id = m.institute_id
                                                    AND (b.package_session_id IS NULL
                                                         OR b.package_session_id = m.package_session_id))
                                                   OR b.paused_access_ids LIKE '%' || m.id || '%'))
                        """, id, UPCOMING_MARK);
            }
        }
        return new int[] { started, expired };
    }

    // ------------------------------------------------------------------ helpers

    private boolean learnerInInstitute(String userId, String instituteId) {
        Integer n = jdbc.queryForObject("""
                SELECT COUNT(*) FROM (SELECT 1 FROM student_session_institute_group_mapping
                                       WHERE user_id = ? AND institute_id = ? LIMIT 1) x
                """, Integer.class, userId, instituteId);
        return n != null && n > 0;
    }

    private Map<String, Object> batchRow(String instituteId, String packageSessionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT ps.id AS package_session_id, p.package_name AS course_name, l.level_name, s.session_name AS batch_name
                  FROM package_session ps
                  JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = ?
                  JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE ps.id = ? AND ps.status = 'ACTIVE'
                 LIMIT 1
                """, instituteId, packageSessionId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * True when the learner already holds this batch (ACTIVE, or an upcoming extra class) on any
     * of these days. A normal enrolment without an end date overlaps everything.
     */
    private boolean overlapsExisting(String userId, String instituteId, String packageSessionId,
                                     LocalDate from, LocalDate to, ZoneId zone) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT status, source, enrolled_date, expiry_date
                  FROM student_session_institute_group_mapping
                 WHERE user_id = ? AND institute_id = ? AND package_session_id = ?
                   AND (status = 'ACTIVE' OR (status = 'INACTIVE' AND source = 'EXTRA_CLASS' AND type_id = 'EXTRA_CLASS_UPCOMING'))
                   AND (type IS NULL OR type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
                """, userId, instituteId, packageSessionId);
        for (Map<String, Object> r : rows) {
            LocalDate start = toDay(r.get("enrolled_date"), zone);
            LocalDate end = toDay(r.get("expiry_date"), zone);
            if (overlaps(start, end, from, to)) return true;
        }
        return false;
    }

    /** Null start = since always, null end = no end. */
    static boolean overlaps(LocalDate aStart, LocalDate aEnd, LocalDate bStart, LocalDate bEnd) {
        boolean aBeforeB = aEnd != null && aEnd.isBefore(bStart);
        boolean bBeforeA = aStart != null && bEnd.isBefore(aStart);
        return !aBeforeB && !bBeforeA;
    }

    private Map<String, Object> loadExtra(String instituteId, String accessId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT m.id, m.user_id, m.package_session_id, m.status, m.enrolled_date, m.expiry_date,
                       p.package_name AS course_name, l.level_name, s.session_name AS batch_name
                  FROM student_session_institute_group_mapping m
                  JOIN package_session ps ON ps.id = m.package_session_id
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE m.id = ? AND m.institute_id = ?
                   AND (m.source = 'EXTRA_CLASS'
                        OR EXISTS (SELECT 1 FROM institute_import_ref r
                                    WHERE r.institute_id = m.institute_id AND r.kind = 'EXTRA' AND r.internal_id = m.id))
                """, accessId, instituteId);
        if (rows.isEmpty()) throw new VacademyException("Extra class not found");
        return rows.get(0);
    }

    /** The "added" timeline entries of this learner, by access row id: note, who, when. */
    private Map<String, Map<String, Object>> addedEvents(String instituteId, String userId) {
        Map<String, Map<String, Object>> out = new HashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT metadata_json::text AS meta, actor_name, created_at
                  FROM timeline_event
                 WHERE type = ? AND type_id = ? AND action_type = 'EXTRA_CLASS_ADDED' AND institute_id = ?
                """, TIMELINE_TYPE, userId, instituteId);
        for (Map<String, Object> r : rows) {
            try {
                JsonNode meta = MAPPER.readTree(String.valueOf(r.get("meta")));
                String accessId = meta.path("access_id").asText(null);
                if (accessId == null) continue;
                Map<String, Object> m = new HashMap<>();
                m.put("note", meta.hasNonNull("note") ? meta.get("note").asText() : null);
                m.put("actor_name", r.get("actor_name"));
                m.put("created_at", r.get("created_at"));
                out.put(accessId, m);
            } catch (Exception ignored) {
                // An unreadable entry only loses the note and the name, never the row.
            }
        }
        return out;
    }

    /**
     * One entry on the learner's timeline (the import's pattern: plain SQL into timeline_event,
     * so no timeline hook runs). Never fails the change itself.
     */
    private void timeline(String instituteId, String userId, String action, String byUserId, String byName,
                          String title, String description, Map<String, Object> meta) {
        try {
            jdbc.update("""
                    INSERT INTO timeline_event (id, type, type_id, action_type, actor_type, actor_id, actor_name, title,
                                                description, metadata_json, created_at, is_pinned, student_user_id,
                                                category, institute_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), now(), false, ?, 'ACTIVITY', ?)
                    """, UUID.randomUUID().toString(), TIMELINE_TYPE, userId, action,
                    byUserId != null ? "ADMIN" : "SYSTEM", byUserId,
                    StringUtils.hasText(byName) ? byName : "Extra classes", title, description,
                    MAPPER.writeValueAsString(meta), userId, instituteId);
        } catch (Exception e) {
            log.warn("[extra-class] timeline entry failed for {}: {}", userId, e.getMessage());
        }
    }

    private static Timestamp endOfDay(LocalDate day, ZoneId zone) {
        return Timestamp.from(day.atTime(23, 59, 59).atZone(zone).toInstant());
    }

    /** A date column as is; a timestamp column (stored in UTC) as a day in the institute's zone. */
    static LocalDate toDay(Object v, ZoneId zone) {
        if (v == null) return null;
        if (v instanceof java.sql.Date d) return d.toLocalDate();
        if (v instanceof Timestamp t) return t.toInstant().atZone(zone).toLocalDate();
        if (v instanceof java.util.Date d) return d.toInstant().atZone(zone).toLocalDate();
        if (v instanceof LocalDate d) return d;
        if (v instanceof java.time.LocalDateTime t) return t.atZone(ZoneId.of("UTC")).withZoneSameInstant(zone).toLocalDate();
        return null;
    }

    static String label(Map<String, Object> r) {
        StringBuilder sb = new StringBuilder();
        append(sb, r.get("course_name"));
        append(sb, r.get("level_name"));
        append(sb, r.get("batch_name"));
        return sb.toString();
    }

    private static void append(StringBuilder sb, Object part) {
        if (part == null) return;
        String s = part.toString().trim();
        if (s.isEmpty() || "default".equalsIgnoreCase(s)) return;
        if (sb.length() > 0) sb.append(" · ");
        sb.append(s);
    }
}
