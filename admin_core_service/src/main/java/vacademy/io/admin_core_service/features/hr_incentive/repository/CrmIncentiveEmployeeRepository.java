package vacademy.io.admin_core_service.features.hr_incentive.repository;

import org.springframework.data.repository.Repository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;

import java.util.Collection;
import java.util.List;

/**
 * Batch counsellor-userId → EmployeeProfile resolution for CRM incentives.
 * Own read-only interface (the shared {@code EmployeeProfileRepository} has no
 * IN-batch variant of findByUserIdAndInstituteId and stays untouched).
 */
public interface CrmIncentiveEmployeeRepository extends Repository<EmployeeProfile, String> {

    List<EmployeeProfile> findByInstituteIdAndUserIdIn(String instituteId, Collection<String> userIds);
}
