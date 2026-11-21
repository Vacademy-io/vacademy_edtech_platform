package vacademy.io.admin_core_service.features.engagement.service;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * The reads behind the daily approvals notice: what sits in an institute's engagement inbox
 * waiting for a person, grouped the way the notice lists it.
 *
 * <p>engagement_action stores naive UTC, so bounds are passed as UTC local times and ages are read
 * as epoch milliseconds: the JVM time zone never shifts them.
 */
@Repository
public class EngagementApprovalDigestDao {

    private final NamedParameterJdbcTemplate jdbc;

    public EngagementApprovalDigestDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * One group of waiting inbox rows of an engine.
     *
     * @param kind       TASK (a draft or proposed action) or REPLY (someone wrote in)
     * @param channel    the message channel, null for a CRM action
     * @param actionType the CRM action type, or SEND_MESSAGE / null for a message
     * @param blocked    the engine tried to run these by itself and could not (error_message is set)
     * @param lapsingSoon how many of them expire before {@code soon}
     */
    public record Waiting(String engineId, String kind, String channel, String actionType, boolean blocked,
                          int count, int lapsingSoon, Instant oldest) {
    }

    /** Open inbox rows of the institute's ACTIVE engines that have not expired, grouped. */
    public List<Waiting> waiting(String instituteId, Instant now, Instant soon) {
        String sql = """
                SELECT a.engine_id, a.kind, a.channel, a.action_type,
                       (a.error_message IS NOT NULL) AS blocked,
                       count(*) AS n,
                       count(*) FILTER (WHERE a.expires_at IS NOT NULL AND a.expires_at < :soon) AS lapsing,
                       (EXTRACT(EPOCH FROM min(a.created_at)) * 1000)::bigint AS oldest_ms
                FROM engagement_action a
                JOIN engagement_engine e ON e.id = a.engine_id
                WHERE a.institute_id = :instituteId AND e.status = 'ACTIVE'
                  AND a.kind IN ('TASK', 'REPLY') AND a.status IN ('OPEN', 'ACKED')
                  AND (a.expires_at IS NULL OR a.expires_at > :now)
                GROUP BY a.engine_id, a.kind, a.channel, a.action_type, (a.error_message IS NOT NULL)
                """;
        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("now", utc(now))
                        .addValue("soon", utc(soon)),
                (rs, i) -> new Waiting(rs.getString("engine_id"), rs.getString("kind"), rs.getString("channel"),
                        rs.getString("action_type"), rs.getBoolean("blocked"), rs.getInt("n"), rs.getInt("lapsing"),
                        Instant.ofEpochMilli(rs.getLong("oldest_ms"))));
    }

    /**
     * One open inbox row that may need a person by name in the notice: a reply someone wrote in, a
     * hand-over or escalation, or a task whose reason may say the lead replied. The job decides which
     * of them really are (the SQL is a coarse first cut).
     */
    public record Candidate(String id, String engineId, String memberId, String kind, String channel,
                            String actionType, boolean blocked, String rationale, String draftBody,
                            double priority, Instant created) {
    }

    /** Most candidate rows one notice reads; far above what a person can act on in a morning. */
    static final int MAX_CANDIDATES = 500;

    /**
     * Open rows of the institute's ACTIVE engines, not expired, that may need a person by name:
     * replies, hand-overs and escalations, and tasks whose reason mentions a reply.
     */
    public List<Candidate> candidates(String instituteId, Instant now) {
        String sql = """
                SELECT a.id, a.engine_id, a.member_id, a.kind, a.channel, a.action_type,
                       (a.error_message IS NOT NULL) AS blocked, a.rationale, a.draft_body,
                       COALESCE(a.priority, 0) AS priority,
                       (EXTRACT(EPOCH FROM a.created_at) * 1000)::bigint AS created_ms
                FROM engagement_action a
                JOIN engagement_engine e ON e.id = a.engine_id
                WHERE a.institute_id = :instituteId AND e.status = 'ACTIVE'
                  AND a.status IN ('OPEN', 'ACKED')
                  AND (a.expires_at IS NULL OR a.expires_at > :now)
                  AND (a.kind = 'REPLY'
                       OR (a.kind = 'TASK' AND (a.action_type = :escalate
                                                OR a.rationale ILIKE 'Escalated%'
                                                OR a.rationale ~* :replied)))
                ORDER BY a.created_at
                LIMIT :limit
                """;
        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("instituteId", instituteId)
                        .addValue("now", utc(now))
                        .addValue("escalate", EngagementActionTypes.ESCALATE)
                        .addValue("replied", EngagementApprovalDigest.REPLIED_SQL)
                        .addValue("limit", MAX_CANDIDATES),
                (rs, i) -> new Candidate(rs.getString("id"), rs.getString("engine_id"), rs.getString("member_id"),
                        rs.getString("kind"), rs.getString("channel"), rs.getString("action_type"),
                        rs.getBoolean("blocked"), rs.getString("rationale"), rs.getString("draft_body"),
                        rs.getDouble("priority"), Instant.ofEpochMilli(rs.getLong("created_ms"))));
    }

    /** Drafts and proposed actions of ACTIVE engines that expired unsent between {@code since} and now. */
    public int lapsed(String instituteId, Instant since, Instant now) {
        Integer n = jdbc.queryForObject("""
                SELECT count(*) FROM engagement_action a
                JOIN engagement_engine e ON e.id = a.engine_id
                WHERE a.institute_id = :instituteId AND e.status = 'ACTIVE'
                  AND a.kind = 'TASK' AND a.status = 'EXPIRED'
                  AND a.expires_at >= :since AND a.expires_at < :now
                """, new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("since", utc(since))
                .addValue("now", utc(now)), Integer.class);
        return n == null ? 0 : n;
    }

    /** The institute's own admin portal host when it has one (white label), else null. */
    public String adminPortalHost(String instituteId) {
        List<String> rows = jdbc.query("SELECT admin_portal_base_url FROM institutes WHERE id = :id",
                new MapSqlParameterSource().addValue("id", instituteId), (rs, i) -> rs.getString(1));
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static LocalDateTime utc(Instant t) {
        return LocalDateTime.ofInstant(t, ZoneOffset.UTC);
    }
}
