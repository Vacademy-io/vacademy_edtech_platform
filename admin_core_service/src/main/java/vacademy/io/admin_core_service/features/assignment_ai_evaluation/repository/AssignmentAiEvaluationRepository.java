package vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluation;

import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AssignmentAiEvaluationRepository extends JpaRepository<AssignmentAiEvaluation, String> {

    Optional<AssignmentAiEvaluation> findFirstByTrackedIdOrderByCreatedAtDesc(String trackedId);

    @Modifying(clearAutomatically = true)
    @Transactional
    @Query(value = "UPDATE assignment_ai_evaluation SET ai_job_id = :jobId WHERE id = :id", nativeQuery = true)
    void setAiJobId(@Param("id") String id, @Param("jobId") String jobId);

    @Modifying(clearAutomatically = true)
    @Transactional
    @Query(value = "UPDATE assignment_ai_evaluation SET current_step = COALESCE(CAST(:step AS VARCHAR), current_step), "
            + "updated_at = :now WHERE id = :id AND status = 'PROCESSING'", nativeQuery = true)
    void recordProgress(@Param("id") String id, @Param("step") String step, @Param("now") java.time.Instant now);

    /**
     * Whether the slide sits in a course of the institute: slide, chapter, the batches
     * the chapter is mapped to, their package, the package owner.
     */
    @Query(value = """
            SELECT EXISTS (
                SELECT 1
                FROM chapter_to_slides cts
                JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cts.chapter_id
                JOIN package_session ps ON ps.id = cpsm.package_session_id
                JOIN package_institute pi ON pi.package_id = ps.package_id
                WHERE cts.slide_id = :slideId
                  AND pi.institute_id = :instituteId
            )
            """, nativeQuery = true)
    boolean isSlideInInstitute(@Param("slideId") String slideId, @Param("instituteId") String instituteId);

    List<AssignmentAiEvaluation> findByStatusOrderByCreatedAtAsc(String status, Pageable pageable);

    long countByStatus(String status);

    List<AssignmentAiEvaluation> findByStatusAndUpdatedAtBefore(String status, Instant before);

    /** Per-status counts of one bulk check, as [status, count] rows. */
    @Query(value = "SELECT status, COUNT(*) FROM assignment_ai_evaluation WHERE batch_id = :batchId GROUP BY status",
            nativeQuery = true)
    List<Object[]> countByStatusForBatch(@Param("batchId") String batchId);

    /** Each learner's latest submission on the slide, as the bulk check sees it. */
    interface LatestSubmissionRow {
        String getTrackedId();

        Boolean getGraded();

        Boolean getHasFiles();

        /** Status of the latest AI check that did not fail (QUEUED, PROCESSING, COMPLETED), or null. */
        String getAiStatus();
    }

    /**
     * The latest submission of every learner on the slide (scoped to the learners enrolled
     * in the batch being viewed, like the Activity Stats list), with whether a teacher has
     * already graded it (same rule as that list), whether it has files and the state of
     * its latest AI check that did not fail.
     */
    @Query(value = """
            SELECT latest.id AS trackedId,
                   ((latest.marks IS NOT NULL AND latest.marks > 0)
                     OR latest.feedback IS NOT NULL
                     OR latest.checked_file_id IS NOT NULL) AS graded,
                   (latest.comma_separated_file_ids IS NOT NULL
                     AND latest.comma_separated_file_ids <> '') AS hasFiles,
                   (SELECT e.status FROM assignment_ai_evaluation e
                     WHERE e.tracked_id = latest.id AND e.status <> 'FAILED'
                     ORDER BY e.created_at DESC LIMIT 1) AS aiStatus
            FROM (
                SELECT DISTINCT ON (a.user_id)
                       ast.id, ast.marks, ast.feedback, ast.checked_file_id, ast.comma_separated_file_ids
                FROM assignment_slide_tracked ast
                JOIN activity_log a ON a.id = ast.activity_id
                WHERE a.slide_id = :slideId
                  AND (CAST(:packageSessionId AS text) IS NULL OR EXISTS (
                        SELECT 1 FROM student_session_institute_group_mapping ssigm
                        WHERE ssigm.user_id = a.user_id
                          AND ssigm.package_session_id = :packageSessionId
                          AND ssigm.status IN ('ACTIVE', 'INACTIVE')
                      ))
                ORDER BY a.user_id, ast.created_at DESC
            ) latest
            """, nativeQuery = true)
    List<LatestSubmissionRow> findLatestSubmissions(@Param("slideId") String slideId,
                                                    @Param("packageSessionId") String packageSessionId);
}
