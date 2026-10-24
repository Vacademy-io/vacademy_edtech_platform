package vacademy.io.admin_core_service.features.hr_leave.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveApplication;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface LeaveApplicationRepository extends JpaRepository<LeaveApplication, String> {

    @Query("SELECT la FROM LeaveApplication la WHERE la.instituteId = :instituteId " +
            "AND (:status IS NULL OR la.status = :status) " +
            "AND (:employeeId IS NULL OR la.employee.id = :employeeId) " +
            "ORDER BY la.createdAt DESC")
    Page<LeaveApplication> findByFilters(@Param("instituteId") String instituteId,
                                          @Param("status") String status,
                                          @Param("employeeId") String employeeId,
                                          Pageable pageable);

    List<LeaveApplication> findByEmployee_IdAndStatusOrderByFromDateDesc(String employeeId, String status);

    @Query("SELECT la FROM LeaveApplication la WHERE la.employee.id = :employeeId " +
            "AND la.status = 'APPROVED' AND la.fromDate <= :endDate AND la.toDate >= :startDate")
    List<LeaveApplication> findApprovedLeavesInRange(@Param("employeeId") String employeeId,
                                                      @Param("startDate") LocalDate startDate,
                                                      @Param("endDate") LocalDate endDate);

    @Query("SELECT la FROM LeaveApplication la WHERE la.employee.id = :employeeId " +
            "AND la.status IN ('APPROVED', 'PENDING') AND la.fromDate <= :endDate AND la.toDate >= :startDate")
    List<LeaveApplication> findOverlappingLeaves(@Param("employeeId") String employeeId,
                                                  @Param("startDate") LocalDate startDate,
                                                  @Param("endDate") LocalDate endDate);

    @Query("SELECT la FROM LeaveApplication la WHERE la.appliedTo = :managerId AND la.instituteId = :instituteId " +
            "AND la.status = 'PENDING' ORDER BY la.createdAt DESC")
    List<LeaveApplication> findPendingForManagerInInstitute(@Param("managerId") String managerId,
                                                             @Param("instituteId") String instituteId);
}
