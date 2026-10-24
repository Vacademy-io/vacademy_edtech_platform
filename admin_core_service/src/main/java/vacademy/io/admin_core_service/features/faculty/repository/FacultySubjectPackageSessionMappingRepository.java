package vacademy.io.admin_core_service.features.faculty.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.faculty.dto.FacultyBatchSubjectFlatRow;
import vacademy.io.admin_core_service.features.faculty.dto.UserSubOrgLinkRow;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.slide.entity.Option;

import java.util.List;
import java.util.Optional;
import java.util.Set;

public interface FacultySubjectPackageSessionMappingRepository
    extends JpaRepository<FacultySubjectPackageSessionMapping, String> {

  // findByFilters excludes rows carrying a suborg_id: those are sub-org admin/team/learner
  // access grants, not real teachers of the batch. Sub-org admins get their own view via
  // findByFiltersScopedToSubOrgs, and the two predicates partition the table cleanly
  // (suborg_id IS NULL here, suborg_id IN (:suborgIds) there).
  //
  // Keyed on suborg_id rather than linkage_type on purpose: linkage_type serves unrelated
  // use cases and a handful of legacy rows carry a suborg_id under other linkage values, so
  // suborg_id is the only reliable answer to "does this row belong to a sub-org".
  //
  // NOTE: keep prose OUT of the @Query string. Spring Data scans the raw query text for quote
  // characters and does NOT understand SQL `--` comments, so a single apostrophe inside a
  // comment (e.g. "the org's name") opens a quoted range that never closes and the repository
  // bean fails to build at startup ("starts a quoted range at N, but never ends it").
  @Query(value = """
      SELECT DISTINCT ON (fm.user_id) fm.*
      FROM faculty_subject_package_session_mapping fm
      WHERE (
          (fm.access_type = 'Package' AND EXISTS (SELECT 1 FROM package_institute pi WHERE pi.package_id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'PACKAGE_SESSION' AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'EnrollInvite' AND EXISTS (SELECT 1 FROM enroll_invite ei WHERE ei.id = fm.access_id AND ei.institute_id = :instituteId))
          OR ((fm.access_type IS NULL OR fm.access_type NOT IN ('Package', 'PACKAGE_SESSION', 'EnrollInvite')) AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.package_session_id AND pi.institute_id = :instituteId))
      )
        AND fm.suborg_id IS NULL
        AND (CAST(:hasSubjectIds AS boolean) = false OR fm.subject_id IN (:subjectIds))
        AND (CAST(:hasBatchesIds AS boolean) = false OR (
            (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id IN (:batchesIds)) OR
            (fm.package_session_id IN (:batchesIds))
        ))
        AND (CAST(:hasStatusList AS boolean) = false OR fm.status IN (:statusList))
        AND (:name IS NULL OR CAST(:name AS text) = '' OR LOWER(fm.name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')))
      ORDER BY fm.user_id, fm.updated_at DESC
      """, countQuery = """
      SELECT COUNT(DISTINCT fm.user_id)
      FROM faculty_subject_package_session_mapping fm
      WHERE (
          (fm.access_type = 'Package' AND EXISTS (SELECT 1 FROM package_institute pi WHERE pi.package_id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'PACKAGE_SESSION' AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'EnrollInvite' AND EXISTS (SELECT 1 FROM enroll_invite ei WHERE ei.id = fm.access_id AND ei.institute_id = :instituteId))
          OR ((fm.access_type IS NULL OR fm.access_type NOT IN ('Package', 'PACKAGE_SESSION', 'EnrollInvite')) AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.package_session_id AND pi.institute_id = :instituteId))
      )
        AND fm.suborg_id IS NULL
        AND (CAST(:hasSubjectIds AS boolean) = false OR fm.subject_id IN (:subjectIds))
        AND (CAST(:hasBatchesIds AS boolean) = false OR (
            (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id IN (:batchesIds)) OR
            (fm.package_session_id IN (:batchesIds))
        ))
        AND (CAST(:hasStatusList AS boolean) = false OR fm.status IN (:statusList))
        AND (:name IS NULL OR CAST(:name AS text) = '' OR LOWER(fm.name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')))
      """, nativeQuery = true)
  Page<FacultySubjectPackageSessionMapping> findByFilters(
      @Param("instituteId") String instituteId,
      @Param("name") String name,
      @Param("subjectIds") List<String> subjects,
      @Param("batchesIds") List<String> batches,
      @Param("statusList") List<String> status,
      @Param("hasSubjectIds") boolean hasSubjectIds,
      @Param("hasBatchesIds") boolean hasBatchesIds,
      @Param("hasStatusList") boolean hasStatusList,
      Pageable pageable);

  // Sub-org-scoped variant of findByFilters. Restricts results to FSPSSM rows whose
  // suborg_id is in the supplied set. Used when a sub-org admin opens a course-details
  // faculty list — they should see only teachers attached to their own sub-org for that PS.
  @Query(value = """
      SELECT DISTINCT ON (fm.user_id) fm.*
      FROM faculty_subject_package_session_mapping fm
      WHERE (
          (fm.access_type = 'Package' AND EXISTS (SELECT 1 FROM package_institute pi WHERE pi.package_id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'PACKAGE_SESSION' AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'EnrollInvite' AND EXISTS (SELECT 1 FROM enroll_invite ei WHERE ei.id = fm.access_id AND ei.institute_id = :instituteId))
          OR ((fm.access_type IS NULL OR fm.access_type NOT IN ('Package', 'PACKAGE_SESSION', 'EnrollInvite')) AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.package_session_id AND pi.institute_id = :instituteId))
      )
        AND fm.suborg_id IN (:suborgIds)
        AND (CAST(:hasSubjectIds AS boolean) = false OR fm.subject_id IN (:subjectIds))
        AND (CAST(:hasBatchesIds AS boolean) = false OR (
            (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id IN (:batchesIds)) OR
            (fm.package_session_id IN (:batchesIds))
        ))
        AND (CAST(:hasStatusList AS boolean) = false OR fm.status IN (:statusList))
        AND (:name IS NULL OR CAST(:name AS text) = '' OR LOWER(fm.name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')))
      ORDER BY fm.user_id, fm.updated_at DESC
      """, countQuery = """
      SELECT COUNT(DISTINCT fm.user_id)
      FROM faculty_subject_package_session_mapping fm
      WHERE (
          (fm.access_type = 'Package' AND EXISTS (SELECT 1 FROM package_institute pi WHERE pi.package_id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'PACKAGE_SESSION' AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.access_id AND pi.institute_id = :instituteId))
          OR (fm.access_type = 'EnrollInvite' AND EXISTS (SELECT 1 FROM enroll_invite ei WHERE ei.id = fm.access_id AND ei.institute_id = :instituteId))
          OR ((fm.access_type IS NULL OR fm.access_type NOT IN ('Package', 'PACKAGE_SESSION', 'EnrollInvite')) AND EXISTS (SELECT 1 FROM package_session ps JOIN package_institute pi ON ps.package_id = pi.package_id WHERE ps.id = fm.package_session_id AND pi.institute_id = :instituteId))
      )
        AND fm.suborg_id IN (:suborgIds)
        AND (CAST(:hasSubjectIds AS boolean) = false OR fm.subject_id IN (:subjectIds))
        AND (CAST(:hasBatchesIds AS boolean) = false OR (
            (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id IN (:batchesIds)) OR
            (fm.package_session_id IN (:batchesIds))
        ))
        AND (CAST(:hasStatusList AS boolean) = false OR fm.status IN (:statusList))
        AND (:name IS NULL OR CAST(:name AS text) = '' OR LOWER(fm.name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')))
      """, nativeQuery = true)
  Page<FacultySubjectPackageSessionMapping> findByFiltersScopedToSubOrgs(
      @Param("instituteId") String instituteId,
      @Param("name") String name,
      @Param("subjectIds") List<String> subjects,
      @Param("batchesIds") List<String> batches,
      @Param("statusList") List<String> status,
      @Param("suborgIds") List<String> suborgIds,
      @Param("hasSubjectIds") boolean hasSubjectIds,
      @Param("hasBatchesIds") boolean hasBatchesIds,
      @Param("hasStatusList") boolean hasStatusList,
      Pageable pageable);

  Optional<FacultySubjectPackageSessionMapping> findByUserIdAndPackageSessionIdAndSubjectIdAndStatusIn(String userId,
      String packageSessionId, String subjectId, List<String> status);

  // Course-level instructor rows (Add Course -> Authors) are stored with subject_id NULL.
  // List, not Optional: addFacultyToBatch never de-duplicates, so more than one can exist.
  List<FacultySubjectPackageSessionMapping> findAllByUserIdAndPackageSessionIdAndSubjectIdIsNullAndStatusIn(
      String userId, String packageSessionId, List<String> status);

  @Query(value = """
      SELECT
          fspm.user_id AS facultyId,
          fspm.package_session_id AS batchId,
          fspm.subject_id AS subjectId,
          FALSE AS isNewAssignment
      FROM
          faculty_subject_package_session_mapping fspm
      JOIN
          package_session ps ON ps.id = fspm.package_session_id
      JOIN
          subject s ON s.id = fspm.subject_id
      WHERE
          fspm.user_id = :userId
          AND fspm.status IN (:fspmStatusList)
          AND ps.status IN (:packageSessionStatusList)
          AND s.status IN (:subjectStatusList)
      """, nativeQuery = true)
  List<FacultyBatchSubjectFlatRow> findFacultyBatchSubjectsFiltered(
      @Param("userId") String userId,
      @Param("fspmStatusList") List<String> fspmStatusList,
      @Param("packageSessionStatusList") List<String> packageSessionStatusList,
      @Param("subjectStatusList") List<String> subjectStatusList);

  @Query("""
          SELECT DISTINCT fsp.userId
          FROM FacultySubjectPackageSessionMapping fsp
          LEFT JOIN Subject s ON fsp.subjectId = s.id
          JOIN PackageSession ps ON fsp.packageSessionId = ps.id
          WHERE ps.level.id = :levelId
            AND ps.session.id = :sessionId
            AND ps.packageEntity.id = :packageId
            AND ps.status IN :packageSessionStatuses
            AND fsp.status IN :mappingStatuses
            AND fsp.suborgId IS NULL
            AND (
                 fsp.subjectId IS NULL
                 OR s.status IN :subjectStatuses
            )
      """)
  List<String> findDistinctUserIdsByLevelSessionPackageAndStatuses(
      @Param("levelId") String levelId,
      @Param("sessionId") String sessionId,
      @Param("packageId") String packageId,
      @Param("packageSessionStatuses") List<String> packageSessionStatuses,
      @Param("mappingStatuses") List<String> mappingStatuses,
      @Param("subjectStatuses") List<String> subjectStatuses);

  List<FacultySubjectPackageSessionMapping> findByUserId(String userId);

  @Query("""
          SELECT fsp
          FROM FacultySubjectPackageSessionMapping fsp
          WHERE fsp.userId = :userId
            AND fsp.packageSessionId = :packageSessionId
            AND fsp.status IN :mappingStatuses
            AND fsp.subjectId IS NULL
      """)
  Optional<FacultySubjectPackageSessionMapping> findMappingsByUserIdAndPackageSessionIdAndStatusesWithNoSubject(
      @Param("userId") String userId,
      @Param("packageSessionId") String packageSessionId,
      @Param("mappingStatuses") List<String> mappingStatuses);

  // Returns every row on the package session, sub-org access grants included. Callers that mean
  // "the teachers of this batch" want findRealTeachersByPackageSessionId instead; this one exists
  // for callers that must see the rows verbatim (e.g. copying a package session).
  @Query("SELECT fspm FROM FacultySubjectPackageSessionMapping fspm WHERE fspm.packageSessionId = :packageSessionId")
  List<FacultySubjectPackageSessionMapping> findByPackageSessionId(
      @Param("packageSessionId") String packageSessionId);

  // Real teachers of the batch: excludes sub-org access grants (suborg_id set).
  @Query("SELECT fspm FROM FacultySubjectPackageSessionMapping fspm WHERE fspm.packageSessionId = :packageSessionId AND fspm.suborgId IS NULL")
  List<FacultySubjectPackageSessionMapping> findRealTeachersByPackageSessionId(
      @Param("packageSessionId") String packageSessionId);

  @Query("SELECT fspm FROM FacultySubjectPackageSessionMapping fspm WHERE fspm.packageSessionId = :packageSessionId AND fspm.subjectId = :subjectId")
  List<FacultySubjectPackageSessionMapping> findByPackageSessionIdAndSubjectId(
      @Param("packageSessionId") String packageSessionId,
      @Param("subjectId") String subjectId);

  /**
   * Resolve the institute that owns a package session, by walking
   * package_session → package_institute. Returns the first match; a package may only belong to a
   * single institute, so the limit is defensive.
   */
  @Query(value = """
      SELECT pi.institute_id
      FROM package_institute pi
      JOIN package_session ps ON ps.package_id = pi.package_id
      WHERE ps.id = :packageSessionId
      LIMIT 1
      """, nativeQuery = true)
  Optional<String> findInstituteIdByPackageSessionId(
      @Param("packageSessionId") String packageSessionId);

  /**
   * Get distinct user IDs by package session ID and active statuses - for
   * notification service
   */
  @Query("SELECT DISTINCT fspm.userId FROM FacultySubjectPackageSessionMapping fspm WHERE fspm.packageSessionId = :packageSessionId AND fspm.status IN :activeStatuses AND fspm.suborgId IS NULL")
  List<String> findUserIdsByPackageSessionId(@Param("packageSessionId") String packageSessionId,
      @Param("activeStatuses") List<String> activeStatuses);

  // WHERE (:name IS NULL OR :name = '' OR LOWER(a.name) LIKE LOWER(CONCAT('%',
  // :name, '%')))

  @Query("""
          SELECT DISTINCT f.userId
          FROM FacultySubjectPackageSessionMapping f
          JOIN PackageSession ps ON ps.id = f.packageSessionId
          JOIN PackageInstitute pi ON pi.packageEntity.id = ps.packageEntity.id
          WHERE pi.instituteEntity.id = :instituteId
            AND ps.status IN :statusList
            AND f.status IN :statusList
            AND ps.packageEntity.status IN :statusList
            AND f.suborgId IS NULL
      """)
  Set<String> findUserIdsByFilters(
      @Param("instituteId") String instituteId,
      @Param("statusList") List<String> statusList);

  @Query(value = """
      SELECT DISTINCT ps_id FROM (
          SELECT f.access_id AS ps_id
          FROM faculty_subject_package_session_mapping f
          JOIN package_session ps ON ps.id = f.access_id
          JOIN package_institute pi ON pi.package_id = ps.package_id
          WHERE f.user_id = :userId
            AND f.access_type = 'PACKAGE_SESSION'
            AND pi.institute_id = :instituteId
            AND f.status IN (:statusList)
            AND ps.status IN (:statusList)
          UNION
          SELECT f.package_session_id AS ps_id
          FROM faculty_subject_package_session_mapping f
          JOIN package_session ps ON ps.id = f.package_session_id
          JOIN package_institute pi ON pi.package_id = ps.package_id
          WHERE f.user_id = :userId
            AND (f.access_type IS NULL OR f.access_type NOT IN ('Package', 'EnrollInvite'))
            AND f.package_session_id IS NOT NULL
            AND pi.institute_id = :instituteId
            AND f.status IN (:statusList)
            AND ps.status IN (:statusList)
      ) combined
      """, nativeQuery = true)
  List<String> findAccessIdsByUserIdAndInstituteId(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId,
      @Param("statusList") List<String> statusList);

  /**
   * access_ids a user already holds under ONE sub-org, for whichever statuses are asked.
   *
   * <p>Used to make assignment idempotent: re-assigning somebody to a channel partner they
   * already cover must not stack a second set of rows. Deliberately unfiltered by
   * access_type — both the PACKAGE_SESSION and ENROLL_INVITE grants live in the same
   * column and both need the duplicate check.
   */
  @Query(value = """
      SELECT DISTINCT f.access_id
      FROM faculty_subject_package_session_mapping f
      WHERE f.user_id = :userId
        AND f.suborg_id = :subOrgId
        AND f.linkage_type = 'SUB_ORG'
        AND f.access_id IS NOT NULL
        AND f.status IN (:statusList)
      """, nativeQuery = true)
  List<String> findAccessIdsByUserIdAndSubOrgId(
      @Param("userId") String userId,
      @Param("subOrgId") String subOrgId,
      @Param("statusList") List<String> statusList);

  @Query(value = """
      SELECT DISTINCT f.access_id
      FROM faculty_subject_package_session_mapping f
      WHERE f.user_id = :userId
        AND f.access_type = 'ENROLL_INVITE'
        AND f.status IN (:statusList)
        AND EXISTS (
            SELECT 1 FROM enroll_invite ei
            WHERE ei.id = f.access_id
              AND ei.institute_id = :instituteId
        )
      """, nativeQuery = true)
  List<String> findEnrollInviteAccessIdsByUserIdAndInstituteId(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId,
      @Param("statusList") List<String> statusList);

  /**
   * Find the sub-org ID for a faculty member on a specific package session.
   * Returns the first active mapping's suborgId (null if no sub-org linkage).
   */
  @Query("""
          SELECT f.suborgId
          FROM FacultySubjectPackageSessionMapping f
          WHERE f.userId = :userId
            AND f.packageSessionId = :packageSessionId
            AND f.suborgId IS NOT NULL
            AND f.status = 'ACTIVE'
      """)
  List<String> findSubOrgIdsByUserAndPackageSession(
      @Param("userId") String userId,
      @Param("packageSessionId") String packageSessionId);

  // ─────────── Sub-org team management ───────────

  /**
   * Distinct user IDs that have at least one active SUB_ORG-linked FSPSSM entry for the given
   * sub-org. Used as the candidate set for the sub-org team listing.
   */
  @Query("""
          SELECT DISTINCT f.userId
          FROM FacultySubjectPackageSessionMapping f
          WHERE f.suborgId = :subOrgId
            AND f.linkageType = 'SUB_ORG'
            AND f.status IN :statuses
      """)
  List<String> findDistinctUserIdsBySubOrgIdAndLinkage(
      @Param("subOrgId") String subOrgId,
      @Param("statuses") List<String> statuses);

  /**
   * Distinct sub-org IDs the caller currently has SUB_ORG-linked FSPSSM access to. Used to
   * validate that a sub-org admin is operating on their own sub-org.
   */
  @Query("""
          SELECT DISTINCT f.suborgId
          FROM FacultySubjectPackageSessionMapping f
          WHERE f.userId = :userId
            AND f.linkageType = 'SUB_ORG'
            AND f.suborgId IS NOT NULL
            AND f.status IN :statuses
      """)
  List<String> findDistinctSubOrgIdsByUserAndLinkage(
      @Param("userId") String userId,
      @Param("statuses") List<String> statuses);

  /**
   * All FSPSSM entries for a user under a specific sub-org. Used by the remove-member flow
   * to mark the entries inactive.
   */
  @Query("""
          SELECT f
          FROM FacultySubjectPackageSessionMapping f
          WHERE f.userId = :userId
            AND f.suborgId = :subOrgId
            AND f.linkageType = 'SUB_ORG'
      """)
  List<FacultySubjectPackageSessionMapping> findByUserIdAndSubOrgIdAndLinkage(
      @Param("userId") String userId,
      @Param("subOrgId") String subOrgId);

  /**
   * Count the still-active SUB_ORG-linked FSPSSM entries for a user across the institute.
   * Used to decide whether to also drop the user's UserRole when removing them from a sub-org.
   */
  @Query("""
          SELECT COUNT(f)
          FROM FacultySubjectPackageSessionMapping f
          WHERE f.userId = :userId
            AND f.linkageType = 'SUB_ORG'
            AND f.status = 'ACTIVE'
      """)
  long countActiveSubOrgLinkagesByUser(@Param("userId") String userId);

  /**
   * Distinct (user, sub-org) pairs for the given set of sub-orgs, derived from SUB_ORG-linked
   * FSPSSM rows. Powers the "Sub-Orgs" column + filter on the institute Teams list.
   */
  @Query("""
          SELECT DISTINCT f.userId AS userId, f.suborgId AS subOrgId
          FROM FacultySubjectPackageSessionMapping f
          WHERE f.suborgId IN :subOrgIds
            AND f.linkageType = 'SUB_ORG'
            AND f.status IN :statuses
      """)
  List<UserSubOrgLinkRow> findUserSubOrgLinks(
      @Param("subOrgIds") List<String> subOrgIds,
      @Param("statuses") List<String> statuses);

  /**
   * Display role of each author per course. Every ACTIVE row of a user in the course
   * carries the same label, so MAX only collapses the duplicates.
   */
  @Query(value = """
      SELECT ps.package_id AS packageId, f.user_id AS userId, MAX(f.role_label) AS roleLabel
      FROM faculty_subject_package_session_mapping f
      JOIN package_session ps ON ps.id = f.package_session_id
      WHERE ps.package_id IN (:packageIds)
        AND f.status = 'ACTIVE'
        AND f.role_label IS NOT NULL
        AND f.role_label <> ''
      GROUP BY ps.package_id, f.user_id
      """, nativeQuery = true)
  List<vacademy.io.admin_core_service.features.faculty.dto.FacultyRoleLabelRow> findRoleLabelsByPackageIds(
      @Param("packageIds") java.util.Collection<String> packageIds);

  /**
   * Deactivate SOFT-removed sub-org members whose "last access date" has passed.
   * Only touches ACTIVE rows carrying an access_till_date in the past; returns the
   * number of rows flipped. Driven by {@code SubOrgTeamAccessExpiryJob}.
   */
  @org.springframework.data.jpa.repository.Modifying
  @Query("""
          UPDATE FacultySubjectPackageSessionMapping f
             SET f.status = 'INACTIVE'
           WHERE f.status = 'ACTIVE'
             AND f.accessTillDate IS NOT NULL
             AND f.accessTillDate < :now
      """)
  int deactivateExpiredSoftRemovals(@Param("now") java.sql.Timestamp now);
}
