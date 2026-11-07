package vacademy.io.admin_core_service.features.hr_leave.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveBalance;

import java.util.List;
import java.util.Optional;

@Repository
public interface LeaveBalanceRepository extends JpaRepository<LeaveBalance, String> {

    List<LeaveBalance> findByEmployee_IdAndYear(String employeeId, Integer year);

    Optional<LeaveBalance> findByEmployee_IdAndLeaveType_IdAndYear(String employeeId, String leaveTypeId, Integer year);

    List<LeaveBalance> findByEmployee_Id(String employeeId);

    /** Every employee's balances for one year — the HR-wide balance view. */
    List<LeaveBalance> findByEmployee_InstituteIdAndYear(String instituteId, Integer year);

    @Query("SELECT CASE WHEN COUNT(lb) > 0 THEN true ELSE false END FROM LeaveBalance lb " +
            "WHERE lb.employee.id IN :employeeIds AND lb.year = :year")
    boolean existsByEmployeeIdsAndYear(@Param("employeeIds") List<String> employeeIds, @Param("year") Integer year);
}
