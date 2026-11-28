package vacademy.io.admin_core_service.features.hr_employee.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;

import java.util.List;
import java.util.Optional;

@Repository
public interface EmployeeProfileRepository extends JpaRepository<EmployeeProfile, String> {

    Optional<EmployeeProfile> findByUserIdAndInstituteId(String userId, String instituteId);

    Optional<EmployeeProfile> findByUserId(String userId);

    Optional<EmployeeProfile> findByInstituteIdAndEmployeeCode(String instituteId, String employeeCode);

    @Query("SELECT e FROM EmployeeProfile e WHERE e.instituteId = :instituteId " +
            "AND (:status IS NULL OR e.employmentStatus = :status) " +
            "AND (:departmentId IS NULL OR e.department.id = :departmentId) " +
            "AND (:designationId IS NULL OR e.designation.id = :designationId) " +
            "AND (:employmentType IS NULL OR e.employmentType = :employmentType)")
    Page<EmployeeProfile> findByFilters(
            @Param("instituteId") String instituteId,
            @Param("status") String status,
            @Param("departmentId") String departmentId,
            @Param("designationId") String designationId,
            @Param("employmentType") String employmentType,
            Pageable pageable);

    List<EmployeeProfile> findByInstituteIdAndEmploymentStatus(String instituteId, String status);

    List<EmployeeProfile> findByReportingManagerId(String managerId);

    @Query("SELECT COUNT(e) FROM EmployeeProfile e WHERE e.instituteId = :instituteId AND e.employmentStatus = :status")
    long countByInstituteIdAndStatus(@Param("instituteId") String instituteId, @Param("status") String status);

    @Query("SELECT e FROM EmployeeProfile e WHERE e.instituteId = :instituteId AND e.employmentStatus IN :statuses")
    List<EmployeeProfile> findActiveEmployees(@Param("instituteId") String instituteId, @Param("statuses") List<String> statuses);

    boolean existsByUserIdAndInstituteId(String userId, String instituteId);

    /** Probation-end reminder sweep (ProbationEndJob): candidates in a broad window, filtered per institute TZ by the job. */
    List<EmployeeProfile> findByProbationEndDateBetween(java.time.LocalDate start, java.time.LocalDate end);

    /**
     * The auth userId of an employee's reporting manager, without initializing
     * the lazy association (safe to call from scheduler threads with no open
     * session). Empty when the employee has no reporting manager.
     */
    @Query("SELECT e.reportingManager.userId FROM EmployeeProfile e WHERE e.id = :employeeId")
    Optional<String> findReportingManagerUserId(@Param("employeeId") String employeeId);
}
