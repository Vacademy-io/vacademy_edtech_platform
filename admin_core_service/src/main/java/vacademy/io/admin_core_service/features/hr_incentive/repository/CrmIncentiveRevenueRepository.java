package vacademy.io.admin_core_service.features.hr_incentive.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;

/**
 * Read-only revenue attribution query for CRM incentives (Phase F3).
 *
 * <p>The SQL is a faithful reproduction of the canonical per-counsellor collected-revenue
 * query in {@code features/audience/service/RevenueReportService.java} (CONV_CTE + PAID_CTE +
 * REVENUE_BY_COUNSELLOR_SQL) — that file stays the single narrative source for the
 * revenue-recognition product decision (a payment_log row counts only when
 * payment_status='PAID' AND the paying user is an institute lead whose
 * user_lead_profile.conversion_status='CONVERTED'; counsellor resolved as the latest
 * ENQUIRY linked_users row for the lead's representative response, falling back to
 * assigned_counselor_id). Two mechanical deviations, semantics unchanged:
 * <ul>
 *   <li>{@code :scopeCsv} is wrapped in {@code CAST(... AS text)} so PostgreSQL can type the
 *       always-null bind coming through Hibernate (HR staff see the whole institute, so this
 *       feature always passes {@code null} = no counsellor filter).</li>
 *   <li>Result columns are aliased camelCase for the Spring Data interface projection.</li>
 * </ul>
 *
 * <p>Declared over {@link PayrollAdjustment} only to satisfy Spring Data's domain-type
 * requirement; the native query never touches that table.
 */
public interface CrmIncentiveRevenueRepository extends Repository<PayrollAdjustment, String> {

    // Copied from RevenueReportService.CONV_CTE (see class javadoc for the two mechanical tweaks).
    String CONV_CTE = """
            conv AS (
                SELECT ulp.user_id,
                       COALESCE(ulp.best_source_type, ar.source_type, 'UNKNOWN') AS source_type,
                       COALESCE(lu.user_id, ulp.assigned_counselor_id)           AS counsellor_id
                FROM user_lead_profile ulp
                LEFT JOIN audience_response ar ON ar.id = ulp.best_score_response_id
                LEFT JOIN LATERAL (
                    SELECT lu2.user_id FROM linked_users lu2
                    WHERE lu2.source = 'ENQUIRY' AND lu2.source_id = ar.enquiry_id
                    ORDER BY lu2.created_at DESC LIMIT 1
                ) lu ON true
                WHERE ulp.institute_id = :instituteId
                  AND ulp.conversion_status = 'CONVERTED'
                  AND (CAST(:scopeCsv AS text) IS NULL OR COALESCE(lu.user_id, ulp.assigned_counselor_id) = ANY(STRING_TO_ARRAY(CAST(:scopeCsv AS text), ',')))
            )
            """;

    // Copied from RevenueReportService.PAID_CTE.
    String PAID_CTE = """
            paid AS (
                SELECT c.user_id, c.source_type, c.counsellor_id,
                       pl.payment_amount, pl.created_at
                FROM payment_log pl
                JOIN conv c ON c.user_id = pl.user_id
                WHERE pl.payment_status = 'PAID'
                  AND pl.payment_amount IS NOT NULL
                  AND pl.created_at >= :fromTs AND pl.created_at < :toTs
            )
            """;

    // Copied from RevenueReportService.REVENUE_BY_COUNSELLOR_SQL (camelCase aliases for projection).
    String REVENUE_BY_COUNSELLOR_SQL = "WITH " + CONV_CTE + ", " + PAID_CTE + """
            SELECT paid.counsellor_id                    AS counsellorId,
                   COALESCE(SUM(paid.payment_amount), 0) AS revenue,
                   COUNT(DISTINCT paid.user_id)          AS payingLeads,
                   COUNT(*)                              AS payments
            FROM paid
            WHERE paid.counsellor_id IS NOT NULL
            GROUP BY paid.counsellor_id
            ORDER BY revenue DESC
            """;

    /**
     * Per-counsellor collected revenue for a [fromTs, toTs) UTC window.
     * Pass {@code scopeCsv = null} (no counsellor filter — institute-wide).
     */
    @Query(value = REVENUE_BY_COUNSELLOR_SQL, nativeQuery = true)
    List<CounsellorRevenueProjection> findCounsellorRevenue(
            @Param("instituteId") String instituteId,
            @Param("fromTs") Timestamp fromTs,
            @Param("toTs") Timestamp toTs,
            @Param("scopeCsv") String scopeCsv);

    /**
     * Idempotency probe for materialization: employees already holding a CRM_INCENTIVE
     * adjustment for the payout period — matched on source OR code so a manually keyed
     * CRM_INCENTIVE row also blocks a double payout. Deliberately ignores
     * payrollEntryId (consumed state): consumed means already paid, so it must
     * still block re-materialization.
     */
    @Query("SELECT DISTINCT a.employeeId FROM PayrollAdjustment a "
            + "WHERE a.instituteId = :instituteId AND a.year = :year AND a.month = :month "
            + "AND (a.source = 'CRM_INCENTIVE' OR a.code = 'CRM_INCENTIVE')")
    List<String> findEmployeeIdsWithCrmIncentive(
            @Param("instituteId") String instituteId,
            @Param("year") Integer year,
            @Param("month") Integer month);

    interface CounsellorRevenueProjection {
        String getCounsellorId();

        BigDecimal getRevenue();

        Long getPayingLeads();

        Long getPayments();
    }
}
