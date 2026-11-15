package vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJobFile;

import java.time.LocalDateTime;
import java.util.Optional;

public interface CommerceImportJobFileRepository extends JpaRepository<CommerceImportJobFile, String> {

    Optional<CommerceImportJobFile> findByInstituteIdAndJobId(String instituteId, String jobId);

    boolean existsByInstituteIdAndJobId(String instituteId, String jobId);

    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM CommerceImportJobFile f WHERE f.jobId = :jobId")
    int deleteByJob(@Param("jobId") String jobId);

    /** Old files of the institute whose job is over. A file of a job still in flight is never removed. */
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            DELETE FROM CommerceImportJobFile f
            WHERE f.instituteId = :instituteId AND f.createdAt < :before
              AND NOT EXISTS (SELECT 1 FROM CommerceImportJob j
                              WHERE j.id = f.jobId AND j.status IN ('QUEUED', 'RUNNING'))
            """)
    int purgeOlderThan(@Param("instituteId") String instituteId, @Param("before") LocalDateTime before);
}
