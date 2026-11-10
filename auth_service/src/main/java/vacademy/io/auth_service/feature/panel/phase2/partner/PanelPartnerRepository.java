package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.sql.Types;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * SQL for installer organisations, their links to schools, the school-issued invite codes and the
 * installer columns of panel_device and classroom_room. The database clock is the only clock. Every
 * single-use rule (an invite redeemed once, a link revoked once, a panel approved once) is a
 * conditional UPDATE whose count the caller checks.
 */
@Repository
public class PanelPartnerRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public PanelPartnerRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static MapSqlParameterSource params() {
        return new MapSqlParameterSource();
    }

    private static <T> Optional<T> first(List<T> rows) {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    // ---------------------------------------------------------------- rows ---

    public record PartnerRow(String id, String name, String partnerInstituteId, String status, Timestamp createdAt) {
    }

    /** installUntilOpen: install_until is set and later than the database's now. */
    public record LinkRow(String id, String partnerId, String partnerName, String instituteId, String instituteName,
            String status, String linkedVia, Timestamp installUntil, boolean installUntilOpen, Timestamp createdAt,
            int installs) {
    }

    public record InviteRow(String id, String instituteId, String state, int installDays, Timestamp expiresAt) {
    }

    public record InstallRow(String deviceId, String roomId, String roomName, String status, String approvalState,
            Timestamp lastSeenAt, Integer appVersionCode, Integer webviewMajor, Timestamp dbNow) {
    }

    private static final RowMapper<PartnerRow> PARTNER = (rs, n) -> new PartnerRow(rs.getString("id"),
            rs.getString("name"), rs.getString("partner_institute_id"), rs.getString("status"),
            rs.getTimestamp("created_at"));

    private static final RowMapper<LinkRow> LINK = (rs, n) -> new LinkRow(rs.getString("id"),
            rs.getString("partner_id"), rs.getString("partner_name"), rs.getString("institute_id"),
            rs.getString("institute_name"), rs.getString("status"), rs.getString("linked_via"),
            rs.getTimestamp("install_until"), rs.getBoolean("install_open"), rs.getTimestamp("created_at"),
            rs.getInt("installs"));

    private static final RowMapper<InviteRow> INVITE = (rs, n) -> new InviteRow(rs.getString("id"),
            rs.getString("institute_id"), rs.getString("state"), rs.getInt("install_days"),
            rs.getTimestamp("expires_at"));

    // ------------------------------------------------------------ partners ---

    private static final String PARTNER_SELECT =
            "SELECT id, name, partner_institute_id, status, created_at FROM public.panel_partner ";

    public Optional<PartnerRow> findPartner(String id) {
        return first(jdbc.query(PARTNER_SELECT + "WHERE id = :id", params().addValue("id", id), PARTNER));
    }

    /** The oldest ACTIVE organisation among these institutes, so one installer always acts for the same one. */
    public Optional<PartnerRow> findActivePartnerOfInstitutes(Collection<String> instituteIds) {
        if (instituteIds.isEmpty()) {
            return Optional.empty();
        }
        return first(jdbc.query(PARTNER_SELECT + """
                WHERE partner_institute_id IN (:ids) AND status = 'ACTIVE' ORDER BY created_at, id LIMIT 1
                """, params().addValue("ids", instituteIds), PARTNER));
    }

    public List<PartnerRow> listPartners() {
        return jdbc.query(PARTNER_SELECT + "ORDER BY lower(name), id", params(), PARTNER);
    }

    /** Throws DuplicateKeyException when the institute is already an installer organisation. */
    public int insertPartner(String id, String name, String partnerInstituteId, String createdBy) {
        return jdbc.update("""
                INSERT INTO public.panel_partner (id, name, partner_institute_id, created_by)
                VALUES (:id, :name, :inst, :by)
                """, params().addValue("id", id).addValue("name", name).addValue("inst", partnerInstituteId)
                .addValue("by", createdBy));
    }

    public int setPartnerStatus(String id, String status) {
        return jdbc.update("UPDATE public.panel_partner SET status = :status WHERE id = :id",
                params().addValue("id", id).addValue("status", status));
    }

    // --------------------------------------------------------------- links ---

    private static final String LINK_SELECT = """
            SELECT l.id, l.partner_id, p.name AS partner_name, l.institute_id, l.institute_name, l.status,
                   l.linked_via, l.install_until, COALESCE(l.install_until > localtimestamp, false) AS install_open,
                   l.created_at,
                   (SELECT count(*) FROM public.panel_device d
                    WHERE d.installed_by_partner_id = l.partner_id AND d.institute_id = l.institute_id
                      AND d.status IN ('CLAIMED','ACTIVE'))::int AS installs
            FROM public.panel_partner_link l
            JOIN public.panel_partner p ON p.id = l.partner_id
            """;

    public Optional<LinkRow> findLink(String id) {
        return first(jdbc.query(LINK_SELECT + "WHERE l.id = :id", params().addValue("id", id), LINK));
    }

    public Optional<LinkRow> findActiveLink(String partnerId, String instituteId) {
        return first(jdbc.query(LINK_SELECT + """
                WHERE l.partner_id = :p AND l.institute_id = :inst AND l.status = 'ACTIVE'
                """, params().addValue("p", partnerId).addValue("inst", instituteId), LINK));
    }

    public List<LinkRow> listActiveLinksOfInstitute(String instituteId) {
        return jdbc.query(LINK_SELECT + """
                WHERE l.institute_id = :inst AND l.status = 'ACTIVE' ORDER BY l.created_at, l.id
                """, params().addValue("inst", instituteId), LINK);
    }

    public List<LinkRow> listActiveLinksOfPartner(String partnerId) {
        return jdbc.query(LINK_SELECT + """
                WHERE l.partner_id = :p AND l.status = 'ACTIVE' ORDER BY lower(COALESCE(l.institute_name, '')), l.id
                """, params().addValue("p", partnerId), LINK);
    }

    /** Zero when an ACTIVE link of this pair already exists (uq_ppl_active); the caller extends that one. */
    public int insertLink(String id, String partnerId, String instituteId, String linkedVia, Timestamp installUntil,
            Integer installDays, String createdBy) {
        return jdbc.update("""
                INSERT INTO public.panel_partner_link
                    (id, partner_id, institute_id, linked_via, install_until, created_by)
                VALUES (:id, :p, :inst, :via,
                        COALESCE(CAST(:until AS timestamp), now() + CAST(:days AS integer) * interval '1 day'), :by)
                ON CONFLICT DO NOTHING
                """, params().addValue("id", id).addValue("p", partnerId).addValue("inst", instituteId)
                .addValue("via", linkedVia).addValue("until", installUntil, Types.TIMESTAMP)
                .addValue("days", installDays, Types.INTEGER).addValue("by", createdBy));
    }

    /** A redeemed code never shortens an existing install window. */
    public int extendLinkByDays(String id, int installDays) {
        return jdbc.update("""
                UPDATE public.panel_partner_link
                SET install_until = GREATEST(COALESCE(install_until, now()), now() + :days * interval '1 day')
                WHERE id = :id AND status = 'ACTIVE'
                """, params().addValue("id", id).addValue("days", installDays));
    }

    /** Platform staff set the window exactly. */
    public int setLinkInstallUntil(String id, Timestamp installUntil) {
        return jdbc.update("""
                UPDATE public.panel_partner_link SET install_until = :until WHERE id = :id AND status = 'ACTIVE'
                """, params().addValue("id", id).addValue("until", installUntil, Types.TIMESTAMP));
    }

    public int revokeLink(String id, String by) {
        return jdbc.update("""
                UPDATE public.panel_partner_link SET status = 'REVOKED', revoked_by = :by, revoked_at = now()
                WHERE id = :id AND status = 'ACTIVE'
                """, params().addValue("id", id).addValue("by", by));
    }

    /** Only fills a missing name: a name already there is never overwritten by a late lookup. */
    public int fillLinkName(String id, String name) {
        return jdbc.update("""
                UPDATE public.panel_partner_link SET institute_name = :name WHERE id = :id AND institute_name IS NULL
                """, params().addValue("id", id).addValue("name", name));
    }

    // ------------------------------------------------------------- invites ---

    /** Zero on a code collision; the caller draws a new code. */
    public int insertInvite(String id, String instituteId, String codeHash, int installDays, int validDays,
            String createdBy) {
        return jdbc.update("""
                INSERT INTO public.panel_partner_invite (id, institute_id, code_hash, install_days, expires_at, created_by)
                VALUES (:id, :inst, :hash, :days, now() + :valid * interval '1 day', :by)
                ON CONFLICT DO NOTHING
                """, params().addValue("id", id).addValue("inst", instituteId).addValue("hash", codeHash)
                .addValue("days", installDays).addValue("valid", validDays).addValue("by", createdBy));
    }

    public Optional<InviteRow> findInvite(String id) {
        return first(jdbc.query("""
                SELECT id, institute_id, state, install_days, expires_at FROM public.panel_partner_invite WHERE id = :id
                """, params().addValue("id", id), INVITE));
    }

    /** Single use: only a PENDING, unexpired code is consumed, and only once. */
    public Optional<InviteRow> consumeInvite(String codeHash, String partnerId) {
        return first(jdbc.query("""
                UPDATE public.panel_partner_invite
                SET state = 'USED', used_by_partner_id = :p, used_at = now()
                WHERE code_hash = :hash AND state = 'PENDING' AND expires_at > now()
                RETURNING id, institute_id, state, install_days, expires_at
                """, params().addValue("hash", codeHash).addValue("p", partnerId), INVITE));
    }

    public int cancelInvite(String id) {
        return jdbc.update("""
                UPDATE public.panel_partner_invite SET state = 'CANCELLED' WHERE id = :id AND state = 'PENDING'
                """, params().addValue("id", id));
    }

    /** Every open code of the institute, whoever it was meant for. */
    public int cancelPendingInvitesOfInstitute(String instituteId) {
        return jdbc.update("""
                UPDATE public.panel_partner_invite SET state = 'CANCELLED'
                WHERE institute_id = :inst AND state = 'PENDING'
                """, params().addValue("inst", instituteId));
    }

    public record OpenInviteRow(String id, Timestamp createdAt, Timestamp expiresAt, int installDays,
            String createdBy) {
    }

    /** PENDING, unexpired codes of the institute, newest first. Never the code or its hash. */
    public List<OpenInviteRow> listOpenInvites(String instituteId, int limit) {
        return jdbc.query("""
                SELECT id, created_at, expires_at, install_days, created_by FROM public.panel_partner_invite
                WHERE institute_id = :inst AND state = 'PENDING' AND expires_at > now()
                ORDER BY created_at DESC, id LIMIT :limit
                """, params().addValue("inst", instituteId).addValue("limit", limit),
                (rs, n) -> new OpenInviteRow(rs.getString("id"), rs.getTimestamp("created_at"),
                        rs.getTimestamp("expires_at"), rs.getInt("install_days"), rs.getString("created_by")));
    }

    /** True when the school revoked this organisation's link after the code was created. */
    public boolean revokedSinceInvite(String partnerId, String instituteId, String inviteId) {
        Boolean revoked = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM public.panel_partner_link l
                    JOIN public.panel_partner_invite i ON i.id = :invite
                    WHERE l.partner_id = :p AND l.institute_id = :inst AND l.status = 'REVOKED'
                      AND l.revoked_at > i.created_at)
                """, params().addValue("p", partnerId).addValue("inst", instituteId).addValue("invite", inviteId),
                Boolean.class);
        return Boolean.TRUE.equals(revoked);
    }

    /** A consumed code that was then refused: no longer usable, and not recorded as used. */
    public int cancelConsumedInvite(String id) {
        return jdbc.update("""
                UPDATE public.panel_partner_invite SET state = 'CANCELLED', used_by_partner_id = NULL, used_at = NULL
                WHERE id = :id AND state = 'USED'
                """, params().addValue("id", id));
    }

    public int markExpiredInvites(int limit) {
        return jdbc.update("""
                UPDATE public.panel_partner_invite SET state = 'EXPIRED' WHERE id IN (
                    SELECT id FROM public.panel_partner_invite
                    WHERE state = 'PENDING' AND expires_at < now() LIMIT :limit)
                """, params().addValue("limit", limit));
    }

    public int purgeOldInvites(int keepDays, int limit) {
        return jdbc.update("""
                DELETE FROM public.panel_partner_invite WHERE id IN (
                    SELECT id FROM public.panel_partner_invite
                    WHERE expires_at < now() - :keep * interval '1 day' LIMIT :limit)
                """, params().addValue("keep", keepDays).addValue("limit", limit));
    }

    // ------------------------------------------------------ panels and rooms ---

    /** Inside the claim transaction, right after the device row was inserted as CLAIMED. */
    public int markInstalledBy(String deviceId, String partnerId) {
        return jdbc.update("""
                UPDATE public.panel_device SET approval_state = 'PENDING', installed_by_partner_id = :p
                WHERE id = :id AND status = 'CLAIMED'
                """, params().addValue("id", deviceId).addValue("p", partnerId));
    }

    /** Attribution is sticky: set at the room's first installer setup and changed only by platform staff. */
    public int attributeRoomIfUnset(String roomId, String partnerId) {
        return jdbc.update("UPDATE public.classroom_room SET partner_id = :p WHERE id = :id AND partner_id IS NULL",
                params().addValue("id", roomId).addValue("p", partnerId));
    }

    public int setRoomPartner(String roomId, String partnerId) {
        return jdbc.update("UPDATE public.classroom_room SET partner_id = :p WHERE id = :id",
                params().addValue("id", roomId).addValue("p", partnerId, Types.VARCHAR));
    }

    /** Zero unless the panel is live and waiting. */
    public int approveDevice(String deviceId, String by) {
        return jdbc.update("""
                UPDATE public.panel_device SET approval_state = 'APPROVED', approved_by = :by, approved_at = now()
                WHERE id = :id AND approval_state = 'PENDING' AND status IN ('CLAIMED','ACTIVE')
                """, params().addValue("id", deviceId).addValue("by", by));
    }

    public int markRejected(String deviceId, String by) {
        return jdbc.update("""
                UPDATE public.panel_device SET approval_state = 'REJECTED', approved_by = :by, approved_at = now()
                WHERE id = :id AND approval_state = 'PENDING'
                """, params().addValue("id", deviceId).addValue("by", by));
    }

    /** Health only, for panels this organisation set up in this institute. Bounded. */
    public List<InstallRow> listInstalls(String partnerId, String instituteId, int limit) {
        return jdbc.query("""
                SELECT d.id, d.room_id, r.name AS room_name, d.status, d.approval_state, d.last_seen_at,
                       d.app_version_code, d.webview_major, localtimestamp AS db_now
                FROM public.panel_device d
                JOIN public.classroom_room r ON r.id = d.room_id
                WHERE d.installed_by_partner_id = :p AND d.institute_id = :inst
                ORDER BY d.status, lower(r.name), d.id
                LIMIT :limit
                """, params().addValue("p", partnerId).addValue("inst", instituteId).addValue("limit", limit),
                (rs, n) -> {
                    int version = rs.getInt("app_version_code");
                    Integer appVersion = rs.wasNull() ? null : version;
                    int webview = rs.getInt("webview_major");
                    Integer webviewMajor = rs.wasNull() ? null : webview;
                    return new InstallRow(rs.getString("id"), rs.getString("room_id"), rs.getString("room_name"),
                            rs.getString("status"), rs.getString("approval_state"), rs.getTimestamp("last_seen_at"),
                            appVersion, webviewMajor, rs.getTimestamp("db_now"));
                });
    }
}
