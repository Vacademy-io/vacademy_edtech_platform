package vacademy.io.admin_core_service.features.institute_learner.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.institute_learner.dto.LearnerBatchProjection;
import vacademy.io.admin_core_service.features.institute_learner.dto.projection.LearnerStatusCountProjection;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;

import java.util.Date;
import java.util.List;
import java.util.Optional;

@Repository
public interface StudentSessionRepository extends CrudRepository<StudentSessionInstituteGroupMapping, String> {

  @Transactional
  @Modifying
  @Query(value = "INSERT INTO student_session_institute_group_mapping " +
          "(id, user_id, enrolled_date, status, institute_enrollment_number, group_id, institute_id, expiry_date, package_session_id, destination_package_session_id, user_plan_id, sub_org_id, comma_separated_org_roles, type) "
          +
          "VALUES (:id, :userId, :enrolledDate, :status, :instituteEnrolledNumber, :groupId, :instituteId, :expiryDate, :packageSessionId, :destinationPackageSessionId, :userPlanId, :subOrgId, :commaSeparatedOrgRoles, :type)", nativeQuery = true)
  void addStudentToInstitute(
          @Param("id") String id,
          @Param("userId") String userId,
          @Param("enrolledDate") Date enrolledDate,
          @Param("status") String status,
          @Param("instituteEnrolledNumber") String instituteEnrolledNumber,
          @Param("groupId") String groupId,
          @Param("instituteId") String instituteId,
          @Param("expiryDate") Date expiryDate,
          @Param("packageSessionId") String packageSessionId,
          @Param("destinationPackageSessionId") String destinationPackageSessionId,
          @Param("userPlanId") String userPlanId,
          @Param("subOrgId") String subOrgId,
          @Param("commaSeparatedOrgRoles") String commaSeparatedOrgRoles,
          @Param("type") String type);

  @Modifying
  @Transactional
  @Query(value = "UPDATE student_session_institute_group_mapping " +
          "SET package_session_id = :newPackageSessionId " +
          "WHERE user_id = :userId " +
          "AND package_session_id = :oldPackageSessionId " +
          "AND institute_id = :instituteId", nativeQuery = true)
  int updatePackageSessionId(@Param("userId") String userId,
                             @Param("oldPackageSessionId") String oldPackageSessionId,
                             @Param("instituteId") String instituteId,
                             @Param("newPackageSessionId") String newPackageSessionId);

  @Modifying
  @Transactional
  @Query(value = "UPDATE student_session_institute_group_mapping " +
          "SET expiry_date = :expiryDate " +
          "WHERE user_id = :userId " +
          "AND package_session_id = :packageSessionId " +
          "AND institute_id = :instituteId", nativeQuery = true)
  int updateExpiryDate(@Param("userId") String userId,
                       @Param("packageSessionId") String packageSessionId,
                       @Param("instituteId") String instituteId,
                       @Param("expiryDate") Date expiryDate);

  @Modifying
  @Transactional
  @Query(value = "UPDATE student_session_institute_group_mapping " +
          "SET status = :status " +
          "WHERE user_id = :userId " +
          "AND package_session_id = :packageSessionId " +
          "AND institute_id = :instituteId", nativeQuery = true)
  int updateStatus(@Param("userId") String userId,
                   @Param("packageSessionId") String packageSessionId,
                   @Param("instituteId") String instituteId,
                   @Param("status") String status);

  /**
   * Update the status for a learner across MULTIPLE package sessions in one query.
   * Used by MAKE_INACTIVE when an admin terminates a learner from several package
   * sessions at once — collapses what would otherwise be N single-PS updates into
   * a single atomic UPDATE.
   */
  @Modifying
  @Transactional
  @Query(value = "UPDATE student_session_institute_group_mapping " +
          "SET status = :status " +
          "WHERE user_id = :userId " +
          "AND package_session_id IN (:packageSessionIds) " +
          "AND institute_id = :instituteId", nativeQuery = true)
  int updateStatusForPackageSessions(@Param("userId") String userId,
                                     @Param("packageSessionIds") List<String> packageSessionIds,
                                     @Param("instituteId") String instituteId,
                                     @Param("status") String status);

  List<StudentSessionInstituteGroupMapping> findAllByInstituteIdAndUserId(String instituteId, String userId);


  /**
   * Read-only snapshot of the access window on every mapping that
   * {@link #updateExpiryDate} is about to overwrite, in any status.
   *
   * <p>Deliberately a projection, not the entity. Loading entities here would put them in
   * the persistence context, where the following native UPDATE cannot reach them — they
   * would sit there holding a stale expiry_date for the rest of the transaction, and a
   * second ADD_EXPIRY on the same mapping would then read that stale value back out of
   * the first-level cache instead of the value just written.
   */
  @Query("""
          SELECT m.id AS id,
                 m.userId AS userId,
                 m.packageSession.id AS packageSessionId,
                 m.expiryDate AS expiryDate,
                 m.userPlanId AS userPlanId
          FROM StudentSessionInstituteGroupMapping m
          WHERE m.userId = :userId
            AND m.packageSession.id = :packageSessionId
            AND m.institute.id = :instituteId
          """)
  List<AccessWindowSnapshot> findAccessWindowSnapshots(@Param("userId") String userId,
                                                       @Param("packageSessionId") String packageSessionId,
                                                       @Param("instituteId") String instituteId);

  /** Projection for {@link #findAccessWindowSnapshots}. */
  interface AccessWindowSnapshot {
    String getId();

    String getUserId();

    String getPackageSessionId();

    java.util.Date getExpiryDate();

    String getUserPlanId();
  }

  List<StudentSessionInstituteGroupMapping> findAllByInstituteIdAndUserIdAndStatusIn(String instituteId,
                                                                                     String userId, List<String> status);

  /**
   * Eagerly fetches package + institute because LearnerLmsUserSyncService
   * walks these relations on an @Async thread where no Hibernate session
   * (or open-in-view) exists to lazy-load them.
   */
  @Query("""
          SELECT m FROM StudentSessionInstituteGroupMapping m
          LEFT JOIN FETCH m.packageSession ps
          LEFT JOIN FETCH ps.packageEntity
          LEFT JOIN FETCH m.institute
          WHERE m.userId = :userId AND m.status IN :statuses
          """)
  List<StudentSessionInstituteGroupMapping> findAllByUserIdAndStatusIn(
          @Param("userId") String userId, @Param("statuses") List<String> statuses);

  List<StudentSessionInstituteGroupMapping> findAllBySubOrgIdAndStatusIn(String subOrgId, List<String> status);

  /**
   * Bulk lookup for learner-access changes: every mapping for the given users in one
   * institute, optionally narrowed to specific package sessions.
   *
   * <p>The packageSessionIds guard is written as an emptiness check rather than a plain
   * {@code IN} so a single query serves both "these batches" and "every batch this learner
   * is in" — the admin screens issue both.
   *
   * <p>packageSession + institute are fetched eagerly because the caller builds a response
   * row per mapping (batch label, learner name) after the transaction's read phase.
   */
  @Query("""
          SELECT m FROM StudentSessionInstituteGroupMapping m
          LEFT JOIN FETCH m.packageSession ps
          LEFT JOIN FETCH ps.packageEntity
          LEFT JOIN FETCH m.institute
          WHERE m.institute.id = :instituteId
            AND m.userId IN :userIds
            AND m.status IN :statuses
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true
                 OR ps.id IN (:packageSessionIds))
          """)
  List<StudentSessionInstituteGroupMapping> findForAccessChange(
          @Param("instituteId") String instituteId,
          @Param("userIds") List<String> userIds,
          @Param("packageSessionIds") List<String> packageSessionIds,
          @Param("statuses") List<String> statuses);

  /**
   * Dashboard learner tile. Deliberately mirrors the learner list's header badges
   * (findPagedCombinedUserIdsForLearnerList with statuses:["ACTIVE"] / ["INACTIVE"]),
   * so the dashboard and Learner Management never disagree.
   *
   * That means matching the list's scope exactly:
   * - DISTINCT user_id, not COUNT(ss.id) — a learner in N batches is one learner.
   *   (This alone was 361 vs 74 for one institute.)
   * - No package_session status filter and no package_session join. Deleting a
   *   batch does NOT cascade its mappings to DELETED, so those learners stay in
   *   the learner list; filtering them out here is what made the tile read 74
   *   against the list's 76.
   * - Positive per-status buckets rather than a NOT IN blacklist, which used to
   *   sweep in INVITED and PENDING_FOR_APPROVAL as if they were enrolled.
   *
   * totalCount is every learner ever mapped to the institute, any status — the
   * list header's "Total" badge.
   */
  @Query(value = """
              SELECT
                COUNT(DISTINCT ss.user_id)                                        AS totalCount,
                COUNT(DISTINCT ss.user_id) FILTER (WHERE ss.status = 'ACTIVE')     AS activeCount,
                COUNT(DISTINCT ss.user_id) FILTER (WHERE ss.status = 'INACTIVE')   AS inactiveCount,
                COUNT(DISTINCT ss.user_id) FILTER (WHERE ss.status = 'TERMINATED') AS terminatedCount
              FROM student_session_institute_group_mapping ss
              WHERE ss.institute_id = :instituteId
          """, nativeQuery = true)
  LearnerStatusCountProjection countLearnersByStatusForInstitute(
          @Param("instituteId") String instituteId);

  @Query(value = """
                SELECT ps.id AS packageSessionId,
                       CONCAT(l.level_name, ' ', p.package_name) AS batchName,
                       COUNT(DISTINCT ssigm.user_id) AS enrolledStudents,
                       ps.is_parent AS isParent,
                       ps.parent_id AS parentId
                FROM package_session ps
                JOIN package p ON ps.package_id = p.id
                JOIN level l ON ps.level_id = l.id
                LEFT JOIN student_session_institute_group_mapping ssigm
                    ON ps.id = ssigm.package_session_id
                    AND ssigm.institute_id = :instituteId
                    AND ssigm.status IN (:status)
                WHERE ps.status != 'DELETED'
                GROUP BY ps.id, l.level_name, p.package_name, ps.is_parent, ps.parent_id
            """, nativeQuery = true)
  List<LearnerBatchProjection> getPackageSessionsWithEnrollment(
          @Param("instituteId") String instituteId,
          @Param("status") List<String> status);

  @Query(value = "SELECT * FROM student_session_institute_group_mapping WHERE institute_id = :instituteId AND user_id = :userId LIMIT 1", nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findByInstituteIdAndUserIdNative(
          @Param("instituteId") String instituteId, @Param("userId") String userId);

  @Query(value = "SELECT * FROM student_session_institute_group_mapping " +
          "WHERE package_session_id = :packageSessionId " +
          "AND user_id = :userId " +
          "AND status IN (:statuses) AND institute_id = :instituteId " +
          "ORDER BY created_at DESC LIMIT 1", nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findTopByPackageSessionIdAndUserIdAndStatusIn(
          @Param("packageSessionId") String packageSessionId,
          @Param("instituteId") String instituteId,
          @Param("userId") String userId,
          @Param("statuses") List<String> statuses);

  /**
   * The newest mapping this user can re-use for the session, ignoring the throwaway
   * ABANDONED_CART / PAYMENT_FAILED rows. The type exclusion must happen in SQL: with
   * "ORDER BY created_at DESC LIMIT 1" plus a filter in Java, a newer throwaway row
   * hides the reusable one, and the caller then inserts a duplicate that trips
   * uq_dest_pkg_inst_user_status. NULL type is a real mapping, so it must be kept.
   */
  @Query(value = "SELECT * FROM student_session_institute_group_mapping " +
          "WHERE package_session_id = :packageSessionId " +
          "AND user_id = :userId " +
          "AND status IN (:statuses) AND institute_id = :instituteId " +
          "AND (type IS NULL OR type NOT IN (:excludedTypes)) " +
          "ORDER BY created_at DESC LIMIT 1", nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findTopReusableMapping(
          @Param("packageSessionId") String packageSessionId,
          @Param("instituteId") String instituteId,
          @Param("userId") String userId,
          @Param("statuses") List<String> statuses,
          @Param("excludedTypes") List<String> excludedTypes);

  Optional<StudentSessionInstituteGroupMapping> findTopByUserIdAndInstituteIdOrderByCreatedAtDesc(String userId,
                                                                                                  String instituteId);

  @Query(value = """
            SELECT DISTINCT s.user_id
            FROM student_session_institute_group_mapping s
            WHERE s.package_session_id = :packageSessionId
              AND s.status IN (:statusList)
            """, nativeQuery = true)
  List<String> findDistinctUserIdsByPackageSessionAndStatus(
          @Param("packageSessionId") String packageSessionId,
          @Param("statusList") List<String> statusList);

  List<StudentSessionInstituteGroupMapping> findByDestinationPackageSession_IdInAndUserIdAndStatusIn(
          List<String> destinationPackageSessionIds,
          String userId,
          List<String> status);

  Optional<StudentSessionInstituteGroupMapping> findTopByDestinationPackageSessionIdAndInstituteIdAndUserIdAndStatus(
          String destinationPackageSessionId,
          String instituteId,
          String userId,
          String status);

  /**
   * The row that would collide with uq_dest_pkg_inst_user_status, keyed on exactly the
   * five columns that constraint covers. Callers about to insert a mapping must check
   * this and re-use the hit instead — a narrower lookup (one that also pins source or
   * type) misses a colliding row written by a different flow, and the insert then dies
   * on the constraint. Ordered so the newest wins if legacy duplicates predate the
   * constraint.
   */
  @Query(value = "SELECT * FROM student_session_institute_group_mapping " +
          "WHERE destination_package_session_id = :destinationPackageSessionId " +
          "AND package_session_id = :packageSessionId " +
          "AND institute_id = :instituteId " +
          "AND user_id = :userId " +
          "AND status = :status " +
          "ORDER BY created_at DESC LIMIT 1", nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findCollidingMapping(
          @Param("destinationPackageSessionId") String destinationPackageSessionId,
          @Param("packageSessionId") String packageSessionId,
          @Param("instituteId") String instituteId,
          @Param("userId") String userId,
          @Param("status") String status);

  @Modifying
  @Transactional
  @Query("DELETE FROM StudentSessionInstituteGroupMapping s " +
          "WHERE s.userId = :userId " +
          "AND s.destinationPackageSession.id = :destinationPackageSessionId " +
          "AND s.packageSession.id = :packageSessionId " +
          "AND s.institute.id = :instituteId " +
          "AND s.status = :status")
  int deleteByUniqueConstraint(
          @Param("userId") String userId,
          @Param("destinationPackageSessionId") String destinationPackageSessionId,
          @Param("packageSessionId") String packageSessionId,
          @Param("instituteId") String instituteId,
          @Param("status") String status);

  /**
   * Get student stats with user type classification (NEW_USER vs RETAINER) with
   * pagination support
   * Optimized query with LEFT JOIN for better performance
   * Returns ONE ROW PER USER with GROUP BY
   */
  @Query(value = "WITH user_mappings AS ( " +
          "    SELECT " +
          "        curr.user_id, " +
          "        ARRAY_AGG(DISTINCT curr.package_session_id) AS package_session_ids, " +
          "        MAX(curr.comma_separated_org_roles) AS comma_separated_org_roles, " +
          "        MIN(curr.created_at) AS created_at, " +
          "        CASE " +
          "            WHEN MAX(CASE WHEN prev.user_id IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 'RETAINER' "
          +
          "            ELSE 'NEW_USER' " +
          "        END AS user_type " +
          "    FROM student_session_institute_group_mapping curr " +
          "    LEFT JOIN student_session_institute_group_mapping prev " +
          "        ON prev.user_id = curr.user_id " +
          "        AND prev.institute_id = :instituteId " +
          "        AND prev.status = 'ACTIVE' " +
          "        AND prev.created_at < :startDate " +
          "    WHERE curr.institute_id = :instituteId " +
          "        AND curr.status = 'ACTIVE' " +
          "        AND curr.created_at BETWEEN :startDate AND :endDate " +
          "        AND (:packageSessionSize = 0 OR curr.package_session_id IN (:packageSessionIds)) " +
          "    GROUP BY curr.user_id " +
          ") " +
          "SELECT " +
          "    um.user_id, " +
          "    um.user_type, " +
          "    um.package_session_ids, " +
          "    um.comma_separated_org_roles, " +
          "    um.created_at " +
          "FROM user_mappings um " +
          "WHERE (:userTypeSize = 0 OR um.user_type IN (:userTypes)) ",

          countQuery = "WITH user_mappings AS ( " +
                  "    SELECT " +
                  "        curr.user_id, " +
                  "        CASE " +
                  "            WHEN MAX(CASE WHEN prev.user_id IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 'RETAINER' "
                  +
                  "            ELSE 'NEW_USER' " +
                  "        END AS user_type " +
                  "    FROM student_session_institute_group_mapping curr " +
                  "    LEFT JOIN student_session_institute_group_mapping prev " +
                  "        ON prev.user_id = curr.user_id " +
                  "        AND prev.institute_id = :instituteId " +
                  "        AND prev.status = 'ACTIVE' " +
                  "        AND prev.created_at < :startDate " +
                  "    WHERE curr.institute_id = :instituteId " +
                  "        AND curr.status = 'ACTIVE' " +
                  "        AND curr.created_at BETWEEN :startDate AND :endDate " +
                  "        AND (:packageSessionSize = 0 OR curr.package_session_id IN (:packageSessionIds)) "
                  +
                  "    GROUP BY curr.user_id " +
                  ") " +
                  "SELECT COUNT(*) " +
                  "FROM user_mappings um " +
                  "WHERE (:userTypeSize = 0 OR um.user_type IN (:userTypes)) ", nativeQuery = true)
  Page<Object[]> findUserStatsWithTypePaginated(
          @Param("instituteId") String instituteId,
          @Param("startDate") Date startDate,
          @Param("endDate") Date endDate,
          @Param("packageSessionIds") List<String> packageSessionIds,
          @Param("packageSessionSize") int packageSessionSize,
          @Param("userTypes") List<String> userTypes,
          @Param("userTypeSize") int userTypeSize,
          Pageable pageable);

  void deleteAllInBatch(Iterable<StudentSessionInstituteGroupMapping> entities);

  List<StudentSessionInstituteGroupMapping> findAllByUserPlanIdAndStatusIn(String userPlanId, List<String> status);

  void deleteByUserIdAndPackageSessionIdAndSourceAndTypeAndTypeIdAndInstituteId(String userId,
                                                                                String packageSessionId,
                                                                                String source, String type, String typeId, String instituteId);

  /**
   * Hard-delete previous ABANDONED_CART / PAYMENT_FAILED entries for a user when
   * re-enrolling. Using soft-delete (UPDATE status='DELETED') causes a unique
   * constraint violation on uq_dest_pkg_inst_user_status when the same user makes
   * a 3rd+ enrollment attempt (a DELETED row already exists from a prior cleanup).
   */
  @Modifying
  @Transactional
  @Query(value = "DELETE FROM student_session_institute_group_mapping " +
          "WHERE user_id = :userId " +
          "AND package_session_id = :packageSessionId " +
          "AND destination_package_session_id = :destinationPackageSessionId " +
          "AND institute_id = :instituteId " +
          "AND type IN (:types) " +
          "AND status != 'DELETED'", nativeQuery = true)
  int markEntriesAsDeleted(
          @Param("userId") String userId,
          @Param("packageSessionId") String packageSessionId,
          @Param("destinationPackageSessionId") String destinationPackageSessionId,
          @Param("instituteId") String instituteId,
          @Param("types") List<String> types);

  /**
   * Find entries by user, institute, and destination package session with
   * specific types and statuses.
   */
  @Query("SELECT s FROM StudentSessionInstituteGroupMapping s " +
          "WHERE s.userId = :userId " +
          "AND s.destinationPackageSession.id = :destinationPackageSessionId " +
          "AND s.institute.id = :instituteId " +
          "AND s.type IN :types " +
          "AND s.status IN :statuses")
  List<StudentSessionInstituteGroupMapping> findByUserAndDestinationAndTypeAndStatus(
          @Param("userId") String userId,
          @Param("destinationPackageSessionId") String destinationPackageSessionId,
          @Param("instituteId") String instituteId,
          @Param("types") List<String> types,
          @Param("statuses") List<String> statuses);

  /**
   * Find entries by user, package session, destination, type, and status.
   * Used by workflow to find ABANDONED_CART entries.
   */
  @Query("SELECT s FROM StudentSessionInstituteGroupMapping s " +
          "WHERE s.userId = :userId " +
          "AND s.packageSession.id = :packageSessionId " +
          "AND s.destinationPackageSession.id = :destinationPackageSessionId " +
          "AND s.type = :type " +
          "AND s.status = :status")
  List<StudentSessionInstituteGroupMapping> findByUserAndPackageSessionAndDestinationAndTypeAndStatus(
          @Param("userId") String userId,
          @Param("packageSessionId") String packageSessionId,
          @Param("destinationPackageSessionId") String destinationPackageSessionId,
          @Param("type") String type,
          @Param("status") String status);

  /**
   * Find entries by user, destination package session, and status list.
   * Used for updating ABANDONED_CART entries with userPlanId.
   */
  List<StudentSessionInstituteGroupMapping> findByUserIdAndDestinationPackageSession_IdAndStatusIn(
          String userId,
          String destinationPackageSessionId,
          List<String> statuses);

  /**
   * Existing ACTIVE enrollment of a user in a package session -- used to avoid creating a
   * duplicate row. Scoped to ACTIVE only (not any status) so a legitimate re-enrollment after a
   * prior CANCELLED/INACTIVE row is unaffected -- that's the same "new row per re-enrollment"
   * pattern the existing re-enroll-learner endpoint already relies on.
   */
  List<StudentSessionInstituteGroupMapping> findByUserIdAndPackageSession_IdAndStatus(
          String userId,
          String packageSessionId,
          String status);

  /**
   * This learner's most recent row in ONE package session, whatever its status. Used by the
   * enrollment repair to find a lapsed membership worth reviving: a revoked trial leaves an
   * INACTIVE or DELETED row, and reviving that one keeps the learner's enrollment number,
   * sub-org and roles instead of minting a parallel record.
   *
   * <p>Per session rather than across a list, because an invite can cover several package
   * sessions and the learner is owed an enrollment in each -- picking one row for the whole
   * invite would enroll them in one course and quietly skip the rest.
   *
   * <p>NULLS LAST is deliberate: Postgres orders DESC with nulls FIRST, so a legacy row with no
   * created_at would outrank every real one and get revived instead of the newest.
   */
  @Query(value = """
          SELECT m.* FROM student_session_institute_group_mapping m
          WHERE m.user_id = :userId
            AND m.package_session_id = :packageSessionId
          ORDER BY m.created_at DESC NULLS LAST
          LIMIT 1
          """, nativeQuery = true)
  Optional<StudentSessionInstituteGroupMapping> findLatestForUserInPackageSession(
          @Param("userId") String userId,
          @Param("packageSessionId") String packageSessionId);
}
