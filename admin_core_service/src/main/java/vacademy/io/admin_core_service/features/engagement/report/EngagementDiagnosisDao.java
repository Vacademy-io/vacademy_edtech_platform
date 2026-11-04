package vacademy.io.admin_core_service.features.engagement.report;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Reads for the engagement diagnosis ({@link EngagementDiagnosisSql}). Plain reads, no transaction of
 * their own: the service runs each section in its read-only transaction with a statement timeout, as
 * the daily report does.
 */
@Repository
public class EngagementDiagnosisDao {

    private final NamedParameterJdbcTemplate jdbc;

    public EngagementDiagnosisDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** A person added in the period. source: lead_candidate.source, null when no Lead Agent delivered them. */
    record LeadRow(String person, String stPhone, String stEmail, String leadPhone, String leadEmail, String source) {
    }

    record AgentRow(String agentId, String name, String status, LocalDateTime createdAt, String windowJson) {
    }

    record ActionRow(String id, String engineId, String kind, String channel, String status, String promptVersionId,
                     String templateName, String subject, String emailTemplateId, String emailTemplateName,
                     LocalDateTime dispatchedAt, String userId, String audienceResponseId) {

        /** The report's person (the lead row, else the user), as leads added counts them. */
        String person() {
            return EngagementDiagnosisDao.person(audienceResponseId, userId);
        }

        /** Who actually gets the message: one user on two lead rows is one person here. */
        String contactKey() {
            return userId != null ? userId : audienceResponseId;
        }

        /** As the report's messages: a SEND or a TASK a person sent. */
        boolean reportSend() {
            return "SEND".equals(kind) || "TASK".equals(kind);
        }

        boolean sent() {
            return "SENT".equals(status);
        }

        EngagementDailyReportDao.Send asSend() {
            return new EngagementDailyReportDao.Send(id, engineId, kind, channel, status, templateName, subject,
                    emailTemplateId, emailTemplateName, dispatchedAt);
        }
    }

    /** One queue row. localHour: null until a call log exists. analysed: its analysis finished. */
    record CallRow(String queueId, String queueStatus, String callLogId, String userId, String audienceResponseId,
                   String callStatus, Integer durationSeconds, boolean connected, Integer localHour, boolean analysed,
                   String genericStatus, String leadSentiment, String conversionLikelihood, String objectionsJson) {

        String person() {
            return EngagementDiagnosisDao.person(audienceResponseId, userId);
        }
    }

    record BookingRow(String bookingId, String userId, String audienceResponseId, LocalDateTime bookedAt) {

        String person() {
            return EngagementDiagnosisDao.person(audienceResponseId, userId);
        }
    }

    record PromptVersionRow(String id, String engineId, String engineName, int version, LocalDateTime createdAt,
                            String source, String change) {
    }

    private static String person(String audienceResponseId, String userId) {
        return audienceResponseId != null ? audienceResponseId : "u:" + userId;
    }

    List<LeadRow> leads(MapSqlParameterSource p) {
        return jdbc.queryForList(EngagementDiagnosisSql.LEADS, p).stream()
                .map(r -> new LeadRow(str(r, "person"), str(r, "st_phone"), str(r, "st_email"),
                        str(r, "lead_phone"), str(r, "lead_email"), str(r, "source")))
                .toList();
    }

    /** {@code p} must carry a non-empty {@code listIds}. */
    List<AgentRow> leadAgents(MapSqlParameterSource p) {
        return jdbc.queryForList(EngagementDiagnosisSql.LEAD_AGENTS, p).stream()
                .map(r -> new AgentRow(str(r, "agent_id"), str(r, "name"), str(r, "status"), ts(r, "created_at"),
                        str(r, "window_json")))
                .toList();
    }

    /**
     * Messages dispatched in [from, to), on a copy of {@code p}: the created_at scan starts
     * {@link EngagementDailyReportService#SEND_SCAN_SLACK} before from.
     */
    List<ActionRow> actions(MapSqlParameterSource p, LocalDateTime from, LocalDateTime to) {
        MapSqlParameterSource q = new MapSqlParameterSource(p.getValues())
                .addValue("sendsFrom", from, Types.TIMESTAMP)
                .addValue("sendsTo", to, Types.TIMESTAMP)
                .addValue("scanFrom", from.minus(EngagementDailyReportService.SEND_SCAN_SLACK), Types.TIMESTAMP);
        return jdbc.queryForList(EngagementDiagnosisSql.ACTIONS, q).stream()
                .map(r -> new ActionRow(str(r, "id"), str(r, "engine_id"), str(r, "kind"), str(r, "channel"),
                        str(r, "status"), str(r, "prompt_version_id"), str(r, "template_name"), str(r, "subject"),
                        str(r, "email_template_id"), str(r, "email_template_name"), ts(r, "dispatched_at"),
                        str(r, "user_id"), str(r, "audience_response_id")))
                .toList();
    }

    List<CallRow> calls(MapSqlParameterSource p) {
        return jdbc.queryForList(EngagementDiagnosisSql.CALLS, p).stream()
                .map(r -> new CallRow(str(r, "queue_id"), str(r, "queue_status"), str(r, "call_log_id"),
                        str(r, "user_id"), str(r, "audience_response_id"), str(r, "call_status"),
                        integer(r, "duration_seconds"), Boolean.TRUE.equals(r.get("connected")),
                        integer(r, "local_hour"), Boolean.TRUE.equals(r.get("analysed")),
                        str(r, "generic_status"), str(r, "lead_sentiment"), str(r, "conversion_likelihood"),
                        str(r, "objections")))
                .toList();
    }

    List<BookingRow> bookings(MapSqlParameterSource p) {
        return jdbc.queryForList(EngagementDiagnosisSql.BOOKINGS, p).stream()
                .map(r -> new BookingRow(str(r, "booking_id"), str(r, "user_id"), str(r, "audience_response_id"),
                        ts(r, "booked_at")))
                .toList();
    }

    /** {@code p} must carry a non-empty {@code versionIds}. */
    List<PromptVersionRow> promptVersions(MapSqlParameterSource p) {
        return jdbc.queryForList(EngagementDiagnosisSql.PROMPT_VERSIONS, p).stream()
                .map(r -> new PromptVersionRow(str(r, "id"), str(r, "engine_id"), str(r, "engine_name"),
                        r.get("version") instanceof Number n ? n.intValue() : 0, ts(r, "created_at"),
                        str(r, "source"), str(r, "change")))
                .toList();
    }

    /** {@code p} must carry {@code stuckBefore}. */
    long stuckMembers(MapSqlParameterSource p) {
        Long n = jdbc.queryForObject(EngagementDiagnosisSql.STUCK_MEMBERS, p, Long.class);
        return n == null ? 0 : n;
    }

    private static String str(Map<String, Object> r, String col) {
        Object v = r.get(col);
        return v == null ? null : v.toString();
    }

    private static Integer integer(Map<String, Object> r, String col) {
        return r.get(col) instanceof Number n ? n.intValue() : null;
    }

    private static LocalDateTime ts(Map<String, Object> r, String col) {
        Object v = r.get(col);
        if (v instanceof Timestamp t) return t.toLocalDateTime();
        if (v instanceof LocalDateTime l) return l;
        return null;
    }
}
