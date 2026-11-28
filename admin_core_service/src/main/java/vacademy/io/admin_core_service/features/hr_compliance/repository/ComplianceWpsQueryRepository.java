package vacademy.io.admin_core_service.features.hr_compliance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;

import java.util.Collection;
import java.util.List;

/**
 * hr_compliance-owned read model over payroll data for Gulf WPS (Wage
 * Protection System) salary files — UAE SIF and Saudi (Mudad-style) exports
 * (Phase E). Deliberately its OWN repository, mirroring
 * {@link ComplianceStatutoryQueryRepository} — the hr_payroll repositories
 * are not touched.
 *
 * <p>Scope contract: every query is institute-scoped through the payroll run
 * and only looks at filable runs (PROCESSED/APPROVED/PAID as passed by the
 * caller). HELD entries never enter a WPS file — they were not paid out.
 */
@Repository
public interface ComplianceWpsQueryRepository extends JpaRepository<PayrollEntry, String> {

    /**
     * All payable (non-HELD) payroll entries for the institute's runs of the
     * given month/year. Fetch-joins the run, employee and (optional) bank
     * account so callers can read them without an open session per row
     * (services remain readOnly-transactional). Bank account is a LEFT join —
     * an entry without one still surfaces so it can land in the skipped list
     * with a reason instead of silently disappearing.
     */
    @Query("""
            SELECT e FROM PayrollEntry e
            JOIN FETCH e.payrollRun r
            JOIN FETCH e.employee
            LEFT JOIN FETCH e.bankAccount
            WHERE r.instituteId = :instituteId
              AND r.month = :month
              AND r.year = :year
              AND r.status IN (:runStatuses)
              AND (e.status IS NULL OR e.status <> 'HELD')
            """)
    List<PayrollEntry> findPayableEntries(
            @Param("instituteId") String instituteId,
            @Param("month") Integer month,
            @Param("year") Integer year,
            @Param("runStatuses") Collection<String> runStatuses);

    /**
     * (payrollEntryId, amount) pairs of the BASIC salary component for the
     * same entry population — used by the Saudi file to report basic salary
     * separately without loading every entry's component list. Component code
     * "BASIC" is the platform-wide convention (see SalaryStructureService
     * basic-component discovery and PayrollCalculationService).
     */
    @Query("""
            SELECT c.payrollEntry.id, c.amount FROM PayrollEntryComponent c
            JOIN c.component sc
            JOIN c.payrollEntry e
            JOIN e.payrollRun r
            WHERE r.instituteId = :instituteId
              AND r.month = :month
              AND r.year = :year
              AND r.status IN (:runStatuses)
              AND (e.status IS NULL OR e.status <> 'HELD')
              AND UPPER(sc.code) = 'BASIC'
            """)
    List<Object[]> findBasicAmountsByEntry(
            @Param("instituteId") String instituteId,
            @Param("month") Integer month,
            @Param("year") Integer year,
            @Param("runStatuses") Collection<String> runStatuses);
}
