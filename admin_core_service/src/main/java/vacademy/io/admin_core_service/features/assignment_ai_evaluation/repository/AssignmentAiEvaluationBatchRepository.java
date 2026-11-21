package vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluationBatch;

import java.util.List;
import java.util.Optional;

public interface AssignmentAiEvaluationBatchRepository extends JpaRepository<AssignmentAiEvaluationBatch, String> {

    /** The latest bulk check of this slide for the batch of learners being viewed (NULL = all). */
    @Query(value = """
            SELECT * FROM assignment_ai_evaluation_batch
            WHERE slide_id = :slideId
              AND institute_id = :instituteId
              AND package_session_id IS NOT DISTINCT FROM CAST(:packageSessionId AS VARCHAR)
            ORDER BY created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<AssignmentAiEvaluationBatch> findLatest(@Param("slideId") String slideId,
                                                     @Param("packageSessionId") String packageSessionId,
                                                     @Param("instituteId") String instituteId);

    /**
     * Claims the batch's one completion notice: 1 when this caller should send it, 0 when the
     * batch still has work or the notice was already claimed.
     */
    @Modifying(clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE assignment_ai_evaluation_batch b SET notified_at = NOW()
            WHERE b.id = :batchId
              AND b.notified_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM assignment_ai_evaluation e
                  WHERE e.batch_id = b.id AND e.status IN ('QUEUED', 'PROCESSING')
              )
            """, nativeQuery = true)
    int claimNotice(@Param("batchId") String batchId);

    /** Finished batches whose notice nobody claimed yet (two last rows finishing together). */
    @Query(value = """
            SELECT b.id FROM assignment_ai_evaluation_batch b
            WHERE b.notified_at IS NULL
              AND b.created_at > NOW() - INTERVAL '7 days'
              AND NOT EXISTS (
                  SELECT 1 FROM assignment_ai_evaluation e
                  WHERE e.batch_id = b.id AND e.status IN ('QUEUED', 'PROCESSING')
              )
            """, nativeQuery = true)
    List<String> findUnnotifiedFinished();
}
