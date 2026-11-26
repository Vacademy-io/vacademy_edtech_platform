package vacademy.io.admin_core_service.features.journey_status.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Journey status: where a learner stands in each of their batches (Learning, Temporary Break,
 * At Risk, Suspended, ...). One row per learner per batch in learner_journey_status; a
 * learner-in-batch without a row has the institute's default status. Every change is also written
 * to the learner's timeline as a JOURNEY_CASE event, the type imported journey cases use, so the
 * history reads as one list.
 *
 * <p>Off per institute ({@link JourneyStatusConfig}). Nothing here sends a message or fires a
 * workflow event: it is a status for staff, nothing more.
 */
@Slf4j
@Service
public class JourneyStatusService {

    public static final String TIMELINE_TYPE = "JOURNEY_CASE";
    public static final String SOURCE_MANUAL = "MANUAL";
    public static final String SOURCE_AUTO_RISK = "AUTO_RISK";
    public static final String SOURCE_BREAK = "BREAK";
    public static final String SOURCE_IMPORT = "IMPORT";
    public static final int MAX_BULK = 2000;

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final long TTL_MS = 60_000L;
    /** Current enrolments: what the list, the counts and the default status cover. */
    static final String CURRENT_ROWS = "m.status IN ('ACTIVE', 'INACTIVE') "
            + "AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;

    private record Cached(JourneyStatusConfig config, long at) {}

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    // ------------------------------------------------------------------ settings

    public JourneyStatusConfig config(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return JourneyStatusConfig.off();
        Cached c = cache.get(instituteId);
        if (c != null && System.currentTimeMillis() - c.at() < TTL_MS) return c.config();
        JourneyStatusConfig fresh = read(instituteId);
        cache.put(instituteId, new Cached(fresh, System.currentTimeMillis()));
        return fresh;
    }

    public boolean isEnabled(String instituteId) {
        return config(instituteId).enabled();
    }

    public void forget(String instituteId) {
        if (instituteId != null) cache.remove(instituteId);
    }

    private JourneyStatusConfig read(String instituteId) {
        try {
            List<String> json = jdbc.queryForList("SELECT setting_json FROM institutes WHERE id = ?", String.class, instituteId);
            if (json.isEmpty() || json.get(0) == null || json.get(0).isBlank()) return JourneyStatusConfig.off();
            return JourneyStatusConfig.from(MAPPER.readTree(json.get(0))
                    .path("setting").path(JourneyStatusConfig.SETTING_KEY).path("data"));
        } catch (Exception e) {
            log.warn("[journey-status] could not read setting for {}: {}", instituteId, e.getMessage());
            return JourneyStatusConfig.off();
        }
    }

    // ------------------------------------------------------------------ read

    /** One learner: their current batches with each status, and the journey history. */
    public Map<String, Object> learner(String instituteId, String userId) {
        JourneyStatusConfig cfg = config(instituteId);
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT DISTINCT ON (m.package_session_id)
                       m.package_session_id, m.status AS access_status,
                       p.package_name, l.level_name, s.session_name,
                       j.status_key, j.reason, j.next_action_date, j.since, j.source, j.updated_by_name, j.updated_at
                  FROM student_session_institute_group_mapping m
                  JOIN package_session ps ON ps.id = m.package_session_id
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                  LEFT JOIN learner_journey_status j
                         ON j.user_id = m.user_id AND j.package_session_id = m.package_session_id
                        AND j.institute_id = m.institute_id
                 WHERE m.user_id = ? AND m.institute_id = ?
                   AND %s
                 ORDER BY m.package_session_id, CASE WHEN m.status = 'ACTIVE' THEN 0 ELSE 1 END
                """.formatted(CURRENT_ROWS), userId, instituteId);
        List<Map<String, Object>> enrolments = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> e = new LinkedHashMap<>();
            String key = (String) r.get("status_key");
            e.put("package_session_id", r.get("package_session_id"));
            e.put("course_label", label((String) r.get("package_name"), (String) r.get("level_name"), (String) r.get("session_name")));
            e.put("access_status", r.get("access_status"));
            e.put("status_key", key != null ? key : cfg.defaultStatus());
            e.put("is_default", key == null);
            e.put("reason", r.get("reason"));
            e.put("next_action_date", r.get("next_action_date") == null ? null : r.get("next_action_date").toString());
            e.put("since", iso(r.get("since")));
            e.put("source", r.get("source"));
            e.put("updated_by_name", r.get("updated_by_name"));
            enrolments.add(e);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", cfg.enabled());
        out.put("config", cfg.toJson());
        out.put("enrolments", enrolments);
        out.put("history", history(instituteId, userId));
        return out;
    }

    /**
     * The learner's JOURNEY_CASE timeline events, newest first: imported cases and every change
     * made here. An imported case names its old-system enrolment; its batch is looked up through
     * the import's id map.
     */
    public List<Map<String, Object>> history(String instituteId, String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT te.id, te.action_type, te.actor_type, te.actor_name, te.title, te.description, te.created_at,
                       te.metadata_json->>'from_status' AS from_status,
                       te.metadata_json->>'to_status' AS to_status,
                       te.metadata_json->>'reason' AS reason,
                       te.metadata_json->>'next_action_date' AS next_action_date,
                       te.metadata_json->>'case_status' AS case_status,
                       COALESCE(te.metadata_json->>'source', 'manual') AS source,
                       COALESCE(te.metadata_json->>'package_session_id', m.package_session_id) AS package_session_id
                  FROM timeline_event te
                  LEFT JOIN institute_import_ref r
                         ON r.institute_id = te.institute_id AND r.kind = 'ACCESS'
                        AND r.external_id = te.metadata_json->>'enrollment_id'
                  LEFT JOIN student_session_institute_group_mapping m ON m.id = r.internal_id
                 WHERE te.type = 'JOURNEY_CASE' AND te.type_id = ? AND te.institute_id = ?
                 ORDER BY te.created_at DESC
                 LIMIT 200
                """, userId, instituteId);
        rows.forEach(r -> r.put("created_at", iso(r.get("created_at"))));
        return rows;
    }

    /**
     * Statuses of a page of learners for the student list: every current batch of each learner,
     * with its status key (the default when the batch has no row). One indexed query by user id.
     */
    public Map<String, List<Map<String, Object>>> forUsers(String instituteId, Collection<String> userIds) {
        Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
        if (userIds == null || userIds.isEmpty()) return out;
        JourneyStatusConfig cfg = config(instituteId);
        List<String> ids = userIds.stream().filter(s -> s != null && !s.isBlank()).distinct().limit(500).toList();
        if (ids.isEmpty()) return out;
        named().query("""
                SELECT DISTINCT m.user_id, m.package_session_id, j.status_key, j.since, j.source, j.reason
                  FROM student_session_institute_group_mapping m
                  LEFT JOIN learner_journey_status j
                         ON j.user_id = m.user_id AND j.package_session_id = m.package_session_id
                        AND j.institute_id = m.institute_id
                 WHERE m.institute_id = :institute AND m.user_id IN (:users)
                   AND %s
                """.formatted(CURRENT_ROWS),
                new MapSqlParameterSource("institute", instituteId).addValue("users", ids), rs -> {
                    Map<String, Object> e = new LinkedHashMap<>();
                    String key = rs.getString("status_key");
                    e.put("package_session_id", rs.getString("package_session_id"));
                    e.put("status_key", key != null ? key : cfg.defaultStatus());
                    e.put("since", iso(rs.getTimestamp("since")));
                    e.put("source", rs.getString("source"));
                    e.put("reason", rs.getString("reason"));
                    out.computeIfAbsent(rs.getString("user_id"), k -> new ArrayList<>()).add(e);
                });
        return out;
    }

    /** Current enrolments per status (learner-in-batch pairs), optionally within some batches. */
    public Map<String, Object> counts(String instituteId, List<String> packageSessionIds) {
        JourneyStatusConfig cfg = config(instituteId);
        MapSqlParameterSource p = new MapSqlParameterSource("institute", instituteId).addValue("def", cfg.defaultStatus());
        String psClause = "";
        if (packageSessionIds != null && !packageSessionIds.isEmpty()) {
            psClause = " AND m.package_session_id IN (:ps)";
            p.addValue("ps", packageSessionIds);
        }
        Map<String, Object> counts = new LinkedHashMap<>();
        cfg.statuses().forEach(s -> counts.put(s.key(), 0L));
        long[] total = {0};
        named().query("""
                SELECT COALESCE(j.status_key, :def) AS status_key, COUNT(*) AS n
                  FROM (SELECT DISTINCT m.user_id, m.package_session_id
                          FROM student_session_institute_group_mapping m
                         WHERE m.institute_id = :institute AND %s%s) e
                  LEFT JOIN learner_journey_status j
                         ON j.user_id = e.user_id AND j.package_session_id = e.package_session_id
                        AND j.institute_id = :institute
                 GROUP BY 1
                """.formatted(CURRENT_ROWS, psClause), p, rs -> {
                    long n = rs.getLong("n");
                    counts.merge(rs.getString("status_key"), n, (a, b) -> ((Long) a) + ((Long) b));
                    total[0] += n;
                });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("counts", counts);
        out.put("total", total[0]);
        return out;
    }

    /**
     * Learners with at least one current batch (within {@code packageSessionIds} when given) on
     * one of these statuses. Feeds the student-list filter as a matched user-id set.
     */
    public Set<String> userIdsWithStatuses(String instituteId, List<String> statusKeys, List<String> packageSessionIds) {
        JourneyStatusConfig cfg = config(instituteId);
        Set<String> out = new LinkedHashSet<>();
        if (statusKeys == null || statusKeys.isEmpty()) return out;
        MapSqlParameterSource p = new MapSqlParameterSource("institute", instituteId)
                .addValue("def", cfg.defaultStatus()).addValue("keys", statusKeys);
        String psClause = "";
        if (packageSessionIds != null && !packageSessionIds.isEmpty()) {
            psClause = " AND m.package_session_id IN (:ps)";
            p.addValue("ps", packageSessionIds);
        }
        named().query("""
                SELECT DISTINCT m.user_id
                  FROM student_session_institute_group_mapping m
                  LEFT JOIN learner_journey_status j
                         ON j.user_id = m.user_id AND j.package_session_id = m.package_session_id
                        AND j.institute_id = m.institute_id
                 WHERE m.institute_id = :institute AND %s%s
                   AND COALESCE(j.status_key, :def) IN (:keys)
                """.formatted(CURRENT_ROWS, psClause), p, rs -> {
                    out.add(rs.getString(1));
                });
        return out;
    }

    // ------------------------------------------------------------------ write

    /** One learner-in-batch to change. */
    public record Target(String userId, String packageSessionId) {}

    /**
     * Staff change: sets {@code statusKey} on each target (or on every current batch of each user
     * when a target has no batch). Only enrolments of this institute are touched. Returns how many
     * statuses changed.
     */
    public int setManual(String instituteId, List<Target> targets, String statusKey, String reason,
                         LocalDate nextActionDate, String actorId, String actorName) {
        JourneyStatusConfig cfg = config(instituteId);
        if (!cfg.enabled()) throw new VacademyException("Journey status is switched off for this institute");
        String key = cfg.resolve(statusKey);
        if (key == null) throw new VacademyException("Unknown journey status '" + statusKey + "'");
        if (targets == null || targets.isEmpty()) throw new VacademyException("Choose at least one learner");
        List<Target> resolved = expand(instituteId, targets);
        if (resolved.isEmpty()) throw new VacademyException("None of these learners has a current batch in this institute");
        if (resolved.size() > MAX_BULK) throw new VacademyException("At most " + MAX_BULK + " enrolments at a time");
        String why = trimTo(reason, 500);
        int changed = 0;
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        for (Target t : resolved) {
            Boolean ok = tx.execute(s -> apply(instituteId, cfg, t.userId(), t.packageSessionId(), key, why, nextActionDate,
                    SOURCE_MANUAL, actorId, actorName, null, true));
            if (Boolean.TRUE.equals(ok)) changed++;
        }
        return changed;
    }

    /**
     * Targets narrowed to this institute's enrolments: a target with a batch must be one of the
     * learner's batches here (any status); a target without one stands for all current batches.
     */
    List<Target> expand(String instituteId, List<Target> targets) {
        Set<String> users = new LinkedHashSet<>();
        targets.forEach(t -> { if (t.userId() != null && !t.userId().isBlank()) users.add(t.userId()); });
        if (users.isEmpty()) return List.of();
        Map<String, List<String[]>> byUser = new HashMap<>();
        named().query("""
                SELECT DISTINCT m.user_id, m.package_session_id, m.status
                  FROM student_session_institute_group_mapping m
                 WHERE m.institute_id = :institute AND m.user_id IN (:users)
                   AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
                """, new MapSqlParameterSource("institute", instituteId).addValue("users", new ArrayList<>(users)), rs -> {
                    byUser.computeIfAbsent(rs.getString(1), k -> new ArrayList<>())
                            .add(new String[]{rs.getString(2), rs.getString(3)});
                });
        Set<Target> out = new LinkedHashSet<>();
        for (Target t : targets) {
            List<String[]> rows = byUser.getOrDefault(t.userId(), List.of());
            if (t.packageSessionId() == null || t.packageSessionId().isBlank()) {
                rows.stream().filter(r -> "ACTIVE".equals(r[1]) || "INACTIVE".equals(r[1]))
                        .forEach(r -> out.add(new Target(t.userId(), r[0])));
            } else if (rows.stream().anyMatch(r -> t.packageSessionId().equals(r[0]))) {
                out.add(new Target(t.userId(), t.packageSessionId()));
            }
        }
        return new ArrayList<>(out);
    }

    /**
     * Sets one learner-in-batch's status. Returns false when nothing changed (same status, reason
     * and next action date). Writes a JOURNEY_CASE timeline event unless {@code logTimeline} is
     * false (the import, whose cases are on the timeline already). Runs in the caller's transaction.
     */
    public boolean apply(String instituteId, JourneyStatusConfig cfg, String userId, String packageSessionId, String toKey,
                         String reason, LocalDate nextActionDate, String source, String actorId, String actorName,
                         Timestamp since, boolean logTimeline) {
        Map<String, Object> current = current(instituteId, userId, packageSessionId);
        String fromKey = current == null ? cfg.defaultStatus() : (String) current.get("status_key");
        if (current != null && toKey.equals(fromKey)
                && eq(reason, (String) current.get("reason"))
                && eq(nextActionDate == null ? null : nextActionDate.toString(),
                current.get("next_action_date") == null ? null : current.get("next_action_date").toString())) {
            return false;
        }
        if (current == null && toKey.equals(fromKey) && reason == null && nextActionDate == null && !SOURCE_IMPORT.equals(source)) {
            return false; // already on the default status, nothing to record
        }
        Timestamp when = since != null ? since : new Timestamp(System.currentTimeMillis());
        jdbc.update("""
                INSERT INTO learner_journey_status (id, institute_id, user_id, package_session_id, status_key, reason,
                                                    next_action_date, since, updated_by_user_id, updated_by_name, source,
                                                    created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
                ON CONFLICT (user_id, package_session_id) DO UPDATE
                   SET status_key = EXCLUDED.status_key,
                       reason = EXCLUDED.reason,
                       next_action_date = EXCLUDED.next_action_date,
                       since = CASE WHEN learner_journey_status.status_key = EXCLUDED.status_key
                                    THEN learner_journey_status.since ELSE EXCLUDED.since END,
                       updated_by_user_id = EXCLUDED.updated_by_user_id,
                       updated_by_name = EXCLUDED.updated_by_name,
                       source = EXCLUDED.source,
                       updated_at = now()
                 WHERE learner_journey_status.institute_id = EXCLUDED.institute_id
                """, UUID.randomUUID().toString(), instituteId, userId, packageSessionId, toKey, reason,
                nextActionDate == null ? null : Date.valueOf(nextActionDate), when, actorId, actorName, source);
        if (logTimeline) {
            timeline(instituteId, cfg, userId, packageSessionId, fromKey, toKey, reason, nextActionDate, source, actorId, actorName);
        }
        return true;
    }

    /** The stored row for a learner-in-batch, or null when they are on the default status. */
    public Map<String, Object> current(String instituteId, String userId, String packageSessionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT status_key, reason, next_action_date, source, since
                  FROM learner_journey_status
                 WHERE user_id = ? AND package_session_id = ? AND institute_id = ?
                """, userId, packageSessionId, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private void timeline(String instituteId, JourneyStatusConfig cfg, String userId, String packageSessionId,
                          String fromKey, String toKey, String reason, LocalDate nextActionDate, String source,
                          String actorId, String actorName) {
        String course = courseLabel(packageSessionId);
        String from = cfg.labelOf(fromKey), to = cfg.labelOf(toKey);
        String title = "Journey status: " + (from != null && !from.equals(to) ? from + " → " : "") + to
                + (course != null ? " (" + course + ")" : "");
        List<String> lines = new ArrayList<>();
        if (reason != null) lines.add("Reason: " + reason);
        if (nextActionDate != null) lines.add("Next action: " + nextActionDate);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("from_status", from);
        meta.put("to_status", to);
        meta.put("from_key", fromKey);
        meta.put("to_key", toKey);
        meta.put("reason", reason);
        meta.put("next_action_date", nextActionDate == null ? null : nextActionDate.toString());
        meta.put("package_session_id", packageSessionId);
        meta.put("course", course);
        meta.put("source", source.toLowerCase(java.util.Locale.ROOT));
        String json;
        try {
            json = MAPPER.writeValueAsString(meta);
        } catch (Exception e) {
            json = null;
        }
        boolean staff = SOURCE_MANUAL.equals(source) || (SOURCE_BREAK.equals(source) && actorId != null);
        jdbc.update("""
                INSERT INTO timeline_event (id, type, type_id, action_type, actor_type, actor_id, actor_name, title, description,
                                            metadata_json, created_at, is_pinned, student_user_id, category, institute_id)
                VALUES (?, ?, ?, 'STATUS_CHANGED', ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, false, ?, 'ACTIVITY', ?)
                """, UUID.randomUUID().toString(), TIMELINE_TYPE, userId, staff ? "ADMIN" : "SYSTEM", actorId,
                actorName, title, lines.isEmpty() ? null : String.join("\n", lines), json,
                new Timestamp(System.currentTimeMillis()), userId, instituteId);
    }

    // ------------------------------------------------------------------ breaks link

    /**
     * A pause started (Breaks and holds): the batch moves to the institute's pause status, unless
     * it is on a stopped status. Runs after the break commits, in its own transaction, and never
     * fails the break. Nothing happens while the setting is off.
     */
    public void onPauseStarted(String instituteId, String userId, String packageSessionId, String actorId, String actorName) {
        afterCommit(() -> {
            JourneyStatusConfig cfg = config(instituteId);
            if (!cfg.enabled() || cfg.statusOnPause() == null || packageSessionId == null) return;
            Map<String, Object> cur = current(instituteId, userId, packageSessionId);
            String key = cur == null ? cfg.defaultStatus() : (String) cur.get("status_key");
            if ("STOPPED".equals(cfg.kindOf(key)) || cfg.statusOnPause().equals(key)) return;
            apply(instituteId, cfg, userId, packageSessionId, cfg.statusOnPause(), "Pause started", null,
                    SOURCE_BREAK, actorId, actorName != null ? actorName : "Breaks and holds", null, true);
        });
    }

    /** The pause ended: a batch still on a break status goes back to the resume status. */
    public void onPauseEnded(String instituteId, String userId, String packageSessionId, String actorId, String actorName) {
        afterCommit(() -> {
            JourneyStatusConfig cfg = config(instituteId);
            if (!cfg.enabled() || cfg.statusOnResume() == null || packageSessionId == null) return;
            Map<String, Object> cur = current(instituteId, userId, packageSessionId);
            if (cur == null || !"BREAK".equals(cfg.kindOf((String) cur.get("status_key")))) return;
            apply(instituteId, cfg, userId, packageSessionId, cfg.statusOnResume(), "Pause ended", null,
                    SOURCE_BREAK, actorId, actorName != null ? actorName : "Breaks and holds", null, true);
        });
    }

    private void afterCommit(Runnable work) {
        Runnable guarded = () -> {
            try {
                TransactionTemplate own = new TransactionTemplate(transactionManager);
                own.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                own.executeWithoutResult(s -> work.run());
            } catch (Exception e) {
                log.warn("[journey-status] status update after a break failed: {}", e.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    guarded.run();
                }
            });
        } else {
            guarded.run();
        }
    }

    // ------------------------------------------------------------------ helpers

    String courseLabel(String packageSessionId) {
        if (packageSessionId == null) return null;
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT p.package_name, l.level_name, s.session_name
                  FROM package_session ps
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE ps.id = ?
                """, packageSessionId);
        if (rows.isEmpty()) return null;
        Map<String, Object> r = rows.get(0);
        return label((String) r.get("package_name"), (String) r.get("level_name"), (String) r.get("session_name"));
    }

    static String label(String course, String level, String session) {
        List<String> parts = new ArrayList<>();
        for (String s : new String[]{course, level, session}) {
            if (s != null && !s.isBlank() && !"DEFAULT".equalsIgnoreCase(s.trim())) parts.add(s.trim());
        }
        return parts.isEmpty() ? null : String.join(" · ", parts);
    }

    /** A stored timestamp (UTC wall clock, the JVM runs in UTC) as an ISO instant. */
    static String iso(Object ts) {
        return ts instanceof Timestamp t ? t.toInstant().toString() : ts == null ? null : ts.toString();
    }

    private NamedParameterJdbcTemplate named() {
        return new NamedParameterJdbcTemplate(jdbc);
    }

    static String trimTo(String s, int max) {
        if (s == null || s.isBlank()) return null;
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }
}
