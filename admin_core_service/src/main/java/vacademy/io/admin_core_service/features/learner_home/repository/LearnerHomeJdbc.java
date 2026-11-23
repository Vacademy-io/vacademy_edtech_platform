package vacademy.io.admin_core_service.features.learner_home.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Native SQL of the learner home. Every statement runs outside a read-only transaction, so it is
 * served by the primary (a dismiss must be visible on the next read, and the replica pool is the
 * one that saturates).
 *
 * <p>Status values are SQL literals, never bind parameters: {@code idx_ssigm_user_id_status} is a
 * partial index on {@code status = 'ACTIVE'}, and a generic plan with a bound status cannot use it.
 * No statement carries a ':' outside its bind parameters.
 */
@Repository
public class LearnerHomeJdbc {

    // Q1: the learner's enrolments ("enrolled" = ACTIVE mapping on an ACTIVE/HIDDEN batch of an
    // ACTIVE course; internal charge packages are not courses).
    public static final String ENROLMENTS_SQL = """
            SELECT ssigm.package_session_id, ps.package_id, ssigm.enrolled_date
            FROM student_session_institute_group_mapping ssigm
            JOIN package_session ps ON ps.id = ssigm.package_session_id
            JOIN package p ON p.id = ps.package_id
            WHERE ssigm.user_id = :userId
              AND ssigm.institute_id = :instituteId
              AND ssigm.status = 'ACTIVE'
              AND ps.status IN ('ACTIVE', 'HIDDEN')
              AND p.status = 'ACTIVE'
              AND (p.package_type IS NULL OR p.package_type NOT IN ('DELIVERY_CHARGE', 'SECURITY_DEPOSIT'))
            ORDER BY ssigm.enrolled_date DESC NULLS LAST
            """;

    // Q2: the learner's tags in this institute.
    public static final String TAGS_SQL = """
            SELECT ut.tag_id FROM user_tags ut
            WHERE ut.user_id = :userId AND ut.institute_id = :instituteId AND ut.status = 'ACTIVE'
            """;

    // Q3: the learner's notice state.
    public static final String STATE_SQL = """
            SELECT block_key, dismissed_at, acknowledged_at FROM learner_home_block_user_state
            WHERE institute_id = :instituteId AND user_id = :userId
            """;

    public static final String STATE_ONE_SQL = """
            SELECT block_key, dismissed_at, acknowledged_at FROM learner_home_block_user_state
            WHERE institute_id = :instituteId AND user_id = :userId AND block_key = :blockKey
            """;

    // Idempotent and race-safe: the first dismiss / ack sets the time and returns the row; a repeat
    // (or a concurrent double click, which waits on the row lock and then sees the time set) updates
    // nothing and returns no row, so exactly one event row is written per learner and notice.
    public static final String DISMISS_SQL = """
            INSERT INTO learner_home_block_user_state (institute_id, user_id, block_key, dismissed_at, updated_at)
            VALUES (:instituteId, :userId, :blockKey, now(), now())
            ON CONFLICT (institute_id, user_id, block_key)
            DO UPDATE SET dismissed_at = now(), updated_at = now()
            WHERE learner_home_block_user_state.dismissed_at IS NULL
            RETURNING block_key
            """;

    public static final String ACK_SQL = """
            INSERT INTO learner_home_block_user_state (institute_id, user_id, block_key, acknowledged_at, updated_at)
            VALUES (:instituteId, :userId, :blockKey, now(), now())
            ON CONFLICT (institute_id, user_id, block_key)
            DO UPDATE SET acknowledged_at = now(), updated_at = now()
            WHERE learner_home_block_user_state.acknowledged_at IS NULL
            RETURNING block_key
            """;

    // Preview: the courses of the batches an admin previews as (only batches of this institute).
    public static final String BATCH_PACKAGES_SQL = """
            SELECT DISTINCT ps.id AS package_session_id, ps.package_id
            FROM package_session ps
            JOIN package_institute pi ON pi.package_id = ps.package_id
            WHERE ps.id IN (:ids) AND pi.institute_id = :instituteId
            """;

    // Save-time ownership of audience ids, and link checks.
    public static final String BATCH_OWNERS_SQL = """
            SELECT ps.id, pi.institute_id
            FROM package_session ps
            LEFT JOIN package_institute pi ON pi.package_id = ps.package_id
            WHERE ps.id IN (:ids)
            """;

    public static final String PACKAGE_OWNERS_SQL = """
            SELECT p.id, pi.institute_id, p.status, p.package_name
            FROM package p
            LEFT JOIN package_institute pi ON pi.package_id = p.id
            WHERE p.id IN (:ids)
            """;

    public static final String TAG_OWNERS_SQL = """
            SELECT t.id, t.institute_id, t.status FROM tags t WHERE t.id IN (:ids)
            """;

    public static final String PRODUCT_PAGES_SQL = """
            SELECT pp.code, pp.institute_id, pp.status FROM product_page pp WHERE pp.code IN (:codes)
            """;

    // The next few occurrences of each named live session, with its fee (same option and plan
    // order as the public live-class listing). Times are computed in Java in the session's zone.
    public static final String LIVE_SESSIONS_SQL = """
            SELECT s.id AS session_id, s.institute_id, s.title, s.timezone, s.access_level, s.status,
                   nx.meeting_date, nx.start_time, nx.last_entry_time, pp.actual_price
            FROM live_session s
            LEFT JOIN LATERAL (
                SELECT ss.meeting_date, ss.start_time, ss.last_entry_time
                FROM session_schedules ss
                WHERE ss.session_id = s.id
                  AND COALESCE(ss.status, '') NOT IN ('DELETED', 'CANCELLED')
                  AND ss.meeting_date >= :fromDate
                  AND ss.meeting_date <= :toDate
                ORDER BY ss.meeting_date, ss.start_time
                LIMIT 6
            ) nx ON TRUE
            LEFT JOIN LATERAL (
                SELECT po.id FROM payment_option po
                WHERE po.source = 'LIVE_SESSION' AND po.source_id = s.id AND po.status = 'ACTIVE'
                ORDER BY po.created_at DESC
                LIMIT 1
            ) opt ON TRUE
            LEFT JOIN LATERAL (
                SELECT p.actual_price FROM payment_plan p
                WHERE p.payment_option_id = opt.id AND p.status = 'ACTIVE'
                ORDER BY p.validity_in_days ASC NULLS LAST, p.id
                LIMIT 1
            ) pp ON TRUE
            WHERE s.id IN (:ids)
            ORDER BY s.id, nx.meeting_date, nx.start_time
            """;

    public static final String SESSION_BATCHES_SQL = """
            SELECT lsp.session_id, lsp.source_id FROM live_session_participants lsp
            WHERE lsp.session_id IN (:ids) AND lsp.source_type = 'BATCH'
            """;

    // Block keys of the newest two published versions (current and previous): the events beacon
    // accepts only these.
    public static final String RECENT_KEYS_SQL = """
            SELECT DISTINCT b.block_key FROM learner_home_block b
            WHERE b.layout_id IN (
                SELECT l.id FROM learner_home_layout l
                WHERE l.institute_id = :instituteId AND l.status IN ('PUBLISHED', 'ARCHIVED')
                ORDER BY l.version DESC
                LIMIT 2
            )
            """;

    public static final String INSERT_EVENT_SQL = """
            INSERT INTO learner_home_event (id, institute_id, block_key, item_key, event_type, user_id,
                                            layout_version, device, platform, created_at)
            VALUES (:id, :instituteId, :blockKey, :itemKey, :eventType, :userId,
                    :layoutVersion, :device, :platform, :createdAt)
            """;

    public static final String UPSERT_VIEWS_SQL = """
            INSERT INTO learner_home_view_daily (institute_id, day, block_key, item_key, device, views)
            VALUES (:instituteId, :day, :blockKey, :itemKey, :device, :views)
            ON CONFLICT (institute_id, day, block_key, item_key, device)
            DO UPDATE SET views = learner_home_view_daily.views + EXCLUDED.views
            """;

    public static final String VIEW_TOTALS_SQL = """
            SELECT v.block_key, v.item_key, v.device, SUM(v.views) AS views
            FROM learner_home_view_daily v
            WHERE v.institute_id = :instituteId AND v.day BETWEEN :fromDay AND :toDay
            GROUP BY v.block_key, v.item_key, v.device
            """;

    public static final String EVENT_TOTALS_SQL = """
            SELECT e.block_key, COALESCE(e.item_key, '') AS item_key, COALESCE(e.device, '') AS device,
                   e.event_type, COUNT(*) AS n
            FROM learner_home_event e
            WHERE e.institute_id = :instituteId AND e.created_at >= :fromTs AND e.created_at < :toTs
            GROUP BY e.block_key, COALESCE(e.item_key, ''), COALESCE(e.device, ''), e.event_type
            """;

    public static final String UNIQUE_CLICKERS_SQL = """
            SELECT e.block_key, COUNT(DISTINCT e.user_id) AS n
            FROM learner_home_event e
            WHERE e.institute_id = :instituteId AND e.event_type = 'CLICK'
              AND e.created_at >= :fromTs AND e.created_at < :toTs
            GROUP BY e.block_key
            """;

    public static final String ACK_COUNT_SQL = """
            SELECT COUNT(*) FROM learner_home_block_user_state
            WHERE institute_id = :instituteId AND block_key = :blockKey AND acknowledged_at IS NOT NULL
            """;

    public static final String ACK_PAGE_SQL = """
            SELECT user_id, acknowledged_at FROM learner_home_block_user_state
            WHERE institute_id = :instituteId AND block_key = :blockKey AND acknowledged_at IS NOT NULL
            ORDER BY acknowledged_at DESC, user_id
            LIMIT :lim OFFSET :off
            """;

    // Course names for result rows. The ids come from learner-sent item keys, so only courses of
    // this institute are named.
    public static final String PACKAGE_NAMES_SQL = """
            SELECT p.id, p.package_name FROM package p
            WHERE p.id IN (:ids)
              AND EXISTS (SELECT 1 FROM package_institute pi WHERE pi.package_id = p.id AND pi.institute_id = :instituteId)
            """;

    // The newest stored row of each block key (labels for the results tab).
    public static final String BLOCK_LABELS_SQL = """
            SELECT DISTINCT ON (b.block_key) b.block_key, b.type, b.builtin_widget, b.admin_label, b.config_json
            FROM learner_home_block b
            WHERE b.institute_id = :instituteId AND b.block_key IN (:keys)
            ORDER BY b.block_key, b.created_at DESC
            """;

    public static final String RETENTION_SQL = """
            DELETE FROM learner_home_event
            WHERE id IN (SELECT id FROM learner_home_event WHERE created_at < :cutoff LIMIT :batch)
            """;

    // ── Row types ───────────────────────────────────────────────────────────

    public record Enrolment(String packageSessionId, String packageId) {
    }

    public record BlockState(String blockKey, Instant dismissedAt, Instant acknowledgedAt) {
    }

    public record Owner(String id, String instituteId, String status, String name) {
    }

    public record LiveRow(String sessionId, String instituteId, String title, String timezone, String accessLevel,
                          String status, LocalDate meetingDate, LocalTime startTime, LocalTime lastEntryTime,
                          Double price) {
    }

    public record EventRow(String instituteId, String blockKey, String itemKey, String eventType, String userId,
                           Integer layoutVersion, String device, String platform, Instant createdAt) {
    }

    public record ViewRow(String instituteId, LocalDate day, String blockKey, String itemKey, String device,
                          long views) {
    }

    public record Total(String blockKey, String itemKey, String device, String eventType, long count) {
    }

    public record AckRow(String userId, Instant acknowledgedAt) {
    }

    private final NamedParameterJdbcTemplate jdbc;

    public LearnerHomeJdbc(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── Learner facts ───────────────────────────────────────────────────────

    public List<Enrolment> enrolments(String instituteId, String userId) {
        return jdbc.query(ENROLMENTS_SQL, userParams(instituteId, userId),
                (rs, i) -> new Enrolment(rs.getString("package_session_id"), rs.getString("package_id")));
    }

    public List<String> tagIds(String instituteId, String userId) {
        return jdbc.queryForList(TAGS_SQL, userParams(instituteId, userId), String.class);
    }

    public List<BlockState> states(String instituteId, String userId) {
        return jdbc.query(STATE_SQL, userParams(instituteId, userId), (rs, i) -> state(rs));
    }

    public BlockState state(String instituteId, String userId, String blockKey) {
        List<BlockState> rows = jdbc.query(STATE_ONE_SQL,
                userParams(instituteId, userId).addValue("blockKey", blockKey), (rs, i) -> state(rs));
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** True when this call set the dismissal (first time); false when it was already set. */
    public boolean dismiss(String instituteId, String userId, String blockKey) {
        return !jdbc.queryForList(DISMISS_SQL, userParams(instituteId, userId).addValue("blockKey", blockKey),
                String.class).isEmpty();
    }

    /** True when this call set the acknowledgement (first time); false when it was already set. */
    public boolean acknowledge(String instituteId, String userId, String blockKey) {
        return !jdbc.queryForList(ACK_SQL, userParams(instituteId, userId).addValue("blockKey", blockKey),
                String.class).isEmpty();
    }

    public List<Enrolment> batchPackages(String instituteId, Collection<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) return List.of();
        return jdbc.query(BATCH_PACKAGES_SQL,
                new MapSqlParameterSource("ids", packageSessionIds).addValue("instituteId", instituteId),
                (rs, i) -> new Enrolment(rs.getString("package_session_id"), rs.getString("package_id")));
    }

    // ── Ownership and link checks ───────────────────────────────────────────

    public List<Owner> batchOwners(Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return jdbc.query(BATCH_OWNERS_SQL, new MapSqlParameterSource("ids", ids),
                (rs, i) -> new Owner(rs.getString(1), rs.getString(2), null, null));
    }

    public List<Owner> packageOwners(Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return jdbc.query(PACKAGE_OWNERS_SQL, new MapSqlParameterSource("ids", ids),
                (rs, i) -> new Owner(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)));
    }

    public List<Owner> tagOwners(Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return jdbc.query(TAG_OWNERS_SQL, new MapSqlParameterSource("ids", ids),
                (rs, i) -> new Owner(rs.getString(1), rs.getString(2), rs.getString(3), null));
    }

    public List<Owner> productPages(Collection<String> codes) {
        if (codes == null || codes.isEmpty()) return List.of();
        return jdbc.query(PRODUCT_PAGES_SQL, new MapSqlParameterSource("codes", codes),
                (rs, i) -> new Owner(rs.getString(1), rs.getString(2), rs.getString(3), null));
    }

    public List<LiveRow> liveSessions(Collection<String> ids, LocalDate fromDate, LocalDate toDate) {
        if (ids == null || ids.isEmpty()) return List.of();
        MapSqlParameterSource p = new MapSqlParameterSource("ids", ids)
                .addValue("fromDate", Date.valueOf(fromDate))
                .addValue("toDate", Date.valueOf(toDate));
        return jdbc.query(LIVE_SESSIONS_SQL, p, (rs, i) -> liveRow(rs));
    }

    /** Rows of (session_id, batch id). */
    public List<String[]> sessionBatches(Collection<String> sessionIds) {
        if (sessionIds == null || sessionIds.isEmpty()) return List.of();
        return jdbc.query(SESSION_BATCHES_SQL, new MapSqlParameterSource("ids", sessionIds),
                (rs, i) -> new String[] {rs.getString(1), rs.getString(2)});
    }

    public List<String> recentPublishedKeys(String instituteId) {
        return jdbc.queryForList(RECENT_KEYS_SQL, new MapSqlParameterSource("instituteId", instituteId), String.class);
    }

    // ── Analytics writes ────────────────────────────────────────────────────

    public void insertEvents(List<EventRow> rows) {
        if (rows.isEmpty()) return;
        SqlParameterSource[] batch = new SqlParameterSource[rows.size()];
        for (int i = 0; i < rows.size(); i++) {
            EventRow r = rows.get(i);
            batch[i] = new MapSqlParameterSource()
                    .addValue("id", UUID.randomUUID().toString())
                    .addValue("instituteId", r.instituteId())
                    .addValue("blockKey", r.blockKey())
                    .addValue("itemKey", r.itemKey())
                    .addValue("eventType", r.eventType())
                    .addValue("userId", r.userId())
                    .addValue("layoutVersion", r.layoutVersion())
                    .addValue("device", r.device())
                    .addValue("platform", r.platform())
                    .addValue("createdAt", Timestamp.from(r.createdAt()));
        }
        jdbc.batchUpdate(INSERT_EVENT_SQL, batch);
    }

    public void upsertViews(List<ViewRow> rows) {
        if (rows.isEmpty()) return;
        SqlParameterSource[] batch = new SqlParameterSource[rows.size()];
        for (int i = 0; i < rows.size(); i++) {
            ViewRow r = rows.get(i);
            batch[i] = new MapSqlParameterSource()
                    .addValue("instituteId", r.instituteId())
                    .addValue("day", Date.valueOf(r.day()))
                    .addValue("blockKey", r.blockKey())
                    .addValue("itemKey", r.itemKey() == null ? "" : r.itemKey())
                    .addValue("device", r.device())
                    .addValue("views", r.views());
        }
        jdbc.batchUpdate(UPSERT_VIEWS_SQL, batch);
    }

    public int deleteEventsBefore(Instant cutoff, int batch) {
        return jdbc.update(RETENTION_SQL, new MapSqlParameterSource("cutoff", Timestamp.from(cutoff))
                .addValue("batch", batch));
    }

    // ── Analytics reads ─────────────────────────────────────────────────────

    public List<Total> viewTotals(String instituteId, LocalDate fromDay, LocalDate toDay) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId)
                .addValue("fromDay", Date.valueOf(fromDay))
                .addValue("toDay", Date.valueOf(toDay));
        return jdbc.query(VIEW_TOTALS_SQL, p, (rs, i) -> new Total(rs.getString("block_key"),
                rs.getString("item_key"), rs.getString("device"), "VIEW", rs.getLong("views")));
    }

    public List<Total> eventTotals(String instituteId, Instant from, Instant to) {
        return jdbc.query(EVENT_TOTALS_SQL, range(instituteId, from, to), (rs, i) -> new Total(
                rs.getString("block_key"), rs.getString("item_key"), rs.getString("device"),
                rs.getString("event_type"), rs.getLong("n")));
    }

    /** Rows of (block_key, distinct clickers). */
    public List<Total> uniqueClickers(String instituteId, Instant from, Instant to) {
        return jdbc.query(UNIQUE_CLICKERS_SQL, range(instituteId, from, to), (rs, i) -> new Total(
                rs.getString("block_key"), "", "", "CLICK", rs.getLong("n")));
    }

    public long ackCount(String instituteId, String blockKey) {
        Long n = jdbc.queryForObject(ACK_COUNT_SQL, new MapSqlParameterSource("instituteId", instituteId)
                .addValue("blockKey", blockKey), Long.class);
        return n == null ? 0 : n;
    }

    public List<AckRow> ackPage(String instituteId, String blockKey, int limit, int offset) {
        MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId)
                .addValue("blockKey", blockKey).addValue("lim", limit).addValue("off", offset);
        return jdbc.query(ACK_PAGE_SQL, p, (rs, i) -> new AckRow(rs.getString("user_id"),
                instant(rs.getTimestamp("acknowledged_at"))));
    }

    /** Rows of (block_key, type, builtin_widget, admin_label, config_json). */
    public List<String[]> blockLabels(String instituteId, Collection<String> keys) {
        if (keys == null || keys.isEmpty()) return List.of();
        return jdbc.query(BLOCK_LABELS_SQL, new MapSqlParameterSource("instituteId", instituteId).addValue("keys", keys),
                (rs, i) -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5)});
    }

    /** Rows of (package id, name). */
    public List<String[]> packageNames(String instituteId, Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return jdbc.query(PACKAGE_NAMES_SQL, new MapSqlParameterSource("ids", ids).addValue("instituteId", instituteId),
                (rs, i) -> new String[] {rs.getString(1), rs.getString(2)});
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static MapSqlParameterSource userParams(String instituteId, String userId) {
        return new MapSqlParameterSource("instituteId", instituteId).addValue("userId", userId);
    }

    private static MapSqlParameterSource range(String instituteId, Instant from, Instant to) {
        return new MapSqlParameterSource("instituteId", instituteId)
                .addValue("fromTs", Timestamp.from(from))
                .addValue("toTs", Timestamp.from(to));
    }

    private static BlockState state(ResultSet rs) throws SQLException {
        return new BlockState(rs.getString("block_key"), instant(rs.getTimestamp("dismissed_at")),
                instant(rs.getTimestamp("acknowledged_at")));
    }

    private static Instant instant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    private static LiveRow liveRow(ResultSet rs) throws SQLException {
        Date date = rs.getDate("meeting_date");
        Time start = rs.getTime("start_time");
        Time end = rs.getTime("last_entry_time");
        double price = rs.getDouble("actual_price");
        Double priceOrNull = rs.wasNull() ? null : price;
        return new LiveRow(rs.getString("session_id"), rs.getString("institute_id"), rs.getString("title"),
                rs.getString("timezone"), rs.getString("access_level"), rs.getString("status"),
                date == null ? null : date.toLocalDate(), start == null ? null : start.toLocalTime(),
                end == null ? null : end.toLocalTime(), priceOrNull);
    }

    /** Splits a long id list so a single statement never carries thousands of binds. */
    public static <T> List<List<T>> chunks(List<T> values, int size) {
        List<List<T>> out = new ArrayList<>();
        for (int i = 0; i < values.size(); i += size) {
            out.add(values.subList(i, Math.min(values.size(), i + size)));
        }
        return out;
    }
}
