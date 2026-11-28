package vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;

import java.util.Collection;
import java.util.Date;
import java.util.List;

public interface AiScanSessionRepository extends JpaRepository<AiScanSession, String> {

    List<AiScanSession> findTop10ByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(String assessmentId,
                                                                                  String instituteId);

    List<AiScanSession> findByStatusAndUpdatedAtBefore(String status, Date before);

    List<AiScanSession> findByStatusAndErrorMessageAndUpdatedAtBefore(String status, String errorMessage, Date before);

    /** The sweep's queries with an institute allow-list: switched-off institutes' rows are never read. */
    List<AiScanSession> findByStatusAndInstituteIdInAndUpdatedAtBefore(String status, Collection<String> instituteIds,
                                                                     Date before);

    List<AiScanSession> findByStatusAndErrorMessageAndInstituteIdInAndUpdatedAtBefore(String status, String errorMessage,
                                                                                     Collection<String> instituteIds,
                                                                                     Date before);

    /**
     * Claim a build nobody is working on: succeeds only while the session is still
     * in {@code status} and was last stamped before {@code before}, so of two pods'
     * sweeps exactly one restarts it. Stamps it, so the other sees it alive.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE AiScanSession s SET s.version = s.version + 1, s.updatedAt = CURRENT_TIMESTAMP,"
            + " s.errorMessage = NULL WHERE s.id = :id AND s.status = :status AND s.updatedAt < :before")
    int claimBuild(@Param("id") String id, @Param("status") String status, @Param("before") Date before);

    /**
     * Move a session from one status to another only if it is still in the first.
     * Two clicks on Build (or Start), or a sweep overlapping a request: the one
     * whose update returns 1 owns the step. Bumps the version so an entity read
     * before the change cannot overwrite it.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE AiScanSession s SET s.status = :to, s.version = s.version + 1, s.updatedAt = CURRENT_TIMESTAMP"
            + " WHERE s.id = :id AND s.status = :from")
    int transition(@Param("id") String id, @Param("from") String from, @Param("to") String to);
}
