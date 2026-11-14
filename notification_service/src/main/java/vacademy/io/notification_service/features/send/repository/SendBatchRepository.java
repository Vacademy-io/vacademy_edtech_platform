package vacademy.io.notification_service.features.send.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.send.entity.SendBatch;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface SendBatchRepository extends JpaRepository<SendBatch, String> {

    @Query("SELECT b FROM SendBatch b WHERE b.status = 'QUEUED' ORDER BY b.createdAt ASC")
    List<SendBatch> findQueuedBatches();

    /** QUEUED to PROCESSING, for exactly one caller. */
    @Modifying
    @Transactional
    @Query("UPDATE SendBatch b SET b.status = 'PROCESSING', b.updatedAt = :now WHERE b.id = :id AND b.status = 'QUEUED'")
    int claimBatch(@Param("id") String id, @Param("now") LocalDateTime now);

    /** Column-level update: saving the entity would rewrite the whole recipient payload per chunk. */
    @Modifying
    @Transactional
    @Query("UPDATE SendBatch b SET b.sentCount = :sent, b.failedCount = :failed, b.updatedAt = :now WHERE b.id = :id")
    int updateProgress(@Param("id") String id, @Param("sent") int sent, @Param("failed") int failed,
                       @Param("now") LocalDateTime now);

    @Modifying
    @Transactional
    @Query("UPDATE SendBatch b SET b.status = :status, b.sentCount = :sent, b.failedCount = :failed, "
            + "b.errorMessage = :error, b.resultsPayload = :results, b.completedAt = :now, b.updatedAt = :now "
            + "WHERE b.id = :id")
    int finishBatch(@Param("id") String id, @Param("status") String status, @Param("sent") int sent,
                    @Param("failed") int failed, @Param("error") String error,
                    @Param("results") String results, @Param("now") LocalDateTime now);

    /** Rows of [id, instituteId, source]. The createdAfter bound keeps long-dead batches from being revived. */
    @Query("SELECT b.id, b.instituteId, b.source FROM SendBatch b WHERE b.channel = 'EMAIL' AND b.source IN :sources "
            + "AND b.status IN ('QUEUED', 'PROCESSING') AND b.updatedAt < :staleBefore AND b.createdAt > :createdAfter")
    List<Object[]> findStaleEmailBatches(@Param("sources") java.util.Collection<String> sources,
                                         @Param("staleBefore") LocalDateTime staleBefore,
                                         @Param("createdAfter") LocalDateTime createdAfter);

    @Modifying
    @Transactional
    @Query("UPDATE SendBatch b SET b.status = 'QUEUED', b.updatedAt = :now WHERE b.id = :id "
            + "AND b.status IN ('QUEUED', 'PROCESSING') AND b.updatedAt < :staleBefore")
    int requeueStaleBatch(@Param("id") String id, @Param("staleBefore") LocalDateTime staleBefore,
                          @Param("now") LocalDateTime now);

    List<SendBatch> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    long countByInstituteIdAndStatusIn(String instituteId, List<String> statuses);

    @Query("SELECT COUNT(b) FROM SendBatch b WHERE b.instituteId = :instituteId AND b.status = :status AND b.createdAt >= :since")
    long countByInstituteIdAndStatusSince(@Param("instituteId") String instituteId,
                                          @Param("status") String status,
                                          @Param("since") LocalDateTime since);
}
