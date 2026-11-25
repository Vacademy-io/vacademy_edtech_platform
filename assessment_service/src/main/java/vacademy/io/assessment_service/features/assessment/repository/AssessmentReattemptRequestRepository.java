package vacademy.io.assessment_service.features.assessment.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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
     * The admin inbox. {@code statuses}, {@code types} and {@code assessmentId} are all optional
     * so one query serves "everything pending across the institute" and "this assessment's
     * history"; passing null for any of them drops that predicate rather than matching nothing.
     */
    @Query("""
            SELECT r FROM AssessmentReattemptRequest r
            WHERE r.instituteId = :instituteId
              AND (:assessmentId IS NULL OR r.assessmentId = :assessmentId)
              AND (:statuses IS NULL OR r.status IN :statuses)
              AND (:types IS NULL OR r.requestType IN :types)
            ORDER BY r.createdAt DESC
            """)
    Page<AssessmentReattemptRequest> findForAdmin(@Param("instituteId") String instituteId,
                                                  @Param("assessmentId") String assessmentId,
                                                  @Param("statuses") List<String> statuses,
                                                  @Param("types") List<String> types,
                                                  Pageable pageable);

    long countByInstituteIdAndStatus(String instituteId, String status);

    /**
     * The request, locked for the reviewing transaction. Two admins approving the same request
     * at once would otherwise both see PENDING and both grant (attempts or minutes).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM AssessmentReattemptRequest r WHERE r.id = :id")
    Optional<AssessmentReattemptRequest> findByIdForUpdate(@Param("id") String id);


    long countByInstituteIdAndAssessmentIdAndStatus(String instituteId, String assessmentId, String status);
}
