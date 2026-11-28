package vacademy.io.admin_core_service.features.erp_finance.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.erp_finance.dto.FinanceReportDepartmentRowDTO;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Read-only query gateway for the Phase F4b P&L snapshot. Owns its own SQL /
 * JPQL so the report never couples to fee_management or hr_payroll internals
 * beyond their stable schema.
 *
 * All queries are institute-scoped; callers must have already authorized the
 * institute via HrAccessGuard.
 */
@Repository
public class FinanceReportQueryRepository {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Collected (cash-in) fee revenue for a time window.
     *
     * Reproduces THE canonical cash-in query from
     * features/fee_management/repository/CollectionDashboardRepositoryImpl.java
     * (PAYMENT_MODE_FROM, ~lines 127-138): allocated ledger amounts joined to
     * PAID payment logs, excluding REFUND/BOUNCE_REVERSAL reversals. payment_log
     * has NO institute_id column — the complex_payment_option join is the
     * institute scope. This copy only adds the created_at window.
     *
     * @param fromTs inclusive window start (UTC — sal.created_at is a UTC DB
     *               timestamp; see FinanceReportService for the Asia/Kolkata
     *               month-bound convention)
     * @param toTs   exclusive window end (UTC)
     */
    public BigDecimal collectedRevenue(String instituteId, LocalDateTime fromTs, LocalDateTime toTs) {
        String sql =
                "SELECT COALESCE(SUM(sal.amount_allocated), 0) " +
                "FROM student_fee_allocation_ledger sal " +
                "JOIN payment_log pl ON sal.payment_log_id = pl.id " +
                "JOIN student_fee_payment sfp ON sal.student_fee_payment_id = sfp.id " +
                "JOIN complex_payment_option cpo ON sfp.cpo_id = cpo.id " +
                "WHERE cpo.institute_id = :instituteId " +
                "  AND sal.transaction_type NOT IN ('REFUND','BOUNCE_REVERSAL') " +
                "  AND pl.payment_status = 'PAID' " +
                "  AND sal.created_at >= :fromTs " +
                "  AND sal.created_at < :toTs";
        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("instituteId", instituteId);
        q.setParameter("fromTs", fromTs);
        q.setParameter("toTs", toTs);
        Object result = q.getSingleResult();
        return result == null ? BigDecimal.ZERO : new BigDecimal(result.toString());
    }

    /**
     * Payroll employer cost per department for a payroll period.
     *
     * Cost side of the P&L: entries of APPROVED/PAID runs only (DRAFT /
     * PROCESSING / PROCESSED / CANCELLED runs are not yet — or never — a real
     * cost), HELD entries excluded (money not going out). Employer cost per
     * entry = gross_salary + COALESCE(total_employer_contributions, 0).
     *
     * Department name is null for employees without a department; the service
     * maps that group to "Unassigned". Rows are unsorted — service sorts.
     */
    public List<FinanceReportDepartmentRowDTO> payrollCostByDepartment(String instituteId, int month, int year) {
        String jpql =
                "SELECT d.name, " +
                "       COUNT(DISTINCT e.id), " +
                "       SUM(pe.grossSalary + COALESCE(pe.totalEmployerContributions, 0)), " +
                "       SUM(pe.netPay) " +
                "FROM PayrollEntry pe " +
                "JOIN pe.payrollRun r " +
                "JOIN pe.employee e " +
                "LEFT JOIN e.department d " +
                "WHERE r.instituteId = :instituteId " +
                "  AND r.month = :month " +
                "  AND r.year = :year " +
                "  AND r.status IN ('APPROVED', 'PAID') " +
                "  AND (pe.status IS NULL OR pe.status <> 'HELD') " +
                "GROUP BY d.name";
        Query q = entityManager.createQuery(jpql);
        q.setParameter("instituteId", instituteId);
        q.setParameter("month", month);
        q.setParameter("year", year);
        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();
        List<FinanceReportDepartmentRowDTO> out = new ArrayList<>();
        for (Object[] row : rows) {
            out.add(new FinanceReportDepartmentRowDTO(
                    (String) row[0],
                    row[1] == null ? 0L : ((Number) row[1]).longValue(),
                    toBigDecimal(row[2]),
                    toBigDecimal(row[3])));
        }
        return out;
    }

    /** Number of APPROVED/PAID payroll runs in the period (for the summary). */
    public long approvedOrPaidRunCount(String instituteId, int month, int year) {
        String jpql =
                "SELECT COUNT(r) FROM PayrollRun r " +
                "WHERE r.instituteId = :instituteId AND r.month = :month AND r.year = :year " +
                "  AND r.status IN ('APPROVED', 'PAID')";
        Query q = entityManager.createQuery(jpql);
        q.setParameter("instituteId", instituteId);
        q.setParameter("month", month);
        q.setParameter("year", year);
        return ((Number) q.getSingleResult()).longValue();
    }

    /**
     * Distinct currencies on the period's counted payroll entries (entry
     * currency, falling back to the run's currency). Nulls dropped by caller.
     */
    public List<String> payrollCurrencies(String instituteId, int month, int year) {
        String jpql =
                "SELECT DISTINCT COALESCE(pe.currency, r.currency) " +
                "FROM PayrollEntry pe " +
                "JOIN pe.payrollRun r " +
                "WHERE r.instituteId = :instituteId AND r.month = :month AND r.year = :year " +
                "  AND r.status IN ('APPROVED', 'PAID') " +
                "  AND (pe.status IS NULL OR pe.status <> 'HELD')";
        Query q = entityManager.createQuery(jpql);
        q.setParameter("instituteId", instituteId);
        q.setParameter("month", month);
        q.setParameter("year", year);
        @SuppressWarnings("unchecked")
        List<String> currencies = q.getResultList();
        return currencies;
    }

    private static BigDecimal toBigDecimal(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        return new BigDecimal(v.toString());
    }
}
