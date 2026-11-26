package vacademy.io.admin_core_service.features.certificate.dao;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateDashboardDto;
import vacademy.io.admin_core_service.features.certificate.dto.CourseCertificateLearnerDto;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Reads the joined view behind the course Certificates tab: every enrolled
 * learner in one batch, their completion percentage, and their certificate state.
 *
 * <p>That join does not exist anywhere else in the codebase — the three legs were
 * only ever queried separately. Written with a plain {@link EntityManager} to
 * match {@code EngagementReadDao}, and shaped after
 * {@code ActivityLogRepository.getBatchActivityDataWithRankPaginated}: a
 * {@code valid_users} CTE narrowing to the batch, then LEFT JOINs so learners with
 * no progress row and no certificate still appear.
 */
@Repository
@RequiredArgsConstructor
public class CourseCertificateDao {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * `learner_operation.value` is TEXT, so every cast is guarded by a numeric
     * regex — non-numeric junk would otherwise abort the whole query.
     *
     * <p>The leading space matters: a text block strips trailing white space from
     * every line, so the "AND" this is concatenated onto would otherwise fuse
     * into "ANDlo.value" and break the SQL.
     */
    private static final String NUMERIC_GUARD = " lo.value ~ '^-?\\d+(\\.\\d+)?$'";

    private static final String BASE_FROM = """
            FROM student_session_institute_group_mapping ssigm
            LEFT JOIN student s
                   ON s.user_id = ssigm.user_id
            LEFT JOIN learner_operation lo
                   ON lo.user_id  = ssigm.user_id
                  AND lo.source   = 'PACKAGE_SESSION'
                  AND lo.source_id = ssigm.package_session_id
                  AND lo.operation = 'PERCENTAGE_PACKAGE_SESSION_COMPLETED'
                  AND """ + NUMERIC_GUARD + """

            LEFT JOIN LATERAL (
                SELECT ic.certificate_id, ic.file_id, ic.issued_at
                FROM issued_certificate ic
                WHERE ic.user_id = ssigm.user_id
                  AND ic.package_session_id = ssigm.package_session_id
                ORDER BY ic.issued_at DESC
                LIMIT 1
            ) cert ON TRUE
            WHERE ssigm.package_session_id = :packageSessionId
              AND ssigm.institute_id       = :instituteId
              AND ssigm.status IN ('ACTIVE', 'INVITED')
            """;

    /**
     * Counts for the dashboard cards.
     *
     * <p>"Near threshold" is the band the spec asked for — within 10 points below
     * the bar (70-79 when the threshold is 80). "Awaiting" is the group that
     * matters operationally: past the threshold but with no certificate yet.
     */
    public CourseCertificateDashboardDto dashboard(String packageSessionId, String instituteId, int thresholdPercent) {
        String sql = """
                SELECT
                    COUNT(*)                                                                      AS enrolled,
                    COUNT(cert.certificate_id)                                                    AS generated,
                    COUNT(*) FILTER (WHERE cert.certificate_id IS NULL)                           AS pending,
                    COUNT(*) FILTER (WHERE cert.certificate_id IS NULL
                                       AND COALESCE(CAST(lo.value AS DOUBLE PRECISION), 0) >= :threshold)
                                                                                                  AS awaiting,
                    COUNT(*) FILTER (WHERE COALESCE(CAST(lo.value AS DOUBLE PRECISION), 0) <  :threshold
                                       AND COALESCE(CAST(lo.value AS DOUBLE PRECISION), 0) >= :nearFloor)
                                                                                                  AS nearThreshold
                """ + BASE_FROM;

        Query query = entityManager.createNativeQuery(sql)
                .setParameter("packageSessionId", packageSessionId)
                .setParameter("instituteId", instituteId)
                .setParameter("threshold", (double) thresholdPercent)
                .setParameter("nearFloor", (double) Math.max(0, thresholdPercent - 10));

        Object[] row = (Object[]) query.getSingleResult();
        return CourseCertificateDashboardDto.builder()
                .totalEnrolled(toLong(row[0]))
                .certificatesGenerated(toLong(row[1]))
                .certificatesPending(toLong(row[2]))
                .completedAwaitingCertificate(toLong(row[3]))
                .nearThreshold(toLong(row[4]))
                .thresholdPercent(thresholdPercent)
                .build();
    }

    /** One page of the learner table, newest certificates first then by name. */
    public List<CourseCertificateLearnerDto> learners(String packageSessionId, String instituteId,
                                                      String search, String status,
                                                      int thresholdPercent, int page, int size) {
        StringBuilder sql = new StringBuilder("""
                SELECT ssigm.user_id,
                       s.full_name,
                       s.email,
                       CAST(lo.value AS DOUBLE PRECISION) AS completion_percentage,
                       cert.certificate_id,
                       cert.file_id,
                       cert.issued_at
                """).append(BASE_FROM);

        appendFilters(sql, search, status);
        sql.append(" ORDER BY cert.issued_at DESC NULLS LAST, s.full_name ASC NULLS LAST, ssigm.user_id ASC");
        sql.append(" LIMIT :limit OFFSET :offset");

        Query query = entityManager.createNativeQuery(sql.toString())
                .setParameter("packageSessionId", packageSessionId)
                .setParameter("instituteId", instituteId)
                .setParameter("limit", size)
                .setParameter("offset", (long) page * size);
        bindFilters(query, search, status, thresholdPercent);

        List<?> rows = query.getResultList();
        List<CourseCertificateLearnerDto> out = new ArrayList<>(rows.size());
        for (Object r : rows) {
            Object[] row = (Object[]) r;
            Double percentage = row[3] != null ? ((Number) row[3]).doubleValue() : null;
            String certificateNumber = (String) row[4];
            out.add(CourseCertificateLearnerDto.builder()
                    .userId((String) row[0])
                    .fullName((String) row[1])
                    .email((String) row[2])
                    .completionPercentage(percentage)
                    .certificateNumber(certificateNumber)
                    .fileId((String) row[5])
                    .issuedAt((Date) row[6])
                    .status(deriveStatus(certificateNumber, percentage, thresholdPercent))
                    .build());
        }
        return out;
    }

    /**
     * Every learner row in the batch matching the search, in the same order as
     * {@link #learners}, with no status filter and no paging. For a test-score rule,
     * whose AWAITING/PENDING split cannot be expressed in SQL: the service judges each
     * learner in Java and then filters and pages. Status is left null for the caller.
     */
    public List<CourseCertificateLearnerDto> learnersUnpaged(String packageSessionId, String instituteId,
                                                             String search) {
        StringBuilder sql = new StringBuilder("""
                SELECT ssigm.user_id,
                       s.full_name,
                       s.email,
                       CAST(lo.value AS DOUBLE PRECISION) AS completion_percentage,
                       cert.certificate_id,
                       cert.file_id,
                       cert.issued_at
                """).append(BASE_FROM);
        appendFilters(sql, search, null);
        sql.append(" ORDER BY cert.issued_at DESC NULLS LAST, s.full_name ASC NULLS LAST, ssigm.user_id ASC");

        Query query = entityManager.createNativeQuery(sql.toString())
                .setParameter("packageSessionId", packageSessionId)
                .setParameter("instituteId", instituteId);
        bindFilters(query, search, null, 0);

        List<?> rows = query.getResultList();
        List<CourseCertificateLearnerDto> out = new ArrayList<>(rows.size());
        for (Object r : rows) {
            Object[] row = (Object[]) r;
            out.add(CourseCertificateLearnerDto.builder()
                    .userId((String) row[0])
                    .fullName((String) row[1])
                    .email((String) row[2])
                    .completionPercentage(row[3] != null ? ((Number) row[3]).doubleValue() : null)
                    .certificateNumber((String) row[4])
                    .fileId((String) row[5])
                    .issuedAt((Date) row[6])
                    .build());
        }
        return out;
    }

    public long countLearners(String packageSessionId, String instituteId, String search, String status,
                              int thresholdPercent) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) ").append(BASE_FROM);
        appendFilters(sql, search, status);

        Query query = entityManager.createNativeQuery(sql.toString())
                .setParameter("packageSessionId", packageSessionId)
                .setParameter("instituteId", instituteId);
        bindFilters(query, search, status, thresholdPercent);
        return toLong(query.getSingleResult());
    }

    private void appendFilters(StringBuilder sql, String search, String status) {
        if (StringUtils.hasText(search)) {
            sql.append(" AND (LOWER(s.full_name) LIKE LOWER(:search) OR LOWER(s.email) LIKE LOWER(:search)")
               .append(" OR LOWER(cert.certificate_id) LIKE LOWER(:search))");
        }
        if (StringUtils.hasText(status)) {
            switch (status.toUpperCase()) {
                case "GENERATED" -> sql.append(" AND cert.certificate_id IS NOT NULL");
                case "AWAITING" -> sql.append(" AND cert.certificate_id IS NULL")
                        .append(" AND COALESCE(CAST(lo.value AS DOUBLE PRECISION), 0) >= :threshold");
                case "PENDING" -> sql.append(" AND cert.certificate_id IS NULL")
                        .append(" AND COALESCE(CAST(lo.value AS DOUBLE PRECISION), 0) < :threshold");
                default -> { /* unknown filter value: no narrowing, show everything */ }
            }
        }
    }

    /**
     * Only bind what {@link #appendFilters} actually emitted — a native query
     * rejects a parameter that does not appear in its SQL.
     */
    private void bindFilters(Query query, String search, String status, int thresholdPercent) {
        if (StringUtils.hasText(search)) {
            query.setParameter("search", "%" + search.trim() + "%");
        }
        if (usesThreshold(status)) {
            query.setParameter("threshold", (double) thresholdPercent);
        }
    }

    private boolean usesThreshold(String status) {
        if (!StringUtils.hasText(status)) return false;
        String normalized = status.toUpperCase();
        return "AWAITING".equals(normalized) || "PENDING".equals(normalized);
    }

    private String deriveStatus(String certificateNumber, Double percentage, int thresholdPercent) {
        if (StringUtils.hasText(certificateNumber)) return "GENERATED";
        double pct = percentage != null ? percentage : 0d;
        return pct >= thresholdPercent ? "AWAITING" : "PENDING";
    }

    private long toLong(Object value) {
        if (value == null) return 0L;
        if (value instanceof BigDecimal bd) return bd.longValue();
        if (value instanceof Number n) return n.longValue();
        return 0L;
    }
}
