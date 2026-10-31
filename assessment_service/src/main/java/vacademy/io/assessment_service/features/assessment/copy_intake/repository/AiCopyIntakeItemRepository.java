package vacademy.io.assessment_service.features.assessment.copy_intake.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;

import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface AiCopyIntakeItemRepository extends JpaRepository<AiCopyIntakeItem, String> {

    /** A checked copy of one item in a batch, for the bulk download. */
    interface CheckedCopyRow {
        String getItemId();

        String getFileName();

        String getStudentName();

        String getRoll();

        String getEvaluatedFileId();
    }

    /**
     * Every copy in the batch whose AI check finished with a checked copy, in upload
     * order. Reads only these columns: an attempt row also carries the full answer JSON.
     */
    @Query("SELECT i.id AS itemId, i.fileName AS fileName, i.matchedName AS studentName,"
            + " i.extractedRoll AS roll, a.evaluatedFileId AS evaluatedFileId"
            + " FROM AiCopyIntakeItem i, StudentAttempt a WHERE i.batchId = :batchId AND i.status = :status"
            + " AND a.id = i.attemptId AND a.evaluatedFileId IS NOT NULL ORDER BY i.createdAt")
    List<CheckedCopyRow> findCheckedCopies(@Param("batchId") String batchId, @Param("status") String status);

    List<AiCopyIntakeItem> findByBatchIdOrderByCreatedAt(String batchId);

    Optional<AiCopyIntakeItem> findFirstByProcessId(String processId);

    List<AiCopyIntakeItem> findByBatchIdAndStatusIn(String batchId, List<String> statuses);

    @Query("SELECT COUNT(i) FROM AiCopyIntakeItem i WHERE i.batchId = :batchId AND i.status IN :statuses")
    long countByBatchIdAndStatusIn(@Param("batchId") String batchId, @Param("statuses") List<String> statuses);

    @Query("SELECT i.status, COUNT(i) FROM AiCopyIntakeItem i WHERE i.batchId = :batchId GROUP BY i.status")
    List<Object[]> countByStatus(@Param("batchId") String batchId);

    /** Queued copies whose evaluation row has left the queue (PENDING / claimed DISPATCHED) - i.e. with the AI service now. */
    @Query("SELECT COUNT(i) FROM AiCopyIntakeItem i, AiEvaluationProcess p WHERE i.batchId = :batchId"
            + " AND i.status = 'QUEUED' AND p.id = i.processId AND p.status NOT IN ('PENDING', 'DISPATCHED')")
    long countEvaluating(@Param("batchId") String batchId);

    /** Another copy in the same upload already placed on this student. */
    @Query("SELECT COUNT(i) FROM AiCopyIntakeItem i WHERE i.batchId = :batchId AND i.matchedUserId = :userId"
            + " AND i.id <> :itemId AND i.status IN :statuses")
    long countOthersOnStudent(@Param("batchId") String batchId, @Param("userId") String userId,
                              @Param("itemId") String itemId, @Param("statuses") List<String> statuses);

    List<AiCopyIntakeItem> findByBatchIdAndStatusAndUpdatedAtBefore(String batchId, String status, Date before);

    /**
     * Claim-style status change: succeeds for exactly one caller. The runner on
     * two pods (or a sweep overlapping the first run) may both pick up the same
     * PENDING copy; only the one whose update returns 1 reads it, so no copy is
     * read - or turned into an attempt - twice.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE AiCopyIntakeItem i SET i.status = :to, i.updatedAt = CURRENT_TIMESTAMP"
            + " WHERE i.id = :id AND i.status = :from")
    int transition(@Param("id") String id, @Param("from") String from, @Param("to") String to);
}
