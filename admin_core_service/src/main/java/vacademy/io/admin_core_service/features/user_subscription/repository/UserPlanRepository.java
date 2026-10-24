package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.user_subscription.dto.BalanceLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.InstalmentProgressProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.LearnerPlanBreakdownProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.MonthDueLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.OutstandingLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.UpcomingMonthProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDatesProjection;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.time.LocalDate;
import java.time.LocalDateTime;

public interface UserPlanRepository extends JpaRepository<UserPlan, String> {

    /**
     * Integrity check: plans that took money and are ACTIVE, whose learner holds no ACTIVE
     * enrolment anywhere in that plan's institute. Paid access that was never granted.
     *
     * <p>Scoped to the institute rather than to the plan's own mappings on purpose — access
     * legitimately moves between plan rows (plan change, abandoned-sibling reconciliation),
     * so "this plan has no mapping" alone is noisy, while "this learner is enrolled in
     * nothing here" is the condition that actually hurts a paying member.
     */
    @Query(value = """
            SELECT up.* FROM user_plan up
            JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
            WHERE up.status = 'ACTIVE'
              AND EXISTS (SELECT 1 FROM payment_log pl
                          WHERE pl.user_plan_id = up.id AND pl.payment_status = 'PAID')
              AND NOT EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                              WHERE m.user_id = up.user_id
                                AND m.institute_id = ei.institute_id
                                AND m.status = 'ACTIVE')
            """, nativeQuery = true)
    List<UserPlan> findPaidActivePlansWithoutEnrollment();

    /**
     * (userPlanId, currency) for a batch of plans, read straight off the joined
     * payment_plan row. Deliberately a projection rather than walking
     * {@code UserPlan.getPaymentPlan()}: that association is LAZY, so touching it from a
     * non-transactional read path is both an N+1 and a LazyInitializationException risk.
     */
    @Query(value = "SELECT up.id AS userPlanId, pp.currency AS currency " +
            "FROM user_plan up " +
            "JOIN payment_plan pp ON pp.id = up.plan_id " +
            "WHERE up.id IN (:userPlanIds)", nativeQuery = true)
    List<Object[]> findPlanCurrencyByUserPlanIds(@Param("userPlanIds") List<String> userPlanIds);

        @Query("SELECT ei.inviteCode FROM UserPlan up JOIN up.enrollInvite ei WHERE up.id = :userPlanId")
        Optional<String> findInviteCodeByUserPlanId(@Param("userPlanId") String userPlanId);

        /**
         * Used by {@code PackageSessionScheduler.emitMembershipExpiryReminders}
         * to find plans whose access is about to expire so the
         * MEMBERSHIP_EXPIRY workflow trigger can be fired. Filters:
         *   • status = 'ACTIVE'         — active plans only
         *   • end_date IS NOT NULL      — skip lifetime plans (validity=null)
         *   • end_date > :now           — not already expired
         *   • end_date <= :cutoff       — within the reminder window
         * Dedup (have we already notified this plan?) is handled at job time
         * by querying {@code workflow_execution.idempotency_key} — we do NOT
         * stamp a flag on the user_plan row.
         * Returns plans with their EnrollInvite eagerly fetched because the
         * job needs the institute_id off it to route the trigger correctly.
         */
        @Query("""
                SELECT up FROM UserPlan up
                LEFT JOIN FETCH up.enrollInvite ei
                WHERE up.status = 'ACTIVE'
                  AND up.endDate IS NOT NULL
                  AND up.endDate > :now
                  AND up.endDate <= :cutoff
                """)
        List<UserPlan> findActivePlansExpiringSoon(
                @Param("now") java.util.Date now,
                @Param("cutoff") java.util.Date cutoff);

        /**
         * Institute-scoped variant of {@link #findActivePlansExpiringSoon}, used by the
         * {@code fetch_expiring_memberships} workflow query. Scopes on ei.instituteId so a
         * workflow only ever sees its OWN institute's expiring plans (the un-scoped variant
         * above is safe only because its one caller reads institute_id off each row to route;
         * a workflow query must never see other tenants' plans).
         */
        @Query("""
                SELECT up FROM UserPlan up
                LEFT JOIN FETCH up.enrollInvite ei
                WHERE up.status = 'ACTIVE'
                  AND ei.instituteId = :instituteId
                  AND up.endDate IS NOT NULL
                  AND up.endDate > :now
                  AND up.endDate <= :cutoff
                """)
        List<UserPlan> findActivePlansExpiringSoonByInstitute(
                @Param("instituteId") String instituteId,
                @Param("now") java.util.Date now,
                @Param("cutoff") java.util.Date cutoff);

        @Query(value = """
                            SELECT DISTINCT up FROM UserPlan up
                            JOIN FETCH up.enrollInvite ei
                            LEFT JOIN FETCH up.paymentOption po
                            LEFT JOIN FETCH up.paymentPlan pp
                            WHERE up.userId = :userId
                              AND ei.instituteId = :instituteId
                              AND (:statuses IS NULL OR up.status IN :statuses)
                        """, countQuery = """
                            SELECT COUNT(up) FROM UserPlan up
                            JOIN up.enrollInvite ei
                            WHERE up.userId = :userId
                              AND ei.instituteId = :instituteId
                              AND (:statuses IS NULL OR up.status IN :statuses)
                        """)
        Page<UserPlan> findByUserIdAndInstituteIdWithFilters(
                        @Param("userId") String userId,
                        @Param("instituteId") String instituteId,
                        @Param("statuses") List<String> statuses,
                        Pageable pageable);

        /**
         * Used by LearnerPaymentMethodService to rewrite the Stripe
         * paymentMethodId inside json_payment_details after a learner updates
         * their card. EnrollInvite is fetched for the vendor/currency needed
         * to normalize legacy snapshot shapes; PaymentPlan for the amount.
         */
        @Query("""
                        SELECT DISTINCT up FROM UserPlan up
                        JOIN FETCH up.enrollInvite ei
                        LEFT JOIN FETCH up.paymentPlan pp
                        WHERE up.userId = :userId
                          AND ei.instituteId = :instituteId
                          AND up.status IN :statuses
                        """)
        List<UserPlan> findAllByUserIdAndInstituteIdAndStatusIn(
                        @Param("userId") String userId,
                        @Param("instituteId") String instituteId,
                        @Param("statuses") List<String> statuses);

        /** Newest plan a user holds on a given invite — sub-org registration payment retry. */
        Optional<UserPlan> findFirstByUserIdAndEnrollInviteIdOrderByCreatedAtDesc(
                        String userId, String enrollInviteId);

        Optional<UserPlan> findFirstByUserIdAndEnrollInviteIdAndCreatedAtAfterOrderByCreatedAtAsc(
                        String userId,
                        String enrollInviteId,
                        LocalDateTime createdAt);

        @Query(value = """
                            SELECT DISTINCT up.id,
                                   CASE
                                       WHEN up.end_date IS NULL THEN 'LIFETIME'
                                       WHEN up.end_date < CURRENT_TIMESTAMP THEN 'ENDED'
                                       ELSE 'ABOUT_TO_END'
                                   END as computedStatus,
                                   up.end_date as actualEndDate
                            FROM user_plan up
                            JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                            LEFT JOIN package_session_learner_invitation_to_payment_option ps_link ON ps_link.enroll_invite_id = ei.id AND ps_link.status = 'ACTIVE' AND ps_link.payment_option_id = up.payment_option_id
                            WHERE ei.institute_id = :instituteId

                            -- Explicit CAST to TIMESTAMP is still good practice for dynamic null checks
                            AND (CAST(:startDate AS TIMESTAMP) IS NULL OR up.end_date >= CAST(:startDate AS TIMESTAMP))
                            AND (CAST(:endDate AS TIMESTAMP) IS NULL OR up.end_date <= CAST(:endDate AS TIMESTAMP))

                            AND (
                                :#{#packageSessionIds == null || #packageSessionIds.isEmpty() ? 1 : 0} = 1
                                OR ps_link.package_session_id IN (:packageSessionIds)
                            )

                            AND (
                                :#{#statuses == null || #statuses.isEmpty() ? 1 : 0} = 1
                                OR
                                CASE
                                   WHEN up.end_date IS NULL THEN 'LIFETIME'
                                   WHEN up.end_date < CURRENT_TIMESTAMP THEN 'ENDED'
                                   ELSE 'ABOUT_TO_END'
                                END IN (:statuses)
                            )
                        """, countQuery = """
                            SELECT COUNT(DISTINCT up.id)
                            FROM user_plan up
                            JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                            LEFT JOIN package_session_learner_invitation_to_payment_option ps_link ON ps_link.enroll_invite_id = ei.id AND ps_link.status = 'ACTIVE' AND ps_link.payment_option_id = up.payment_option_id
                            WHERE ei.institute_id = :instituteId
                            AND (CAST(:startDate AS TIMESTAMP) IS NULL OR up.end_date >= CAST(:startDate AS TIMESTAMP))
                            AND (CAST(:endDate AS TIMESTAMP) IS NULL OR up.end_date <= CAST(:endDate AS TIMESTAMP))
                            AND (
                                :#{#packageSessionIds == null || #packageSessionIds.isEmpty() ? 1 : 0} = 1
                                OR ps_link.package_session_id IN (:packageSessionIds)
                            )
                            AND (
                                :#{#statuses == null || #statuses.isEmpty() ? 1 : 0} = 1
                                OR
                                CASE
                                   WHEN up.end_date IS NULL THEN 'LIFETIME'
                                   WHEN up.end_date < CURRENT_TIMESTAMP THEN 'ENDED'
                                   ELSE 'ABOUT_TO_END'
                                END IN (:statuses)
                            )
                        """, nativeQuery = true)
        Page<Object[]> findMembershipDetailsWithDynamicStatus(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") Timestamp startDate,
                        @Param("endDate") Timestamp endDate,
                        @Param("statuses") List<String> statuses,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        Pageable pageable);

        /**
         * Find UserPlan entities by IDs without loading payment logs (optimized for
         * membership details).
         * Uses EntityGraph to control which associations to fetch.
         */
        @EntityGraph(attributePaths = { "enrollInvite", "paymentOption", "paymentPlan" })
        @Query("SELECT up FROM UserPlan up WHERE up.id IN :ids")
        List<UserPlan> findByIdsWithoutPaymentLogs(@Param("ids") List<String> ids);

        Optional<UserPlan> findFirstByUserIdAndPaymentPlanIdAndStatus(String userId, String paymentPlanId,
                        String status);

        List<UserPlan> findAllByStatusIn(List<String> statuses);

        /**
         * Institute-scoped variant of {@link #findAllByStatusIn}, used by the
         * institute-gated renewal scheduler
         * ({@code PackageSessionScheduler.processPackageSessionRenewals}) so the
         * daily scan only ever loads plans belonging to institutes that opted in
         * via PAYMENT_SETTING — never the whole user_plan table. EnrollInvite is
         * fetched eagerly because downstream processing reads institute/invite
         * data off it.
         */
        @Query("""
                SELECT up FROM UserPlan up
                JOIN FETCH up.enrollInvite ei
                WHERE up.status IN :statuses
                  AND ei.instituteId IN :instituteIds
                """)
        List<UserPlan> findAllByStatusInAndInstituteIdIn(
                        @Param("statuses") List<String> statuses,
                        @Param("instituteIds") List<String> instituteIds);

        /**
         * Find active UserPlan for a sub-organization with payment plan loaded
         * Used to retrieve member count limits for sub-org enrollments
         */
        @EntityGraph(attributePaths = { "paymentPlan" })
        @Query("SELECT up FROM UserPlan up " +
                        "WHERE up.subOrgId = :subOrgId " +
                        "AND up.source = :source " +
                        "AND up.status = :status")
        Optional<UserPlan> findBySubOrgIdAndSourceAndStatus(
                        @Param("subOrgId") String subOrgId,
                        @Param("source") String source,
                        @Param("status") String status);

        /**
         * Find UserPlan for ROOT_ADMIN with payment plan loaded
         * Used to get member count limit from the ROOT_ADMIN who purchased the plan
         */
        @EntityGraph(attributePaths = { "paymentPlan" })
        @Query("SELECT up FROM UserPlan up " +
                        "WHERE up.userId = :userId " +
                        "AND up.subOrgId = :subOrgId " +
                        "AND up.source = :source " +
                        "AND up.status = :status")
        Optional<UserPlan> findByUserIdAndSubOrgIdAndSourceAndStatus(
                        @Param("userId") String userId,
                        @Param("subOrgId") String subOrgId,
                        @Param("source") String source,
                        @Param("status") String status);

        Optional<UserPlan> findTopByUserIdAndEnrollInviteIdAndStatusInOrderByEndDateDesc(
                        String userId,
                        String enrollInviteId,
                        List<String> statuses);

        // All of a user's plans for an enroll invite in the given statuses. Used to
        // reconcile abandoned duplicate checkout attempts (PENDING_FOR_PAYMENT siblings)
        // once one attempt is finally paid.
        List<UserPlan> findAllByUserIdAndEnrollInviteIdAndStatusIn(
                        String userId,
                        String enrollInviteId,
                        List<String> statuses);

        Optional<UserPlan> findTopByUserIdAndEnrollInviteIdAndStatusInAndIdNotInOrderByEndDateDesc(
                        String userId,
                        String enrollInviteId,
                        List<String> statuses,
                        List<String> userPlanIds);

        Optional<UserPlan> findTopByUserIdAndEnrollInviteIdAndStatusInAndIdNotInOrderByCreatedAtAsc(
                        String userId,
                        String enrollInviteId,
                        List<String> statuses,
                        List<String> userPlanIds);

        Optional<UserPlan> findTopByUserIdAndEnrollInviteIdAndStatusInOrderByCreatedAtAsc(
                        String userId,
                        String enrollInviteId,
                        List<String> statuses);

        Optional<UserPlan> findTopByUserIdAndPaymentOptionIdAndStatusInOrderByCreatedAtDesc(
                        String userId,
                        String paymentOptionId,
                        List<String> statuses);

        /**
         * Auto-charge scheduler due-query (V369 autopay). Returns ACTIVE plans
         * that have opted into autopay and whose next_charge_at has arrived.
         * Only plans with auto_renewal_enabled = true are ever selected, so
         * pre-existing (non-migrated) plans are never auto-charged. EnrollInvite +
         * PaymentPlan are fetched because the charge step needs the institute_id,
         * vendor and amount off them.
         */
        @Query("""
                SELECT up FROM UserPlan up
                LEFT JOIN FETCH up.enrollInvite ei
                LEFT JOIN FETCH up.paymentPlan pp
                WHERE up.status = 'ACTIVE'
                  AND up.autoRenewalEnabled = true
                  AND up.nextChargeAt IS NOT NULL
                  AND up.nextChargeAt <= :now
                """)
        List<UserPlan> findDueForRenewal(@Param("now") java.util.Date now);

        /**
         * Whether this learner has already CONSUMED a free trial at this institute.
         *
         * <p>"Consumed" means a previous trial that actually DELIVERED something — its window
         * has elapsed AND it either carried an enrolment or took a payment. Two separate traps
         * sit here, and both have bitten:
         * <ul>
         *   <li>A learner who retries checkout creates several trial plan rows in a few minutes
         *       (Nitika Maheshwari made four in seven). Rows whose window is still ahead are
         *       the same trial, not a second one — hence the end_date test.</li>
         *   <li>An ABANDONED row's window elapses too. Counting it would tell a learner who
         *       never completed a checkout, never got access and never attended a class that
         *       they had already used their free trial, and charge them full price for their
         *       first visit. The mapping/payment test is what keeps "abandoned, came back three
         *       weeks later" on the trial path, which is the intended happy flow.</li>
         * </ul>
         *
         * <p>Scoped to the institute rather than the invite: an institute offers one free
         * trial, and hopping to a different invite is exactly how a second one gets taken.
         */
        @Query("""
                SELECT COUNT(up) > 0 FROM UserPlan up
                WHERE up.userId = :userId
                  AND up.id <> :currentPlanId
                  AND up.isTrial = true
                  AND up.endDate IS NOT NULL
                  AND up.endDate < :now
                  AND up.enrollInvite.instituteId = :instituteId
                  AND (EXISTS (SELECT 1 FROM StudentSessionInstituteGroupMapping m
                               WHERE m.userPlanId = up.id)
                       OR EXISTS (SELECT 1 FROM PaymentLog pl
                                  WHERE pl.userPlan.id = up.id AND pl.paymentStatus = 'PAID'))
                """)
        boolean hasConsumedTrialAtInstitute(@Param("userId") String userId,
                @Param("instituteId") String instituteId,
                @Param("currentPlanId") String currentPlanId,
                @Param("now") java.util.Date now);

        /**
         * The same question for an institute that identifies learners by PHONE: has anyone on
         * this NUMBER already consumed a trial here, whatever account they used?
         *
         * <p>Matching on user_id alone is not enough where the number is the identity. The same
         * person routinely accumulates accounts — at SuchBliss four numbers already hold
         * consumed trials under more than one account, one of them across fourteen — so a
         * second free trial is available to anyone who signs up again. Compared on the last
         * ten digits of the digits-only number because stored values mix 918130434435, bare
         * ten-digit and non-Indian forms.
         *
         * <p>Same "actually delivered" rule as the user-id variant: an elapsed ABANDONED row
         * does not burn the trial, or a learner who never completed their first checkout would
         * be charged full price for a class they have never attended.
         *
         * <p>A learner whose own number is missing or shorter than ten digits matches nothing
         * and keeps their trial: an unidentifiable person must not be charged full price.
         */
        @Query(value = """
                SELECT EXISTS (
                    SELECT 1
                    FROM user_plan up
                    JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                    JOIN student s ON s.user_id = up.user_id
                    WHERE ei.institute_id = :instituteId
                      AND up.id <> :currentPlanId
                      AND up.is_trial = true
                      AND up.end_date IS NOT NULL
                      AND up.end_date < :now
                      AND (EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                                   WHERE m.user_plan_id = up.id)
                           OR EXISTS (SELECT 1 FROM payment_log pl
                                      WHERE pl.user_plan_id = up.id AND pl.payment_status = 'PAID'))
                      AND length(regexp_replace(coalesce(s.mobile_number, ''), '[^0-9]', '', 'g')) >= 10
                      AND right(regexp_replace(s.mobile_number, '[^0-9]', '', 'g'), 10) = (
                            SELECT right(regexp_replace(me.mobile_number, '[^0-9]', '', 'g'), 10)
                            FROM student me
                            WHERE me.user_id = :userId
                              AND length(regexp_replace(coalesce(me.mobile_number, ''), '[^0-9]', '', 'g')) >= 10
                            LIMIT 1)
                )
                """, nativeQuery = true)
        boolean hasConsumedTrialByPhone(@Param("userId") String userId,
                @Param("instituteId") String instituteId,
                @Param("currentPlanId") String currentPlanId,
                @Param("now") java.util.Date now);

        /**
         * As {@link #findDueForRenewal} but restricted to institutes that have authorised the
         * charge sweep (PAYMENT_SETTING.autopayChargeSchedulerEnabled). The sweep is a single
         * platform-wide cron, so without this scoping every institute with an armed plan is
         * charged the moment autopay is switched on for anyone.
         */
        @Query("""
                SELECT up FROM UserPlan up
                LEFT JOIN FETCH up.enrollInvite ei
                LEFT JOIN FETCH up.paymentPlan pp
                WHERE up.status = 'ACTIVE'
                  AND up.autoRenewalEnabled = true
                  AND up.nextChargeAt IS NOT NULL
                  AND up.nextChargeAt <= :now
                  AND ei.instituteId IN :instituteIds
                """)
        List<UserPlan> findDueForRenewalForInstitutes(@Param("now") java.util.Date now,
                        @Param("instituteIds") List<String> instituteIds);

        /**
         * Atomically CLAIM a plan for a renewal charge (multi-replica safe). The
         * daily scheduler fires on every replica, so before charging, each replica
         * runs this — only the one whose UPDATE actually flips next_charge_at→null
         * (rows-affected = 1) proceeds to charge; the rest see 0 and skip. Also
         * bumps the attempt counter + timestamp in the same atomic write so the
         * claim and dunning bookkeeping can't diverge.
         */
        /**
         * The obligations behind the Due / Upcoming cards, one row per enrolment plus one per
         * unpaid admin invoice. Shared by the summary, the Due learners list and the per-learner
         * breakdown so the three can never disagree about who owes what.
         *
         * The rule: <b>a learner owes money only when they have been granted access and an
         * obligation on that access is unpaid.</b> Which obligations exist depends on the plan:
         * <ul>
         *   <li><b>CPO</b> (custom instalments): each {@code student_fee_payment} row. Overdue once
         *       its due_date has passed; upcoming while it falls due within the horizon.</li>
         *   <li><b>SUBSCRIPTION</b>: the renewal. Overdue when the plan is still ACTIVE (access
         *       retained through dunning / grace) but its period end_date has passed — a failed
         *       autopay leaves exactly this state. Upcoming while the period ends within the
         *       horizon. The renewal charges the plan's list price, so that is the amount.</li>
         *   <li><b>Admin invoice</b>: unpaid and not REJECTED. Overdue past its due date.</li>
         *   <li><b>ONE_TIME</b> (and FREE / DONATION): never owed. A one-time purchase is binary —
         *       paid and enrolled, or not enrolled. There is no obligation to bill.</li>
         * </ul>
         *
         * What this deliberately leaves out, because each one used to be reported as debt:
         * <ul>
         *   <li>PENDING_FOR_PAYMENT plans — a checkout the learner opened and never finished. No
         *       access was granted, nothing is owed. ShikshaNation carried ₹5.9L of these, one
         *       learner alone holding 22 abandoned copies of the same plan.</li>
         *   <li>The coupon discount on a one-time plan — billing at {@code pp.actual_price} (the
         *       list price) reported the discount itself as outstanding on 47 fully paid learners.</li>
         *   <li>Cancelled / terminated / expired plans — access is gone, so is the obligation.</li>
         * </ul>
         *
         * Per-plan {@code paid} is what landed against that plan (CPO: the schedule's amount_paid;
         * one-time: PAID payment logs). It is informational — settlement is tracked by each source
         * itself (a paid instalment updates amount_paid, a settled renewal advances end_date, a paid
         * invoice gains a payment mapping), so nothing here nets learner-level payments against
         * learner-level bills the way the old query did.
         *
         * {@code activated_without_payment} flags a live, priced ONE_TIME plan with no PAID log: an
         * admin activated it by hand. That may be an offline payment nobody recorded or a free
         * grant; the card shows the count as a hygiene hint rather than guessing it is owed.
         * Sub-org learners are excluded — their practice pays at org level.
         *
         * <p>The invoice arm counts invoices raised against the institute directly. They carry no
         * user_plan and no package session, so they count only for the whole institute, never
         * inside a course-filtered view. REJECTED is a voided invoice: visible in the table
         * (struck through) but neither collected nor owed.
         *
         * <p>{@code cpo_sched}, {@code cpo_next} and {@code plan_paid} are MATERIALIZED, so each is
         * computed once per query. Postgres otherwise inlines a CTE referenced once, and when a date
         * window leaves few plans it estimates one row and puts the per-plan aggregate on the inner
         * side of a nested loop. On an institute with 58k payment logs that re-ran the whole PAID
         * aggregate once per plan: a one-year window took 60 to 90 s and the cards gave up; it now
         * takes a few seconds, with identical results on every query built on these CTEs.
         *
         * <p>The SQL text deliberately carries no comments: an apostrophe, quote, semicolon or
         * colon inside a native-query comment reaches the query parser and has broken production
         * before. Explain here, not there.
         */
        String DUE_OBLIGATION_CTES = """
                WITH cpo_sched AS MATERIALIZED (
                  SELECT sfp.user_plan_id,
                         SUM(sfp.amount_expected) AS expected,
                         SUM(COALESCE(sfp.amount_paid, 0)) AS paid,
                         COALESCE(SUM(GREATEST(sfp.amount_expected - COALESCE(sfp.amount_paid, 0), 0))
                           FILTER (WHERE sfp.due_date < CURRENT_DATE), 0) AS overdue,
                         COALESCE(SUM(GREATEST(sfp.amount_expected - COALESCE(sfp.amount_paid, 0), 0))
                           FILTER (WHERE sfp.due_date >= CURRENT_DATE
                                     AND sfp.due_date < CURRENT_DATE + (:upcomingDays * INTERVAL '1 day')), 0)
                           AS upcoming,
                         COUNT(*) FILTER (WHERE COALESCE(sfp.amount_paid, 0) < sfp.amount_expected)
                           AS pending_installments,
                         MIN(CAST(sfp.due_date AS date))
                           FILTER (WHERE COALESCE(sfp.amount_paid, 0) < sfp.amount_expected)
                           AS next_due_date,
                         COALESCE(SUM(GREATEST(sfp.amount_expected - COALESCE(sfp.amount_paid, 0), 0)), 0)
                           AS outstanding
                    FROM student_fee_payment sfp
                   WHERE sfp.institute_id = :instituteId
                     AND sfp.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
                   GROUP BY sfp.user_plan_id
                ), cpo_next AS MATERIALIZED (
                  SELECT u.user_plan_id, SUM(u.unpaid) AS next_due_amount
                    FROM (SELECT sfp.user_plan_id,
                                 CAST(sfp.due_date AS date) AS due_on,
                                 GREATEST(sfp.amount_expected - COALESCE(sfp.amount_paid, 0), 0) AS unpaid,
                                 MIN(CAST(sfp.due_date AS date)) OVER (PARTITION BY sfp.user_plan_id) AS first_due_on
                            FROM student_fee_payment sfp
                           WHERE sfp.institute_id = :instituteId
                             AND sfp.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
                             AND COALESCE(sfp.amount_paid, 0) < sfp.amount_expected) u
                   WHERE u.due_on = u.first_due_on
                   GROUP BY u.user_plan_id
                ), plan_paid AS MATERIALIZED (
                  SELECT pl.user_plan_id, SUM(pl.payment_amount) AS amt
                    FROM payment_log pl
                    JOIN user_plan up2 ON up2.id = pl.user_plan_id
                    JOIN enroll_invite ei2 ON ei2.id = up2.enroll_invite_id
                   WHERE pl.payment_status = 'PAID'
                     AND ei2.institute_id = :instituteId
                   GROUP BY pl.user_plan_id
                ), plan_obligations AS (
                  SELECT up.id AS user_plan_id,
                         up.user_id AS user_id,
                         ei.name AS course_name,
                         up.status AS plan_status,
                         CASE WHEN po.type = 'CPO' THEN 'CPO'
                              WHEN po.type = 'SUBSCRIPTION' THEN 'SUBSCRIPTION'
                              ELSE 'ONE_TIME' END AS kind,
                         CASE WHEN po.type = 'CPO' THEN 'Custom Installment'
                              WHEN ei.tag = 'SUB_ORG' THEN 'Sub-Org Admin'
                              WHEN ei.tag = 'SUBORG_LEARNER' THEN 'Sub-Org Learner'
                              WHEN po.type = 'SUBSCRIPTION' THEN 'Subscription'
                              WHEN po.source = 'LIVE_SESSION' THEN 'Live Class'
                              WHEN po.source = 'PACKAGE_SESSION' THEN 'Course / Package'
                              ELSE 'Enroll Invite' END AS payment_type,
                         (up.status = 'ACTIVE') AS is_live,
                         true AS is_plan,
                         CASE WHEN po.type = 'CPO' THEN COALESCE(cs.expected, 0)
                              ELSE COALESCE(pp.actual_price, 0) END AS billed,
                         CASE WHEN po.type = 'CPO' THEN COALESCE(cs.paid, 0)
                              WHEN po.type = 'SUBSCRIPTION' THEN 0
                              ELSE COALESCE(pd.amt, 0) END AS paid,
                         CASE WHEN up.status <> 'ACTIVE' THEN 0
                              WHEN po.type = 'CPO' THEN COALESCE(cs.overdue, 0)
                              WHEN po.type = 'SUBSCRIPTION'
                                   AND up.end_date IS NOT NULL
                                   AND up.end_date < CURRENT_TIMESTAMP THEN COALESCE(pp.actual_price, 0)
                              ELSE 0 END AS overdue,
                         CASE WHEN up.status <> 'ACTIVE' THEN 0
                              WHEN po.type = 'CPO' THEN COALESCE(cs.upcoming, 0)
                              WHEN po.type = 'SUBSCRIPTION'
                                   AND up.end_date >= CURRENT_TIMESTAMP
                                   AND up.end_date < CURRENT_TIMESTAMP + (:upcomingDays * INTERVAL '1 day')
                                   THEN COALESCE(pp.actual_price, 0)
                              ELSE 0 END AS upcoming,
                         (up.status = 'ACTIVE'
                            AND COALESCE(po.type, 'ONE_TIME') NOT IN ('CPO', 'SUBSCRIPTION', 'FREE', 'DONATION')
                            AND COALESCE(pp.actual_price, 0) > 0
                            AND COALESCE(pd.amt, 0) = 0
                            AND COALESCE(ei.tag, '') <> 'SUBORG_LEARNER'
                            AND COALESCE(up.source, 'USER') <> 'SUB_ORG') AS activated_without_payment,
                         COALESCE(cs.pending_installments, 0) AS pending_installments,
                         cs.next_due_date AS next_due_date,
                         UPPER(COALESCE(NULLIF(TRIM(pp.currency), ''),
                                        NULLIF(TRIM(ei.currency), ''))) AS currency,
                         up.created_at AS created_at,
                         CASE WHEN up.status <> 'ACTIVE' THEN 0
                              WHEN po.type = 'CPO' THEN COALESCE(cs.outstanding, 0)
                              WHEN po.type = 'SUBSCRIPTION'
                                   AND up.end_date IS NOT NULL
                                   AND up.end_date < CURRENT_TIMESTAMP THEN COALESCE(pp.actual_price, 0)
                              ELSE 0 END AS outstanding,
                         CASE WHEN up.status = 'ACTIVE' AND po.type = 'CPO' THEN cn.next_due_amount
                              ELSE NULL END AS next_due_amount
                    FROM user_plan up
                    JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                    LEFT JOIN payment_option po ON po.id = up.payment_option_id
                    LEFT JOIN payment_plan pp ON pp.id = up.plan_id
                    LEFT JOIN cpo_sched cs ON cs.user_plan_id = up.id
                    LEFT JOIN cpo_next cn ON cn.user_plan_id = up.id
                    LEFT JOIN plan_paid pd ON pd.user_plan_id = up.id
                   WHERE ei.institute_id = :instituteId
                     AND up.created_at >= :startDate
                     AND up.created_at <= :endDate
                     AND (:noPackageSessions = true OR EXISTS (
                           SELECT 1
                             FROM package_session_learner_invitation_to_payment_option psli
                            WHERE psli.enroll_invite_id = ei.id
                              AND psli.status = 'ACTIVE'
                              AND psli.package_session_id IN (:packageSessionIds)))
                ), invoice_obligations AS (
                  SELECT inv.id AS user_plan_id,
                         inv.user_id AS user_id,
                         'Invoice' AS course_name,
                         'PENDING_PAYMENT' AS plan_status,
                         'INVOICE' AS kind,
                         'User Invoice' AS payment_type,
                         true AS is_live,
                         false AS is_plan,
                         COALESCE(inv.total_amount, 0) AS billed,
                         0 AS paid,
                         CASE WHEN inv.due_date IS NULL OR inv.due_date < CURRENT_TIMESTAMP
                              THEN COALESCE(inv.total_amount, 0) ELSE 0 END AS overdue,
                         CASE WHEN inv.due_date >= CURRENT_TIMESTAMP
                                   AND inv.due_date < CURRENT_TIMESTAMP + (:upcomingDays * INTERVAL '1 day')
                              THEN COALESCE(inv.total_amount, 0) ELSE 0 END AS upcoming,
                         false AS activated_without_payment,
                         0 AS pending_installments,
                         CAST(inv.due_date AS date) AS next_due_date,
                         UPPER(NULLIF(TRIM(inv.currency), '')) AS currency,
                         inv.created_at AS created_at,
                         COALESCE(inv.total_amount, 0) AS outstanding,
                         COALESCE(inv.total_amount, 0) AS next_due_amount
                    FROM invoice inv
                   WHERE inv.institute_id = :instituteId
                     AND inv.created_at >= :startDate
                     AND inv.created_at <= :endDate
                     AND inv.status <> 'REJECTED'
                     AND :noPackageSessions = true
                     AND NOT EXISTS (SELECT 1 FROM invoice_payment_log_mapping um
                                      WHERE um.invoice_id = inv.id)
                ), obligations AS (
                  SELECT * FROM plan_obligations
                  UNION ALL
                  SELECT * FROM invoice_obligations
                )
                """;

        /**
         * Everything expected but not yet owed, one row per due date: the money behind
         * {@code upcomingAll} on the billing summary, split out so it can be grouped by month.
         * Appended to {@link #DUE_OBLIGATION_CTES}, so it prices exactly the same live plans.
         * <ul>
         *   <li><b>CPO</b>: each unpaid instalment dated today or later (or undated), at its unpaid
         *       remainder. Together they are the plan's outstanding minus its overdue.</li>
         *   <li><b>Invoice</b>: an unpaid invoice whose due date has not passed.</li>
         *   <li><b>Subscription</b>: a renewal inside the upcoming horizon, dated by the period end.</li>
         * </ul>
         * A one-time plan never appears, because it owes nothing. So the amounts add up to
         * {@code upcomingAll} and their distinct learners to {@code learnersUpcomingAll}.
         */
        String UPCOMING_DUES_CTES = """
                , upcoming_dues AS (
                  SELECT l.user_id,
                         sfp.due_date AS due_on,
                         GREATEST(sfp.amount_expected - COALESCE(sfp.amount_paid, 0), 0) AS amount
                    FROM obligations l
                    JOIN student_fee_payment sfp ON sfp.user_plan_id = l.user_plan_id
                   WHERE l.is_live
                     AND l.kind = 'CPO'
                     AND sfp.institute_id = :instituteId
                     AND sfp.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
                     AND COALESCE(sfp.amount_paid, 0) < sfp.amount_expected
                     AND (sfp.due_date IS NULL OR sfp.due_date >= CURRENT_DATE)
                  UNION ALL
                  SELECT l.user_id, l.next_due_date, l.outstanding - l.overdue
                    FROM obligations l
                   WHERE l.is_live
                     AND l.kind = 'INVOICE'
                     AND l.outstanding - l.overdue > 0
                  UNION ALL
                  SELECT l.user_id, CAST(sub.end_date AS date), l.upcoming
                    FROM obligations l
                    JOIN user_plan sub ON sub.id = l.user_plan_id
                   WHERE l.is_live
                     AND l.kind = 'SUBSCRIPTION'
                     AND l.upcoming > 0
                )
                """;

        /** Per learner, what {@link #UPCOMING_DUES_CTES} puts in [monthStart, monthEnd). */
        String IN_MONTH_CTE = """
                , in_month AS (
                  SELECT d.user_id, SUM(d.amount) AS amount, MIN(d.due_on) AS first_due_on
                    FROM upcoming_dues d
                   WHERE d.amount > 0
                     AND d.due_on >= :monthStart
                     AND d.due_on < :monthEnd
                   GROUP BY d.user_id
                )
                """;

        /**
         * Narrows a balances list (Due / Outstanding / one forecast month) to the learners the
         * search box matches, by the same student-row rule the payment records use
         * ({@link PaymentLogRepository#STUDENT_SEARCH_MATCH}). Correlates on {@code o.user_id}.
         *
         * Only ever added to a list and its count, never inside {@link #DUE_OBLIGATION_CTES}: the
         * cards above the list keep describing every learner while the list narrows.
         */
        String LEARNER_SEARCH_PREDICATE = """
                (:noSearchFilter = true OR EXISTS (
                      SELECT 1 FROM student sst
                       WHERE sst.user_id = o.user_id
                         AND """ + PaymentLogRepository.STUDENT_SEARCH_MATCH + """
                      ))
                """;

        /**
         * Every enrolment one learner holds at an institute, priced individually — the Due side
         * view.
         *
         * Deliberately NOT filtered by status. {@link #findOutstandingLearners} answers how much
         * is owed and so bills only live plans; this answers why, and an admin cannot check that
         * a cancelled enrolment was excluded if the row is missing entirely. {@code countsTowardsDue}
         * carries the same rule as the card — a live CPO or subscription plan (or invoice) — so the
         * rows that DO count always re-add to the figure on it. A one-time purchase is returned with
         * the flag off: it is shown so the admin sees what the learner holds, but it owes nothing.
         */
        @Query(value = DUE_OBLIGATION_CTES + """
                SELECT o.user_plan_id AS userPlanId,
                       o.course_name AS courseName,
                       o.plan_status AS planStatus,
                       o.payment_type AS paymentType,
                       o.billed AS billed,
                       o.paid AS paid,
                       o.overdue AS due,
                       o.upcoming AS upcoming,
                       (o.is_live AND o.kind IN ('CPO', 'SUBSCRIPTION', 'INVOICE')) AS countsTowardsDue,
                       o.currency AS currency
                  FROM obligations o
                 WHERE o.user_id = :userId
                 ORDER BY (o.is_live AND o.kind IN ('CPO', 'SUBSCRIPTION', 'INVOICE')) DESC,
                          o.overdue DESC, o.upcoming DESC, o.billed DESC, o.created_at DESC
                """, nativeQuery = true)
        List<LearnerPlanBreakdownProjection> findLearnerPlanBreakdown(
                        @Param("instituteId") String instituteId,
                        @Param("userId") String userId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays);

        /**
         * Collected / Due / Upcoming for the KPI cards.
         *
         * Collected is the PAID payment logs in the window — money that actually arrived. Due and
         * Upcoming come from {@link #DUE_OBLIGATION_CTES}: what learners with access still owe now,
         * and what falls due within the horizon. The two halves are independent by design — a
         * payment settles an obligation at its source (instalment, renewal, invoice), so there is
         * nothing to net here, and Total is simply collected + due.
         *
         * The PAID side is pre-aggregated and joined rather than looked up per plan: as a
         * correlated subquery this took 33 s on an institute with 8,380 live plans, 172 ms this way.
         *
         * <p>Two details of the {@code paid} CTE, explained here because the SQL text carries no
         * comments (an apostrophe, quote or colon inside a native-query comment has broken the
         * query parser in production before):
         * <ul>
         *   <li>ONE invoice per payment log. A single payment can be mapped to more than one invoice
         *       (duplicate invoices do get generated for the same payment), and joining the mapping
         *       table directly fanned that payment out into a row per invoice, so the sum counted
         *       the same money once per invoice. The LATERAL collapses it back to a single row,
         *       preferring an invoice belonging to the institute being queried so the scoping
         *       predicate can never drop a payment that is also mapped to another institute.</li>
         *   <li>The ORDER BY inside that LATERAL uses a CASE rather than a boolean DESC: in Postgres
         *       DESC means NULLS FIRST, so a NULL institute_id would outrank the wanted institute
         *       and silently drop the payment. The id is a tie-break so the pick is deterministic.</li>
         *   <li>An invoice carries no package session, so invoice payments count only for the whole
         *       institute and never leak into a course-filtered view.</li>
         * </ul>
         */
        @Query(value = DUE_OBLIGATION_CTES + """
                , paid AS (
                  SELECT SUM(pl.payment_amount) AS amt, COUNT(*) AS cnt
                    FROM payment_log pl
                    LEFT JOIN user_plan up ON up.id = pl.user_plan_id
                    LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                    LEFT JOIN LATERAL (
                      SELECT i2.institute_id, i2.user_id
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
                ), live AS (
                  SELECT * FROM obligations WHERE is_live
                ), inst_mix AS (
                  SELECT COUNT(*) AS live_plans,
                         COUNT(*) FILTER (WHERE ipo.type = 'CPO') AS cpo_plans
                    FROM user_plan iu
                    JOIN enroll_invite iei ON iei.id = iu.enroll_invite_id
                    LEFT JOIN payment_option ipo ON ipo.id = iu.payment_option_id
                   WHERE iei.institute_id = :instituteId
                     AND iu.status = 'ACTIVE'
                )
                SELECT (SELECT COALESCE(amt, 0) FROM paid) AS collected,
                       (SELECT COALESCE(SUM(overdue), 0) FROM live) AS due,
                       (SELECT COALESCE(SUM(upcoming), 0) FROM live) AS upcoming,
                       (SELECT COUNT(DISTINCT user_id) FROM live WHERE overdue > 0) AS learnersOwing,
                       (SELECT COUNT(DISTINCT user_id) FROM live WHERE upcoming > 0) AS learnersUpcoming,
                       (SELECT COUNT(*) FROM live WHERE is_plan) AS planCount,
                       (SELECT cpo_plans FROM inst_mix) AS instalmentPlanCount,
                       (SELECT live_plans FROM inst_mix) AS livePlanCount,
                       (SELECT COUNT(*) FROM live WHERE activated_without_payment)
                         AS activatedWithoutPaymentCount,
                       (SELECT COALESCE(SUM(outstanding), 0) FROM live) AS outstanding,
                       (SELECT COUNT(DISTINCT user_id) FROM live WHERE outstanding > 0) AS learnersOutstanding,
                       (SELECT COALESCE(SUM(GREATEST(outstanding - overdue, 0)
                                            + CASE WHEN kind = 'SUBSCRIPTION' THEN upcoming ELSE 0 END), 0)
                          FROM live) AS upcomingAll,
                       (SELECT COUNT(DISTINCT user_id) FROM live
                         WHERE outstanding - overdue > 0 OR (kind = 'SUBSCRIPTION' AND upcoming > 0))
                         AS learnersUpcomingAll,
                       (SELECT CAST(MIN(next_due_date) AS varchar) FROM live
                         WHERE next_due_date >= CURRENT_DATE AND outstanding - overdue > 0) AS nextDueDate,
                       EXISTS (SELECT 1 FROM cpo_sched cs JOIN user_plan cu ON cu.id = cs.user_plan_id
                                WHERE cu.status = 'ACTIVE') AS usesInstallments,
                       (SELECT currency FROM live WHERE currency IS NOT NULL
                         GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1) AS currency
                """, nativeQuery = true)
        BillingSummaryProjection getBillingSummary(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays);

        /**
         * The learners behind the Due card: who owes money now, how much, what falls due
         * next, and (for CPO) their instalment position. Built on the same
         * {@link #DUE_OBLIGATION_CTES}, so these rows always add up to the card above them.
         *
         * A learner appears only while something is overdue; upcoming alone does not list them —
         * that is money expected, not money owed.
         */
        @Query(value = DUE_OBLIGATION_CTES + """
                SELECT o.user_id AS userId,
                       (array_agg(o.course_name ORDER BY o.overdue DESC, o.upcoming DESC))[1] AS courseName,
                       (array_agg(o.payment_type ORDER BY o.overdue DESC, o.upcoming DESC))[1] AS paymentType,
                       (array_agg(o.plan_status ORDER BY o.overdue DESC, o.upcoming DESC))[1] AS planStatus,
                       SUM(o.billed) AS billed,
                       SUM(o.paid) AS paid,
                       SUM(o.overdue) AS due,
                       SUM(o.upcoming) AS upcoming,
                       COUNT(*) FILTER (WHERE o.is_plan) AS planCount,
                       SUM(o.pending_installments) AS pendingInstallments,
                       MIN(o.next_due_date) AS nextDueDate,
                       MAX(o.currency) AS currency
                  FROM obligations o
                 WHERE o.is_live
                   AND """ + LEARNER_SEARCH_PREDICATE + """
                 GROUP BY o.user_id
                HAVING SUM(o.overdue) > 0
                 ORDER BY due DESC
                """, countQuery = DUE_OBLIGATION_CTES + """
                SELECT COUNT(*)
                  FROM (SELECT o.user_id
                          FROM obligations o
                         WHERE o.is_live
                           AND """ + LEARNER_SEARCH_PREDICATE + """
                         GROUP BY o.user_id
                        HAVING SUM(o.overdue) > 0) owing
                """, nativeQuery = true)
        Page<OutstandingLearnerProjection> findOutstandingLearners(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays,
                        @Param("noSearchFilter") boolean noSearchFilter,
                        @Param("searchString") String searchString,
                        @Param("searchPhoneDigits") String searchPhoneDigits,
                        Pageable pageable);

        /**
         * The learners behind the "Outstanding" card: everyone with a balance still to collect on
         * a live enrolment, whatever its due date — soonest next installment first. The Due list
         * above only holds learners with something already overdue, so an institute whose
         * installments all fall due next quarter saw an empty list and a zero card while lakhs
         * were still to come in.
         *
         * Same {@link #DUE_OBLIGATION_CTES} as the Due list, so a learner row reconciles with the
         * card; {@code nextDueAmount} is what falls due on {@code nextDueDate}.
         */
        @Query(value = DUE_OBLIGATION_CTES + """
                SELECT o.user_id AS userId,
                       (array_agg(o.course_name ORDER BY o.outstanding DESC))[1] AS courseName,
                       (array_agg(o.payment_type ORDER BY o.outstanding DESC))[1] AS paymentType,
                       (array_agg(o.plan_status ORDER BY o.outstanding DESC))[1] AS planStatus,
                       SUM(o.billed) AS billed,
                       SUM(o.paid) AS paid,
                       SUM(o.overdue) AS due,
                       SUM(o.upcoming) AS upcoming,
                       SUM(o.outstanding) AS outstanding,
                       COUNT(*) FILTER (WHERE o.is_plan) AS planCount,
                       SUM(o.pending_installments) AS pendingInstallments,
                       MIN(o.next_due_date) FILTER (WHERE o.outstanding > 0) AS nextDueDate,
                       (array_agg(o.next_due_amount ORDER BY o.next_due_date NULLS LAST)
                          FILTER (WHERE o.outstanding > 0))[1] AS nextDueAmount,
                       MAX(o.currency) AS currency
                  FROM obligations o
                 WHERE o.is_live
                   AND """ + LEARNER_SEARCH_PREDICATE + """
                 GROUP BY o.user_id
                HAVING SUM(o.outstanding) > 0
                 ORDER BY MIN(o.next_due_date) FILTER (WHERE o.outstanding > 0) NULLS LAST,
                          SUM(o.outstanding) DESC
                """, countQuery = DUE_OBLIGATION_CTES + """
                SELECT COUNT(*)
                  FROM (SELECT o.user_id
                          FROM obligations o
                         WHERE o.is_live
                           AND """ + LEARNER_SEARCH_PREDICATE + """
                         GROUP BY o.user_id
                        HAVING SUM(o.outstanding) > 0) owing
                """, nativeQuery = true)
        Page<BalanceLearnerProjection> findLearnersWithBalance(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays,
                        @Param("noSearchFilter") boolean noSearchFilter,
                        @Param("searchString") String searchString,
                        @Param("searchPhoneDigits") String searchPhoneDigits,
                        Pageable pageable);

        /**
         * The Upcoming card split by calendar month: how much falls due each month and from how
         * many learners. Built on {@link #UPCOMING_DUES_CTES}, so the months add up to
         * {@code upcomingAll}. Undated instalments come back as one row with a null month, last.
         */
        @Query(value = DUE_OBLIGATION_CTES + UPCOMING_DUES_CTES + """
                SELECT CAST(date_trunc('month', CAST(d.due_on AS timestamp)) AS date) AS monthStart,
                       SUM(d.amount) AS amount,
                       COUNT(DISTINCT d.user_id) AS learners,
                       COUNT(*) AS dues,
                       MIN(d.due_on) AS firstDueOn
                  FROM upcoming_dues d
                 WHERE d.amount > 0
                 GROUP BY 1
                 ORDER BY 1 NULLS LAST
                """, nativeQuery = true)
        List<UpcomingMonthProjection> getUpcomingByMonth(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays);

        /**
         * Billed / paid / overdue / outstanding across live instalment (CPO) plans only — the fee
         * progress of the instalment schedule. One-time and subscription plans are left out on
         * purpose: a one-time plan is paid or not enrolled, and a subscription has no schedule.
         */
        @Query(value = DUE_OBLIGATION_CTES + """
                SELECT COALESCE(SUM(o.billed), 0) AS billed,
                       COALESCE(SUM(o.paid), 0) AS paid,
                       COALESCE(SUM(o.overdue), 0) AS overdue,
                       COALESCE(SUM(o.outstanding), 0) AS outstanding,
                       COUNT(*) AS plans,
                       COUNT(DISTINCT o.user_id) AS learners
                  FROM obligations o
                 WHERE o.is_live
                   AND o.kind = 'CPO'
                """, nativeQuery = true)
        InstalmentProgressProjection getInstalmentProgress(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays);

        /**
         * The learners behind one month of {@link #getUpcomingByMonth}: everyone with something
         * falling due in [monthStart, monthEnd), soonest first, with how much. Same columns as
         * {@link #findLearnersWithBalance} plus {@code monthAmount}; the page total equals the
         * month's learner count.
         */
        @Query(value = DUE_OBLIGATION_CTES + UPCOMING_DUES_CTES + IN_MONTH_CTE + """
                SELECT o.user_id AS userId,
                       (array_agg(o.course_name ORDER BY o.outstanding DESC))[1] AS courseName,
                       (array_agg(o.payment_type ORDER BY o.outstanding DESC))[1] AS paymentType,
                       (array_agg(o.plan_status ORDER BY o.outstanding DESC))[1] AS planStatus,
                       SUM(o.billed) AS billed,
                       SUM(o.paid) AS paid,
                       SUM(o.overdue) AS due,
                       SUM(o.upcoming) AS upcoming,
                       SUM(o.outstanding) AS outstanding,
                       COUNT(*) FILTER (WHERE o.is_plan) AS planCount,
                       SUM(o.pending_installments) AS pendingInstallments,
                       MIN(o.next_due_date) FILTER (WHERE o.outstanding > 0) AS nextDueDate,
                       (array_agg(o.next_due_amount ORDER BY o.next_due_date NULLS LAST)
                          FILTER (WHERE o.outstanding > 0))[1] AS nextDueAmount,
                       MAX(o.currency) AS currency,
                       MAX(m.amount) AS monthAmount
                  FROM obligations o
                  JOIN in_month m ON m.user_id = o.user_id
                 WHERE o.is_live
                   AND """ + LEARNER_SEARCH_PREDICATE + """
                 GROUP BY o.user_id
                 ORDER BY MIN(m.first_due_on), MAX(m.amount) DESC, o.user_id
                """, countQuery = DUE_OBLIGATION_CTES + UPCOMING_DUES_CTES + IN_MONTH_CTE + """
                SELECT COUNT(*) FROM in_month o
                 WHERE """ + LEARNER_SEARCH_PREDICATE, nativeQuery = true)
        Page<MonthDueLearnerProjection> findLearnersDueInMonth(
                        @Param("instituteId") String instituteId,
                        @Param("startDate") LocalDateTime startDate,
                        @Param("endDate") LocalDateTime endDate,
                        @Param("noPackageSessions") boolean noPackageSessions,
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("upcomingDays") int upcomingDays,
                        @Param("monthStart") LocalDate monthStart,
                        @Param("monthEnd") LocalDate monthEnd,
                        @Param("noSearchFilter") boolean noSearchFilter,
                        @Param("searchString") String searchString,
                        @Param("searchPhoneDigits") String searchPhoneDigits,
                        Pageable pageable);

        /**
         * Enrolment date and next due date for a page of plans, for the optional Enrolled on and
         * Next due columns on the payment list.
         *
         * <p>Enrolled on is when the learner joined the batch: the stored {@code enrolled_date} on
         * the batch mapping linked to this plan, and failing that on the learner's mapping for a
         * batch of the plan's invite. So a pending or failed renewal by an existing member shows the
         * date they joined. Only mappings where the learner actually got in count (ACTIVE /
         * INACTIVE / TERMINATED / EXPIRED). An invite, a pending approval, or the DELETED
         * placeholder a checkout leaves behind is not an enrolment, so someone who never got in
         * has no date.
         *
         * <p>Mappings are reached through the plan's user (indexed); student_session_institute_group_mapping
         * has no index on user_plan_id, and filtering on it directly scanned the whole table.
         *
         * <p>Next due follows the Due / Upcoming rules of {@link #DUE_OBLIGATION_CTES}. Only an
         * ACTIVE plan owes anything. For an instalment plan it is the first instalment not yet fully
         * paid, and for a priced subscription it is the end of the paid period (a free one owes
         * nothing, as on the Due tab). One-time plans are never due.
         */
        @Query(value = """
                WITH plans AS (
                  SELECT up.id, up.user_id, up.enroll_invite_id, up.status, up.end_date, po.type,
                         COALESCE(pp.actual_price, 0) AS price
                    FROM user_plan up
                    LEFT JOIN payment_option po ON po.id = up.payment_option_id
                    LEFT JOIN payment_plan pp ON pp.id = up.plan_id
                   WHERE up.id IN (:userPlanIds)
                ), linked AS (
                  SELECT p.id AS user_plan_id, MIN(s.enrolled_date) AS enrolled_date
                    FROM plans p
                    JOIN student_session_institute_group_mapping s
                      ON s.user_id = p.user_id
                     AND s.user_plan_id = p.id
                   WHERE UPPER(s.status) IN ('ACTIVE', 'INACTIVE', 'TERMINATED', 'EXPIRED')
                   GROUP BY p.id
                ), by_batch AS (
                  SELECT p.id AS user_plan_id, MIN(s.enrolled_date) AS enrolled_date
                    FROM plans p
                    JOIN package_session_learner_invitation_to_payment_option psli
                      ON psli.enroll_invite_id = p.enroll_invite_id
                    JOIN student_session_institute_group_mapping s
                      ON s.package_session_id = psli.package_session_id
                     AND s.user_id = p.user_id
                   WHERE UPPER(s.status) IN ('ACTIVE', 'INACTIVE', 'TERMINATED', 'EXPIRED')
                   GROUP BY p.id
                ), next_instalment AS (
                  SELECT sfp.user_plan_id, MIN(CAST(sfp.due_date AS date)) AS due_on
                    FROM student_fee_payment sfp
                   WHERE sfp.user_plan_id IN (:userPlanIds)
                     AND sfp.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
                     AND COALESCE(sfp.amount_paid, 0) < sfp.amount_expected
                   GROUP BY sfp.user_plan_id
                )
                SELECT p.id AS userPlanId,
                       COALESCE(l.enrolled_date, b.enrolled_date) AS enrolledDate,
                       CASE WHEN p.status = 'ACTIVE' AND p.type = 'CPO' THEN ni.due_on END AS nextInstalmentDue,
                       CASE WHEN p.status = 'ACTIVE' AND p.type = 'SUBSCRIPTION' AND p.price > 0
                            THEN p.end_date END AS renewalDue
                  FROM plans p
                  LEFT JOIN linked l ON l.user_plan_id = p.id
                  LEFT JOIN by_batch b ON b.user_plan_id = p.id
                  LEFT JOIN next_instalment ni ON ni.user_plan_id = p.id
                """, nativeQuery = true)
        List<UserPlanDatesProjection> findPlanDates(@Param("userPlanIds") List<String> userPlanIds);

        @org.springframework.transaction.annotation.Transactional
        @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true)
        @Query("""
                UPDATE UserPlan up
                   SET up.nextChargeAt = null,
                       up.renewalAttemptCount = (CASE WHEN up.renewalAttemptCount IS NULL
                                                      THEN 0 ELSE up.renewalAttemptCount END) + 1,
                       up.lastRenewalAttemptAt = :now
                 WHERE up.id = :id AND up.nextChargeAt IS NOT NULL
                """)
        int claimForRenewal(@Param("id") String id, @Param("now") java.util.Date now);
}