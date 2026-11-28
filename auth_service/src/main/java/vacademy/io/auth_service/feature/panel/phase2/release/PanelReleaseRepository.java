package vacademy.io.auth_service.feature.panel.phase2.release;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.sql.Types;
import java.util.List;
import java.util.Optional;

/**
 * SQL for panel_app_release. A status or rollout change is a conditional UPDATE on the status the
 * caller read, so two staff members stepping the same release cannot both win.
 */
@Repository
public class PanelReleaseRepository {

    /** The newest rows first; the registry is small, so the list is capped rather than paged. */
    public static final int LIST_CAP = 200;

    private final NamedParameterJdbcTemplate jdbc;

    public PanelReleaseRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ReleaseRow(String id, String channel, int versionCode, String versionName, String apkUrl,
            String sha256, Long sizeBytes, int minSdk, int rolloutPercent, boolean required, String status,
            String notes, String createdBy, Timestamp createdAt, Timestamp publishedAt, Timestamp dbNow) {
        public boolean live() {
            return "LIVE".equals(status);
        }
    }

    public record NewRelease(String id, String channel, int versionCode, String versionName, String apkUrl,
            String sha256, Long sizeBytes, int minSdk, int rolloutPercent, boolean required, String notes,
            String createdBy) {
    }

    private static final String SELECT = """
            SELECT id, channel, version_code, version_name, apk_url, sha256, size_bytes, min_sdk, rollout_percent,
                   required, status, notes, created_by, created_at, published_at, localtimestamp AS db_now
            FROM public.panel_app_release
            """;

    private static final RowMapper<ReleaseRow> ROW = (rs, n) -> {
        long size = rs.getLong("size_bytes");
        Long sizeBytes = rs.wasNull() ? null : size;
        return new ReleaseRow(rs.getString("id"), rs.getString("channel"), rs.getInt("version_code"),
                rs.getString("version_name"), rs.getString("apk_url"), rs.getString("sha256"), sizeBytes,
                rs.getInt("min_sdk"), rs.getInt("rollout_percent"), rs.getBoolean("required"), rs.getString("status"),
                rs.getString("notes"), rs.getString("created_by"), rs.getTimestamp("created_at"),
                rs.getTimestamp("published_at"), rs.getTimestamp("db_now"));
    };

    private static MapSqlParameterSource params() {
        return new MapSqlParameterSource();
    }

    /** Zero means uq_par_channel_code: that channel already has this version code. Always DRAFT. */
    public int insert(NewRelease r) {
        return jdbc.update("""
                INSERT INTO public.panel_app_release
                    (id, channel, version_code, version_name, apk_url, sha256, size_bytes, min_sdk, rollout_percent,
                     required, status, notes, created_by)
                VALUES (:id, :channel, :code, :name, :url, :sha, :size, :sdk, :rollout, :required, 'DRAFT', :notes, :by)
                ON CONFLICT DO NOTHING
                """, params().addValue("id", r.id()).addValue("channel", r.channel()).addValue("code", r.versionCode())
                .addValue("name", r.versionName()).addValue("url", r.apkUrl(), Types.VARCHAR)
                .addValue("sha", r.sha256(), Types.VARCHAR).addValue("size", r.sizeBytes(), Types.BIGINT)
                .addValue("sdk", r.minSdk()).addValue("rollout", r.rolloutPercent())
                .addValue("required", r.required()).addValue("notes", r.notes(), Types.VARCHAR)
                .addValue("by", r.createdBy()));
    }

    public Optional<ReleaseRow> findById(String id) {
        List<ReleaseRow> rows = jdbc.query(SELECT + " WHERE id = :id", params().addValue("id", id), ROW);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<ReleaseRow> list() {
        return jdbc.query(SELECT + " ORDER BY created_at DESC, version_code DESC LIMIT " + LIST_CAP, params(), ROW);
    }

    /** Every LIVE row of every channel, highest version first. */
    public List<ReleaseRow> listLive() {
        return jdbc.query(SELECT + " WHERE status = 'LIVE' ORDER BY channel, version_code DESC", params(), ROW);
    }

    /**
     * ACTIVE, APPROVED DIRECT panels (no channel counts as DIRECT) below versionCode that could not be
     * offered a build with this min_sdk: SDK unknown or too low, or an app older than the first build
     * with the updater. Panels that never reported a version are not counted (no floor applies).
     */
    public int countPanelsBelowWithoutUpdate(int versionCode, int minSdk, int firstUpdaterVersionCode) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM public.panel_device
                WHERE status = 'ACTIVE' AND approval_state = 'APPROVED'
                  AND COALESCE(NULLIF(app_channel, ''), 'DIRECT') = 'DIRECT'
                  AND app_version_code IS NOT NULL AND app_version_code < :code
                  AND (sdk_int IS NULL OR sdk_int < :sdk OR app_version_code < :updater)
                """, params().addValue("code", versionCode).addValue("sdk", minSdk)
                .addValue("updater", firstUpdaterVersionCode), Integer.class);
        return count == null ? 0 : count;
    }

    /**
     * Applies a change only while the row still has the status the caller read. published_at is set
     * the first time the row goes LIVE and kept after that.
     */
    public int update(String id, String expectedStatus, String status, int rolloutPercent, boolean required) {
        return jdbc.update("""
                UPDATE public.panel_app_release
                SET status = :status, rollout_percent = :rollout, required = :required,
                    published_at = CASE WHEN CAST(:status AS varchar) = 'LIVE' THEN COALESCE(published_at, now()) ELSE published_at END
                WHERE id = :id AND status = :expected
                """, params().addValue("id", id).addValue("expected", expectedStatus).addValue("status", status)
                .addValue("rollout", rolloutPercent).addValue("required", required));
    }
}
