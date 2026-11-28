package vacademy.io.admin_core_service.features.hr_payslip.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payslip.entity.Payslip;

import java.util.List;
import java.util.Optional;

@Repository
public interface PayslipRepository extends JpaRepository<Payslip, String> {

    List<Payslip> findByEmployeeIdOrderByYearDescMonthDesc(String employeeId);

    List<Payslip> findByEmployeeIdAndYear(String employeeId, Integer year);

    Optional<Payslip> findByPayrollEntryId(String payrollEntryId);

    List<Payslip> findByPayrollEntryPayrollRunIdOrderByEmployeeEmployeeCodeAsc(String payrollRunId);

    List<Payslip> findByInstituteIdAndMonthAndYear(String instituteId, Integer month, Integer year);
}
