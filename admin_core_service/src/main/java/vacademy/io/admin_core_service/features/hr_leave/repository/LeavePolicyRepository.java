package vacademy.io.admin_core_service.features.hr_leave.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeavePolicy;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface LeavePolicyRepository extends JpaRepository<LeavePolicy, String> {

    List<LeavePolicy> findByInstituteIdAndStatus(String instituteId, String status);

    @Query("SELECT p FROM LeavePolicy p WHERE p.instituteId = :instituteId AND p.status = 'ACTIVE' " +
            "AND p.effectiveFrom <= :date AND (p.effectiveTo IS NULL OR p.effectiveTo >= :date)")
    List<LeavePolicy> findActivePolicies(@Param("instituteId") String instituteId, @Param("date") LocalDate date);

    List<LeavePolicy> findByLeaveType_Id(String leaveTypeId);

    /**
     * Every institute that has at least one ACTIVE leave policy — the fan-out
     * set for the daily accrual job (LeaveAccrualJob). Effective-date filtering
     * happens inside the accrual itself, per institute timezone.
     */
    @Query("SELECT DISTINCT p.instituteId FROM LeavePolicy p WHERE p.status = 'ACTIVE'")
    List<String> findDistinctInstituteIdsWithActivePolicies();
}
