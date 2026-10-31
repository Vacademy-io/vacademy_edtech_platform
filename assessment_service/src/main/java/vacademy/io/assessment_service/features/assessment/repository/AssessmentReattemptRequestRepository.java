package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReattemptRequest;

import java.util.List;
import java.util.Optional;

@Repository
public interface AssessmentReattemptRequestRepository extends JpaRepository<AssessmentReattemptRequest, String> {

    Optional<AssessmentReattemptRequest> findFirstByAssessmentIdAndUserIdAndRequestTypeAndStatus(
            String assessmentId, String userId, String requestType, String status);

    List<AssessmentReattemptRequest> findByAssessmentIdAndUserIdOrderByCreatedAtDesc(
            String assessmentId, String userId);

    /**
     * The admin inbox. {@code statuses} and {@code assessmentId} are both optional so one query
     * serves "everything pending across the institute" and "this assessment's history"; passing
     * null for either drops that predicate rather than matching nothing.
     */
    @Query("""
            SELECT r FROM AssessmentReattemptRequest r
            WHERE r.instituteId = :instituteId
              AND (:assessmentId IS NULL OR r.assessmentId = :assessmentId)
              AND (:statuses IS NULL OR r.status IN :statuses)
            ORDER BY r.createdAt DESC
            """)
    Page<AssessmentReattemptRequest> findForAdmin(@Param("instituteId") String instituteId,
                                                  @Param("assessmentId") String assessmentId,
                                                  @Param("statuses") List<String> statuses,
                                                  Pageable pageable);

    long countByInstituteIdAndStatus(String instituteId, String status);

    long countByInstituteIdAndAssessmentIdAndStatus(String instituteId, String assessmentId, String status);
}
