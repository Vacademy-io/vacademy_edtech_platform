package vacademy.io.admin_core_service.features.hr_compliance.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;

import java.util.List;

/**
 * Read-only query surface for the provision reports (Phase D: gratuity
 * provisioning + statutory bonus). Deliberately extends the marker
 * {@link Repository} rather than JpaRepository — no CRUD is exposed here;
 * writes to adjustments go through PayrollAdjustmentService only.
 */
@org.springframework.stereotype.Repository
public interface ComplianceProvisionQueryRepository extends Repository<PayrollAdjustment, String> {

    /**
     * Every employee profile of the institute, exited or not; the services
     * apply the report-specific status/date windows in code.
     */
    @Query("SELECT e FROM EmployeeProfile e WHERE e.instituteId = :instituteId")
    List<EmployeeProfile> findAllEmployeesByInstitute(@Param("instituteId") String instituteId);

    /**
     * Employee ids that already carry an adjustment under {@code code} for the
     * given payout period — consumed or not. Used for idempotent bonus
     * materialization: a consumed adjustment means the bonus was already paid,
     * an unconsumed one means it is already queued; both must be skipped.
     */
    @Query("SELECT a.employeeId FROM PayrollAdjustment a WHERE a.instituteId = :instituteId " +
            "AND a.year = :year AND a.month = :month AND a.code = :code")
    List<String> findAdjustmentEmployeeIdsForPeriod(@Param("instituteId") String instituteId,
                                                    @Param("year") Integer year,
                                                    @Param("month") Integer month,
                                                    @Param("code") String code);
}
