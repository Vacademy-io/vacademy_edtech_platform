package vacademy.io.admin_core_service.features.institute_learner.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface StudentSessionInstituteGroupMappingRepository
    extends JpaRepository<StudentSessionInstituteGroupMapping, String> {

  /**
   * The learner's enrollment number at an institute, for report headers. Prefers an
   * ACTIVE enrolment, then the most recent one; blank numbers are skipped.
   */
  @Query(value = """
      SELECT ssigm.institute_enrollment_number
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.user_id = :userId
        AND ssigm.institute_id = :instituteId
        AND COALESCE(TRIM(ssigm.institute_enrollment_number), '') <> ''
      ORDER BY CASE WHEN ssigm.status = 'ACTIVE' THEN 0 ELSE 1 END,
               ssigm.enrolled_date DESC NULLS LAST,
               ssigm.created_at DESC NULLS LAST
      LIMIT 1
      """, nativeQuery = true)
  Optional<String> findLatestEnrollmentNumber(@Param("userId") String userId,
                                              @Param("instituteId") String instituteId);

  /**
   * Every learner enrolled in any of {@code psIds}, deduped to one row per learner.
   *
   * <p>Used by assessment_service to build the "enrolled but has not attempted" list.
   * Two properties matter and must be preserved:
   *
   * <ul>
   *   <li><b>No exclusion parameter.</b> The caller subtracts the already-attempted
   *       learners itself. Pushing an exclude-list in as an array made the predicate
   *       unestimable, and once Postgres picked a generic plan it re-evaluated the array
   *       per row — measured on prod, the same page went from 22ms to 434-880ms,
   *       intermittently. As written the plan is stable: 22ms custom / 28ms generic on
   *       the largest batch in prod (4051 learners), 1-2ms on a typical one.</li>
   *   <li><b>Index-only on the mapping side.</b> The WHERE columns match
   *       {@code idx_student_batch_lookup (package_session_id, institute_id, user_id,
   *       status) WHERE status = 'ACTIVE'}, so the mapping is read from the index with no
   *       heap access. Adding a column from ssigm outside that index costs heap fetches
   *       per row. (The student columns come from the joined row, not this index.)</li>
   * </ul>
   *
   * <p>DISTINCT ON is needed because a learner can sit in more than one of the requested
   * batches; the ORDER BY inside picks the lowest package_session_id so the batch shown
   * is at least deterministic.
   */
  @Query(value = """
      SELECT DISTINCT ON (ssigm.user_id)
             ssigm.user_id AS userId,
             s.full_name AS fullName,
             ssigm.package_session_id AS packageSessionId,
             s.email AS email,
             s.mobile_number AS mobileNumber,
             s.username AS username
      FROM student_session_institute_group_mapping ssigm
      JOIN student s ON s.user_id = ssigm.user_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND ssigm.institute_id = :instituteId
        AND ssigm.status IN (:statuses)
      ORDER BY ssigm.user_id, ssigm.package_session_id
      """, nativeQuery = true)
  List<vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.BatchEnrolledLearnerDto>
      findEnrolledLearnersByPackageSessions(@Param("psIds") List<String> psIds,
                                            @Param("instituteId") String instituteId,
                                            @Param("statuses") List<String> statuses);

  /**
   * Every (learner, batch) enrolment in the given batches: one row per pair, so a
   * learner in two of the batches comes back twice. Used by assessment_service's
   * Assessment Dashboard to build each assessment's audience from its assigned batches.
   *
   * <p>Same access path as {@link #findEnrolledLearnersByPackageSessions}; the DISTINCT ON
   * only removes duplicate mapping rows for the same pair (and duplicate student rows).
   */
  @Query(value = """
      SELECT DISTINCT ON (ssigm.user_id, ssigm.package_session_id)
             ssigm.user_id AS userId,
             ssigm.package_session_id AS packageSessionId,
             CAST(ssigm.enrolled_date AS varchar) AS enrolledDate,
             s.full_name AS fullName,
             s.email AS email,
             s.mobile_number AS mobileNumber
      FROM student_session_institute_group_mapping ssigm
      JOIN student s ON s.user_id = ssigm.user_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND ssigm.institute_id = :instituteId
        AND ssigm.status IN (:statuses)
      ORDER BY ssigm.user_id, ssigm.package_session_id, ssigm.enrolled_date
      """, nativeQuery = true)
  List<vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.BatchEnrollmentRowDto>
      findEnrollmentRowsByPackageSessions(@Param("psIds") List<String> psIds,
                                          @Param("instituteId") String instituteId,
                                          @Param("statuses") List<String> statuses);

  /**
   * The institute enrollment number on each of these learners' enrolments, one row per
   * (learner, batch). Used by assessment_service's OMR roll-number pre-check and scan
   * matching. The DISTINCT ON only drops duplicate mapping rows for the same pair,
   * keeping the most recently enrolled one.
   */
  @Query(value = """
      SELECT DISTINCT ON (ssigm.user_id, ssigm.package_session_id)
             ssigm.user_id AS userId,
             ssigm.package_session_id AS packageSessionId,
             ssigm.institute_enrollment_number AS instituteEnrollmentNumber
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.user_id IN (:userIds)
        AND ssigm.institute_id = :instituteId
        AND ssigm.status IN (:statuses)
      ORDER BY ssigm.user_id, ssigm.package_session_id, ssigm.enrolled_date DESC NULLS LAST
      """, nativeQuery = true)
  List<vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.EnrollmentNumberRowDto>
      findEnrollmentNumbersForUsers(@Param("userIds") List<String> userIds,
                                    @Param("instituteId") String instituteId,
                                    @Param("statuses") List<String> statuses);

  @Query(value = """
      SELECT
          ssigm.id AS mapping_id,                 -- Index 0
          ssigm.user_id AS user_id,               -- Index 1
          ssigm.expiry_date AS expiry_date,       -- Index 2
          s.full_name AS full_name,               -- Index 3
          s.mobile_number AS mobile_number,       -- Index 4
          s.email AS email,                       -- Index 5
          s.username AS username,                 -- Index 6
          ssigm.package_session_id,               -- Index 7
          ssigm.enrolled_date AS enrolled_date    -- Index 8
      FROM student_session_institute_group_mapping ssigm
      JOIN student s ON s.user_id = ssigm.user_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND ssigm.status IN (:statuses)
      """, nativeQuery = true)
  List<Object[]> findMappingsWithStudentContacts(
      @Param("psIds") List<String> packageSessionIds,
      @Param("statuses") List<String> statuses);

  /**
   * Learners whose next autopay charge lands exactly {@code daysAhead} days from today,
   * counted on the DATE {@code next_charge_at} HOLDS with its time of day ignored.
   *
   * <p>The time used to decide the answer. This compared {@code next_charge_at} converted
   * into the invite's {@code AUTOPAY_SETTING.TRIAL_TIMEZONE}, so a charge recorded at 10:00
   * UTC bucketed on its own date while one at 18:30 UTC — midnight in Asia/Kolkata —
   * bucketed on the day AFTER the date it reads as. Since {@code next_charge_at} inherits
   * its clock from whenever the member happened to enrol, two plans both recorded "on the
   * 27th" were announced on different days. Six of SuchBliss's sixteen armed plans sit on
   * the midnight boundary and ten do not, which is why the timing looked arbitrary.
   *
   * <p>It also put this query and the charge out of step, because
   * {@code RenewalChargeService.isDueWithLead} counts its own lead back from the same
   * anchor. With {@code CHARGE_LEAD_DAYS = 2} and {@code daysAhead = 1} the charge went out
   * on anchor-2 and the reminder on anchor-1 — one day AFTER the money had already been
   * presented. Both now count from the stored date, so {@code daysAhead} must simply exceed
   * {@code CHARGE_LEAD_DAYS} for the reminder to arrive first, and the relationship is
   * legible from the two numbers alone.
   *
   * <p>{@code CURRENT_DATE} resolves in the database session zone (UTC on the pods), which
   * is the same calendar day as the invite's zone for any run between 05:30 and 29:30 IST —
   * both renewal workflows fire mid-afternoon IST, comfortably inside that.
   *
   * <p>Plans already in dunning are excluded ({@code renewal_attempt_count = 0}). A plan
   * whose charge has been presented and refused has no UPCOMING charge — it has a failing
   * one, and belongs to {@link #findRenewalFailedPlans}, which chases it with a payment
   * link. Without this they got both, and worse: {@code applyDunning} re-arms
   * {@code next_charge_at} to {@code now + 1 day} after every failure, which re-qualified
   * the plan for "we charge you tomorrow" every single day. One SuchBliss member got that
   * message on three consecutive days against a charge that never once completed.
   * {@code renewal_attempt_count} resets to 0 only on a successful renewal, so a plan that
   * failed once and later recovered is correctly back in this audience next cycle.
   *
   * <p>Only ACTIVE plans with autopay still enabled are returned, so learners who already
   * cancelled are naturally excluded. {@code charge_date_label} is preformatted for messages
   * ("11 Aug 2026") off the same stored date, so the date a learner reads is the date in the
   * row.
   *
   * <p>{@code is_trial} is returned so callers can split the audience: a trial's upcoming
   * charge is its FIRST charge ("your free trial ends tomorrow") while a member's is a
   * RENEWAL ("your plan renews tomorrow"). Both used to arrive here indistinguishable, so a
   * single workflow greeted both with one wording — SuchBliss was telling paying members
   * their free trial was ending. Filtered by the {@code trialOnly} param in
   * {@code QueryServiceImpl.getUpcomingAutopayCharges}, which defaults to returning both.
   */
  @Query(value = """
      SELECT DISTINCT ON (up.id)
          up.id AS user_plan_id,
          up.user_id AS user_id,
          s.full_name AS full_name,
          s.mobile_number AS mobile_number,
          s.username AS username,
          up.next_charge_at AS next_charge_at,
          up.end_date AS end_date,
          to_char(up.next_charge_at, 'DD Mon YYYY') AS charge_date_label,
          up.is_trial AS is_trial
      FROM user_plan up
      JOIN student_session_institute_group_mapping ssigm
        ON ssigm.user_plan_id = up.id AND ssigm.status = 'ACTIVE'
      JOIN student s ON s.user_id = up.user_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND up.status = 'ACTIVE'
        AND up.auto_renewal_enabled = true
        AND up.next_charge_at IS NOT NULL
        AND CAST(up.next_charge_at AS date) = CURRENT_DATE + CAST(:daysAhead AS int)
        AND coalesce(up.renewal_attempt_count, 0) = 0
      ORDER BY up.id
      """, nativeQuery = true)
  List<Object[]> findUpcomingAutopayCharges(
      @Param("psIds") List<String> packageSessionIds,
      @Param("daysAhead") int daysAhead);

  /**
   * Learners whose autopay charge was PRESENTED AND REFUSED and who have not renewed
   * since: plan still ACTIVE with autopay on, at least one renewal attempt recorded
   * (renewal_attempt_count is reset to 0 only by a successful renewal), and end_date
   * inside [today - graceDays, today + daysAhead]. This is the "your payment could not
   * be processed — pay via this link" audience; it is disjoint from
   * findManualRenewalDuePlans (autopay off / plan cancelled), so a learner is never
   * chased by both messages. last_error is the gateway's reason from the most recent
   * FAILED payment_log, when one was recorded.
   */
  @Query(value = """
      SELECT DISTINCT ON (up.id)
          up.id AS user_plan_id,
          up.user_id AS user_id,
          s.full_name AS full_name,
          s.mobile_number AS mobile_number,
          s.username AS username,
          up.renewal_attempt_count AS attempts,
          up.end_date AS end_date,
          to_char(up.end_date, 'DD Mon YYYY') AS end_date_label,
          (SELECT pl.payment_specific_data FROM payment_log pl
            WHERE pl.user_plan_id = up.id AND pl.payment_status = 'FAILED'
            ORDER BY pl.created_at DESC LIMIT 1) AS last_failure
      FROM user_plan up
      JOIN student_session_institute_group_mapping ssigm
        ON ssigm.user_plan_id = up.id AND ssigm.status = 'ACTIVE'
      JOIN student s ON s.user_id = up.user_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND up.status = 'ACTIVE'
        AND up.auto_renewal_enabled = true
        AND COALESCE(up.renewal_attempt_count, 0) > 0
        AND up.end_date IS NOT NULL
        AND CAST(up.end_date AS date) BETWEEN CURRENT_DATE - CAST(:graceDays AS int)
                                          AND CURRENT_DATE + CAST(:daysAhead AS int)
      ORDER BY up.id
      """, nativeQuery = true)
  List<Object[]> findRenewalFailedPlans(
      @Param("psIds") List<String> packageSessionIds,
      @Param("daysAhead") int daysAhead,
      @Param("graceDays") int graceDays);

  /**
   * Is this user an enrolled member of any of these package sessions right now?
   *
   * <p>"Member" means an ACTIVE mapping that came from a completed enrolment. Rows the
   * checkout leaves behind on the way -- ABANDONED_CART (form filled, never paid) and
   * PAYMENT_FAILED (authorisation refused) -- are ACTIVE too but grant nothing, so they
   * are excluded: someone whose payment never went through must stay free to fill the
   * invite form again. Legacy rows carry no type and count as membership.
   *
   * <p>Used by the phone-identifier submission guard: a current member is sent to sign in
   * and use "Pay to continue" rather than taking a second free trial through a sibling
   * invite link. An expired or cancelled member (mapping INACTIVE) may re-register.
   */
  @Query("""
      SELECT COUNT(m) > 0 FROM StudentSessionInstituteGroupMapping m
      WHERE m.userId = :userId
        AND m.packageSession.id IN :packageSessionIds
        AND m.status = 'ACTIVE'
        AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      """)
  boolean existsActiveMembership(
      @Param("userId") String userId,
      @Param("packageSessionIds") List<String> packageSessionIds);

  /**
   * Package sessions in which this plan currently holds a live membership. Same
   * membership rule as {@link #existsActiveMembership}. Used to scope first-payment
   * side effects (inventory) to what the payment actually activated, rather than
   * every session the invite maps.
   */
  @Query(value = """
      SELECT DISTINCT m.package_session_id FROM student_session_institute_group_mapping m
      WHERE m.user_plan_id = :userPlanId
        AND m.status = 'ACTIVE'
        AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      """, nativeQuery = true)
  List<String> findActivePackageSessionIdsByUserPlanId(@Param("userPlanId") String userPlanId);

  /**
   * A learner's live memberships in the given package sessions, whatever plan they hang
   * off. Access-pass sync uses the user_plan_id on each row to tell a course the pass
   * granted from one the learner holds through a separate purchase.
   */
  @Query("""
      SELECT m FROM StudentSessionInstituteGroupMapping m
      WHERE m.userId = :userId
        AND m.packageSession.id IN :packageSessionIds
        AND m.status = 'ACTIVE'
        AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      """)
  List<StudentSessionInstituteGroupMapping> findActiveMembershipsForUserInPackageSessions(
      @Param("userId") String userId,
      @Param("packageSessionIds") List<String> packageSessionIds);

  /**
   * Live sub-org memberships stamped with the sub-org (admin "add member", the root
   * admin's own rows). One half of a B2B access pass's roster; the other half is
   * {@link #findActiveRowsViaSubOrgInvite} (self-enrollees through SUBORG_LEARNER links
   * carry no sub_org_id). Two queries, not an OR across columns.
   */
  @Query("""
      SELECT m FROM StudentSessionInstituteGroupMapping m
      WHERE m.subOrg.id = :subOrgId
        AND m.status = 'ACTIVE'
        AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      """)
  List<StudentSessionInstituteGroupMapping> findActiveRowsBySubOrgId(@Param("subOrgId") String subOrgId);

  @Query(value = """
      SELECT m.* FROM student_session_institute_group_mapping m
      JOIN user_plan up ON up.id = m.user_plan_id
      JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      WHERE ei.sub_org_id = :subOrgId
        AND m.status = 'ACTIVE'
        AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      """, nativeQuery = true)
  List<StudentSessionInstituteGroupMapping> findActiveRowsViaSubOrgInvite(@Param("subOrgId") String subOrgId);

  /**
   * Learners who must PAY MANUALLY to continue: their plan ends within the next
   * N days (or ended up to graceDays ago) and autopay will NOT charge them —
   * autopay off (cancelled mandate) or plan CANCELED/PAYMENT_FAILED/EXPIRED.
   * The audience for "pay to continue your membership" messages carrying the
   * /subscriptions/<username> link. end_date_label preformatted for messages.
   */
  @Query(value = """
      SELECT DISTINCT ON (up.id)
          up.id AS user_plan_id,
          up.user_id AS user_id,
          s.full_name AS full_name,
          s.mobile_number AS mobile_number,
          s.username AS username,
          up.status AS plan_status,
          up.end_date AS end_date,
          to_char(up.end_date, 'DD Mon YYYY') AS end_date_label
      FROM user_plan up
      JOIN student_session_institute_group_mapping ssigm ON ssigm.user_plan_id = up.id
      JOIN student s ON s.user_id = up.user_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND up.end_date IS NOT NULL
        AND CAST(up.end_date AS date) BETWEEN CURRENT_DATE - CAST(:graceDays AS int)
                                          AND CURRENT_DATE + CAST(:daysAhead AS int)
        AND (
              up.auto_renewal_enabled = false
              OR up.status IN ('CANCELED', 'PAYMENT_FAILED', 'EXPIRED')
            )
        AND up.status <> 'TERMINATED'
      ORDER BY up.id
      """, nativeQuery = true)
  List<Object[]> findManualRenewalDuePlans(
      @Param("psIds") List<String> packageSessionIds,
      @Param("daysAhead") int daysAhead,
      @Param("graceDays") int graceDays);

  /**
   * Learners who started an enrolment but never completed checkout, one row per learner.
   *
   * <p>The caller chooses which plan statuses count: PENDING_FOR_PAYMENT is an abandoned
   * cart (payment never attempted), PAYMENT_FAILED is a payment that was tried and
   * declined. Those want different follow-up copy, so they are queried separately.
   *
   * <p>Each retry creates a fresh user_plan, so a naive per-plan query messages the same person
   * repeatedly -- DISTINCT ON (up.user_id) with the ORDER BY below keeps only their most recent
   * attempt, which also carries the invite they last chose rather than the one they first tried.
   *
   * <p>The NOT EXISTS is the important guard: a learner may abandon several times and then
   * convert, and telling a paying member their registration is incomplete is worse than staying
   * silent. Observed live -- one learner left two pending plans at 07:10 and 07:14 and paid at
   * 07:15.
   */
  @Query(value = """
      SELECT DISTINCT ON (up.user_id)
          up.id            AS user_plan_id,
          up.user_id       AS user_id,
          s.full_name      AS full_name,
          s.mobile_number  AS mobile_number,
          s.username       AS username,
          up.status        AS plan_status,
          ei.invite_code   AS invite_code,
          up.created_at    AS created_at
      FROM user_plan up
      JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      JOIN student s        ON s.user_id = up.user_id
      WHERE ei.institute_id = :instituteId
        AND up.status IN (:statuses)
        AND CAST(up.created_at AS date) BETWEEN CURRENT_DATE - CAST(:maxAgeDays AS int)
                                            AND CURRENT_DATE - CAST(:minAgeDays AS int)
        AND s.mobile_number IS NOT NULL
        AND s.mobile_number <> ''
        AND NOT EXISTS (
              SELECT 1 FROM user_plan act
              WHERE act.user_id = up.user_id
                AND act.status = 'ACTIVE'
            )
      ORDER BY up.user_id, up.created_at DESC
      """, nativeQuery = true)
  List<Object[]> findAbandonedCartPlans(
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses,
      @Param("minAgeDays") int minAgeDays,
      @Param("maxAgeDays") int maxAgeDays);


  @Query(value = """
      SELECT
          ssigm.id AS mapping_id,
          ssigm.user_id AS user_id,
          ssigm.expiry_date AS expiry_date,
          s.full_name AS full_name,
          s.mobile_number AS mobile_number,
          s.email AS email,
          s.region AS region,
          ps.id AS package_session_id
      FROM student_session_institute_group_mapping ssigm
      LEFT JOIN student s ON s.user_id = ssigm.user_id
      JOIN package_session ps ON ps.id = ssigm.package_session_id
      WHERE ssigm.package_session_id IN (:psIds)
        AND ssigm.institute_id = :instituteId
        AND ssigm.status IN (:statuses)
      """, nativeQuery = true)
  List<Object[]> findMappingsWithStudentContactsByInstitute(
      @Param("psIds") List<String> packageSessionIds,
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses);

  @Query(value = """
      SELECT * FROM student_session_institute_group_mapping
      WHERE user_id = :userId
      AND package_session_id = :sessionId ORDER BY created_at DESC LIMIT 1
      """, nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findByUserIdAndPackageSessionId(
      @Param("userId") String userId,
      @Param("sessionId") String packageSessionId);

  @Query(value = """
      SELECT * FROM student_session_institute_group_mapping
      WHERE user_id = :userId
      AND package_session_id = :sessionId
      AND institute_id = :instituteId ORDER BY created_at DESC LIMIT 1
      """, nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findByUserIdAndPackageSessionIdAndInstituteId(
      @Param("userId") String userId,
      @Param("sessionId") String packageSessionId,
      @Param("instituteId") String instituteId);

  /**
   * Latest package_session_id for a learner within one institute (ACTIVE mappings
   * preferred). Doubles as an institute-membership check: empty = the user has no
   * enrollment in this institute.
   */
  @Query(value = """
      SELECT package_session_id FROM student_session_institute_group_mapping
      WHERE user_id = :userId
      AND institute_id = :instituteId
      ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
      """, nativeQuery = true)
  Optional<String> findLatestPackageSessionIdByUserIdAndInstituteId(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  /**
   * Of the given user ids, those that have ANY mapping row in the institute (enrolled in a
   * batch or an audience-only contact, any status). Used to keep staff badge awards inside
   * the tenant: an id with no row here is skipped, never written or notified.
   */
  @Query(value = """
      SELECT DISTINCT user_id FROM student_session_institute_group_mapping
      WHERE institute_id = :instituteId
      AND user_id IN (:userIds)
      """, nativeQuery = true)
  List<String> findUserIdsInInstitute(
      @Param("instituteId") String instituteId,
      @Param("userIds") Collection<String> userIds);

  /**
   * All package_session_ids a learner is enrolled in within one institute, filtered
   * by status. Used by the parent-portal guard's enrolment leg (empty = the child is
   * not enrolled in this institute, so the guardian may not read institute-scoped data)
   * and to scope per-child fan-out queries. Distinct so a re-enrolled learner isn't doubled.
   */
  @Query(value = """
      SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
      WHERE user_id = :userId
        AND institute_id = :instituteId
        AND status IN (:statuses)
      """, nativeQuery = true)
  List<String> findPackageSessionIdsByUserIdAndInstituteAndStatusIn(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses);

  /**
   * Package sessions a learner is enrolled in within one institute, excluding only
   * TERMINAL states. Used by the parent-portal guard's enrolment leg. Deliberately an
   * EXCLUDE-list, case-insensitive: the status column is dirty in prod ('ACTIVE' vs
   * 'Active', plus INVITED/PENDING/INACTIVE/null), so an ACTIVE-only allow-list wrongly
   * 403s genuinely-enrolled children. Empty result = the child is not in this institute.
   */
  @Query(value = """
      SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
      WHERE user_id = :userId
        AND institute_id = :instituteId
        AND package_session_id IS NOT NULL
        AND (status IS NULL OR UPPER(status) NOT IN ('DELETED', 'DELETED1', 'TERMINATED', 'EXPIRED'))
      """, nativeQuery = true)
  List<String> findEnrolledPackageSessionIds(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  @Query(value = """
      SELECT * FROM student_session_institute_group_mapping
      WHERE user_id = :userId
      AND package_session_id IN (:packageSessionIds)
      AND institute_id = :instituteId
      AND (:statusList IS NULL OR status IN (:statusList))
      AND automated_completion_certificate_file_id IS NOT NULL
      """, nativeQuery = true)
  List<StudentSessionInstituteGroupMapping> findAllByLearnerIdAndPackageSessionIdInAndInstituteIdAndStatusInAndCertificate(
      @Param("userId") String learnerId,
      @Param("packageSessionIds") List<String> allPackageSessionIds,
      @Param("instituteId") String instituteId,
      @Param("statusList") List<String> status);

  @Query("""
          SELECT CASE WHEN COUNT(s) > 0 THEN TRUE ELSE FALSE END
          FROM StudentSessionInstituteGroupMapping s
          WHERE s.userId = :userId
            AND s.status IN :statusList
            AND s.packageSession.id IN :packageSessionIds
      """)
  boolean existsByUserIdAndStatusInAndPackageSessionIdIn(
      @Param("userId") String userId,
      @Param("statusList") List<String> statusList,
      @Param("packageSessionIds") List<String> packageSessionIds);

  @Query(value = """
      SELECT
          s.user_id AS user_id,
          s.full_name AS full_name,
          s.mobile_number AS mobile_number,
          s.email AS email,
          s.region AS region
      FROM student s
      WHERE s.user_id IN (:userIds)
      """, nativeQuery = true)
  List<Object[]> findStudentContactsByUserIds(@Param("userIds") List<String> userIds);

  @Query("SELECT s FROM StudentSessionInstituteGroupMapping s " +
      "WHERE s.destinationPackageSession.id = :destinationPackageSessionId " +
      "AND s.status IN :statusList " +
      "AND s.userId = :userId " +
      "ORDER BY s.createdAt DESC")
  Optional<StudentSessionInstituteGroupMapping> findLatestByDestinationPackageSessionIdAndStatusInAndUserId(
      @Param("destinationPackageSessionId") String destinationPackageSessionId,
      @Param("statusList") List<String> statusList,
      @Param("userId") String userId);

  @Query("SELECT s FROM StudentSessionInstituteGroupMapping s " +
      "WHERE s.userId = :userId " +
      "AND s.status IN :statusList " +
      "AND s.packageSession.id = :packageSessionId " +
      "ORDER BY s.createdAt DESC")
  Optional<StudentSessionInstituteGroupMapping> findByUserIdAndStatusInAndPackageSessionId(
      @Param("userId") String userId,
      @Param("statusList") List<String> statusList,
      @Param("packageSessionId") String packageSessionId);

  @Query("""
          SELECT s
          FROM StudentSessionInstituteGroupMapping s
          WHERE s.userId = :userId
            AND s.packageSession.id IN :packageSessionIds
            AND s.status IN :statusList
      """)
  List<StudentSessionInstituteGroupMapping> findAllByUserIdAndPackageSessionIdsAndStatus(
      @Param("userId") String userId,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("statusList") List<String> statusList);

  Optional<StudentSessionInstituteGroupMapping> findBySourceAndTypeIdAndTypeAndUserIdAndStatus(
      String source, String typeId, String type, String userId, String status);

  Optional<StudentSessionInstituteGroupMapping> findBySourceAndTypeAndUserIdAndStatus(
      String source, String type, String userId, String status);

  Optional<StudentSessionInstituteGroupMapping> findBySourceAndTypeIdAndUserIdAndStatus(
      String source, String typeId, String userId, String status);

  Optional<StudentSessionInstituteGroupMapping> findByTypeAndTypeIdAndUserIdAndStatus(
      String type, String typeId, String userId, String status);

  Optional<StudentSessionInstituteGroupMapping> findByTypeIdAndSourceAndUserIdAndInstituteIdAndStatus(
      String typeId, String source, String userId, String instituteId, String status);

  Optional<StudentSessionInstituteGroupMapping> findByTypeIdAndUserIdAndStatus(
      String typeId, String userId, String status);

  Optional<StudentSessionInstituteGroupMapping> findByTypeAndUserIdAndStatus(
      String type, String userId, String status);

  Optional<StudentSessionInstituteGroupMapping> findBySourceAndUserIdAndStatus(
      String source, String userId, String status);

  @Query(value = """
      UPDATE student_session_institute_group_mapping
      SET status = :status
      WHERE sub_org_id = :subOrgId
        AND institute_id = :instituteId
        AND package_session_id = :packageSessionId
        AND user_id IN (:userIds)
        AND status != :status
      """, nativeQuery = true)
  @org.springframework.data.jpa.repository.Modifying
  int terminateLearnersBySubOrgAndUserIds(
      @Param("subOrgId") String subOrgId,
      @Param("instituteId") String instituteId,
      @Param("packageSessionId") String packageSessionId,
      @Param("userIds") List<String> userIds,
      @Param("status") String status);

  // SOFT sub-org termination: keep the learner ACTIVE and move their access
  // cut-off to :expiryDate — access continues until then (the plan/expiry
  // machinery ends it afterwards). Only touches currently-ACTIVE mappings.
  @Query(value = """
      UPDATE student_session_institute_group_mapping
      SET expiry_date = :expiryDate
      WHERE sub_org_id = :subOrgId
        AND institute_id = :instituteId
        AND package_session_id = :packageSessionId
        AND user_id IN (:userIds)
        AND status = 'ACTIVE'
      """, nativeQuery = true)
  @org.springframework.data.jpa.repository.Modifying
  int softCancelLearnersBySubOrgAndUserIds(
      @Param("subOrgId") String subOrgId,
      @Param("instituteId") String instituteId,
      @Param("packageSessionId") String packageSessionId,
      @Param("userIds") List<String> userIds,
      @Param("expiryDate") java.sql.Timestamp expiryDate);

  // only active package sessions
  @Query("SELECT DISTINCT m.packageSession.id " +
      "FROM StudentSessionInstituteGroupMapping m " +
      "JOIN m.packageSession ps " +
      "WHERE m.userId = :userId " +
      "AND m.institute.id = :instituteId " +
      "AND m.packageSession.id IS NOT NULL " +
      "AND m.status = 'ACTIVE' " +
      "AND ps.status = 'ACTIVE'")
  List<String> findPackageSessionIdsByUserIdAndInstituteId(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  /**
   * Latest active learner mapping for receipt enrichment (class, section, academic year).
   * Fetches package and session in one round trip.
   */
  @Query("SELECT m FROM StudentSessionInstituteGroupMapping m " +
      "JOIN FETCH m.packageSession ps " +
      "LEFT JOIN FETCH ps.packageEntity " +
      "LEFT JOIN FETCH ps.session " +
      "WHERE m.userId = :userId AND m.institute.id = :instituteId " +
      "AND m.status = 'ACTIVE' AND m.packageSession.id IS NOT NULL " +
      "AND ps.status = 'ACTIVE' " +
      "ORDER BY m.createdAt DESC")
  List<StudentSessionInstituteGroupMapping> findActiveMappingsWithFetchedPackageSession(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  // Find all active admin mappings for a user
  @Query("SELECT m FROM StudentSessionInstituteGroupMapping m " +
      "LEFT JOIN FETCH m.subOrg " +
      "LEFT JOIN FETCH m.packageSession ps " +
      "LEFT JOIN FETCH ps.packageEntity " +
      "LEFT JOIN FETCH ps.level " +
      "LEFT JOIN FETCH ps.session " +
      "WHERE m.userId = :userId " +
      "AND m.status = 'ACTIVE' " +
      "AND m.commaSeparatedOrgRoles LIKE CONCAT('%', :role, '%')")
  List<StudentSessionInstituteGroupMapping> findActiveAdminMappingsByUserId(
      @Param("userId") String userId,
      @Param("role") String role);

  // Find all admins for a specific package session and sub-org
  @Query(value = """
      SELECT ssigm.user_id AS user_id,
             s.full_name AS full_name,
             ssigm.comma_separated_org_roles AS roles
      FROM student_session_institute_group_mapping ssigm
      JOIN student s ON s.user_id = ssigm.user_id
      WHERE ssigm.package_session_id = :packageSessionId
        AND ssigm.sub_org_id = :subOrgId
        AND ssigm.comma_separated_org_roles LIKE '%ADMIN%'
        AND ssigm.user_id != :userId
      """, nativeQuery = true)
  List<Object[]> findAdminsByPackageSessionAndSubOrg(
      @Param("packageSessionId") String packageSessionId,
      @Param("subOrgId") String subOrgId,
      @Param("userId") String userId);

  // Find all admins for a sub-org (across all package sessions)
  @Query(value = """
      SELECT DISTINCT ssigm.user_id AS user_id,
             s.full_name AS full_name,
             ssigm.comma_separated_org_roles AS roles
      FROM student_session_institute_group_mapping ssigm
      JOIN student s ON s.user_id = ssigm.user_id
      WHERE ssigm.sub_org_id = :subOrgId
        AND ssigm.comma_separated_org_roles LIKE '%ADMIN%'
        AND ssigm.status = 'ACTIVE'
      """, nativeQuery = true)
  List<Object[]> findAdminsBySubOrg(@Param("subOrgId") String subOrgId);

  List<StudentSessionInstituteGroupMapping> findByUserPlanIdAndStatus(String userPlanId, String status);

  /**
   * Whether this plan EVER carried a real enrolment -- a row that granted access at some point,
   * as opposed to one that merely records an attempt.
   *
   * <p>The exclusions are the whole point. A checkout stamps the plan onto an INVITED row and an
   * ABANDONED_CART row the moment the learner reaches the payment step, so "has any mapping" is
   * true for every abandoned checkout ever made. Counting those as membership would hand a dead
   * signup attempt the renewal button -- the precise thing this predicate exists to deny -- and
   * would hide the "complete your enrollment" card from the only rows that need it.
   * INACTIVE and DELETED rows DO count: that is a revoked trial, which was a real membership.
   *
   * <p>Same exclusion list as {@link #existsActiveMembership}, deliberately, so the two cannot
   * disagree about what being a member means.
   */
  @Query("""
      SELECT COUNT(m) > 0 FROM StudentSessionInstituteGroupMapping m
      WHERE m.userPlanId = :userPlanId
        AND m.status <> 'INVITED'
        AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      """)
  boolean existsRealEnrollmentForPlan(@Param("userPlanId") String userPlanId);

  long countByPackageSessionIdAndStatus(String packageSessionId, String status);

  @Query(value = """
      SELECT * FROM student_session_institute_group_mapping
      WHERE package_session_id = :packageSessionId
        AND status IN (:statuses)
      """, nativeQuery = true)
  List<StudentSessionInstituteGroupMapping> findByPackageSessionIdAndStatusIn(
      @Param("packageSessionId") String packageSessionId,
      @Param("statuses") List<String> statuses);

  @Query(value = """
      SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
      WHERE institute_id = :instituteId
        AND status IN (:statuses)
        AND package_session_id IS NOT NULL
      LIMIT :maxResults
      """, nativeQuery = true)
  List<String> findDistinctPackageSessionIdsByInstituteAndStatus(
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses,
      @Param("maxResults") int maxResults);

  @Query(value = """
      SELECT DISTINCT package_session_id FROM student_session_institute_group_mapping
      WHERE user_id = :userId
        AND status IN (:statuses)
        AND package_session_id IS NOT NULL
      """, nativeQuery = true)
  List<String> findDistinctPackageSessionIdsByUserIdAndStatus(
      @Param("userId") String userId,
      @Param("statuses") List<String> statuses);

  @Query(value = """
      SELECT DISTINCT user_id FROM student_session_institute_group_mapping
      WHERE institute_id = :instituteId
        AND status IN (:statuses)
      """, nativeQuery = true)
  List<String> findDistinctUserIdsByInstituteAndStatus(
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses);

  /**
   * Learners enrolled in one batch — the recipient list for a daily-engagement push.
   * Distinct so a re-enrolled learner is not notified twice.
   */
  @Query(value = """
      SELECT DISTINCT user_id FROM student_session_institute_group_mapping
      WHERE package_session_id = :packageSessionId
        AND status IN (:statuses)
        AND user_id IS NOT NULL
      """, nativeQuery = true)
  List<String> findDistinctUserIdsByPackageSessionAndStatus(
      @Param("packageSessionId") String packageSessionId,
      @Param("statuses") List<String> statuses);

  @Query(value = """
      SELECT DISTINCT institute_id FROM student_session_institute_group_mapping
      WHERE user_id = :userId
        AND status IN (:statuses)
        AND institute_id IS NOT NULL
      LIMIT 1
      """, nativeQuery = true)
  Optional<String> findInstituteIdByUserIdAndStatus(
      @Param("userId") String userId,
      @Param("statuses") List<String> statuses);

  /**
   * True when the user is an enrolled learner of the institute -- at least one
   * ACTIVE mapping that came from a completed enrolment (same membership rule
   * as existsActiveMembership: ABANDONED_CART / PAYMENT_FAILED rows grant
   * nothing). Gates the "unassigned public live classes" broadcast.
   */
  @Query(value = """
      SELECT EXISTS (
          SELECT 1 FROM student_session_institute_group_mapping m
          WHERE m.user_id = :userId
            AND m.institute_id = :instituteId
            AND m.status = 'ACTIVE'
            AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      )
      """, nativeQuery = true)
  boolean existsActiveLearnerInInstitute(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  // -------------------------------------------------------------------------
  // Unique Methods from 'autonation-fixes'
  // -------------------------------------------------------------------------

  @Query(value = """
      SELECT DISTINCT ssigm.user_id
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.sub_org_id = :subOrgId
        AND ssigm.package_session_id = :packageSessionId
        AND ssigm.comma_separated_org_roles LIKE CONCAT('%', :role, '%')
        AND ssigm.status = 'ACTIVE'
      """, nativeQuery = true)
  List<String> findAdminUserIdsForSubOrg(
      @Param("subOrgId") String subOrgId,
      @Param("packageSessionId") String packageSessionId,
      @Param("role") String role);

  @Query(value = """
      SELECT * FROM student_session_institute_group_mapping
      WHERE user_id = :userId
        AND package_session_id = :packageSessionId
        AND institute_id = :instituteId
        AND status = :status
        AND source = :source
        AND type = :type
      ORDER BY created_at DESC
      LIMIT 1
      """, nativeQuery = true)
  List<StudentSessionInstituteGroupMapping> findByUserIdAndPackageSessionIdAndInstituteIdAndStatusAndSourceAndType(
      @Param("userId") String userId,
      @Param("packageSessionId") String packageSessionId,
      @Param("instituteId") String instituteId,
      @Param("status") String status,
      @Param("source") String source,
      @Param("type") String type);

  // -------------------------------------------------------------------------
  // Unique Methods from 'main'
  // -------------------------------------------------------------------------

  /**
   * Count active learner members in a sub-organization for a specific package session.
   * Excludes ROOT_ADMIN from the count — only learner seats are validated.
   *
   * Membership mirrors {@link #findActiveSubOrgRoster(String)}: a learner counts if EITHER
   * their mapping is stamped with this sub_org_id (add-member / auto-link path) OR their
   * user_plan was created from one of the sub-org's invites (enroll_invite.sub_org_id).
   * The second arm is essential because SUBORG_LEARNER self-enrollment does NOT stamp
   * ssigm.sub_org_id — without it those learners wouldn't count against the seat cap.
   */
  @Query(value = """
      SELECT COUNT(*)
      FROM student_session_institute_group_mapping ssigm
      LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
      WHERE ssigm.package_session_id = :packageSessionId
        AND ssigm.status = :status
        AND (ssigm.comma_separated_org_roles IS NULL
             OR ssigm.comma_separated_org_roles NOT LIKE '%ROOT_ADMIN%')
        AND (
              ssigm.sub_org_id = :subOrgId
              OR up.enroll_invite_id IN (
                  SELECT ei.id FROM enroll_invite ei WHERE ei.sub_org_id = :subOrgId
              )
            )
      """, nativeQuery = true)
  long countBySubOrgIdAndPackageSessionIdAndStatus(
      @Param("subOrgId") String subOrgId,
      @Param("packageSessionId") String packageSessionId,
      @Param("status") String status);

  /**
   * Bulk version of {@link #countBySubOrgIdAndPackageSessionIdAndStatus} across ALL package
   * sessions: active learner-seat count per sub-org for a set of sub-org ids, in ONE query
   * (avoids N+1 when listing many spawned sub-orgs). Membership + ROOT_ADMIN exclusion mirror
   * {@link #findActiveSubOrgRoster(String)}; each mapping is attributed to
   * COALESCE(ssigm.sub_org_id, enroll_invite.sub_org_id) — the stamp wins, else the invite the
   * user_plan came from. Counts DISTINCT users, not mappings — a learner enrolled in several
   * of the sub-org's batches occupies ONE seat (COUNT(*) here overstated "used" for every
   * multi-batch learner). Returns rows of [sub_org_id, used_count]; zero-count sub-orgs absent.
   */
  @Query(value = """
      SELECT COALESCE(ssigm.sub_org_id, ei.sub_org_id) AS sub_org_id,
             COUNT(DISTINCT ssigm.user_id) AS used_count
      FROM student_session_institute_group_mapping ssigm
      LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
      LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      WHERE ssigm.status = 'ACTIVE'
        AND (ssigm.comma_separated_org_roles IS NULL
             OR ssigm.comma_separated_org_roles NOT LIKE '%ROOT_ADMIN%')
        AND (ssigm.sub_org_id IN (:subOrgIds) OR ei.sub_org_id IN (:subOrgIds))
      GROUP BY COALESCE(ssigm.sub_org_id, ei.sub_org_id)
      """, nativeQuery = true)
  List<Object[]> countActiveLearnersBySubOrgIds(@Param("subOrgIds") List<String> subOrgIds);

  /**
   * The ROOT_ADMIN (userId + userPlanId) of each sub-org for a set of sub-org ids, in ONE
   * query. DISTINCT ON keeps a single earliest-enrolled admin per sub-org (sub-orgs can have
   * more than one ROOT_ADMIN). Returns rows of [sub_org_id, user_id, user_plan_id].
   */
  @Query(value = """
      SELECT DISTINCT ON (ssigm.sub_org_id)
             ssigm.sub_org_id, ssigm.user_id, ssigm.user_plan_id
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.sub_org_id IN (:subOrgIds)
        AND ssigm.status = 'ACTIVE'
        AND ssigm.comma_separated_org_roles LIKE '%ROOT_ADMIN%'
      ORDER BY ssigm.sub_org_id, ssigm.created_at
      """, nativeQuery = true)
  List<Object[]> findRootAdminBySubOrgIds(@Param("subOrgIds") List<String> subOrgIds);

  /** Every mapping one user holds inside one sub-org, oldest first (partner onboarding picks the ROOT_ADMIN one). */
  List<StudentSessionInstituteGroupMapping> findBySubOrg_IdAndUserIdAndStatusOrderByCreatedAtAsc(
      String subOrgId, String userId, String status);

  /**
   * Find the ROOT_ADMIN user_id for a specific sub-org and package session
   * ROOT_ADMIN is the user who purchased the plan and owns the member count limit
   */
  @Query(value = """
      SELECT ssigm.user_id
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.sub_org_id = :subOrgId
        AND ssigm.package_session_id = :packageSessionId
        AND ssigm.status = 'ACTIVE'
        AND ssigm.comma_separated_org_roles LIKE '%ROOT_ADMIN%'
      LIMIT 1
      """, nativeQuery = true)
  Optional<String> findRootAdminUserIdBySubOrgAndPackageSession(
      @Param("subOrgId") String subOrgId,
      @Param("packageSessionId") String packageSessionId);

  /**
   * Find ROOT_ADMIN's complete mapping for a batch to get the user_plan_id
   */
  @Query(value = """
      SELECT * FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.sub_org_id = :subOrgId
        AND ssigm.package_session_id = :packageSessionId
        AND ssigm.status = 'ACTIVE'
        AND ssigm.comma_separated_org_roles LIKE '%ROOT_ADMIN%'
      LIMIT 1
      """, nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findRootAdminMappingBySubOrgAndPackageSession(
      @Param("subOrgId") String subOrgId,
      @Param("packageSessionId") String packageSessionId);

  /**
   * Sub-org-wide roster for the finance-detail panel: one row per active mapping with the
   * fields the panel needs (no FETCH joins so payload stays small). Includes both admins
   * and learners; caller branches by comma_separated_org_roles.
   *
   * Membership is the UNION of two definitions so the roster captures EVERY person tied to
   * the sub-org, regardless of which enrollment path they came through:
   *   1. {@code ssigm.sub_org_id = :subOrgId} — admins + add-member/auto-linked learners
   *      (these flows stamp sub_org_id directly).
   *   2. {@code user_plan.enroll_invite_id} points at one of the sub-org's invites
   *      (enroll_invite.sub_org_id = :subOrgId) — learners who self-enrolled (or were
   *      enrolled by an institute admin) through a SUBORG_LEARNER / scoped SUB_ORG invite.
   *      That path does NOT stamp ssigm.sub_org_id, so condition (1) alone misses them.
   *
   * Order: [mapping_id, user_id, package_session_id, user_plan_id,
   *         comma_separated_org_roles, enrolled_date, full_name]
   */
  @Query(value = """
      SELECT ssigm.id,
             ssigm.user_id,
             ssigm.package_session_id,
             ssigm.user_plan_id,
             ssigm.comma_separated_org_roles,
             ssigm.enrolled_date,
             s.full_name
      FROM student_session_institute_group_mapping ssigm
      LEFT JOIN student s ON s.user_id = ssigm.user_id
      LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
      WHERE ssigm.status = 'ACTIVE'
        AND (
              ssigm.sub_org_id = :subOrgId
              OR up.enroll_invite_id IN (
                  SELECT ei.id FROM enroll_invite ei WHERE ei.sub_org_id = :subOrgId
              )
            )
      """, nativeQuery = true)
  List<Object[]> findActiveSubOrgRoster(@Param("subOrgId") String subOrgId);

  /**
   * Sub-org ids a user belongs to within an institute, newest enrollment first.
   *
   * Membership mirrors {@link #findActiveSubOrgRoster(String)}: the mapping's own stamp
   * (add-member / auto-link path) OR the sub-org invite the user_plan was created from.
   * The second arm is essential because SUBORG_LEARNER self-enrollment does NOT stamp
   * ssigm.sub_org_id.
   */
  @Query(value = """
      SELECT COALESCE(ssigm.sub_org_id, ei.sub_org_id) AS sub_org_id
      FROM student_session_institute_group_mapping ssigm
      LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
      LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      WHERE ssigm.user_id = :userId
        AND ssigm.institute_id = :instituteId
        AND ssigm.status = 'ACTIVE'
        AND COALESCE(ssigm.sub_org_id, ei.sub_org_id) IS NOT NULL
      GROUP BY COALESCE(ssigm.sub_org_id, ei.sub_org_id)
      ORDER BY MAX(ssigm.enrolled_date) DESC NULLS LAST
      """, nativeQuery = true)
  List<String> findActiveSubOrgIdsForUserInInstitute(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  /**
   * Batch-scoped variant of {@link #findActiveSubOrgIdsForUserInInstitute}: the sub-org(s) a user
   * belongs to *through this specific package session*. Preferred when the caller knows the batch
   * (e.g. a doubt raised on a slide) because a learner enrolled under several sub-orgs must only
   * surface the one that owns the batch in question — the institute-wide lookup would fan the
   * event out to every sub-org they touch.
   *
   * Membership mirrors {@link #findActiveSubOrgRoster(String)} (own stamp OR the sub-org invite the
   * user_plan came from). No institute predicate: the package session already pins tenancy.
   */
  @Query(value = """
      SELECT DISTINCT COALESCE(ssigm.sub_org_id, ei.sub_org_id) AS sub_org_id
      FROM student_session_institute_group_mapping ssigm
      LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
      LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      WHERE ssigm.user_id = :userId
        AND ssigm.package_session_id = :packageSessionId
        AND ssigm.status = 'ACTIVE'
        AND COALESCE(ssigm.sub_org_id, ei.sub_org_id) IS NOT NULL
      """, nativeQuery = true)
  List<String> findActiveSubOrgIdsForUserInPackageSession(
      @Param("userId") String userId,
      @Param("packageSessionId") String packageSessionId);

  /**
   * User ids of the sub-org's own admins — ACTIVE mappings stamped with this sub_org_id whose
   * comma_separated_org_roles carry ADMIN (this also matches ROOT_ADMIN, the person who registered
   * the sub-org). These accounts come from the sub-org registration/enrollment path, which never
   * writes a SUB_ORG-linked FSPSSM row, so they are invisible to
   * {@code findDistinctUserIdsBySubOrgIdAndLinkage} and have to be fetched separately.
   *
   * Deliberately leaner than {@link #findAdminsBySubOrg(String)}: no join to {@code student}, so an
   * admin without a student profile row still comes back.
   */
  @Query(value = """
      SELECT DISTINCT ssigm.user_id
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.sub_org_id = :subOrgId
        AND ssigm.status = 'ACTIVE'
        AND ssigm.comma_separated_org_roles LIKE '%ADMIN%'
      """, nativeQuery = true)
  List<String> findActiveAdminUserIdsBySubOrg(@Param("subOrgId") String subOrgId);

  /**
   * Sub-organizations that already have members inside one package session, with the spawned
   * institute's own contact details and a distinct member count.
   *
   * <p>Membership mirrors {@link #findActiveSubOrgIdsForUserInPackageSession}: the mapping's own
   * stamp OR the sub-org invite its user_plan came from — SUBORG_LEARNER enrollments leave
   * {@code ssigm.sub_org_id} null and are only reachable through {@code enroll_invite.sub_org_id}.
   *
   * <p>Returns: sub_org_id, name, email, mobile_number, member_count.
   */
  @Query(value = """
      SELECT sub.sub_org_id                    AS sub_org_id,
             i.name                            AS name,
             i.email                           AS email,
             i.mobile_number                   AS mobile_number,
             COUNT(DISTINCT sub.user_id)       AS member_count
      FROM (
          SELECT COALESCE(ssigm.sub_org_id, ei.sub_org_id) AS sub_org_id,
                 ssigm.user_id                             AS user_id
          FROM student_session_institute_group_mapping ssigm
          LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
          LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
          WHERE ssigm.package_session_id = :packageSessionId
            AND ssigm.status IN (:statuses)
            AND COALESCE(ssigm.sub_org_id, ei.sub_org_id) IS NOT NULL
      ) sub
      JOIN institutes i ON i.id = sub.sub_org_id
      GROUP BY sub.sub_org_id, i.name, i.email, i.mobile_number
      ORDER BY i.name
      """, nativeQuery = true)
  List<Object[]> findSubOrgsByPackageSession(
      @Param("packageSessionId") String packageSessionId,
      @Param("statuses") List<String> statuses);

  /**
   * Batched variant of {@link #findAdminsBySubOrg(String)} for several sub-orgs at once, enriched
   * with the admin's contact email. Used to fill the picker without fanning out one query per row.
   *
   * <p>Returns: sub_org_id, user_id, full_name, email, roles.
   */
  @Query(value = """
      SELECT DISTINCT ssigm.sub_org_id             AS sub_org_id,
                      ssigm.user_id                AS user_id,
                      s.full_name                  AS full_name,
                      s.email                      AS email,
                      ssigm.comma_separated_org_roles AS roles
      FROM student_session_institute_group_mapping ssigm
      JOIN student s ON s.user_id = ssigm.user_id
      WHERE ssigm.sub_org_id IN (:subOrgIds)
        AND ssigm.status = 'ACTIVE'
        AND ssigm.comma_separated_org_roles LIKE '%ADMIN%'
      """, nativeQuery = true)
  List<Object[]> findAdminsBySubOrgIds(@Param("subOrgIds") List<String> subOrgIds);

}