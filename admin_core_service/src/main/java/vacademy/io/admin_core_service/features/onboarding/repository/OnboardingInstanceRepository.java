package vacademy.io.admin_core_service.features.onboarding.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingInstance;

import java.util.List;
import java.util.Optional;

public interface OnboardingInstanceRepository extends JpaRepository<OnboardingInstance, String> {
    /**
     * Row-locking read used only to serialize the parent-vs-student resolution's
     * check-then-act (see {@code OnboardingStudentCreationService.resolveSubjectUserId}): two
     * near-simultaneous completions of the same step-instance would otherwise both read
     * resolved_subject_user_id as null before either commits, and each create a separate child
     * account. A concurrent second transaction blocks here until the first commits.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM OnboardingInstance o WHERE o.id = :id")
    Optional<OnboardingInstance> findByIdForUpdate(@Param("id") String id);

    /**
     * Every instance visible under this profile -- whether they're the original subject (e.g. a
     * lead onboarding was started for) OR the resolved student a parent later created/linked on
     * their behalf. Powers the side-view "Onboarding" tab so it shows up under BOTH profiles once
     * a parent resolution has happened, not just the one the flow was originally started from.
     */
    @Query("SELECT o FROM OnboardingInstance o WHERE o.instituteId = :instituteId " +
            "AND (o.subjectUserId = :userId OR o.resolvedSubjectUserId = :userId)")
    List<OnboardingInstance> findVisibleToUser(@Param("userId") String userId, @Param("instituteId") String instituteId);

    List<OnboardingInstance> findByFlowIdAndStatus(String flowId, String status);

    List<OnboardingInstance> findByInstituteIdAndStatus(String instituteId, String status);

    /** Powers the onboarding management dashboard -- every instance for the institute, optionally narrowed to one flow/status. */
    @Query("SELECT o FROM OnboardingInstance o WHERE o.instituteId = :instituteId " +
            "AND (:flowId IS NULL OR o.flowId = :flowId) " +
            "AND (:status IS NULL OR o.status = :status) " +
            "ORDER BY o.startedAt DESC")
    Page<OnboardingInstance> searchInstances(@Param("instituteId") String instituteId,
                                              @Param("flowId") String flowId,
                                              @Param("status") String status,
                                              Pageable pageable);

    /** Instances per status for the dashboard count cards -- same filter as searchInstances, one grouped query. */
    @Query("SELECT o.status, COUNT(o) FROM OnboardingInstance o WHERE o.instituteId = :instituteId " +
            "AND (:flowId IS NULL OR o.flowId = :flowId) GROUP BY o.status")
    List<Object[]> countByStatus(@Param("instituteId") String instituteId, @Param("flowId") String flowId);
}
