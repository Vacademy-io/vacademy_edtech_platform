package vacademy.io.admin_core_service.features.engagement.planning;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface EngagementPlanningRequestRepository extends JpaRepository<EngagementPlanningRequest, String> {

    @Query("SELECT r FROM EngagementPlanningRequest r WHERE r.tokenHash = :hash OR r.reminderTokenHash = :hash")
    List<EngagementPlanningRequest> findByAnyTokenHash(@Param("hash") String hash);

    Optional<EngagementPlanningRequest> findByPackageSessionIdAndTeacherUserIdAndWeekStart(
            String packageSessionId, String teacherUserId, LocalDate weekStart);

    List<EngagementPlanningRequest> findByInstituteIdAndWeekStart(String instituteId, LocalDate weekStart);

    @Query("SELECT r FROM EngagementPlanningRequest r WHERE r.status IN :statuses " +
            "AND r.updatedAt < :before ORDER BY r.updatedAt ASC")
    List<EngagementPlanningRequest> findByStatusesUpdatedBefore(@Param("statuses") Collection<String> statuses,
                                                                @Param("before") Timestamp before,
                                                                org.springframework.data.domain.Pageable page);

    @Query("SELECT r FROM EngagementPlanningRequest r WHERE r.status = 'SENT' AND r.remindedAt IS NULL " +
            "AND r.sentAt < :before AND r.expiresAt > :now ORDER BY r.sentAt ASC")
    List<EngagementPlanningRequest> findDueForReminder(@Param("before") Timestamp before,
                                                       @Param("now") Timestamp now,
                                                       org.springframework.data.domain.Pageable page);
}
