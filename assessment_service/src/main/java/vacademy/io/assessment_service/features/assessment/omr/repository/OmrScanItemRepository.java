package vacademy.io.assessment_service.features.assessment.omr.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanItem;

import java.util.Date;
import java.util.List;

public interface OmrScanItemRepository extends JpaRepository<OmrScanItem, String> {

    List<OmrScanItem> findByBatchIdOrderByCreatedAtAscPageNoAsc(String batchId);

    List<OmrScanItem> findByBatchIdAndStatus(String batchId, String status);

    List<OmrScanItem> findByBatchIdAndStatusAndUpdatedAtBefore(String batchId, String status, Date before);

    @Query("SELECT i.status, COUNT(i) FROM OmrScanItem i WHERE i.batchId = :batchId AND i.pageNo IS NOT NULL GROUP BY i.status")
    List<Object[]> countSheetsByStatus(@Param("batchId") String batchId);

    @Query("SELECT COUNT(i) FROM OmrScanItem i WHERE i.batchId = :batchId AND i.status IN :statuses")
    long countByBatchIdAndStatusIn(@Param("batchId") String batchId, @Param("statuses") List<String> statuses);

    /** Another sheet of this assessment already placed on this learner (any batch). */
    @Query("SELECT COUNT(i) FROM OmrScanItem i, OmrScanBatch b WHERE b.id = i.batchId AND b.assessmentId = :assessmentId"
            + " AND i.matchedUserId = :userId AND i.id <> :itemId AND i.status = 'GRADED'")
    long countGradedOnLearner(@Param("assessmentId") String assessmentId, @Param("userId") String userId,
                              @Param("itemId") String itemId);

    /**
     * Claim-style status change, as in AiCopyIntakeItemRepository#transition: exactly one
     * of two overlapping passes (two pods, or a sweep landing during the first run) gets
     * 1 back and does the work.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE OmrScanItem i SET i.status = :to, i.updatedAt = CURRENT_TIMESTAMP WHERE i.id = :id AND i.status = :from")
    int transition(@Param("id") String id, @Param("from") String from, @Param("to") String to);
}
