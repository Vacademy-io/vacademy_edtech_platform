package vacademy.io.admin_core_service.features.hr_teaching.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;

import java.util.Collection;
import java.util.List;

/**
 * hr_teaching's own idempotency check on hr_payroll_adjustment: an employee
 * who already has a TEACHING_PAY adjustment for a month (consumed by a payroll
 * run or not — {@code payrollEntryId} state is deliberately ignored) must not
 * receive a second one from a re-run of materialize.
 */
@Repository
public interface HrTeachingAdjustmentRepository extends JpaRepository<PayrollAdjustment, String> {

    List<PayrollAdjustment> findByInstituteIdAndYearAndMonthAndCodeAndEmployeeIdIn(
            String instituteId, Integer year, Integer month, String code, Collection<String> employeeIds);
}
