package vacademy.io.auth_service.feature.panel.phase2.fleet;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;

/** Read-only SQL for fleet alerts. Every query is limited to one institute. */
@Repository
public class PanelFleetRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public PanelFleetRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * A live (CLAIMED or ACTIVE) panel with what the alerts need. lastSessionId and lastSessionAt are
     * the panel's most recent counted session: one the panel actually picked up (panel_seen_at set),
     * which leaves out sign-ins approved on a phone but never reached the panel.
     */
    public record FleetDevice(String id, String roomId, String roomName, Timestamp roomLicensedAt, String status,
            String approvalState, String appChannel, Integer appVersionCode, Integer webviewMajor, Integer sdkInt,
            Timestamp lastSeenAt, Timestamp claimedAt, Timestamp confirmedAt, String lastSessionId,
            Timestamp lastSessionAt, Timestamp dbNow) {
    }

    private static Integer intOrNull(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    public List<FleetDevice> listLiveDevices(String instituteId) {
        return jdbc.query("""
                SELECT d.id, d.room_id, r.name AS room_name, r.licensed_at AS room_licensed_at, d.status,
                       d.approval_state, d.app_channel, d.app_version_code, d.webview_major, d.sdk_int,
                       d.last_seen_at, d.claimed_at, d.confirmed_at, ls.id AS last_session_id,
                       ls.created_at AS last_session_at, localtimestamp AS db_now
                FROM public.panel_device d
                JOIN public.classroom_room r ON r.id = d.room_id
                LEFT JOIN LATERAL (
                    SELECT s.id, s.created_at
                    FROM public.panel_session s
                    WHERE s.device_id = d.id AND s.panel_seen_at IS NOT NULL
                    ORDER BY s.created_at DESC
                    LIMIT 1
                ) ls ON true
                WHERE d.institute_id = :inst AND d.status IN ('CLAIMED','ACTIVE')
                ORDER BY lower(r.name), d.id
                """, new MapSqlParameterSource("inst", instituteId),
                (rs, n) -> new FleetDevice(rs.getString("id"), rs.getString("room_id"), rs.getString("room_name"),
                        rs.getTimestamp("room_licensed_at"), rs.getString("status"), rs.getString("approval_state"),
                        rs.getString("app_channel"), intOrNull(rs, "app_version_code"),
                        intOrNull(rs, "webview_major"), intOrNull(rs, "sdk_int"), rs.getTimestamp("last_seen_at"),
                        rs.getTimestamp("claimed_at"), rs.getTimestamp("confirmed_at"),
                        rs.getString("last_session_id"), rs.getTimestamp("last_session_at"),
                        rs.getTimestamp("db_now")));
    }

    /** The database clock, for an institute with no live panel. */
    public Timestamp dbNow() {
        return jdbc.queryForObject("SELECT localtimestamp", new MapSqlParameterSource(), Timestamp.class);
    }
}
