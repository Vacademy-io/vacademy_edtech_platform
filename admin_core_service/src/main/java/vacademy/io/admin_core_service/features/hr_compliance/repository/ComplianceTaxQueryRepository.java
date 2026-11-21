package vacademy.io.admin_core_service.features.hr_compliance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_tax.entity.TaxComputation;

import java.util.List;

/**
 * hr_compliance-owned read-only queries over {@link TaxComputation} (Phase D).
 * Exists so TDS filing exports can run institute-wide aggregations without
 * touching the hr_tax package's own repository.
 */
@Repository
public interface ComplianceTaxQueryRepository extends JpaRepository<TaxComputation, String> {

    /**
     * Every tax computation row for an institute in a financial year, with the
     * employee eagerly fetched (Form 24Q reads PAN/code/userId off each row).
     * Ordering is by raw calendar month; callers must re-sort into FY order
     * (Apr..Mar) before taking cumulative deltas.
     */
    @Query("SELECT tc FROM TaxComputation tc JOIN FETCH tc.employee e " +
            "WHERE e.instituteId = :instituteId AND tc.financialYear = :financialYear " +
            "ORDER BY e.id, tc.month")
    List<TaxComputation> findAllByInstituteAndFinancialYear(
            @Param("instituteId") String instituteId,
            @Param("financialYear") String financialYear);
}
