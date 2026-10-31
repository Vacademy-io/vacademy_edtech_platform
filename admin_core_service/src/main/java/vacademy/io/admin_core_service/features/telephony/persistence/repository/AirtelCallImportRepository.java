package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AirtelCallImport;

import java.util.List;
import java.util.Optional;

@Repository
public interface AirtelCallImportRepository extends JpaRepository<AirtelCallImport, String> {

    /** Idempotency: has this exact S3 object already been imported? */
    boolean existsByS3Key(String s3Key);

    /** Which of these S3 keys already have a row (one query instead of one probe per key). */
    @org.springframework.data.jpa.repository.Query("SELECT a.s3Key FROM AirtelCallImport a WHERE a.s3Key IN :keys")
    java.util.List<String> findExistingS3Keys(@org.springframework.data.repository.query.Param("keys") java.util.Collection<String> keys);

    Optional<AirtelCallImport> findByS3Key(String s3Key);

    /** Oldest-first batch of staging rows the promoter still needs to process. */
    List<AirtelCallImport> findByProcessingStatusOrderByReceivedAtAsc(String processingStatus, Limit limit);
}
