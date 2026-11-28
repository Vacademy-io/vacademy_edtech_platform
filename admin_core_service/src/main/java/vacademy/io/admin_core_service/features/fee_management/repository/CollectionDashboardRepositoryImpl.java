package vacademy.io.admin_core_service.features.fee_management.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class CollectionDashboardRepositoryImpl implements CollectionDashboardRepository {

    @PersistenceContext
    private EntityManager entityManager;

    private static final String SESSION_CLAUSE =
            "  AND sfp.cpo_id IN (" +
            "SELECT psl.cpo_id FROM package_session_learner_invitation_to_payment_option psl " +
            "JOIN package_session ps ON psl.package_session_id = ps.id " +
            "WHERE ps.session_id = :sessionId) ";

    private static String buildFeeTypeClause(List<String> feeTypeIds) {
        StringBuilder clause = new StringBuilder(
                "  AND sfp.asv_id IN (SELECT afv.id FROM assigned_fee_value afv WHERE afv.fee_type_id IN (");
        for (int i = 0; i < feeTypeIds.size(); i++) {
            if (i > 0) clause.append(",");
            clause.append(":ft").append(i);
        }
        return clause.append(")) ").toString();
    }

    // Reusable JOIN to the current adjustment history row. A RETRACTED event counts
    // as "no effective adjustment" — the CASE expressions below gate on event_type.
    private static final String ADJUSTMENT_JOIN =
            "LEFT JOIN student_fee_adjustment_history h " +
            "       ON h.id = sfp.current_adjustment_history_id ";

    // Signed delta to apply on top of amount_expected for an approved adjustment.
    private static final String ADJUSTMENT_DELTA =
            "(CASE " +
            "   WHEN h.event_type <> 'RETRACTED' AND h.resulting_status = 'APPROVED' AND h.adjustment_type = 'PENALTY' " +
            "     THEN COALESCE(h.amount, 0) " +
            "   WHEN h.event_type <> 'RETRACTED' AND h.resulting_status = 'APPROVED' AND h.adjustment_type = 'CONCESSION' " +
            "     THEN -1 * COALESCE(h.amount, 0) " +
            "   ELSE 0 " +
            " END)";

    private static final String NET_EXPECTED = "(sfp.amount_expected + " + ADJUSTMENT_DELTA + ")";

    private static final String BASE_WHERE =
            "FROM student_fee_payment sfp " +
            "JOIN complex_payment_option cpo ON sfp.cpo_id = cpo.id " +
            ADJUSTMENT_JOIN +
            "WHERE cpo.institute_id = :instituteId " +
            "  AND sfp.status NOT IN ('CANCELLED','DROPPED') ";

    private static final String SUMMARY_SELECT =
            "SELECT " +
            "  COALESCE(SUM(" + NET_EXPECTED + "),0), " +
            "  COALESCE(SUM(CASE WHEN sfp.due_date <= CURRENT_DATE " +
            "    THEN " + NET_EXPECTED + " ELSE 0 END),0), " +
            "  COALESCE(SUM(sfp.amount_paid),0), " +
            "  COALESCE(SUM(CASE " +
            "    WHEN sfp.due_date <= CURRENT_DATE " +
            "      AND sfp.status NOT IN ('WAIVED') " +
            "      AND sfp.amount_paid < " + NET_EXPECTED + " " +
            "    THEN " + NET_EXPECTED + " - sfp.amount_paid " +
            "    ELSE 0 END),0) ";

    // Class-wise breakdown resolves each student_fee_payment row to the actual
    // package_session the learner is enrolled in (via SSIGM, anchored on
    // user_plan_id, intersected with the CPO's psl mappings). LATERAL LIMIT 1
    // prevents fan-out when a single user_plan spans multiple SSIGM rows.
    // Bills with no resolvable package_session fall into an 'Unassigned' bucket
    // so totals stay consistent with the summary cards.
    private static final String CLASS_WISE_SELECT =
            "SELECT " +
            "  COALESCE(CAST(ps.id AS VARCHAR), 'UNASSIGNED'), " +
            "  COALESCE(" +
            "    pkg.package_name || ' - ' || l.level_name" +
            "      || COALESCE(' - ' || NULLIF(ps.name, ''), '')" +
            "      || ' - ' || s.session_name," +
            "    'Unassigned'" +
            "  ), " +
            "  COALESCE(SUM(" + NET_EXPECTED + "),0), " +
            "  COALESCE(SUM(CASE WHEN sfp.due_date <= CURRENT_DATE " +
            "    THEN " + NET_EXPECTED + " ELSE 0 END),0), " +
            "  COALESCE(SUM(sfp.amount_paid),0), " +
            "  COALESCE(SUM(CASE " +
            "    WHEN sfp.due_date <= CURRENT_DATE " +
            "      AND sfp.status NOT IN ('WAIVED') " +
            "      AND sfp.amount_paid < " + NET_EXPECTED + " " +
            "    THEN " + NET_EXPECTED + " - sfp.amount_paid " +
            "    ELSE 0 END),0) ";

    private static final String CLASS_WISE_FROM_WHERE =
            "FROM student_fee_payment sfp " +
            "JOIN complex_payment_option cpo ON sfp.cpo_id = cpo.id " +
            ADJUSTMENT_JOIN +
            "LEFT JOIN LATERAL ( " +
            "  SELECT ssigm.package_session_id " +
            "  FROM student_session_institute_group_mapping ssigm " +
            "  JOIN package_session_learner_invitation_to_payment_option psl_r " +
            "    ON psl_r.package_session_id = ssigm.package_session_id " +
            "   AND psl_r.cpo_id = sfp.cpo_id " +
            "   AND psl_r.status <> 'DELETED' " +
            "  WHERE ssigm.user_plan_id = sfp.user_plan_id " +
            "    AND ssigm.status = 'ACTIVE' " +
            "  ORDER BY ssigm.created_at ASC " +
            "  LIMIT 1 " +
            ") resolved ON true " +
            "LEFT JOIN package_session ps ON ps.id = resolved.package_session_id " +
            "LEFT JOIN package pkg ON pkg.id = ps.package_id " +
            "LEFT JOIN level l ON l.id = ps.level_id " +
            "LEFT JOIN session s ON s.id = ps.session_id " +
            "WHERE cpo.institute_id = :instituteId " +
            "  AND sfp.status NOT IN ('CANCELLED','DROPPED') ";

    private static final String CLASS_WISE_GROUP =
            "GROUP BY ps.id, pkg.package_name, l.level_name, ps.name, s.session_name " +
            "ORDER BY pkg.package_name NULLS LAST, l.level_name NULLS LAST, ps.name NULLS LAST";

    // An offline payment recorded with a mode (V577) is grouped by that mode (UPI, CHEQUE ...);
    // gateway payments and offline payments without one keep grouping by vendor.
    private static final String PAYMENT_MODE_KEY = "COALESCE(pl.payment_mode, pl.vendor)";

    private static final String PAYMENT_MODE_SELECT =
            "SELECT " + PAYMENT_MODE_KEY + ", COALESCE(SUM(sal.amount_allocated),0) ";

    private static final String PAYMENT_MODE_FROM =
            "FROM student_fee_allocation_ledger sal " +
            "JOIN payment_log pl ON sal.payment_log_id = pl.id " +
            "JOIN student_fee_payment sfp ON sal.student_fee_payment_id = sfp.id " +
            "JOIN complex_payment_option cpo ON sfp.cpo_id = cpo.id " +
            "WHERE cpo.institute_id = :instituteId " +
            "  AND sal.transaction_type NOT IN ('REFUND','BOUNCE_REVERSAL') " +
            "  AND pl.payment_status = 'PAID' ";

    private String buildOptionalClauses(String sessionId, boolean hasFeeTypes, List<String> feeTypeIds) {
        StringBuilder sb = new StringBuilder();
        if (sessionId != null) sb.append(SESSION_CLAUSE);
        if (hasFeeTypes) sb.append(buildFeeTypeClause(feeTypeIds));
        return sb.toString();
    }

    private void bindParams(Query q, String instituteId, String sessionId,
                            boolean hasFeeTypes, List<String> feeTypeIds) {
        q.setParameter("instituteId", instituteId);
        if (sessionId != null) q.setParameter("sessionId", sessionId);
        if (hasFeeTypes) {
            for (int i = 0; i < feeTypeIds.size(); i++) {
                q.setParameter("ft" + i, feeTypeIds.get(i));
            }
        }
    }

    @Override
    public Object[] getCollectionSummary(String instituteId, String sessionId,
                                         boolean hasFeeTypes, List<String> feeTypeIds) {
        String sql = SUMMARY_SELECT + BASE_WHERE + buildOptionalClauses(sessionId, hasFeeTypes, feeTypeIds);
        Query q = entityManager.createNativeQuery(sql);
        bindParams(q, instituteId, sessionId, hasFeeTypes, feeTypeIds);
        return (Object[]) q.getSingleResult();
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<Object[]> getClassWiseBreakdown(String instituteId, String sessionId,
                                                 boolean hasFeeTypes, List<String> feeTypeIds) {
        String sql = CLASS_WISE_SELECT + CLASS_WISE_FROM_WHERE
                + buildOptionalClauses(sessionId, hasFeeTypes, feeTypeIds) + CLASS_WISE_GROUP;
        Query q = entityManager.createNativeQuery(sql);
        bindParams(q, instituteId, sessionId, hasFeeTypes, feeTypeIds);
        return q.getResultList();
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<Object[]> getPaymentModeBreakdown(String instituteId, String sessionId,
                                                    boolean hasFeeTypes, List<String> feeTypeIds) {
        String sql = PAYMENT_MODE_SELECT + PAYMENT_MODE_FROM
                + buildOptionalClauses(sessionId, hasFeeTypes, feeTypeIds) + "GROUP BY " + PAYMENT_MODE_KEY;
        Query q = entityManager.createNativeQuery(sql);
        bindParams(q, instituteId, sessionId, hasFeeTypes, feeTypeIds);
        return q.getResultList();
    }
}
