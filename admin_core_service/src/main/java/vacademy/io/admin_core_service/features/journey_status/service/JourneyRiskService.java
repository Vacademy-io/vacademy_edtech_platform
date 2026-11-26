package vacademy.io.admin_core_service.features.journey_status.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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
 */
@Slf4j
@Service
public class JourneyRiskService {

    static final String ACTOR = "At Risk check";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    /** How far back classes are looked at: far enough for N weekly classes plus breaks. */
    static final int CLASS_LOOKBACK_DAYS = 120;

    @Autowired private JdbcTemplate jdbc;
    @Autowired private JourneyStatusService statusService;
    @Autowired private PlatformTransactionManager transactionManager;

    /** Institutes with the setting on and the check on. One query; others are never touched. */
    List<String> institutes() {
        List<String> out = new ArrayList<>();
        jdbc.query("SELECT id, setting_json FROM institutes WHERE setting_json LIKE '%" + JourneyStatusConfig.SETTING_KEY + "%'",
                rs -> {
                    try {
                        JsonNode data = MAPPER.readTree(rs.getString("setting_json"))
                                .path("setting").path(JourneyStatusConfig.SETTING_KEY).path("data");
                        JourneyStatusConfig c = JourneyStatusConfig.from(data);
                        if (c.enabled() && c.autoRisk().enabled()) out.add(rs.getString("id"));
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
        }
        return new int[]{marked, returned};
    }

    public int[] runInstitute(String instituteId) {
        JourneyStatusConfig cfg = statusService.config(instituteId);
        JourneyStatusConfig.AutoRisk rule = cfg.autoRisk();
        if (!cfg.enabled() || !rule.enabled() || rule.status() == null || cfg.status(rule.status()) == null) {
            return new int[]{0, 0};
        }
        Map<String, int[]> classes = rule.missedClasses() > 0 ? classes(instituteId, rule.missedClasses()) : Map.of();
        Map<String, Integer> overdue = rule.feeOverdueDays() > 0 ? overdueDays(instituteId, rule.feeOverdueDays()) : Map.of();
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
                      JOIN held h ON h.package_session_id = e.package_session_id
                     WHERE e.enrolled_date IS NULL OR h.meeting_date >= e.enrolled_date
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
                }, instituteId, CLASS_LOOKBACK_DAYS, instituteId, n);
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
