package vacademy.io.admin_core_service.features.enrolment_break.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.enrolment_break.entity.EnrolmentBreak;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;

@Repository
public interface EnrolmentBreakRepository extends JpaRepository<EnrolmentBreak, String> {

    List<EnrolmentBreak> findByUserIdAndInstituteIdOrderByStartsOnDescCreatedAtDesc(String userId, String instituteId);

    List<EnrolmentBreak> findByInstituteIdAndStatus(String instituteId, String status);

    List<EnrolmentBreak> findByStatusIn(Collection<String> statuses);

    List<EnrolmentBreak> findByUserIdAndInstituteIdAndStatusIn(String userId, String instituteId, Collection<String> statuses);

    List<EnrolmentBreak> findByUserPlanIdAndStatusIn(String userPlanId, Collection<String> statuses);

    @Query("SELECT DISTINCT b.instituteId FROM EnrolmentBreak b WHERE b.status = 'ACTIVE'")
    List<String> findInstituteIdsWithActiveBreaks();

    /** Scheduled breaks whose first day has come (for the daily job). */
    @Query("SELECT b FROM EnrolmentBreak b WHERE b.status = 'SCHEDULED' AND b.startsOn <= :day")
    List<EnrolmentBreak> findScheduledStartingBy(@Param("day") LocalDate day);

    /** Active breaks whose last day is over (for the daily job). */
    @Query("SELECT b FROM EnrolmentBreak b WHERE b.status = 'ACTIVE' AND b.endsOn IS NOT NULL AND b.endsOn < :day")
    List<EnrolmentBreak> findActiveEndedBefore(@Param("day") LocalDate day);

    /** Active pauses on these plans: billing and expiry skip them. */
    @Query("SELECT DISTINCT b.userPlanId FROM EnrolmentBreak b WHERE b.status = 'ACTIVE' AND b.kind = 'PAUSE' "
            + "AND b.userPlanId IN :planIds")
    List<String> findPausedPlanIds(@Param("planIds") Collection<String> planIds);
}
