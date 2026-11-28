package vacademy.io.admin_core_service.features.hr_payroll.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;

import java.util.List;
import java.util.Optional;

@Repository
public interface PayrollAdjustmentRepository extends JpaRepository<PayrollAdjustment, String> {

    List<PayrollAdjustment> findByInstituteIdAndYearAndMonthOrderByCreatedAtAsc(
            String instituteId, Integer year, Integer month);

    List<PayrollAdjustment> findByEmployeeIdAndYearAndMonthAndRunScopeAndPayrollEntryIdIsNull(
            String employeeId, Integer year, Integer month, String runScope);

    /** Employees that an OFF_CYCLE/BONUS run should pay: those with unconsumed adjustments in scope. */
    @Query("SELECT DISTINCT a.employeeId FROM PayrollAdjustment a WHERE a.instituteId = :instituteId "
            + "AND a.year = :year AND a.month = :month AND a.runScope = :runScope AND a.payrollEntryId IS NULL")
    List<String> findEmployeeIdsWithPendingAdjustments(
            @Param("instituteId") String instituteId, @Param("year") Integer year,
            @Param("month") Integer month, @Param("runScope") String runScope);

    Optional<PayrollAdjustment> findByIdAndInstituteId(String id, String instituteId);

    List<PayrollAdjustment> findByPayrollEntryId(String payrollEntryId);

    @Modifying
    @Query("UPDATE PayrollAdjustment a SET a.payrollEntryId = NULL WHERE a.payrollEntryId IN :entryIds")
    void unlinkByPayrollEntryIds(@Param("entryIds") List<String> entryIds);
}
