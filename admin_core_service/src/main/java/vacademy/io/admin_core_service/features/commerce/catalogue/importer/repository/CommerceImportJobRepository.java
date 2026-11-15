package vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceImportJobRepository extends JpaRepository<CommerceImportJob, String> {

    Optional<CommerceImportJob> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceImportJob> findFirstByInstituteIdAndKindAndStatusIn(String instituteId, String kind,
                                                                         Collection<String> statuses);

    Page<CommerceImportJob> findByInstituteIdAndKind(String instituteId, String kind, Pageable pageable);

    /** Jobs whose worker has gone quiet; read by every pod, so the claim below decides who runs. */
    List<CommerceImportJob> findTop20ByStatusInAndHeartbeatAtBeforeOrderByHeartbeatAtAsc(
            Collection<String> statuses, LocalDateTime heartbeatBefore);

    /** Takes a job that has just been queued. One row means this caller is its worker. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommerceImportJob j
            SET j.status = 'RUNNING', j.attempt = j.attempt + 1, j.heartbeatAt = :now,
                j.startedAt = COALESCE(j.startedAt, :now), j.updatedAt = :now
            WHERE j.id = :id AND j.status = 'QUEUED' AND j.attempt = 0
            """)
    int claimQueued(@Param("id") String id, @Param("now") LocalDateTime now);

    /** Takes over a job whose worker stopped. The stale test is repeated here, so only one pod wins. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommerceImportJob j
            SET j.status = 'RUNNING', j.attempt = j.attempt + 1, j.heartbeatAt = :now,
                j.startedAt = COALESCE(j.startedAt, :now), j.updatedAt = :now
            WHERE j.id = :id AND j.status IN ('QUEUED', 'RUNNING') AND j.heartbeatAt < :staleBefore
            """)
    int claimStale(@Param("id") String id, @Param("now") LocalDateTime now,
                   @Param("staleBefore") LocalDateTime staleBefore);

    /** Progress after one product. No row is written once another worker has taken the job. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommerceImportJob j
            SET j.rowsDone = :rowsDone, j.rowsFailed = :rowsFailed,
                j.productsCreated = :productsCreated, j.productsUpdated = :productsUpdated,
                j.productsFailed = :productsFailed, j.variantsCreated = :variantsCreated,
                j.variantsUpdated = :variantsUpdated, j.imageUrlsQueued = :imageUrlsQueued,
                j.nextGroupIndex = :nextGroupIndex, j.errorCount = :errorCount,
                j.issuesJson = :issuesJson, j.failedRowsJson = :failedRowsJson,
                j.createdPackageIdsJson = :createdPackageIdsJson,
                j.heartbeatAt = :now, j.updatedAt = :now
            WHERE j.id = :id AND j.attempt = :attempt AND j.status = 'RUNNING'
            """)
    int saveProgress(@Param("id") String id, @Param("attempt") int attempt,
                     @Param("rowsDone") int rowsDone, @Param("rowsFailed") int rowsFailed,
                     @Param("productsCreated") int productsCreated, @Param("productsUpdated") int productsUpdated,
                     @Param("productsFailed") int productsFailed, @Param("variantsCreated") int variantsCreated,
                     @Param("variantsUpdated") int variantsUpdated, @Param("imageUrlsQueued") int imageUrlsQueued,
                     @Param("nextGroupIndex") int nextGroupIndex, @Param("errorCount") int errorCount,
                     @Param("issuesJson") String issuesJson, @Param("failedRowsJson") String failedRowsJson,
                     @Param("createdPackageIdsJson") String createdPackageIdsJson,
                     @Param("now") LocalDateTime now);

    /** Sets the totals once the file has been planned. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommerceImportJob j
            SET j.rowsTotal = :rowsTotal, j.productsTotal = :productsTotal, j.heartbeatAt = :now, j.updatedAt = :now
            WHERE j.id = :id AND j.attempt = :attempt AND j.status = 'RUNNING'
            """)
    int saveTotals(@Param("id") String id, @Param("attempt") int attempt, @Param("rowsTotal") int rowsTotal,
                   @Param("productsTotal") int productsTotal, @Param("now") LocalDateTime now);

    /** Ends the job of this worker. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommerceImportJob j
            SET j.status = :status, j.failureMessage = :failureMessage, j.finishedAt = :now,
                j.heartbeatAt = :now, j.updatedAt = :now
            WHERE j.id = :id AND j.attempt = :attempt AND j.status = 'RUNNING'
            """)
    int finish(@Param("id") String id, @Param("attempt") int attempt, @Param("status") String status,
               @Param("failureMessage") String failureMessage, @Param("now") LocalDateTime now);

    /** Gives up on a job that no worker could finish. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommerceImportJob j
            SET j.status = 'FAILED', j.failureMessage = :failureMessage, j.finishedAt = :now, j.updatedAt = :now
            WHERE j.id = :id AND j.status IN ('QUEUED', 'RUNNING') AND j.heartbeatAt < :staleBefore
            """)
    int abandon(@Param("id") String id, @Param("failureMessage") String failureMessage,
                @Param("now") LocalDateTime now, @Param("staleBefore") LocalDateTime staleBefore);
}
