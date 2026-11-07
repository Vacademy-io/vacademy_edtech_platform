package vacademy.io.admin_core_service.features.hr_leave.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveAccrualTxn;

@Repository
public interface LeaveAccrualTxnRepository extends JpaRepository<LeaveAccrualTxn, String> {

    boolean existsByEmployeeIdAndLeaveTypeIdAndPeriodKey(String employeeId, String leaveTypeId, String periodKey);
}
