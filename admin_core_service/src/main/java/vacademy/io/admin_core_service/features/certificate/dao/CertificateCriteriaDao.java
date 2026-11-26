package vacademy.io.admin_core_service.features.certificate.dao;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateTestOptionDto;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Course-structure reads behind certificate criteria: which quiz and assessment
 * slides a course (or one batch of it) contains, and where each one sits.
 *
 * <p>Slides reach a batch through {@code chapter_package_session_mapping}, the same
 * path the Quiz Results tab uses, so a test counts for a batch exactly when that
 * batch's learners can see it. A slide placed in several chapters collapses to its
 * first placement.
 *
 * <p>No SQL comments in the strings below on purpose: a quote or a colon inside one
 * breaks native-query parameter parsing.
 */
@Repository
public class CertificateCriteriaDao {

    @PersistenceContext
    private EntityManager entityManager;

    private static final String TESTS_SQL = """
            SELECT t.slide_id, t.title, t.source_type, t.slide_status,
                   t.subject_id, t.subject_name, t.module_id, t.module_name,
                   t.chapter_id, t.chapter_name, t.pass_percentage, t.assessment_id
            FROM (
                SELECT DISTINCT ON (s.id)
                       s.id               AS slide_id,
                       s.title            AS title,
                       s.source_type      AS source_type,
                       s.status           AS slide_status,
                       subj.id            AS subject_id,
                       subj.subject_name  AS subject_name,
                       md.id              AS module_id,
                       md.module_name     AS module_name,
                       smm.module_order   AS module_order,
                       ch.id              AS chapter_id,
                       ch.chapter_name    AS chapter_name,
                       cpsm.chapter_order AS chapter_order,
                       cts.slide_order    AS slide_order,
                       CAST(qz.pass_percentage AS DOUBLE PRECISION) AS pass_percentage,
                       asl.assessment_id  AS assessment_id
                FROM slide s
                    JOIN chapter_to_slides cts
                        ON cts.slide_id = s.id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping cpsm
                        ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
                       AND cpsm.package_session_id IN (:packageSessionIds)
                    JOIN chapter ch ON ch.id = cts.chapter_id
                    LEFT JOIN quiz_slide qz
                        ON s.source_type = 'QUIZ' AND qz.id = s.source_id
                    LEFT JOIN assessment_slide asl
                        ON s.source_type = 'ASSESSMENT' AND asl.id = s.source_id
                    LEFT JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id
                    LEFT JOIN modules md ON md.id = mcm.module_id
                    LEFT JOIN subject_module_mapping smm ON smm.module_id = md.id
                    LEFT JOIN subject subj ON subj.id = smm.subject_id
                WHERE s.source_type IN ('QUIZ', 'ASSESSMENT')
                  AND COALESCE(s.status, '') <> 'DELETED'
                ORDER BY s.id, cts.created_at NULLS LAST
            ) t
            ORDER BY t.subject_name NULLS LAST, t.module_order NULLS LAST, t.module_name NULLS LAST,
                     t.chapter_order NULLS LAST, t.chapter_name NULLS LAST,
                     t.slide_order NULLS LAST, t.title
            """;

    /**
     * Every quiz and assessment slide in these batches, in course order, drafts
     * included. Callers that judge learners drop the drafts themselves.
     */
    public List<CertificateTestOptionDto> findTests(List<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return List.of();
        }
        List<?> rows = entityManager.createNativeQuery(TESTS_SQL)
                .setParameter("packageSessionIds", packageSessionIds)
                .getResultList();
        List<CertificateTestOptionDto> out = new ArrayList<>(rows.size());
        for (Object r : rows) {
            Object[] row = (Object[]) r;
            out.add(CertificateTestOptionDto.builder()
                    .slideId((String) row[0])
                    .title((String) row[1])
                    .type((String) row[2])
                    .status((String) row[3])
                    .subjectId((String) row[4])
                    .subjectName((String) row[5])
                    .moduleId((String) row[6])
                    .moduleName((String) row[7])
                    .chapterId((String) row[8])
                    .chapterName((String) row[9])
                    .ownPassPercent(row[10] != null ? ((Number) row[10]).doubleValue() : null)
                    .assessmentId((String) row[11])
                    .build());
        }
        return out;
    }

    /**
     * One learner's stored course progress in a batch, the same rollup the issue gate
     * reads; null when there is none yet. Non-numeric junk in the TEXT column reads as
     * null rather than failing the query.
     */
    public Double findCompletionPercentage(String userId, String packageSessionId) {
        List<?> rows = entityManager.createNativeQuery("""
                        SELECT CAST(lo.value AS DOUBLE PRECISION)
                        FROM learner_operation lo
                        WHERE lo.user_id = :userId
                          AND lo.source = 'PACKAGE_SESSION'
                          AND lo.source_id = :packageSessionId
                          AND lo.operation = 'PERCENTAGE_PACKAGE_SESSION_COMPLETED'
                          AND lo.value ~ '^-?[0-9]+([.][0-9]+)?$'
                        LIMIT 1
                        """)
                .setParameter("userId", userId)
                .setParameter("packageSessionId", packageSessionId)
                .getResultList();
        return rows.isEmpty() || rows.get(0) == null ? null : ((Number) rows.get(0)).doubleValue();
    }

    /** The course a batch belongs to; null when the batch is unknown. */
    public String findPackageId(String packageSessionId) {
        List<?> rows = entityManager.createNativeQuery(
                        "SELECT ps.package_id FROM package_session ps WHERE ps.id = :packageSessionId")
                .setParameter("packageSessionId", packageSessionId)
                .getResultList();
        return rows.isEmpty() ? null : (String) rows.get(0);
    }

    /** What a copied item was copied from, for remapping a certificate rule onto a duplicated course. */
    public enum CopyKind { SLIDE, CHAPTER, MODULE }

    private static final String SLIDE_COPIES_SQL = """
            SELECT DISTINCT s.parent_id, s.id
            FROM slide s
                JOIN chapter_to_slides cts ON cts.slide_id = s.id AND cts.status <> 'DELETED'
                JOIN chapter_package_session_mapping cpsm
                    ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
                   AND cpsm.package_session_id IN (:packageSessionIds)
            WHERE s.parent_id IN (:ids)
            """;

    private static final String CHAPTER_COPIES_SQL = """
            SELECT DISTINCT ch.parent_id, ch.id
            FROM chapter ch
                JOIN chapter_package_session_mapping cpsm
                    ON cpsm.chapter_id = ch.id AND cpsm.status <> 'DELETED'
                   AND cpsm.package_session_id IN (:packageSessionIds)
            WHERE ch.parent_id IN (:ids)
            """;

    private static final String MODULE_COPIES_SQL = """
            SELECT DISTINCT md.parent_id, md.id
            FROM modules md
                JOIN module_chapter_mapping mcm ON mcm.module_id = md.id
                JOIN chapter_package_session_mapping cpsm
                    ON cpsm.chapter_id = mcm.chapter_id AND cpsm.status <> 'DELETED'
                   AND cpsm.package_session_id IN (:packageSessionIds)
            WHERE md.parent_id IN (:ids)
            """;

    /**
     * The copies, inside these batches, of the given original ids. A content copy (course
     * duplicate) gives every slide, chapter and module a new id and records the original in
     * {@code parent_id}; this reads that link back. One original can have several copies when
     * several batches were copied.
     *
     * @return original id to its copies' ids; originals with no copy here are absent
     */
    public Map<String, List<String>> findCopies(CopyKind kind, List<String> originalIds,
                                                List<String> packageSessionIds) {
        Map<String, List<String>> out = new HashMap<>();
        if (originalIds == null || originalIds.isEmpty() || packageSessionIds == null || packageSessionIds.isEmpty()) {
            return out;
        }
        String sql = switch (kind) {
            case SLIDE -> SLIDE_COPIES_SQL;
            case CHAPTER -> CHAPTER_COPIES_SQL;
            case MODULE -> MODULE_COPIES_SQL;
        };
        List<?> rows = entityManager.createNativeQuery(sql)
                .setParameter("ids", originalIds)
                .setParameter("packageSessionIds", packageSessionIds)
                .getResultList();
        for (Object r : rows) {
            Object[] row = (Object[]) r;
            out.computeIfAbsent((String) row[0], k -> new ArrayList<>()).add((String) row[1]);
        }
        return out;
    }

    /** The live batches of a course, for the course-level settings screen. */
    @SuppressWarnings("unchecked")
    public List<String> findPackageSessionIds(String packageId) {
        return (List<String>) entityManager.createNativeQuery("""
                        SELECT ps.id
                        FROM package_session ps
                        WHERE ps.package_id = :packageId
                          AND COALESCE(ps.status, '') <> 'DELETED'
                        """)
                .setParameter("packageId", packageId)
                .getResultList();
    }
}
