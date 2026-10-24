package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogWithUserPlanProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.CombinedPaymentRowProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentStatusTotalProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.CollectionSummaryProjection;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface PaymentLogRepository extends JpaRepository<PaymentLog, String> {

  @Query(value = "SELECT * FROM payment_log WHERE CAST(payment_specific_data AS TEXT) LIKE CONCAT('%', :orderId, '%')", nativeQuery = true)
  List<PaymentLog> findAllByOrderIdInJson(@Param("orderId") String orderId);

  /**
   * Find all payment logs where the orderId matches within the
   * originalRequest JSON (order_id snake_case or orderId camelCase).
   * CASHFREE/PhonePe webhooks send order_id; we store originalRequest with
   * orderId (camelCase) after order creation, so we match both.
   */
  @Query(value = "SELECT * FROM payment_log WHERE CAST(payment_specific_data AS TEXT) LIKE CONCAT('%\"order_id\":\"', :orderId, '\"%') OR CAST(payment_specific_data AS TEXT) LIKE CONCAT('%\"orderId\":\"', :orderId, '\"%')", nativeQuery = true)
  List<PaymentLog> findAllByOrderIdInOriginalRequest(@Param("orderId") String orderId);

  @Query("SELECT pl FROM PaymentLog pl WHERE pl.userPlan.id = :userPlanId ORDER BY pl.createdAt DESC")
  List<PaymentLog> findByUserPlanIdOrderByCreatedAtDesc(@Param("userPlanId") String userPlanId);

  @Query("SELECT CASE WHEN COUNT(pl) > 0 THEN true ELSE false END FROM PaymentLog pl "
      + "WHERE pl.userPlan.id = :userPlanId AND pl.paymentStatus = :paymentStatus")
  boolean existsByUserPlanIdAndPaymentStatus(@Param("userPlanId") String userPlanId,
      @Param("paymentStatus") String paymentStatus);

  @Query(value = """
            SELECT DISTINCT pl FROM PaymentLog pl
            JOIN FETCH pl.userPlan up
            JOIN FETCH up.enrollInvite ei
            LEFT JOIN FETCH up.paymentOption po
            LEFT JOIN FETCH up.paymentPlan pp
            WHERE ei.instituteId = :instituteId
              AND pl.createdAt >= :startDate
              AND pl.createdAt <= :endDate

              AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty() ? 1 : 0} = 1 OR pl.paymentStatus IN (:paymentStatuses))

              AND (:#{#userPlanStatuses == null || #userPlanStatuses.isEmpty() ? 1 : 0} = 1 OR up.status IN (:userPlanStatuses))

              AND (:#{#sources == null || #sources.isEmpty() ? 1 : 0} = 1 OR up.source IN (:sources))

              AND (:#{#enrollInviteIds == null || #enrollInviteIds.isEmpty() ? 1 : 0} = 1 OR ei.id IN (:enrollInviteIds))

              AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty() ? 1 : 0} = 1 OR EXISTS (
                    SELECT 1
                    FROM PackageSessionLearnerInvitationToPaymentOption psli
                    WHERE psli.enrollInvite.id = ei.id
                      AND psli.status = 'ACTIVE'
                      AND psli.packageSession.id IN (:packageSessionIds)
                  ))
              AND (:#{#userId == null ? 1 : 0} = 1 OR up.userId = :userId)
              AND NOT EXISTS (
                    SELECT 1
                    FROM PackageSessionLearnerInvitationToPaymentOption psli_int
                    WHERE psli_int.enrollInvite.id = ei.id
                      AND psli_int.packageSession.packageEntity.packageType IN ('DELIVERY_CHARGE', 'SECURITY_DEPOSIT')
                  )
            ORDER BY pl.createdAt DESC
      """, countQuery = """
      SELECT COUNT(pl) FROM PaymentLog pl
      JOIN pl.userPlan up
      JOIN up.enrollInvite ei
      WHERE ei.instituteId = :instituteId
        AND pl.createdAt >= :startDate
        AND pl.createdAt <= :endDate
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty() ? 1 : 0} = 1 OR pl.paymentStatus IN (:paymentStatuses))
        AND (:#{#userPlanStatuses == null || #userPlanStatuses.isEmpty() ? 1 : 0} = 1 OR up.status IN (:userPlanStatuses))
        AND (:#{#sources == null || #sources.isEmpty() ? 1 : 0} = 1 OR up.source IN (:sources))
        AND (:#{#enrollInviteIds == null || #enrollInviteIds.isEmpty() ? 1 : 0} = 1 OR ei.id IN (:enrollInviteIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty() ? 1 : 0} = 1 OR EXISTS (
              SELECT 1
              FROM PackageSessionLearnerInvitationToPaymentOption psli
              WHERE psli.enrollInvite.id = ei.id
                AND psli.status = 'ACTIVE'
                AND psli.packageSession.id IN (:packageSessionIds)
            ))
        AND (:#{#userId == null ? 1 : 0} = 1 OR up.userId = :userId)
        AND NOT EXISTS (
              SELECT 1
              FROM PackageSessionLearnerInvitationToPaymentOption psli_int
              WHERE psli_int.enrollInvite.id = ei.id
                AND psli_int.packageSession.packageEntity.packageType IN ('DELIVERY_CHARGE', 'SECURITY_DEPOSIT')
            )
      """)
  Page<PaymentLog> findPaymentLogIdsWithFilters(
      @Param("instituteId") String instituteId,
      @Param("startDate") LocalDateTime startDate,
      @Param("endDate") LocalDateTime endDate,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("userPlanStatuses") List<String> userPlanStatuses,
      @Param("sources") List<String> sources,
      @Param("enrollInviteIds") List<String> enrollInviteIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("userId") String userId,
      Pageable pageable);

  @Query("""
      SELECT DISTINCT pl FROM PaymentLog pl
      LEFT JOIN FETCH pl.userPlan up
      LEFT JOIN FETCH up.enrollInvite
      LEFT JOIN FETCH up.paymentOption po
      LEFT JOIN FETCH up.paymentPlan pp
      WHERE pl.id IN :ids
      ORDER BY pl.createdAt DESC
      """)
  List<PaymentLog> findPaymentLogsWithRelationshipsByIds(@Param("ids") List<String> ids);

  /**
   * Whether the learner row {@code sst} (a {@code student}) matches the free-text search: a name
   * or email containing it, or, when the search reads as a phone number, a mobile number
   * containing its digits. Phones compare digits-only, so spaces, dashes and a country code on
   * one side do not matter (see {@code PaymentLogService#phoneSearchDigits}).
   *
   * <p>Matched on admin_core's own student row rather than through the auth service, because the
   * auth lookup only returns users holding a role in the institute. Learners loaded by a
   * migration often hold none, so for them name, email and phone search found nobody at all.
   *
   * <p>The caller correlates it: {@code EXISTS (SELECT 1 FROM student sst WHERE sst.user_id = x
   * AND <this>)}. Binds {@code :searchString} and {@code :searchPhoneDigits}. Declared before its
   * users because an interface constant cannot refer forward.
   */
  String STUDENT_SEARCH_MATCH = """
        (sst.full_name ILIKE CONCAT('%', :searchString, '%')
          OR sst.email ILIKE CONCAT('%', :searchString, '%')
          OR (:searchPhoneDigits <> ''
              AND REGEXP_REPLACE(COALESCE(sst.mobile_number, ''), '[^0-9]', '', 'g')
                  LIKE CONCAT('%', :searchPhoneDigits, '%')))
        """;

  /**
   * When a payment counts as received, for every "collected in this window" figure: Manage
   * Payments (list, tiles, Collected card) and the Payment Dashboard.
   *
   * <p>{@code created_at} is when the row was written, {@code date} is the payment date. For
   * gateway payments and offline entries made the same day they agree ({@code date} is the UTC
   * day of {@code created_at}), so those rows keep their exact instant. They differ only when an
   * admin records a payment against an earlier date ("received 1 Jun", entered 23 Oct). Windowing
   * on {@code created_at} filed that money under the entry month, so a month total never matched
   * the institute's own books and a late entry silently moved revenue between months.
   *
   * <p>A back-dated row is placed at noon UTC of its date rather than midnight, so it stays on
   * that calendar day in any institute time zone within twelve hours of UTC (IST included).
   *
   * <p>The typed date is trusted only from ten years before the entry to the day after it (the
   * day after covers an IST entry made just past midnight, whose UTC day is still the previous
   * one). Typos exist in production -- year 0026 for 2026, 2010 for a 2026 entry -- and taking
   * those literally would drop real money out of every window, All time included.
   * Reads {@code pl}; the caller must alias payment_log as {@code pl}.
   */
  String PAID_AT = """
        (CASE WHEN pl.date IS NOT NULL AND pl.date <> CAST(pl.created_at AS date)
                   AND pl.date >= CAST(pl.created_at AS date) - 3650
                   AND pl.date <= CAST(pl.created_at AS date) + 1
              THEN CAST(pl.date AS timestamp) + INTERVAL '12 hours'
              ELSE pl.created_at END)""";

  /**
   * Combined paginated query: returns payment log IDs from both regular (via user_plan/enroll_invite)
   * and admin-created invoice paths (via invoice_payment_log_mapping).
   *
   * PostgreSQL cannot determine the type of a NULL List parameter in "? IS NULL" checks, so we use
   * typed boolean flags instead: when a filter flag is true the corresponding IN clause is skipped,
   * and the list param is always a non-null sentinel (e.g. "__none__") so the JDBC binding succeeds.
   * includeInvoiceLogs is false whenever a user-plan-only filter (plan status, enroll-invite,
   * package-session) is active — those cannot apply to invoice-path logs. A `sources` filter is
   * honored inside the invoice arm against invoice.source (LIVE_SESSION, ADMIN_INVOICE, ...), so
   * live-session payments stay visible/filterable.
   *
   * <p>Free-text search matches a payment when ANY of these hit: the payer (name/email/phone, on
   * their student row via {@link #STUDENT_SEARCH_MATCH}, or pre-resolved to :searchUserIds by the
   * caller through the auth service), the amount, the number of an invoice covering the payment,
   * or the name of the plan being paid for. Each subquery predicate is guarded by
   * {@code :noSearchFilter = false}, so they are constant-folded away entirely when nobody is
   * searching — an unsearched listing costs exactly what it did before. When searching, the
   * invoice and plan lookups are index-driven (idx_invoice_payment_log_mapping_payment_log_id and
   * the payment_plan primary key) and all of them run only over rows that already passed the
   * institute, date and status filters.
   */
  /**
   * Currency is picked the way the cards pick it: the first value that is actually a currency
   * code. `payment_log.currency` also holds blanks and junk ('string', 'N/A') from older callers,
   * and those have to fall through to the plan's or the invite's code rather than be reported as
   * the row's currency — a card drops an amount it cannot format, so taking the junk would quietly
   * lose the money instead of showing it in rupees.
   *
   * Both payment-log arms classify through the same joins on purpose. The row mapper loads
   * `paymentLog.getUserPlan()` for every row regardless of the arm it arrived on, so the arm that
   * reaches a log through an invoice has to read its plan too — otherwise it reports a different
   * status and currency for the same payment. That is also what keeps UNION de-duplicating: a log
   * with both a plan and an invoice appears in both arms, and UNION only collapses rows that match
   * on every column, not on id alone.
   *
   * The three arms this screen unions together: payment logs reached through a user plan,
   * payment logs reached through an invoice, and invoices raised but never paid against.
   *
   * <p>Held as one constant because the list, its count and the summary must filter on exactly
   * the same rows — the list and count used to carry separate copies of this SQL, so a filter
   * fixed in one could silently drift from the other. {@code row_status} / {@code row_amount}
   * are carried so the summary can aggregate without a fourth copy; the outer list query simply
   * ignores them. UNION (not UNION ALL) still de-duplicates on id, which is a primary key in
   * every arm, so the extra columns cannot change which rows survive.</p>
   */
  String COMBINED_PAYMENT_ROWS = """
        SELECT pl.id, pl.created_at, 'PAYMENT_LOG' AS row_type,
               CASE
                 WHEN pl.payment_status IS NULL THEN 'NOT_INITIATED'
                 WHEN pl.payment_status = 'PAID' THEN 'PAID'
                 WHEN pl.payment_status = 'VOIDED' THEN 'CANCELLED'
                 WHEN pl.payment_status = 'FAILED'
                      AND up.enroll_invite_id IS NOT NULL AND up.user_id IS NOT NULL
                      AND (SELECT nxt.status FROM user_plan nxt
                            WHERE nxt.user_id = up.user_id
                              AND nxt.enroll_invite_id = up.enroll_invite_id
                              AND nxt.created_at > up.created_at
                            ORDER BY nxt.created_at ASC LIMIT 1) = 'ACTIVE' THEN 'PAID'
                 WHEN pl.payment_status = 'FAILED' THEN 'FAILED'
                 WHEN pl.payment_status = 'PAYMENT_PENDING' AND pl.created_at IS NOT NULL
                      AND pl.created_at + make_interval(hours => CAST(:abandonedAfterHours AS int)) < NOW()
                      THEN 'ABANDONED'
                 ELSE pl.payment_status
               END AS row_status,
               pl.payment_amount AS row_amount,
               UPPER(COALESCE(
                   CASE WHEN pl.currency ~ '^[A-Za-z]{3}$' THEN pl.currency END,
                   CASE WHEN cpp.currency ~ '^[A-Za-z]{3}$' THEN cpp.currency END,
                   CASE WHEN ei.currency ~ '^[A-Za-z]{3}$' THEN ei.currency END,
                   '')) AS row_currency,
               CASE WHEN up.status IS NULL THEN true
                    WHEN UPPER(TRIM(up.status)) IN ('ACTIVE', 'PENDING_FOR_PAYMENT') THEN true
                    ELSE false END AS due_eligible
        FROM payment_log pl
        JOIN user_plan up ON pl.user_plan_id = up.id
        JOIN enroll_invite ei ON up.enroll_invite_id = ei.id
        LEFT JOIN payment_option po ON up.payment_option_id = po.id
        LEFT JOIN payment_plan cpp ON cpp.id = up.plan_id
        WHERE ei.institute_id = :instituteId
          AND """ + PAID_AT + """
            >= :startDate
          AND """ + PAID_AT + """
            <= :endDate
          AND (:noPaymentStatusFilter = true OR pl.payment_status IN (:paymentStatuses))
          AND (:noUserPlanStatusFilter = true OR up.status IN (:userPlanStatuses))
          AND (:noSourceFilter = true OR up.source IN (:sources))
          AND (:noEnrollInviteFilter = true OR ei.id IN (:enrollInviteIds))
          AND (:noPackageSessionFilter = true
                OR EXISTS (
                      SELECT 1 FROM package_session_learner_invitation_to_payment_option psli
                      WHERE psli.enroll_invite_id = ei.id AND psli.status = 'ACTIVE'
                        AND psli.package_session_id IN (:packageSessionIds))
                -- An invite reaches a batch through the payment-option mapping, but a learner
                -- reaches it by being enrolled, and the two do not always agree: bulk-loaded
                -- institutes carry the enrolment without ever writing the mapping, which left
                -- this filter matching nothing at all for them. Reading the enrolment as well
                -- costs a normal institute nothing -- it already matches on the line above.
                OR EXISTS (
                      SELECT 1 FROM student_session_institute_group_mapping psg
                      WHERE psg.user_plan_id = up.id
                        AND psg.package_session_id IN (:packageSessionIds)))
          AND (:userId IS NULL OR up.user_id = :userId)
          AND (:noSearchFilter = true
                OR (:noSearchUserIds = false AND pl.user_id IN (:searchUserIds))
                OR (:noSearchFilter = false AND EXISTS (
                      SELECT 1 FROM student sst
                      WHERE sst.user_id = pl.user_id
                        AND """ + STUDENT_SEARCH_MATCH + """
                      ))
                OR (:searchNumeric = true AND CAST(pl.payment_amount AS TEXT) LIKE CONCAT('%', :searchString, '%'))
                OR (:noSearchFilter = false AND EXISTS (
                      SELECT 1 FROM invoice_payment_log_mapping sm
                      JOIN invoice si ON si.id = sm.invoice_id
                      WHERE sm.payment_log_id = pl.id
                        AND si.institute_id = :instituteId
                        AND si.invoice_number ILIKE CONCAT('%', :searchString, '%')))
                OR (:noSearchFilter = false AND EXISTS (
                      SELECT 1 FROM payment_plan spp
                      WHERE spp.id = up.plan_id
                        AND spp.name ILIKE CONCAT('%', :searchString, '%'))))
          AND (:noPaymentTypeFilter = true OR (
                (:typeSubOrgAdmin = true AND ei.tag = 'SUB_ORG')
                OR (:typeSubOrgLearner = true AND ei.tag = 'SUBORG_LEARNER')
                OR (:typeLiveClass = true AND po.source = 'LIVE_SESSION')
                OR (:typeCourse = true AND po.source = 'PACKAGE_SESSION')
                OR (:typeCpo = true AND po.type = 'CPO')
                OR (:typeEnrollInvite = true AND ei.tag = 'DEFAULT')
          ))
          AND (:noPaymentPlanFilter = true OR EXISTS (
                SELECT 1 FROM payment_plan fpp
                WHERE fpp.id = up.plan_id AND fpp.name IN (:paymentPlanNames)))
          AND NOT EXISTS (
                SELECT 1 FROM package_session_learner_invitation_to_payment_option psli_int
                WHERE psli_int.enroll_invite_id = ei.id
                  AND psli_int.package_session_id IN (
                    SELECT ps.id FROM package_session ps
                    JOIN package pe ON ps.package_id = pe.id
                    WHERE pe.package_type IN ('DELIVERY_CHARGE', 'SECURITY_DEPOSIT')))
        UNION
        SELECT pl.id, pl.created_at, 'PAYMENT_LOG' AS row_type,
               CASE
                 WHEN pl.payment_status IS NULL THEN 'NOT_INITIATED'
                 WHEN pl.payment_status = 'PAID' THEN 'PAID'
                 WHEN pl.payment_status = 'VOIDED' THEN 'CANCELLED'
                 WHEN pl.payment_status = 'FAILED'
                      AND iup.enroll_invite_id IS NOT NULL AND iup.user_id IS NOT NULL
                      AND (SELECT nxt.status FROM user_plan nxt
                            WHERE nxt.user_id = iup.user_id
                              AND nxt.enroll_invite_id = iup.enroll_invite_id
                              AND nxt.created_at > iup.created_at
                            ORDER BY nxt.created_at ASC LIMIT 1) = 'ACTIVE' THEN 'PAID'
                 WHEN pl.payment_status = 'FAILED' THEN 'FAILED'
                 WHEN pl.payment_status = 'PAYMENT_PENDING' AND pl.created_at IS NOT NULL
                      AND pl.created_at + make_interval(hours => CAST(:abandonedAfterHours AS int)) < NOW()
                      THEN 'ABANDONED'
                 ELSE pl.payment_status
               END AS row_status,
               pl.payment_amount AS row_amount,
               UPPER(COALESCE(
                   CASE WHEN pl.currency ~ '^[A-Za-z]{3}$' THEN pl.currency END,
                   CASE WHEN ipp.currency ~ '^[A-Za-z]{3}$' THEN ipp.currency END,
                   CASE WHEN iei.currency ~ '^[A-Za-z]{3}$' THEN iei.currency END,
                   '')) AS row_currency,
               CASE WHEN iup.status IS NULL THEN true
                    WHEN UPPER(TRIM(iup.status)) IN ('ACTIVE', 'PENDING_FOR_PAYMENT') THEN true
                    ELSE false END AS due_eligible
        FROM payment_log pl
        LEFT JOIN user_plan iup ON pl.user_plan_id = iup.id
        LEFT JOIN enroll_invite iei ON iup.enroll_invite_id = iei.id
        LEFT JOIN payment_plan ipp ON ipp.id = iup.plan_id
        JOIN invoice_payment_log_mapping iplm ON pl.id = iplm.payment_log_id
        JOIN invoice i ON iplm.invoice_id = i.id
        WHERE :includeInvoiceLogs = true
          AND :noPaymentPlanFilter = true
          -- Same batch rule as the arm above. Without it a payment that happens to carry an
          -- invoice walked straight past the batch filter, so filtering by batch quietly showed
          -- rows from every other batch as well.
          AND (:noPackageSessionFilter = true
                OR EXISTS (
                      SELECT 1 FROM package_session_learner_invitation_to_payment_option psli2
                      WHERE psli2.enroll_invite_id = iei.id AND psli2.status = 'ACTIVE'
                        AND psli2.package_session_id IN (:packageSessionIds))
                OR EXISTS (
                      SELECT 1 FROM student_session_institute_group_mapping psg2
                      WHERE psg2.user_plan_id = iup.id
                        AND psg2.package_session_id IN (:packageSessionIds)))
          AND i.institute_id = :instituteId
          AND """ + PAID_AT + """
            >= :startDate
          AND """ + PAID_AT + """
            <= :endDate
          AND (:noPaymentStatusFilter = true OR pl.payment_status IN (:paymentStatuses))
          AND (:noSourceFilter = true OR i.source IN (:sources))
          AND (:userId IS NULL OR i.user_id = :userId)
          AND (:typeUserInvoice = false OR i.source = 'ADMIN_MANUAL')
          AND (:noSearchFilter = true
                OR (:noSearchUserIds = false AND i.user_id IN (:searchUserIds))
                OR (:noSearchFilter = false AND EXISTS (
                      SELECT 1 FROM student sst
                      WHERE sst.user_id = i.user_id
                        AND """ + STUDENT_SEARCH_MATCH + """
                      ))
                OR (:searchNumeric = true AND CAST(pl.payment_amount AS TEXT) LIKE CONCAT('%', :searchString, '%'))
                OR (:noSearchFilter = false AND i.invoice_number ILIKE CONCAT('%', :searchString, '%')))
        UNION
        -- Invoices that have been raised but never paid against. These have NO payment_log at all
        -- (one is only created when the learner initiates payment), so without this arm an invoice
        -- an admin raised is invisible on this screen until someone tries to pay it.
        SELECT i.id, i.created_at, 'INVOICE' AS row_type,
               CASE WHEN UPPER(i.status) = 'REJECTED' THEN 'CANCELLED'
                    ELSE 'NOT_INITIATED' END AS row_status,
               i.total_amount AS row_amount,
               UPPER(COALESCE(CASE WHEN i.currency ~ '^[A-Za-z]{3}$' THEN i.currency END, ''))
                 AS row_currency,
               true AS due_eligible
        FROM invoice i
        WHERE :includeUnpaidInvoices = true
          AND :noPaymentPlanFilter = true
          -- An invoice raised on its own belongs to no batch, so a batch filter cannot vouch
          -- for it and it drops out, exactly as it does under the plan filter.
          AND :noPackageSessionFilter = true
          AND i.institute_id = :instituteId
          AND i.created_at >= :startDate
          AND i.created_at <= :endDate
          AND NOT EXISTS (SELECT 1 FROM invoice_payment_log_mapping um WHERE um.invoice_id = i.id)
          AND (:noSourceFilter = true OR i.source IN (:sources))
          AND (:userId IS NULL OR i.user_id = :userId)
          AND (:typeUserInvoice = false OR i.source = 'ADMIN_MANUAL')
          AND (:noSearchFilter = true
                OR (:noSearchUserIds = false AND i.user_id IN (:searchUserIds))
                OR (:noSearchFilter = false AND EXISTS (
                      SELECT 1 FROM student sst
                      WHERE sst.user_id = i.user_id
                        AND """ + STUDENT_SEARCH_MATCH + """
                      ))
                OR (:searchNumeric = true AND CAST(i.total_amount AS TEXT) LIKE CONCAT('%', :searchString, '%'))
                OR (:noSearchFilter = false AND i.invoice_number ILIKE CONCAT('%', :searchString, '%')))
      """;

  /**
   * The KPI tile the admin has selected, applied to the already-classified rows. Kept outside
   * COMBINED_PAYMENT_ROWS so the summary can aggregate every bucket while the table shows one.
   *
   * A voided *payment* belongs to no tile, so it survives only under "All". A cancelled *invoice*
   * is deliberately not treated the same way: it keeps its long-standing place in the Pending tab,
   * which is where admins go to chase it. That asymmetry predates this query — it is carried over
   * from the filter this replaced, not introduced here.
   */
  String BUCKET_PREDICATE = """
      (:noBucketFilter = true OR (
       NOT (combined.row_status = 'CANCELLED' AND combined.row_type = 'PAYMENT_LOG') AND (
            (:bucketPaid = true AND combined.row_status = 'PAID')
         OR (:bucketFailed = true AND combined.row_status = 'FAILED')
         OR (:bucketAbandoned = true AND combined.row_status = 'ABANDONED')
         OR (:bucketPending = true AND combined.due_eligible = true
             AND combined.row_status NOT IN ('PAID', 'FAILED', 'ABANDONED')))))
      """;

  @Query(value = "SELECT combined.id AS rowId, combined.row_type AS rowType FROM ("
      + COMBINED_PAYMENT_ROWS + ") combined WHERE " + BUCKET_PREDICATE
      + " ORDER BY combined.created_at DESC",
      countQuery = "SELECT COUNT(*) FROM (" + COMBINED_PAYMENT_ROWS + ") combined WHERE "
          + BUCKET_PREDICATE,
      nativeQuery = true)
  Page<CombinedPaymentRowProjection> findCombinedPaymentLogIdsPaginated(
      @Param("instituteId") String instituteId,
      @Param("startDate") LocalDateTime startDate,
      @Param("endDate") LocalDateTime endDate,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("noPaymentStatusFilter") boolean noPaymentStatusFilter,
      @Param("userPlanStatuses") List<String> userPlanStatuses,
      @Param("noUserPlanStatusFilter") boolean noUserPlanStatusFilter,
      @Param("sources") List<String> sources,
      @Param("noSourceFilter") boolean noSourceFilter,
      @Param("enrollInviteIds") List<String> enrollInviteIds,
      @Param("noEnrollInviteFilter") boolean noEnrollInviteFilter,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("noPackageSessionFilter") boolean noPackageSessionFilter,
      @Param("userId") String userId,
      @Param("includeInvoiceLogs") boolean includeInvoiceLogs,
      @Param("includeUnpaidInvoices") boolean includeUnpaidInvoices,
      @Param("noPaymentTypeFilter") boolean noPaymentTypeFilter,
      @Param("typeSubOrgAdmin") boolean typeSubOrgAdmin,
      @Param("typeSubOrgLearner") boolean typeSubOrgLearner,
      @Param("typeLiveClass") boolean typeLiveClass,
      @Param("typeCourse") boolean typeCourse,
      @Param("typeCpo") boolean typeCpo,
      @Param("typeEnrollInvite") boolean typeEnrollInvite,
      @Param("typeUserInvoice") boolean typeUserInvoice,
      @Param("noSearchFilter") boolean noSearchFilter,
      @Param("noSearchUserIds") boolean noSearchUserIds,
      @Param("searchUserIds") List<String> searchUserIds,
      @Param("searchNumeric") boolean searchNumeric,
      @Param("searchString") String searchString,
      @Param("searchPhoneDigits") String searchPhoneDigits,
      @Param("paymentPlanNames") List<String> paymentPlanNames,
      @Param("noPaymentPlanFilter") boolean noPaymentPlanFilter,
      @Param("abandonedAfterHours") long abandonedAfterHours,
      @Param("noBucketFilter") boolean noBucketFilter,
      @Param("bucketPaid") boolean bucketPaid,
      @Param("bucketPending") boolean bucketPending,
      @Param("bucketAbandoned") boolean bucketAbandoned,
      @Param("bucketFailed") boolean bucketFailed,
      Pageable pageable);

  /**
   * Per-status totals for exactly the rows {@link #findCombinedPaymentLogIdsPaginated} would
   * return, so the Manage Payments tiles and tab counts describe the whole filtered set without
   * the page having to download it. Takes the same arguments as the list — anything that narrows
   * one narrows the other, because both are built from {@link #COMBINED_PAYMENT_ROWS}.
   */
  @Query(value = "SELECT combined.row_status AS status, combined.row_currency AS currency,"
      + " combined.due_eligible AS dueEligible, COUNT(*) AS rowCount,"
      + " COALESCE(SUM(combined.row_amount), 0) AS totalAmount FROM ("
      + COMBINED_PAYMENT_ROWS + ") combined"
      + " GROUP BY combined.row_status, combined.row_currency, combined.due_eligible",
      nativeQuery = true)
  List<PaymentStatusTotalProjection> aggregateCombinedPaymentLogs(

      @Param("instituteId") String instituteId,
      @Param("startDate") LocalDateTime startDate,
      @Param("endDate") LocalDateTime endDate,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("noPaymentStatusFilter") boolean noPaymentStatusFilter,
      @Param("userPlanStatuses") List<String> userPlanStatuses,
      @Param("noUserPlanStatusFilter") boolean noUserPlanStatusFilter,
      @Param("sources") List<String> sources,
      @Param("noSourceFilter") boolean noSourceFilter,
      @Param("enrollInviteIds") List<String> enrollInviteIds,
      @Param("noEnrollInviteFilter") boolean noEnrollInviteFilter,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("noPackageSessionFilter") boolean noPackageSessionFilter,
      @Param("userId") String userId,
      @Param("includeInvoiceLogs") boolean includeInvoiceLogs,
      @Param("includeUnpaidInvoices") boolean includeUnpaidInvoices,
      @Param("noPaymentTypeFilter") boolean noPaymentTypeFilter,
      @Param("typeSubOrgAdmin") boolean typeSubOrgAdmin,
      @Param("typeSubOrgLearner") boolean typeSubOrgLearner,
      @Param("typeLiveClass") boolean typeLiveClass,
      @Param("typeCourse") boolean typeCourse,
      @Param("typeCpo") boolean typeCpo,
      @Param("typeEnrollInvite") boolean typeEnrollInvite,
      @Param("typeUserInvoice") boolean typeUserInvoice,
      @Param("noSearchFilter") boolean noSearchFilter,
      @Param("noSearchUserIds") boolean noSearchUserIds,
      @Param("searchUserIds") List<String> searchUserIds,
      @Param("searchNumeric") boolean searchNumeric,
      @Param("searchString") String searchString,
      @Param("searchPhoneDigits") String searchPhoneDigits,
      @Param("paymentPlanNames") List<String> paymentPlanNames,
      @Param("noPaymentPlanFilter") boolean noPaymentPlanFilter,
      @Param("abandonedAfterHours") long abandonedAfterHours);


  /**
   * Per-day PAID collection totals for an institute over a date window, optionally
   * scoped to a single sub-org. Sums payment_log.payment_amount for PAID payments,
   * grouped by the calendar day the payment was received ({@link #PAID_AT}) in :timeZone.
   *
   * created_at is a naked UTC timestamp, so days were previously cut on UTC midnight and a payment
   * taken at 00:30 IST was charted under the previous day. :timeZone is an IANA zone the CALLER has
   * already validated (Postgres errors on an unknown one); pass 'UTC' for the original behaviour.
   * Only the day boundaries move — the window below still filters on UTC instants.
   *
   * Sub-org scoping is via enroll_invite.sub_org_id (a sub-org's SUBORG_LEARNER and
   * SUB_ORG invites both carry it), so it captures both the sub-org's learner fees
   * and its admin subscription. When noSubOrg=true the sub-org clause is skipped and
   * the whole institute is summed. Only the user_plan/enroll_invite payment path is
   * counted (not admin-invoice logs), which keeps the number cleanly sub-org-scopable.
   *
   * payment_log.currency is blank on a large share of rows (the invite it was copied from
   * carried no currency), so it is resolved against the plan being paid for and then the
   * invite — otherwise the dashboard gets no currency back and has to guess a symbol.
   */
  /*
   * GROUP BY 1, not a repeat of the TO_CHAR expression. Spring Data expands each
   * occurrence of a named parameter into its own positional placeholder, so writing
   * :timeZone in both the SELECT and the GROUP BY produced two different
   * placeholders. Postgres then could not see the two expressions as equal and
   * rejected every call with:
   *   ERROR: column "pl.created_at" must appear in the GROUP BY clause
   * This endpoint failed 100% of the time in production -- verified against
   * pg_stat/admin-core logs: zero successful calls. The ordinal form references the
   * first output column, so there is only one placeholder left to bind.
   */
  @Query(value = """
      SELECT TO_CHAR(""" + PAID_AT + """
        AT TIME ZONE 'UTC' AT TIME ZONE :timeZone, 'YYYY-MM-DD') AS day,
             SUM(pl.payment_amount) AS amount,
             COUNT(*) AS cnt,
             MAX(UPPER(COALESCE(NULLIF(TRIM(pl.currency), ''),
                                NULLIF(TRIM(pp.currency), ''),
                                NULLIF(TRIM(ei.currency), '')))) AS currency
      FROM payment_log pl
      JOIN user_plan up ON pl.user_plan_id = up.id
      JOIN enroll_invite ei ON up.enroll_invite_id = ei.id
      LEFT JOIN payment_plan pp ON up.plan_id = pp.id
      WHERE ei.institute_id = :instituteId
        AND """ + PAID_AT + """
          >= :startDate
        AND """ + PAID_AT + """
          <= :endDate
        AND pl.payment_status = 'PAID'
        AND (:noSubOrg = true OR ei.sub_org_id = :subOrgId)
      GROUP BY 1
      ORDER BY day
      """, nativeQuery = true)
  List<CollectionSummaryProjection> getCollectionSummary(
      @Param("instituteId") String instituteId,
      @Param("subOrgId") String subOrgId,
      @Param("noSubOrg") boolean noSubOrg,
      @Param("startDate") LocalDateTime startDate,
      @Param("endDate") LocalDateTime endDate,
      @Param("timeZone") String timeZone);

  /**
   * NATIVE QUERY REPLACEMENT for the Specification
   * This query finds paginated payment logs based on a set of dynamic filters.
   */
  @Query(value = """
      SELECT
        pl.id AS id,
        pl.status AS status,
        pl.payment_status AS paymentStatus,
        pl.user_id AS userId,
        pl.vendor AS vendor,
        pl.vendor_id AS vendorId,
        pl.date AS date,
        pl.currency AS currency,
        pl.payment_amount AS paymentAmount,
        pl.created_at AS createdAt,
        pl.updated_at AS updatedAt,
        pl.payment_specific_data AS paymentSpecificData,

        -- UserPlan fields
        up.id AS userPlanId,
        up.user_id AS userPlanUserId,
        up.plan_id AS userPlanPaymentPlanId,
        up.applied_coupon_discount_id AS userPlanAppliedCouponDiscountId,
        up.enroll_invite_id AS userPlanEnrollInviteId,
        up.payment_option_id AS userPlanPaymentOptionId,
        up.status AS userPlanStatus,
        up.created_at AS userPlanCreatedAt,
        up.updated_at AS userPlanUpdatedAt,

        -- Derived field
        CASE
          WHEN pl.payment_status = 'PAID' THEN 'PAID'
          WHEN pl.payment_status IS NULL THEN 'NOT_INITIATED'

          -- *** LOGIC FIX: Handle 'FAILED' status *before* other statuses ***
          WHEN pl.payment_status = 'FAILED' THEN
            COALESCE(
              (
                -- First, check if a *subsequent* user plan for this enrollment is ACTIVE
                SELECT 'PAID'
                FROM user_plan next_up
                WHERE next_up.user_id = up.user_id
                  AND next_up.enroll_invite_id = up.enroll_invite_id
                  AND next_up.created_at > up.created_at -- Must be after the plan associated with this failed log
                  AND next_up.status = 'ACTIVE' -- Must be an active (i.e., paid) plan
                ORDER BY next_up.created_at ASC
                LIMIT 1
              ),

              -- *** SYNTAX FIX: Removed apostrophe from "it's" ***
              'FAILED' -- If no subsequent active plan is found, then it is truly FAILED
            )

          -- All other statuses (e.g., 'PENDING', 'PROCESSING') fall through here
          ELSE pl.payment_status
        END AS currentPaymentStatus

      FROM payment_log pl
      LEFT JOIN user_plan up ON pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei ON up.enroll_invite_id = ei.id
      WHERE
        ei.institute_id = :instituteId
        AND (pl.created_at >= :startDate)
        AND (pl.created_at <= :endDate)
        AND (:paymentStatuses IS NULL OR pl.payment_status IN (:paymentStatuses))
        AND (:userPlanStatuses IS NULL OR up.status IN (:userPlanStatuses))
        AND (:enrollInviteIds IS NULL OR ei.id IN (:enrollInviteIds))
        AND (:packageSessionIds IS NULL OR EXISTS (
              SELECT 1
              FROM package_session_learner_invitation_to_payment_option psli
              WHERE psli.enroll_invite_id = ei.id
                AND psli.status = 'ACTIVE'
                AND psli.package_session_id IN (:packageSessionIds)
            ))
      """, countQuery = """
      SELECT COUNT(DISTINCT pl.id)
      FROM payment_log pl
      LEFT JOIN user_plan up ON pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei ON up.enroll_invite_id = ei.id
      WHERE
        ei.institute_id = :instituteId
        AND (pl.created_at >= :startDate)
        AND (pl.created_at <= :endDate)
        AND (:paymentStatuses IS NULL OR pl.payment_status IN (:paymentStatuses))
        AND (:userPlanStatuses IS NULL OR up.status IN (:userPlanStatuses))
        AND (:enrollInviteIds IS NULL OR ei.id IN (:enrollInviteIds))
        AND (:packageSessionIds IS NULL OR EXISTS (
              SELECT 1
              FROM package_session_learner_invitation_to_payment_option psli
              WHERE psli.enroll_invite_id = ei.id
                AND psli.status = 'ACTIVE'
                AND psli.package_session_id IN (:packageSessionIds)
            ))
      """, nativeQuery = true)
  Page<PaymentLogWithUserPlanProjection> findPaymentLogsByFiltersNative(
      @Param("instituteId") String instituteId,
      @Param("startDate") LocalDateTime startDate,
      @Param("endDate") LocalDateTime endDate,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("userPlanStatuses") List<String> userPlanStatuses,
      @Param("enrollInviteIds") List<String> enrollInviteIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      Pageable pageable);

  /**
   * Atomically claims a payment log for "paid" processing: flips it to the given paid/success
   * statuses only if it is not already paid, returning the number of rows changed.
   *
   * <p>Returns {@code 1} for the caller that wins the claim and {@code 0} for any caller that
   * finds it already paid. Used to dedupe Razorpay's concurrent {@code payment.captured} /
   * {@code order.paid} webhook events (and cross-replica duplicates / retries) so that
   * fee allocation and receipt/invoice generation run at most once. The single-statement
   * conditional UPDATE is atomic at the DB row level — unlike a read-then-check guard, two
   * concurrent webhook deliveries cannot both observe "not paid" and both proceed.</p>
   */
  @Modifying
  @Query("UPDATE PaymentLog p SET p.paymentStatus = :paidStatus, p.status = :successStatus "
      + "WHERE p.id = :id AND (p.paymentStatus IS NULL OR p.paymentStatus <> :paidStatus)")
  int markPaidIfNotAlready(@Param("id") String id,
      @Param("paidStatus") String paidStatus,
      @Param("successStatus") String successStatus);

  /**
   * Sets a non-paid payment status (PAYMENT_PENDING / FAILED) only while the log has not
   * already been paid. Razorpay delivers {@code payment.authorized} alongside
   * {@code payment.captured}/{@code order.paid}, and with multiple replicas the authorized
   * event can be applied AFTER the capture — without this guard it silently downgraded a
   * PAID log back to PAYMENT_PENDING. Payment status is monotonic: once PAID, no webhook
   * event may regress it. Returns 0 when the row was already PAID (caller must then skip
   * failure/pending side effects too).
   */
  @Modifying
  @Query("UPDATE PaymentLog p SET p.paymentStatus = :newStatus "
      + "WHERE p.id = :id AND (p.paymentStatus IS NULL OR p.paymentStatus <> :paidStatus)")
  int updatePaymentStatusIfNotPaid(@Param("id") String id,
      @Param("newStatus") String newStatus,
      @Param("paidStatus") String paidStatus);


  /**
   * Plan names the institute actually has plans for. Feeds the plan filter's dropdown, which must
   * stay complete regardless of which plans the current filters leave visible.
   */
  @Query(value = """
      SELECT DISTINCT pp.name FROM payment_plan pp
      JOIN user_plan up ON up.plan_id = pp.id
      JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      WHERE ei.institute_id = :instituteId AND pp.name IS NOT NULL
      ORDER BY pp.name
      """, nativeQuery = true)
  List<String> findDistinctPaymentPlanNames(@Param("instituteId") String instituteId);

  /**
   * Counts this plan's payment logs created at/after {@code since} that have not failed.
   *
   * <p>Double-submit guard for the learner-initiated "pay to continue" renewal. The
   * webhook-level dedupe ({@link #markPaidIfNotAlready}) cannot help here: every click
   * mints its OWN payment_log id, so two clicks are two distinct orders. That is harmless
   * for a checkout gateway (the learner simply abandons the second modal) but not for a
   * stored-token gateway like eWay, where the charge is submitted server-side and
   * synchronously -- a second click seconds later takes a second real payment.
   */
  @Query("SELECT COUNT(pl) FROM PaymentLog pl WHERE pl.userPlan.id = :userPlanId "
      + "AND pl.createdAt >= :since "
      + "AND (pl.paymentStatus IS NULL OR pl.paymentStatus <> :failedStatus)")
  long countRecentUnfailedForPlan(@Param("userPlanId") String userPlanId,
      @Param("since") LocalDateTime since,
      @Param("failedStatus") String failedStatus);
}
