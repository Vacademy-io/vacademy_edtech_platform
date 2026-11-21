package vacademy.io.admin_core_service.features.hr_payroll.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryError;

import java.util.List;

@Repository
public interface PayrollEntryErrorRepository extends JpaRepository<PayrollEntryError, String> {

    List<PayrollEntryError> findByPayrollRunIdOrderByCreatedAtAsc(String payrollRunId);

    @Modifying
    void deleteByPayrollRunId(String payrollRunId);
}
