package vacademy.io.assessment_service.features.assessment.copy_intake.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;

import java.util.Date;
import java.util.List;

public interface AiCopyIntakeBatchRepository extends JpaRepository<AiCopyIntakeBatch, String> {
    List<AiCopyIntakeBatch> findByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(String assessmentId, String instituteId);

    List<AiCopyIntakeBatch> findByStatus(String status);

    /**
     * Move a batch from one status to another only if it is still in the first.
     * Two callbacks settling the same batch at the same moment both see "nothing
     * active"; the one whose update returns 1 owns the notification.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE AiCopyIntakeBatch b SET b.status = :to, b.completedAt = :completedAt, b.updatedAt = CURRENT_TIMESTAMP"
            + " WHERE b.id = :id AND b.status = :from")
    int transition(@Param("id") String id, @Param("from") String from, @Param("to") String to,
                   @Param("completedAt") Date completedAt);
}
