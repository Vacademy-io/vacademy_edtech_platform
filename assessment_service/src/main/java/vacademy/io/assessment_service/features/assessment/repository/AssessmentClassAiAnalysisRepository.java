package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentClassAiAnalysis;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

@Repository
public interface AssessmentClassAiAnalysisRepository
        extends JpaRepository<AssessmentClassAiAnalysis, String> {

    /** The LIVE report — what a plain download serves. Superseded history excluded. */
    @Query("""
            SELECT a FROM AssessmentClassAiAnalysis a
             WHERE a.assessmentId = :assessmentId
               AND a.instituteId = :instituteId
               AND a.supersededAt IS NULL
            """)
    Optional<AssessmentClassAiAnalysis> findLive(@Param("assessmentId") String assessmentId,
                                                 @Param("instituteId") String instituteId);

    /**
     * Every successful generation for this assessment, newest first.
     *
     * <p>This is the history the download dialog lists: a paid Refresh
     * supersedes the previous report rather than destroying it, so a version
     * already shared with staff stays downloadable.
     */
    @Query("""
            SELECT a FROM AssessmentClassAiAnalysis a
             WHERE a.assessmentId = :assessmentId
               AND a.instituteId = :instituteId
               AND a.status = 'READY'
             ORDER BY a.generatedAt DESC
            """)
    List<AssessmentClassAiAnalysis> findHistory(@Param("assessmentId") String assessmentId,
                                                 @Param("instituteId") String instituteId);

    /**
     * Claims the right to generate, atomically.
     *
     * <p>Returns 1 if this caller won and may call the model, 0 if someone else
     * already holds it. The partial UNIQUE index over live rows does the
     * arbitration — Postgres serialises the insert, so exactly one caller
     * proceeds no matter how many click at once. Without this an idempotency key
     * would still let every concurrent caller make its own model call: the key
     * only deduplicates the CHARGE, after the money has already been spent.
     *
     * <p>MUST be committed before the model call (see the REQUIRES_NEW wrapper
     * on the caller), or a request-scoped transaction keeps the row invisible to
     * the competing request until the model has already run.
     */
    @Modifying
    @Query(value = """
            INSERT INTO assessment_class_ai_analysis
                (id, assessment_id, institute_id, status, idempotency_key,
                 charge_status, credits_quoted, generated_by_user_id, claimed_at, updated_at)
            VALUES (:id, :assessmentId, :instituteId, 'GENERATING', :idempotencyKey,
                    'PENDING', :creditsQuoted, :userId, NOW(), NOW())
            ON CONFLICT (assessment_id, institute_id) WHERE superseded_at IS NULL DO NOTHING
            """, nativeQuery = true)
    int claim(@Param("id") String id,
              @Param("assessmentId") String assessmentId,
              @Param("instituteId") String instituteId,
              @Param("idempotencyKey") String idempotencyKey,
              @Param("creditsQuoted") BigDecimal creditsQuoted,
              @Param("userId") String userId);

    /**
     * Retires the current report so a paid Refresh can claim a fresh row.
     *
     * <p>Supersede-then-insert rather than update-in-place: the old report stays
     * downloadable in history instead of being destroyed by the regenerate that
     * replaced it. A superseded row leaves the partial unique index, so the new
     * claim is unobstructed.
     */
    @Modifying
    @Query(value = """
            UPDATE assessment_class_ai_analysis
               SET superseded_at = NOW(), updated_at = NOW()
             WHERE assessment_id = :assessmentId
               AND institute_id = :instituteId
               AND superseded_at IS NULL
               AND status IN ('READY', 'FAILED')
            """, nativeQuery = true)
    int supersedeLive(@Param("assessmentId") String assessmentId,
                      @Param("instituteId") String instituteId);

    /**
     * Retires a row stranded in GENERATING by a pod that died mid-call.
     *
     * <p>Guarded on claimed_at so it can never steal a claim that is genuinely
     * in flight; without it, one crashed generation would leave that assessment
     * permanently unbuildable.
     */
    @Modifying
    @Query(value = """
            UPDATE assessment_class_ai_analysis
               SET superseded_at = NOW(), status = 'FAILED', updated_at = NOW()
             WHERE assessment_id = :assessmentId
               AND institute_id = :instituteId
               AND superseded_at IS NULL
               AND status = 'GENERATING'
               AND claimed_at < :staleBefore
            """, nativeQuery = true)
    int retireStrandedClaim(@Param("assessmentId") String assessmentId,
                            @Param("instituteId") String instituteId,
                            @Param("staleBefore") Timestamp staleBefore);
}
