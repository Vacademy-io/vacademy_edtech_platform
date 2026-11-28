package vacademy.io.auth_service.feature.panel.repository;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.List;
import java.util.Optional;

/**
 * All SQL for the panel tables. The database clock is the only clock: every expiry is written and
 * compared with now() and every row read carries db_now, so two pods with drifting clocks cannot
 * disagree about a window. Every single-use rule is a conditional UPDATE whose count the caller checks.
 *
 * <p>One-active rules are partial unique indexes behind INSERT ... ON CONFLICT DO NOTHING. That form
 * does not wait for a competing transaction that has not committed: it reports zero rows at once. So
 * callers that must end the competing row and go on first take {@link #lockForTransaction}, which
 * does wait, and the zero is only a backstop.
 *
 * <p>JDBC rather than JPA entities: these rows change under concurrent conditional UPDATEs, so a
 * session-cached entity would be the wrong thing to read back. Outside a transaction each call takes
 * and returns its own connection; inside one it shares the transaction's connection.
 */
@Repository
public class PanelRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public PanelRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Serialises competing writers on one key until this transaction ends. Transaction-scoped, so it
     * is safe behind pgbouncer in transaction mode. Call only inside a transaction.
     */
    public void lockForTransaction(String key) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))", params().addValue("k", key), rs -> null);
    }

    // ---------------------------------------------------------------- rows ---

    public record PairingRow(String id, int matchCode, String matchOptions, String installId, String deviceInfo,
            String state, String deviceId, Timestamp pickedUpAt, Timestamp expiresAt, Timestamp dbNow) {
        public boolean unexpired() {
            return expiresAt.after(dbNow);
        }

        public long expiresInSeconds() {
            return secondsBetween(dbNow, expiresAt);
        }
    }

    public record RoomRow(String id, String instituteId, String name, String status, String deviceId) {
    }

    /**
     * The phase 2 columns follow db_now: approval_state (APPROVED, PENDING, REJECTED), the installer
     * organisation that set the panel up and its name, the reported app channel and confirmed_at.
     */
    public record DeviceRow(String id, String instituteId, String roomId, String roomName, String secretHash,
            String status, String instituteName, String themeCode, String approveBaseUrl, Timestamp brandingSyncedAt,
            boolean passwordLoginAllowed, String manufacturer, String model, Integer sdkInt, Integer webviewMajor,
            Integer appVersionCode, Timestamp lastSeenAt, String lastIp, String claimedByName, Timestamp claimedAt,
            Timestamp dbNow, String approvalState, String installedByPartnerId, String installedByName,
            String appChannel, Timestamp confirmedAt) {
        /** Phase 1 shape, for tests: an APPROVED device with no installer and no channel. */
        public DeviceRow(String id, String instituteId, String roomId, String roomName, String secretHash,
                String status, String instituteName, String themeCode, String approveBaseUrl,
                Timestamp brandingSyncedAt, boolean passwordLoginAllowed, String manufacturer, String model,
                Integer sdkInt, Integer webviewMajor, Integer appVersionCode, Timestamp lastSeenAt, String lastIp,
                String claimedByName, Timestamp claimedAt, Timestamp dbNow) {
            this(id, instituteId, roomId, roomName, secretHash, status, instituteName, themeCode, approveBaseUrl,
                    brandingSyncedAt, passwordLoginAllowed, manufacturer, model, sdkInt, webviewMajor, appVersionCode,
                    lastSeenAt, lastIp, claimedByName, claimedAt, dbNow, "APPROVED", null, null, null, null);
        }

        /** This row with the values a panel just reported; a null keeps the stored value, as the write does. */
        public DeviceRow withReported(Integer reportedVersionCode, Integer reportedWebviewMajor,
                String reportedChannel) {
            return new DeviceRow(id, instituteId, roomId, roomName, secretHash, status, instituteName, themeCode,
                    approveBaseUrl, brandingSyncedAt, passwordLoginAllowed, manufacturer, model, sdkInt,
                    reportedWebviewMajor != null ? reportedWebviewMajor : webviewMajor,
                    reportedVersionCode != null ? reportedVersionCode : appVersionCode, lastSeenAt, lastIp,
                    claimedByName, claimedAt, dbNow, approvalState, installedByPartnerId, installedByName,
                    reportedChannel != null ? reportedChannel : appChannel, confirmedAt);
        }
    }

    public record SessionRow(String id, String deviceId, String instituteId, String userId, String startedVia,
            String refreshHash, String status, Timestamp expiresAt, Timestamp createdAt, Timestamp lastRefreshedAt,
            String endReason, int remoteNavCounter, long remoteClientSeq, Timestamp remoteNavAt,
            Timestamp remoteSeenAt, Timestamp panelSeenAt, Integer stateIndex, Integer stateTotal, String stateTitle,
            Timestamp dbNow) {
        public boolean active() {
            return "ACTIVE".equals(status);
        }

        public boolean pastCap() {
            return !expiresAt.after(dbNow);
        }

        public long expiresInSeconds() {
            return secondsBetween(dbNow, expiresAt);
        }

        public long ageMs(Timestamp then) {
            return dbNow.getTime() - then.getTime();
        }
    }

    public record ChallengeRow(String id, String deviceId, String instituteId, String purpose, String sessionId,
            int matchCode, String matchOptions, String state, String scannedByName, String approvedUserId,
            Timestamp approvedAt, Timestamp redeemedAt, Timestamp expiresAt, Timestamp createdAt, Timestamp dbNow) {
        public long ageMs(Timestamp then) {
            return dbNow.getTime() - then.getTime();
        }

        public long expiresInSeconds() {
            return secondsBetween(dbNow, expiresAt);
        }
    }

    public record DeviceListRow(DeviceRow device, String sessionId, String sessionUserId, String sessionUserName,
            String sessionStartedVia, Timestamp sessionCreatedAt, Timestamp sessionExpiresAt, String approvedIp) {
    }

    private static long secondsBetween(Timestamp from, Timestamp to) {
        return Math.max(0, (to.getTime() - from.getTime()) / 1000);
    }

    private static Integer intOrNull(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static final RowMapper<PairingRow> PAIRING = (rs, n) -> new PairingRow(rs.getString("id"),
            rs.getInt("match_code"), rs.getString("match_options"), rs.getString("install_id"),
            rs.getString("device_info"), rs.getString("state"), rs.getString("device_id"),
            rs.getTimestamp("picked_up_at"), rs.getTimestamp("expires_at"), rs.getTimestamp("db_now"));

    private static final RowMapper<RoomRow> ROOM = (rs, n) -> new RoomRow(rs.getString("id"),
            rs.getString("institute_id"), rs.getString("name"), rs.getString("status"), rs.getString("device_id"));

    private static DeviceRow deviceRow(ResultSet rs) throws SQLException {
        return new DeviceRow(rs.getString("id"), rs.getString("institute_id"), rs.getString("room_id"),
                rs.getString("room_name"), rs.getString("secret_hash"), rs.getString("status"),
                rs.getString("institute_name"), rs.getString("theme_code"), rs.getString("approve_base_url"),
                rs.getTimestamp("branding_synced_at"), rs.getBoolean("password_login_allowed"),
                rs.getString("manufacturer"), rs.getString("model"), intOrNull(rs, "sdk_int"),
                intOrNull(rs, "webview_major"), intOrNull(rs, "app_version_code"), rs.getTimestamp("last_seen_at"),
                rs.getString("last_ip"), rs.getString("claimed_by_name"), rs.getTimestamp("claimed_at"),
                rs.getTimestamp("db_now"), rs.getString("approval_state"), rs.getString("installed_by_partner_id"),
                rs.getString("installed_by_name"), rs.getString("app_channel"), rs.getTimestamp("confirmed_at"));
    }

    private static final RowMapper<SessionRow> SESSION = (rs, n) -> new SessionRow(rs.getString("id"),
            rs.getString("device_id"), rs.getString("institute_id"), rs.getString("user_id"),
            rs.getString("started_via"), rs.getString("refresh_hash"), rs.getString("status"),
            rs.getTimestamp("expires_at"), rs.getTimestamp("created_at"), rs.getTimestamp("last_refreshed_at"),
            rs.getString("end_reason"), rs.getInt("remote_nav_counter"), rs.getLong("remote_client_seq"),
            rs.getTimestamp("remote_nav_at"), rs.getTimestamp("remote_seen_at"), rs.getTimestamp("panel_seen_at"),
            intOrNull(rs, "state_index"), intOrNull(rs, "state_total"), rs.getString("state_title"),
            rs.getTimestamp("db_now"));

    private static final RowMapper<ChallengeRow> CHALLENGE = (rs, n) -> new ChallengeRow(rs.getString("id"),
            rs.getString("device_id"), rs.getString("institute_id"), rs.getString("purpose"),
            rs.getString("session_id"), rs.getInt("match_code"), rs.getString("match_options"), rs.getString("state"),
            rs.getString("scanned_by_name"), rs.getString("approved_user_id"), rs.getTimestamp("approved_at"),
            rs.getTimestamp("redeemed_at"), rs.getTimestamp("expires_at"), rs.getTimestamp("created_at"),
            rs.getTimestamp("db_now"));

    private static MapSqlParameterSource params() {
        return new MapSqlParameterSource();
    }

    private static <T> Optional<T> first(List<T> rows) {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    // ------------------------------------------------------------- pairing ---

    private static final String PAIRING_SELECT = """
            SELECT id, match_code, match_options, install_id, device_info, state, device_id, picked_up_at, expires_at,
                   localtimestamp AS db_now
            FROM public.panel_pairing
            """;

    public int insertPairing(String id, String codeHash, String secretHash, int matchCode, String matchOptions,
            String installId, String deviceInfo, String createdIp, int ttlSeconds) {
        return jdbc.update("""
                INSERT INTO public.panel_pairing
                    (id, code_hash, secret_hash, match_code, match_options, install_id, device_info, created_ip, expires_at)
                VALUES (:id, :code, :secret, :match, :options, :install, :info, :ip, now() + :ttl * interval '1 second')
                ON CONFLICT DO NOTHING
                """, params().addValue("id", id).addValue("code", codeHash).addValue("secret", secretHash)
                .addValue("match", matchCode, Types.SMALLINT).addValue("options", matchOptions)
                .addValue("install", installId).addValue("info", deviceInfo).addValue("ip", createdIp)
                .addValue("ttl", ttlSeconds));
    }

    /** Unexpired PENDING rows only, through idx_panel_pairing_pending. Callers cache the result. */
    public long countLivePendingPairings() {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM public.panel_pairing WHERE state = 'PENDING' AND expires_at > now()",
                params(), Long.class);
        return count == null ? 0 : count;
    }

    public Optional<PairingRow> findPairingByCodeHash(String codeHash) {
        return first(jdbc.query(PAIRING_SELECT + "WHERE code_hash = :h", params().addValue("h", codeHash), PAIRING));
    }

    public Optional<PairingRow> findPairingBySecretHash(String secretHash) {
        return first(jdbc.query(PAIRING_SELECT + "WHERE secret_hash = :h", params().addValue("h", secretHash), PAIRING));
    }

    public int cancelPendingPairing(String codeHash) {
        return jdbc.update("""
                UPDATE public.panel_pairing SET state = 'CANCELLED'
                WHERE code_hash = :h AND state = 'PENDING'
                """, params().addValue("h", codeHash));
    }

    public int claimPairing(String codeHash, int matchCode, String deviceId) {
        return jdbc.update("""
                UPDATE public.panel_pairing SET state = 'CLAIMED', device_id = :device
                WHERE code_hash = :h AND state = 'PENDING' AND expires_at > now() AND match_code = :match
                """, params().addValue("h", codeHash).addValue("device", deviceId)
                .addValue("match", matchCode, Types.SMALLINT));
    }

    /** First pickup, or a retry inside the window. Zero means the window has closed. */
    public int markPairingPickedUp(String id, int windowSeconds) {
        return jdbc.update("""
                UPDATE public.panel_pairing SET picked_up_at = COALESCE(picked_up_at, now())
                WHERE id = :id AND state = 'CLAIMED'
                  AND (picked_up_at IS NULL OR picked_up_at > now() - :w * interval '1 second')
                """, params().addValue("id", id).addValue("w", windowSeconds));
    }

    public int cancelPairingOfDevice(String deviceId) {
        return jdbc.update("UPDATE public.panel_pairing SET state = 'CANCELLED' WHERE device_id = :d",
                params().addValue("d", deviceId));
    }

    public int purgeOldPairings(int limit) {
        return jdbc.update("""
                DELETE FROM public.panel_pairing WHERE id IN (
                    SELECT id FROM public.panel_pairing WHERE expires_at < now() - interval '1 hour' LIMIT :limit)
                """, params().addValue("limit", limit));
    }

    public int purgeOldChallenges(int limit) {
        return jdbc.update("""
                DELETE FROM public.panel_login_challenge WHERE id IN (
                    SELECT id FROM public.panel_login_challenge WHERE expires_at < now() - interval '1 day' LIMIT :limit)
                """, params().addValue("limit", limit));
    }

    // --------------------------------------------------------------- rooms ---

    private static final String ROOM_SELECT = """
            SELECT r.id, r.institute_id, r.name, r.status,
                   (SELECT d.id FROM public.panel_device d
                    WHERE d.room_id = r.id AND d.status IN ('CLAIMED','ACTIVE')) AS device_id
            FROM public.classroom_room r
            """;

    /** Zero means an active room of this institute already has the name. */
    public int insertRoom(String id, String instituteId, String name, String createdBy) {
        return jdbc.update("""
                INSERT INTO public.classroom_room (id, institute_id, name, created_by)
                VALUES (:id, :inst, :name, :by)
                ON CONFLICT DO NOTHING
                """, params().addValue("id", id).addValue("inst", instituteId).addValue("name", name)
                .addValue("by", createdBy));
    }

    public Optional<RoomRow> findRoom(String id) {
        return first(jdbc.query(ROOM_SELECT + "WHERE r.id = :id", params().addValue("id", id), ROOM));
    }

    public List<RoomRow> listRooms(String instituteId) {
        return jdbc.query(ROOM_SELECT + "WHERE r.institute_id = :inst ORDER BY lower(r.name)",
                params().addValue("inst", instituteId), ROOM);
    }

    /** Throws DuplicateKeyException when an active room of the institute already has the name. */
    public int renameRoom(String id, String name) {
        return jdbc.update("UPDATE public.classroom_room SET name = :name, updated_at = now() WHERE id = :id",
                params().addValue("id", id).addValue("name", name));
    }

    /** Archiving is refused by the count when the room has a live device. */
    public int setRoomStatus(String id, String status) {
        return jdbc.update("""
                UPDATE public.classroom_room SET status = :status, updated_at = now()
                WHERE id = :id
                  AND (:status <> 'ARCHIVED' OR NOT EXISTS (
                        SELECT 1 FROM public.panel_device d
                        WHERE d.room_id = :id AND d.status IN ('CLAIMED','ACTIVE')))
                """, params().addValue("id", id).addValue("status", status));
    }

    // ------------------------------------------------------------- devices ---

    private static final String DEVICE_COLUMNS = """
            d.id, d.institute_id, d.room_id, r.name AS room_name, d.secret_hash, d.status, d.institute_name,
            d.theme_code, d.approve_base_url, d.branding_synced_at, d.password_login_allowed, d.manufacturer,
            d.model, d.sdk_int, d.webview_major, d.app_version_code, d.last_seen_at, d.last_ip,
            d.claimed_by_name, d.claimed_at, localtimestamp AS db_now, d.approval_state,
            d.installed_by_partner_id, p.name AS installed_by_name, d.app_channel, d.confirmed_at
            """;

    /** The installer organisation's name, by primary key: no cost when the column is null. */
    private static final String DEVICE_JOINS = """
             FROM public.panel_device d
             JOIN public.classroom_room r ON r.id = d.room_id
             LEFT JOIN public.panel_partner p ON p.id = d.installed_by_partner_id
            """;

    private static final String DEVICE_SELECT = "SELECT " + DEVICE_COLUMNS + DEVICE_JOINS;

    public Optional<DeviceRow> findDevice(String id) {
        return first(jdbc.query(DEVICE_SELECT + "WHERE d.id = :id", params().addValue("id", id),
                (rs, n) -> deviceRow(rs)));
    }

    public Optional<DeviceRow> findLiveDeviceInRoom(String roomId) {
        return first(jdbc.query(DEVICE_SELECT + "WHERE d.room_id = :room AND d.status IN ('CLAIMED','ACTIVE')",
                params().addValue("room", roomId), (rs, n) -> deviceRow(rs)));
    }

    public record NewDevice(String id, String instituteId, String roomId, String placeholderSecretHash,
            String installId, String instituteName, String themeCode, String approveBaseUrl, String manufacturer,
            String model, Integer sdkInt, Integer webviewMajor, Integer appVersionCode, String claimedBy,
            String claimedByName) {
    }

    /** Zero means uq_panel_device_room: the room already has a live panel, possibly uncommitted. */
    public int insertDevice(NewDevice d) {
        return jdbc.update("""
                INSERT INTO public.panel_device
                    (id, institute_id, room_id, secret_hash, status, install_id, institute_name, theme_code,
                     approve_base_url, branding_synced_at, manufacturer, model, sdk_int, webview_major,
                     app_version_code, claimed_by, claimed_by_name)
                VALUES (:id, :inst, :room, :secret, 'CLAIMED', :install, :iname, :theme, :base, now(), :manu, :model,
                        :sdk, :webview, :version, :by, :byname)
                ON CONFLICT DO NOTHING
                """, params().addValue("id", d.id()).addValue("inst", d.instituteId()).addValue("room", d.roomId())
                .addValue("secret", d.placeholderSecretHash()).addValue("install", d.installId())
                .addValue("iname", d.instituteName()).addValue("theme", d.themeCode())
                .addValue("base", d.approveBaseUrl()).addValue("manu", d.manufacturer()).addValue("model", d.model())
                .addValue("sdk", d.sdkInt(), Types.INTEGER).addValue("webview", d.webviewMajor(), Types.INTEGER)
                .addValue("version", d.appVersionCode(), Types.INTEGER).addValue("by", d.claimedBy())
                .addValue("byname", d.claimedByName()));
    }

    /** Only before the panel confirms: a confirmed panel's secret can no longer be re-minted. */
    public int setClaimedDeviceSecret(String id, String secretHash) {
        return jdbc.update("UPDATE public.panel_device SET secret_hash = :h WHERE id = :id AND status = 'CLAIMED'",
                params().addValue("id", id).addValue("h", secretHash));
    }

    public int confirmDevice(String id) {
        return jdbc.update("""
                UPDATE public.panel_device SET status = 'ACTIVE', confirmed_at = now()
                WHERE id = :id AND status = 'CLAIMED'
                """, params().addValue("id", id));
    }

    public int revokeDevice(String id, String by) {
        return jdbc.update("""
                UPDATE public.panel_device SET status = 'REVOKED', revoked_at = now(), revoked_by = :by
                WHERE id = :id AND status IN ('CLAIMED','ACTIVE')
                """, params().addValue("id", id).addValue("by", by));
    }

    public int touchDeviceSeen(String id, String ip, Integer appVersion, Integer webview, int throttleSeconds) {
        return touchDeviceSeen(id, ip, appVersion, webview, null, throttleSeconds);
    }

    /** A null channel keeps the stored one: phase 1 panels never report it. */
    public int touchDeviceSeen(String id, String ip, Integer appVersion, Integer webview, String appChannel,
            int throttleSeconds) {
        return jdbc.update("""
                UPDATE public.panel_device
                SET last_seen_at = now(), last_ip = :ip,
                    app_version_code = COALESCE(:version, app_version_code),
                    webview_major = COALESCE(:webview, webview_major),
                    app_channel = COALESCE(:channel, app_channel)
                WHERE id = :id AND (last_seen_at IS NULL OR last_seen_at <= now() - :t * interval '1 second')
                """, params().addValue("id", id).addValue("ip", ip).addValue("version", appVersion, Types.INTEGER)
                .addValue("webview", webview, Types.INTEGER).addValue("channel", appChannel, Types.VARCHAR)
                .addValue("t", throttleSeconds));
    }

    public int updateDeviceVersions(String id, Integer appVersion, Integer webview) {
        return updateDeviceVersions(id, appVersion, webview, null);
    }

    public int updateDeviceVersions(String id, Integer appVersion, Integer webview, String appChannel) {
        return jdbc.update("""
                UPDATE public.panel_device
                SET app_version_code = COALESCE(:version, app_version_code),
                    webview_major = COALESCE(:webview, webview_major),
                    app_channel = COALESCE(:channel, app_channel)
                WHERE id = :id
                """, params().addValue("id", id).addValue("version", appVersion, Types.INTEGER)
                .addValue("webview", webview, Types.INTEGER).addValue("channel", appChannel, Types.VARCHAR));
    }

    public int updateBranding(String id, PanelInstituteDirectory.Snapshot snapshot) {
        return jdbc.update("""
                UPDATE public.panel_device
                SET institute_name = :name, theme_code = :theme, approve_base_url = :base, branding_synced_at = now()
                WHERE id = :id
                """, params().addValue("id", id).addValue("name", snapshot.instituteName())
                .addValue("theme", snapshot.themeCode()).addValue("base", snapshot.approveBaseUrl()));
    }

    /** Throws DuplicateKeyException when the target room already has a live panel. */
    public int moveDevice(String id, String roomId) {
        return jdbc.update("UPDATE public.panel_device SET room_id = :room WHERE id = :id",
                params().addValue("id", id).addValue("room", roomId));
    }

    public int moveActiveSessionsOfDevice(String deviceId, String roomId) {
        return jdbc.update("""
                UPDATE public.panel_session SET room_id = :room WHERE device_id = :d AND status = 'ACTIVE'
                """, params().addValue("d", deviceId).addValue("room", roomId));
    }

    public int setPasswordLoginAllowed(String id, boolean allowed) {
        return jdbc.update("UPDATE public.panel_device SET password_login_allowed = :a WHERE id = :id",
                params().addValue("id", id).addValue("a", allowed));
    }

    /**
     * Panels of an institute with the session each one holds. A session past its cap reads as no
     * session. Names come from auth's own users table, so this makes no HTTP call.
     */
    public List<DeviceListRow> listDevices(String instituteId, String onlyDeviceId) {
        String sql = "SELECT " + DEVICE_COLUMNS + """
                , s.id AS s_id, s.user_id AS s_user_id, u.full_name AS s_user_name, s.started_via AS s_via,
                  s.created_at AS s_created_at, s.expires_at AS s_expires_at,
                  (SELECT c.approved_ip FROM public.panel_login_challenge c
                   WHERE c.session_id = s.id ORDER BY c.approved_at DESC NULLS LAST LIMIT 1) AS s_approved_ip
                FROM public.panel_device d
                JOIN public.classroom_room r ON r.id = d.room_id
                LEFT JOIN public.panel_partner p ON p.id = d.installed_by_partner_id
                LEFT JOIN public.panel_session s
                       ON s.device_id = d.id AND s.status = 'ACTIVE' AND s.expires_at > now()
                LEFT JOIN public.users u ON u.id = s.user_id
                WHERE d.institute_id = :inst
                """ + (onlyDeviceId == null ? "" : " AND d.id = :only ") + """
                 ORDER BY d.status, lower(r.name)
                """;
        return jdbc.query(sql, params().addValue("inst", instituteId).addValue("only", onlyDeviceId),
                (rs, n) -> new DeviceListRow(deviceRow(rs), rs.getString("s_id"), rs.getString("s_user_id"),
                        rs.getString("s_user_name"), rs.getString("s_via"), rs.getTimestamp("s_created_at"),
                        rs.getTimestamp("s_expires_at"), rs.getString("s_approved_ip")));
    }

    // ------------------------------------------------------------ sessions ---

    private static final String SESSION_SELECT = """
            SELECT id, device_id, institute_id, user_id, started_via, refresh_hash, status, expires_at, created_at,
                   last_refreshed_at, end_reason, remote_nav_counter, remote_client_seq, remote_nav_at,
                   remote_seen_at, panel_seen_at, state_index, state_total, state_title, localtimestamp AS db_now
            FROM public.panel_session
            """;

    public Optional<SessionRow> findSession(String id) {
        return first(jdbc.query(SESSION_SELECT + "WHERE id = :id", params().addValue("id", id), SESSION));
    }

    public Optional<SessionRow> findSessionByRefreshHash(String hash) {
        return first(jdbc.query(SESSION_SELECT + "WHERE refresh_hash = :h", params().addValue("h", hash), SESSION));
    }

    public Optional<SessionRow> findSessionByRemoteHash(String hash) {
        return first(jdbc.query(SESSION_SELECT + "WHERE remote_token_hash = :h", params().addValue("h", hash), SESSION));
    }

    public Optional<SessionRow> findActiveSessionOfUser(String userId) {
        return first(jdbc.query(SESSION_SELECT + "WHERE user_id = :u AND status = 'ACTIVE'",
                params().addValue("u", userId), SESSION));
    }

    public Optional<SessionRow> findActiveSessionOfDevice(String deviceId) {
        return first(jdbc.query(SESSION_SELECT + "WHERE device_id = :d AND status = 'ACTIVE'",
                params().addValue("d", deviceId), SESSION));
    }

    /** Zero means a partial unique index still has a competing row. */
    public int insertSession(String id, String deviceId, String instituteId, String roomId, String userId,
            String startedVia, String refreshHash, String remoteHash, int sessionHours) {
        return jdbc.update("""
                INSERT INTO public.panel_session
                    (id, device_id, institute_id, room_id, user_id, started_via, refresh_hash, remote_token_hash, expires_at)
                VALUES (:id, :device, :inst, :room, :user, :via, :refresh, :remote, now() + :h * interval '1 hour')
                ON CONFLICT DO NOTHING
                """, params().addValue("id", id).addValue("device", deviceId).addValue("inst", instituteId)
                .addValue("room", roomId).addValue("user", userId).addValue("via", startedVia)
                .addValue("refresh", refreshHash).addValue("remote", remoteHash).addValue("h", sessionHours));
    }

    public int endSession(String id, String reason, String by) {
        return jdbc.update("""
                UPDATE public.panel_session SET status = 'ENDED', ended_at = now(), end_reason = :reason, ended_by = :by
                WHERE id = :id AND status = 'ACTIVE'
                """, params().addValue("id", id).addValue("reason", reason).addValue("by", by));
    }

    /**
     * endSession that also records active_until, the effective end of an IDLE sign-out: the panel
     * waited idle_seconds with no input before it signed out, so the usage report stops counting
     * there. Never earlier than created_at.
     */
    public int endSessionWithActiveUntil(String id, String reason, String by, int idleSeconds) {
        return jdbc.update("""
                UPDATE public.panel_session
                SET status = 'ENDED', ended_at = now(), end_reason = :reason, ended_by = :by,
                    active_until = GREATEST(created_at, now() - :idle * interval '1 second')
                WHERE id = :id AND status = 'ACTIVE'
                """, params().addValue("id", id).addValue("reason", reason).addValue("by", by)
                .addValue("idle", idleSeconds));
    }

    public int endActiveSessionOfDevice(String deviceId, String reason, String by) {
        return jdbc.update("""
                UPDATE public.panel_session SET status = 'ENDED', ended_at = now(), end_reason = :reason, ended_by = :by
                WHERE device_id = :d AND status = 'ACTIVE'
                """, params().addValue("d", deviceId).addValue("reason", reason).addValue("by", by));
    }

    public int endActiveSessionOfUser(String userId, String reason) {
        return jdbc.update("""
                UPDATE public.panel_session SET status = 'ENDED', ended_at = now(), end_reason = :reason
                WHERE user_id = :u AND status = 'ACTIVE'
                """, params().addValue("u", userId).addValue("reason", reason));
    }

    /** Ends a session the panel never picked up, so a late pickup cannot revive it. */
    public int endUnredeemedSession(String id, String reason) {
        return jdbc.update("""
                UPDATE public.panel_session SET status = 'ENDED', ended_at = now(), end_reason = :reason
                WHERE id = :id AND status = 'ACTIVE' AND refresh_hash IS NULL
                """, params().addValue("id", id).addValue("reason", reason));
    }

    /**
     * Mints the panel's session token. Zero means the session has ended or passed its cap. The panel
     * is polling at this moment, so it is also marked seen, and the phone shows it online at once.
     */
    public int setSessionToken(String id, String refreshHash) {
        return jdbc.update("""
                UPDATE public.panel_session SET refresh_hash = :h, last_refreshed_at = now(), panel_seen_at = now()
                WHERE id = :id AND status = 'ACTIVE' AND expires_at > now()
                """, params().addValue("id", id).addValue("h", refreshHash));
    }

    public int markRefreshed(String id) {
        return jdbc.update("""
                UPDATE public.panel_session SET last_refreshed_at = now()
                WHERE id = :id AND status = 'ACTIVE' AND expires_at > now()
                """, params().addValue("id", id));
    }

    /** Attach or repeat approve: a new phone token, and the new phone's own client_seq starts over. */
    public int setRemoteToken(String id, String remoteHash) {
        return jdbc.update("""
                UPDATE public.panel_session SET remote_token_hash = :h, remote_client_seq = 0
                WHERE id = :id AND status = 'ACTIVE' AND expires_at > now()
                """, params().addValue("id", id).addValue("h", remoteHash));
    }

    public int remoteNav(String remoteHash, int delta, long clientSeq) {
        return jdbc.update("""
                UPDATE public.panel_session
                SET remote_nav_counter = remote_nav_counter + :delta, remote_client_seq = :seq, remote_nav_at = now()
                WHERE remote_token_hash = :h AND status = 'ACTIVE' AND expires_at > now() AND remote_client_seq < :seq
                """, params().addValue("h", remoteHash).addValue("delta", delta).addValue("seq", clientSeq));
    }

    public int touchRemoteSeen(String id, int throttleSeconds) {
        return jdbc.update("""
                UPDATE public.panel_session SET remote_seen_at = now()
                WHERE id = :id AND status = 'ACTIVE'
                  AND (remote_seen_at IS NULL OR remote_seen_at <= now() - :t * interval '1 second')
                """, params().addValue("id", id).addValue("t", throttleSeconds));
    }

    /** What /sync may write. Null state columns are the "presenting ended" clear. */
    public int writeSessionSync(String id, boolean touchPanelSeen, boolean writeState, Integer index, Integer total,
            String title) {
        StringBuilder set = new StringBuilder();
        if (touchPanelSeen) {
            set.append("panel_seen_at = now()");
        }
        if (writeState) {
            if (set.length() > 0) {
                set.append(", ");
            }
            set.append("state_index = :i, state_total = :t, state_title = :x, state_updated_at = now()");
        }
        return jdbc.update("UPDATE public.panel_session SET " + set + " WHERE id = :id AND status = 'ACTIVE'",
                params().addValue("id", id).addValue("i", index, Types.INTEGER).addValue("t", total, Types.INTEGER)
                        .addValue("x", title, Types.VARCHAR));
    }

    // ---------------------------------------------------------- challenges ---

    private static final String CHALLENGE_SELECT = """
            SELECT id, device_id, institute_id, purpose, session_id, match_code, match_options, state,
                   scanned_by_name, approved_user_id, approved_at, redeemed_at, expires_at, created_at,
                   localtimestamp AS db_now
            FROM public.panel_login_challenge
            """;

    public Optional<ChallengeRow> findChallenge(String id) {
        return first(jdbc.query(CHALLENGE_SELECT + "WHERE id = :id", params().addValue("id", id), CHALLENGE));
    }

    public Optional<ChallengeRow> findChallengeByTokenHash(String hash) {
        return first(jdbc.query(CHALLENGE_SELECT + "WHERE token_hash = :h", params().addValue("h", hash), CHALLENGE));
    }

    public Optional<ChallengeRow> findChallengeByUserCodeHash(String hash) {
        return first(jdbc.query(CHALLENGE_SELECT + "WHERE user_code_hash = :h", params().addValue("h", hash), CHALLENGE));
    }

    public Optional<ChallengeRow> findApprovedChallengeOfDevice(String deviceId) {
        return first(jdbc.query(CHALLENGE_SELECT + "WHERE device_id = :d AND state = 'APPROVED'",
                params().addValue("d", deviceId), CHALLENGE));
    }

    /** Zero means the device's one open challenge slot is still taken, or a hash collided. */
    public int insertChallenge(String id, String deviceId, String instituteId, String purpose, String sessionId,
            String tokenHash, String userCodeHash, int matchCode, String matchOptions, int ttlSeconds) {
        return jdbc.update("""
                INSERT INTO public.panel_login_challenge
                    (id, device_id, institute_id, purpose, session_id, token_hash, user_code_hash, match_code,
                     match_options, expires_at)
                VALUES (:id, :device, :inst, :purpose, :session, :token, :code, :match, :options,
                        now() + :ttl * interval '1 second')
                ON CONFLICT DO NOTHING
                """, params().addValue("id", id).addValue("device", deviceId).addValue("inst", instituteId)
                .addValue("purpose", purpose).addValue("session", sessionId).addValue("token", tokenHash)
                .addValue("code", userCodeHash).addValue("match", matchCode, Types.SMALLINT)
                .addValue("options", matchOptions).addValue("ttl", ttlSeconds));
    }

    public int killPendingOrScannedOfDevice(String deviceId) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge SET state = 'DEAD'
                WHERE device_id = :d AND state IN ('PENDING','SCANNED')
                """, params().addValue("d", deviceId));
    }

    public int killOpenOfDevice(String deviceId) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge SET state = 'DEAD'
                WHERE device_id = :d AND state IN ('PENDING','SCANNED','APPROVED')
                """, params().addValue("d", deviceId));
    }

    public int killChallenge(String id) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge SET state = 'DEAD'
                WHERE id = :id AND state IN ('PENDING','SCANNED')
                """, params().addValue("id", id));
    }

    /** Past its redeem window. Only then does an APPROVED challenge leave the device's open slot. */
    public int expireApproved(String id, int redeemWindowSeconds) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge SET state = 'EXPIRED'
                WHERE id = :id AND state = 'APPROVED' AND approved_at <= now() - :w * interval '1 second'
                """, params().addValue("id", id).addValue("w", redeemWindowSeconds));
    }

    /** The scan raises the expiry to at least now + floor, never past created_at + ceiling. */
    public int markScanned(String id, String scannedByName, int floorSeconds, int ceilingSeconds) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge
                SET state = 'SCANNED', scanned_by_name = :name,
                    expires_at = GREATEST(expires_at,
                                          LEAST(now() + :floor * interval '1 second',
                                                created_at + :ceiling * interval '1 second'))
                WHERE id = :id AND state IN ('PENDING','SCANNED') AND expires_at > now()
                """, params().addValue("id", id).addValue("name", scannedByName).addValue("floor", floorSeconds)
                .addValue("ceiling", ceilingSeconds));
    }

    /**
     * The single-use step of approve. Zero means someone else moved it first, it expired, or the panel
     * is no longer ACTIVE. SIGN_IN goes to APPROVED; ATTACH_REMOTE has no redeem step, so REDEEMED.
     */
    public int approveChallenge(String id, String newState, String userId, String ip) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge c
                SET state = :state, approved_user_id = :user, approved_ip = :ip, approved_at = now(),
                    redeemed_at = CASE WHEN :state = 'REDEEMED' THEN now() ELSE NULL END
                WHERE c.id = :id AND c.state IN ('PENDING','SCANNED') AND c.expires_at > now()
                  AND EXISTS (SELECT 1 FROM public.panel_device d WHERE d.id = c.device_id AND d.status = 'ACTIVE')
                """, params().addValue("id", id).addValue("state", newState).addValue("user", userId)
                .addValue("ip", ip));
    }

    public int setChallengeSession(String id, String sessionId) {
        return jdbc.update("UPDATE public.panel_login_challenge SET session_id = :session WHERE id = :id",
                params().addValue("id", id).addValue("session", sessionId));
    }

    public int redeemChallenge(String id, int redeemWindowSeconds) {
        return jdbc.update("""
                UPDATE public.panel_login_challenge SET state = 'REDEEMED', redeemed_at = now()
                WHERE id = :id AND state = 'APPROVED' AND approved_at > now() - :w * interval '1 second'
                """, params().addValue("id", id).addValue("w", redeemWindowSeconds));
    }
}
