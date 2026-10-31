package vacademy.io.admin_core_service.features.engagement.service;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

/**
 * The reads behind the engine page's "AI calls" card: the engine's calls that have not happened
 * yet (waiting for approval, held for a later time, in the dialer queue), the ones placed lately,
 * and the people whose first touch will be a call.
 *
 * <p>engagement_action, engagement_member and ai_call_queue store naive UTC; times are read as
 * epoch milliseconds so the JVM time zone never shifts them.
 */
@Repository
public class EngagementUpcomingCallsDao {

    /** A call proposal is OPEN for 72 hours and a held call at most 14 days out: older rows are done. */
    static final int LOOKBACK_DAYS = 15;

    private final NamedParameterJdbcTemplate jdbc;

    public EngagementUpcomingCallsDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * One SCHEDULE_AI_CALL action with its queue row and call, if any. Times are null when unset;
     * notBefore null on a queued call means "as soon as a line is free".
     */
    public record CallRow(String actionId, String memberId, String kind, String status, String rationale,
                          Instant scheduledFor, Instant expiresAt, String queueStatus, Instant notBefore,
                          Instant dialedAt, String callStatus) {
    }

    /** A person the engine has not touched yet, and when it next looks at them. */
    public record FirstCallRow(String memberId, Instant nextLookAt) {
    }

    /**
     * Calls of the engine still to happen (approval, held, queued) and the ones dialled since
     * {@code placedSince}, soonest first, then the placed ones newest first.
     */
    public List<CallRow> calls(String instituteId, String engineId, LocalDateTime placedSince, int limit) {
        String sql = """
                SELECT a.id, a.member_id, a.kind, a.status, a.rationale,
                       (EXTRACT(EPOCH FROM a.scheduled_for) * 1000)::bigint AS scheduled_ms,
                       (EXTRACT(EPOCH FROM a.expires_at) * 1000)::bigint AS expires_ms,
                       q.status AS queue_status,
                       (EXTRACT(EPOCH FROM q.not_before) * 1000)::bigint AS not_before_ms,
                       (EXTRACT(EPOCH FROM q.dispatched_at) * 1000)::bigint AS dialed_ms,
                       t.status AS call_status
                FROM engagement_action a
                LEFT JOIN ai_call_queue q ON q.source = 'ENGAGEMENT_ENGINE' AND q.source_ref = a.id
                LEFT JOIN telephony_call_log t ON t.id = q.call_log_id
                WHERE a.engine_id = :engineId AND a.institute_id = :instituteId
                  AND a.action_type = :callType
                  AND a.created_at >= :lookback
                  AND ((a.kind IN ('TASK', 'SEND') AND a.status IN ('OPEN', 'ACKED'))
                       OR q.status IN ('QUEUED', 'DISPATCHING')
                       OR (q.status = 'DIALED' AND q.dispatched_at >= :placedSince))
                ORDER BY CASE WHEN q.status = 'DIALED' THEN 1 ELSE 0 END,
                         CASE WHEN q.status = 'DIALED' THEN NULL
                              ELSE COALESCE(q.not_before, a.scheduled_for, a.created_at) END ASC,
                         q.dispatched_at DESC NULLS LAST, a.id
                LIMIT :limit
                """;
        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("engineId", engineId)
                        .addValue("callType", EngagementActionTypes.SCHEDULE_AI_CALL)
                        .addValue("lookback", placedSince.minusDays(LOOKBACK_DAYS))
                        .addValue("placedSince", placedSince)
                        .addValue("limit", limit),
                (rs, i) -> new CallRow(rs.getString("id"), rs.getString("member_id"), rs.getString("kind"),
                        rs.getString("status"), rs.getString("rationale"), instant(rs, "scheduled_ms"),
                        instant(rs, "expires_ms"), rs.getString("queue_status"), instant(rs, "not_before_ms"),
                        instant(rs, "dialed_ms"), rs.getString("call_status")));
    }

    /**
     * Active, non-holdout members with no touch yet (EngagementActionRepository.TOUCH_PREDICATE), in
     * the order the engine will look at them. With the AI call channel on, that look places a call
     * first (EngagementDecisionService, the first-touch rule).
     */
    public List<FirstCallRow> firstCalls(String instituteId, String engineId, int limit) {
        String sql = "SELECT m.id, (EXTRACT(EPOCH FROM m.next_action_at) * 1000)::bigint AS next_ms "
                + untouched() + " ORDER BY m.next_action_at, m.id LIMIT :limit";
        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("engineId", engineId)
                        .addValue("limit", limit),
                (rs, i) -> new FirstCallRow(rs.getString("id"), instant(rs, "next_ms")));
    }

    public long countFirstCalls(String instituteId, String engineId) {
        Long n = jdbc.queryForObject("SELECT count(*) " + untouched(), new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("engineId", engineId), Long.class);
        return n == null ? 0 : n;
    }

    private static String untouched() {
        return """
                FROM engagement_member m
                WHERE m.engine_id = :engineId AND m.institute_id = :instituteId
                  AND m.status = 'ACTIVE' AND m.is_holdout = false
                  AND NOT EXISTS (SELECT 1 FROM engagement_action
                                  WHERE member_id = m.id AND\s""" + EngagementActionRepository.TOUCH_PREDICATE + ")";
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        long ms = rs.getLong(column);
        return rs.wasNull() ? null : Instant.ofEpochMilli(ms);
    }
}
