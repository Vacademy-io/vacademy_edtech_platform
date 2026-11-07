package vacademy.io.admin_core_service.features.hr_tax.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxComputation;

import org.springframework.data.jpa.repository.Modifying;

import java.util.List;
import java.util.Optional;

@Repository
public interface TaxComputationRepository extends JpaRepository<TaxComputation, String> {

    List<TaxComputation> findByEmployee_IdAndFinancialYearOrderByMonthAsc(String employeeId, String financialYear);

    /** One row per employee per period (V480 unique) — payroll upserts instead of appending. */
    Optional<TaxComputation> findByEmployee_IdAndFinancialYearAndMonthAndYear(
            String employeeId, String financialYear, Integer month, Integer year);

    @Modifying
    void deleteByEmployee_IdAndMonthAndYear(String employeeId, Integer month, Integer year);
}
