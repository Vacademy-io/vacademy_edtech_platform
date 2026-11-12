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
