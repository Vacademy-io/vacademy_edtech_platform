package vacademy.io.admin_core_service.features.packages.repository;

import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailProjection;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2Projection;
import vacademy.io.admin_core_service.features.packages.dto.PackagePopularityProjection;
import vacademy.io.common.institute.entity.LevelProjection;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.SessionProjection;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public interface PackageRepository extends JpaRepository<PackageEntity, String> {

    // Read time per package session (ps_read_time). Most queries here compute it with
    // LEFT JOIN LATERAL (... WHERE cpsm.package_session_id = ps.id) and per-slide question
    // counts, so only the sessions being returned are summed. They used to aggregate every
    // slide on the platform (~55k) on every call and keep the few rows they needed: the
    // learner course lists took 130-180 ms per call for 2-3 courses, now 5-11 ms (verified
    // identical results across 13 queries on 2026-10-23).
    //
    // The two getCatalogPackageDetail admin listings keep the platform-wide aggregate on
    // purpose: they return hundreds of sessions (380 for one institute), where one
    // aggregate beats per-session lookups (1.9 s vs 5-7 s measured).


    // Get all distinct sessions of an institute_id
    @Query(value = "SELECT DISTINCT s.* FROM session s " +
            "JOIN package_session ps ON s.id = ps.session_id " +
            "JOIN package p ON ps.package_id = p.id " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId AND ps.status IN (:statusList)", nativeQuery = true)
    List<SessionProjection> findDistinctSessionsByInstituteIdAndStatusIn(@Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList);

    @Query(value = "SELECT DISTINCT l.* FROM level l " +
            "JOIN package_session ps ON l.id = ps.level_id " +
            "JOIN package_institute pi ON ps.package_id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId AND l.status IN (:statusList) AND ps.status IN (:statusList)", nativeQuery = true)
    List<LevelProjection> findDistinctLevelsByInstituteIdAndStatusIn(@Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList);

    // Get all distinct packages of an institute_id
    @Query(value = "SELECT DISTINCT p.* FROM package p " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "JOIN package_session ps ON p.id = ps.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND p.status IN (:packageStatusList) " +
            "AND ps.status IN (:packageSessionStatusList)", nativeQuery = true)
    List<PackageEntity> findDistinctPackagesByInstituteIdAndStatuses(
            @Param("instituteId") String instituteId,
            @Param("packageStatusList") List<String> packageStatusList,
            @Param("packageSessionStatusList") List<String> packageSessionStatusList);

    /**
     * Most-recently-updated course_setting for the institute that mentions an LMS_SETTING.
     * Lets the institute LMS page surface a connection the admin already configured on a
     * course (per-package course_setting) even when the institute-level setting is empty.
     * Returns the raw course_setting JSON string, or null if no course has LMS settings.
     */
    @Query(value = "SELECT p.course_setting FROM package p " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND p.course_setting LIKE '%LMS_SETTING%' " +
            "ORDER BY p.updated_at DESC NULLS LAST LIMIT 1", nativeQuery = true)
    String findLatestCourseSettingWithLmsByInstitute(@Param("instituteId") String instituteId);

    /**
     * Every course_setting in the institute that holds an LMS or Moodle connection. Used to
     * discover ALL the distinct LMS endpoints the admin configured per-course (e.g. several
     * LearnDash sites + a Moodle) so the institute LMS page lists each one as its own connection.
     */
    @Query(value = "SELECT p.course_setting FROM package p " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND (p.course_setting LIKE '%LMS_SETTING%' OR p.course_setting LIKE '%MOODLE_SETTING%')",
            nativeQuery = true)
    List<String> findCourseSettingsWithLmsByInstitute(@Param("instituteId") String instituteId);

    // Get all package sessions of an institute_id and of a session_id
    @Query(value = "SELECT ps.id, ps.level_id, ps.session_id, ps.start_time, ps.updated_at, ps.created_at, ps.status, ps.package_id "
            +
            "FROM package_session ps " +
            "JOIN package p ON ps.package_id = p.id " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId AND ps.status != 'DELETED'", nativeQuery = true)
    List<PackageSession> findPackageSessionsByInstituteId(
            @Param("instituteId") String instituteId);

    @Query(value = """
            SELECT DISTINCT s.*
            FROM session s
            INNER JOIN package_session ps ON s.id = ps.session_id
            INNER JOIN package p ON ps.package_id = p.id
            WHERE ps.package_id = :packageId
              AND s.status IN (:sessionStatusList)
              AND ps.status IN (:packageSessionStatusList)
            """, nativeQuery = true)
    List<SessionProjection> findDistinctSessionsByPackageIdAndStatuses(
            @Param("packageId") String packageId,
            @Param("sessionStatusList") List<String> sessionStatusList,
            @Param("packageSessionStatusList") List<String> packageSessionStatusList);

    // Distinct packages a learner can actually open. The status filters must mirror
    // the learner "My Courses" catalogue query (LearnerPackageService: package ACTIVE,
    // package_session ACTIVE/HIDDEN, mapping ACTIVE) so the dashboard course count
    // equals the number of accessible course cards. A learner removed from every batch
    // (mapping flipped to INACTIVE/TERMINATED) must count 0, not linger as != DELETED.
    @Query(value = "SELECT DISTINCT p.* FROM package p " +
            "JOIN package_session ps ON p.id = ps.package_id " +
            "JOIN student_session_institute_group_mapping ssgm ON ssgm.package_session_id = ps.id " +
            "WHERE ssgm.institute_id = :instituteId " +
            "AND ssgm.user_id = :userId " +
            "AND p.status IN (:packageStatuses) " +
            "AND ps.status IN (:packageSessionStatuses) " +
            "AND ssgm.status IN (:learnerStatuses)", nativeQuery = true)
    List<PackageEntity> findDistinctPackagesByUserIdAndInstituteId(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("packageStatuses") List<String> packageStatuses,
            @Param("packageSessionStatuses") List<String> packageSessionStatuses,
            @Param("learnerStatuses") List<String> learnerStatuses);

    @Query(value = "SELECT COUNT(DISTINCT p.id) FROM package p " +
            "JOIN package_session ps ON p.id = ps.package_id " +
            "JOIN student_session_institute_group_mapping ssgm ON ssgm.package_session_id = ps.id " +
            "WHERE ssgm.institute_id = :instituteId " +
            "AND ssgm.user_id = :userId " +
            "AND p.status != 'DELETED' " +
            "AND ps.status != 'DELETED' " +
            "AND ssgm.status != 'DELETED'", nativeQuery = true)
    Integer countDistinctPackagesByUserIdAndInstituteId(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId);

    @Query(value = "SELECT COUNT(DISTINCT p.id) FROM package p " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "JOIN package_session ps ON p.id = ps.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND p.status != 'DELETED' " +
            "AND ps.status != 'DELETED'", nativeQuery = true)
    Long countDistinctPackagesByInstituteId(@Param("instituteId") String instituteId);

    @Query(value = "SELECT COUNT(DISTINCT ps.level_id) FROM package_session ps " +
            "JOIN package p ON ps.package_id = p.id " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "WHERE pi.institute_id = :instituteId " +
            "AND p.status != 'DELETED' " +
            "AND ps.status != 'DELETED' and ps.level_id != 'DEFAULT' ", nativeQuery = true)
    Long countDistinctLevelsByInstituteId(@Param("instituteId") String instituteId);

    @Query(value = """
            SELECT DISTINCT TRIM(t.tag)
            FROM package_institute pi
            JOIN package p ON pi.package_id = p.id
            CROSS JOIN LATERAL unnest(string_to_array(p.comma_separated_tags, ',')) AS t(tag)
            WHERE pi.institute_id = :instituteId
            AND p.status = 'ACTIVE'
            AND p.is_course_published_to_catalaouge = true
            AND p.comma_separated_tags IS NOT NULL
            AND p.comma_separated_tags != ''
            AND TRIM(t.tag) != ''
            ORDER BY 1 ASC
            """, nativeQuery = true)
    List<String> findAllDistinctTagsByInstituteId(@Param("instituteId") String instituteId);

    /**
     * Tags of every non-deleted course of the institute, published to the catalogue or not.
     * The admin Courses filter and the course form's tag picker read this: an institute whose
     * courses are all unpublished got an empty list from the catalogue-only query above, so
     * tags it had set on its courses could never be filtered on or re-picked.
     */
    @Query(value = """
            SELECT DISTINCT TRIM(t.tag)
            FROM package_institute pi
            JOIN package p ON pi.package_id = p.id
            CROSS JOIN LATERAL unnest(string_to_array(p.comma_separated_tags, ',')) AS t(tag)
            WHERE pi.institute_id = :instituteId
            AND p.status != 'DELETED'
            AND p.comma_separated_tags IS NOT NULL
            AND p.comma_separated_tags != ''
            AND TRIM(t.tag) != ''
            ORDER BY 1 ASC
            """, nativeQuery = true)
    List<String> findAllDistinctAdminTagsByInstituteId(@Param("instituteId") String instituteId);

    /**
     * Distinct learners actively enrolled in each catalogue course of ONE institute: the input
     * of the public popularity ranks ({@code CatalogPopularityService}, cached 10 minutes per
     * institute and read on the replica). Courses nobody is enrolled in return no row.
     *
     * <p>Every part of the shape is load-bearing:
     * <ul>
     *   <li>Scoped by institute through EXISTS on package_institute, so the planner walks only
     *       this institute's courses and their batches into the enrolment table. Never drop the
     *       scope: an unscoped aggregate over student_session_institute_group_mapping is exactly
     *       what must not run here (the production primary was OOM-killed once by an unscoped
     *       analytics query). EXISTS rather than a join, so a course mapped to the institute more
     *       than once (one package_institute row per group) is not counted twice.</li>
     *   <li>{@code m.status = 'ACTIVE'} is a LITERAL on purpose: every package_session- or
     *       institute-led index on the enrolment table is partial WHERE status = 'ACTIVE', and a
     *       bound parameter or an IN list cannot use a partial index.</li>
     *   <li>Same "member" definition as
     *       {@code StudentSessionInstituteGroupMappingRepository#existsActiveMembership}:
     *       ABANDONED_CART and PAYMENT_FAILED rows are ACTIVE too but grant nothing. Invited and
     *       pending-approval rows sit on the course's INVITED batch, which the
     *       {@code ps.status IN ('ACTIVE', 'HIDDEN')} join already leaves out.</li>
     *   <li>COUNT(DISTINCT user_id) per course, not per batch: a learner in two batches of one
     *       course counts once.</li>
     *   <li>Same course gate as the public v2 search (ACTIVE and published to the catalogue), so
     *       the endpoint never names a course id the catalogue does not already show.</li>
     * </ul>
     * The statement timeout bounds the worst case on the small replica pool. Keep apostrophes and
     * semicolons out of any SQL comment added inside the string (see RepositoryQueryStringsTest).
     */
    @QueryHints(@QueryHint(name = "jakarta.persistence.query.timeout", value = "10000"))
    @Query(value = """
            SELECT ps.package_id AS packageId,
                   COUNT(DISTINCT m.user_id) AS learnerCount
            FROM package p
            JOIN package_session ps
                ON ps.package_id = p.id
                AND ps.status IN ('ACTIVE', 'HIDDEN')
            JOIN student_session_institute_group_mapping m
                ON m.package_session_id = ps.id
                AND m.status = 'ACTIVE'
                AND m.user_id IS NOT NULL
                AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
            WHERE p.status = 'ACTIVE'
                AND p.is_course_published_to_catalaouge = true
                AND EXISTS (
                    SELECT 1
                    FROM package_institute pi
                    WHERE pi.package_id = p.id
                        AND pi.institute_id = :instituteId
                )
            GROUP BY ps.package_id
            """, nativeQuery = true)
    List<PackagePopularityProjection> countActiveLearnersPerCatalogPackage(@Param("instituteId") String instituteId);

    @Query(value = "SELECT DISTINCT p.* FROM package p " +
            "JOIN package_institute pi ON p.id = pi.package_id " +
            "LEFT JOIN package_session ps_level_filter ON p.id = ps_level_filter.package_id AND ps_level_filter.status != 'DELETED' "
            +
            "WHERE pi.institute_id = :instituteId " +
            // Status filter
            "AND ( (:#{#statuses == null || #statuses.isEmpty()} = true AND p.status != 'DELETED') OR (:#{#statuses != null && !#statuses.isEmpty()} = true AND p.status IN (:statuses)) ) "
            +
            // Level IDs filter
            "AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ps_level_filter.level_id IN (:levelIds)) " +
            // Tags filter:
            // The :tags parameter is now guaranteed to be a non-empty list from the service
            // layer.
            // It will either contain actual tags to filter by, or a placeholder.
            "AND ( " +
            "      (:#{#tags[0].equals('__NO_TAGS_FILTER_PLACEHOLDER__')} = true) OR " +
            "      (:#{#tags[0].equals('__EMPTY_TAGS_LIST_PLACEHOLDER__')} = true) OR " +
            "      (EXISTS (SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) s_tag " +
            "               WHERE TRIM(lower(s_tag)) = ANY(CAST(:tags AS TEXT[])) )) " +
            ") " +
            // Search by name filter
            "AND (:#{#searchByName == null || #searchByName.trim().isEmpty()} = true OR p.package_name ILIKE CONCAT('%', :searchByName, '%')) ", countQuery = "SELECT COUNT(DISTINCT p.id) FROM package p "
                    +
                    "JOIN package_institute pi ON p.id = pi.package_id " +
                    "LEFT JOIN package_session ps_level_filter ON p.id = ps_level_filter.package_id AND ps_level_filter.status != 'DELETED' "
                    +
                    "WHERE pi.institute_id = :instituteId " +
                    "AND ( (:#{#statuses == null || #statuses.isEmpty()} = true AND p.status != 'DELETED') OR (:#{#statuses != null && !#statuses.isEmpty()} = true AND p.status IN (:statuses)) ) "
                    +
                    "AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ps_level_filter.level_id IN (:levelIds)) "
                    +
                    // Matching tags filter logic for count query
                    "AND ( " +
                    "      (:#{#tags[0].equals('__NO_TAGS_FILTER_PLACEHOLDER__')} = true) OR " +
                    "      (:#{#tags[0].equals('__EMPTY_TAGS_LIST_PLACEHOLDER__')} = true) OR " +
                    "      (EXISTS (SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) s_tag " +
                    "               WHERE TRIM(lower(s_tag)) = ANY(CAST(:tags AS TEXT[])) )) " +
                    ") " +
                    "AND (:#{#searchByName == null || #searchByName.trim().isEmpty()} = true OR p.package_name ILIKE CONCAT('%', :searchByName, '%')) ", nativeQuery = true)
    Page<PackageEntity> findPackagesByCriteria(
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses,
            @Param("levelIds") List<String> levelIds,
            @Param("tags") List<String> tags, // Will now always be a non-empty list from service
            @Param("searchByName") String searchByName,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                p.created_at AS createdAt,

                /* 1. Progress Calculation (Removed DISTINCT to ensure accuracy) */
                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,

                COALESCE(MAX(ps_read_time.total_read_time_minutes), 0) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session psr ON psr.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND psr.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    AND (
                        r.source_type != 'PACKAGE_SESSION'
                        OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR psr.status IN (:packageSessionStatus))
                    )
                ), 0.0) AS rating,

                /* 2. Session Identifiers */
                ps.id AS packageSessionId,
                MIN(l.id) AS levelId,
                MIN(l.level_name) AS levelName,

                ARRAY_REMOVE(ARRAY_AGG(DISTINCT fspm.user_id), NULL) AS facultyUserIds,

                /* 3. Return only current Level ID */
                ARRAY[CAST(MIN(l.id) AS text)] AS levelIds

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id

            JOIN student_session_institute_group_mapping ssigm
                ON ssigm.package_session_id = ps.id
                AND ssigm.user_id = :userId
                AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))

            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND (:userId IS NULL OR user_id = :userId)
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = ps.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))

            LEFT JOIN LATERAL (
                SELECT
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                SELECT COUNT(*) FROM assignment_slide_question asq
                                WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                            ), 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                SELECT COUNT(*) FROM quiz_slide_question qsq
                                WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                            ), 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM chapter_package_session_mapping cpsm
                JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                JOIN slide s ON s.id = cs.slide_id
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                WHERE cpsm.package_session_id = ps.id
                    AND s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
            ) ps_read_time ON TRUE

            WHERE
                (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (
                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping f
                        WHERE f.package_session_id = ps.id
                        AND f.user_id IN (:facultyIds)
                        AND (
                            :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                            OR f.status IN (:facultySubjectSessionStatus)
                        )
                    )
                )
                AND (
                    :#{#tags == null || #tags.isEmpty()} = true OR
                    EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE tag ILIKE ANY (array[:#{#tags}])
                    )
                )

            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at,
                p.course_setting, ps.id /* 4. Added Grouping by Session ID */

            HAVING
                COALESCE(MAX(lo.total_progress), 0) >= COALESCE(CAST((CAST(NULLIF(p.course_setting, '') AS jsonb) -> 'setting' -> 'COURSE_COMPLETION_SETTING' -> 'data' ->> 'completionThresholdPercentage') AS numeric), 80)
            """,

            countQuery = """
                        SELECT COUNT(*) FROM (
                            SELECT ps.id
                            FROM package p
                            JOIN package_session ps ON ps.package_id = p.id
                            JOIN level l ON l.id = ps.level_id
                            JOIN package_institute pi ON pi.package_id = p.id
                            JOIN student_session_institute_group_mapping ssigm
                                ON ssigm.package_session_id = ps.id
                                AND ssigm.user_id = :userId
                                AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))
                            LEFT JOIN (
                                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                                FROM learner_operation
                                WHERE source = 'PACKAGE_SESSION'
                                  AND (:userId IS NULL OR user_id = :userId)
                                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                                GROUP BY source_id
                            ) lo ON lo.source_id = ps.id
                            WHERE
                                (:instituteId IS NULL OR pi.institute_id = :instituteId)
                                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                        AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                                AND (
                                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                                    OR EXISTS (
                                        SELECT 1 FROM faculty_subject_package_session_mapping f
                                        WHERE f.package_session_id = ps.id
                                        AND f.user_id IN (:facultyIds)
                                        AND (
                                            :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                            OR f.status IN (:facultySubjectSessionStatus)
                                        )
                                    )
                                )
                                AND (
                                    :#{#tags == null || #tags.isEmpty()} = true OR
                                    EXISTS (
                                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                        WHERE tag ILIKE ANY (array[:#{#tags}])
                                    )
                                )
                            GROUP BY ps.id, lo.total_progress, p.course_setting
                            HAVING COALESCE(lo.total_progress, 0) >= COALESCE(CAST((CAST(NULLIF(p.course_setting, '') AS jsonb) -> 'setting' -> 'COURSE_COMPLETION_SETTING' -> 'data' ->> 'completionThresholdPercentage') AS numeric), 80)
                        ) AS count_subquery
                    """,

            nativeQuery = true)
    Page<PackageDetailProjection> getCompletedLearnerPackageDetail(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("learnerOperations") List<String> learnerOperations,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("tags") List<String> tags,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("mappingStatuses") List<String> mappingStatuses,
            Pageable pageable);

    // to do: here I have hard coded the rating of course

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                p.created_at AS createdAt,

                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,
                COALESCE(MAX(ps_read_time.total_read_time_minutes), 0) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session psr ON psr.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND psr.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    AND (
                        r.source_type != 'PACKAGE_SESSION'
                        OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR psr.status IN (:packageSessionStatus))
                    )
                ), 0.0) AS rating,

                ps.id AS packageSessionId,
                MIN(l.id) AS levelId,
                MIN(l.level_name) AS levelName,

                ARRAY_REMOVE(ARRAY_AGG(DISTINCT fspm.user_id), NULL) AS facultyUserIds,
                p.created_by_user_id AS createdByUserId,

                /* Fixed: Return only current level ID */
                ARRAY[CAST(MIN(l.id) AS text)] AS levelIds

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id

            JOIN student_session_institute_group_mapping ssigm
                ON ssigm.package_session_id = ps.id
                AND ssigm.user_id = :userId
                AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))

            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND (:userId IS NULL OR user_id = :userId)
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = ps.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))

            LEFT JOIN LATERAL (
                SELECT
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                SELECT COUNT(*) FROM assignment_slide_question asq
                                WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                            ), 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                SELECT COUNT(*) FROM quiz_slide_question qsq
                                WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                            ), 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM chapter_package_session_mapping cpsm
                JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                JOIN slide s ON s.id = cs.slide_id
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                WHERE cpsm.package_session_id = ps.id
                    AND s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
            ) ps_read_time ON TRUE

            WHERE
                (CAST(:instituteId AS text) IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (
                    CAST(:name AS text) IS NULL OR
                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                    EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                    ) OR
                    LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                )
            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at,
                p.course_setting, ps.id
            HAVING COALESCE(MAX(lo.total_progress), 0) >= COALESCE(CAST((CAST(NULLIF(p.course_setting, '') AS jsonb) -> 'setting' -> 'COURSE_COMPLETION_SETTING' -> 'data' ->> 'completionThresholdPercentage') AS numeric), 80)
            """,

            countQuery = """
                        SELECT COUNT(*) FROM (
                            SELECT ps.id
                            FROM package p
                            JOIN package_session ps ON ps.package_id = p.id
                            JOIN level l ON l.id = ps.level_id
                            JOIN package_institute pi ON pi.package_id = p.id
                            JOIN student_session_institute_group_mapping ssigm
                                ON ssigm.package_session_id = ps.id
                                AND ssigm.user_id = :userId
                                AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))
                            LEFT JOIN (
                                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                                FROM learner_operation
                                WHERE source = 'PACKAGE_SESSION'
                                  AND (CAST(:userId AS text) IS NULL OR user_id = :userId)
                                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                                GROUP BY source_id
                            ) lo ON lo.source_id = ps.id
                            LEFT JOIN faculty_subject_package_session_mapping fspm ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                                AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))
                            WHERE
                                (CAST(:instituteId AS text) IS NULL OR pi.institute_id = :instituteId)
                                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                        AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                                AND (
                                    CAST(:name AS text) IS NULL OR
                                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                                    EXISTS (
                                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                                    ) OR
                                    LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                                )
                            GROUP BY ps.id, lo.total_progress, p.course_setting
                            HAVING COALESCE(lo.total_progress, 0) >= COALESCE(CAST((CAST(NULLIF(p.course_setting, '') AS jsonb) -> 'setting' -> 'COURSE_COMPLETION_SETTING' -> 'data' ->> 'completionThresholdPercentage') AS numeric), 80)
                        ) AS count_sub
                    """, nativeQuery = true)
    Page<PackageDetailProjection> getCompletedLearnerPackageDetail(
            @Param("userId") String userId,
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("learnerOperations") List<String> learnerOperations,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("mappingStatuses") List<String> mappingStatuses,
            Pageable pageable);

    // to do: here I have hard coded the rating of course
    @Query(value = """
                SELECT
                    p.id AS id,
                    p.package_name AS packageName,
                    p.thumbnail_file_id AS thumbnailFileId,
                    p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                    p.course_preview_image_media_id AS coursePreviewImageMediaId,
                    p.course_banner_media_id AS courseBannerMediaId,
                    p.course_media_id AS courseMediaId,
                    p.why_learn AS whyLearnHtml,
                    p.who_should_learn AS whoShouldLearnHtml,
                    p.about_the_course AS aboutTheCourseHtml,
                    p.comma_separated_tags AS commaSeparetedTags,
                    p.course_depth AS courseDepth,
                    p.course_html_description AS courseHtmlDescriptionHtml,
            p.package_type AS packageType,
                    p.created_at AS createdAt,
                    COALESCE((
                        SELECT AVG(r.points)
                        FROM rating r
                        LEFT JOIN package_session ps2
                            ON ps2.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                        WHERE (
                            (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                            OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                        )
                        AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                        AND (
                            r.source_type != 'PACKAGE_SESSION'
                            OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps2.status IN (:packageSessionStatus))
                        )
                    ), 0.0) AS rating,
                    COALESCE(ps_read_time.total_read_time_minutes, 0) AS readTimeInMinutes,
                    MIN(ps.id) AS packageSessionId,
                    MIN(ps.session_id) AS sessionId,
                    MIN(s.session_name) AS sessionName,
                    MIN(l.id) AS levelId,
                    MIN(l.level_name) AS levelName,
                    ARRAY_REMOVE(
                        ARRAY_AGG(DISTINCT
                            CASE
                                WHEN fspm.subject_id IS NULL AND
                                     (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                      OR fspm.status IN (:facultySubjectSessionStatus))
                                THEN fspm.user_id
                                ELSE NULL
                            END
                        ), NULL
                    ) AS facultyUserIds,
                    p.created_by_user_id AS createdByUserId
                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id
                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND (
                        :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                        OR fspm.status IN (:facultySubjectSessionStatus)
                    )
                LEFT JOIN LATERAL (
                    SELECT
                        SUM(
                            CASE
                                WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                                WHEN s.source_type = 'DOCUMENT' THEN
                                    CASE
                                        WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                        WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                        ELSE 10
                                    END
                                WHEN s.source_type = 'QUESTION' THEN 5
                                WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                    SELECT COUNT(*) FROM assignment_slide_question asq
                                    WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                                ), 0) * 3
                                WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                    SELECT COUNT(*) FROM quiz_slide_question qsq
                                    WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                                ), 0) * 2
                                ELSE 0
                            END
                        ) AS total_read_time_minutes
                    FROM chapter_package_session_mapping cpsm
                    JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                    JOIN slide s ON s.id = cs.slide_id
                    LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                    LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                    WHERE cpsm.package_session_id = ps.id
                        AND s.status IN (:slideStatusList)
                        AND cs.status IN (:slideStatusList)
                        AND cpsm.status IN (:chapterPackageStatusList)
                ) ps_read_time ON TRUE
                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (
                        :name IS NULL OR
                        LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                        LOWER(l.level_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                        EXISTS (
                            SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                            WHERE LOWER(tag) LIKE LOWER(CONCAT('%', :name, '%'))
                        ) OR
                        LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', :name, '%'))
                    )
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                GROUP BY
                    p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                    p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                    p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                    p.course_depth, p.course_html_description, p.package_type, p.created_at, p.created_by_user_id,
                    ps_read_time.total_read_time_minutes
            """, countQuery = """
                SELECT COUNT(DISTINCT ps.id)
                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id
                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND (
                        :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                        OR fspm.status IN (:facultySubjectSessionStatus)
                    )
                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (
                        :name IS NULL OR
                        LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                        LOWER(l.level_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                        EXISTS (
                            SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                            WHERE LOWER(tag) LIKE LOWER(CONCAT('%', :name, '%'))
                        ) OR
                        LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', :name, '%'))
                    )
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
            """, nativeQuery = true)
    Page<PackageDetailProjection> getCatalogPackageDetail(
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("levelStatus") List<String> levelStatus,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("createdByUserId") String createdByUserId,
            @Param("sessionIds") List<String> sessionIds,
            @Param("packageIds") List<String> packageIds,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                p.created_at AS createdAt,
                SUM(COALESCE(ps_read_time.total_read_time_minutes, 0)) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session ps2
                        ON ps2.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    AND (
                        r.source_type != 'PACKAGE_SESSION'
                        OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps2.status IN (:packageSessionStatus))
                    )
                ), 0.0) AS rating,

                ps.id AS packageSessionId,
                ps.session_id AS sessionId,
                s.session_name AS sessionName,
                CASE
                    WHEN ps.name IS NULL OR ps.name = '' THEN NULL
                    ELSE CONCAT(p.package_name, ' ', ps.name)
                END AS packageSessionName,

                /* 1. Direct Level/Session Selection */
                l.id AS levelId,
                l.level_name AS levelName,

                ARRAY_REMOVE(
                    ARRAY_AGG(DISTINCT
                        CASE
                            WHEN (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))
                            THEN fspm.user_id
                            ELSE NULL
                        END
                    ), NULL
                ) AS facultyUserIds,

                /* 2. Return only the current level ID in the array */
                ARRAY[CAST(l.id AS text)] AS levelIds,

                (SELECT COUNT(*)
                 FROM student_session_institute_group_mapping ssigm
                 WHERE ssigm.package_session_id = ps.id
                   AND ssigm.status IN ('ACTIVE', 'INACTIVE')) AS enrolledStudentCount

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            LEFT JOIN session s ON s.id = ps.session_id
            JOIN package_institute pi ON pi.package_id = p.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND (
                    :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                    OR fspm.status IN (:facultySubjectSessionStatus)
                )

            LEFT JOIN (
                SELECT
                    cpsm.package_session_id,
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE(aqc.question_count, 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE(qqc.question_count, 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM slide s
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                LEFT JOIN (
                    SELECT assignment_slide_id AS slide_id, COUNT(*) AS question_count
                    FROM assignment_slide_question
                    WHERE status IN (:assignmentQuestionStatusList)
                    GROUP BY assignment_slide_id
                ) aqc ON aqc.slide_id = s.source_id AND s.source_type = 'ASSIGNMENT'
                LEFT JOIN (
                    SELECT quiz_slide_id AS slide_id, COUNT(*) AS question_count
                    FROM quiz_slide_question
                    WHERE status IN (:questionStatusList)
                    GROUP BY quiz_slide_id
                ) qqc ON qqc.slide_id = s.source_id AND s.source_type = 'QUIZ'
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cs.chapter_id
                WHERE
                    s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
                GROUP BY cpsm.package_session_id
            ) ps_read_time ON ps.id = ps_read_time.package_session_id

            WHERE
                (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
                AND (
                    CAST(:packageSessionFilter AS VARCHAR) IS NULL
                    OR :packageSessionFilter = ''
                    OR (:packageSessionFilter = 'PARENTS_ONLY' AND COALESCE(ps.is_parent, false) = true)
                    OR (:packageSessionFilter = 'CHILDREN_ONLY' AND ps.parent_id IS NOT NULL)
                )
                AND (
                    :#{#userIds == null || #userIds.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping f
                        WHERE f.package_session_id = ps.id
                        AND f.user_id IN (:userIds)
                        AND (
                            :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                            OR f.status IN (:facultySubjectSessionStatus)
                        )
                    )
                )
                AND (
                    :name IS NULL OR
                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                    EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', :name, '%'))
                    )
                )
                AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                AND (
                    :#{#tags == null || #tags.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE tag ILIKE ANY (array[:#{#tags}])
                    )
                )

            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at,
                ps.id, ps.name, l.id, l.level_name, s.id, s.session_name /* 3. Added Grouping by Session */
            """,

            countQuery = """
                        SELECT COUNT(DISTINCT ps.id) /* 4. Count Sessions, not Packages */
                        FROM package p
                        JOIN package_session ps ON ps.package_id = p.id
                        JOIN level l ON l.id = ps.level_id
                        JOIN package_institute pi ON pi.package_id = p.id
                        LEFT JOIN faculty_subject_package_session_mapping fspm
                            ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                            AND (
                                :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                OR fspm.status IN (:facultySubjectSessionStatus)
                            )
                        WHERE
                            (:instituteId IS NULL OR pi.institute_id = :instituteId)
                            AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                            AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                            AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                            AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
                            AND (
                                CAST(:packageSessionFilter AS VARCHAR) IS NULL
                                OR :packageSessionFilter = ''
                                OR (:packageSessionFilter = 'PARENTS_ONLY' AND COALESCE(ps.is_parent, false) = true)
                                OR (:packageSessionFilter = 'CHILDREN_ONLY' AND ps.parent_id IS NOT NULL)
                            )
                            AND (
                                :#{#userIds == null || #userIds.isEmpty()} = true
                                OR EXISTS (
                                    SELECT 1 FROM faculty_subject_package_session_mapping f
                                    WHERE f.package_session_id = ps.id
                                    AND f.user_id IN (:userIds)
                                    AND (
                                        :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                        OR f.status IN (:facultySubjectSessionStatus)
                                    )
                                )
                            )
                            AND (
                                :name IS NULL OR
                                LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                                LOWER(l.level_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                                EXISTS (
                                    SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                    WHERE LOWER(tag) LIKE LOWER(CONCAT('%', :name, '%'))
                                )
                            )
                            AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                            AND (
                                :#{#tags == null || #tags.isEmpty()} = true
                                OR EXISTS (
                                    SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                    WHERE tag ILIKE ANY (array[:#{#tags}])
                                )
                            )
                        """, nativeQuery = true)
    Page<PackageDetailProjection> getCatalogPackageDetail(
            @Param("name") String name,
            @Param("userIds") List<String> userIds,
            @Param("instituteId") String instituteId,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("levelStatus") List<String> levelStatus,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("packageIds") List<String> packageIds,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("packageSessionFilter") String packageSessionFilter,
            @Param("sessionIds") List<String> sessionIds,
            @Param("levelIds") List<String> levelIds,
            @Param("tags") List<String> tags,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                    p.package_type AS packageType,
                p.created_at AS createdAt,

                -- ✅ Fixed and filtered AVG logic
                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session ps2
                        ON ps2.id = r.source_id
                        AND r.source_type = 'PACKAGE_SESSION'
                        AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true
                             OR ps2.status IN (:packageSessionStatus))
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                ), 0.0) AS rating,

                ps.id AS packageSessionId,
                CASE
                    WHEN ps.name IS NULL OR ps.name = '' THEN NULL
                    ELSE CONCAT(p.package_name, ' ', ps.name)
                END AS packageSessionName,
                l.id AS levelId,
                l.level_name AS levelName,

                ARRAY_REMOVE(
                    ARRAY_AGG(DISTINCT
                        CASE
                            WHEN :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                 OR fspm.status IN (:facultySubjectSessionStatus)
                            THEN fspm.user_id
                            ELSE NULL
                        END
                    ), NULL
                ) AS facultyUserIds,

                (SELECT COUNT(*)
                 FROM student_session_institute_group_mapping ssigm
                 WHERE ssigm.package_session_id = ps.id
                   AND ssigm.status IN ('ACTIVE', 'INACTIVE')) AS enrolledStudentCount

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            LEFT JOIN faculty_subject_package_session_mapping fspm ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL

            WHERE p.id = :packageId
              AND (
                  :#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true
                  OR ps.status IN (:packageSessionStatus)
              )

            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at,
                ps.id, ps.name, l.id, l.level_name

            ORDER BY p.created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<PackageDetailProjection> getPackageDetailByIdWithSessionAndFacultyStatus(
            @Param("packageId") String packageId,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("ratingStatuses") List<String> ratingStatuses);

    @Query(value = """
                SELECT
                    p.id AS id,
                    p.package_name AS packageName,
                    p.thumbnail_file_id AS thumbnailFileId,
                    p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                    p.course_preview_image_media_id AS coursePreviewImageMediaId,
                    p.course_banner_media_id AS courseBannerMediaId,
                    p.course_media_id AS courseMediaId,
                    p.why_learn AS whyLearnHtml,
                    p.who_should_learn AS whoShouldLearnHtml,
                    p.about_the_course AS aboutTheCourseHtml,
                    p.comma_separated_tags AS commaSeparetedTags,
                    p.course_depth AS courseDepth,
                    p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                    p.created_at AS createdAt,
                    0.0 AS percentageCompleted,

                    SUM(COALESCE(ps_read_time.total_read_time_minutes, 0)) AS readTimeInMinutes,

                    COALESCE((
                        SELECT AVG(r.points)
                        FROM rating r
                        LEFT JOIN package_session ps2 ON ps2.id = r.source_id
                            AND r.source_type = 'PACKAGE_SESSION'
                            AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true
                                 OR ps2.status IN (:packageSessionStatus))
                        WHERE (
                            (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                            OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                        )
                        AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    ), 0.0) AS rating,

                    ps.id AS packageSessionId,
                    ps.session_id AS sessionId,
                    s.session_name AS sessionName,
                    CASE
                        WHEN ps.name IS NULL OR ps.name = '' THEN NULL
                        ELSE CONCAT(p.package_name, ' ', ps.name)
                    END AS packageSessionName,

                    /* 1. Direct Level/Session Selection */
                    l.id AS levelId,
                    l.level_name AS levelName,
                    s.id AS sessionId,
                    s.session_name AS sessionName,

                    ARRAY_REMOVE(
                        ARRAY_AGG(DISTINCT
                            CASE
                                WHEN (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                      OR fspm.status IN (:facultyPackageSessionStatus))
                                THEN fspm.user_id
                                ELSE NULL
                            END
                        ), NULL
                    ) AS facultyUserIds,

                    /* 2. Return only the current level ID in the array */
                    ARRAY[CAST(l.id AS text)] AS levelIds,

                    (SELECT COUNT(*)
                     FROM student_session_institute_group_mapping ssigm
                     WHERE ssigm.package_session_id = ps.id
                       AND ssigm.status IN ('ACTIVE', 'INACTIVE')) AS enrolledStudentCount

                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id

                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND (
                        :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                        OR fspm.status IN (:facultyPackageSessionStatus)
                    )

                LEFT JOIN (
                    SELECT
                        cpsm.package_session_id,
                        SUM(
                            CASE
                                WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                                WHEN s.source_type = 'DOCUMENT' THEN
                                    CASE
                                        WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                        WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                        ELSE 10
                                    END
                                WHEN s.source_type = 'QUESTION' THEN 5
                                WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE(aqc.question_count, 0) * 3
                                WHEN s.source_type = 'QUIZ' THEN COALESCE(qqc.question_count, 0) * 2
                                ELSE 0
                            END
                        ) AS total_read_time_minutes
                    FROM slide s
                    LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                    LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                    LEFT JOIN (
                        SELECT assignment_slide_id AS slide_id, COUNT(*) AS question_count
                        FROM assignment_slide_question
                        WHERE status IN (:assignmentQuestionStatusList)
                        GROUP BY assignment_slide_id
                    ) aqc ON aqc.slide_id = s.source_id AND s.source_type = 'ASSIGNMENT'
                    LEFT JOIN (
                        SELECT quiz_slide_id AS slide_id, COUNT(*) AS question_count
                        FROM quiz_slide_question
                        WHERE status IN (:questionStatusList)
                        GROUP BY quiz_slide_id
                    ) qqc ON qqc.slide_id = s.source_id AND s.source_type = 'QUIZ'
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cs.chapter_id
                    WHERE
                        s.status IN (:slideStatusList)
                        AND cs.status IN (:slideStatusList)
                        AND cpsm.status IN (:chapterPackageStatusList)
                    GROUP BY cpsm.package_session_id
                ) ps_read_time ON ps.id = ps_read_time.package_session_id

                WHERE
                    (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                    AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
                    AND (
                        CAST(:packageSessionFilter AS VARCHAR) IS NULL
                        OR :packageSessionFilter = ''
                        OR (:packageSessionFilter = 'PARENTS_ONLY' AND COALESCE(ps.is_parent, false) = true)
                        OR (:packageSessionFilter = 'CHILDREN_ONLY' AND ps.parent_id IS NOT NULL)
                    )
                    AND (
                        :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                        OR EXISTS (
                            SELECT 1 FROM faculty_subject_package_session_mapping f
                            WHERE f.package_session_id = ps.id
                            AND f.user_id IN (:facultyIds)
                            AND (
                                :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                OR f.status IN (:facultyPackageSessionStatus)
                            )
                        )
                    )
                    AND (
                        :#{#tags == null || #tags.isEmpty()} = true
                        OR EXISTS (
                            SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                            WHERE tag ILIKE ANY (array[:#{#tags}])
                        )
                    )
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))

                GROUP BY
                    p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                    p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                    p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                    p.course_depth, p.course_html_description, p.package_type, p.created_at,
                    ps.id, ps.name, l.id, l.level_name, s.id, s.session_name /* 3. Added Grouping by Session */
            """,

            countQuery = """
                    SELECT COUNT(DISTINCT ps.id) /* 4. Count Sessions, not Packages */
                    FROM package p
                    JOIN package_session ps ON ps.package_id = p.id
                    JOIN level l ON l.id = ps.level_id
                    JOIN package_institute pi ON pi.package_id = p.id
                    LEFT JOIN faculty_subject_package_session_mapping fspm
                        ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                        AND (
                            :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                            OR fspm.status IN (:facultyPackageSessionStatus)
                        )
                    WHERE
                        (:instituteId IS NULL OR pi.institute_id = :instituteId)
                        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                        AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                        AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                        AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                        AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                        AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
                        AND (
                            CAST(:packageSessionFilter AS VARCHAR) IS NULL
                            OR :packageSessionFilter = ''
                            OR (:packageSessionFilter = 'PARENTS_ONLY' AND COALESCE(ps.is_parent, false) = true)
                            OR (:packageSessionFilter = 'CHILDREN_ONLY' AND ps.parent_id IS NOT NULL)
                        )
                        AND (
                            :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                            OR EXISTS (
                                SELECT 1 FROM faculty_subject_package_session_mapping f
                                WHERE f.package_session_id = ps.id
                                AND f.user_id IN (:facultyIds)
                                AND (
                                    :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                    OR f.status IN (:facultyPackageSessionStatus)
                                )
                            )
                        )
                        AND (
                            :#{#tags == null || #tags.isEmpty()} = true
                            OR EXISTS (
                                SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                WHERE tag ILIKE ANY (array[:#{#tags}])
                            )
                        )
                        AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    """, nativeQuery = true)
    Page<PackageDetailProjection> getCatalogPackageDetail(
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultyPackageSessionStatus") List<String> facultyPackageSessionStatus,
            @Param("tags") List<String> tags,
            @Param("levelStatus") List<String> levelStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("packageIds") List<String> packageIds,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("packageSessionFilter") String packageSessionFilter,
            @Param("sessionIds") List<String> sessionIds,
            Pageable pageable);

    @Query(value = """
                SELECT
                    p.id AS id,
                    p.package_name AS packageName,
                    p.thumbnail_file_id AS thumbnailFileId,
                    p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                    p.course_preview_image_media_id AS coursePreviewImageMediaId,
                    p.course_banner_media_id AS courseBannerMediaId,
                    p.course_media_id AS courseMediaId,
                    p.why_learn AS whyLearnHtml,
                    p.who_should_learn AS whoShouldLearnHtml,
                    p.about_the_course AS aboutTheCourseHtml,
                    p.comma_separated_tags AS commaSeparetedTags,
                    p.course_depth AS courseDepth,
                    p.course_html_description AS courseHtmlDescriptionHtml,
            p.package_type AS packageType,
                    p.created_at AS createdAt,
                    COALESCE((
                        SELECT AVG(r.points)
                        FROM rating r
                        LEFT JOIN package_session ps2
                            ON ps2.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                            AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true
                                 OR ps2.status IN (:packageSessionStatus))
                        WHERE (
                            (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                            OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                        )
                        AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    ), 0.0) AS rating,
                    COALESCE(ps_read_time.total_read_time_minutes, 0) AS readTimeInMinutes,
                    ps.id AS packageSessionId,
                    ps.session_id AS sessionId,
                    s.session_name AS sessionName,
                    MIN(l.id) AS levelId,
                    MIN(l.level_name) AS levelName,
                    ARRAY_REMOVE(
                        ARRAY_AGG(DISTINCT
                            CASE
                                WHEN fspm.subject_id IS NULL AND
                                     (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                      OR fspm.status IN (:facultyPackageSessionStatus))
                                THEN fspm.user_id
                                ELSE NULL
                            END
                        ), NULL
                    ) AS facultyUserIds,
                    p.created_by_user_id AS createdByUserId,
                    (
                        SELECT ARRAY_AGG(DISTINCT l2.id)
                        FROM package_session ps2
                        JOIN level l2 ON l2.id = ps2.level_id
                        WHERE ps2.package_id = p.id
                    ) AS levelIds
                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id
                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND fspm.subject_id IS NULL
                    AND (
                        :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                        OR fspm.status IN (:facultyPackageSessionStatus)
                    )
                LEFT JOIN LATERAL (
                    SELECT
                        SUM(
                            CASE
                                WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                                WHEN s.source_type = 'DOCUMENT' THEN
                                    CASE
                                        WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                        WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                        ELSE 10
                                    END
                                WHEN s.source_type = 'QUESTION' THEN 5
                                WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                    SELECT COUNT(*) FROM assignment_slide_question asq
                                    WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                                ), 0) * 3
                                WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                    SELECT COUNT(*) FROM quiz_slide_question qsq
                                    WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                                ), 0) * 2
                                ELSE 0
                            END
                        ) AS total_read_time_minutes
                    FROM chapter_package_session_mapping cpsm
                    JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                    JOIN slide s ON s.id = cs.slide_id
                    LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                    LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                    WHERE cpsm.package_session_id = ps.id
                        AND s.status IN (:slideStatusList)
                        AND cs.status IN (:slideStatusList)
                        AND cpsm.status IN (:chapterPackageStatusList)
                ) ps_read_time ON TRUE
                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (
                        :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                        OR EXISTS (
                            SELECT 1 FROM faculty_subject_package_session_mapping f
                            WHERE f.package_session_id = ps.id
                            AND f.user_id IN (:facultyIds)
                            AND f.subject_id IS NULL
                            AND (
                                :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                OR f.status IN (:facultyPackageSessionStatus)
                            )
                        )
                    )
                    AND (
                        :#{#tags == null || #tags.isEmpty()} = true
                        OR EXISTS (
                            SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                            WHERE tag ILIKE ANY (array[:#{#tags}])
                        )
                    )
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                GROUP BY
                    p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                    p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                    p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                    p.course_depth, p.course_html_description, p.package_type, p.created_at, p.created_by_user_id,
                    ps_read_time.total_read_time_minutes,
                    ps.id, ps.session_id,
                    s.id, s.session_name
            """, countQuery = """
                SELECT COUNT(DISTINCT ps.id)
                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id
                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND fspm.subject_id IS NULL
                    AND (
                        :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                        OR fspm.status IN (:facultyPackageSessionStatus)
                    )
                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (
                        :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                        OR EXISTS (
                            SELECT 1 FROM faculty_subject_package_session_mapping f
                            WHERE f.package_session_id = ps.id
                            AND f.user_id IN (:facultyIds)
                            AND f.subject_id IS NULL
                            AND (
                                :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                OR f.status IN (:facultyPackageSessionStatus)
                            )
                        )
                    )
                    AND (
                        :#{#tags == null || #tags.isEmpty()} = true
                        OR EXISTS (
                            SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                            WHERE tag ILIKE ANY (array[:#{#tags}])
                        )
                    )
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
            """, nativeQuery = true)
    Page<PackageDetailProjection> getOpenCatalogPackageDetail(
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultyPackageSessionStatus") List<String> facultyPackageSessionStatus,
            @Param("tags") List<String> tags,
            @Param("levelStatus") List<String> levelStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("createdByUserId") String createdByUserId,
            @Param("sessionIds") List<String> sessionIds,
            @Param("packageIds") List<String> packageIds,
            Pageable pageable);

    /**
     * Returns paginated distinct package IDs matching all filters.
     * Uses manual LIMIT/OFFSET to avoid Spring Data Page<String> native query issues.
     */
    @Query(value = """
            SELECT p.id
            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id
            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND fspm.subject_id IS NULL
                AND (
                    :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                    OR fspm.status IN (:facultyPackageSessionStatus)
                )
            WHERE
                (:isPublishedOnly = false OR p.is_course_published_to_catalaouge = true)
                AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
                AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                AND (
                    CAST(:packageSessionFilter AS VARCHAR) IS NULL
                    OR :packageSessionFilter = ''
                    OR (:packageSessionFilter = 'PARENTS_ONLY' AND COALESCE(ps.is_parent, false) = true)
                    OR (:packageSessionFilter = 'CHILDREN_ONLY' AND ps.parent_id IS NOT NULL)
                )
                AND (
                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping f
                        WHERE f.package_session_id = ps.id
                        AND f.user_id IN (:facultyIds)
                        AND f.subject_id IS NULL
                        AND (
                            :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                            OR f.status IN (:facultyPackageSessionStatus)
                        )
                    )
                )
                AND (
                    :#{#tags == null || #tags.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE tag ILIKE ANY (array[:#{#tags}])
                    )
                )
                AND (
                    :name IS NULL OR
                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                    EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', :name, '%'))
                    ) OR
                    LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', :name, '%'))
                )
            GROUP BY p.id, p.created_at
            ORDER BY p.created_at DESC
            LIMIT :limit OFFSET :offset
            """, nativeQuery = true)
    List<String> getDistinctPackageIds(
            @Param("isPublishedOnly") boolean isPublishedOnly,
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultyPackageSessionStatus") List<String> facultyPackageSessionStatus,
            @Param("tags") List<String> tags,
            @Param("levelStatus") List<String> levelStatus,
            @Param("sessionIds") List<String> sessionIds,
            @Param("packageIds") List<String> packageIds,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("packageSessionFilter") String packageSessionFilter,
            @Param("createdByUserId") String createdByUserId,
            @Param("limit") int limit,
            @Param("offset") int offset);

    /**
     * Counts distinct packages matching all filters. Used with getDistinctPackageIds for manual pagination.
     */
    @Query(value = """
            SELECT COUNT(DISTINCT p.id)
            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id
            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND fspm.subject_id IS NULL
                AND (
                    :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                    OR fspm.status IN (:facultyPackageSessionStatus)
                )
            WHERE
                (:isPublishedOnly = false OR p.is_course_published_to_catalaouge = true)
                AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
                AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                AND (
                    CAST(:packageSessionFilter AS VARCHAR) IS NULL
                    OR :packageSessionFilter = ''
                    OR (:packageSessionFilter = 'PARENTS_ONLY' AND COALESCE(ps.is_parent, false) = true)
                    OR (:packageSessionFilter = 'CHILDREN_ONLY' AND ps.parent_id IS NOT NULL)
                )
                AND (
                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping f
                        WHERE f.package_session_id = ps.id
                        AND f.user_id IN (:facultyIds)
                        AND f.subject_id IS NULL
                        AND (
                            :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                            OR f.status IN (:facultyPackageSessionStatus)
                        )
                    )
                )
                AND (
                    :#{#tags == null || #tags.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE tag ILIKE ANY (array[:#{#tags}])
                    )
                )
                AND (
                    :name IS NULL OR
                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', :name, '%')) OR
                    EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', :name, '%'))
                    ) OR
                    LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', :name, '%'))
                )
            """, nativeQuery = true)
    long countDistinctPackages(
            @Param("isPublishedOnly") boolean isPublishedOnly,
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultyPackageSessionStatus") List<String> facultyPackageSessionStatus,
            @Param("tags") List<String> tags,
            @Param("levelStatus") List<String> levelStatus,
            @Param("sessionIds") List<String> sessionIds,
            @Param("packageIds") List<String> packageIds,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("packageSessionFilter") String packageSessionFilter,
            @Param("createdByUserId") String createdByUserId);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                    p.package_type AS packageType,
                p.created_at AS createdAt,

                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,
                COALESCE(MAX(ps_read_time.total_read_time_minutes), 0) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session ps2 ON ps2.id = r.source_id
                        AND r.source_type = 'PACKAGE_SESSION'
                        AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true
                                OR ps2.status IN (:packageSessionStatus))
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                ), 0.0) AS rating,

                ps.id AS packageSessionId,
                MIN(l.id) AS levelId,
                MIN(l.level_name) AS levelName,

                ARRAY_REMOVE(
                    ARRAY_AGG(DISTINCT
                        CASE
                            WHEN (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                    OR fspm.status IN (:facultySubjectSessionStatus))
                            THEN fspm.user_id
                            ELSE NULL
                        END
                    ), NULL
                ) AS facultyUserIds,

                /* CHANGED: Now returns only the current level ID in an array */
                ARRAY[CAST(MIN(l.id) AS text)] AS levelIds,

                COALESCE((
                    SELECT CAST(GREATEST(0, EXTRACT(DAY FROM
                        COALESCE(up.end_date, up.start_date + pp.validity_in_days * INTERVAL '1 day', up.created_at + pp.validity_in_days * INTERVAL '1 day')
                        - CURRENT_TIMESTAMP
                    )) AS INTEGER)
                    FROM user_plan up
                    JOIN payment_plan pp ON pp.id = up.plan_id
                    WHERE up.user_id = :userId
                    AND up.payment_option_id IN (
                        SELECT psli.payment_option_id
                        FROM package_session_learner_invitation_to_payment_option psli
                        WHERE psli.package_session_id = ps.id
                    )
                    AND up.status = 'ACTIVE'
                    ORDER BY up.created_at DESC
                    LIMIT 1
                ), 0) AS validityInDays

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id

            JOIN student_session_institute_group_mapping ssigm
                ON ssigm.package_session_id = ps.id
                AND ssigm.user_id = :userId
                AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))

            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND user_id = :userId
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = ps.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND (
                    :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                    OR fspm.status IN (:facultySubjectSessionStatus)
                )

            LEFT JOIN LATERAL (
                SELECT
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                SELECT COUNT(*) FROM assignment_slide_question asq
                                WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                            ), 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                SELECT COUNT(*) FROM quiz_slide_question qsq
                                WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                            ), 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM chapter_package_session_mapping cpsm
                JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                JOIN slide s ON s.id = cs.slide_id
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                WHERE cpsm.package_session_id = ps.id
                    AND s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
            ) ps_read_time ON TRUE

            WHERE
                (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                    AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (
                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping f
                        WHERE f.package_session_id = ps.id
                        AND f.user_id IN (:facultyIds)
                        AND (
                            :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                            OR f.status IN (:facultySubjectSessionStatus)
                        )
                    )
                )
                AND (
                    :#{#tags == null || #tags.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE tag ILIKE ANY (array[:#{#tags}])
                    )
                )

            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at,
                ps.id

            HAVING COALESCE(MAX(lo.total_progress), 0) < 100
            """,

            countQuery = """
                    SELECT COUNT(*) FROM (
                        SELECT ps.id
                        FROM package p
                        JOIN package_session ps ON ps.package_id = p.id
                        JOIN level l ON l.id = ps.level_id
                        JOIN package_institute pi ON pi.package_id = p.id
                        JOIN student_session_institute_group_mapping ssigm
                            ON ssigm.package_session_id = ps.id
                            AND ssigm.user_id = :userId
                            AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))
                        LEFT JOIN (
                            SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                            FROM learner_operation
                            WHERE source = 'PACKAGE_SESSION'
                              AND user_id = :userId
                              AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                            GROUP BY source_id
                        ) lo ON lo.source_id = ps.id
                        WHERE
                            (:instituteId IS NULL OR pi.institute_id = :instituteId)
                            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                            AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                            AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                            AND (
                                :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                                OR EXISTS (
                                    SELECT 1 FROM faculty_subject_package_session_mapping f
                                    WHERE f.package_session_id = ps.id
                                    AND f.user_id IN (:facultyIds)
                                    AND (
                                        :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                        OR f.status IN (:facultySubjectSessionStatus)
                                    )
                                )
                            )
                            AND (
                                :#{#tags == null || #tags.isEmpty()} = true
                                OR EXISTS (
                                    SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                    WHERE tag ILIKE ANY (array[:#{#tags}])
                                )
                            )
                        GROUP BY ps.id, lo.total_progress
                        HAVING COALESCE(lo.total_progress, 0) < 100
                    ) AS count_subquery
                    """, nativeQuery = true)
    Page<PackageDetailProjection> getIncompleteMappedPackages(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("learnerOperations") List<String> learnerOperations,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("tags") List<String> tags,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("mappingStatuses") List<String> mappingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                p.created_at AS createdAt,
                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,
                0 AS readTimeInMinutes,
                0.0 AS rating,
                dest_ps.id AS packageSessionId,
                dest_l.id AS levelId,
                dest_l.level_name AS levelName,
                CAST(ARRAY[] AS text[]) AS facultyUserIds,
                ARRAY[CAST(dest_l.id AS text)] AS levelIds,
                0 AS validityInDays
            FROM student_session_institute_group_mapping ssigm
            JOIN package_session dest_ps
                ON dest_ps.id = COALESCE(ssigm.destination_package_session_id, ssigm.package_session_id)
            JOIN level dest_l ON dest_l.id = dest_ps.level_id
            JOIN package p ON p.id = dest_ps.package_id
            JOIN package_institute pi ON pi.package_id = p.id
            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND (:userId IS NULL OR user_id = :userId)
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true
                       OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = dest_ps.id
            WHERE ssigm.user_id = :userId
                AND (
                    (ssigm.status = 'INVITED' AND ssigm.destination_package_session_id IS NOT NULL)
                    OR ssigm.status = 'INACTIVE'
                )
                AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR dest_l.id IN (:levelIds))
            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at,
                dest_ps.id, dest_l.id, dest_l.level_name,
                ssigm.created_at
            """,
            countQuery = """
                SELECT COUNT(*) FROM (
                    SELECT dest_ps.id
                    FROM student_session_institute_group_mapping ssigm
                    JOIN package_session dest_ps
                        ON dest_ps.id = COALESCE(ssigm.destination_package_session_id, ssigm.package_session_id)
                    JOIN level dest_l ON dest_l.id = dest_ps.level_id
                    JOIN package p ON p.id = dest_ps.package_id
                    JOIN package_institute pi ON pi.package_id = p.id
                    WHERE ssigm.user_id = :userId
                        AND (
                            (ssigm.status = 'INVITED' AND ssigm.destination_package_session_id IS NOT NULL)
                            OR ssigm.status = 'INACTIVE'
                        )
                        AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR dest_l.id IN (:levelIds))
                    GROUP BY dest_ps.id
                ) AS count_subquery
                """, nativeQuery = true)
    Page<PackageDetailProjection> getPastLearnerPackages(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("learnerOperations") List<String> learnerOperations,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                    p.package_type AS packageType,
                p.created_at AS createdAt,

                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,
                COALESCE(MAX(ps_read_time.total_read_time_minutes), 0) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session psr ON psr.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND psr.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    AND (
                        r.source_type != 'PACKAGE_SESSION'
                        OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR psr.status IN (:packageSessionStatus))
                    )
                ), 0.0) AS rating,

                /* Session & Level Info */
                ps.id AS packageSessionId,
                MIN(l.id) AS levelId,
                MIN(l.level_name) AS levelName,

                ARRAY_REMOVE(
                    ARRAY_AGG(DISTINCT
                        CASE
                            WHEN (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                  OR fspm.status IN (:facultySubjectSessionStatus))
                            THEN fspm.user_id
                            ELSE NULL
                        END
                    ), NULL
                ) AS facultyUserIds,

                /* Returns only the current level ID in the array */
                ARRAY[CAST(MIN(l.id) AS text)] AS levelIds,

                COALESCE((
                    SELECT CAST(GREATEST(0, EXTRACT(DAY FROM
                        COALESCE(up.end_date, up.start_date + pp.validity_in_days * INTERVAL '1 day', up.created_at + pp.validity_in_days * INTERVAL '1 day')
                        - CURRENT_TIMESTAMP
                    )) AS INTEGER)
                    FROM user_plan up
                    JOIN payment_plan pp ON pp.id = up.plan_id
                    WHERE up.user_id = :userId
                    AND up.payment_option_id IN (
                        SELECT psli.payment_option_id
                        FROM package_session_learner_invitation_to_payment_option psli
                        WHERE psli.package_session_id = ps.id
                    )
                    AND up.status = 'ACTIVE'
                    ORDER BY up.created_at DESC
                    LIMIT 1
                ), 0) AS validityInDays

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id

            /* Inner Join for Assigned Packages */
            JOIN student_session_institute_group_mapping ssigm
              ON ssigm.package_session_id = ps.id
              AND ssigm.user_id = :userId
              AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))

            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND user_id = :userId
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = ps.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
              ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
              AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))

            LEFT JOIN LATERAL (
                SELECT
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                SELECT COUNT(*) FROM assignment_slide_question asq
                                WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                            ), 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                SELECT COUNT(*) FROM quiz_slide_question qsq
                                WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                            ), 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM chapter_package_session_mapping cpsm
                JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                JOIN slide s ON s.id = cs.slide_id
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                WHERE cpsm.package_session_id = ps.id
                    AND s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
            ) ps_read_time ON TRUE

            WHERE
              (CAST(:instituteId AS text) IS NULL OR pi.institute_id = :instituteId)
              AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                    AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
              AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
              AND (
                  CAST(:name AS text) IS NULL OR
                  LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                  LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                  EXISTS (
                      SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                      WHERE LOWER(tag) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                  ) OR
                  /* Note: Ensure fspm has a 'name' column or join to user table if needed */
                  LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
              )

            GROUP BY
              p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
              p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
              p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
              p.course_depth, p.course_html_description, p.package_type, p.created_at,
              ps.id
            """,

            countQuery = """
                    SELECT COUNT(DISTINCT ps.id)
                    FROM package p
                    JOIN package_session ps ON ps.package_id = p.id
                    JOIN level l ON l.id = ps.level_id
                    JOIN package_institute pi ON pi.package_id = p.id
                    JOIN student_session_institute_group_mapping ssigm
                      ON ssigm.package_session_id = ps.id
                      AND ssigm.user_id = :userId
                      AND (:#{#mappingStatuses == null || #mappingStatuses.isEmpty()} = true OR ssigm.status IN (:mappingStatuses))
                    LEFT JOIN faculty_subject_package_session_mapping fspm
                      ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                      AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))
                    WHERE
                      (CAST(:instituteId AS text) IS NULL OR pi.institute_id = :instituteId)
                      AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                            AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                      AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                      AND (
                          CAST(:name AS text) IS NULL OR
                          LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                          LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                          EXISTS (
                              SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                              WHERE LOWER(tag) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                          ) OR
                          LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                      )
                    """, nativeQuery = true)
    Page<PackageDetailProjection> getStudentAssignedPackages(
            @Param("userId") String userId,
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("learnerOperations") List<String> learnerOperations,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("mappingStatuses") List<String> mappingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparatedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                p.created_at AS createdAt,

                /* 1. Calculate Progress */
                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,

                COALESCE(MAX(ps_read_time.total_read_time_minutes), 0) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session psr ON psr.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND psr.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    AND (
                        r.source_type != 'PACKAGE_SESSION'
                        OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR psr.status IN (:packageSessionStatus))
                    )
                ), 0.0) AS rating,

                /* 2. Session/Level Identifiers */
                ps.id AS packageSessionId,
                MIN(l.id) AS levelId,
                MIN(l.level_name) AS levelName,

                ARRAY_REMOVE(ARRAY_AGG(DISTINCT fspm.user_id), NULL) AS facultyUserIds,
                p.created_by_user_id AS createdByUserId,

                /* 3. Return only current Level ID */
                ARRAY[CAST(MIN(l.id) AS text)] AS levelIds

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id

            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND (:userId IS NULL OR user_id = :userId)
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = ps.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))

            LEFT JOIN LATERAL (
                SELECT
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                SELECT COUNT(*) FROM assignment_slide_question asq
                                WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                            ), 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                SELECT COUNT(*) FROM quiz_slide_question qsq
                                WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                            ), 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM chapter_package_session_mapping cpsm
                JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                JOIN slide s ON s.id = cs.slide_id
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                WHERE cpsm.package_session_id = ps.id
                    AND s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
            ) ps_read_time ON TRUE

            WHERE
                p.is_course_published_to_catalaouge = true
                AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (
                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping f
                        WHERE f.package_session_id = ps.id
                        AND f.subject_id IS NULL
                        AND f.user_id IN (:facultyIds)
                        AND (
                            :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                            OR f.status IN (:facultySubjectSessionStatus)
                        )
                    )
                )
                AND (
                    :#{#tags == null || #tags.isEmpty()} = true
                    OR EXISTS (
                        SELECT 1
                        FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE tag ILIKE ANY (array[:#{#tags}])
                    )
                )

            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at, p.created_by_user_id,
                ps.id /* 4. Added Grouping by Session */
            """,

            countQuery = """
                        SELECT COUNT(DISTINCT ps.id) /* 5. Count Distinct Sessions */
                        FROM package p
                        JOIN package_session ps ON ps.package_id = p.id
                        JOIN level l ON l.id = ps.level_id
                        JOIN package_institute pi ON pi.package_id = p.id
                        WHERE
                            p.is_course_published_to_catalaouge = true
                            AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                            AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                            AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                    AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                            AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                            AND (
                                :#{#facultyIds == null || #facultyIds.isEmpty()} = true
                                OR EXISTS (
                                    SELECT 1 FROM faculty_subject_package_session_mapping f
                                    WHERE f.package_session_id = ps.id
                                    AND f.subject_id IS NULL
                                    AND f.user_id IN (:facultyIds)
                                    AND (
                                        :#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true
                                        OR f.status IN (:facultySubjectSessionStatus)
                                    )
                                )
                            )
                            AND (
                                :#{#tags == null || #tags.isEmpty()} = true
                                OR EXISTS (
                                    SELECT 1
                                    FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                    WHERE tag ILIKE ANY (array[:#{#tags}])
                                )
                            )
                        """, nativeQuery = true)
    Page<PackageDetailProjection> getAllLearnerPackagesIrrespectiveOfProgress(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("sessionIds") List<String> sessionIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("learnerOperations") List<String> learnerOperations,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("tags") List<String> tags,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            Pageable pageable);

    @Query(value = """
            SELECT
                p.id AS id,
                p.package_name AS packageName,
                p.thumbnail_file_id AS thumbnailFileId,
                p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                p.course_preview_image_media_id AS coursePreviewImageMediaId,
                p.course_banner_media_id AS courseBannerMediaId,
                p.course_media_id AS courseMediaId,
                p.why_learn AS whyLearnHtml,
                p.who_should_learn AS whoShouldLearnHtml,
                p.about_the_course AS aboutTheCourseHtml,
                p.comma_separated_tags AS commaSeparetedTags,
                p.course_depth AS courseDepth,
                p.course_html_description AS courseHtmlDescriptionHtml,
                p.package_type AS packageType,
                p.created_at AS createdAt,

                COALESCE(MAX(lo.total_progress), 0) AS percentageCompleted,
                COALESCE(MAX(ps_read_time.total_read_time_minutes), 0) AS readTimeInMinutes,

                COALESCE((
                    SELECT AVG(r.points)
                    FROM rating r
                    LEFT JOIN package_session psr ON psr.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                    WHERE (
                        (r.source_type = 'PACKAGE_SESSION' AND psr.package_id = p.id)
                        OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                    )
                    AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    AND (
                        r.source_type != 'PACKAGE_SESSION'
                        OR (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR psr.status IN (:packageSessionStatus))
                    )
                ), 0.0) AS rating,

                ps.id AS packageSessionId,
                MIN(l.id) AS levelId,
                MIN(l.level_name) AS levelName,

                ARRAY_REMOVE(ARRAY_AGG(DISTINCT fspm.user_id), NULL) AS facultyUserIds,
                p.created_by_user_id AS createdByUserId,

                /* Fixed: Return only current level ID */
                ARRAY[CAST(MIN(l.id) AS text)] AS levelIds

            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id

            LEFT JOIN (
                SELECT source_id, SUM(CAST(value AS DOUBLE PRECISION)) AS total_progress
                FROM learner_operation
                WHERE source = 'PACKAGE_SESSION'
                  AND (:userId IS NULL OR user_id = :userId)
                  AND (:#{#learnerOperations == null || #learnerOperations.isEmpty()} = true OR operation IN (:learnerOperations))
                GROUP BY source_id
            ) lo ON lo.source_id = ps.id

            LEFT JOIN faculty_subject_package_session_mapping fspm
                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))

            LEFT JOIN LATERAL (
                SELECT
                    SUM(
                        CASE
                            WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                            WHEN s.source_type = 'DOCUMENT' THEN
                                CASE
                                    WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                    WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                    ELSE 10
                                END
                            WHEN s.source_type = 'QUESTION' THEN 5
                            WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                SELECT COUNT(*) FROM assignment_slide_question asq
                                WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                            ), 0) * 3
                            WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                SELECT COUNT(*) FROM quiz_slide_question qsq
                                WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                            ), 0) * 2
                            ELSE 0
                        END
                    ) AS total_read_time_minutes
                FROM chapter_package_session_mapping cpsm
                JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                JOIN slide s ON s.id = cs.slide_id
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                WHERE cpsm.package_session_id = ps.id
                    AND s.status IN (:slideStatusList)
                    AND cs.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterPackageStatusList)
            ) ps_read_time ON TRUE

            WHERE
                p.is_course_published_to_catalaouge = true
                AND (CAST(:instituteId AS text) IS NULL OR pi.institute_id = :instituteId)
                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                AND (
                    CAST(:name AS text) IS NULL OR
                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                    EXISTS (
                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                    ) OR
                    LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                )

            GROUP BY
                p.id, p.package_name, p.thumbnail_file_id, p.is_course_published_to_catalaouge,
                p.course_preview_image_media_id, p.course_banner_media_id, p.course_media_id,
                p.why_learn, p.who_should_learn, p.about_the_course, p.comma_separated_tags,
                p.course_depth, p.course_html_description, p.package_type, p.created_at, p.created_by_user_id,
                ps.id
            """,

            countQuery = """
                            SELECT COUNT(DISTINCT ps.id)
                            FROM package p
                            JOIN package_session ps ON ps.package_id = p.id
                            JOIN level l ON l.id = ps.level_id
                            JOIN package_institute pi ON pi.package_id = p.id
                            LEFT JOIN faculty_subject_package_session_mapping fspm
                                ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                                AND (:#{#facultySubjectSessionStatus == null || #facultySubjectSessionStatus.isEmpty()} = true OR fspm.status IN (:facultySubjectSessionStatus))
                            WHERE
                                p.is_course_published_to_catalaouge = true
                                AND (CAST(:instituteId AS text) IS NULL OR pi.institute_id = :instituteId)
                                AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                    AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                                AND (
                                    CAST(:name AS text) IS NULL OR
                                    LOWER(p.package_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                                    LOWER(l.level_name) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%')) OR
                                    EXISTS (
                                        SELECT 1 FROM unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
                                        WHERE LOWER(tag) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                                    ) OR
                                    LOWER(COALESCE(fspm.name, '')) LIKE LOWER(CONCAT('%', CAST(:name AS text), '%'))
                                )
                        """, nativeQuery = true)
    Page<PackageDetailProjection> getAllPackagesIrrespectiveOfLearnerOperation(
            @Param("userId") String userId,
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("learnerOperations") List<String> learnerOperations,
            @Param("facultySubjectSessionStatus") List<String> facultySubjectSessionStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            Pageable pageable);

    @Query(value = """
            SELECT DISTINCT l.*
            FROM level l
            JOIN package_session ps ON l.id = ps.level_id
            WHERE ps.id IN (:packageSessionIds)
              AND l.status IN (:statusList)
              AND ps.status IN (:statusList)
            """, nativeQuery = true)
    List<LevelProjection> findDistinctLevelsByPackageSessionIdsAndStatusIn(
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("statusList") List<String> statusList);

    @Query(value = """
            SELECT DISTINCT TRIM(tag)
            FROM package_session ps
            JOIN package p ON ps.package_id = p.id,
                 LATERAL unnest(string_to_array(p.comma_separated_tags, ',')) AS tag
            WHERE ps.id IN (:packageSessionIds)
              AND p.status != 'DELETED'
              AND p.comma_separated_tags IS NOT NULL
              AND p.comma_separated_tags != ''
            """, nativeQuery = true)
    List<String> findAllDistinctTagsByPackageSessionIds(@Param("packageSessionIds") List<String> packageSessionIds);

    @Query("""
            SELECT p
            FROM PackageEntity p
            JOIN PackageSession ps ON ps.packageEntity = p
            JOIN PackageInstitute pi ON pi.packageEntity = p
            WHERE LOWER(TRIM(p.packageName)) = LOWER(TRIM(:packageName))
              AND ps.status IN :sessionStatuses
              AND p.status IN :packageStatuses
              AND pi.instituteEntity.id = :instituteId
            ORDER BY p.createdAt DESC
            """)
    Optional<PackageEntity> findTopByPackageNameAndSessionStatusAndInstitute(
            @Param("packageName") String packageName,
            @Param("sessionStatuses") List<String> sessionStatuses,
            @Param("packageStatuses") List<String> packageStatuses,
            @Param("instituteId") String instituteId);

    // Methods for teacher approval workflow
    @Query("SELECT p FROM PackageEntity p WHERE p.createdByUserId = :createdByUserId AND p.status IN :statuses ORDER BY p.createdAt DESC")
    List<PackageEntity> findByCreatedByUserIdAndStatusIn(
            @Param("createdByUserId") String createdByUserId,
            @Param("statuses") List<String> statuses);

    @Query("""
                SELECT p FROM PackageEntity p
                JOIN PackageInstitute pi ON pi.packageEntity = p
                WHERE p.status = :status
                  AND pi.instituteEntity.id = :instituteId
                ORDER BY p.createdAt DESC
            """)
    List<PackageEntity> findByStatusAndInstitute(
            @Param("status") String status,
            @Param("instituteId") String instituteId);

    @Query("SELECT p FROM PackageEntity p WHERE p.originalCourseId = :originalCourseId AND p.createdByUserId = :createdByUserId AND p.status = :status")
    List<PackageEntity> findByOriginalCourseIdAndCreatedByUserIdAndStatus(
            @Param("originalCourseId") String originalCourseId,
            @Param("createdByUserId") String createdByUserId,
            @Param("status") String status);

    /**
     * Get packages where teacher is either:
     * 1. Creator of the package (created_by_user_id = teacherId)
     * 2. Assigned as faculty to any package session of the package
     *
     * @param teacherId              - ID of the teacher/faculty
     * @param packageStatuses        - List of package statuses to filter by
     * @param facultyMappingStatuses - List of faculty mapping statuses to consider
     * @return List of distinct packages
     */
    @Query(value = """
            SELECT DISTINCT p.*
            FROM package p
            WHERE p.id IN (
                -- Packages created by teacher
                SELECT p1.id
                FROM package p1
                WHERE p1.created_by_user_id = :teacherId
                AND (:#{#packageStatuses == null || #packageStatuses.isEmpty()} = true
                     OR p1.status IN (:packageStatuses))

                UNION

                -- Packages where teacher is assigned as faculty to any package session
                SELECT p2.id
                FROM package p2
                JOIN package_session ps ON ps.package_id = p2.id
                JOIN faculty_subject_package_session_mapping fspsm ON fspsm.package_session_id = ps.id
                WHERE fspsm.user_id = :teacherId
                AND (:#{#facultyMappingStatuses == null || #facultyMappingStatuses.isEmpty()} = true
                     OR fspsm.status IN (:facultyMappingStatuses))
                AND (:#{#packageStatuses == null || #packageStatuses.isEmpty()} = true
                     OR p2.status IN (:packageStatuses))
                AND ps.status != 'DELETED'
            )
            ORDER BY p.created_at DESC
            """, nativeQuery = true)
    List<PackageEntity> findTeacherPackagesByCreatedOrFacultyAssignment(
            @Param("teacherId") String teacherId,
            @Param("packageStatuses") List<String> packageStatuses,
            @Param("facultyMappingStatuses") List<String> facultyMappingStatuses);

    /**
     * Get detailed package information where teacher is either creator or assigned
     * as faculty
     * Includes additional metadata about faculty assignments
     */
    @Query(value = """
            SELECT DISTINCT
                p.*,
                CASE
                    WHEN p.created_by_user_id = :teacherId AND COALESCE(faculty_assignments.assignment_count, 0) > 0 THEN 'BOTH'
                    WHEN p.created_by_user_id = :teacherId THEN 'CREATOR'
                    ELSE 'FACULTY_ASSIGNED'
                END as teacher_relationship_type,
                COALESCE(faculty_assignments.assignment_count, 0) as faculty_assignment_count,
                faculty_assignments.assigned_subjects,
                -- Session details
                s.id as session_id,
                s.session_name,
                s.status as session_status,
                s.start_date as session_start_date,
                -- Level details
                l.id as level_id,
                l.level_name,
                l.duration_in_days,
                l.status as level_status,
                l.thumbnail_file_id as level_thumbnail_file_id,
                l.created_at as level_created_at,
                l.updated_at as level_updated_at,
                -- Package Session details
                ps_info.package_session_ids,
                ps_info.package_session_count,
                ps_info.package_session_statuses
            FROM package p
            LEFT JOIN (
                SELECT
                    ps.package_id,
                    COUNT(DISTINCT fspsm.id) as assignment_count,
                    STRING_AGG(DISTINCT s.subject_name, ', ') as assigned_subjects
                FROM package_session ps
                JOIN faculty_subject_package_session_mapping fspsm ON fspsm.package_session_id = ps.id
                LEFT JOIN subject s ON s.id = fspsm.subject_id
                WHERE fspsm.user_id = :teacherId
                AND (:#{#facultyMappingStatuses == null || #facultyMappingStatuses.isEmpty()} = true
                     OR fspsm.status IN (:facultyMappingStatuses))
                AND ps.status != 'DELETED'
                GROUP BY ps.package_id
            ) faculty_assignments ON faculty_assignments.package_id = p.id
            LEFT JOIN (
                SELECT
                    ps.package_id,
                    STRING_AGG(DISTINCT ps.id, ', ') as package_session_ids,
                    COUNT(DISTINCT ps.id) as package_session_count,
                    STRING_AGG(DISTINCT ps.status, ', ') as package_session_statuses
                FROM package_session ps
                WHERE ps.status != 'DELETED'
                GROUP BY ps.package_id
            ) ps_info ON ps_info.package_id = p.id
            LEFT JOIN package_session ps_first ON ps_first.package_id = p.id AND ps_first.status != 'DELETED'
            LEFT JOIN session s ON s.id = ps_first.session_id
            LEFT JOIN level l ON l.id = ps_first.level_id
            WHERE (
                -- Teacher created the package
                p.created_by_user_id = :teacherId
                OR
                -- Teacher is assigned as faculty to any package session
                faculty_assignments.package_id IS NOT NULL
            )
            AND (:#{#packageStatuses == null || #packageStatuses.isEmpty()} = true
                 OR p.status IN (:packageStatuses))
            ORDER BY p.created_at DESC
            """, nativeQuery = true)
    List<Map<String, Object>> findTeacherPackagesWithRelationshipDetails(
            @Param("teacherId") String teacherId,
            @Param("packageStatuses") List<String> packageStatuses,
            @Param("facultyMappingStatuses") List<String> facultyMappingStatuses);

    /**
     * V2: Get detailed package information where teacher is either creator or
     * assigned as faculty
     * Includes DELETED filter and pagination support
     */
    @Query(value = """
            SELECT DISTINCT
                p.*,
                CASE
                    WHEN p.created_by_user_id = :teacherId AND COALESCE(faculty_assignments.assignment_count, 0) > 0 THEN 'BOTH'
                    WHEN p.created_by_user_id = :teacherId THEN 'CREATOR'
                    ELSE 'FACULTY_ASSIGNED'
                END as teacher_relationship_type,
                COALESCE(faculty_assignments.assignment_count, 0) as faculty_assignment_count,
                faculty_assignments.assigned_subjects,
                -- Session details
                s.id as session_id,
                s.session_name,
                s.status as session_status,
                s.start_date as session_start_date,
                -- Level details
                l.id as level_id,
                l.level_name,
                l.duration_in_days,
                l.status as level_status,
                l.thumbnail_file_id as level_thumbnail_file_id,
                l.created_at as level_created_at,
                l.updated_at as level_updated_at,
                -- Package Session details
                ps_info.package_session_ids,
                ps_info.package_session_count,
                ps_info.package_session_statuses,
                COALESCE(enrollment_info.enrolled_student_count, 0) as enrolled_student_count
            FROM package p
            LEFT JOIN (
                SELECT
                    ps.package_id,
                    COUNT(DISTINCT fspsm.id) as assignment_count,
                    STRING_AGG(DISTINCT s.subject_name, ', ') as assigned_subjects
                FROM package_session ps
                JOIN faculty_subject_package_session_mapping fspsm ON fspsm.package_session_id = ps.id
                LEFT JOIN subject s ON s.id = fspsm.subject_id
                WHERE fspsm.user_id = :teacherId
                AND (:#{#facultyMappingStatuses == null || #facultyMappingStatuses.isEmpty()} = true
                     OR fspsm.status IN (:facultyMappingStatuses))
                AND ps.status != 'DELETED'
                AND ps.status != 'INVITED'
                GROUP BY ps.package_id
            ) faculty_assignments ON faculty_assignments.package_id = p.id
            LEFT JOIN (
                SELECT
                    ps.package_id,
                    STRING_AGG(DISTINCT ps.id, ', ') as package_session_ids,
                    COUNT(DISTINCT ps.id) as package_session_count,
                    STRING_AGG(DISTINCT ps.status, ', ') as package_session_statuses
                FROM package_session ps
                WHERE ps.status != 'DELETED'
                AND ps.status != 'INVITED'
                GROUP BY ps.package_id
            ) ps_info ON ps_info.package_id = p.id
            LEFT JOIN (
                SELECT
                    ps.package_id,
                    COUNT(*) as enrolled_student_count
                FROM student_session_institute_group_mapping ssigm
                JOIN package_session ps ON ps.id = ssigm.package_session_id
                WHERE ssigm.status IN ('ACTIVE', 'INACTIVE')
                AND ps.status != 'DELETED'
                AND ps.status != 'INVITED'
                GROUP BY ps.package_id
            ) enrollment_info ON enrollment_info.package_id = p.id
            LEFT JOIN package_session ps_first ON ps_first.package_id = p.id AND ps_first.status != 'DELETED'
                AND ps_first.status != 'INVITED'
            LEFT JOIN session s ON s.id = ps_first.session_id
            LEFT JOIN level l ON l.id = ps_first.level_id
            WHERE (
                -- Teacher created the package
                p.created_by_user_id = :teacherId
                OR
                -- Teacher is assigned as faculty to any package session
                faculty_assignments.package_id IS NOT NULL
            )
            AND p.status != 'DELETED'
            AND (:#{#packageStatuses == null || #packageStatuses.isEmpty()} = true
                 OR p.status IN (:packageStatuses))
            ORDER BY p.created_at DESC
            """, countQuery = """
            SELECT COUNT(*)
            FROM (
                SELECT DISTINCT
                    p.id,
                    CASE
                        WHEN p.created_by_user_id = :teacherId AND COALESCE(faculty_assignments.assignment_count, 0) > 0 THEN 'BOTH'
                        WHEN p.created_by_user_id = :teacherId THEN 'CREATOR'
                        ELSE 'FACULTY_ASSIGNED'
                    END as teacher_relationship_type,
                    s.id as session_id,
                    l.id as level_id
                FROM package p
                LEFT JOIN (
                    SELECT
                        ps.package_id,
                        COUNT(DISTINCT fspsm.id) as assignment_count
                FROM package_session ps
                JOIN faculty_subject_package_session_mapping fspsm ON fspsm.package_session_id = ps.id
                WHERE fspsm.user_id = :teacherId
                AND (:#{#facultyMappingStatuses == null || #facultyMappingStatuses.isEmpty()} = true
                     OR fspsm.status IN (:facultyMappingStatuses))
                AND ps.status != 'DELETED'
                AND ps.status != 'INVITED'
                GROUP BY ps.package_id
            ) faculty_assignments ON faculty_assignments.package_id = p.id
            LEFT JOIN (
                SELECT
                    ps.package_id,
                    STRING_AGG(DISTINCT ps.id, ', ') as package_session_ids,
                    COUNT(DISTINCT ps.id) as package_session_count,
                    STRING_AGG(DISTINCT ps.status, ', ') as package_session_statuses
                FROM package_session ps
                WHERE ps.status != 'DELETED'
                AND ps.status != 'INVITED'
                GROUP BY ps.package_id
            ) ps_info ON ps_info.package_id = p.id
            LEFT JOIN package_session ps_first ON ps_first.package_id = p.id AND ps_first.status != 'DELETED'
                AND ps_first.status != 'INVITED'
                LEFT JOIN session s ON s.id = ps_first.session_id
                LEFT JOIN level l ON l.id = ps_first.level_id
                WHERE (
                    p.created_by_user_id = :teacherId
                    OR
                    faculty_assignments.package_id IS NOT NULL
                )
                AND p.status != 'DELETED'
                AND (:#{#packageStatuses == null || #packageStatuses.isEmpty()} = true
                     OR p.status IN (:packageStatuses))
            ) distinct_rows
            """, nativeQuery = true)
    Page<Map<String, Object>> findTeacherPackagesWithRelationshipDetailsV2(
            @Param("teacherId") String teacherId,
            @Param("packageStatuses") List<String> packageStatuses,
            @Param("facultyMappingStatuses") List<String> facultyMappingStatuses,
            Pageable pageable);

    @Query(value = """
                -- CTE: package_session + default enroll_invite -> pick recent psli -> its payment_option -> min price plan
                WITH payment_info AS (
                    SELECT
                        ps.id AS package_session_id,
                        ei.id AS enroll_invite_id,
                        ei.status AS enroll_invite_status,
                        ei.start_date AS enroll_invite_start_date,
                        ei.end_date AS enroll_invite_end_date,
                        psli.id AS psli_id,
                        po.id AS payment_option_id,
                        po.type AS payment_option_type,
                        po.status AS payment_option_status,
                        pp.id AS payment_plan_id,
                        pp.actual_price,
                        pp.elevated_price,
                        pp.currency,
                        ROW_NUMBER() OVER(PARTITION BY ps.id ORDER BY psli.updated_at DESC NULLS LAST, pp.actual_price ASC NULLS LAST) as row_num
                    FROM package_session ps
                    LEFT JOIN package_session_learner_invitation_to_payment_option psli ON ps.id = psli.package_session_id
                        AND (:#{#psliStatus == null || #psliStatus.isEmpty()} = true OR psli.status IN (:psliStatus))
                    LEFT JOIN enroll_invite ei ON ei.id = psli.enroll_invite_id
                        AND ei.tag = 'DEFAULT'
                        AND (:#{#enrollInviteStatus == null || #enrollInviteStatus.isEmpty()} = true OR ei.status IN (:enrollInviteStatus))
                    LEFT JOIN payment_option po ON po.id = psli.payment_option_id
                        AND (:#{#paymentOptionStatus == null || #paymentOptionStatus.isEmpty()} = true OR po.status IN (:paymentOptionStatus))
                    LEFT JOIN payment_plan pp ON pp.payment_option_id = po.id
                        AND (:#{#paymentPlanStatus == null || #paymentPlanStatus.isEmpty()} = true OR pp.status IN (:paymentPlanStatus))
                )
                SELECT
                    p.id AS id,
                    p.package_name AS packageName,
                    p.thumbnail_file_id AS thumbnailFileId,
                    p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                    p.course_preview_image_media_id AS coursePreviewImageMediaId,
                    p.course_banner_media_id AS courseBannerMediaId,
                    p.course_media_id AS courseMediaId,
                    p.why_learn AS whyLearnHtml,
                    p.who_should_learn AS whoShouldLearnHtml,
                    p.about_the_course AS aboutTheCourseHtml,
                    p.comma_separated_tags AS commaSeparetedTags,
                    p.course_depth AS courseDepth,
                    p.course_html_description AS courseHtmlDescriptionHtml,
                        p.package_type AS packageType,
                    p.created_at AS createdAt,
                    ps.id AS packageSessionId,
                    l.id AS levelId,
                    l.level_name AS levelName,
                    s.id AS sessionId,
                    s.session_name AS sessionName,
                    COALESCE((
                        SELECT AVG(r.points)
                        FROM rating r
                        WHERE (
                            (r.source_type = 'PACKAGE_SESSION' AND r.source_id = ps.id)
                            OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                        )
                        AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    ), 0.0) AS rating,
                    COALESCE(ps_read_time.total_read_time_minutes, 0) AS readTimeInMinutes,

                    -- Default invite -> recent psli -> its payment_option -> min price plan (row_num = 1)
                    payment_info.enroll_invite_id AS enrollInviteId,
                    payment_info.enroll_invite_status AS enrollInviteStatus,
                    payment_info.enroll_invite_start_date AS enrollInviteStartDate,
                    payment_info.enroll_invite_end_date AS enrollInviteEndDate,
                    payment_info.psli_id AS psliId,
                    payment_info.payment_option_id AS paymentOptionId,
                    payment_info.payment_option_type AS paymentOptionType,
                    payment_info.payment_option_status AS paymentOptionStatus,
                    payment_info.payment_plan_id AS paymentPlanId,
                    payment_info.actual_price AS minPlanActualPrice,
                    payment_info.elevated_price AS minPlanElevatedPrice,
                    payment_info.currency AS currency,

                    -- Faculty User IDs aggregation
                    ARRAY_REMOVE(
                        ARRAY_AGG(DISTINCT fspm.user_id), NULL
                    ) AS facultyUserIds,
                    ps.available_slots AS availableSlots,
                    ps.max_seats AS maxSeats,
                    p.created_by_user_id AS createdByUserId,
                    CASE WHEN p.course_setting LIKE '%COMING_SOON%' THEN p.course_setting END AS comingSoonSettingJson

                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id

                -- Join for faculty information
                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND fspm.subject_id IS NULL
                    AND (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true OR fspm.status IN (:facultyPackageSessionStatus))

                -- Join to payment info: default invite, last updated payment_option and its plan
                LEFT JOIN payment_info
                    ON ps.id = payment_info.package_session_id AND payment_info.row_num = 1

                -- Read time subquery
                LEFT JOIN LATERAL (
                    SELECT
                        SUM(
                            CASE
                                WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                                WHEN s.source_type = 'DOCUMENT' THEN
                                    CASE
                                        WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                        WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                        ELSE 10
                                    END
                                WHEN s.source_type = 'QUESTION' THEN 5
                                WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                    SELECT COUNT(*) FROM assignment_slide_question asq
                                    WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                                ), 0) * 3
                                WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                    SELECT COUNT(*) FROM quiz_slide_question qsq
                                    WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                                ), 0) * 2
                                ELSE 0
                            END
                        ) AS total_read_time_minutes
                    FROM chapter_package_session_mapping cpsm
                    JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                    JOIN slide s ON s.id = cs.slide_id
                    LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                    LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                    WHERE cpsm.package_session_id = ps.id
                        AND s.status IN (:slideStatusList)
                        AND cs.status IN (:slideStatusList)
                        AND cpsm.status IN (:chapterPackageStatusList)
                ) ps_read_time ON TRUE

                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                        AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:name IS NULL OR LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')))
                    AND (:#{#tags == null || #tags.isEmpty()} = true OR string_to_array(p.comma_separated_tags, ',') && CAST(ARRAY[:tags] AS text[]))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                    AND (
                        :#{#facultyIds == null || #facultyIds.isEmpty()} = true OR
                        EXISTS (
                            SELECT 1
                            FROM faculty_subject_package_session_mapping fspm_sub
                            WHERE fspm_sub.package_session_id = ps.id
                              AND fspm_sub.user_id IN (:facultyIds)
                              AND (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                   OR fspm_sub.status IN (:facultyPackageSessionStatus))
                        )
                    )
                GROUP BY
                    p.id,
                    p.package_type,
                    p.created_by_user_id,
                    ps.id,
                    l.id,
                    s.id,
                    s.session_name,
                    ps_read_time.total_read_time_minutes,
                    payment_info.enroll_invite_id,
                    payment_info.enroll_invite_status,
                    payment_info.enroll_invite_start_date,
                    payment_info.enroll_invite_end_date,
                    payment_info.psli_id,
                    payment_info.payment_option_id,
                    payment_info.payment_option_type,
                    payment_info.payment_option_status,
                    payment_info.payment_plan_id,
                    payment_info.actual_price,
                    payment_info.elevated_price,
                    payment_info.currency,
                    ps.available_slots,
                    ps.max_seats
            """, countQuery = """
            SELECT COUNT(DISTINCT ps.id)
            FROM package p
            JOIN package_session ps ON ps.package_id = p.id
            JOIN level l ON l.id = ps.level_id
            JOIN package_institute pi ON pi.package_id = p.id
            WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                    AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:name IS NULL OR LOWER(p.package_name) LIKE LOWER(CONCAT('%', :name, '%')))
                    AND (:#{#tags == null || #tags.isEmpty()} = true OR string_to_array(p.comma_separated_tags, ',') && CAST(ARRAY[:tags] AS text[]))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                    AND (
                    :#{#facultyIds == null || #facultyIds.isEmpty()} = true OR
                    EXISTS (
                            SELECT 1
                            FROM faculty_subject_package_session_mapping fspm_sub
                            WHERE fspm_sub.package_session_id = ps.id
                              AND fspm_sub.user_id IN (:facultyIds)
                              AND (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                   OR fspm_sub.status IN (:facultyPackageSessionStatus))
                    )
                )
            """, nativeQuery = true)
    Page<PackageDetailV2Projection> getCatalogPackageDetailV2(
            @Param("name") String name,
            @Param("instituteId") String instituteId,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultyPackageSessionStatus") List<String> facultyPackageSessionStatus,
            @Param("tags") List<String> tags,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("levelStatus") List<String> levelStatus,
            @Param("levelIds") List<String> levelIds,
            @Param("sessionIds") List<String> sessionIds,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("enrollInviteStatus") List<String> enrollInviteStatus,
            @Param("psliStatus") List<String> psliStatus,
            @Param("paymentOptionStatus") List<String> paymentOptionStatus,
            @Param("paymentPlanStatus") List<String> paymentPlanStatus,
            @Param("createdByUserId") String createdByUserId,
            @Param("packageIds") List<String> packageIds,
            Pageable pageable);

    @Query(value = """
                -- CTE: package_session + default enroll_invite -> pick recent psli -> its payment_option -> min price plan
                WITH payment_info AS (
                    SELECT
                        ps.id AS package_session_id,
                        e.id AS enroll_invite_id,
                        e.status AS enroll_invite_status,
                        e.start_date AS enroll_invite_start_date,
                        e.end_date AS enroll_invite_end_date,
                        psli.id AS psli_id,
                        po.id AS payment_option_id,
                        po.type AS payment_option_type,
                        po.status AS payment_option_status,
                        pp.id AS payment_plan_id,
                        pp.actual_price,
                        pp.elevated_price,
                        pp.currency,
                        ROW_NUMBER() OVER(PARTITION BY ps.id ORDER BY psli.updated_at DESC NULLS LAST, pp.actual_price ASC NULLS LAST) as row_num
                    FROM package_session ps
                    LEFT JOIN package_session_learner_invitation_to_payment_option psli ON ps.id = psli.package_session_id
                        AND (:#{#psliStatus == null || #psliStatus.isEmpty()} = true OR psli.status IN (:psliStatus))
                    LEFT JOIN enroll_invite e ON e.id = psli.enroll_invite_id
                        AND e.tag = 'DEFAULT'
                        AND (:#{#enrollInviteStatus == null || #enrollInviteStatus.isEmpty()} = true OR e.status IN (:enrollInviteStatus))
                    LEFT JOIN payment_option po ON po.id = psli.payment_option_id
                        AND (:#{#paymentOptionStatus == null || #paymentOptionStatus.isEmpty()} = true OR po.status IN (:paymentOptionStatus))
                    LEFT JOIN payment_plan pp ON pp.payment_option_id = po.id
                        AND (:#{#paymentPlanStatus == null || #paymentPlanStatus.isEmpty()} = true OR pp.status IN (:paymentPlanStatus))
                )
                SELECT
                    p.id AS id,
                    p.package_name AS packageName,
                    p.thumbnail_file_id AS thumbnailFileId,
                    p.is_course_published_to_catalaouge AS isCoursePublishedToCatalaouge,
                    p.course_preview_image_media_id AS coursePreviewImageMediaId,
                    p.course_banner_media_id AS courseBannerMediaId,
                    p.course_media_id AS courseMediaId,
                    p.why_learn AS whyLearnHtml,
                    p.who_should_learn AS whoShouldLearnHtml,
                    p.about_the_course AS aboutTheCourseHtml,
                    p.comma_separated_tags AS commaSeparetedTags,
                    p.course_depth AS courseDepth,
                    p.course_html_description AS courseHtmlDescriptionHtml,
                        p.package_type AS packageType,
                    p.created_at AS createdAt,
                    ps.id AS packageSessionId,
                    l.id AS levelId,
                    l.level_name AS levelName,
                    s.id AS sessionId,
                    s.session_name AS sessionName,
                    COALESCE((
                        SELECT AVG(r.points)
                        FROM rating r
                        LEFT JOIN package_session ps2
                            ON ps2.id = r.source_id AND r.source_type = 'PACKAGE_SESSION'
                            AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true
                                    OR ps2.status IN (:packageSessionStatus))
                        WHERE (
                            (r.source_type = 'PACKAGE_SESSION' AND ps2.package_id = p.id)
                            OR (r.source_type = 'PACKAGE' AND r.source_id = p.id)
                        )
                        AND (:#{#ratingStatuses == null || #ratingStatuses.isEmpty()} = true OR r.status IN (:ratingStatuses))
                    ), 0.0) AS rating,
                    COALESCE(ps_read_time.total_read_time_minutes, 0) AS readTimeInMinutes,
                    ARRAY_REMOVE(
                        ARRAY_AGG(DISTINCT
                            CASE
                                WHEN fspm.subject_id IS NULL AND
                                        (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                        OR fspm.status IN (:facultyPackageSessionStatus))
                                THEN fspm.user_id
                                ELSE NULL
                            END
                        ), NULL
                    ) AS facultyUserIds,
                    (
                        SELECT ARRAY_AGG(DISTINCT l2.id)
                        FROM package_session ps2
                        JOIN level l2 ON l2.id = ps2.level_id
                        WHERE ps2.package_id = p.id
                    ) AS levelIds,

                    -- Default invite -> recent psli -> its payment_option -> min price plan
                    payment_info.enroll_invite_id AS enrollInviteId,
                    payment_info.enroll_invite_status AS enrollInviteStatus,
                    payment_info.enroll_invite_start_date AS enrollInviteStartDate,
                    payment_info.enroll_invite_end_date AS enrollInviteEndDate,
                    payment_info.psli_id AS psliId,
                    payment_info.payment_option_id AS paymentOptionId,
                    payment_info.payment_option_type AS paymentOptionType,
                    payment_info.payment_option_status AS paymentOptionStatus,
                    payment_info.payment_plan_id AS paymentPlanId,
                    payment_info.actual_price AS minPlanActualPrice,
                    payment_info.elevated_price AS minPlanElevatedPrice,
                    payment_info.currency AS currency,
                    ps.available_slots AS availableSlots,
                    ps.max_seats AS maxSeats,
                    p.created_by_user_id AS createdByUserId,
                    CASE WHEN p.course_setting LIKE '%COMING_SOON%' THEN p.course_setting END AS comingSoonSettingJson

                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id

                LEFT JOIN faculty_subject_package_session_mapping fspm
                    ON fspm.package_session_id = ps.id AND fspm.suborg_id IS NULL
                    AND fspm.subject_id IS NULL
                    AND (
                        :#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                        OR fspm.status IN (:facultyPackageSessionStatus)
                    )

                -- Join to payment info: default invite, recent psli, its payment_option and plan
                LEFT JOIN payment_info
                    ON ps.id = payment_info.package_session_id AND payment_info.row_num = 1

                -- Read time subquery
                LEFT JOIN LATERAL (
                    SELECT
                        SUM(
                            CASE
                                WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                                WHEN s.source_type = 'DOCUMENT' THEN
                                    CASE
                                        WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                        WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                        ELSE 10
                                    END
                                WHEN s.source_type = 'QUESTION' THEN 5
                                WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                    SELECT COUNT(*) FROM assignment_slide_question asq
                                    WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                                ), 0) * 3
                                WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                    SELECT COUNT(*) FROM quiz_slide_question qsq
                                    WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                                ), 0) * 2
                                ELSE 0
                            END
                        ) AS total_read_time_minutes
                    FROM chapter_package_session_mapping cpsm
                    JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                    JOIN slide s ON s.id = cs.slide_id
                    LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                    LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                    WHERE cpsm.package_session_id = ps.id
                        AND s.status IN (:slideStatusList)
                        AND cs.status IN (:slideStatusList)
                        AND cpsm.status IN (:chapterPackageStatusList)
                ) ps_read_time ON TRUE

                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                        AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#tags == null || #tags.isEmpty()} = true OR string_to_array(p.comma_separated_tags, ',') && CAST(ARRAY[:tags] AS text[]))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                    AND (
                        :#{#facultyIds == null || #facultyIds.isEmpty()} = true OR
                        EXISTS (
                            SELECT 1
                            FROM faculty_subject_package_session_mapping fspm_sub
                            WHERE fspm_sub.package_session_id = ps.id
                                AND fspm_sub.subject_id IS NULL
                                AND fspm_sub.user_id IN (:facultyIds)
                                AND (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                        OR fspm_sub.status IN (:facultyPackageSessionStatus))
                        )
                    )

                GROUP BY
                    p.id,
                    p.package_type,
                    p.created_by_user_id,
                    ps.id,
                    l.id,
                    s.id,
                    s.session_name,
                    ps_read_time.total_read_time_minutes,
                    payment_info.enroll_invite_id,
                    payment_info.enroll_invite_status,
                    payment_info.enroll_invite_start_date,
                    payment_info.enroll_invite_end_date,
                    payment_info.psli_id,
                    payment_info.payment_option_id,
                    payment_info.payment_option_type,
                    payment_info.payment_option_status,
                    payment_info.payment_plan_id,
                    payment_info.actual_price,
                    payment_info.elevated_price,
                    payment_info.currency,
                    ps.available_slots,
                    ps.max_seats
            """, countQuery = """
                SELECT COUNT(DISTINCT ps.id)
                FROM package p
                JOIN package_session ps ON ps.package_id = p.id
                JOIN level l ON l.id = ps.level_id
                LEFT JOIN session s ON s.id = ps.session_id
                JOIN package_institute pi ON pi.package_id = p.id
                WHERE
                    p.is_course_published_to_catalaouge = true
                    AND (:instituteId IS NULL OR pi.institute_id = :instituteId)
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR l.id IN (:levelIds))
                    AND (:#{#sessionIds == null || #sessionIds.isEmpty()} = true OR ps.session_id IN (:sessionIds))
                    AND (:#{#levelStatus == null || #levelStatus.isEmpty()} = true OR l.status IN (:levelStatus))
                    AND (:#{#packageStatus == null || #packageStatus.isEmpty()} = true OR p.status IN (:packageStatus))
                        AND (:#{#packageTypes == null || #packageTypes.isEmpty()} = true OR p.package_type IN (:packageTypes))
                    AND (:#{#packageSessionStatus == null || #packageSessionStatus.isEmpty()} = true OR ps.status IN (:packageSessionStatus))
                    AND (:#{#tags == null || #tags.isEmpty()} = true OR string_to_array(p.comma_separated_tags, ',') && CAST(ARRAY[:tags] AS text[]))
                    AND (:#{#createdByUserId == null || #createdByUserId.isEmpty()} = true OR p.created_by_user_id = :createdByUserId)
                    AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))
                    AND (
                        :#{#facultyIds == null || #facultyIds.isEmpty()} = true OR
                        EXISTS (
                            SELECT 1
                            FROM faculty_subject_package_session_mapping fspm_sub
                            WHERE fspm_sub.package_session_id = ps.id
                                AND fspm_sub.subject_id IS NULL
                                AND fspm_sub.user_id IN (:facultyIds)
                                AND (:#{#facultyPackageSessionStatus == null || #facultyPackageSessionStatus.isEmpty()} = true
                                        OR fspm_sub.status IN (:facultyPackageSessionStatus))
                        )
                    )
            """, nativeQuery = true)
    Page<PackageDetailV2Projection> getOpenCatalogPackageDetailV2(
            @Param("instituteId") String instituteId,
            @Param("levelIds") List<String> levelIds,
            @Param("sessionIds") List<String> sessionIds,
            @Param("packageStatus") List<String> packageStatus,
            @Param("packageTypes") List<String> packageTypes,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("facultyIds") List<String> facultyIds,
            @Param("facultyPackageSessionStatus") List<String> facultyPackageSessionStatus,
            @Param("tags") List<String> tags,
            @Param("levelStatus") List<String> levelStatus,
            @Param("ratingStatuses") List<String> ratingStatuses,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("enrollInviteStatus") List<String> enrollInviteStatus,
            @Param("psliStatus") List<String> psliStatus,
            @Param("paymentOptionStatus") List<String> paymentOptionStatus,
            @Param("paymentPlanStatus") List<String> paymentPlanStatus,
            @Param("createdByUserId") String createdByUserId,
            @Param("packageIds") List<String> packageIds,
            Pageable pageable);

    @Query(value = """
                SELECT
                    SUM(COALESCE(ps_read_time.total_read_time_minutes, 0))
                FROM package_session ps
                LEFT JOIN LATERAL (
                    SELECT
                        SUM(
                            CASE
                                WHEN s.source_type = 'VIDEO' THEN ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                                WHEN s.source_type = 'DOCUMENT' THEN
                                    CASE
                                        WHEN ds.type = 'PDF' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120)
                                        WHEN ds.type = 'PRESENTATION' THEN LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60)
                                        ELSE 10
                                    END
                                WHEN s.source_type = 'QUESTION' THEN 5
                                WHEN s.source_type = 'ASSIGNMENT' THEN COALESCE((
                                    SELECT COUNT(*) FROM assignment_slide_question asq
                                    WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)
                                ), 0) * 3
                                WHEN s.source_type = 'QUIZ' THEN COALESCE((
                                    SELECT COUNT(*) FROM quiz_slide_question qsq
                                    WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:questionStatusList)
                                ), 0) * 2
                                ELSE 0
                            END
                        ) AS total_read_time_minutes
                    FROM chapter_package_session_mapping cpsm
                    JOIN chapter_to_slides cs ON cs.chapter_id = cpsm.chapter_id
                    JOIN slide s ON s.id = cs.slide_id
                    LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                    LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                    WHERE cpsm.package_session_id = ps.id
                        AND s.status IN (:slideStatusList)
                        AND cs.status IN (:slideStatusList)
                        AND cpsm.status IN (:chapterPackageStatusList)
                ) ps_read_time ON TRUE
                WHERE
                    ps.package_id = :packageId
                    AND ps.status IN (:packageSessionStatus)
            """, nativeQuery = true)
    Long sumReadTimeInMinutesForPackage(
            @Param("packageId") String packageId,
            @Param("packageSessionStatus") List<String> packageSessionStatus,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList);
}