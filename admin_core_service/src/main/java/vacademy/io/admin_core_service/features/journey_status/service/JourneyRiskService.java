package vacademy.io.admin_core_service.features.journey_status.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;

import java.time.LocalDate;
import java.time.ZoneId;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The At Risk check, once a day for institutes with journey status and {@code auto_risk} on.
 * A learner-in-batch whose status is of kind ACTIVE (never a break, stopped or re-entry status)
 * becomes the risk status when either:
 * <ul>
 *   <li>they missed each of the batch's last N held classes (N = {@code missed_classes}, default 3).
 *       Classes on dates the learner was on a pause (running or ended) do not count.
 *       A class counts as held once it has ended and attendance was taken for it (at least one
 *       learner has an attendance mark), so a class nobody recorded never counts against anyone.
 *       Missed = no PRESENT mark. Only classes on or after the learner joined the batch count.</li>
 *   <li>their membership's due date (the user_plan end date, as payment reminders use it) is more
 *       than X days past (X = {@code fee_overdue_days}, default 15): an ACTIVE, paid, non-autopay
 *       subscription or one-time plan of that batch.</li>
 * </ul>
 * Learners on a running break are left alone. With {@code auto_return} (default on), a learner
 * the check itself marked At Risk goes back to the default status once neither rule holds (they
 * attended the latest class, the fee was paid). A status staff set by hand is never changed.
 * Nothing is sent: no message, no workflow event.
 *
 * <p>The same daily pass ends re-entries ({@link #returnReentries}): with {@code reentry_auto_return}
 * on (default), a learner the re-entry flow put on a Re-entry status goes back to the default status
 * once the re-entry date (next action date) is over.
 */
@Slf4j
@Service
public class JourneyRiskService {

    static final String ACTOR = "At Risk check";
    static final String REENTRY_ACTOR = "Re-entry check";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    /** How far back classes are looked at: far enough for N weekly classes plus breaks. */
    static final int CLASS_LOOKBACK_DAYS = 120;
    /**
     * Each batch's held classes are cut to its latest N + this many before they are matched to
     * learners, so the join stays small on big institutes; the slack covers classes a learner
     * missed because they joined later or were on a pause.
     */
    static final int CLASS_SLACK = 12;
    static final String STATEMENT_TIMEOUT = "60s";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private JourneyStatusService statusService;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired(required = false) private EnrolmentBreakGuard guard;

    /**
     * Institutes with the setting on and the At Risk check or the re-entry return on. One query;
     * others are never touched.
     */
    List<String> institutes() {
        List<String> out = new ArrayList<>();
        jdbc.query("SELECT id, setting_json FROM institutes WHERE setting_json LIKE '%" + JourneyStatusConfig.SETTING_KEY + "%'",
                rs -> {
                    try {
                        JsonNode data = MAPPER.readTree(rs.getString("setting_json"))
                                .path("setting").path(JourneyStatusConfig.SETTING_KEY).path("data");
                        JourneyStatusConfig c = JourneyStatusConfig.from(data);
                        if (c.enabled() && (c.autoRisk().enabled() || c.reentryAutoReturn())) out.add(rs.getString("id"));
                    } catch (Exception e) {
                        log.warn("[journey-status] unreadable setting for institute {}: {}", rs.getString("id"), e.getMessage());
                    }
                });
        return out;
    }

    /** One pass over every opted-in institute. Returns {marked at risk, returned}. */
    public int[] run() {
        int marked = 0, returned = 0;
        for (String instituteId : institutes()) {
            try {
                statusService.forget(instituteId);
                int[] r = runInstitute(instituteId);
                marked += r[0];
                returned += r[1];
            } catch (Exception e) {
                log.error("[journey-status] At Risk check failed for institute {}: {}", instituteId, e.getMessage(), e);
            }
            try {
                returned += returnReentries(instituteId);
            } catch (Exception e) {
                log.error("[journey-status] re-entry return failed for institute {}: {}", instituteId, e.getMessage(), e);
            }
        }
        return new int[]{marked, returned};
    }

    public int[] runInstitute(String instituteId) {
        JourneyStatusConfig cfg = statusService.config(instituteId);
        JourneyStatusConfig.AutoRisk rule = cfg.autoRisk();
        if (!cfg.enabled() || !rule.enabled() || rule.status() == null || cfg.status(rule.status()) == null) {
            return new int[]{0, 0};
        }
        // The two reads run in one short transaction with a statement timeout, so a slow plan on
        // a big institute is cut off instead of holding a connection.
        TransactionTemplate read = new TransactionTemplate(transactionManager);
        read.setReadOnly(true);
        Object[] reads = read.execute(s -> {
            jdbc.execute("SET LOCAL statement_timeout = '" + STATEMENT_TIMEOUT + "'");
            return new Object[]{
                    rule.missedClasses() > 0 ? classes(instituteId, rule.missedClasses()) : Map.<String, int[]>of(),
                    rule.feeOverdueDays() > 0 ? overdueDays(instituteId, rule.feeOverdueDays()) : Map.<String, Integer>of()};
        });
        @SuppressWarnings("unchecked") Map<String, int[]> classes = (Map<String, int[]>) reads[0];
        @SuppressWarnings("unchecked") Map<String, Integer> overdue = (Map<String, Integer>) reads[1];
        Map<String, Map<String, Object>> stored = stored(instituteId);
        Set<String> onBreak = onBreak(instituteId);

        Set<String> keys = new LinkedHashSet<>();
        keys.addAll(classes.keySet());
        keys.addAll(overdue.keySet());
        for (Map.Entry<String, Map<String, Object>> e : stored.entrySet()) {
            if (JourneyStatusService.SOURCE_AUTO_RISK.equals(e.getValue().get("source"))
                    && rule.status().equals(e.getValue().get("status_key"))) keys.add(e.getKey());
        }
        int marked = 0, returned = 0;
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        for (String k : keys) {
            String[] up = k.split("\\|", 2);
            String userId = up[0], psId = up[1];
            if (onBreak.contains(k) || onBreak.contains(userId + "|")) continue;
            Map<String, Object> row = stored.get(k);
            // A status staff set by hand is never changed by the check.
            if (row != null && JourneyStatusService.SOURCE_MANUAL.equals(row.get("source"))) continue;
            String current = row == null ? cfg.defaultStatus() : (String) row.get("status_key");
            String why = reason(classes.get(k), overdue.get(k), rule.missedClasses());
            try {
                if (why != null && "ACTIVE".equals(cfg.kindOf(current))) {
                    Boolean ok = tx.execute(s -> statusService.apply(instituteId, cfg, userId, psId, rule.status(), why, null,
                            JourneyStatusService.SOURCE_AUTO_RISK, null, ACTOR, null, true));
                    if (Boolean.TRUE.equals(ok)) marked++;
                } else if (why == null && rule.autoReturn() && row != null
                        && JourneyStatusService.SOURCE_AUTO_RISK.equals(row.get("source"))
                        && rule.status().equals(current)) {
                    int[] c = classes.get(k);
                    String back = c != null && c[2] == 1 ? "Attended class again" : "No missed classes or overdue fee any more";
                    Boolean ok = tx.execute(s -> statusService.apply(instituteId, cfg, userId, psId, cfg.defaultStatus(), back, null,
                            JourneyStatusService.SOURCE_AUTO_RISK, null, ACTOR, null, true));
                    if (Boolean.TRUE.equals(ok)) returned++;
                }
            } catch (Exception e) {
                log.warn("[journey-status] could not update {} in institute {}: {}", k, instituteId, e.getMessage());
            }
        }
        if (marked > 0 || returned > 0) {
            log.info("[journey-status] institute {}: {} marked at risk, {} back to {}", instituteId, marked, returned, cfg.defaultStatus());
        }
        return new int[]{marked, returned};
    }

    /**
     * Learners the re-entry flow put on a Re-entry status (source REENTRY: a later change by hand
     * takes it out of this rule) whose re-entry date is before today in the institute's time zone go
     * back to the default status. Learners on a running break are left alone. Returns how many moved.
     */
    public int returnReentries(String instituteId) {
        JourneyStatusConfig cfg = statusService.config(instituteId);
        if (!cfg.enabled() || !cfg.reentryAutoReturn() || cfg.status(cfg.defaultStatus()) == null) return 0;
        List<String> reentryKeys = cfg.statuses().stream().filter(st -> "REENTRY".equals(st.kind()))
                .map(JourneyStatusConfig.Status::key).toList();
        if (reentryKeys.isEmpty()) return 0;
        LocalDate today = LocalDate.now(guard != null ? guard.zone(instituteId) : ZoneId.of("Asia/Kolkata"));
        List<Map<String, Object>> due = new NamedParameterJdbcTemplate(jdbc).queryForList("""
                SELECT user_id, package_session_id, next_action_date
                  FROM learner_journey_status
                 WHERE institute_id = :institute AND source = :source
                   AND status_key IN (:keys)
                   AND next_action_date IS NOT NULL AND next_action_date < :today
                """, new MapSqlParameterSource("institute", instituteId)
                .addValue("source", JourneyStatusService.SOURCE_REENTRY)
                .addValue("keys", reentryKeys)
                .addValue("today", java.sql.Date.valueOf(today)));
        if (due.isEmpty()) return 0;
        Set<String> onBreak = onBreak(instituteId);
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        int returned = 0;
        for (Map<String, Object> r : due) {
            String userId = (String) r.get("user_id"), psId = (String) r.get("package_session_id");
            if (onBreak.contains(userId + "|" + psId) || onBreak.contains(userId + "|")) continue;
            String why = "Re-entry over (" + r.get("next_action_date") + ")";
            try {
                Boolean ok = tx.execute(s -> statusService.apply(instituteId, cfg, userId, psId, cfg.defaultStatus(), why, null,
                        JourneyStatusService.SOURCE_AUTO_RETURN, null, REENTRY_ACTOR, null, true));
                if (Boolean.TRUE.equals(ok)) returned++;
            } catch (Exception e) {
                log.warn("[journey-status] could not end re-entry {}|{} in institute {}: {}", userId, psId, instituteId, e.getMessage());
            }
        }
        if (returned > 0) {
            log.info("[journey-status] institute {}: {} re-entries back to {}", instituteId, returned, cfg.defaultStatus());
        }
        return returned;
    }

    /** "Missed last 3 classes" / "Fee overdue 17 days" / both; null when neither rule holds. */
    static String reason(int[] classes, Integer overdueDays, int n) {
        List<String> parts = new ArrayList<>();
        if (classes != null && n > 0 && classes[0] >= n && classes[1] == 0) parts.add("Missed last " + n + " classes");
        if (overdueDays != null) parts.add("Fee overdue " + overdueDays + " days");
        return parts.isEmpty() ? null : String.join("; ", parts);
    }

    /**
     * For each learner-in-batch with held classes: {held among the last n, present among them,
     * 1 if present at the latest}. Key "userId|packageSessionId".
     */
    Map<String, int[]> classes(String instituteId, int n) {
        Map<String, int[]> out = new HashMap<>();
        jdbc.query("""
                WITH held AS (
                    SELECT DISTINCT ss.id AS schedule_id, lsp.source_id AS package_session_id, ss.meeting_date, ss.start_time
                      FROM live_session ls
                      JOIN live_session_participants lsp ON lsp.session_id = ls.id AND lsp.source_type = 'BATCH'
                      JOIN session_schedules ss ON ss.session_id = ls.id
                     WHERE ls.institute_id = ?
                       AND ls.status = 'LIVE'
                       AND ss.status <> 'DELETED'
                       AND ss.meeting_date >= CURRENT_DATE - ?
                       AND ss.meeting_date <= CURRENT_DATE
                       AND ((ss.meeting_date + COALESCE(ss.last_entry_time, ss.start_time))
                               AT TIME ZONE COALESCE(NULLIF(ls.timezone, ''), 'Asia/Kolkata')) <= now()
                       AND EXISTS (SELECT 1 FROM live_session_logs l
                                    WHERE l.schedule_id = ss.id AND l.log_type = 'ATTENDANCE_RECORDED')
                ),
                recent AS (
                    SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.package_session_id
                                                   ORDER BY h.meeting_date DESC, h.start_time DESC) AS brn
                      FROM held h
                ),
                learner AS (
                    SELECT m.user_id, m.package_session_id, MIN(m.enrolled_date) AS enrolled_date
                      FROM student_session_institute_group_mapping m
                     WHERE m.institute_id = ? AND m.status = 'ACTIVE'
                     GROUP BY m.user_id, m.package_session_id
                ),
                ranked AS (
                    SELECT e.user_id, e.package_session_id, h.schedule_id,
                           ROW_NUMBER() OVER (PARTITION BY e.user_id, e.package_session_id
                                              ORDER BY h.meeting_date DESC, h.start_time DESC) AS rn
                      FROM learner e
                      JOIN recent h ON h.package_session_id = e.package_session_id AND h.brn <= ?
                     WHERE (e.enrolled_date IS NULL OR h.meeting_date >= e.enrolled_date)
                       AND NOT EXISTS (
                           SELECT 1 FROM enrolment_break b
                            WHERE b.institute_id = ? AND b.user_id = e.user_id AND b.kind = 'PAUSE'
                              AND b.status IN ('ACTIVE', 'ENDED')
                              AND (b.package_session_id IS NULL OR b.package_session_id = e.package_session_id)
                              AND h.meeting_date >= b.starts_on
                              AND h.meeting_date <= COALESCE(CAST(b.ended_at AS DATE), b.ends_on, CURRENT_DATE))
                )
                SELECT r.user_id, r.package_session_id,
                       COUNT(*) AS held,
                       COUNT(*) FILTER (WHERE p.present) AS present,
                       BOOL_OR(r.rn = 1 AND p.present) AS latest_present
                  FROM ranked r
                  CROSS JOIN LATERAL (
                       SELECT EXISTS (SELECT 1 FROM live_session_logs l
                                       WHERE l.schedule_id = r.schedule_id AND l.user_source_id = r.user_id
                                         AND l.log_type = 'ATTENDANCE_RECORDED' AND l.status = 'PRESENT') AS present
                  ) p
                 WHERE r.rn <= ?
                 GROUP BY r.user_id, r.package_session_id
                """, rs -> {
                    out.put(rs.getString("user_id") + "|" + rs.getString("package_session_id"),
                            new int[]{rs.getInt("held"), rs.getInt("present"), rs.getBoolean("latest_present") ? 1 : 0});
                }, instituteId, CLASS_LOOKBACK_DAYS, instituteId, n + CLASS_SLACK, instituteId, n);
        return out;
    }

    /** Learner-in-batch → days the membership is overdue, for those more than {@code days} overdue. */
    Map<String, Integer> overdueDays(String instituteId, int days) {
        Map<String, Integer> out = new HashMap<>();
        jdbc.query("""
                SELECT m.user_id, m.package_session_id,
                       MAX(FLOOR(EXTRACT(EPOCH FROM (now() - up.end_date)) / 86400))::int AS days
                  FROM student_session_institute_group_mapping m
                  JOIN user_plan up ON up.id = m.user_plan_id
                  LEFT JOIN payment_option po ON po.id = up.payment_option_id
                  LEFT JOIN payment_plan pp ON pp.id = up.plan_id
                 WHERE m.institute_id = ? AND m.status = 'ACTIVE'
                   AND up.status = 'ACTIVE'
                   AND up.end_date IS NOT NULL
                   AND up.end_date < now() - make_interval(days => ?)
                   AND COALESCE(up.auto_renewal_enabled, false) = false
                   AND (po.type IS NULL OR UPPER(po.type) IN ('SUBSCRIPTION', 'ONE_TIME'))
                   AND COALESCE(up.regional_price, pp.actual_price, 0) > 0
                 GROUP BY m.user_id, m.package_session_id
                """, rs -> {
                    out.put(rs.getString("user_id") + "|" + rs.getString("package_session_id"), rs.getInt("days"));
                }, instituteId, days);
        return out;
    }

    private Map<String, Map<String, Object>> stored(String instituteId) {
        Map<String, Map<String, Object>> out = new HashMap<>();
        for (Map<String, Object> r : jdbc.queryForList(
                "SELECT user_id, package_session_id, status_key, source FROM learner_journey_status WHERE institute_id = ?",
                instituteId)) {
            out.put(r.get("user_id") + "|" + r.get("package_session_id"), r);
        }
        return out;
    }

    /** "user|batch" for running breaks on a batch, "user|" for running breaks on the whole learner. */
    private Set<String> onBreak(String instituteId) {
        Set<String> out = new HashSet<>();
        jdbc.query("SELECT user_id, package_session_id FROM enrolment_break WHERE institute_id = ? AND status = 'ACTIVE'",
                rs -> {
                    String ps = rs.getString("package_session_id");
                    out.add(rs.getString("user_id") + "|" + (ps == null ? "" : ps));
                }, instituteId);
        return out;
    }
}
