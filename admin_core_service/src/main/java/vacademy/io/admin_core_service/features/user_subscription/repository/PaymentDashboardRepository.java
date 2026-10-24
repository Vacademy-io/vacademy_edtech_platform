package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardAgeingProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardBatchBalanceProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardBreakdownProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardNewPayersProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardPackageSessionProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.DashboardSeriesProjection;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Read-only aggregates behind the Payment Dashboard. Nothing here writes, and nothing here is
 * shared with the Manage Payments queries: those stay exactly as they are in
 * {@link UserPlanRepository}.
 *
 * <p>{@link #PAID_ROWS_CTE} is the billing summary's {@code paid} CTE (UserPlanRepository
 * getBillingSummary) with the SUM taken apart into rows: the same PAID filter, the same window on
 * {@code payment_log.created_at}, the same institute scoping (plan's invite, or an invoice of the
 * institute when no course filter is on), the same one-invoice-per-payment LATERAL. So any total
 * of its rows equals the Collected card for the same window and course filter.
 *
 * <p>Each row also carries what the dashboard slices by:
 * <ul>
 *   <li>{@code method}: the payment_log vendor (RAZORPAY, STRIPE, MANUAL, OFFLINE, …).</li>
 *   <li>{@code source_kind}: SUB_ORG (a sub-org plan), LIVE_SESSION (a live-session payment
 *       option or live-session invoice), MANUAL (recorded by an admin — MANUAL/OFFLINE vendor or
 *       an admin invoice), otherwise ONLINE (the learner paid at a checkout).</li>
 *   <li>{@code payer_id}: the plan's learner, else the log's, else the invoice's.</li>
 * </ul>
 *
 * <p>Batch attribution: a plan belongs to the package sessions its enroll invite is ACTIVE for.
 * An invite covering several sessions (a bundle) splits its money evenly between them, so the
 * batch rows still add up to the total; money with no session (institute-level options, invoices)
 * lands on a null batch — "Unassigned".
 *
 * <p>As in UserPlanRepository, the SQL text carries no comments (an apostrophe or colon inside a
 * native-query comment has broken production before), and every expression that uses a named
 * parameter is grouped by position (GROUP BY 1), because Spring binds each occurrence of a named
 * parameter as its own placeholder and Postgres would not see two copies as the same expression.
 */
public interface PaymentDashboardRepository extends JpaRepository<UserPlan, String> {

        String PAID_ROWS_CTE = """
                WITH paid_rows AS (
                  SELECT pl.id AS log_id,
                         pl.payment_amount AS amount,
                         """ + PaymentLogRepository.PAID_AT + """
                           AS paid_at,
                         UPPER(COALESCE(NULLIF(TRIM(pl.vendor), ''), 'OTHER')) AS method,
                         COALESCE(up.user_id, pl.user_id, inv.user_id) AS payer_id,
                         up.enroll_invite_id AS enroll_invite_id,
                         CASE WHEN up.source = 'SUB_ORG' THEN 'SUB_ORG'
                              WHEN po.source = 'LIVE_SESSION' OR inv.source = 'LIVE_SESSION' THEN 'LIVE_SESSION'
                              WHEN UPPER(COALESCE(pl.vendor, '')) IN ('MANUAL', 'OFFLINE')
                                   OR inv.source = 'ADMIN_MANUAL' THEN 'MANUAL'
                              ELSE 'ONLINE' END AS source_kind
                    FROM payment_log pl
                    LEFT JOIN user_plan up ON up.id = pl.user_plan_id
                    LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                    LEFT JOIN payment_option po ON po.id = up.payment_option_id
                    LEFT JOIN LATERAL (
                      SELECT i2.institute_id, i2.user_id, i2.source
                        FROM invoice_payment_log_mapping m
                        JOIN invoice i2 ON i2.id = m.invoice_id
                       WHERE m.payment_log_id = pl.id
                       ORDER BY CASE WHEN i2.institute_id = :instituteId THEN 0 ELSE 1 END,
                                i2.created_at, i2.id
                       LIMIT 1
                    ) inv ON true
                   WHERE pl.payment_status = 'PAID'
                     AND """ + PaymentLogRepository.PAID_AT + """
                       >= :startDate
                     AND """ + PaymentLogRepository.PAID_AT + """
                       <= :endDate
                     AND ((ei.institute_id = :instituteId
                           AND (:noPackageSessions = true OR EXISTS (
                                 SELECT 1
                                   FROM package_session_learner_invitation_to_payment_option psli
                                  WHERE psli.enroll_invite_id = ei.id
                                    AND psli.status = 'ACTIVE'
                                    AND psli.package_session_id IN (:packageSessionIds))))
                       OR (:noPackageSessions = true AND inv.institute_id = :instituteId))
                )
                """;

        /**
         * Even split of an invite between the package sessions it is ACTIVE for. Under a course or
         * batch filter only the selected sessions share it, so a bundle never puts part of a
         * filtered figure on a batch outside the filter, and the batch rows still add up to it.
         */
        String SESSION_WEIGHTS_CTE = """
                , session_weights AS (
                  SELECT d.enroll_invite_id,
                         d.package_session_id,
                         1.0 / COUNT(*) OVER (PARTITION BY d.enroll_invite_id) AS w
                    FROM (SELECT DISTINCT psli.enroll_invite_id, psli.package_session_id
                            FROM package_session_learner_invitation_to_payment_option psli
                            JOIN enroll_invite wei ON wei.id = psli.enroll_invite_id
                           WHERE psli.status = 'ACTIVE'
                             AND wei.institute_id = :instituteId
                             AND (:noPackageSessions = true
                                  OR psli.package_session_id IN (:packageSessionIds))) d
                )
                """;

        /**
         * Collected in the window, sliced four ways: TOTAL (one row), SOURCE, METHOD and BATCH
         * (package session, null = unassigned; bundle money split evenly).
         */
        @Query(value = PAID_ROWS_CTE + SESSION_WEIGHTS_CTE + """
                SELECT 'TOTAL' AS dimension, CAST(NULL AS varchar) AS bucketKey,
                       COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS payments,
                       COUNT(DISTINCT payer_id) AS payers
                  FROM paid_rows
                UNION ALL
                SELECT 'SOURCE', source_kind, SUM(amount), COUNT(*), COUNT(DISTINCT payer_id)
                  FROM paid_rows GROUP BY source_kind
                UNION ALL
                SELECT 'METHOD', method, SUM(amount), COUNT(*), COUNT(DISTINCT payer_id)
                  FROM paid_rows GROUP BY method
                UNION ALL
                SELECT 'BATCH', sw.package_session_id, SUM(r.amount * COALESCE(sw.w, 1)), COUNT(*),
                       COUNT(DISTINCT r.payer_id)
                  FROM paid_rows r
                  LEFT JOIN session_weights sw ON sw.enroll_invite_id = r.enroll_invite_id
                 GROUP BY sw.package_session_id
                """, nativeQuery = true)
        List<DashboardBreakdownProjection> collectedBreakdown(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds);

        /** Collected per calendar month (yyyy-MM) in the admin's time zone. */
        @Query(value = PAID_ROWS_CTE + """
                SELECT TO_CHAR(paid_at AT TIME ZONE 'UTC' AT TIME ZONE :timeZone, 'YYYY-MM') AS bucket,
                       SUM(amount) AS amount, COUNT(*) AS payments, COUNT(DISTINCT payer_id) AS payers
                  FROM paid_rows
                 GROUP BY 1
                 ORDER BY 1
                """, nativeQuery = true)
        List<DashboardSeriesProjection> collectedByMonth(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("timeZone") String timeZone);

        /** Collected per calendar day (yyyy-MM-dd) in the admin's time zone. */
        @Query(value = PAID_ROWS_CTE + """
                SELECT TO_CHAR(paid_at AT TIME ZONE 'UTC' AT TIME ZONE :timeZone, 'YYYY-MM-DD') AS bucket,
                       SUM(amount) AS amount, COUNT(*) AS payments, COUNT(DISTINCT payer_id) AS payers
                  FROM paid_rows
                 GROUP BY 1
                 ORDER BY 1
                """, nativeQuery = true)
        List<DashboardSeriesProjection> collectedByDay(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("timeZone") String timeZone);

        /**
         * Learners whose FIRST payment (over [startDate, endDate], normally all time) falls in the
         * current and in the comparison window.
         */
        @Query(value = PAID_ROWS_CTE + """
                , firsts AS (
                  SELECT payer_id, MIN(paid_at) AS first_at
                    FROM paid_rows
                   WHERE payer_id IS NOT NULL
                   GROUP BY payer_id
                )
                SELECT COUNT(*) FILTER (WHERE first_at >= :currentFrom AND first_at <= :currentTo) AS currentCount,
                       COUNT(*) FILTER (WHERE first_at >= :previousFrom AND first_at <= :previousTo) AS previousCount
                  FROM firsts
                """, nativeQuery = true)
        DashboardNewPayersProjection countNewPayers(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("currentFrom") LocalDateTime currentFrom,
                        @Param("currentTo") LocalDateTime currentTo,
                        @Param("previousFrom") LocalDateTime previousFrom,
                        @Param("previousTo") LocalDateTime previousTo);

        /** Learners by the month (yyyy-MM, admin's time zone) of their first payment. */
        @Query(value = PAID_ROWS_CTE + """
                , firsts AS (
                  SELECT payer_id, MIN(paid_at) AS first_at
                    FROM paid_rows
                   WHERE payer_id IS NOT NULL
                   GROUP BY payer_id
                )
                SELECT TO_CHAR(first_at AT TIME ZONE 'UTC' AT TIME ZONE :timeZone, 'YYYY-MM') AS bucket,
                       0 AS amount, 0 AS payments, COUNT(*) AS payers
                  FROM firsts
                 WHERE first_at >= :fromDate
                 GROUP BY 1
                 ORDER BY 1
                """, nativeQuery = true)
        List<DashboardSeriesProjection> newPayersByMonth(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("timeZone") String timeZone,
                        @Param("fromDate") LocalDateTime fromDate);

        /**
         * Overdue and still-to-come per package session (null = unassigned), over the same live
         * obligations as the billing summary ({@link UserPlanRepository#DUE_OBLIGATION_CTES}).
         * Still to come is what upcomingAll counts: unpaid not-yet-due instalments and invoices,
         * plus subscription renewals within the horizon. So the rows add up to Due and upcomingAll.
         */
        @Query(value = UserPlanRepository.DUE_OBLIGATION_CTES + """
                , live_rows AS (
                  SELECT o.user_plan_id, o.user_id, o.is_plan, o.overdue,
                         GREATEST(o.outstanding - o.overdue, 0)
                           + CASE WHEN o.kind = 'SUBSCRIPTION' THEN o.upcoming ELSE 0 END AS to_come
                    FROM obligations o
                   WHERE o.is_live
                )
                """ + SESSION_WEIGHTS_CTE + """
                SELECT sw.package_session_id AS packageSessionId,
                       COALESCE(SUM(r.overdue * COALESCE(sw.w, 1)), 0) AS overdue,
                       COALESCE(SUM(r.to_come * COALESCE(sw.w, 1)), 0) AS stillToCome,
                       COUNT(DISTINCT r.user_id) FILTER (WHERE r.overdue > 0 OR r.to_come > 0) AS learners
                  FROM live_rows r
                  LEFT JOIN user_plan lup ON r.is_plan AND lup.id = r.user_plan_id
                  LEFT JOIN session_weights sw ON sw.enroll_invite_id = lup.enroll_invite_id
                 GROUP BY sw.package_session_id
                """, nativeQuery = true)
        List<DashboardBatchBalanceProjection> balancesByBatch(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays);

        /**
         * The Due figure split by how late it is: each overdue instalment by its own due date, a
         * lapsed renewal by its period end, an unpaid invoice by its due date (UNDATED when it has
         * none). Same live obligations as the Due card, so the buckets add up to it.
         */
        @Query(value = UserPlanRepository.DUE_OBLIGATION_CTES + """
                , overdue_rows AS (
                  SELECT l.user_id,
                         CURRENT_DATE - sfp.due_date AS days_late,
                         GREATEST(sfp.amount_expected - COALESCE(sfp.amount_paid, 0), 0) AS amount
                    FROM obligations l
                    JOIN student_fee_payment sfp ON sfp.user_plan_id = l.user_plan_id
                   WHERE l.is_live
                     AND l.kind = 'CPO'
                     AND sfp.institute_id = :instituteId
                     AND sfp.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
                     AND COALESCE(sfp.amount_paid, 0) < sfp.amount_expected
                     AND sfp.due_date < CURRENT_DATE
                  UNION ALL
                  SELECT l.user_id, CURRENT_DATE - CAST(sub.end_date AS date), l.overdue
                    FROM obligations l
                    JOIN user_plan sub ON sub.id = l.user_plan_id
                   WHERE l.is_live
                     AND l.kind = 'SUBSCRIPTION'
                     AND l.overdue > 0
                  UNION ALL
                  SELECT l.user_id, CURRENT_DATE - l.next_due_date, l.overdue
                    FROM obligations l
                   WHERE l.is_live
                     AND l.kind = 'INVOICE'
                     AND l.overdue > 0
                )
                SELECT CASE WHEN days_late IS NULL THEN 'UNDATED'
                            WHEN days_late <= 30 THEN 'D0_30'
                            WHEN days_late <= 60 THEN 'D31_60'
                            WHEN days_late <= 90 THEN 'D61_90'
                            ELSE 'D90_PLUS' END AS bucket,
                       SUM(amount) AS amount,
                       COUNT(DISTINCT user_id) AS learners,
                       MAX(days_late) AS oldestDays
                  FROM overdue_rows
                 WHERE amount > 0
                 GROUP BY 1
                """, nativeQuery = true)
        List<DashboardAgeingProjection> overdueAgeing(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays);

        /** Display names for the package sessions (batches) on the dashboard. */
        @Query(value = """
                SELECT ps.id AS packageSessionId,
                       ps.package_id AS packageId,
                       p.package_name AS packageName,
                       l.level_name AS levelName,
                       s.session_name AS sessionName
                  FROM package_session ps
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE ps.id IN (:ids)
                """, nativeQuery = true)
        List<DashboardPackageSessionProjection> packageSessionNames(@Param("ids") List<String> ids);
}
