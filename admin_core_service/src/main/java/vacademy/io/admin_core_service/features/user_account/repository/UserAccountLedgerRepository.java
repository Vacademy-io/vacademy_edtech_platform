package vacademy.io.admin_core_service.features.user_account.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.user_account.entity.UserAccountLedger;

import java.math.BigDecimal;
import java.util.List;

@Repository
public interface UserAccountLedgerRepository extends JpaRepository<UserAccountLedger, String> {

    Page<UserAccountLedger> findByUserIdAndInstituteIdOrderByCreatedAtDesc(
            String userId, String instituteId, Pageable pageable);

    /**
     * Net obligation raised: accruals + penalties MINUS reversals.
     *
     * <p>A DEBIT_REVERSAL is posted when an obligation is voided (e.g. an admin invoice is
     * cancelled). It has to cancel the original DEBIT_ACCRUAL out of "total accrued" — booking
     * it as a credit instead (which is what the reject path used to do) left the accrual
     * standing at its full amount and simultaneously reported the void as money received.
     */
    @Query("""
            SELECT COALESCE(SUM(CASE WHEN l.eventType = 'DEBIT_REVERSAL' THEN -l.amount ELSE l.amount END), 0)
            FROM UserAccountLedger l
            WHERE l.userId = :userId AND l.instituteId = :instituteId
              AND l.eventType IN ('DEBIT_ACCRUAL', 'DEBIT_PENALTY', 'DEBIT_REVERSAL')
            """)
    BigDecimal sumDebits(@Param("userId") String userId, @Param("instituteId") String instituteId);

    /**
     * Net money received: payments, waivers and adjustments MINUS reversals.
     *
     * <p>A CREDIT_REVERSAL is posted when an admin voids a payment that was recorded by
     * mistake. It takes that payment back out of "total paid" — the mirror of what
     * DEBIT_REVERSAL does for accruals in {@link #sumDebits}.
     */
    @Query("""
            SELECT COALESCE(SUM(CASE WHEN l.eventType = 'CREDIT_REVERSAL' THEN -l.amount ELSE l.amount END), 0)
            FROM UserAccountLedger l
            WHERE l.userId = :userId AND l.instituteId = :instituteId
              AND l.eventType IN ('CREDIT_PAYMENT', 'CREDIT_WAIVER', 'CREDIT_ADJUSTMENT', 'CREDIT_REVERSAL')
            """)
    BigDecimal sumCredits(@Param("userId") String userId, @Param("instituteId") String instituteId);

    /** Every row of one event type booked against a payment log — used to reverse its credits. */
    List<UserAccountLedger> findByReferenceIdAndEventType(String referenceId, String eventType);

    /**
     * Currency this learner's ledger is denominated in, newest entry first. Every row for a
     * (user, institute) pair is in the same currency in practice, so the newest one is the
     * answer; the summary used to report a hard-coded "INR" regardless, which is what showed
     * AUD balances with a rupee sign in the payment-history tab.
     */
    @Query("""
            SELECT l.currency
            FROM UserAccountLedger l
            WHERE l.userId = :userId AND l.instituteId = :instituteId
              AND l.currency IS NOT NULL
            ORDER BY l.createdAt DESC
            """)
    List<String> findLedgerCurrencies(@Param("userId") String userId,
                                      @Param("instituteId") String instituteId,
                                      Pageable pageable);

    /**
     * Net obligation whose due date has already passed (reversals subtracted, same as
     * {@link #sumDebits}). The caller turns this into "Past Due" by subtracting the credits
     * collected so far — every allocation path in the product settles oldest-due-first
     * (FIFO), so credits consume past-due obligations before upcoming ones.
     *
     * <p>This replaced a per-source {@code NOT EXISTS} correlated subquery that only ever
     * worked when the credit happened to carry the SAME source_type/source_id as the debit.
     * It never did for fee installments (accruals are per STUDENT_FEE_PAYMENT, payments are
     * booked against the USER_PLAN), so Past Due never cleared; and where the sources DID
     * match, any payment — even ₹1 of a ₹10,000 bill — cleared the whole row.
     */
    @Query("""
            SELECT COALESCE(SUM(CASE WHEN l.eventType = 'DEBIT_REVERSAL' THEN -l.amount ELSE l.amount END), 0)
            FROM UserAccountLedger l
            WHERE l.userId = :userId AND l.instituteId = :instituteId
              AND l.eventType IN ('DEBIT_ACCRUAL', 'DEBIT_PENALTY', 'DEBIT_REVERSAL')
              AND l.dueDate IS NOT NULL
              AND l.dueDate < CURRENT_DATE
            """)
    BigDecimal sumPastDueDebits(@Param("userId") String userId, @Param("instituteId") String instituteId);

    /**
     * Fee plans whose installments were created before the ledger existed (e.g. brought in
     * by a data migration), as figures for the Account Summary. One row of six numbers:
     *
     * <ol>
     *   <li>fee accrued — SUM(amount_expected) of the plan installments (live plans only; a
     *       dead plan accrues only what it actually collected, mirroring PLAN_CANCELLED)</li>
     *   <li>fee paid — SUM(amount_paid)</li>
     *   <li>fee past due — the accrued part whose due date has passed</li>
     *   <li>ledger debits, 5. ledger credits, 6. ledger past-due debits already booked
     *       against those plans (their installments or the plan itself)</li>
     * </ol>
     *
     * <p>A plan counts as pre-ledger when its base obligation was never booked: no
     * STUDENT_FEE_PAYMENT / USER_PLAN accrual once split moves are netted out. A split
     * reverses X on the source row (CPO_SPLIT) and accrues X on the new row
     * (STUDENT_FEE_PAYMENT), so on a pre-ledger plan the pair nets to zero.
     *
     * <p>Such a plan has only partial ledger rows (new payments, discount and split deltas),
     * so the caller swaps those rows for the installment figures. Without it, the first
     * payment recorded on a migrated plan made the summary show Accrued 0 / Due 0.
     * The caller only does this for a learner who has ledger rows at all.
     */
    @Query(value = """
            WITH plan_sfp AS (
                SELECT sfp.user_plan_id, sfp.id AS sfp_id,
                       COALESCE(sfp.amount_expected, 0) AS expected,
                       COALESCE(sfp.amount_paid, 0) AS paid,
                       sfp.due_date,
                       up.status IN ('ACTIVE', 'PENDING_FOR_PAYMENT') AS live
                FROM student_fee_payment sfp
                JOIN complex_payment_option cpo ON cpo.id = sfp.cpo_id
                JOIN user_plan up ON up.id = sfp.user_plan_id
                WHERE sfp.user_id = :userId
                  AND COALESCE(sfp.institute_id, cpo.institute_id) = :instituteId
            ),
            plan_ledger AS (
                SELECT l.event_type, l.source_type, l.amount, l.due_date, x.user_plan_id
                FROM user_account_ledger l
                JOIN (SELECT user_plan_id, sfp_id AS src FROM plan_sfp
                      UNION
                      SELECT user_plan_id, user_plan_id AS src FROM plan_sfp) x ON x.src = l.source_id
                WHERE l.user_id = :userId AND l.institute_id = :instituteId
            ),
            pre_ledger AS (
                SELECT DISTINCT p.user_plan_id FROM plan_sfp p
                WHERE COALESCE((
                    SELECT SUM(CASE
                                   WHEN pl.event_type = 'DEBIT_ACCRUAL'
                                        AND pl.source_type IN ('STUDENT_FEE_PAYMENT', 'USER_PLAN', 'CPO_SPLIT')
                                       THEN pl.amount
                                   WHEN pl.event_type = 'DEBIT_REVERSAL' AND pl.source_type = 'CPO_SPLIT'
                                       THEN -pl.amount
                                   ELSE 0 END)
                    FROM plan_ledger pl WHERE pl.user_plan_id = p.user_plan_id), 0) <= 0
            ),
            fee AS (
                SELECT p.*, CASE WHEN p.live THEN p.expected ELSE p.paid END AS accrued
                FROM plan_sfp p JOIN pre_ledger r ON r.user_plan_id = p.user_plan_id
            ),
            booked AS (
                SELECT pl.*,
                       CASE WHEN pl.event_type IN ('DEBIT_ACCRUAL', 'DEBIT_PENALTY') THEN pl.amount
                            WHEN pl.event_type = 'DEBIT_REVERSAL' THEN -pl.amount ELSE 0 END AS debit,
                       CASE WHEN pl.event_type IN ('CREDIT_PAYMENT', 'CREDIT_WAIVER', 'CREDIT_ADJUSTMENT') THEN pl.amount
                            WHEN pl.event_type = 'CREDIT_REVERSAL' THEN -pl.amount ELSE 0 END AS credit
                FROM plan_ledger pl JOIN pre_ledger r ON r.user_plan_id = pl.user_plan_id
            )
            SELECT (SELECT COALESCE(SUM(accrued), 0) FROM fee),
                   (SELECT COALESCE(SUM(paid), 0) FROM fee),
                   (SELECT COALESCE(SUM(accrued), 0) FROM fee WHERE due_date < CURRENT_DATE),
                   (SELECT COALESCE(SUM(debit), 0) FROM booked),
                   (SELECT COALESCE(SUM(credit), 0) FROM booked),
                   (SELECT COALESCE(SUM(debit), 0) FROM booked WHERE due_date < CURRENT_DATE)
            """, nativeQuery = true)
    List<Object[]> sumPreLedgerFeePlans(@Param("userId") String userId, @Param("instituteId") String instituteId);

    /** Whether this learner has any ledger row at all at the institute. */
    boolean existsByUserIdAndInstituteId(String userId, String instituteId);

    boolean existsBySourceTypeAndSourceIdAndEventType(String sourceType, String sourceId, String eventType);

    /**
     * Idempotency probe for money events keyed on the originating PaymentLog. Both the
     * gateway webhook and the enrollment-confirmation path can fire for the same payment;
     * without this a single payment would be credited twice.
     */
    boolean existsByReferenceIdAndEventType(String referenceId, String eventType);

    /**
     * Total already booked for one (sourceType, sourceId, eventType) triple. Used by the CPO
     * discount sync to work out the DELTA it still owes the ledger: the discount recompute
     * runs from scratch on every edit, so posting the full discount each time would stack
     * duplicate reversals on an append-only table.
     */
    @Query("""
            SELECT COALESCE(SUM(l.amount), 0)
            FROM UserAccountLedger l
            WHERE l.sourceType = :sourceType AND l.sourceId = :sourceId AND l.eventType = :eventType
            """)
    BigDecimal sumBySourceAndEventType(@Param("sourceType") String sourceType,
                                      @Param("sourceId") String sourceId,
                                      @Param("eventType") String eventType);

    /**
     * What one fee bill currently stands at on the ledger: accruals minus reversals, over every
     * source type that posts against it (the bill itself, discounts, splits, cancellation).
     */
    @Query("SELECT COALESCE(SUM(CASE WHEN l.eventType = 'DEBIT_ACCRUAL' THEN l.amount "
            + "WHEN l.eventType = 'DEBIT_REVERSAL' THEN -l.amount ELSE 0 END), 0) "
            + "FROM UserAccountLedger l WHERE l.sourceId = :sourceId")
    BigDecimal debitNetBySourceId(@Param("sourceId") String sourceId);
}
