package vacademy.io.admin_core_service.features.institute.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.dto.InstituteSearchProjection;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

@Repository
public interface InstituteRepository extends CrudRepository<Institute, String> {

    /**
     * Row lock on the institute, for read-compare-write of setting_json (super-admin
     * display-settings write with a version check, setting restore). Call inside a transaction.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM Institute i WHERE i.id = :id")
    Optional<Institute> findByIdForUpdate(@Param("id") String id);

    @Query(value = "SELECT DISTINCT i.* " +
            "FROM staff s " +
            "JOIN institutes i ON s.institute_id = i.id " +
            "WHERE s.user_id = :userId", nativeQuery = true)
    List<Institute> findInstitutesByUserId(@Param("userId") String userId);

    @Transactional
    @Modifying
    @Query(value = "INSERT INTO institutes (id, name, country, state, city, address_line, pin_code, email, mobile_number, website_url) "
            +
            "VALUES (:newId, :#{#institute.instituteName}, :#{#institute.country}, :#{#institute.state}, :#{#institute.city}, "
            +
            ":#{#institute.address}, :#{#institute.pinCode}, :#{#institute.email}, :#{#institute.mobileNumber}, :#{#institute.websiteUrl})", nativeQuery = true)
    void insertInstitute(@Param("newId") String newId,
            @Param("institute") Institute institute);

    @Query(value = """
            SELECT
                (
                    (CASE WHEN name IS NULL OR name = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN address_line IS NULL OR address_line = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN pin_code IS NULL OR pin_code = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN mobile_number IS NULL OR mobile_number = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN logo_file_id IS NULL OR logo_file_id = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN website_url IS NULL OR website_url = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN "type" IS NULL OR "type" = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN country IS NULL OR country = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN state IS NULL OR state = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN city IS NULL OR city = '' THEN 1 ELSE 0 END) +
                    (CASE WHEN email IS NULL OR email = '' THEN 1 ELSE 0 END)
                ) AS null_or_empty_count
            FROM
                institutes
            WHERE
                id = :instituteId
            """, nativeQuery = true)
    public Integer findCountForNullOrEmptyFields(@Param("instituteId") String instituteId);

    @Query(value = """
            SELECT * from institutes where subdomain = :subdomain
            ORDER BY created_at DESC LIMIT 1
            """, nativeQuery = true)
    Optional<Institute> findBySubdomainLimit1(@Param("subdomain") String subdomain);

    @Query(value = """
            SELECT id, name AS instituteName
            FROM institutes
            WHERE LOWER(name) LIKE LOWER(CONCAT('%', :query, '%'))
               OR LOWER(address_line) LIKE LOWER(CONCAT('%', :query, '%'))
               OR LOWER(city) LIKE LOWER(CONCAT('%', :query, '%'))
               OR LOWER(state) LIKE LOWER(CONCAT('%', :query, '%'))
               OR LOWER(pin_code) LIKE LOWER(CONCAT('%', :query, '%'))
            ORDER BY name ASC
            LIMIT 20
            """, nativeQuery = true)
    List<InstituteSearchProjection> searchByQuery(@Param("query") String query);

    @Query(value = """
            SELECT i.* FROM institutes i
            JOIN student_session_institute_group_mapping ssigm ON ssigm.institute_id = i.id
            WHERE ssigm.user_id = :userId
            AND ssigm.package_session_id = :sessionId ORDER BY created_at DESC LIMIT 1
            """, nativeQuery = true)
    Optional<Institute> findInstitutesByUserIdAndPackageSessionId(@Param("userId") String userId,
            @Param("sessionId") String packageSessionId);

    // ==================== Super Admin Queries ====================

    @Query(value = """
            SELECT i.id, i.name, i.email, i.city, i.state, i.type, i.logo_file_id, i.subdomain, i.created_at,
                COALESCE(sc.cnt, 0) AS student_count,
                COALESCE(cc.cnt, 0) AS course_count,
                COALESCE(bc.cnt, 0) AS batch_count
            FROM institutes i
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT ssigm.user_id) AS cnt
                FROM student_session_institute_group_mapping ssigm
                JOIN package_session ps ON ssigm.package_session_id = ps.id
                WHERE ssigm.institute_id = i.id
                  AND ssigm.status NOT IN ('DELETED','INACTIVE','TERMINATED')
                  AND ps.status IN ('ACTIVE','HIDDEN')
            ) sc ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT pi.package_id) AS cnt
                FROM package_institute pi
                JOIN package p ON pi.package_id = p.id
                WHERE pi.institute_id = i.id AND p.status != 'DELETED'
            ) cc ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(ps.id) AS cnt
                FROM package_session ps
                JOIN package p ON ps.package_id = p.id
                JOIN package_institute pi ON p.id = pi.package_id
                WHERE pi.institute_id = i.id AND ps.status IN ('ACTIVE','HIDDEN')
            ) bc ON true
            WHERE (:search IS NULL OR :search = ''
                   OR LOWER(i.name) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.city) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.email) LIKE LOWER(CONCAT('%', :search, '%')))
            ORDER BY i.created_at DESC
            LIMIT :size OFFSET :offset
            """, nativeQuery = true)
    List<Object[]> findAllInstitutesWithCounts(@Param("search") String search,
            @Param("size") int size, @Param("offset") int offset);

    @Query(value = """
            SELECT COUNT(*) FROM institutes i
            WHERE (:search IS NULL OR :search = ''
                   OR LOWER(i.name) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.city) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.email) LIKE LOWER(CONCAT('%', :search, '%')))
            """, nativeQuery = true)
    Long countAllInstitutes(@Param("search") String search);

    /**
     * Bulk id -> display name, for screens that list institutes they do not otherwise
     * need to load. Deliberately a two-column projection: {@code institutes} carries
     * {@code setting_json}, which is large, and fetching whole entities to read a name
     * pulls every institute's settings blob across with it.
     */
    @Query(value = "SELECT i.id, i.name FROM institutes i WHERE i.id IN (:ids)", nativeQuery = true)
    List<Object[]> findIdAndNameByIds(@Param("ids") java.util.Collection<String> ids);

    @Query(value = "SELECT COUNT(*) FROM institutes", nativeQuery = true)
    Long countTotalInstitutes();

    @Query(value = """
            SELECT COUNT(DISTINCT ssigm.user_id)
            FROM student_session_institute_group_mapping ssigm
            JOIN package_session ps ON ssigm.package_session_id = ps.id
            WHERE ssigm.status NOT IN ('DELETED','INACTIVE','TERMINATED')
              AND ps.status IN ('ACTIVE','HIDDEN')
            """, nativeQuery = true)
    Long countTotalStudents();

    @Query(value = """
            SELECT COUNT(DISTINCT p.id)
            FROM package p
            JOIN package_institute pi ON p.id = pi.package_id
            WHERE p.status != 'DELETED'
            """, nativeQuery = true)
    Long countTotalCourses();

    @Query(value = """
            SELECT COUNT(ps.id)
            FROM package_session ps
            JOIN package p ON ps.package_id = p.id
            JOIN package_institute pi ON p.id = pi.package_id
            WHERE ps.status IN ('ACTIVE','HIDDEN')
            """, nativeQuery = true)
    Long countTotalBatches();

    @Query(value = """
            SELECT COUNT(*) FROM institutes
            WHERE created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
            """, nativeQuery = true)
    Long countInstitutesCreatedThisMonth();

    @Query(value = """
            SELECT COUNT(DISTINCT ssigm.user_id)
            FROM student_session_institute_group_mapping ssigm
            WHERE ssigm.status NOT IN ('DELETED','INACTIVE','TERMINATED')
              AND ssigm.created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
            """, nativeQuery = true)
    Long countStudentsEnrolledThisMonth();

    @Query(value = """
            SELECT p.id, p.package_name, p.status, p.thumbnail_file_id, p.created_at,
                COALESCE(ch.cnt, 0) AS chapter_count,
                COALESCE(st.cnt, 0) AS student_count,
                COALESCE(bt.cnt, 0) AS batch_count
            FROM package p
            JOIN package_institute pi ON p.id = pi.package_id
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT cpsm.chapter_id) AS cnt
                FROM chapter_package_session_mapping cpsm
                JOIN package_session ps ON cpsm.package_session_id = ps.id
                WHERE ps.package_id = p.id AND cpsm.status != 'DELETED'
            ) ch ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT ssigm.user_id) AS cnt
                FROM student_session_institute_group_mapping ssigm
                JOIN package_session ps ON ssigm.package_session_id = ps.id
                WHERE ps.package_id = p.id
                  AND ssigm.institute_id = :instituteId
                  AND ssigm.status NOT IN ('DELETED','INACTIVE','TERMINATED')
            ) st ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(ps.id) AS cnt
                FROM package_session ps
                WHERE ps.package_id = p.id AND ps.status IN ('ACTIVE','HIDDEN')
            ) bt ON true
            WHERE pi.institute_id = :instituteId
              AND p.status != 'DELETED'
              AND (:search IS NULL OR :search = ''
                   OR LOWER(p.package_name) LIKE LOWER(CONCAT('%', :search, '%')))
            ORDER BY p.created_at DESC
            LIMIT :size OFFSET :offset
            """, nativeQuery = true)
    List<Object[]> findCoursesByInstituteWithCounts(@Param("instituteId") String instituteId,
            @Param("search") String search, @Param("size") int size, @Param("offset") int offset);

    @Query(value = """
            SELECT COUNT(DISTINCT p.id)
            FROM package p
            JOIN package_institute pi ON p.id = pi.package_id
            WHERE pi.institute_id = :instituteId
              AND p.status != 'DELETED'
              AND (:search IS NULL OR :search = ''
                   OR LOWER(p.package_name) LIKE LOWER(CONCAT('%', :search, '%')))
            """, nativeQuery = true)
    Long countCoursesByInstitute(@Param("instituteId") String instituteId, @Param("search") String search);

    /**
     * Candidate scan for the institute-gated package-session renewal scheduler.
     * The LIKE on the raw setting JSON is only a cheap pre-filter (institutes
     * that have a PAYMENT_SETTING block at all); the caller parses each row's
     * JSON envelope and keeps only those with
     * packageSessionRenewalSchedulerEnabled = true. Returns [id, setting].
     */
    @Query(value = "SELECT id, setting_json FROM institutes WHERE setting_json LIKE '%PAYMENT_SETTING%'",
            nativeQuery = true)
    List<Object[]> findIdAndSettingWithPaymentSetting();

    /**
     * Candidate scan for the scheduled reporting platform. Cheap LIKE pre-filter on
     * the raw settings blob; the caller parses each envelope and keeps institutes
     * whose REPORT_SETTING is enabled with at least one live schedule.
     *
     * NOTE the column is `setting_json`, not `setting` — the sibling query above
     * selects `setting`, which does not exist on this table, so it throws at
     * runtime. Do not copy it.
     *
     * Parsing is per-row and defensive on purpose: at least one institute's blob is
     * not valid JSON, and one bad row must not stop every other institute's report.
     * Returns [id, setting_json].
     */
    @Query(value = "SELECT id, setting_json FROM institutes WHERE setting_json LIKE '%REPORT_SETTING%'",
            nativeQuery = true)
    List<Object[]> findIdAndSettingJsonWithReportSetting();

    // ==================== Lead Tag Queries ====================

    @Transactional
    @Modifying
    @Query(value = "UPDATE institutes SET lead_tag = :leadTag, updated_at = CURRENT_TIMESTAMP WHERE id = :instituteId",
            nativeQuery = true)
    int updateLeadTag(@Param("instituteId") String instituteId, @Param("leadTag") String leadTag);

    // ==================== Filtered + Sorted Institute List ====================
    //
    // The three counts are computed once per table and joined, not as per-institute LATERALs.
    // The LATERAL form re-scanned ssigm and package_session for each of the ~1,300 institutes
    // before the ORDER BY and LIMIT, about 165 s per page on the read replica. Abandoned
    // requests kept running and held the replica pool, so admin-core health checks timed out
    // and every pod went unready (2026-10-23 12:53 UTC). Set-based: about 2.4 s, same rows.

    @Query(value = """
            SELECT i.id, i.name, i.email, i.city, i.state, i.type, i.logo_file_id, i.subdomain, i.created_at,
                COALESCE(sc.cnt, 0) AS student_count,
                COALESCE(cc.cnt, 0) AS course_count,
                COALESCE(bc.cnt, 0) AS batch_count,
                i.lead_tag
            FROM institutes i
            LEFT JOIN (
                SELECT ssigm.institute_id, COUNT(DISTINCT ssigm.user_id) AS cnt
                FROM student_session_institute_group_mapping ssigm
                JOIN package_session ps ON ssigm.package_session_id = ps.id
                WHERE ssigm.status NOT IN ('DELETED','INACTIVE','TERMINATED')
                  AND ps.status IN ('ACTIVE','HIDDEN')
                GROUP BY ssigm.institute_id
            ) sc ON sc.institute_id = i.id
            LEFT JOIN (
                SELECT pi.institute_id, COUNT(DISTINCT pi.package_id) AS cnt
                FROM package_institute pi
                JOIN package p ON pi.package_id = p.id
                WHERE p.status != 'DELETED'
                GROUP BY pi.institute_id
            ) cc ON cc.institute_id = i.id
            LEFT JOIN (
                SELECT pi.institute_id, COUNT(ps.id) AS cnt
                FROM package_session ps
                JOIN package p ON ps.package_id = p.id
                JOIN package_institute pi ON p.id = pi.package_id
                WHERE ps.status IN ('ACTIVE','HIDDEN')
                GROUP BY pi.institute_id
            ) bc ON bc.institute_id = i.id
            WHERE (:search IS NULL OR :search = ''
                   OR LOWER(i.name) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.city) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.email) LIKE LOWER(CONCAT('%', :search, '%')))
              AND (:leadTag IS NULL OR :leadTag = '' OR i.lead_tag = :leadTag)
            ORDER BY
                CASE WHEN :sortBy = 'student_count' AND :sortDirection = 'ASC' THEN COALESCE(sc.cnt, 0) END ASC,
                CASE WHEN :sortBy = 'student_count' AND :sortDirection = 'DESC' THEN COALESCE(sc.cnt, 0) END DESC,
                CASE WHEN :sortBy = 'course_count' AND :sortDirection = 'ASC' THEN COALESCE(cc.cnt, 0) END ASC,
                CASE WHEN :sortBy = 'course_count' AND :sortDirection = 'DESC' THEN COALESCE(cc.cnt, 0) END DESC,
                CASE WHEN :sortBy = 'batch_count' AND :sortDirection = 'ASC' THEN COALESCE(bc.cnt, 0) END ASC,
                CASE WHEN :sortBy = 'batch_count' AND :sortDirection = 'DESC' THEN COALESCE(bc.cnt, 0) END DESC,
                i.created_at DESC
            LIMIT :size OFFSET :offset
            """, nativeQuery = true)
    List<Object[]> findAllInstitutesFiltered(@Param("search") String search,
            @Param("leadTag") String leadTag,
            @Param("sortBy") String sortBy,
            @Param("sortDirection") String sortDirection,
            @Param("size") int size, @Param("offset") int offset);

    @Query(value = """
            SELECT COUNT(*) FROM institutes i
            WHERE (:search IS NULL OR :search = ''
                   OR LOWER(i.name) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.city) LIKE LOWER(CONCAT('%', :search, '%'))
                   OR LOWER(i.email) LIKE LOWER(CONCAT('%', :search, '%')))
              AND (:leadTag IS NULL OR :leadTag = '' OR i.lead_tag = :leadTag)
            """, nativeQuery = true)
    Long countAllInstitutesFiltered(@Param("search") String search, @Param("leadTag") String leadTag);

    /**
     * Every custom live-class hostname currently configured, deduplicated.
     *
     * Consumed on each BBB pool-server start to rebuild that server's nginx
     * server_name list and its certificate SAN set, so an institute added here
     * becomes reachable on the next restore with no manual step.
     */
    @Query(value = """
            SELECT DISTINCT i.live_session_base_url FROM institutes i
            WHERE i.live_session_base_url IS NOT NULL
              AND TRIM(i.live_session_base_url) <> ''
            ORDER BY 1
            """, nativeQuery = true)
    List<String> findDistinctLiveSessionBaseUrls();
}
