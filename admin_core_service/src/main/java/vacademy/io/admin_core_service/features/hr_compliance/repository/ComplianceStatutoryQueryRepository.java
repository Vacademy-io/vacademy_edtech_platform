package vacademy.io.admin_core_service.features.hr_compliance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryComponent;

import java.util.Collection;
import java.util.List;

/**
 * hr_compliance-owned read model over payroll data for statutory-scheme
 * returns (PF ECR / ESI / PT). Deliberately its OWN repository — the
 * hr_payroll repositories are not touched by Phase D.
 *
 * <p>Scope contract: every query is institute-scoped through the payroll
 * run and only looks at filable runs (PROCESSED/APPROVED/PAID as passed by
 * the caller). HELD entries never enter a statutory return — they were not
 * paid out.
 */
@Repository
public interface ComplianceStatutoryQueryRepository extends JpaRepository<PayrollEntryComponent, String> {

    /**
     * All statutory components (matched by salary-component code alias) for
     * the institute's payroll runs of the given month/year. Fetch-joins the
     * component, entry, run and employee so callers can read them without an
     * open session per row (services are still readOnly-transactional).
     */
    @Query("""
            SELECT c FROM PayrollEntryComponent c
            JOIN FETCH c.component sc
            JOIN FETCH c.payrollEntry e
            JOIN FETCH e.payrollRun r
            JOIN FETCH e.employee
            WHERE r.instituteId = :instituteId
              AND r.month = :month
              AND r.year = :year
              AND r.status IN (:runStatuses)
              AND (e.status IS NULL OR e.status <> 'HELD')
              AND UPPER(sc.code) IN (:codes)
            """)
    List<PayrollEntryComponent> findStatutoryComponents(
            @Param("instituteId") String instituteId,
            @Param("month") Integer month,
            @Param("year") Integer year,
            @Param("runStatuses") Collection<String> runStatuses,
            @Param("codes") Collection<String> codes);
}
