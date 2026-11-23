package vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanLoad;

import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface AiScanLoadRepository extends JpaRepository<AiScanLoad, String> {

    List<AiScanLoad> findBySessionIdOrderByLoadNo(String sessionId);

    Optional<AiScanLoad> findBySessionIdAndLoadNo(String sessionId, int loadNo);

    List<AiScanLoad> findByStatus(String status);

    List<AiScanLoad> findByStatusAndClaimedAtBefore(String status, Date before);

    /** {@link #findByStatus} for the loads of these institutes' sessions only (the sweep, with an allow-list). */
    @Query("SELECT l FROM AiScanLoad l WHERE l.status = :status AND l.sessionId IN"
            + " (SELECT s.id FROM AiScanSession s WHERE s.instituteId IN :institutes)")
    List<AiScanLoad> findByStatusForInstitutes(@Param("status") String status,
                                               @Param("institutes") Collection<String> institutes);

    /** {@link #findByStatusAndClaimedAtBefore} for these institutes only. */
    @Query("SELECT l FROM AiScanLoad l WHERE l.status = :status AND l.claimedAt < :before AND l.sessionId IN"
            + " (SELECT s.id FROM AiScanSession s WHERE s.instituteId IN :institutes)")
    List<AiScanLoad> findByStatusAndClaimedAtBeforeForInstitutes(@Param("status") String status,
                                                                 @Param("before") Date before,
                                                                 @Param("institutes") Collection<String> institutes);

    /**
     * Claim a load for analysis: succeeds for exactly one caller (two pods, or the
     * sweep overlapping a kick). Counts the attempt and stamps the claim so a
     * worker that dies mid-call is noticed by the sweep.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE AiScanLoad l SET l.status = :to, l.attempts = l.attempts + 1, l.claimedAt = :now,"
            + " l.version = l.version + 1, l.updatedAt = CURRENT_TIMESTAMP"
            + " WHERE l.id = :id AND l.status = :from")
    int claim(@Param("id") String id, @Param("from") String from, @Param("to") String to, @Param("now") Date now);

    /** Plain conditional status change (no attempt counted). */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE AiScanLoad l SET l.status = :to, l.version = l.version + 1, l.updatedAt = CURRENT_TIMESTAMP"
            + " WHERE l.id = :id AND l.status = :from")
    int transition(@Param("id") String id, @Param("from") String from, @Param("to") String to);
}
