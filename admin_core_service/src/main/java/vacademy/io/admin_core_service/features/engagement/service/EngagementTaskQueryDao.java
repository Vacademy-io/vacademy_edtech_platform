package vacademy.io.admin_core_service.features.engagement.service;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.time.LocalDateTime;
import java.util.List;

/**
 * The task inbox filtered the way the daily report counts (engine, channel, kind, institute-local
 * day, template), and the reads behind each row's outcome: its AI call, and the WhatsApp sends that
 * followed it (reply attribution). Ids only for the inbox: the rows themselves are loaded through
 * the JPA repository, so they serialize exactly as the unfiltered inbox's.
 *
 * <p>engagement_action stores naive UTC; every time bound here is a UTC LocalDateTime.
 */
@Repository
public class EngagementTaskQueryDao {

    /** The unfiltered inbox's kind rule (EngagementActionRepository.findInbox). */
    static final String DEFAULT_KINDS =
            "(a.kind IN ('TASK', 'REPLY') OR (a.kind = 'SEND' AND a.status IN ('FAILED', 'SENT')))";

    /** A CRM SCHEDULE_AI_CALL task places an AI call whatever channel it carries; the report counts it there. */
    static final String CALL_ROW =
            "(a.channel = 'AI_CALL' OR a.action_type = '" + EngagementActionTypes.SCHEDULE_AI_CALL + "')";

    private final NamedParameterJdbcTemplate jdbc;

    public EngagementTaskQueryDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param engineIds never empty: the one engine asked for, else every engine of the institute (keeps
     *                  the scan on the engine index)
     * @param channels  null = any channel; AI_CALL also matches a SCHEDULE_AI_CALL task
     * @param kind      null = the inbox's default kinds (never NO_OP); CRM = a TASK with a CRM action type
     * @param from      null = any day; else COALESCE(dispatched_at, created_at) in [from, to)
     * @param scanFrom  lower created_at bound that goes with from (a row is drafted before it goes out)
     * @param template  exact template name, email subject, or email template name / id
     */
    public record Query(String instituteId, List<String> statuses, List<String> engineIds, List<String> channels,
                        String kind, LocalDateTime from, LocalDateTime to, LocalDateTime scanFrom, String template) {
        boolean dated() {
            return from != null;
        }
    }

    /** One inbox row, as much of it as filtering on outcomes needs. */
    public record TaskRow(String id, String engineId, String memberId, String kind, String actionType,
                          String channel, String status) {
    }

    /** One queued AI call of an action; callStatus and durationSeconds are null until it was dialled. */
    public record CallRow(String actionId, String queueStatus, String callLogId, String callStatus,
                          Integer durationSeconds) {
    }

    public List<String> pageIds(Query q, int limit, long offset) {
        MapSqlParameterSource p = params(q).addValue("limit", limit).addValue("offset", offset);
        return jdbc.queryForList("SELECT a.id " + where(q) + orderBy(q) + " LIMIT :limit OFFSET :offset",
                p, String.class);
    }

    public long count(Query q) {
        Long n = jdbc.queryForObject("SELECT count(*) " + where(q), params(q), Long.class);
        return n == null ? 0 : n;
    }

    /** The first {@code limit} matching rows in the inbox's order (newest first when dated). */
    public List<TaskRow> rows(Query q, int limit) {
        MapSqlParameterSource p = params(q).addValue("limit", limit);
        String sql = "SELECT a.id, a.engine_id, a.member_id, a.kind, a.action_type, a.channel, a.status "
                + where(q) + orderBy(q) + " LIMIT :limit";
        return jdbc.query(sql, p, (rs, i) -> new TaskRow(rs.getString("id"), rs.getString("engine_id"),
                rs.getString("member_id"), rs.getString("kind"), rs.getString("action_type"),
                rs.getString("channel"), rs.getString("status")));
    }

    /**
     * WhatsApp messages each of these sends was followed by on its own institute-local day: same
     * member, sent, a message (SEND or a sent TASK, not CRM work). Reply attribution needs them to
     * credit an inbound to the latest send before it, exactly as the daily report of that day
     * (which reads the engine's sends up to the end of its day) does.
     */
    public List<String> laterSendsSameDay(String instituteId, List<String> actionIds, String tz) {
        if (actionIds.isEmpty()) return List.of();
        String sql = """
                SELECT DISTINCT n.id
                FROM engagement_action a
                JOIN engagement_action n ON n.member_id = a.member_id AND n.id <> a.id
                WHERE a.institute_id = :instituteId AND a.id IN (:ids)
                  AND a.dispatched_at IS NOT NULL
                  AND n.channel = 'WHATSAPP' AND n.status = 'SENT'
                  AND n.kind IN ('SEND', 'TASK')
                  AND COALESCE(n.action_type, '') NOT IN (:crmTypes)
                  AND n.dispatched_at >= a.dispatched_at
                  AND n.dispatched_at < ((date_trunc('day', a.dispatched_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)
                                          + interval '1 day') AT TIME ZONE :tz AT TIME ZONE 'UTC')
                """;
        return jdbc.queryForList(sql, new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("ids", actionIds)
                .addValue("crmTypes", EngagementActionTypes.CRM_TYPES)
                .addValue("tz", tz), String.class);
    }

    /** The AI calls these actions queued (ai_call_queue source ENGAGEMENT_ENGINE), newest first. */
    public List<CallRow> calls(String instituteId, List<String> actionIds) {
        if (actionIds.isEmpty()) return List.of();
        String sql = """
                SELECT q.source_ref AS action_id, q.status AS queue_status, q.call_log_id,
                       t.status AS call_status, t.duration_seconds
                FROM ai_call_queue q
                LEFT JOIN telephony_call_log t ON t.id = q.call_log_id
                WHERE q.institute_id = :instituteId AND q.source = 'ENGAGEMENT_ENGINE'
                  AND q.source_ref IN (:ids)
                ORDER BY q.created_at DESC, q.id
                """;
        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("ids", actionIds),
                (rs, i) -> new CallRow(rs.getString("action_id"), rs.getString("queue_status"),
                        rs.getString("call_log_id"), rs.getString("call_status"),
                        (Integer) rs.getObject("duration_seconds")));
    }

    // ── SQL building ─────────────────────────────────────────────────────────

    static String where(Query q) {
        StringBuilder sql = new StringBuilder("""
                FROM engagement_action a
                WHERE a.institute_id = :instituteId
                  AND a.engine_id IN (:engineIds)
                  AND a.status IN (:statuses)
                """);
        sql.append("  AND ").append(kindClause(q.kind())).append('\n');
        if (q.channels() != null) sql.append("  AND ").append(channelClause(q.channels())).append('\n');
        if (q.dated()) {
            sql.append("""
                      AND a.created_at >= :scanFrom AND a.created_at < :to
                      AND COALESCE(a.dispatched_at, a.created_at) >= :from
                      AND COALESCE(a.dispatched_at, a.created_at) < :to
                    """);
        }
        if (q.template() != null) {
            // The report names an email drafted on an email template after the template (else its
            // id), an AI-written email after its subject, a WhatsApp message after its template.
            sql.append("""
                      AND (a.template_name = :template
                           OR a.variables_json ->> '_subject' = :template
                           OR a.variables_json ->> '_emailTemplateId' = :template
                           OR EXISTS (SELECT 1 FROM engagement_email_template et
                                       WHERE et.id = a.variables_json ->> '_emailTemplateId'
                                         AND et.engine_id = a.engine_id AND et.name = :template))
                    """);
        }
        return sql.toString();
    }

    static String kindClause(String kind) {
        if (kind == null) return DEFAULT_KINDS;
        if ("CRM".equals(kind)) return "a.kind = 'TASK' AND a.action_type IN (:crmTypes)";
        return "a.kind = :kind";
    }

    /** channels is non-empty; AI_CALL is the call rows, every other channel leaves them out. */
    static String channelClause(List<String> channels) {
        boolean calls = channels.contains("AI_CALL");
        boolean messages = channels.stream().anyMatch(c -> !"AI_CALL".equals(c));
        String msg = "(a.channel IN (:channels) AND COALESCE(a.action_type, '') <> '"
                + EngagementActionTypes.SCHEDULE_AI_CALL + "')";
        if (calls && messages) return "(" + CALL_ROW + " OR " + msg + ")";
        return calls ? CALL_ROW : msg;
    }

    /**
     * What waits on a person first, as in findInbox: a lead's reply and an AI call to approve, then
     * the other CRM actions, then the rest. Drafts must not push them off the first page.
     */
    static final String APPROVALS_FIRST = "CASE"
            + " WHEN a.status NOT IN ('OPEN', 'ACKED') THEN 2"
            + " WHEN a.kind = 'REPLY' THEN 0"
            + " WHEN a.kind <> 'TASK' THEN 2"
            + " WHEN a.action_type = '" + EngagementActionTypes.SCHEDULE_AI_CALL + "' THEN 0"
            + " WHEN a.action_type IN ('ADD_NOTE', 'CREATE_FOLLOWUP', 'ESCALATE', 'UPDATE_STATUS') THEN 1"
            + " ELSE 2 END";

    static String orderBy(Query q) {
        return q.dated()
                ? " ORDER BY COALESCE(a.dispatched_at, a.created_at) DESC, a.id"
                : " ORDER BY " + APPROVALS_FIRST
                        + ", a.priority DESC NULLS LAST, a.scheduled_for ASC NULLS LAST, a.created_at DESC, a.id";
    }

    private static MapSqlParameterSource params(Query q) {
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("instituteId", q.instituteId())
                .addValue("engineIds", q.engineIds())
                .addValue("statuses", q.statuses())
                .addValue("crmTypes", EngagementActionTypes.CRM_TYPES);
        if (q.kind() != null && !"CRM".equals(q.kind())) p.addValue("kind", q.kind());
        if (q.channels() != null) p.addValue("channels", q.channels());
        if (q.dated()) {
            p.addValue("from", q.from(), Types.TIMESTAMP)
                    .addValue("to", q.to(), Types.TIMESTAMP)
                    .addValue("scanFrom", q.scanFrom(), Types.TIMESTAMP);
        }
        if (q.template() != null) p.addValue("template", q.template());
        return p;
    }
}
