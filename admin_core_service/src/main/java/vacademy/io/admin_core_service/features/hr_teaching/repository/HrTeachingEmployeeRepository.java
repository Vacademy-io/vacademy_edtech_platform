package vacademy.io.admin_core_service.features.hr_teaching.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;

import java.util.Collection;
import java.util.List;

/**
 * hr_teaching's own batch lookup on hr_employee_profile: teachers found in the
 * live-session data are matched to HR employees by
 * {@code EmployeeProfile.userId == LiveSession.createdByUserId}, always scoped
 * to the validated institute.
 */
@Repository
public interface HrTeachingEmployeeRepository extends JpaRepository<EmployeeProfile, String> {

    List<EmployeeProfile> findByInstituteIdAndUserIdIn(String instituteId, Collection<String> userIds);
}
