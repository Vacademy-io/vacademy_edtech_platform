package vacademy.io.admin_core_service.features.packages.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.invoice.dto.InvoicePackageContextProjection;
import vacademy.io.admin_core_service.features.packages.dto.BatchProjection;
import vacademy.io.admin_core_service.features.session.dto.BatchInstituteProjection;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface PackageSessionRepository extends JpaRepository<PackageSession, String> {

    // Get all package sessions of an institute_id and of a session_id
    @Query(value = "SELECT ps.* " +
            "FROM package_session ps " +
            "JOIN package_institute pi ON ps.package_id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId AND ps.status IN (:statuses)", nativeQuery = true)
    List<PackageSession> findPackageSessionsByInstituteId(
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses);

    // Resolve the owning institute for a package_session (via package_institute).
    @Query(value = "SELECT pi.institute_id " +
            "FROM package_institute pi " +
            "JOIN package_session ps ON ps.package_id = pi.package_id " +
            "WHERE ps.id = :packageSessionId LIMIT 1", nativeQuery = true)
    Optional<String> findInstituteIdByPackageSessionId(
            @Param("packageSessionId") String packageSessionId);

    /**
     * Paginated query to fetch package sessions by institute with optional filters.
     * Supports filtering by session ID, level ID, package ID, status, and search.
     * Search performs case-insensitive partial matching on package name, level
     * name, and session name.
     * Supports sorting by package_name, level_name, session_name, or created_at.
     * 
     * Note: Uses CAST(... AS VARCHAR) to help PostgreSQL infer parameter types when
     * null.
     */
    @Query(value = "SELECT ps.* " +
            "FROM package_session ps " +
            "JOIN package_institute pi ON ps.package_id = pi.package_id " +
            "JOIN package p ON ps.package_id = p.id " +
            "JOIN level l ON ps.level_id = l.id " +
            "JOIN session s ON ps.session_id = s.id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND ps.status IN (:statuses) " +
            "AND (CAST(:sessionId AS VARCHAR) IS NULL OR ps.session_id = CAST(:sessionId AS VARCHAR)) " +
            "AND (CAST(:levelId AS VARCHAR) IS NULL OR ps.level_id = CAST(:levelId AS VARCHAR)) " +
            "AND (CAST(:packageId AS VARCHAR) IS NULL OR ps.package_id = CAST(:packageId AS VARCHAR)) " +
            "AND (CAST(:search AS VARCHAR) IS NULL OR CAST(:search AS VARCHAR) = '' OR " +
            "     LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:search AS VARCHAR), '%')) OR " +
            "     LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:search AS VARCHAR), '%')) OR " +
            "     LOWER(s.session_name) LIKE LOWER(CONCAT('%', CAST(:search AS VARCHAR), '%'))) " +
            "AND (COALESCE(:packageSessionIds) IS NULL OR ps.id IN (:packageSessionIds)) " +
            "ORDER BY " +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'package_name' AND CAST(:sortDirection AS VARCHAR) = 'ASC' THEN p.package_name END ASC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'package_name' AND CAST(:sortDirection AS VARCHAR) = 'DESC' THEN p.package_name END DESC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'level_name' AND CAST(:sortDirection AS VARCHAR) = 'ASC' THEN l.level_name END ASC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'level_name' AND CAST(:sortDirection AS VARCHAR) = 'DESC' THEN l.level_name END DESC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'session_name' AND CAST(:sortDirection AS VARCHAR) = 'ASC' THEN s.session_name END ASC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'session_name' AND CAST(:sortDirection AS VARCHAR) = 'DESC' THEN s.session_name END DESC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'created_at' AND CAST(:sortDirection AS VARCHAR) = 'ASC' THEN ps.created_at END ASC, "
            +
            "CASE WHEN CAST(:sortBy AS VARCHAR) = 'created_at' AND CAST(:sortDirection AS VARCHAR) = 'DESC' THEN ps.created_at END DESC, "
            +
            "ps.created_at DESC", countQuery = "SELECT COUNT(ps.id) " +
                    "FROM package_session ps " +
                    "JOIN package_institute pi ON ps.package_id = pi.package_id " +
                    "JOIN package p ON ps.package_id = p.id " +
                    "JOIN level l ON ps.level_id = l.id " +
                    "JOIN session s ON ps.session_id = s.id " +
                    "WHERE pi.institute_id = :instituteId " +
                    "AND ps.status IN (:statuses) " +
                    "AND (CAST(:sessionId AS VARCHAR) IS NULL OR ps.session_id = CAST(:sessionId AS VARCHAR)) " +
                    "AND (CAST(:levelId AS VARCHAR) IS NULL OR ps.level_id = CAST(:levelId AS VARCHAR)) " +
                    "AND (CAST(:packageId AS VARCHAR) IS NULL OR ps.package_id = CAST(:packageId AS VARCHAR)) " +
                    "AND (CAST(:search AS VARCHAR) IS NULL OR CAST(:search AS VARCHAR) = '' OR " +
                    "     LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:search AS VARCHAR), '%')) OR " +
                    "     LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:search AS VARCHAR), '%')) OR " +
                    "     LOWER(s.session_name) LIKE LOWER(CONCAT('%', CAST(:search AS VARCHAR), '%'))) " +
                    "AND (COALESCE(:packageSessionIds) IS NULL OR ps.id IN (:packageSessionIds))", nativeQuery = true)
    Page<PackageSession> findPackageSessionsByInstituteIdPaginated(
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses,
            @Param("sessionId") String sessionId,
            @Param("levelId") String levelId,
            @Param("packageId") String packageId,
            @Param("search") String search,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("sortBy") String sortBy,
            @Param("sortDirection") String sortDirection,
            Pageable pageable);

    /**
     * Fetch package sessions by specific IDs for batch lookup.
     * Used for ID resolution (displaying selected filter badges, showing batch
     * names in tables).
     */
    @Query(value = "SELECT ps.* " +
            "FROM package_session ps " +
            "JOIN package_institute pi ON ps.package_id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND ps.id IN (:ids)", nativeQuery = true)
    List<PackageSession> findPackageSessionsByInstituteIdAndIds(
            @Param("instituteId") String instituteId,
            @Param("ids") List<String> ids);

    @Query(value = "SELECT ps.id, ps.level_id, ps.session_id, ps.start_time, ps.updated_at, ps.created_at, ps.status, ps.package_id, ps.group_id, ps.is_org_associated, ps.available_slots "
            +
            "FROM package_session ps " +
            "JOIN package p ON ps.package_id = p.id " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId AND ps.session_id = :sessionId", nativeQuery = true)
    List<PackageSession> findPackageSessionsByInstituteIdAndSessionId(
            @Param("instituteId") String instituteId, @Param("sessionId") String sessionId);

    @Query("SELECT ps FROM PackageSession ps " +
            "WHERE ps.packageEntity.id = :packageId " +
            "AND ps.session.id = :sessionId " +
            "ORDER BY ps.updatedAt DESC LIMIT 1")
    Optional<PackageSession> findLatestPackageSessionByPackageIdAndSessionId(String packageId, String sessionId);

    @Query(value = "SELECT COUNT(ps.id) " +
            "FROM package_session ps " +
            "JOIN package p ON ps.package_id = p.id " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND ps.status IN (:statusList)", nativeQuery = true)
    Long findCountPackageSessionsByInstituteIdAndStatusIn(
            @Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList);

    @Modifying
    @Transactional
    @Query("UPDATE PackageSession ps SET ps.status = :status WHERE ps.packageEntity.id IN :packageIds")
    void updateStatusByPackageIds(@Param("status") String status, @Param("packageIds") List<String> packageIds);

    @Modifying
    @Transactional
    @Query("UPDATE PackageSession ps SET ps.status = :status WHERE ps.level.id IN :levelIds")
    void updateStatusByLevelIds(@Param("status") String status, @Param("levelIds") List<String> levelIds);

    @Modifying
    @Transactional
    @Query("UPDATE PackageSession ps SET ps.status = :newStatus WHERE ps.id IN :packageSessionIds")
    int updateStatusByPackageSessionIds(@Param("newStatus") String newStatus,
            @Param("packageSessionIds") String[] packageSessionIds);

    @Modifying
    @Query("UPDATE PackageSession ps SET ps.status = :status WHERE ps.session.id IN :sessionIds")
    void updateStatusBySessionIds(@Param("sessionIds") List<String> sessionIds, @Param("status") String status);

    @Query("""
            SELECT pi.packageEntity
            FROM PackageInstitute pi
            JOIN pi.packageEntity p
            JOIN PackageSession ps ON ps.packageEntity.id = pi.packageEntity.id
            WHERE ps.session.id = :sessionId
              AND pi.instituteEntity.id = :instituteId
              AND ps.status IN :statuses
            """)
    List<PackageEntity> findPackagesBySessionIdAndStatuses(
            @Param("sessionId") String sessionId,
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses);

    /**
     * Batch cards for one course: name, status, learner count and the invite code
     * to share.
     *
     * <p>Two things this deliberately does not do, both of which used to leave the
     * Manage Batches page unusable for institutes whose data was migrated in bulk:
     *
     * <ul>
     * <li><b>It does not throw away the batch name.</b> The title used to be
     * level + course. An institute migrated in bulk carries the level name
     * "default" on every session, so every batch of a course rendered with an
     * identical title and nothing on the page told them apart - while
     * package_session.name held the real, distinct name all along. The name wins
     * when it is set; the placeholder names "DEFAULT" and "General" fall back to
     * level + course, which is what those institutes already see today.
     * <li><b>It does not require a DEFAULT-tagged invite.</b> The tag is a
     * preference in the ORDER BY, not a filter. Requiring it blanked the invite
     * code on every batch of an institute whose invites carry no tag - 2,935 of
     * them on one - even though those invites were ACTIVE and usable. Note the
     * code is per invite, not per batch, so batches sharing a course-level invite
     * legitimately show the same code.
     * </ul>
     *
     * <p>Prose stays here rather than inside the query text: an apostrophe in a SQL
     * comment inside a {@code @Query} string crash-loops the service at boot.
     */
    @Query(value = """
            SELECT
                ps.id AS packageSessionId,
                CASE
                    WHEN COALESCE(TRIM(ps.name), '') <> ''
                     AND UPPER(TRIM(ps.name)) NOT IN ('DEFAULT', 'GENERAL')
                    THEN ps.name
                    ELSE CONCAT(l.level_name, ' ', p.package_name)
                END AS batchName,
                ps.status AS batchStatus,
                ps.start_time AS startDate,
                COUNT(ssigm.id) AS countStudents,
                (SELECT ei.invite_code
                   FROM package_session_learner_invitation_to_payment_option psli
                   JOIN enroll_invite ei ON ei.id = psli.enroll_invite_id
                  WHERE psli.package_session_id = ps.id
                    AND psli.status = 'ACTIVE'
                    AND ei.status = 'ACTIVE'
                  ORDER BY (ei.tag = 'DEFAULT') DESC NULLS LAST, ei.created_at DESC
                  LIMIT 1) AS inviteCode,
                ps.is_parent AS isParent,
                ps.parent_id AS parentId
            FROM package_session ps
            JOIN level l ON l.id = ps.level_id
            JOIN package p ON p.id = ps.package_id
            LEFT JOIN student_session_institute_group_mapping ssigm
                ON ssigm.package_session_id = ps.id
                AND ssigm.status IN (:studentSessionStatuses)
            WHERE p.id = :packageId
              AND ps.status IN (:packageSessionStatuses)
            GROUP BY ps.id, ps.name, l.level_name, p.package_name, ps.status, ps.start_time, ps.is_parent, ps.parent_id
            ORDER BY ps.start_time DESC
            """, nativeQuery = true)
    List<BatchProjection> findBatchDetailsWithLatestInviteCode(
            @Param("packageId") String packageId,
            @Param("packageSessionStatuses") List<String> packageSessionStatuses,
            @Param("studentSessionStatuses") List<String> studentSessionStatuses);

    @Query("""
                SELECT
                    CASE WHEN p.packageName LIKE CONCAT(l.levelName, '%')
                         THEN p.packageName
                         ELSE CONCAT(l.levelName, ' ', p.packageName) END AS batchName,
                    i.instituteName AS instituteName,
                    i.id AS instituteId,
                    i.logoFileId AS instituteLogoFileId,
                    i.instituteThemeCode AS instituteThemeCode
                FROM PackageSession ps
                JOIN ps.level l
                JOIN ps.packageEntity p
                JOIN PackageInstitute pi ON pi.packageEntity.id = p.id
                JOIN pi.instituteEntity i
                WHERE ps.id = :packageSessionId
            """)
    Optional<BatchInstituteProjection> findBatchAndInstituteByPackageSessionId(
            @Param("packageSessionId") String packageSessionId);

    @Query("""
                SELECT
                    p.id          AS packageId,
                    p.packageName AS packageName,
                    l.id          AS levelId,
                    l.levelName   AS levelName,
                    ps.session.id          AS sessionId,
                    ps.session.sessionName AS sessionName
                FROM PackageSession ps
                JOIN ps.level l
                JOIN ps.packageEntity p
                WHERE ps.id = :packageSessionId
            """)
    Optional<InvoicePackageContextProjection> findPackageAndLevelByPackageSessionId(
            @Param("packageSessionId") String packageSessionId);

    @Query("SELECT ps FROM PackageSession ps WHERE ps.packageEntity.id IN :packageIds")
    List<PackageSession> findAllByPackageIds(@Param("packageIds") List<String> packageIds);

    @Query("SELECT ps FROM PackageSession ps WHERE ps.session.id IN :sessionIds")
    List<PackageSession> findBySessionIds(@Param("sessionIds") List<String> sessionIds);

    @Query("SELECT ps FROM PackageSession ps WHERE ps.level.id IN :levelIds")
    List<PackageSession> findByLevelIds(@Param("levelIds") List<String> levelIds);

    @Query("""
                SELECT ps
                FROM PackageSession ps
                WHERE ps.level.id = :levelId
                  AND ps.session.id = :sessionId
                  AND ps.packageEntity.id = :packageEntityId
                  AND ps.status IN :statuses
                ORDER BY ps.createdAt DESC
            """)
    Optional<PackageSession> findTopByLevelIdAndSessionIdAndPackageEntityIdAndStatusesOrderByCreatedAtDesc(
            @Param("levelId") String levelId,
            @Param("sessionId") String sessionId,
            @Param("packageEntityId") String packageEntityId,
            @Param("statuses") List<String> statuses);

    Optional<PackageSession> findByPackageEntityIdAndSessionIdAndLevelId(String packageId, String sessionId,
            String levelId);

    @Query(value = """
            SELECT ps.*
            FROM package_session ps
            WHERE ps.id IN (:packageSessionIds)
            """, nativeQuery = true)
    List<PackageSession> findPackageSessionsByIds(@Param("packageSessionIds") List<String> packageSessionIds);

    // Add method for finding package sessions by package entity ID
    @Query("SELECT ps FROM PackageSession ps WHERE ps.packageEntity.id = :packageEntityId")
    List<PackageSession> findByPackageEntityId(@Param("packageEntityId") String packageEntityId);

    @Query(value = """
                SELECT ps2.*
                FROM package_session ps2
                JOIN package_session ps1 ON ps1.id = :packageSessionId
                WHERE ps2.package_id = ps1.package_id
                  AND ps2.level_id = :levelId
                  AND ps2.session_id = :sessionId
                  AND ps2.status IN (:invitedPackageSessionStatuses)
                  AND ps1.status IN (:packageSessionStatuses)
                  AND ps2.package_id IN (
                      SELECT p.id
                      FROM package p
                      WHERE p.id = ps2.package_id
                      AND p.status IN (:packageStatuses)
                  )
                ORDER BY ps2.created_at DESC
                LIMIT 1
            """, nativeQuery = true)
    Optional<PackageSession> findInvitedPackageSessionForPackage(
            @Param("packageSessionId") String packageSessionId,
            @Param("levelId") String levelId,
            @Param("sessionId") String sessionId,
            @Param("invitedPackageSessionStatuses") List<String> invitedPackageSessionStatuses,
            @Param("packageSessionStatuses") List<String> packageSessionStatuses,
            @Param("packageStatuses") List<String> packageStatuses);

    @Query("SELECT ps FROM PackageSession ps " +
            "WHERE ps.packageEntity.id = :packageId " +
            "AND ps.session.id = :sessionId " +
            "AND ps.level.id = :levelId " +
            "AND ps.status IN :statuses")
    Optional<PackageSession> findByPackageIdAndSessionIdAndLevelIdAndStatusIn(
            @Param("packageId") String packageId,
            @Param("sessionId") String sessionId,
            @Param("levelId") String levelId,
            @Param("statuses") List<String> statuses);

    Optional<PackageSession> findByPackageEntity_IdAndLevel_IdAndSession_IdAndStatusIn(
            String packageId,
            String levelId,
            String sessionId,
            List<String> status);

    @Query("""
                SELECT ps
                FROM PackageSession ps
                WHERE ps.packageEntity.id IN :packageIds
                  AND ps.status = 'INVITED'
            """)
    List<PackageSession> findAllInvitedByPackageIds(@Param("packageIds") Set<String> packageIds);

    /**
     * Autocomplete search for batches with relevance scoring.
     *
     * Matches any part of the course name (substring), not just a prefix, so the batch filter
     * finds "Advanced Nursing Care" from "nursing". Relevance still ranks an exact name first,
     * then a prefix match, then a match that starts a word inside the name, then any substring.
     *
     * It also matches, and returns, the batch's OWN name (package_session.name). An institute
     * whose batches are all one course could not find a single one of them here: every row the
     * search returned carried the same course name and the same level name, so the picker showed
     * a column of identical entries and typing the batch name found nothing at all.
     *
     * The selective predicate here is package_institute.institute_id (idx_package_institute_access),
     * which bounds the scan to one institute's packages before the name filter runs — the
     * LOWER(package_name) b-tree from V84 no longer helps a leading-wildcard LIKE. The added
     * batch-name match is OR-ed into that same already-bounded row set, so it costs no extra scan.
     */
    @Query(value = """
                        SELECT
                            ps.id AS packageSessionId,
                p.id AS packageId,
                p.package_name AS packageName,
                l.id AS levelId,
                l.level_name AS levelName,
                s.id AS sessionId,
                s.session_name AS sessionName,
                ps.name AS batchName,
                CASE
                    WHEN LOWER(p.package_name) = LOWER(:query) THEN 100
                    WHEN LOWER(COALESCE(ps.name, '')) = LOWER(:query) THEN 100
                    WHEN LOWER(p.package_name) LIKE LOWER(CONCAT(:query, '%')) THEN 90
                    WHEN LOWER(COALESCE(ps.name, '')) LIKE LOWER(CONCAT(:query, '%')) THEN 90
                    WHEN LOWER(p.package_name) LIKE LOWER(CONCAT('% ', :query, '%')) THEN 80
                    ELSE 70
                END AS matchScore
            FROM package_session ps
            JOIN package p ON ps.package_id = p.id
            JOIN package_institute pi ON p.id = pi.package_id
            JOIN level l ON ps.level_id = l.id
            JOIN session s ON ps.session_id = s.id
                        WHERE
                            pi.institute_id = :instituteId
                            AND (LOWER(p.package_name) LIKE LOWER(CONCAT('%', :query, '%'))
                                 OR LOWER(COALESCE(ps.name, '')) LIKE LOWER(CONCAT('%', :query, '%')))
                            AND (:sessionId IS NULL OR :sessionId = '' OR ps.session_id = :sessionId)
                            AND (:levelId IS NULL OR :levelId = '' OR ps.level_id = :levelId)
                            AND ps.status IN ('ACTIVE', 'HIDDEN','DRAFT')
                        ORDER BY matchScore DESC, p.package_name ASC, ps.name ASC
                        LIMIT :limit
                        """, nativeQuery = true)
    List<vacademy.io.admin_core_service.features.packages.dto.PackageAutocompleteProjection> autocompletePackages(
            @Param("query") String query,
            @Param("instituteId") String instituteId,
            @Param("sessionId") String sessionId,
            @Param("levelId") String levelId,
            @Param("limit") int limit);

    List<PackageSession> findByPackageEntity_IdAndStatus(String packageId, String status);

    interface PackageSessionDetailProjection {
        String getPackageSessionId();
        String getPackageName();
        String getLevelName();
        String getSessionName();
    }

    @Query(value = """
            SELECT ps.id AS packageSessionId,
                   p.package_name AS packageName,
                   l.level_name AS levelName,
                   s.session_name AS sessionName
            FROM package_session ps
            JOIN package p ON ps.package_id = p.id
            JOIN level l ON ps.level_id = l.id
            JOIN session s ON ps.session_id = s.id
            WHERE ps.id IN (:ids)
            """, nativeQuery = true)
    List<PackageSessionDetailProjection> findPackageSessionDetailsByIds(@Param("ids") List<String> ids);

    interface BatchNameProjection {
        String getPackageSessionId();
        String getPackageName();
        String getLevelId();
        String getLevelName();
    }

    /**
     * Batch display-name components for the given package sessions. LEFT JOINs (vs. the INNER JOINs
     * of findPackageSessionDetailsByIds) so a batch whose level/package row is missing is still
     * returned rather than silently dropped — the caller composes a name from whatever is present.
     * Includes level_id so callers can detect the canonical DEFAULT level by id, not by display name.
     */
    @Query(value = """
            SELECT ps.id AS packageSessionId,
                   p.package_name AS packageName,
                   l.id AS levelId,
                   l.level_name AS levelName
            FROM package_session ps
            LEFT JOIN package p ON ps.package_id = p.id
            LEFT JOIN level l ON ps.level_id = l.id
            WHERE ps.id IN (:ids)
            """, nativeQuery = true)
    List<BatchNameProjection> findBatchNameComponentsByIds(@Param("ids") List<String> ids);

    /**
     * Search ALL of an institute's batches by name for the chat "start a new batch" picker (admin).
     * Optional name match on package OR level name. Limited via Pageable. (Split from the id-scoped
     * variant rather than using a nullable IN list, which is unreliable to bind on Hibernate 6.)
     */
    @Query("""
            SELECT DISTINCT ps.id AS packageSessionId,
                   p.packageName AS packageName,
                   l.id          AS levelId,
                   l.levelName   AS levelName
            FROM PackageSession ps
            JOIN ps.packageEntity p
            JOIN PackageInstitute pi ON pi.packageEntity.id = p.id
            LEFT JOIN ps.level l
            WHERE pi.instituteEntity.id = :instituteId
              AND ps.status IN :statuses
              AND (:nameQuery IS NULL
                   OR LOWER(p.packageName) LIKE LOWER(CONCAT('%', :nameQuery, '%'))
                   OR LOWER(l.levelName) LIKE LOWER(CONCAT('%', :nameQuery, '%')))
            ORDER BY p.packageName ASC
            """)
    List<BatchNameProjection> searchBatchNameComponents(
            @Param("instituteId") String instituteId,
            @Param("nameQuery") String nameQuery,
            @Param("statuses") List<String> statuses,
            Pageable pageable);

    /** Same as {@link #searchBatchNameComponents} but scoped to a set of package-session ids (teacher). */
    @Query("""
            SELECT DISTINCT ps.id AS packageSessionId,
                   p.packageName AS packageName,
                   l.id          AS levelId,
                   l.levelName   AS levelName
            FROM PackageSession ps
            JOIN ps.packageEntity p
            JOIN PackageInstitute pi ON pi.packageEntity.id = p.id
            LEFT JOIN ps.level l
            WHERE pi.instituteEntity.id = :instituteId
              AND ps.status IN :statuses
              AND ps.id IN :packageSessionIds
              AND (:nameQuery IS NULL
                   OR LOWER(p.packageName) LIKE LOWER(CONCAT('%', :nameQuery, '%'))
                   OR LOWER(l.levelName) LIKE LOWER(CONCAT('%', :nameQuery, '%')))
            ORDER BY p.packageName ASC
            """)
    List<BatchNameProjection> searchBatchNameComponentsScoped(
            @Param("instituteId") String instituteId,
            @Param("nameQuery") String nameQuery,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("statuses") List<String> statuses,
            Pageable pageable);

    /**
     * Find child package sessions (subgroups) for a given parent batch.
     * Used when syncing subgroups on edit course.
     */
    List<PackageSession> findByParentIdAndStatusIn(String parentId, List<String> statuses);

    /**
     * Get aggregated inventory stats for all package sessions of an institute.
     */
    @Query(value = """
            SELECT
                COUNT(*) AS totalSessions,
                COUNT(CASE WHEN ps.max_seats IS NULL THEN 1 END) AS unlimitedSessions,
                COUNT(CASE WHEN ps.max_seats IS NOT NULL THEN 1 END) AS limitedSessions,
                COALESCE(SUM(ps.max_seats), 0) AS totalCapacity,
                COALESCE(SUM(ps.available_slots), 0) AS totalAvailable,
                COUNT(CASE WHEN ps.max_seats IS NOT NULL AND ps.max_seats > 0
                    AND (ps.available_slots * 100.0 / ps.max_seats) <= 10 THEN 1 END) AS criticalSessions,
                COUNT(CASE WHEN ps.max_seats IS NOT NULL AND ps.max_seats > 0
                    AND (ps.available_slots * 100.0 / ps.max_seats) > 10
                    AND (ps.available_slots * 100.0 / ps.max_seats) <= 20 THEN 1 END) AS lowAvailabilitySessions
            FROM package_session ps
            JOIN package_institute pi ON ps.package_id = pi.package_id
            WHERE pi.institute_id = :instituteId AND ps.status IN (:statuses)
            """, nativeQuery = true)
    InventoryStatsProjection getInventoryStats(
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses);

    interface InventoryStatsProjection {
        long getTotalSessions();
        long getUnlimitedSessions();
        long getLimitedSessions();
        long getTotalCapacity();
        long getTotalAvailable();
        long getCriticalSessions();
        long getLowAvailabilitySessions();
    }

    /**
     * Cheap "does this batch have any children that copied from it?" probe.
     * Lets the lineage service short-circuit the heavy joined fetch for the
     * common case where the batch has no copy history at all. Backed by
     * {@code idx_package_session_content_copied_from} from V237.
     */
    boolean existsByContentCopiedFromPackageSessionId(String sourcePackageSessionId);

    /** True when any batch of any course still uses this session in one of the given statuses. */
    boolean existsBySession_IdAndStatusIn(String sessionId, List<String> statuses);

    /**
     * Reverse-lookup for content-copy lineage with package/session/level joined
     * in one round-trip (avoids the 1+3N fan-out you get from the LAZY relations
     * on PackageSession). Use {@link #existsByContentCopiedFromPackageSessionId}
     * first to skip this entirely when there are no children.
     */
    @Query("SELECT ps FROM PackageSession ps " +
            "LEFT JOIN FETCH ps.packageEntity " +
            "LEFT JOIN FETCH ps.session " +
            "LEFT JOIN FETCH ps.level " +
            "WHERE ps.contentCopiedFromPackageSessionId = :sourceId")
    List<PackageSession> findChildrenForLineage(@Param("sourceId") String sourcePackageSessionId);

    /**
     * Load a single batch with package/session/level already hydrated.
     * Used for the "copied from" upstream lookup so we don't fire three extra
     * lazy-init queries on the source batch.
     */
    @Query("SELECT ps FROM PackageSession ps " +
            "LEFT JOIN FETCH ps.packageEntity " +
            "LEFT JOIN FETCH ps.session " +
            "LEFT JOIN FETCH ps.level " +
            "WHERE ps.id = :id")
    Optional<PackageSession> findByIdWithRelations(@Param("id") String id);

}
