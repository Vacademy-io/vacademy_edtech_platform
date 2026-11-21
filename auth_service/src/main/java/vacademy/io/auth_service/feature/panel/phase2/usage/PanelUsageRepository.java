package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;
import vacademy.io.auth_service.feature.panel.service.PanelTimers;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.List;

/**
 * SQL of the usage report and the activity log. Every institute read filters on institute_id, so a
 * caller authorised for one institute cannot read another's rows through any parameter.
 *
 * <p>The panel tables store timestamp without time zone, written with now() in the database
 * session's zone. Reads convert to epoch milliseconds in SQL and window bounds come in as epoch
 * milliseconds, so the report is right whatever zone the JVM runs in. The database clock is the
 * only clock.
 */
@Repository
public class PanelUsageRepository {

    /** Epoch milliseconds of a timestamp column, or null. */
    private static String ms(String column) {
        return "(EXTRACT(EPOCH FROM CAST(" + column + " AS timestamptz)) * 1000)::bigint";
    }

    /** A timestamp in the database session's zone from an epoch-milliseconds parameter. */
    private static String ts(String param) {
        return "CAST(to_timestamp(CAST(:" + param + " AS double precision) / 1000.0) AS timestamp)";
    }

    private static final String ONLINE_INTERVAL = "interval '" + (PanelTimers.PANEL_ONLINE_MS / 1000) + " seconds'";

    /**
     * The effective end of session s, clipped to the window end :we. The same rule as
     * {@link PanelUsageMath#clippedEnd}.
     */
    private static final String END_AT = "GREATEST(s.created_at, LEAST(COALESCE(s.ended_at, localtimestamp), "
            + "localtimestamp, s.panel_seen_at + " + ONLINE_INTERVAL + ", s.active_until, s.expires_at, " + ts("we")
            + "))";

    private static final String COUNTED_IN_WINDOW = """
             s.institute_id = :inst AND s.panel_seen_at IS NOT NULL
             AND s.created_at >= %s AND s.created_at < %s
            """.formatted(ts("ws"), ts("we"));

    private final NamedParameterJdbcTemplate jdbc;

    public PanelUsageRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static MapSqlParameterSource window(String instituteId, long windowStartMs, long windowEndMs) {
        return new MapSqlParameterSource().addValue("inst", instituteId).addValue("ws", windowStartMs)
                .addValue("we", windowEndMs);
    }

    private static Long longOrNull(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    // ---------------------------------------------------------------- rows ---

    /** One counted session, raw: the effective end is computed by {@link PanelUsageMath}. */
    public record SessionFact(String id, String roomId, String roomName, String userId, String userName,
            String startedVia, String endReason, long createdMs, Long endedMs, Long panelSeenMs, Long activeUntilMs,
            Long expiresMs, boolean hasEvents) {
    }

    /**
     * Content time of one teacher on one item. An item is (kind, ref_id), or (kind, title) when the
     * panel sent no ref_id. title is the latest title seen for it; lastMs the latest start.
     */
    public record ContentFact(String userId, String kind, String refId, String title, long durationMs,
            int sessions, int events, long lastMs) {
    }

    /** A live, approved panel in an active room, with the start of its last counted session. */
    public record LivePanel(String deviceId, String roomId, String roomName, Long lastSeenMs, Long lastUsedMs) {
    }

    public record EventFact(String sessionId, int seq, String kind, String title, long startedMs) {
    }

    /** A validated event ready to insert. atMs null means "now". */
    public record NewEvent(int seq, String kind, String refId, String parentId, String title, Long atMs) {
    }

    public record InstituteFact(String instituteId, int roomsWithPanel, int devices, Long firstPairedMs) {
    }

    // -------------------------------------------------------------- report ---

    /**
     * Caps every statement of the current transaction at seconds, so a large report gives up
     * instead of holding a connection auth also needs for sign-ins. Transaction-scoped (is_local),
     * so it is safe behind pgbouncer in transaction mode. Call inside a transaction.
     */
    public void limitStatementTime(int seconds) {
        jdbc.getJdbcTemplate().queryForObject("SELECT set_config('statement_timeout', ?, true)", String.class,
                String.valueOf(seconds * 1000));
    }

    public long nowMs() {
        Long now = jdbc.getJdbcTemplate().queryForObject("SELECT " + ms("now()"), Long.class);
        return now == null ? System.currentTimeMillis() : now;
    }

    private static final String SESSION_COLUMNS = """
            s.id, s.room_id, r.name AS room_name, s.user_id, u.full_name AS user_name, s.started_via, s.end_reason,
            %s AS created_ms, %s AS ended_ms, %s AS seen_ms, %s AS active_until_ms, %s AS expires_ms,
            EXISTS (SELECT 1 FROM public.panel_activity a WHERE a.session_id = s.id) AS has_events
            FROM public.panel_session s
            LEFT JOIN public.classroom_room r ON r.id = s.room_id
            LEFT JOIN public.users u ON u.id = s.user_id
            """.formatted(ms("s.created_at"), ms("s.ended_at"), ms("s.panel_seen_at"), ms("s.active_until"),
            ms("s.expires_at"));

    private static SessionFact sessionFact(ResultSet rs) throws SQLException {
        return new SessionFact(rs.getString("id"), rs.getString("room_id"), rs.getString("room_name"),
                rs.getString("user_id"), rs.getString("user_name"), rs.getString("started_via"),
                rs.getString("end_reason"), rs.getLong("created_ms"), longOrNull(rs, "ended_ms"),
                longOrNull(rs, "seen_ms"), longOrNull(rs, "active_until_ms"), longOrNull(rs, "expires_ms"),
                rs.getBoolean("has_events"));
    }

    /** Every counted session of the institute that started inside [ws, we). */
    public List<SessionFact> sessions(String instituteId, long windowStartMs, long windowEndMs) {
        return jdbc.query("SELECT " + SESSION_COLUMNS + " WHERE " + COUNTED_IN_WINDOW,
                window(instituteId, windowStartMs, windowEndMs), (rs, n) -> sessionFact(rs));
    }

    /**
     * Content time per teacher and item for the counted sessions that started inside [ws, we).
     * slackHours bounds the event scan past the window end: events never start after their
     * session's cap, so it is the longest session length plus a margin.
     */
    public List<ContentFact> content(String instituteId, long windowStartMs, long windowEndMs, int slackHours) {
        String sql = """
                WITH s AS (
                    SELECT s.id, s.user_id, %s AS end_at
                    FROM public.panel_session s
                    WHERE %s
                ), e AS (
                    SELECT a.session_id, s.user_id, a.kind, a.ref_id, a.title, a.started_at, s.end_at,
                           LEAD(a.started_at) OVER (PARTITION BY a.session_id ORDER BY a.client_seq) AS next_at
                    FROM public.panel_activity a
                    JOIN s ON s.id = a.session_id
                    WHERE a.institute_id = :inst
                      AND a.started_at >= %s AND a.started_at < %s + :slack * interval '1 hour'
                ), d AS (
                    SELECT session_id, user_id, kind, ref_id, title, started_at,
                           GREATEST(0, EXTRACT(EPOCH FROM (LEAST(COALESCE(next_at, end_at), end_at,
                                    started_at + :cap * interval '1 second') - started_at))) AS secs
                    FROM e
                    WHERE kind <> 'HOME'
                )
                SELECT user_id, kind, ref_id,
                       (array_agg(title ORDER BY started_at DESC))[1] AS title,
                       SUM(secs) AS secs, COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS events,
                       %s AS last_ms
                FROM d
                GROUP BY user_id, kind, ref_id, CASE WHEN ref_id IS NULL THEN title END
                """.formatted(END_AT, COUNTED_IN_WINDOW, ts("ws"), ts("we"), ms("MAX(started_at)"));
        MapSqlParameterSource params = window(instituteId, windowStartMs, windowEndMs)
                .addValue("slack", slackHours).addValue("cap", PanelUsageMath.MAX_EVENT_MS / 1000);
        return jdbc.query(sql, params, (rs, n) -> new ContentFact(rs.getString("user_id"), rs.getString("kind"),
                rs.getString("ref_id"), rs.getString("title"), Math.round(rs.getDouble("secs") * 1000),
                rs.getInt("sessions"), rs.getInt("events"), rs.getLong("last_ms")));
    }

    /** Live (CLAIMED or ACTIVE), APPROVED panels in ACTIVE rooms: the rooms that have a panel. */
    public List<LivePanel> livePanels(String instituteId) {
        String sql = """
                SELECT d.id AS device_id, d.room_id, r.name AS room_name, %s AS last_seen_ms,
                       (SELECT %s FROM public.panel_session ls
                        WHERE ls.device_id = d.id AND ls.panel_seen_at IS NOT NULL
                        ORDER BY ls.created_at DESC LIMIT 1) AS last_used_ms
                FROM public.panel_device d
                JOIN public.classroom_room r ON r.id = d.room_id
                WHERE d.institute_id = :inst AND d.status IN ('CLAIMED','ACTIVE') AND d.approval_state = 'APPROVED'
                  AND r.status = 'ACTIVE'
                ORDER BY lower(r.name), r.id
                """.formatted(ms("d.last_seen_at"), ms("ls.created_at"));
        return jdbc.query(sql, new MapSqlParameterSource("inst", instituteId),
                (rs, n) -> new LivePanel(rs.getString("device_id"), rs.getString("room_id"),
                        rs.getString("room_name"), longOrNull(rs, "last_seen_ms"), longOrNull(rs, "last_used_ms")));
    }

    /** The start of the institute's earliest recorded event still kept, or null. */
    public Long contentRecordedFromMs(String instituteId) {
        List<Long> rows = jdbc.query("SELECT " + ms("MIN(started_at)") + " AS m FROM public.panel_activity "
                + "WHERE institute_id = :inst", new MapSqlParameterSource("inst", instituteId),
                (rs, n) -> longOrNull(rs, "m"));
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ---------------------------------------------------------- drill-down ---

    private static String drillFilter(String roomId, String userId) {
        return " WHERE " + COUNTED_IN_WINDOW + (roomId == null ? "" : " AND s.room_id = :room ")
                + (userId == null ? "" : " AND s.user_id = :user ");
    }

    /** One page of counted sessions, newest first. roomId and userId narrow it when not null. */
    public List<SessionFact> sessionPage(String instituteId, long windowStartMs, long windowEndMs, String roomId,
            String userId, int limit, long offset) {
        MapSqlParameterSource params = window(instituteId, windowStartMs, windowEndMs).addValue("room", roomId)
                .addValue("user", userId).addValue("limit", limit).addValue("offset", offset);
        return jdbc.query("SELECT " + SESSION_COLUMNS + drillFilter(roomId, userId)
                + " ORDER BY s.created_at DESC, s.id LIMIT :limit OFFSET :offset", params, (rs, n) -> sessionFact(rs));
    }

    public long countSessions(String instituteId, long windowStartMs, long windowEndMs, String roomId,
            String userId) {
        MapSqlParameterSource params = window(instituteId, windowStartMs, windowEndMs).addValue("room", roomId)
                .addValue("user", userId);
        Long count = jdbc.queryForObject("SELECT count(*) FROM public.panel_session s" + drillFilter(roomId, userId),
                params, Long.class);
        return count == null ? 0 : count;
    }

    /** The events of these sessions of the institute, in sequence order per session. */
    public List<EventFact> events(String instituteId, List<String> sessionIds) {
        if (sessionIds.isEmpty()) {
            return List.of();
        }
        String sql = "SELECT session_id, client_seq, kind, title, " + ms("started_at") + " AS started_ms "
                + "FROM public.panel_activity WHERE institute_id = :inst AND session_id IN (:ids) "
                + "ORDER BY session_id, client_seq";
        return jdbc.query(sql, new MapSqlParameterSource("inst", instituteId).addValue("ids", sessionIds),
                (rs, n) -> new EventFact(rs.getString("session_id"), rs.getInt("client_seq"), rs.getString("kind"),
                        rs.getString("title"), rs.getLong("started_ms")));
    }

    // -------------------------------------------------------------- ingest ---

    /**
     * Stores the events of one session in one batch. A row is written only while the session belongs
     * to deviceId and is ACTIVE or ended less than endGraceSeconds ago, and only while the session
     * holds fewer than perSessionCap events. A repeated (session, seq) is ignored. started_at is the
     * event's time clamped into [session start, now]. Institute, room and teacher come from the
     * session row, never from the panel.
     */
    public void insertEvents(String sessionId, String deviceId, List<NewEvent> events, int perSessionCap,
            int endGraceSeconds) {
        if (events.isEmpty()) {
            return;
        }
        String sql = """
                INSERT INTO public.panel_activity
                    (session_id, device_id, institute_id, room_id, user_id, client_seq, kind, ref_id, parent_id,
                     title, started_at)
                SELECT s.id, s.device_id, s.institute_id, s.room_id, s.user_id, :seq, :kind, :ref, :parent, :title,
                       LEAST(GREATEST(COALESCE(%s, localtimestamp), s.created_at), localtimestamp)
                FROM public.panel_session s
                WHERE s.id = :session AND s.device_id = :device
                  AND (s.status = 'ACTIVE' OR s.ended_at > localtimestamp - :grace * interval '1 second')
                  AND (SELECT count(*) FROM public.panel_activity x WHERE x.session_id = s.id) < :cap
                ON CONFLICT (session_id, client_seq) DO NOTHING
                """.formatted(ts("at"));
        SqlParameterSource[] batch = events.stream()
                .map(e -> new MapSqlParameterSource().addValue("session", sessionId).addValue("device", deviceId)
                        .addValue("seq", e.seq()).addValue("kind", e.kind())
                        .addValue("ref", e.refId(), Types.VARCHAR).addValue("parent", e.parentId(), Types.VARCHAR)
                        .addValue("title", e.title(), Types.VARCHAR).addValue("at", e.atMs(), Types.BIGINT)
                        .addValue("grace", endGraceSeconds).addValue("cap", perSessionCap))
                .toArray(SqlParameterSource[]::new);
        jdbc.batchUpdate(sql, batch);
    }

    /** Deletes at most limit events older than retentionDays. */
    public int purgeActivity(int retentionDays, int limit) {
        return jdbc.update("""
                DELETE FROM public.panel_activity WHERE id IN (
                    SELECT id FROM public.panel_activity
                    WHERE created_at < localtimestamp - :days * interval '1 day'
                    LIMIT :limit)
                """, new MapSqlParameterSource("days", retentionDays).addValue("limit", limit));
    }

    // ------------------------------------------------------------ internal ---

    /**
     * Institutes with at least one live panel, by id, one page. rooms_with_panel counts the rooms the
     * report counts (live, approved panel, active room); devices counts every live panel.
     */
    public List<InstituteFact> institutesWithPanels(int limit, long offset) {
        String sql = """
                SELECT d.institute_id,
                       COUNT(DISTINCT d.room_id) FILTER (WHERE d.status IN ('CLAIMED','ACTIVE')
                           AND d.approval_state = 'APPROVED' AND r.status = 'ACTIVE') AS rooms_with_panel,
                       COUNT(*) FILTER (WHERE d.status IN ('CLAIMED','ACTIVE')) AS devices,
                       %s AS first_paired_ms
                FROM public.panel_device d
                JOIN public.classroom_room r ON r.id = d.room_id
                GROUP BY d.institute_id
                HAVING COUNT(*) FILTER (WHERE d.status IN ('CLAIMED','ACTIVE')) > 0
                ORDER BY d.institute_id
                LIMIT :limit OFFSET :offset
                """.formatted(ms("MIN(COALESCE(d.confirmed_at, d.claimed_at))"));
        return jdbc.query(sql, new MapSqlParameterSource("limit", limit).addValue("offset", offset),
                (rs, n) -> new InstituteFact(rs.getString("institute_id"), rs.getInt("rooms_with_panel"),
                        rs.getInt("devices"), longOrNull(rs, "first_paired_ms")));
    }

    public boolean hasLivePanels(String instituteId) {
        Boolean any = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM public.panel_device
                               WHERE institute_id = :inst AND status IN ('CLAIMED','ACTIVE'))
                """, new MapSqlParameterSource("inst", instituteId), Boolean.class);
        return Boolean.TRUE.equals(any);
    }
}
