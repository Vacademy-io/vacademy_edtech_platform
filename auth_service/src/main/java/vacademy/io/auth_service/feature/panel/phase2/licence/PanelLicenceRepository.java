package vacademy.io.auth_service.feature.panel.phase2.licence;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.sql.Types;
import java.util.List;
import java.util.Optional;

/**
 * SQL for room seats: the enforcement setting, grants, the auto-trial template, seat history and the
 * seat columns of classroom_room. Like PanelRepository, the database clock is the only clock: rows
 * carry db_now and writes use now(). Seat writes are conditional UPDATEs; callers hold the
 * institute's seat lock (PanelRepository.lockForTransaction) around them.
 */
@Repository
public class PanelLicenceRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public PanelLicenceRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static MapSqlParameterSource params() {
        return new MapSqlParameterSource();
    }

    private static <T> Optional<T> first(List<T> rows) {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    // ---------------------------------------------------------------- rows ---

    public record GrantRow(String id, String instituteId, String kind, int seats, Timestamp startsAt,
            Timestamp endsAt, int graceDays, String status, String partnerId, String externalRef, String note,
            String createdBy, Timestamp createdAt, String cancelledBy, Timestamp cancelledAt) {
    }

    /** An ACTIVE room with its seat, attribution and live panel (CLAIMED or ACTIVE), if any. */
    public record RoomSeatRow(String id, String instituteId, String name, String status, Timestamp licensedAt,
            String partnerId, String deviceId) {
    }

    public record TemplateRow(String key, String kind, int seats, int days, int graceDays, boolean active,
            String updatedBy, Timestamp updatedAt) {
    }

    public record EventRow(String instituteId, String roomId, String action, String partnerId, Timestamp at) {
    }

    private static final RowMapper<GrantRow> GRANT = (rs, n) -> new GrantRow(rs.getString("id"),
            rs.getString("institute_id"), rs.getString("kind"), rs.getInt("seats"), rs.getTimestamp("starts_at"),
            rs.getTimestamp("ends_at"), rs.getInt("grace_days"), rs.getString("status"), rs.getString("partner_id"),
            rs.getString("external_ref"), rs.getString("note"), rs.getString("created_by"),
            rs.getTimestamp("created_at"), rs.getString("cancelled_by"), rs.getTimestamp("cancelled_at"));

    private static final RowMapper<RoomSeatRow> ROOM_SEAT = (rs, n) -> new RoomSeatRow(rs.getString("id"),
            rs.getString("institute_id"), rs.getString("name"), rs.getString("status"),
            rs.getTimestamp("licensed_at"), rs.getString("partner_id"), rs.getString("device_id"));

    private static final RowMapper<TemplateRow> TEMPLATE = (rs, n) -> new TemplateRow(rs.getString("key"),
            rs.getString("kind"), rs.getInt("seats"), rs.getInt("days"), rs.getInt("grace_days"),
            rs.getBoolean("active"), rs.getString("updated_by"), rs.getTimestamp("updated_at"));

    public Timestamp dbNow() {
        return jdbc.queryForObject("SELECT localtimestamp", params(), Timestamp.class);
    }

    // ---------------------------------------------------------- enforcement ---

    public Optional<String> findEnforcement(String instituteId) {
        return first(jdbc.queryForList(
                "SELECT enforcement FROM public.panel_licence_setting WHERE institute_id = :inst",
                params().addValue("inst", instituteId), String.class));
    }

    public int upsertEnforcement(String instituteId, String enforcement, String by) {
        return jdbc.update("""
                INSERT INTO public.panel_licence_setting (institute_id, enforcement, updated_by, updated_at)
                VALUES (:inst, :enf, :by, now())
                ON CONFLICT (institute_id) DO UPDATE
                    SET enforcement = EXCLUDED.enforcement, updated_by = EXCLUDED.updated_by, updated_at = now()
                """, params().addValue("inst", instituteId).addValue("enf", enforcement).addValue("by", by));
    }

    // --------------------------------------------------------------- grants ---

    private static final String GRANT_SELECT = """
            SELECT id, institute_id, kind, seats, starts_at, ends_at, grace_days, status, partner_id, external_ref,
                   note, created_by, created_at, cancelled_by, cancelled_at
            FROM public.panel_licence_grant
            """;

    /** Every grant of the institute, cancelled ones included, oldest first. */
    public List<GrantRow> listGrants(String instituteId) {
        return jdbc.query(GRANT_SELECT + "WHERE institute_id = :inst ORDER BY starts_at, id",
                params().addValue("inst", instituteId), GRANT);
    }

    public Optional<GrantRow> findGrant(String id) {
        return first(jdbc.query(GRANT_SELECT + "WHERE id = :id", params().addValue("id", id), GRANT));
    }

    /** Grants of any status that have already started. A grant that starts later is not counted. */
    public int countStartedGrants(String instituteId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM public.panel_licence_grant WHERE institute_id = :inst AND starts_at <= now()",
                params().addValue("inst", instituteId), Integer.class);
        return count == null ? 0 : count;
    }

    public int insertGrant(String id, String instituteId, String kind, int seats, Timestamp startsAt,
            Timestamp endsAt, int graceDays, String partnerId, String externalRef, String note, String createdBy) {
        return jdbc.update("""
                INSERT INTO public.panel_licence_grant
                    (id, institute_id, kind, seats, starts_at, ends_at, grace_days, partner_id, external_ref, note,
                     created_by)
                VALUES (:id, :inst, :kind, :seats, :starts, :ends, :grace, :partner, :ref, :note, :by)
                """, params().addValue("id", id).addValue("inst", instituteId).addValue("kind", kind)
                .addValue("seats", seats).addValue("starts", startsAt, Types.TIMESTAMP)
                .addValue("ends", endsAt, Types.TIMESTAMP).addValue("grace", graceDays)
                .addValue("partner", partnerId, Types.VARCHAR).addValue("ref", externalRef, Types.VARCHAR)
                .addValue("note", note, Types.VARCHAR).addValue("by", createdBy));
    }

    /** A grant from the template, starting at the database's now. */
    public int insertGrantFromTemplate(String id, String instituteId, TemplateRow template, String createdBy) {
        return jdbc.update("""
                INSERT INTO public.panel_licence_grant
                    (id, institute_id, kind, seats, starts_at, ends_at, grace_days, created_by)
                VALUES (:id, :inst, :kind, :seats, now(), now() + :days * interval '1 day', :grace, :by)
                """, params().addValue("id", id).addValue("inst", instituteId).addValue("kind", template.kind())
                .addValue("seats", template.seats()).addValue("days", template.days())
                .addValue("grace", template.graceDays()).addValue("by", createdBy));
    }

    /** Zero when the grant is already cancelled. A null note keeps the existing one. */
    public int cancelGrant(String id, String by, String note) {
        return jdbc.update("""
                UPDATE public.panel_licence_grant
                SET status = 'CANCELLED', cancelled_by = :by, cancelled_at = now(), note = COALESCE(:note, note)
                WHERE id = :id AND status = 'ACTIVE'
                """, params().addValue("id", id).addValue("by", by).addValue("note", note, Types.VARCHAR));
    }

    public boolean partnerExists(String partnerId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM public.panel_partner WHERE id = :id",
                params().addValue("id", partnerId), Integer.class);
        return count != null && count > 0;
    }

    // ---------------------------------------------------------------- rooms ---

    private static final String ROOM_SEAT_SELECT = """
            SELECT r.id, r.institute_id, r.name, r.status, r.licensed_at, r.partner_id,
                   (SELECT d.id FROM public.panel_device d
                    WHERE d.room_id = r.id AND d.status IN ('CLAIMED','ACTIVE')) AS device_id
            FROM public.classroom_room r
            """;

    /** The institute's ACTIVE rooms, by name. Archived rooms hold no seat. */
    public List<RoomSeatRow> listRoomSeats(String instituteId) {
        return jdbc.query(ROOM_SEAT_SELECT + "WHERE r.institute_id = :inst AND r.status = 'ACTIVE' ORDER BY lower(r.name)",
                params().addValue("inst", instituteId), ROOM_SEAT);
    }

    public Optional<RoomSeatRow> findRoomSeat(String roomId) {
        return first(jdbc.query(ROOM_SEAT_SELECT + "WHERE r.id = :id", params().addValue("id", roomId), ROOM_SEAT));
    }

    /** Zero when the room already holds a seat or is not ACTIVE. */
    public int assignSeat(String roomId, String by) {
        return jdbc.update("""
                UPDATE public.classroom_room SET licensed_at = now(), licensed_by = :by
                WHERE id = :id AND licensed_at IS NULL AND status = 'ACTIVE'
                """, params().addValue("id", roomId).addValue("by", by, Types.VARCHAR));
    }

    /** Zero when the room holds no seat. */
    public int releaseSeat(String roomId) {
        return jdbc.update("""
                UPDATE public.classroom_room SET licensed_at = NULL, licensed_by = NULL
                WHERE id = :id AND licensed_at IS NOT NULL
                """, params().addValue("id", roomId));
    }

    /** Seat history, with the room's attribution at this moment. */
    public int insertEvent(String instituteId, String roomId, String action, String reason, String actor) {
        return jdbc.update("""
                INSERT INTO public.panel_licence_event (institute_id, room_id, action, reason, partner_id, actor)
                SELECT :inst, :room, :action, :reason, r.partner_id, :actor
                FROM public.classroom_room r WHERE r.id = :room
                """, params().addValue("inst", instituteId).addValue("room", roomId).addValue("action", action)
                .addValue("reason", reason).addValue("actor", actor, Types.VARCHAR));
    }

    // ------------------------------------------------------------ templates ---

    public Optional<TemplateRow> findTemplate(String key) {
        return first(jdbc.query("""
                SELECT key, kind, seats, days, grace_days, active, updated_by, updated_at
                FROM public.panel_licence_template WHERE key = :key
                """, params().addValue("key", key), TEMPLATE));
    }

    public int upsertTemplate(String key, String kind, int seats, int days, int graceDays, boolean active,
            String by) {
        return jdbc.update("""
                INSERT INTO public.panel_licence_template (key, kind, seats, days, grace_days, active, updated_by)
                VALUES (:key, :kind, :seats, :days, :grace, :active, :by)
                ON CONFLICT (key) DO UPDATE
                    SET kind = EXCLUDED.kind, seats = EXCLUDED.seats, days = EXCLUDED.days,
                        grace_days = EXCLUDED.grace_days, active = EXCLUDED.active,
                        updated_by = EXCLUDED.updated_by, updated_at = now()
                """, params().addValue("key", key).addValue("kind", kind).addValue("seats", seats)
                .addValue("days", days).addValue("grace", graceDays).addValue("active", active)
                .addValue("by", by));
    }

    // ---------------------------------------------------------------- usage ---

    /**
     * Institutes that matter for a month: a grant overlapping it, or seat history before its end.
     * Bounded, because the caller computes each one in memory.
     */
    public List<String> institutesForMonth(Timestamp from, Timestamp to, int limit) {
        return jdbc.queryForList("""
                SELECT institute_id FROM (
                    SELECT institute_id FROM public.panel_licence_grant WHERE starts_at < :to AND ends_at > :from
                    UNION
                    SELECT institute_id FROM public.panel_licence_event WHERE at < :to
                ) i ORDER BY institute_id LIMIT :limit
                """, params().addValue("from", from, Types.TIMESTAMP).addValue("to", to, Types.TIMESTAMP)
                .addValue("limit", limit), String.class);
    }

    /** Seat history up to the end of the window, in order. */
    public List<EventRow> eventsBefore(String instituteId, Timestamp to) {
        return jdbc.query("""
                SELECT institute_id, room_id, action, partner_id, at FROM public.panel_licence_event
                WHERE institute_id = :inst AND at < :to ORDER BY at, id
                """, params().addValue("inst", instituteId).addValue("to", to, Types.TIMESTAMP),
                (rs, n) -> new EventRow(rs.getString("institute_id"), rs.getString("room_id"),
                        rs.getString("action"), rs.getString("partner_id"), rs.getTimestamp("at")));
    }

    /**
     * Rooms with at least one counted session in the window. A counted session is a panel_session
     * with panel_seen_at set, which leaves out sign-ins that were approved but never reached the panel.
     */
    public List<String> roomsWithCountedSessions(String instituteId, Timestamp from, Timestamp to) {
        return jdbc.queryForList("""
                SELECT DISTINCT room_id FROM public.panel_session
                WHERE institute_id = :inst AND created_at >= :from AND created_at < :to
                  AND panel_seen_at IS NOT NULL
                """, params().addValue("inst", instituteId).addValue("from", from, Types.TIMESTAMP)
                .addValue("to", to, Types.TIMESTAMP), String.class);
    }
}
