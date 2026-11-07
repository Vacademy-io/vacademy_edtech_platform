package vacademy.io.assessment_service.features.open_evaluation.upload;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * {@code eval_api_upload} (V54): proof that a media file belongs to an institute (gate G12).
 * Every read is scoped by institute; another institute's upload is simply not found.
 */
@Repository
public class EvalApiUploadStore {

    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_READY = "ready";
    public static final String STATUS_REJECTED = "rejected";

    public record UploadRow(String id, String instituteId, String keyId, String fileId, String filename,
            String contentType, long sizeBytes, String sha256, Integer pages, String status, String rejectReason,
            String consumedBySubmissionId, Instant uploadExpiresAt, Instant validatedAt, Instant createdAt,
            Instant updatedAt) {

        public boolean isPending() {
            return STATUS_PENDING.equals(status);
        }

        public boolean isReady() {
            return STATUS_READY.equals(status);
        }

        public boolean isRejected() {
            return STATUS_REJECTED.equals(status);
        }

        public boolean isConsumed() {
            return consumedBySubmissionId != null;
        }

        /**
         * True when the last check may be stale: the presigned PUT was still usable when the
         * object was checked, so it could have been overwritten since.
         */
        public boolean needsRecheck() {
            if (validatedAt == null) {
                return true;
            }
            Instant expires = uploadExpiresAt != null ? uploadExpiresAt
                    : createdAt == null ? null : createdAt.plusSeconds(OpenUploadService.UPLOAD_URL_SECONDS);
            return expires == null || validatedAt.isBefore(expires);
        }
    }

    private static final String COLUMNS = "id, institute_id, key_id, file_id, filename, content_type, size_bytes, "
            + "sha256, pages, status, reject_reason, consumed_by_submission_id, upload_expires_at, validated_at, "
            + "created_at, updated_at";

    private static final RowMapper<UploadRow> ROW = EvalApiUploadStore::map;

    private final NamedParameterJdbcTemplate jdbc;

    @Autowired
    public EvalApiUploadStore(JdbcTemplate jdbcTemplate) {
        this.jdbc = new NamedParameterJdbcTemplate(jdbcTemplate);
    }

    EvalApiUploadStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String id, String instituteId, String keyId, String fileId, String filename,
            String contentType, long sizeBytes, String sha256, Instant uploadExpiresAt) {
        jdbc.update("""
                INSERT INTO eval_api_upload (id, institute_id, key_id, file_id, filename, content_type, size_bytes,
                                             sha256, status, upload_expires_at, created_at, updated_at)
                VALUES (:id, :inst, :key, :file, :name, :type, :size, :sha, 'pending', :expires, now(), now())
                """, new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("inst", instituteId)
                .addValue("key", keyId)
                .addValue("file", fileId)
                .addValue("name", filename)
                .addValue("type", contentType)
                .addValue("size", sizeBytes)
                .addValue("sha", sha256)
                .addValue("expires", uploadExpiresAt == null ? null : Timestamp.from(uploadExpiresAt)));
    }

    public Optional<UploadRow> find(String instituteId, String id) {
        return query(instituteId, id, false);
    }

    /** Locks the row for the rest of the transaction (submission accept). */
    public Optional<UploadRow> findForUpdate(String instituteId, String id) {
        return query(instituteId, id, true);
    }

    public List<UploadRow> findByIds(String instituteId, Collection<String> ids) {
        if (ids == null || ids.isEmpty() || instituteId == null) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLUMNS + " FROM eval_api_upload WHERE institute_id = :inst AND id IN (:ids)",
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("ids", ids), ROW);
    }

    /** Ready with its page count; only while not consumed (a consumed upload never changes). */
    public int markReady(String id, int pages, Long sizeBytes) {
        return jdbc.update("""
                UPDATE eval_api_upload SET status = 'ready', pages = :pages, reject_reason = NULL,
                       size_bytes = COALESCE(:size, size_bytes), validated_at = now(), updated_at = now()
                WHERE id = :id AND consumed_by_submission_id IS NULL
                """, new MapSqlParameterSource().addValue("id", id).addValue("pages", pages).addValue("size", sizeBytes));
    }

    public int markRejected(String id, String reason) {
        return jdbc.update("""
                UPDATE eval_api_upload SET status = 'rejected', reject_reason = :reason, validated_at = now(),
                       updated_at = now()
                WHERE id = :id AND consumed_by_submission_id IS NULL
                """, new MapSqlParameterSource().addValue("id", id).addValue("reason", reason));
    }

    /** Binds a ready upload to the submission that uses it; 0 = already used (or not ready). */
    public int consume(String id, String submissionId) {
        return jdbc.update("""
                UPDATE eval_api_upload SET consumed_by_submission_id = :sid, updated_at = now()
                WHERE id = :id AND consumed_by_submission_id IS NULL AND status = 'ready'
                """, new MapSqlParameterSource().addValue("id", id).addValue("sid", submissionId));
    }

    private Optional<UploadRow> query(String instituteId, String id, boolean lock) {
        if (instituteId == null || id == null) {
            return Optional.empty();
        }
        return jdbc.query("SELECT " + COLUMNS + " FROM eval_api_upload WHERE institute_id = :inst AND id = :id"
                        + (lock ? " FOR UPDATE" : ""),
                new MapSqlParameterSource().addValue("inst", instituteId).addValue("id", id), ROW).stream().findFirst();
    }

    private static UploadRow map(ResultSet rs, int i) throws SQLException {
        return new UploadRow(rs.getString("id"), rs.getString("institute_id"), rs.getString("key_id"),
                rs.getString("file_id"), rs.getString("filename"), rs.getString("content_type"),
                rs.getLong("size_bytes"), trim(rs.getString("sha256")), (Integer) rs.getObject("pages"),
                rs.getString("status"), rs.getString("reject_reason"), rs.getString("consumed_by_submission_id"),
                instant(rs, "upload_expires_at"), instant(rs, "validated_at"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static String trim(String s) {
        return s == null ? null : s.trim();
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }
}
