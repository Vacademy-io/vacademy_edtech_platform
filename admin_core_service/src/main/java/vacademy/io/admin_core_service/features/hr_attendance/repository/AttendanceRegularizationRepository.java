package vacademy.io.admin_core_service.features.hr_attendance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRegularization;

import java.util.List;

@Repository
public interface AttendanceRegularizationRepository extends JpaRepository<AttendanceRegularization, String> {

    List<AttendanceRegularization> findByEmployeeIdOrderByCreatedAtDesc(String employeeId);

    List<AttendanceRegularization> findByApprovalStatusOrderByCreatedAtDesc(String approvalStatus);

    /**
     * The institute's regularization queue, newest first. Scoped through the
     * employee: the status-only finder above spans every tenant and must not
     * back an API.
     */
    List<AttendanceRegularization> findByEmployee_InstituteIdOrderByCreatedAtDesc(String instituteId);

    List<AttendanceRegularization> findByEmployee_InstituteIdAndApprovalStatusOrderByCreatedAtDesc(
            String instituteId, String approvalStatus);
}
