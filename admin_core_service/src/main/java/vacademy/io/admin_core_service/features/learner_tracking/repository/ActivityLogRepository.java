package vacademy.io.admin_core_service.features.learner_tracking.repository;



import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.core.parameters.P;
import vacademy.io.admin_core_service.features.learner_reports.dto.ChapterSlideProgressProjection;
import vacademy.io.admin_core_service.features.learner_reports.dto.LearnerActivityDataProjection;
import vacademy.io.admin_core_service.features.learner_reports.dto.SubjectProgressProjection;
import vacademy.io.admin_core_service.features.learner_tracking.dto.DailyTimeSpentProjection;
import vacademy.io.admin_core_service.features.points_ledger.dto.DailyActivityProjection;
import vacademy.io.admin_core_service.features.learner_tracking.dto.LearnerActivityProjection;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogProcessingProjection;
import vacademy.io.admin_core_service.features.slide.dto.LearnerProgressProjection;
import vacademy.io.admin_core_service.features.slide.entity.Slide;

import java.sql.Date;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

public interface ActivityLogRepository extends JpaRepository<ActivityLog, String> {

    /**
     * Learner-days with real activity for one institute, in the institute's own
     * timezone — the input to ACTIVITY points accrual.
     *
     * Deliberately lean: the per-learner daily query above joins slide, module,
     * subject and session to scope by content, which is far too heavy to run across
     * a whole institute every night. Membership alone is enough here, and the
     * GROUP BY is on (user, local date) so a learner in several batches still earns
     * one day's points, not one per batch.
     *
     * <p>Two Postgres/Hibernate traps are designed around here, both of which only
     * surface when the query actually RUNS — it compiles and the service boots clean
     * either way:
     * <ul>
     *   <li>The cast is CAST(... AS bigint), never '::bigint'. Hibernate reads a
     *       leading ':' as a named parameter and rewrites '::bigint' to ':bigint',
     *       which reaches Postgres as a syntax error.</li>
     *   <li>The local-date expression is computed ONCE in a subquery rather than
     *       repeated in SELECT and GROUP BY. A named parameter used twice is rendered
     *       as two separate placeholders, so Postgres cannot see the two expressions
     *       as identical and rejects the GROUP BY.</li>
     * </ul>
     */
    @Query(value = """
            SELECT t.user_id AS userId,
                   t.activity_date AS activityDate,
                   CAST(SUM(t.ms) AS bigint) AS millis
            FROM (
                SELECT al.user_id,
                       DATE(al.created_at AT TIME ZONE 'UTC' AT TIME ZONE :zone) AS activity_date,
                       COALESCE(
                           al.engaged_ms,
                           CASE
                               WHEN al.end_time IS NOT NULL AND al.start_time IS NOT NULL
                                   THEN EXTRACT(EPOCH FROM (al.end_time - al.start_time)) * 1000
                               ELSE 0
                           END
                       ) AS ms
                FROM activity_log al
                WHERE al.created_at >= :from
                  AND al.created_at < :to
                  AND al.user_id IN (
                      SELECT DISTINCT ssigm.user_id
                      FROM student_session_institute_group_mapping ssigm
                      WHERE ssigm.institute_id = :instituteId
                        AND ssigm.status IN (:learnerStatuses)
                  )
            ) t
            GROUP BY t.user_id, t.activity_date
            HAVING SUM(t.ms) > 0
            """, nativeQuery = true)
    List<DailyActivityProjection> findDailyActivityForInstitute(
            @Param("instituteId") String instituteId,
            @Param("zone") String zone,
            @Param("from") Timestamp from,
            @Param("to") Timestamp to,
            @Param("learnerStatuses") List<String> learnerStatuses);

    // Merged-union coverage, matching the live write path
    // (LearnerTrackingAsyncService.getUniqueWatchedDurationMillis). The old
    // MAX(end)-MIN(start) span silently inflated the batch/trigger recompute:
    // 10s watched at the start + 10s at the end of a video spanned the whole
    // length and, via the slide-level monotonic guard, permanently promoted
    // the learner to 100%. Returns NULL (skip the write) when the published
    // length is missing or the learner has no valid segments.
    //
    // "No valid segments" MUST be its own CASE branch -- it cannot be left for
    // LEAST() to propagate. Postgres GREATEST/LEAST *ignore* NULL arguments and
    // return NULL only when every argument is NULL, so LEAST(100.0, NULL) is
    // 100.0, not NULL (the opposite of the SQL standard, MySQL and Oracle).
    // Because this query is driven off slide/video it always returns exactly
    // one row, so for a learner with no tracking `merged` was empty, SUM(ms)
    // was NULL, and LEAST handed back a clean 100.0 -- which
    // updateLearnerOperationsForSlideTrigger stored as PERCENTAGE_VIDEO_WATCHED
    // for someone who had never opened the video. updateLearnerOperationsForBatch
    // runs that trigger for every enrolled learner on any slide edit, so a single
    // admin edit marked a whole batch 100% complete, the cascade carried it up to
    // the course percentage, and the slide-level monotonic guard in
    // addOrUpdatePercentageOperation made it permanent. Repaired by V430.
    @Query(value = """
            WITH segs AS (
                SELECT vt.start_time, vt.end_time
                FROM activity_log a
                JOIN video_tracked vt ON vt.activity_id = a.id
                WHERE a.user_id = :userId
                  AND a.slide_id = :slideId
                  AND vt.start_time IS NOT NULL
                  AND vt.end_time IS NOT NULL
                  AND vt.end_time >= vt.start_time
            ),
            ordered AS (
                SELECT start_time, end_time,
                       MAX(end_time) OVER (ORDER BY start_time, end_time
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_end
                FROM segs
            ),
            islands AS (
                SELECT start_time, end_time,
                       SUM(CASE WHEN prev_max_end IS NULL OR start_time > prev_max_end THEN 1 ELSE 0 END)
                           OVER (ORDER BY start_time, end_time) AS island
                FROM ordered
            ),
            merged AS (
                SELECT EXTRACT(EPOCH FROM (MAX(end_time) - MIN(start_time))) * 1000 AS ms
                FROM islands
                GROUP BY island
            ),
            watched AS (
                SELECT SUM(ms) AS watched_ms FROM merged
            )
            SELECT
                CASE
                    WHEN v.published_video_length IS NULL OR v.published_video_length = 0 THEN NULL
                    WHEN w.watched_ms IS NULL THEN NULL
                    ELSE LEAST(100.0, w.watched_ms / v.published_video_length * 100)
                END AS percentage_watched
            FROM slide s
            JOIN video v ON s.source_id = v.id
            CROSS JOIN watched w
            WHERE s.id = :slideId
            """, nativeQuery = true)
    Double getPercentageVideoWatched(@Param("slideId") String slideId, @Param("userId") String userId);

    @Query(value = """
            WITH segs AS (
                SELECT vt.start_time, vt.end_time
                FROM activity_log a
                JOIN video_tracked vt ON vt.activity_id = a.id
                WHERE a.user_id = :userId
                  AND a.slide_id = :slideId
                  AND vt.start_time IS NOT NULL
                  AND vt.end_time IS NOT NULL
                  AND vt.end_time >= vt.start_time
            ),
            ordered AS (
                SELECT start_time, end_time,
                       MAX(end_time) OVER (ORDER BY start_time, end_time
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_end
                FROM segs
            ),
            islands AS (
                SELECT start_time, end_time,
                       SUM(CASE WHEN prev_max_end IS NULL OR start_time > prev_max_end THEN 1 ELSE 0 END)
                           OVER (ORDER BY start_time, end_time) AS island
                FROM ordered
            ),
            merged AS (
                SELECT EXTRACT(EPOCH FROM (MAX(end_time) - MIN(start_time))) * 1000 AS ms
                FROM islands
                GROUP BY island
            ),
            watched AS (
                SELECT SUM(ms) AS watched_ms FROM merged
            )
            SELECT
                CASE
                    WHEN v.video_length IS NULL OR v.video_length = 0 THEN NULL
                    WHEN w.watched_ms IS NULL THEN NULL
                    ELSE LEAST(100.0, w.watched_ms / v.video_length * 100)
                END AS percentage_watched
            FROM slide s
            JOIN html_video_slide v ON s.source_id = v.id
            CROSS JOIN watched w
            WHERE s.id = :slideId
            """, nativeQuery = true)
    Double getPercentageHtmlVideoWatched(@Param("slideId") String slideId, @Param("userId") String userId);

    // Numerator and denominator must count the same population: only questions
    // that (a) belong to THIS quiz and (b) carry an allowed status. The old
    // numerator counted any tracked question id with a non-null quiz_slide_id —
    // including soft-deleted questions and questions from other quizzes.
    // A quiz whose questions are all inactive yields NULL (skip the write).
    @Query(value = """
            WITH quiz_slide_data AS (
                SELECT qz.id AS quiz_slide_id, COUNT(DISTINCT qq.id) AS total_questions
                FROM slide s
                JOIN quiz_slide qz ON qz.id = s.source_id
                LEFT JOIN quiz_slide_question qq ON qq.quiz_slide_id = qz.id
                       AND qq.status IN (:quizSlideStatuses)
                WHERE s.id = :slideId
                  AND s.source_type = 'QUIZ'
                GROUP BY qz.id
            ),
            attempted_questions AS (
                SELECT COUNT(DISTINCT qst.question_id) AS attempted_questions
                FROM activity_log al
                JOIN quiz_slide_question_tracked qst ON qst.activity_id = al.id
                JOIN quiz_slide_question qq ON qq.id = qst.question_id
                JOIN quiz_slide_data qsd ON qq.quiz_slide_id = qsd.quiz_slide_id
                WHERE al.slide_id = :slideId
                  AND al.user_id = :userId
                  AND qq.status IN (:quizSlideStatuses)
            )
            SELECT
                CASE
                    WHEN qsd.total_questions = 0 THEN NULL
                    ELSE ROUND(100.0 * LEAST(aq.attempted_questions, qsd.total_questions)
                               / qsd.total_questions, 2)
                END AS percentage_completed
            FROM quiz_slide_data qsd, attempted_questions aq
            """, nativeQuery = true)
    Double getQuizSlideCompletionPercentage(
            @Param("slideId") String slideId,
            @Param("quizSlideStatuses") List<String> quizSlideStatuses,
            @Param("userId") String userId);

    @Query(value = """
            SELECT vt.start_time, vt.end_time
            FROM activity_log a
            JOIN video_tracked vt ON vt.activity_id = a.id
            WHERE a.user_id = :userId
              AND a.slide_id = :slideId
            """, nativeQuery = true)
    List<Object[]> getVideoTrackedIntervals(@Param("slideId") String slideId, @Param("userId") String userId);

    @Query(value = """
            SELECT at.start_time, at.end_time
            FROM activity_log a
            JOIN audio_tracked at ON at.activity_id = a.id
            WHERE a.user_id = :userId
              AND a.slide_id = :slideId
            """, nativeQuery = true)
    List<Object[]> getAudioTrackedIntervals(@Param("slideId") String slideId, @Param("userId") String userId);

    @Query(value = """
                SELECT
                    -- NULL (not 0) when the publish-time page count is missing/0, matching the
                    -- video path: "cannot compute" must skip the write, not record a real 0 row.
                    -- A valid denominator with no tracked pages still computes 0 via COUNT().
                    (COUNT(DISTINCT dt.page_number) * 100.0 / NULLIF(MAX(ds.published_document_total_pages), 0)) AS percentage_watched
                FROM
                    slide s
                JOIN
                    document_slide ds ON s.source_id = ds.id
                JOIN
                    activity_log al ON s.id = al.slide_id
                LEFT JOIN
                    document_tracked dt ON al.id = dt.activity_id  -- LEFT JOIN ensures 0 is returned if no tracking
                WHERE
                    al.user_id = :userId
                    AND s.id = :slideId
                GROUP BY
                    s.id, al.user_id, ds.id
            """, nativeQuery = true)
    Double getPercentageDocumentWatched(@Param("slideId") String slideId, @Param("userId") String userId);

    @Query(value = """
            SELECT
                COALESCE(SUM(CAST(lo.value AS FLOAT)), 0) / NULLIF(COUNT(DISTINCT cs.slide_id), 0) AS percentage_completed
            FROM
                chapter_to_slides cs
            JOIN
                slide s ON cs.slide_id = s.id
            LEFT JOIN
                learner_operation lo
                    ON lo.source_id = cs.slide_id
                    AND lo.operation IN (:learnerOperation)
                    AND lo.user_id = :userId
                    AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
            WHERE
                cs.status IN (:statusList)
                AND cs.chapter_id = :chapterId
                AND s.source_type IN (:sourceTypeList)
            """, nativeQuery = true)
    Double getChapterCompletionPercentage(
            @Param("userId") String userId,
            @Param("chapterId") String chapterId,
            @Param("learnerOperation") List<String> learnerOperation,
            @Param("statusList") List<String> statusList,
            @Param("sourceTypeList") List<String> sourceTypeList);

    @Query(value = """
                SELECT
                    COALESCE(SUM(lo_val.chapter_value), 0) / NULLIF(COUNT(*), 0) AS percentage_completed
                FROM (
                    SELECT DISTINCT mcm.chapter_id
                    FROM module_chapter_mapping mcm
                    JOIN chapter c ON c.id = mcm.chapter_id
                    JOIN chapter_package_session_mapping cpm ON cpm.chapter_id = c.id
                    WHERE mcm.module_id = :moduleId
                      AND cpm.status IN (:chapterStatusList)
                      AND c.status IN (:chapterStatusList)
                      -- A chapter with no learner-visible slide can never produce a
                      -- percentage: getChapterCompletionPercentage divides by a count
                      -- of 0, returns NULL, and the cascade drops the write, so no
                      -- CHAPTER row is ever stored. It would then land here via the
                      -- LEFT JOIN as 0 and drag the module down forever -- a chapter
                      -- the learner cannot even open counted as work they failed to
                      -- do, capping the course below 100% and blocking certificates.
                      -- Count a chapter only when it could actually produce a value.
                      -- Slide statuses are pinned rather than parameterised because
                      -- every caller passes exactly PUBLISHED + UNSYNC, matching
                      -- the denominator used by getChapterCompletionPercentage.
                      -- NOTE: never write an apostrophe in a comment inside a
                      -- @Query block. Spring Data scans the query for quoted
                      -- ranges before JPA sees it and does not understand SQL
                      -- comments, so a lone apostrophe opens a string literal
                      -- that never closes and the repository bean fails to
                      -- build -- taking the whole service down at startup.
                      AND EXISTS (
                          SELECT 1
                          FROM chapter_to_slides cts
                          JOIN slide s ON s.id = cts.slide_id
                          WHERE cts.chapter_id = c.id
                            AND cts.status IN ('PUBLISHED', 'UNSYNC')
                            AND s.source_type IN ('VIDEO', 'DOCUMENT', 'ASSIGNMENT', 'QUESTION',
                                                  'QUIZ', 'HTML_VIDEO', 'AUDIO', 'SCORM', 'ASSESSMENT')
                      )
                ) distinct_chapters
            LEFT JOIN (
                SELECT DISTINCT ON (lo.source_id)
                    lo.source_id,
                    CAST(lo.value AS FLOAT) AS chapter_value
                FROM learner_operation lo
                WHERE lo.operation IN (:learnerOperation)
                  AND lo.user_id = :userId
                  AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
            ) lo_val ON lo_val.source_id = distinct_chapters.chapter_id
            """, nativeQuery = true)
    Double getModuleCompletionPercentage(
            @Param("userId") String userId,
            @Param("moduleId") String moduleId,
            @Param("learnerOperation") List<String> learnerOperation,
            @Param("chapterStatusList") List<String> chapterStatusList);

    @Query(value = """
            SELECT
                COALESCE(SUM(CAST(lo.value AS FLOAT)), 0) / NULLIF(COUNT(DISTINCT smm.module_id), 0) AS percentage_completed
            FROM
                subject_module_mapping smm
            JOIN
                modules m ON m.id = smm.module_id
            LEFT JOIN
                learner_operation lo ON lo.source_id = m.id
                    AND lo.operation IN (:learnerOperation)
                    AND lo.user_id = :userId
                    AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
            WHERE
                smm.subject_id = :subjectId
                AND m.status IN (:moduleStatusList)
                -- Same rule as getModuleCompletionPercentage, one level up: a
                -- module that cannot produce a percentage must not sit in the
                -- denominator as a 0. A module whose chapters are all empty (or
                -- which has no chapters at all) never gets a MODULE row written,
                -- so it would arrive here through the LEFT JOIN as 0 and hold the
                -- subject down permanently. Count a module only when at least one
                -- of its chapters could produce a value, which is exactly the
                -- denominator getModuleCompletionPercentage uses.
                AND EXISTS (
                    SELECT 1
                    FROM module_chapter_mapping mcm2
                    JOIN chapter c2 ON c2.id = mcm2.chapter_id
                    JOIN chapter_package_session_mapping cpm2 ON cpm2.chapter_id = c2.id
                    WHERE mcm2.module_id = m.id
                      AND c2.status IN (:chapterStatusList)
                      AND cpm2.status IN (:chapterStatusList)
                      AND EXISTS (
                          SELECT 1
                          FROM chapter_to_slides cts2
                          JOIN slide s2 ON s2.id = cts2.slide_id
                          WHERE cts2.chapter_id = c2.id
                            AND cts2.status IN ('PUBLISHED', 'UNSYNC')
                            AND s2.source_type IN ('VIDEO', 'DOCUMENT', 'ASSIGNMENT', 'QUESTION',
                                                   'QUIZ', 'HTML_VIDEO', 'AUDIO', 'SCORM', 'ASSESSMENT')
                      )
                )
            """, nativeQuery = true)
    Double getSubjectCompletionPercentage(
            @Param("userId") String userId,
            @Param("subjectId") String subjectId,
            @Param("learnerOperation") List<String> learnerOperation,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList);

    @Query(value = """
            SELECT
                COALESCE(SUM(CAST(lo.value AS FLOAT)), 0) / NULLIF(COUNT(DISTINCT sps.subject_id), 0) AS percentage_completed
            FROM
                subject_session sps
            JOIN
                subject s ON s.id = sps.subject_id
            LEFT JOIN
                learner_operation lo ON lo.source_id = s.id
                    AND lo.operation IN (:learnerOperation)
                    AND lo.user_id = :userId
                    AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
            WHERE
                sps.session_id = :packageSessionId
                AND s.status IN (:subjectStatusList)
                -- Top of the same chain. A subject with no completable content
                -- would otherwise land here as 0 and cap the course percentage the
                -- learner sees, which is also what certificate eligibility is
                -- gated on. Count a subject only when it has a module that has a
                -- chapter that has a learner-visible slide, matching the
                -- denominators used one and two levels below.
                AND EXISTS (
                    SELECT 1
                    FROM subject_module_mapping smm2
                    JOIN modules m2 ON m2.id = smm2.module_id
                    WHERE smm2.subject_id = s.id
                      AND m2.status IN (:moduleStatusList)
                      AND EXISTS (
                          SELECT 1
                          FROM module_chapter_mapping mcm2
                          JOIN chapter c2 ON c2.id = mcm2.chapter_id
                          JOIN chapter_package_session_mapping cpm2 ON cpm2.chapter_id = c2.id
                          WHERE mcm2.module_id = m2.id
                            AND c2.status IN (:chapterStatusList)
                            AND cpm2.status IN (:chapterStatusList)
                            AND EXISTS (
                                SELECT 1
                                FROM chapter_to_slides cts2
                                JOIN slide s2 ON s2.id = cts2.slide_id
                                WHERE cts2.chapter_id = c2.id
                                  AND cts2.status IN ('PUBLISHED', 'UNSYNC')
                                  AND s2.source_type IN ('VIDEO', 'DOCUMENT', 'ASSIGNMENT', 'QUESTION',
                                                         'QUIZ', 'HTML_VIDEO', 'AUDIO', 'SCORM', 'ASSESSMENT')
                            )
                      )
                )
            """, nativeQuery = true)
    Double getPackageSessionCompletionPercentage(
            @Param("userId") String userId,
            @Param("learnerOperation") List<String> learnerOperation,
            @Param("packageSessionId") String packageSessionId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList);

    /**
     * Resolves the parent chain a chapter rolls up into — module, subject, and the
     * package session(s) the learner is actually enrolled in — directly from the
     * chapter and the learner's enrollment, instead of trusting the client request
     * to carry moduleId/subjectId/packageSessionId. Returns one {moduleId,
     * subjectId, packageSessionId} row per enrolled path (usually one; more for
     * shared content or a learner in multiple batches). The completion cascade uses
     * this so the MODULE / SUBJECT / PACKAGE_SESSION rollups can never be silently
     * skipped when the client omits an id — the historical cause of the learner's
     * course percentage freezing while chapters kept advancing.
     */
    @Query(value = """
            SELECT DISTINCT mcm.module_id, smm.subject_id, cpsm.package_session_id
            FROM module_chapter_mapping mcm
            JOIN subject_module_mapping smm ON smm.module_id = mcm.module_id
            JOIN chapter_package_session_mapping cpsm
                ON cpsm.chapter_id = mcm.chapter_id
                AND cpsm.status IN (:chapterPackageSessionStatusList)
            JOIN student_session_institute_group_mapping ss
                ON ss.package_session_id = cpsm.package_session_id
                AND ss.user_id = :userId
                AND ss.status IN (:enrollmentStatusList)
            WHERE mcm.chapter_id = :chapterId
            """, nativeQuery = true)
    List<Object[]> resolveChapterRollupTargets(
            @Param("userId") String userId,
            @Param("chapterId") String chapterId,
            @Param("chapterPackageSessionStatusList") List<String> chapterPackageSessionStatusList,
            @Param("enrollmentStatusList") List<String> enrollmentStatusList);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.videoTracked vt
            WHERE al.userId = :userId AND al.slideId = :slideId
            """)
    Page<ActivityLog> findActivityLogsWithVideos(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.questionSlideTracked vt
            WHERE al.userId = :userId AND al.slideId = :slideId
            """)
    Page<ActivityLog> findActivityLogsWithQuestionSlides(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.assignmentSlideTracked vt
            WHERE (:userId IS NULL OR :userId = '' OR al.userId = :userId)
              AND al.slideId = :slideId
            """)
    Page<ActivityLog> findActivityLogsWithAssignmentSlide(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    // Only activity logs that actually carry an assessment submission record
    // (INNER JOIN) — completion-only logs for the same slide are excluded.
    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            JOIN FETCH al.assessmentSlideTracked ast
            WHERE (:userId IS NULL OR :userId = '' OR al.userId = :userId)
              AND al.slideId = :slideId
            """)
    Page<ActivityLog> findActivityLogsWithAssessmentSlide(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.quizSlideQuestionTracked qt
            WHERE al.userId = :userId AND al.slideId = :slideId AND al.sourceType = 'QUIZ'
            """)
    Page<ActivityLog> findActivityLogsWithQuizSlide(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.videoSlideQuestionTracked vt
            WHERE al.userId = :userId AND al.slideId = :slideId AND al.sourceType = :sourceType
            """)
    Page<ActivityLog> findActivityLogsWithVideoSlideQuestions(
            @Param("userId") String userId,
            @Param("slideId") String slideId,
            @Param("sourceType") String sourceType,
            Pageable pageable);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.documentTracked dt
            WHERE al.userId = :userId AND al.slideId = :slideId
            """)
    Page<ActivityLog> findActivityLogsWithDocuments(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    @Query("""
            SELECT DISTINCT al FROM ActivityLog al
            LEFT JOIN FETCH al.audioTracked at
            WHERE al.userId = :userId AND al.slideId = :slideId
            """)
    Page<ActivityLog> findActivityLogsWithAudios(@Param("userId") String userId,
            @Param("slideId") String slideId,
            Pageable pageable);

    @Query(value = """
            SELECT s.user_id AS userId,
                   s.full_name AS fullName,
                   (SUM(COALESCE(a.engaged_ms, 0)) / 1000.0) AS totalTimeSpent,
                   MAX(a.updated_at) AS lastActive,
                   CASE
                     WHEN COUNT(ast.id) = 0 THEN NULL
                     WHEN BOOL_OR(
                            (ast.marks IS NOT NULL AND ast.marks > 0)
                            OR ast.feedback IS NOT NULL
                            OR ast.checked_file_id IS NOT NULL
                          ) THEN 'REVIEWED'
                     ELSE 'PENDING'
                   END AS reviewStatus,
                   BOOL_OR(COALESCE(ast.late_submission, FALSE)) AS lateSubmission
            FROM activity_log a
            JOIN student s ON a.user_id = s.user_id
            LEFT JOIN assignment_slide_tracked ast ON ast.activity_id = a.id
            WHERE a.slide_id = :slideId
              AND (CAST(:packageSessionId AS text) IS NULL OR EXISTS (
                    SELECT 1 FROM student_session_institute_group_mapping ssigm
                    WHERE ssigm.user_id = a.user_id
                      AND ssigm.package_session_id = :packageSessionId
                      AND ssigm.status IN (:statusList)
                  ))
              AND (CAST(:search AS text) IS NULL
                   OR s.full_name ILIKE '%' || CAST(:search AS text) || '%'
                   OR s.email ILIKE '%' || CAST(:search AS text) || '%'
                   OR s.username ILIKE '%' || CAST(:search AS text) || '%'
                   OR s.mobile_number ILIKE '%' || CAST(:search AS text) || '%')
            GROUP BY s.user_id, s.full_name
            ORDER BY lastActive DESC
             """,
            countQuery = """
            SELECT COUNT(DISTINCT a.user_id)
            FROM activity_log a
            JOIN student s ON a.user_id = s.user_id
            WHERE a.slide_id = :slideId
              AND (CAST(:packageSessionId AS text) IS NULL OR EXISTS (
                    SELECT 1 FROM student_session_institute_group_mapping ssigm
                    WHERE ssigm.user_id = a.user_id
                      AND ssigm.package_session_id = :packageSessionId
                      AND ssigm.status IN (:statusList)
                  ))
              AND (CAST(:search AS text) IS NULL
                   OR s.full_name ILIKE '%' || CAST(:search AS text) || '%'
                   OR s.email ILIKE '%' || CAST(:search AS text) || '%'
                   OR s.username ILIKE '%' || CAST(:search AS text) || '%'
                   OR s.mobile_number ILIKE '%' || CAST(:search AS text) || '%')
            """,
            nativeQuery = true)
    Page<LearnerActivityProjection> findStudentActivityBySlideId(@Param("slideId") String slideId,
            @Param("packageSessionId") String packageSessionId,
            @Param("search") String search,
            @Param("statusList") List<String> statusList,
            Pageable pageable);

    @Query(value = """
            WITH individual_slide_progress AS (
                SELECT
                    s.id AS slide_id,
                    al.user_id,
                    CASE
                        WHEN s.source_type = 'VIDEO' THEN
                            LEAST(
                                COALESCE(SUM(EXTRACT(EPOCH FROM (vt.end_time - vt.start_time))) * 1000
                                         / NULLIF(COALESCE(v.published_video_length, 1), 0) * 100,
                                0),
                            100)
                        WHEN s.source_type = 'AUDIO' THEN
                            LEAST(
                                COALESCE(SUM(EXTRACT(EPOCH FROM (at.end_time - at.start_time))) * 1000
                                         / NULLIF(COALESCE(aud.published_audio_length_in_millis, 1), 0) * 100,
                                0),
                            100)
                        WHEN s.source_type IN ('DOCUMENT', 'PDF') THEN
                            LEAST(
                                COALESCE(COUNT(DISTINCT dt.page_number) * 100.0
                                         / NULLIF(COALESCE(ds.published_document_total_pages, 1), 0),
                                0),
                            100)
                        ELSE 0
                    END AS slide_completion
                FROM slide s
                LEFT JOIN activity_log al ON al.slide_id = s.id
                LEFT JOIN video_tracked vt ON vt.activity_id = al.id
                LEFT JOIN video v ON s.source_id = v.id AND s.source_type = 'VIDEO'
                LEFT JOIN audio_tracked at ON at.activity_id = al.id
                LEFT JOIN audio_slide aud ON s.source_id = aud.id AND s.source_type = 'AUDIO'
                LEFT JOIN document_tracked dt ON dt.activity_id = al.id
                LEFT JOIN document_slide ds ON s.source_id = ds.id AND s.source_type IN ('DOCUMENT', 'PDF')
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
                JOIN modules m ON m.id = mcm.module_id
                JOIN subject_module_mapping smm ON smm.module_id = m.id
                JOIN subject sub ON sub.id = smm.subject_id
                JOIN subject_session sps ON sps.subject_id = sub.id
                JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id AND cpsm.package_session_id = :sessionId
                JOIN student_session_institute_group_mapping ssigm ON ssigm.package_session_id = sps.session_id AND ssigm.user_id = al.user_id

                WHERE
                    al.created_at BETWEEN :startDate AND :endDate
                    AND sps.session_id = :sessionId
                    AND sub.status IN :subjectStatusList
                    AND m.status IN :moduleStatusList
                    AND c.status IN :chapterStatusList
                    AND cpsm.status IN :chapterToSessionStatusList
                    AND s.status IN :slideStatusList
                    AND cs.status IN :slideStatusList
                    AND s.source_type IN :slideTypeList
                    AND ssigm.status IN :ssigmStatusList
                GROUP BY s.id, s.source_type, v.published_video_length, aud.published_audio_length_in_millis, ds.published_document_total_pages, al.user_id
            ),
            user_wise_progress AS (
                SELECT user_id, AVG(slide_completion) AS user_avg_completion
                FROM individual_slide_progress
                GROUP BY user_id
            )
            SELECT COALESCE(AVG(user_avg_completion), 0) FROM user_wise_progress
            """, nativeQuery = true)
    Double getBatchCourseCompletionPercentagePerLearner(
            @Param("sessionId") String sessionId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("chapterToSessionStatusList") List<String> chapterToSessionStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("slideTypeList") List<String> slideTypeList,
            @Param("ssigmStatusList") List<String> ssigmStatusList);

    @Query(value = """
                WITH filtered_activity_log AS (
                    SELECT DISTINCT al.id, al.user_id, al.start_time, al.end_time, al.engaged_ms
                    FROM activity_log al
                    JOIN slide s ON s.id = al.slide_id
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
                    JOIN modules m ON m.id = mcm.module_id
                    JOIN subject_module_mapping smm ON smm.module_id = m.id
                    JOIN subject sub ON sub.id = smm.subject_id
                    JOIN subject_session sps ON sps.subject_id = sub.id
                    JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id AND cpsm.package_session_id = :packageSessionId
                    WHERE
                        al.created_at BETWEEN :startDate AND :endDate
                        AND sps.session_id = :packageSessionId
                        AND sub.status IN :subjectStatusList
                        AND m.status IN :moduleStatusList
                        AND c.status IN :chapterStatusList
                        AND cpsm.status IN :chapterToSessionStatusList
                        AND s.status IN :slideStatusList
                        AND cs.status IN :slideStatusList
                ),
                activity_duration AS (
                    SELECT
                        al.user_id,
                        COALESCE(SUM(
                            CASE
                                WHEN al.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(al.engaged_ms, 0) / 60000.0)
                            END
                        ), 0) AS total_time_spent_minutes
                    FROM filtered_activity_log al
                    GROUP BY al.user_id
                ),
                batch_time_spent AS (
                    SELECT
                        (SELECT SUM(COALESCE(ad.total_time_spent_minutes, 0)) FROM activity_duration ad) AS total_time_spent,
                        (SELECT COUNT(DISTINCT user_id) FROM student_session_institute_group_mapping WHERE package_session_id = :packageSessionId AND status IN :statusList) AS total_learners
                )
                SELECT
                    CASE
                        WHEN total_learners > 0 THEN COALESCE(total_time_spent, 0) / total_learners
                        ELSE 0
                    END AS avg_time_spent_minutes
                FROM batch_time_spent
            """, nativeQuery = true)
    Double findAverageTimeSpentByBatch(
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate,
            @Param("packageSessionId") String packageSessionId,
            @Param("statusList") List<String> statusList,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("chapterToSessionStatusList") List<String> chapterToSessionStatusList,
            @Param("slideStatusList") List<String> slideStatusList);

    @Query(value = """
            WITH total_time_spent AS (
                SELECT
                    SUM(
                        CASE
                            WHEN al.start_time < '2023-01-01' THEN 0
                            ELSE (COALESCE(al.engaged_ms, 0) / 60000.0)
                        END
                    ) AS total_minutes_spent
                FROM activity_log al
                WHERE al.user_id IN (
                    SELECT DISTINCT user_id
                    FROM student_session_institute_group_mapping
                    WHERE package_session_id = :packageSessionId AND status IN :statusList
                )
                AND al.created_at BETWEEN :startDate AND :endDate
            )
            SELECT
                COALESCE(total_minutes_spent, 0) / NULLIF((DATE(:endDate) - DATE(:startDate) + 1), 0) AS avg_daily_minutes_spent
            FROM total_time_spent
            """, nativeQuery = true)
    Double findAverageDailyTimeSpentByBatch(
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate,
            @Param("packageSessionId") String packageSessionId,
            @Param("statusList") List<String> statusList);

    @Query(value = """
                WITH valid_users AS (
                    SELECT DISTINCT user_id
                    FROM student_session_institute_group_mapping
                    WHERE package_session_id = :packageSessionId
                    AND status IN (:statusList)
                ),
                activity AS (
                    SELECT
                        a.user_id,
                        SUM(
                            CASE
                                WHEN a.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(a.engaged_ms, 0) / 60000.0)
                            END
                        ) AS total_minutes,
                        COUNT(DISTINCT DATE(a.start_time)) AS active_days
                    FROM activity_log a
                    JOIN valid_users vu ON vu.user_id = a.user_id
                    WHERE a.start_time BETWEEN :startTime AND :endTime
                    GROUP BY a.user_id
                ),
                concentration AS (
                    SELECT
                        a.user_id,
                        AVG(LEAST(100, GREATEST(0, cs.concentration_score))) AS avg_concentration
                    FROM concentration_score cs
                    JOIN activity_log a ON a.id = cs.activity_id
                    JOIN valid_users vu ON vu.user_id = a.user_id
                    WHERE a.start_time BETWEEN :startTime AND :endTime
                      AND cs.concentration_score > 0
                    GROUP BY a.user_id
                )
                SELECT
                    s.user_id AS userId,
                    s.full_name AS fullName,
                    s.email AS email,
                    COALESCE(c.avg_concentration, 0) AS avgConcentration,
                    COALESCE(act.total_minutes, 0) AS totalTime,
                    COALESCE(act.total_minutes / NULLIF(act.active_days, 0), 0) AS dailyAvgTime,
                    DENSE_RANK() OVER (
                        ORDER BY COALESCE(act.total_minutes, 0) DESC,
                                 COALESCE(c.avg_concentration, 0) DESC
                    ) AS rank
                FROM student s
                JOIN valid_users vu ON vu.user_id = s.user_id
                LEFT JOIN activity act ON act.user_id = s.user_id
                LEFT JOIN concentration c ON c.user_id = s.user_id
            """, countQuery = """
                SELECT COUNT(DISTINCT s.user_id)
                FROM student s
                JOIN student_session_institute_group_mapping ssig
                    ON s.user_id = ssig.user_id
                WHERE ssig.package_session_id = :packageSessionId
                AND ssig.status IN (:statusList)
            """, nativeQuery = true)
    Page<LearnerActivityDataProjection> getBatchActivityDataWithRankPaginated(
            @Param("startTime") Date startTime,
            @Param("endTime") Date endTime,
            @Param("packageSessionId") String packageSessionId,
            @Param("statusList") List<String> statusList,
            Pageable pageable);

    /**
     * Real engaged time for one activity = merged (union) of its breadcrumb intervals, in ms.
     * Gaps-and-islands over document/video/audio segments; immune to tab-open inflation.
     * Returns NULL when the activity has no breadcrumbs (caller then keeps the wall-clock fallback).
     */
    @Query(value = """
            SELECT CAST(SUM(EXTRACT(EPOCH FROM (island_end - island_start)) * 1000) AS bigint)
            FROM (
                SELECT MIN(s) AS island_start, MAX(e) AS island_end
                FROM (
                    SELECT s, e, SUM(new_island) OVER (ORDER BY s, e) AS island
                    FROM (
                        SELECT s, e,
                               CASE WHEN prev_max_e IS NULL OR s > prev_max_e THEN 1 ELSE 0 END AS new_island
                        FROM (
                            SELECT s, e,
                                   MAX(e) OVER (ORDER BY s, e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_e
                            FROM (
                                SELECT start_time AS s, end_time AS e FROM document_tracked
                                    WHERE activity_id = :activityId AND end_time >= start_time
                                UNION ALL
                                SELECT start_time, end_time FROM video_tracked
                                    WHERE activity_id = :activityId AND end_time >= start_time
                                UNION ALL
                                SELECT start_time, end_time FROM audio_tracked
                                    WHERE activity_id = :activityId AND end_time >= start_time
                            ) segs
                        ) w
                    ) g
                ) i
                GROUP BY island
            ) islands
            """, nativeQuery = true)
    Long computeEngagedMsFromBreadcrumbs(@Param("activityId") String activityId);

    /**
     * Presence heartbeat: refresh last_seen_at on the learner's most recent activity for this slide
     * so someone who is on the slide but not generating tracking writes (e.g. a paused video/audio)
     * still counts as present in Course Pulse. Server-clock (now()), touches only last_seen_at --
     * created_at ("on slide since"), engaged_ms and breadcrumbs are untouched. No-op if no row exists.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE activity_log
            SET last_seen_at = now()
            WHERE id = (
                SELECT id FROM activity_log
                WHERE user_id = :userId AND slide_id = :slideId
                ORDER BY created_at DESC
                LIMIT 1
            )
            """, nativeQuery = true)
    int touchPresence(@Param("userId") String userId, @Param("slideId") String slideId);

    @Query(value = """
                WITH date_series AS (
                    SELECT generate_series(
                        CAST(:startDate AS DATE),
                        CAST(:endDate AS DATE),
                        INTERVAL '1 day'
                    ) AS activity_date
                ),
                active_users AS (
                    SELECT DISTINCT user_id
                    FROM student_session_institute_group_mapping
                    WHERE package_session_id = :packageSessionId AND status IN (:statusList)
                )
                SELECT
                    ds.activity_date,
                    COALESCE(
                        CASE
                            WHEN (SELECT COUNT(*) FROM active_users) > 0
                            THEN SUM(
                                CASE
                                    WHEN a.start_time < '2023-01-01' THEN 0
                                    ELSE (COALESCE(a.engaged_ms, 0) / 60000.0)
                                END
                            ) / (SELECT COUNT(*) FROM active_users)
                            ELSE 0
                        END,
                        0
                    ) AS avg_time_spent_per_student
                FROM date_series ds
                LEFT JOIN activity_log a
                    ON DATE(a.created_at) = ds.activity_date
                    AND DATE(a.created_at) BETWEEN CAST(:startDate AS DATE) AND CAST(:endDate AS DATE)
                    AND a.user_id IN (SELECT user_id FROM active_users)
                GROUP BY ds.activity_date
                ORDER BY ds.activity_date
            """, nativeQuery = true)
    List<Object[]> getAvgTimeSpentPerStudent(
            @Param("startDate") String startDate,
            @Param("endDate") String endDate,
            @Param("packageSessionId") String packageSessionId,
            @Param("statusList") List<String> statusList);

    @Query(value = """
                WITH SubjectModules AS (
                    SELECT
                        smm.subject_id,
                        smm.module_id,
                        smm.module_order,
                        s.subject_name,
                        m.module_name
                    FROM subject_session ss
                    JOIN subject_module_mapping smm ON ss.subject_id = smm.subject_id
                    JOIN subject s ON ss.subject_id = s.id
                    JOIN modules m ON smm.module_id = m.id
                    WHERE ss.session_id = :sessionId
                    AND s.status IN (:subjectStatusList)
                    AND m.status IN (:moduleStatusList)
                ),
                ModuleChapters AS (
                    SELECT
                        sm.subject_id,
                        sm.module_id,
                        sm.subject_name,
                        sm.module_name,
                        mcm.chapter_id
                    FROM SubjectModules sm
                    JOIN module_chapter_mapping mcm ON sm.module_id = mcm.module_id
                ),
                ChapterSlides AS (
                    SELECT
                        mc.subject_id,
                        mc.module_id,
                        mc.subject_name,
                        mc.module_name,
                        mc.chapter_id,
                        cts.slide_id
                    FROM ModuleChapters mc
                    JOIN chapter_to_slides cts ON mc.chapter_id = cts.chapter_id
                    JOIN slide s ON cts.slide_id = s.id
                    JOIN chapter c ON mc.chapter_id = c.id
                    JOIN chapter_package_session_mapping cpsm ON c.id = cpsm.chapter_id
                    WHERE c.status IN (:chapterStatusList)
                    AND cpsm.package_session_id = :sessionId
                    AND cts.status IN (:chapterSlideStatusList)
                    AND s.status IN (:slideStatusList)
                ),
                SlideActivity AS (
                    SELECT
                        cs.subject_id,
                        cs.module_id,
                        cs.subject_name,
                        cs.module_name,
                        cs.chapter_id,
                        SUM(
                            CASE
                                WHEN al.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(al.engaged_ms, 0) / 1000.0)
                            END
                        ) AS total_time_seconds
                    FROM ChapterSlides cs
                    JOIN activity_log al ON cs.slide_id = al.slide_id
                    JOIN student_session_institute_group_mapping ssigm
                        ON al.user_id = ssigm.user_id
                        AND ssigm.package_session_id = :sessionId
                    WHERE ssigm.status IN (:learnerStatusList)
                    GROUP BY cs.subject_id, cs.module_id, cs.subject_name, cs.module_name, cs.chapter_id
                ),
                DistinctUsers AS (
                    SELECT
                        COUNT(DISTINCT user_id) AS user_count
                    FROM student_session_institute_group_mapping
                    WHERE package_session_id = :sessionId
                    AND status IN (:learnerStatusList)
                ),
                ModuleTime AS (
                    SELECT
                        sa.subject_id,
                        sa.module_id,
                        sa.subject_name,
                        sa.module_name,
                        SUM(sa.total_time_seconds) AS total_module_time_seconds
                    FROM SlideActivity sa
                    GROUP BY sa.subject_id, sa.module_id, sa.subject_name, sa.module_name
                ),
                AvgTimeSpent AS (
                    SELECT
                        mt.subject_id,
                        mt.module_id,
                        mt.subject_name,
                        mt.module_name,
                        (mt.total_module_time_seconds / 60) / du.user_count AS avg_time_per_user_minutes
                    FROM ModuleTime mt
                    CROSS JOIN DistinctUsers du
                ),
                ModuleCompletion AS (
                    SELECT
                        mc.subject_id,
                        mc.module_id,
                        mc.subject_name,
                        mc.module_name,
                        lo.user_id,
                        AVG(
                            CAST(NULLIF(lo.value, '') AS FLOAT)
                        ) AS avg_completion_per_student
                    FROM learner_operation lo
                    JOIN ModuleChapters mc ON lo.source_id = mc.chapter_id
                    WHERE lo.operation = 'PERCENTAGE_CHAPTER_COMPLETED'
                    AND lo.value ~ '^[0-9\\.]+$' -- Ensure only numeric values
                    GROUP BY mc.subject_id, mc.module_id, mc.subject_name, mc.module_name, lo.user_id
                ),
                FinalModuleCompletion AS (
                    SELECT
                        subject_id,
                        module_id,
                        subject_name,
                        module_name,
                        AVG(avg_completion_per_student) AS module_completion_percentage
                    FROM ModuleCompletion
                    GROUP BY subject_id, module_id, subject_name, module_name
                )
                SELECT
                    sm.subject_id AS subjectId,
                    sm.subject_name AS subjectName,
                    json_agg(
                        jsonb_build_object(
                            'module_id', sm.module_id,
                            'module_name', sm.module_name,
                            'module_completion_percentage', COALESCE(fmc.module_completion_percentage, 0),
                            'avg_time_spent_minutes', COALESCE(ats.avg_time_per_user_minutes, 0)
                        )
                        ORDER BY sm.module_order ASC NULLS LAST, sm.module_name ASC
                    ) AS modules
                FROM SubjectModules sm
                LEFT JOIN FinalModuleCompletion fmc
                    ON sm.module_id = fmc.module_id
                    AND sm.subject_id = fmc.subject_id
                LEFT JOIN AvgTimeSpent ats
                    ON sm.module_id = ats.module_id
                    AND sm.subject_id = ats.subject_id
                GROUP BY sm.subject_id, sm.subject_name
            """, nativeQuery = true)
    List<SubjectProgressProjection> getModuleCompletionAndTimeSpent(
            @Param("sessionId") String sessionId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("chapterSlideStatusList") List<String> chapterSlideStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("learnerStatusList") List<String> learnerStatusList);

    @Query(value = """
                WITH RawChapters AS (
                    SELECT
                        mc.chapter_id,
                        ch.chapter_name,
                        cps.chapter_order
                    FROM module_chapter_mapping mc
                    JOIN chapter_package_session_mapping cps
                        ON mc.chapter_id = cps.chapter_id AND cps.status IN (:chapterPackageStatusList)
                    JOIN chapter ch
                        ON mc.chapter_id = ch.id AND ch.status IN (:chapterStatusList)
                    WHERE mc.module_id = :moduleId
                ),
                Chapters AS (
                    SELECT DISTINCT chapter_id, chapter_name, chapter_order FROM RawChapters
                ),
                Slides AS (
                    SELECT DISTINCT
                        csm.chapter_id,
                        s.id AS slide_id,
                        s.title AS slide_title,
                        s.source_type AS slide_source_type,
                        csm.slide_order AS slide_order
                    FROM chapter_to_slides csm
                    JOIN Chapters c ON csm.chapter_id = c.chapter_id
                    JOIN slide s ON csm.slide_id = s.id AND s.status IN (:slideStatusList)
                    WHERE csm.status IN (:chapterSlideStatusList)
                ),
                LearnerActivity AS (
                    SELECT
                        al.id AS activity_id,
                        al.slide_id,
                        al.start_time,
                        al.end_time,
                        al.engaged_ms,
                        al.user_id,
                        al.created_at
                    FROM activity_log al
                    JOIN Slides s ON al.slide_id = s.slide_id
                    WHERE al.user_id = :userId
                ),
                BatchActivity AS (
                    SELECT
                        al.slide_id,
                        al.id AS activity_id,
                        al.start_time,
                        al.end_time,
                        al.engaged_ms,
                        al.created_at,
                        al.user_id
                    FROM activity_log al
                    JOIN Slides s ON al.slide_id = s.slide_id
                    JOIN student_session_institute_group_mapping ssigm
                        ON al.user_id = ssigm.user_id
                       AND ssigm.package_session_id = :packageSessionId
                    WHERE ssigm.status IN (:learnerStatusList)
                ),
                StudentCount AS (
                    SELECT COUNT(DISTINCT ssigm.user_id) AS distinct_users
                    FROM student_session_institute_group_mapping ssigm
                    WHERE ssigm.package_session_id = :packageSessionId
                      AND ssigm.status IN (:learnerStatusList)
                ),
                LearnerTimeScore AS (
                    SELECT
                        slide_id,
                        SUM(
                            CASE
                                WHEN start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(engaged_ms, 0) / 60000.0)
                            END
                        ) AS avg_time_spent,
                        MAX(created_at) AS last_active_date
                    FROM LearnerActivity
                    GROUP BY slide_id
                ),
                LearnerConcentration AS (
                    SELECT
                        la.slide_id,
                        CAST(SUM(LEAST(100, GREATEST(0, cs.concentration_score))) AS FLOAT) / NULLIF(COUNT(cs.id), 0) AS avg_concentration_score
                    FROM concentration_score cs
                    JOIN LearnerActivity la ON cs.activity_id = la.activity_id
                    GROUP BY la.slide_id
                ),
                BatchTimeScore AS (
                    SELECT
                        slide_id,
                        SUM(
                            CASE
                                WHEN start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(engaged_ms, 0) / 60000.0)
                            END
                        ) / NULLIF((SELECT distinct_users FROM StudentCount), 0) AS avg_time_spent_by_batch
                    FROM BatchActivity
                    GROUP BY slide_id
                ),
                BatchConcentration AS (
                    SELECT
                        ba.slide_id,
                        CAST(SUM(LEAST(100, GREATEST(0, cs.concentration_score))) AS FLOAT) / NULLIF(COUNT(cs.id), 0) AS avg_concentration_score_by_batch
                    FROM concentration_score cs
                    JOIN BatchActivity ba ON cs.activity_id = ba.activity_id
                    GROUP BY ba.slide_id
                )
                SELECT
                    c.chapter_id AS chapterId,
                    c.chapter_name AS chapterName,
                    (
                        SELECT JSON_AGG(slide_data ORDER BY slide_data.slide_order NULLS LAST, slide_data.slide_title)
                        FROM (
                            SELECT DISTINCT ON (s.slide_id)
                                s.slide_id,
                                s.slide_title,
                                s.slide_source_type,
                                s.slide_order,
                                COALESCE(lt.avg_time_spent, 0.0) AS avg_time_spent,
                                COALESCE(lc.avg_concentration_score, 0.0) AS avg_concentration_score,
                                COALESCE(CAST(bt.avg_time_spent_by_batch AS TEXT), '0.0') AS avg_time_spent_by_batch,
                                COALESCE(CAST(bc.avg_concentration_score_by_batch AS TEXT), '0.0') AS avg_concentration_score_by_batch,
                                CASE
                                    WHEN lt.last_active_date IS NULL THEN 'Slide not opened'
                                    ELSE TO_CHAR(lt.last_active_date, 'HH24:MI DD/MM/YYYY')
                                END AS last_active_date

                            FROM Slides s
                            LEFT JOIN LearnerTimeScore lt ON s.slide_id = lt.slide_id
                            LEFT JOIN LearnerConcentration lc ON s.slide_id = lc.slide_id
                            LEFT JOIN BatchTimeScore bt ON s.slide_id = bt.slide_id
                            LEFT JOIN BatchConcentration bc ON s.slide_id = bc.slide_id
                            WHERE s.chapter_id = c.chapter_id
                            ORDER BY s.slide_id
                        ) slide_data
                    ) AS slides
                FROM Chapters c
                ORDER BY c.chapter_order NULLS LAST, c.chapter_name;
            """, nativeQuery = true)
    List<ChapterSlideProgressProjection> getChapterSlideProgressCombined(
            @Param("moduleId") String moduleId,
            @Param("packageSessionId") String packageSessionId,
            @Param("userId") String userId,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterSlideStatusList") List<String> chapterSlideStatusList,
            @Param("learnerStatusList") List<String> learnerStatusList);

    @Query(value = """
                WITH video_progress AS (
                    SELECT
                        s.id AS slide_id,
                        LEAST(
                            COALESCE(
                                (
                                    EXTRACT(EPOCH FROM (MAX(vt.end_time) - MIN(vt.start_time))) * 1000
                                    / NULLIF(COALESCE(v.published_video_length, 1), 0)
                                ) * 100,
                            0),
                        100) AS video_completion
                    FROM slide s
                    LEFT JOIN video v ON s.source_id = v.id AND s.source_type = 'VIDEO'
                    LEFT JOIN activity_log al ON al.slide_id = s.id AND al.user_id = :userId
                    LEFT JOIN video_tracked vt ON vt.activity_id = al.id
                    WHERE
                        al.created_at BETWEEN :startDate AND :endDate
                        AND s.source_type IN :sourceTypeList
                    GROUP BY s.id, v.published_video_length
                ),
                document_progress AS (
                    SELECT
                        s.id AS slide_id,
                        LEAST(
                            COALESCE(
                                (COUNT(DISTINCT dt.page_number) * 100.0 / NULLIF(COALESCE(ds.published_document_total_pages, 1), 0)),
                            0), 100) AS document_completion
                    FROM slide s
                    LEFT JOIN document_slide ds ON s.source_id = ds.id AND s.source_type IN :sourceTypeList
                    LEFT JOIN activity_log al ON al.slide_id = s.id AND al.user_id = :userId
                    LEFT JOIN document_tracked dt ON dt.activity_id = al.id
                    WHERE
                        al.created_at BETWEEN :startDate AND :endDate
                        AND s.source_type IN :sourceTypeList
                    GROUP BY s.id, ds.published_document_total_pages
                ),
                slide_completion AS (
                    SELECT
                        s.id AS slide_id,
                        COALESCE(vp.video_completion, dp.document_completion, 0) AS slide_completion_percentage
                    FROM
                        subject_session sps
                    JOIN subject_module_mapping smm ON smm.subject_id = sps.subject_id
                    JOIN subject sub ON sub.id = smm.subject_id
                    JOIN modules m ON m.id = smm.module_id
                    JOIN module_chapter_mapping mcm ON mcm.module_id = m.id
                    JOIN chapter c ON c.id = mcm.chapter_id
                    JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id
                    JOIN chapter_to_slides cs ON cs.chapter_id = c.id
                    JOIN slide s ON s.id = cs.slide_id
                    LEFT JOIN video_progress vp ON vp.slide_id = s.id
                    LEFT JOIN document_progress dp ON dp.slide_id = s.id
                    WHERE
                        sps.session_id = :sessionId
                        AND cpsm.package_session_id = :sessionId
                        AND cpsm.status IN :chapterPackageStatusList
                        AND sub.status IN :subjectStatusList
                        AND m.status IN :moduleStatusList
                        AND c.status IN :chapterStatusList
                        AND cs.status IN :slideStatusList
                        AND s.status IN :slideStatusList
                        AND s.source_type IN :sourceTypeList
                )
                SELECT COALESCE(AVG(slide_completion_percentage), 0)
                FROM slide_completion;
            """, nativeQuery = true)
    // startDate/endDate are java.util.Date (not java.sql.Date) so callers can bind an end-of-day
    // Timestamp. activity_log.created_at is a TIMESTAMP; binding a bare DATE made the upper bound
    // `endDate 00:00:00`, which dropped every activity logged during the final day of the window.
    Double getLearnerCourseCompletionPercentage(
            @Param("sessionId") String sessionId,
            @Param("userId") String userId,
            @Param("startDate") java.util.Date startDate,
            @Param("endDate") java.util.Date endDate,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("sourceTypeList") List<String> sourceTypeList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList);

    @Query(value = """
                SELECT
                    COALESCE(SUM(
                        CASE
                            WHEN al.start_time < '2023-01-01' THEN 0
                            ELSE (COALESCE(al.engaged_ms, 0) / 60000.0)
                        END
                    ), 0) AS total_time_spent_minutes
                FROM activity_log al
                JOIN slide s ON s.id = al.slide_id
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
                JOIN modules m ON m.id = mcm.module_id
                JOIN subject_module_mapping smm ON smm.module_id = m.id
                JOIN subject sub ON sub.id = smm.subject_id
                JOIN subject_session ss ON ss.subject_id = sub.id
                JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id
                WHERE
                    al.created_at BETWEEN :startDate AND :endDate
                    AND al.user_id = :userId
                    AND ss.session_id = :sessionId
                    AND cpsm.package_session_id = :sessionId
                    AND sub.status IN :subjectStatusList
                    AND m.status IN :moduleStatusList
                    AND c.status IN :chapterStatusList
                    AND cs.status IN :slideStatusList
                    AND s.status IN :slideStatusList
                    AND cpsm.status IN :chapterPackageStatusList
                    AND s.source_type IN :sourceTypeList
            """, nativeQuery = true)
    Double findTimeSpentByLearnerWithFilters(
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate,
            @Param("userId") String userId,
            @Param("sessionId") String sessionId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("sourceTypeList") List<String> sourceTypeList);

    @Query(value = """
                WITH date_series AS (
                    SELECT generate_series(
                        CAST(:startDate AS DATE),
                        CAST(:endDate AS DATE),
                        INTERVAL '1 day'
                    ) AS activity_date
                )
                SELECT
                    ds.activity_date,
                    COALESCE(SUM(
                        CASE
                            WHEN a.start_time < '2023-01-01' THEN 0
                            ELSE (COALESCE(a.engaged_ms, 0) / 60000.0)
                        END
                    ), 0) AS time_spent_minutes
                FROM date_series ds
                LEFT JOIN activity_log a
                    ON a.user_id = :userId
                    AND DATE(a.created_at) = ds.activity_date  -- Map logs correctly to each generated date
                GROUP BY ds.activity_date
                ORDER BY ds.activity_date
            """, nativeQuery = true)
    List<Object[]> getTimeSpentByLearnerPerDay(
            @Param("startDate") String startDate,
            @Param("endDate") String endDate,
            @Param("userId") String userId);

    /**
     * Student report v2 "Focus score": the learner's average concentration score (0-100)
     * over the window, from the concentration_score table (linked to activity_log by
     * activity_id). Returns null when the learner has no concentration samples. READ-ONLY.
     */
    @Query(value = """
                SELECT AVG(LEAST(100, GREATEST(0, cs.concentration_score)))
                FROM concentration_score cs
                JOIN activity_log al ON al.id = cs.activity_id
                WHERE al.user_id = :userId
                  AND DATE(al.created_at) BETWEEN CAST(:startDate AS DATE) AND CAST(:endDate AS DATE)
            """, nativeQuery = true)
    Double getAvgConcentrationScore(
            @Param("userId") String userId,
            @Param("startDate") String startDate,
            @Param("endDate") String endDate);

    @Query(value = """
                WITH SubjectModules AS (
                    SELECT
                        smm.subject_id,
                        smm.module_id,
                        smm.module_order,
                        s.subject_name,
                        m.module_name
                    FROM subject_session ss
                    JOIN subject_module_mapping smm ON ss.subject_id = smm.subject_id
                    JOIN subject s ON ss.subject_id = s.id
                    JOIN modules m ON smm.module_id = m.id
                    WHERE ss.session_id = :sessionId
                    AND s.status IN (:subjectStatusList)
                    AND m.status IN (:moduleStatusList)
                ),
                ModuleChapters AS (
                    SELECT
                        sm.subject_id,
                        sm.module_id,
                        sm.subject_name,
                        sm.module_name,
                        mcm.chapter_id
                    FROM SubjectModules sm
                    JOIN module_chapter_mapping mcm ON sm.module_id = mcm.module_id
                ),
                ChapterSlides AS (
                    SELECT
                        mc.subject_id,
                        mc.module_id,
                        mc.subject_name,
                        mc.module_name,
                        mc.chapter_id,
                        cts.slide_id
                    FROM ModuleChapters mc
                    JOIN chapter_to_slides cts ON mc.chapter_id = cts.chapter_id
                    JOIN slide s ON cts.slide_id = s.id
                    JOIN chapter c ON mc.chapter_id = c.id
                    JOIN chapter_package_session_mapping cpsm ON c.id = cpsm.chapter_id
                    WHERE c.status IN (:chapterStatusList)
                    AND cpsm.package_session_id = :sessionId
                    AND cts.status IN (:chapterSlideStatusList)
                    AND s.status IN (:slideStatusList)
                ),
                LearnerActivity AS (
                    SELECT
                        cs.subject_id,
                        cs.module_id,
                        SUM(
                            CASE
                                WHEN al.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(al.engaged_ms, 0) / 1000.0)
                            END
                        ) / 60 AS learner_time
                    FROM ChapterSlides cs
                    JOIN activity_log al ON cs.slide_id = al.slide_id
                    WHERE al.user_id = :userId
                    GROUP BY cs.subject_id, cs.module_id
                ),
                BatchActivity AS (
                    SELECT
                        cs.subject_id,
                        cs.module_id,
                        SUM(
                            CASE
                                WHEN al.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(al.engaged_ms, 0) / 1000.0)
                            END
                        ) / COUNT(DISTINCT ssigm.user_id) / 60 AS batch_time
                    FROM ChapterSlides cs
                    JOIN activity_log al ON cs.slide_id = al.slide_id
                    JOIN student_session_institute_group_mapping ssigm
                        ON al.user_id = ssigm.user_id
                        AND ssigm.package_session_id = :sessionId
                    WHERE ssigm.status IN (:learnerStatusList)
                    GROUP BY cs.subject_id, cs.module_id
                ),
                LearnerCompletion AS (
                    -- Module % = mean over chapters of (mean over the slides in
                    -- that chapter of the slide completion), computed live from
                    -- the SLIDE-level operations. Matches the learner app exactly
                    -- and never drifts, unlike the stored
                    -- PERCENTAGE_CHAPTER_COMPLETED.
                    -- NOTE: no apostrophes in a comment inside a @Query block --
                    -- Spring Data scans for quoted ranges before JPA sees it and
                    -- does not understand SQL comments, so an odd number of them
                    -- opens a string literal that never closes and the repository
                    -- bean fails to build, taking the service down at startup.
                    SELECT cp.subject_id, cp.module_id, AVG(cp.chapter_pct) AS learner_completion
                    FROM (
                        SELECT sp.subject_id, sp.module_id, sp.chapter_id,
                               AVG(sp.slide_pct) AS chapter_pct
                        FROM (
                            SELECT cs.subject_id, cs.module_id, cs.chapter_id, cs.slide_id,
                                -- Must list EVERY slide-level completion operation. An operation
                                -- missing here is not skipped: the CASE yields NULL and COALESCE
                                -- turns it into 0, so a fully-completed slide silently drags the
                                -- chapter average down. Keep in sync with the write-side cascade
                                -- (LearnerTrackingAsyncService#updateChapterCompletionPercentage).
                                COALESCE(MAX(CASE
                                    WHEN slo.operation IN (
                                            'PERCENTAGE_VIDEO_WATCHED', 'PERCENTAGE_DOCUMENT_COMPLETED',
                                            'PERCENTAGE_QUIZ_COMPLETED', 'PERCENTAGE_QUESTION_COMPLETED',
                                            'PERCENTAGE_ASSIGNMENT_COMPLETED', 'PERCENTAGE_AUDIO_LISTENED',
                                            'PERCENTAGE_SCORM_COMPLETED', 'PERCENTAGE_ASSESSMENT_DONE')
                                         AND slo.value ~ '^[0-9]+(\\.[0-9]+)?$'
                                    THEN LEAST(CAST(slo.value AS FLOAT), 100)
                                    ELSE NULL
                                END), 0) AS slide_pct
                            FROM ChapterSlides cs
                            LEFT JOIN learner_operation slo
                                ON slo.source_id = cs.slide_id AND slo.source = 'SLIDE'
                                AND slo.user_id = :userId
                            GROUP BY cs.subject_id, cs.module_id, cs.chapter_id, cs.slide_id
                        ) sp
                        GROUP BY sp.subject_id, sp.module_id, sp.chapter_id
                    ) cp
                    GROUP BY cp.subject_id, cp.module_id
                ),
                BatchCompletion AS (
                    SELECT
                        mc.subject_id,
                        mc.module_id,
                        AVG(CAST(NULLIF(lo.value, '') AS FLOAT)) AS batch_completion
                    FROM learner_operation lo
                    JOIN ModuleChapters mc ON lo.source_id = mc.chapter_id
                    JOIN student_session_institute_group_mapping ssigm ON lo.user_id = ssigm.user_id
                    WHERE lo.operation = 'PERCENTAGE_CHAPTER_COMPLETED'
                    AND ssigm.package_session_id = :sessionId
                    AND ssigm.status IN (:learnerStatusList)
                    AND lo.value ~ '^[0-9\\.]+$'
                    GROUP BY mc.subject_id, mc.module_id
                )
                SELECT
                    sm.subject_id,
                    sm.subject_name,
                    json_agg(
                        jsonb_build_object(
                            'module_id', sm.module_id,
                            'module_name', sm.module_name,
                            'module_completion_percentage', COALESCE(lc.learner_completion, 0),
                            'avg_time_spent_minutes', COALESCE(la.learner_time, 0),
                            'module_completion_percentage_by_batch', COALESCE(bc.batch_completion, 0),
                            'avg_time_spent_minutes_by_batch', COALESCE(ba.batch_time, 0)
                        )
                        ORDER BY sm.module_order ASC NULLS LAST, sm.module_name ASC
                    ) AS modules_json
                FROM SubjectModules sm
                LEFT JOIN LearnerCompletion lc ON sm.subject_id = lc.subject_id AND sm.module_id = lc.module_id
                LEFT JOIN BatchCompletion bc ON sm.subject_id = bc.subject_id AND sm.module_id = bc.module_id
                LEFT JOIN LearnerActivity la ON sm.subject_id = la.subject_id AND sm.module_id = la.module_id
                LEFT JOIN BatchActivity ba ON sm.subject_id = ba.subject_id AND sm.module_id = ba.module_id
                GROUP BY sm.subject_id, sm.subject_name
            """, nativeQuery = true)
    List<Object[]> getModuleCompletionByUserAndBatch(
            @Param("sessionId") String sessionId,
            @Param("userId") String userId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("chapterSlideStatusList") List<String> chapterSlideStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("learnerStatusList") List<String> learnerStatusList);

    @Query(value = """
            WITH Chapters AS (
                SELECT
                    mc.chapter_id,
                    ch.chapter_name AS chapter_name
                FROM module_chapter_mapping mc
                JOIN chapter_package_session_mapping cps ON mc.chapter_id = cps.chapter_id
                    AND cps.status IN (:chapterPackageStatusList)
                JOIN chapter ch ON mc.chapter_id = ch.id
                    AND ch.status IN (:chapterStatusList)
                WHERE mc.module_id = :moduleId
            ),
            Slides AS (
                SELECT
                    csm.chapter_id,
                    s.id AS slide_id,
                    s.title AS slide_title,
                    s.source_type AS slide_source_type
                FROM chapter_to_slides csm
                JOIN Chapters c ON csm.chapter_id = c.chapter_id
                JOIN slide s ON csm.slide_id = s.id
                    AND s.status IN (:slideStatusList)
                WHERE csm.status IN (:chapterSlideStatusList)
            ),
            ActivityLogs AS (
                SELECT
                    al.id AS activity_id,
                    al.slide_id,
                    al.start_time,
                    al.end_time,
                    al.engaged_ms,
                    al.user_id
                FROM activity_log al
                JOIN Slides s ON al.slide_id = s.slide_id
                WHERE al.user_id = :userId  -- Only fetch logs for the given user
            ),
            AvgTimeSpent AS (
                SELECT
                    al.slide_id,
                    (SUM(
                        CASE
                            WHEN al.start_time < '2023-01-01' THEN 0
                            ELSE (COALESCE(al.engaged_ms, 0) / 1000.0)
                        END
                    ) / 60) AS avg_time_spent
                FROM ActivityLogs al
                GROUP BY al.slide_id
            ),
            AvgConcentrationScore AS (
                SELECT
                    al.slide_id,
                    SUM(LEAST(100, GREATEST(0, cs.concentration_score))) / NULLIF(COUNT(cs.id), 0) AS avg_concentration_score
                FROM concentration_score cs
                JOIN ActivityLogs al ON cs.activity_id = al.activity_id
                GROUP BY al.slide_id
            )
            SELECT
                c.chapter_id AS chapterId,
                c.chapter_name AS chapterName,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'slide_id', s.slide_id,
                        'slide_title', s.slide_title,
                        'slide_source_type', s.slide_source_type,
                        'avg_time_spent', COALESCE(a.avg_time_spent, 0.0),
                        'avg_concentration_score', COALESCE(cscore.avg_concentration_score, 0.0)
                    )
                ) AS slides
            FROM Chapters c
            JOIN Slides s ON c.chapter_id = s.chapter_id
            LEFT JOIN AvgTimeSpent a ON s.slide_id = a.slide_id
            LEFT JOIN AvgConcentrationScore cscore ON s.slide_id = cscore.slide_id
            GROUP BY c.chapter_id, c.chapter_name
            """, nativeQuery = true)
    List<ChapterSlideProgressProjection> getChapterSlideProgressForLearner(
            @Param("moduleId") String moduleId,
            @Param("userId") String userId,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterSlideStatusList") List<String> chapterSlideStatusList);

    @Query(value = """
                WITH SubjectModules AS (
                    SELECT
                        smm.subject_id AS subject_id,
                        smm.module_id AS module_id,
                        smm.module_order AS module_order,
                        s.subject_name AS subject_name,
                        m.module_name AS module_name
                    FROM subject_session ss
                    JOIN subject_module_mapping smm ON ss.subject_id = smm.subject_id
                    JOIN subject s ON ss.subject_id = s.id
                    JOIN modules m ON smm.module_id = m.id
                    WHERE ss.session_id = :sessionId
                    AND s.status IN (:subjectStatusList)
                    AND m.status IN (:moduleStatusList)
                ),
                ModuleChapters AS (
                    SELECT
                        sm.subject_id AS subject_id,
                        sm.subject_name AS subject_name,
                        sm.module_id AS module_id,
                        sm.module_name AS module_name,
                        sm.module_order AS module_order,
                        mcm.chapter_id AS chapter_id
                    FROM SubjectModules sm
                    JOIN module_chapter_mapping mcm ON sm.module_id = mcm.module_id
                    JOIN chapter c ON mcm.chapter_id = c.id
                    WHERE c.status IN (:chapterStatusList)
                ),
                ChapterSlides AS (
                    SELECT
                        mc.subject_id AS subject_id,
                        mc.subject_name AS subject_name,
                        mc.module_id AS module_id,
                        mc.module_name AS module_name,
                        mc.chapter_id AS chapter_id,
                        c.chapter_name AS chapter_name,
                        cts.slide_id AS slide_id,
                        s.title AS slide_title,
                        mc.module_order AS module_order,
                        cpsm.chapter_order AS chapter_order,
                        cts.slide_order AS slide_order
                    FROM ModuleChapters mc
                    JOIN chapter_to_slides cts ON mc.chapter_id = cts.chapter_id
                    JOIN slide s ON cts.slide_id = s.id
                    JOIN chapter c ON mc.chapter_id = c.id
                    JOIN chapter_package_session_mapping cpsm ON c.id = cpsm.chapter_id
                    WHERE cpsm.package_session_id = :sessionId
                    AND s.status IN (:slideStatusList)
                    AND cpsm.status IN (:chapterStatusList)
                ),
                SlideActivity AS (
                    SELECT
                        al.id AS activity_id,
                        cs.subject_id AS subject_id,
                        cs.subject_name AS subject_name,
                        cs.module_id AS module_id,
                        cs.module_name AS module_name,
                        cs.chapter_id AS chapter_id,
                        cs.chapter_name AS chapter_name,
                        cs.slide_id AS slide_id,
                        cs.slide_title AS slide_title,
                        cs.module_order AS module_order,
                        cs.chapter_order AS chapter_order,
                        cs.slide_order AS slide_order,
                        DATE(al.created_at) AS activity_date,
                        COALESCE(SUM(
                            CASE
                                WHEN al.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(al.engaged_ms, 0) / 60000.0)
                            END
                        ), 0) AS time_spent_minutes
                    FROM ChapterSlides cs
                    JOIN activity_log al ON cs.slide_id = al.slide_id
                    WHERE al.user_id = :userId
                    AND al.created_at BETWEEN :startDate AND :endDate
                    GROUP BY al.id, cs.subject_id, cs.subject_name, cs.module_id, cs.module_name,
                             cs.chapter_id, cs.chapter_name, cs.slide_id, cs.slide_title, DATE(al.created_at),
                             cs.module_order, cs.chapter_order, cs.slide_order
                ),
                SlideConcentration AS (
                    SELECT
                        al.id AS activity_id,
                        al.slide_id AS slide_id,
                        COALESCE(AVG(LEAST(100, GREATEST(0, cs.concentration_score))), 0) AS avg_concentration_score
                    FROM activity_log al
                    JOIN concentration_score cs ON al.id = cs.activity_id
                    WHERE al.user_id = :userId
                    AND al.created_at BETWEEN :startDate AND :endDate
                    GROUP BY al.id, al.slide_id
                )
                SELECT
                    sa.activity_date AS date,
                    CAST(
                        JSONB_AGG(
                            JSONB_BUILD_OBJECT(
                                'slide_id', sa.slide_id,
                                'slide_title', sa.slide_title,
                                'chapter_id', sa.chapter_id,
                                'chapter_name', sa.chapter_name,
                                'module_id', sa.module_id,
                                'module_name', sa.module_name,
                                'subject_id', sa.subject_id,
                                'subject_name', sa.subject_name,
                                'concentration_score', COALESCE(sc.avg_concentration_score, 0),
                                'time_spent', COALESCE(sa.time_spent_minutes, 0)
                            )
                            ORDER BY sa.module_order NULLS LAST, sa.chapter_order NULLS LAST, sa.slide_order NULLS LAST, sa.slide_title
                        ) AS TEXT
                    ) AS slide_details
                FROM SlideActivity sa
                LEFT JOIN SlideConcentration sc ON sa.activity_id = sc.activity_id
                GROUP BY sa.activity_date
                ORDER BY sa.activity_date
            """, nativeQuery = true)
    List<Object[]> getSlideActivityByDate(
            @Param("sessionId") String sessionId,
            @Param("userId") String userId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList);

    @Query(value = """
                WITH valid_users AS (
                    SELECT DISTINCT user_id
                    FROM student_session_institute_group_mapping
                    WHERE package_session_id = :packageSessionId
                    AND status IN (:statusList)
                ),
                activity AS (
                    SELECT
                        a.user_id,
                        SUM(
                            CASE
                                WHEN a.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(a.engaged_ms, 0) / 60000.0)
                            END
                        ) AS total_minutes,
                        COUNT(DISTINCT DATE(a.start_time)) AS active_days
                    FROM activity_log a
                    JOIN valid_users vu ON vu.user_id = a.user_id
                    WHERE a.start_time BETWEEN :startTime AND :endTime
                    GROUP BY a.user_id
                ),
                concentration AS (
                    SELECT
                        a.user_id,
                        AVG(LEAST(100, GREATEST(0, cs.concentration_score))) AS avg_concentration
                    FROM concentration_score cs
                    JOIN activity_log a ON a.id = cs.activity_id
                    JOIN valid_users vu ON vu.user_id = a.user_id
                    WHERE a.start_time BETWEEN :startTime AND :endTime
                      AND cs.concentration_score > 0
                    GROUP BY a.user_id
                )
                SELECT
                    s.user_id AS userId,
                    s.full_name AS fullName,
                    s.email AS email,
                    COALESCE(c.avg_concentration, 0) AS avgConcentration,
                    COALESCE(act.total_minutes, 0) AS totalTime,
                    COALESCE(act.total_minutes / NULLIF(act.active_days, 0), 0) AS dailyAvgTime,
                    DENSE_RANK() OVER (
                        ORDER BY COALESCE(act.total_minutes, 0) DESC,
                                 COALESCE(c.avg_concentration, 0) DESC
                    ) AS rank
                FROM student s
                JOIN valid_users vu ON vu.user_id = s.user_id
                LEFT JOIN activity act ON act.user_id = s.user_id
                LEFT JOIN concentration c ON c.user_id = s.user_id
            """, countQuery = """
                SELECT COUNT(DISTINCT s.user_id)
                FROM student s
                JOIN student_session_institute_group_mapping ssig
                    ON s.user_id = ssig.user_id
                WHERE ssig.package_session_id = :packageSessionId
                AND ssig.status IN (:statusList)
            """, nativeQuery = true)
    List<LearnerActivityDataProjection> getBatchActivityDataWithRank(
            @Param("startTime") Date startTime,
            @Param("endTime") Date endTime,
            @Param("packageSessionId") String packageSessionId,
            @Param("statusList") List<String> statusList);

    /**
     * Institute-WIDE activity ranking: same shape as {@link #getBatchActivityDataWithRank}
     * but the candidate set is every active learner in the institute (across all batches),
     * so each learner's total_minutes sums their activity over all their courses.
     */
    @Query(value = """
                WITH valid_users AS (
                    SELECT DISTINCT user_id
                    FROM student_session_institute_group_mapping
                    WHERE institute_id = :instituteId
                    AND status IN (:statusList)
                ),
                activity AS (
                    SELECT
                        a.user_id,
                        SUM(
                            CASE
                                WHEN a.start_time < '2023-01-01' THEN 0
                                ELSE (COALESCE(a.engaged_ms, 0) / 60000.0)
                            END
                        ) AS total_minutes,
                        COUNT(DISTINCT DATE(a.start_time)) AS active_days
                    FROM activity_log a
                    JOIN valid_users vu ON vu.user_id = a.user_id
                    WHERE a.start_time BETWEEN :startTime AND :endTime
                    GROUP BY a.user_id
                ),
                concentration AS (
                    SELECT
                        a.user_id,
                        AVG(LEAST(100, GREATEST(0, cs.concentration_score))) AS avg_concentration
                    FROM concentration_score cs
                    JOIN activity_log a ON a.id = cs.activity_id
                    JOIN valid_users vu ON vu.user_id = a.user_id
                    WHERE a.start_time BETWEEN :startTime AND :endTime
                      AND cs.concentration_score > 0
                    GROUP BY a.user_id
                ),
                students AS (
                    -- One row per learner: the `student` unique key is (user_id, username),
                    -- so a user can have >1 row — dedup here to avoid duplicate rows on the
                    -- institute-wide leaderboard (which spans every learner in the institute).
                    SELECT DISTINCT ON (s.user_id) s.user_id AS user_id,
                           s.full_name AS full_name, s.email AS email
                    FROM student s
                    JOIN valid_users vu ON vu.user_id = s.user_id
                    ORDER BY s.user_id, s.id
                )
                SELECT
                    st.user_id AS userId,
                    st.full_name AS fullName,
                    st.email AS email,
                    COALESCE(c.avg_concentration, 0) AS avgConcentration,
                    COALESCE(act.total_minutes, 0) AS totalTime,
                    COALESCE(act.total_minutes / NULLIF(act.active_days, 0), 0) AS dailyAvgTime,
                    DENSE_RANK() OVER (
                        ORDER BY COALESCE(act.total_minutes, 0) DESC,
                                 COALESCE(c.avg_concentration, 0) DESC
                    ) AS rank
                FROM students st
                LEFT JOIN activity act ON act.user_id = st.user_id
                LEFT JOIN concentration c ON c.user_id = st.user_id
            """, nativeQuery = true)
    List<LearnerActivityDataProjection> getInstituteActivityDataWithRank(
            @Param("startTime") Date startTime,
            @Param("endTime") Date endTime,
            @Param("instituteId") String instituteId,
            @Param("statusList") List<String> statusList);

    @Query(value = """
                        WITH Chapters AS (
                            SELECT
                                mc.chapter_id,
                                ch.chapter_name AS chapter_name,
                                cps.chapter_order AS chapter_order
                            FROM module_chapter_mapping mc
                            JOIN chapter_package_session_mapping cps ON mc.chapter_id = cps.chapter_id
                                AND cps.status IN (:chapterPackageStatusList)
                            JOIN chapter ch ON mc.chapter_id = ch.id
                                AND ch.status IN (:chapterStatusList)
                            WHERE mc.module_id = :moduleId
                        ),
                        Slides AS (
                            SELECT
                                csm.chapter_id,
                                s.id AS slide_id,
                                s.title AS slide_title,
                                s.source_type AS slide_source_type,
                                csm.slide_order AS slide_order
                            FROM chapter_to_slides csm
                            JOIN Chapters c ON csm.chapter_id = c.chapter_id
                            JOIN slide s ON csm.slide_id = s.id
                                AND s.status IN (:slideStatusList)
                            WHERE csm.status IN (:chapterSlideStatusList)
                        ),
                ActivityLogs AS (
                SELECT
                    al.id AS activity_id,
                    al.slide_id,
                    al.start_time,
                    al.end_time,
                    al.engaged_ms,
                    al.user_id
                FROM activity_log al
                JOIN Slides s ON al.slide_id = s.slide_id
            ),
                        StudentCount AS (
                            SELECT COUNT(DISTINCT ssigm.user_id) AS distinct_users
                            FROM student_session_institute_group_mapping ssigm
                            WHERE ssigm.package_session_id = :packageSessionId
                              AND ssigm.status IN (:learnerStatusList)
                        ),
                        AvgTimeSpent AS (
                            SELECT
                                al.slide_id,
                               (SUM(
              CASE
                WHEN al.end_time > al.start_time
                 AND al.start_time > TIMESTAMP '2023-01-01'
                THEN (COALESCE(al.engaged_ms, 0) / 1000.0)
                ELSE 0
              END
            ) / 60) / NULLIF((SELECT distinct_users FROM StudentCount), 0) AS avg_time_spent
              FROM ActivityLogs al
                            GROUP BY al.slide_id
                        ),
                        AvgConcentrationScore AS (
                            SELECT
                                al.slide_id,
                                SUM(LEAST(100, GREATEST(0, cs.concentration_score))) / NULLIF(COUNT(cs.id), 0) AS avg_concentration_score
                            FROM concentration_score cs
                            JOIN ActivityLogs al ON cs.activity_id = al.activity_id
                            GROUP BY al.slide_id
                        )
                        SELECT
                            c.chapter_id AS chapterId,
                            c.chapter_name AS chapterName,
                            JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'slide_id', s.slide_id,
                                    'slide_title', s.slide_title,
                                    'slide_source_type', s.slide_source_type,
                                    'avg_time_spent', COALESCE(a.avg_time_spent, 0.0),
                                    'avg_concentration_score', COALESCE(cscore.avg_concentration_score, 0.0)
                                )
                                ORDER BY s.slide_order NULLS LAST, s.slide_title
                            ) AS slides
                        FROM Chapters c
                        JOIN Slides s ON c.chapter_id = s.chapter_id
                        LEFT JOIN AvgTimeSpent a ON s.slide_id = a.slide_id
                        LEFT JOIN AvgConcentrationScore cscore ON s.slide_id = cscore.slide_id
                        GROUP BY c.chapter_id, c.chapter_name, c.chapter_order
                        ORDER BY c.chapter_order NULLS LAST, c.chapter_name
                        """, nativeQuery = true)
    List<ChapterSlideProgressProjection> getChapterSlideProgress(
            @Param("moduleId") String moduleId,
            @Param("packageSessionId") String packageSessionId,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterSlideStatusList") List<String> chapterSlideStatusList,
            @Param("learnerStatusList") List<String> learnerStatusList);

    @Query(value = """
            WITH date_series AS (
                SELECT generate_series(
                    CAST(:startDate AS DATE),
                    CAST(:endDate AS DATE),
                    INTERVAL '1 day'
                ) AS activity_date
            ),

            learner_activities AS (
                SELECT
                    al.user_id,
                    DATE(al.created_at) AS activity_date,
                    COALESCE(al.engaged_ms, 0) AS activity_duration_millis
                FROM activity_log al

                -- Join slide
                JOIN chapter_to_slides ctsm ON al.slide_id = ctsm.slide_id AND ctsm.status IN (:chapterToSlideStatusList)
                JOIN slide s ON s.id = al.slide_id AND s.status IN (:slideStatusList)

                -- Join chapter
                JOIN chapter ch ON ch.id = ctsm.chapter_id AND ch.status IN (:chapterStatusList)
                JOIN chapter_package_session_mapping cpsm
                    ON cpsm.chapter_id = ch.id
                    AND cpsm.package_session_id IN (:packageSessionIds)
                    AND cpsm.status IN (:chapterPackageSessionStatusList)

                -- Join module and subject
                JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id
                JOIN modules m ON m.id = mcm.module_id AND m.status IN (:moduleStatusList)
                JOIN subject_module_mapping smm ON smm.module_id = m.id
                JOIN subject subj ON subj.id = smm.subject_id AND subj.status IN (:subjectStatusList)
                JOIN subject_session ss ON ss.subject_id = subj.id AND ss.session_id IN (:packageSessionIds)

                -- Batch users filter
                JOIN student_session_institute_group_mapping ssigm
                    ON ssigm.user_id = al.user_id
                    AND ssigm.package_session_id IN (:packageSessionIds)
                    AND ssigm.status IN (:learnerStatusList)
                WHERE al.created_at BETWEEN :startDate AND :endDate
            ),

            daily_user_time AS (
                SELECT
                    user_id,
                    activity_date,
                    SUM(activity_duration_millis) AS time_spent_millis
                FROM learner_activities
                GROUP BY user_id, activity_date
            )

            SELECT
                ds.activity_date AS activityDate,
                COALESCE(dut.time_spent_millis, 0) AS timeSpentByUserMillis,
                (
                    SELECT AVG(d2.time_spent_millis)
                    FROM daily_user_time d2
                    WHERE d2.activity_date = ds.activity_date
                ) AS avgTimeSpentByBatchMillis
            FROM date_series ds
            LEFT JOIN daily_user_time dut ON ds.activity_date = dut.activity_date AND dut.user_id = :userId
            ORDER BY ds.activity_date
            """, nativeQuery = true)
    List<DailyTimeSpentProjection> getDailyUserAndBatchTimeSpent(
            @Param("userId") String userId,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("startDate") Timestamp startDate,
            @Param("endDate") Timestamp endDate,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterToSlideStatusList") List<String> chapterToSlideStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("chapterPackageSessionStatusList") List<String> chapterPackageSessionStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("learnerStatusList") List<String> learnerStatusList);

    @Query(value = """
            SELECT s.id
            FROM slide s
            JOIN chapter_to_slides cts ON cts.slide_id = s.id
            JOIN activity_log al ON al.slide_id = s.id
            WHERE cts.chapter_id = :chapterId
              AND al.user_id = :userId
              AND cts.status IN (:chapterToSlideStatusList)
              AND s.status IN (:slideStatusList)
            ORDER BY al.created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<String> findLatestWatchedSlideIdForChapter(
            @Param("userId") String userId,
            @Param("chapterId") String chapterId,
            @Param("chapterToSlideStatusList") List<String> chapterToSlideStatusList,
            @Param("slideStatusList") List<String> slideStatusList);

    @Query(value = """
            WITH
            chapter_progress AS (
                SELECT
                    COALESCE(SUM(CAST(lo.value AS FLOAT)), 0) / NULLIF(COUNT(DISTINCT cs.slide_id), 0) AS chapter_completion
                FROM chapter_to_slides cs
                LEFT JOIN learner_operation lo
                    ON lo.source_id = cs.slide_id
                    AND lo.operation IN (:learnerOperation)
                    AND lo.user_id = :userId
                    AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
                WHERE cs.status IN (:chapterToSlideStatusList)
                  AND cs.chapter_id = :chapterId
            ),
            module_chapters AS (
                SELECT DISTINCT mcm.chapter_id
                FROM module_chapter_mapping mcm
                JOIN chapter c ON c.id = mcm.chapter_id
                JOIN chapter_package_session_mapping cpm ON cpm.chapter_id = c.id
                WHERE mcm.module_id = :moduleId
                  AND cpm.status IN (:chapterStatusList)
                  AND c.status IN (:chapterStatusList)
            ),
            module_progress AS (
                SELECT
                    COALESCE(SUM(lo_val.chapter_value), 0) / NULLIF(COUNT(mc.chapter_id), 0) AS module_completion
                FROM module_chapters mc
                LEFT JOIN (
                    SELECT DISTINCT ON (lo.source_id)
                        lo.source_id,
                        CAST(lo.value AS FLOAT) AS chapter_value
                    FROM learner_operation lo
                    WHERE lo.operation IN (:moduleOperation)
                      AND lo.user_id = :userId
                      AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
                ) lo_val ON lo_val.source_id = mc.chapter_id
            ),
            subject_modules AS (
                SELECT DISTINCT smm.module_id
                FROM subject_module_mapping smm
                JOIN modules m ON m.id = smm.module_id
                WHERE smm.subject_id = :subjectId
                  AND m.status IN (:moduleStatusList)
            ),
            subject_progress AS (
                SELECT
                    COALESCE(SUM(CAST(lo.value AS FLOAT)), 0) / NULLIF(COUNT(sm.module_id), 0) AS subject_completion
                FROM subject_modules sm
                LEFT JOIN learner_operation lo
                    ON lo.source_id = sm.module_id
                    AND lo.operation IN (:subjectOperation)
                    AND lo.user_id = :userId
                    AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
            ),
            session_subjects AS (
                SELECT DISTINCT sps.subject_id
                FROM subject_session sps
                JOIN subject s ON s.id = sps.subject_id
                WHERE sps.session_id = :packageSessionId
                  AND s.status IN (:subjectStatusList)
            ),
            session_progress AS (
                SELECT
                    COALESCE(SUM(CAST(lo.value AS FLOAT)), 0) / NULLIF(COUNT(ss.subject_id), 0) AS session_completion
                FROM session_subjects ss
                LEFT JOIN learner_operation lo
                    ON lo.source_id = ss.subject_id
                    AND lo.operation IN (:sessionOperation)
                    AND lo.user_id = :userId
                    AND lo.value ~ '^-?\\d+(\\.\\d+)?$'
            ),
            latest_slide AS (
                SELECT
                    s.id AS slide_id,
                    s.title AS slide_title,
                    al.created_at
                FROM slide s
                JOIN chapter_to_slides cts ON cts.slide_id = s.id
                JOIN activity_log al ON al.slide_id = s.id
                WHERE cts.chapter_id = :chapterId
                  AND al.user_id = :userId
                  AND cts.status IN (:chapterToSlideStatusList)
                  AND s.status IN (:slideStatusList)
                ORDER BY al.created_at DESC
                LIMIT 1
            )
            SELECT
                COALESCE(cp.chapter_completion, 0) AS chapterCompletionPercentage,
                COALESCE(mp.module_completion, 0) AS moduleCompletionPercentage,
                COALESCE(sp.subject_completion, 0) AS subjectCompletionPercentage,
                COALESCE(spp.session_completion, 0) AS packageSessionCompletionPercentage,
                ls.slide_id AS lastWatchedSlideId,
                ls.slide_title AS lastWatchedSlideTitle,
                ls.created_at AS lastWatchedAt
            FROM chapter_progress cp
            FULL JOIN module_progress mp ON true
            FULL JOIN subject_progress sp ON true
            FULL JOIN session_progress spp ON true
            FULL JOIN latest_slide ls ON true
            """, nativeQuery = true)
    Optional<LearnerProgressProjection> getFullLearnerProgress(
            @Param("userId") String userId,
            @Param("chapterId") String chapterId,
            @Param("moduleId") String moduleId,
            @Param("subjectId") String subjectId,
            @Param("packageSessionId") String packageSessionId,
            @Param("learnerOperation") List<String> learnerOperation,
            @Param("moduleOperation") List<String> moduleOperation,
            @Param("subjectOperation") List<String> subjectOperation,
            @Param("sessionOperation") List<String> sessionOperation,
            @Param("chapterToSlideStatusList") List<String> chapterToSlideStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("subjectStatusList") List<String> subjectStatusList);

    /**
     * Find limited activity logs with only necessary fields for processing
     * Used by LLM analytics scheduler to optimize data fetching
     */
    // findProcessingDataByStatusWithLimit was removed in favour of claimProcessingBatch.
    // An unclaimed select is what let all four admin-core replicas pick up the same
    // oldest-N logs and each pay for the same LLM calls; leaving it here as an
    // alternative was a standing invitation to reintroduce that.

    /**
     * Claim a batch of logs for this replica.
     *
     * FOR UPDATE SKIP LOCKED is what makes the hourly job safe to run on all four
     * admin-core pods: each replica takes rows no other replica holds instead of all of
     * them racing on the same oldest-20. Must be called inside a transaction that then
     * flips the claimed rows to 'processing' - the row locks only last for the
     * transaction, the status change is what keeps them claimed afterwards.
     *
     * maxAttempts bounds retries so a log that can never succeed stops coming back.
     */
    @Query(value = "SELECT id, user_id AS userId, source_type AS sourceType, raw_json AS rawJson, " +
            "processed_json AS processedJson, status, created_at AS createdAt FROM activity_log " +
            "WHERE status IN (:statuses) AND processing_attempts < :maxAttempts " +
            "ORDER BY created_at ASC LIMIT :limit FOR UPDATE SKIP LOCKED", nativeQuery = true)
    List<ActivityLogProcessingProjection> claimProcessingBatch(@Param("statuses") List<String> statuses,
            @Param("maxAttempts") int maxAttempts,
            @Param("limit") int limit);

    /**
     * Flip claimed rows to their in-flight status and count the attempt up front, so an
     * abandoned batch cannot retry without limit.
     */
    @Modifying
    @Query(value = "UPDATE activity_log SET status = :status, processing_attempts = processing_attempts + 1, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id IN (:ids)", nativeQuery = true)
    int markClaimed(@Param("ids") List<String> ids, @Param("status") String status);

    /**
     * Return logs stranded in 'processing' by a pod that died mid-batch. activity_log has
     * no updated_at trigger, so markClaimed sets it explicitly and this reads it back as
     * the claim timestamp.
     */
    @Modifying
    @Query(value = "UPDATE activity_log SET status = 'failed', updated_at = CURRENT_TIMESTAMP " +
            "WHERE status = 'processing' " +
            "AND updated_at < CURRENT_TIMESTAMP - make_interval(mins => :staleMinutes)", nativeQuery = true)
    int releaseStaleClaims(@Param("staleMinutes") int staleMinutes);

    /**
     * Resolve the institute that owns a learner, for attributing AI spend on their
     * activity logs. Prefers an ACTIVE enrolment, then the most recent one, because a
     * learner may hold mappings in several institutes over time.
     */
    @Query(value = "SELECT institute_id FROM student_session_institute_group_mapping " +
            "WHERE user_id = :userId AND institute_id IS NOT NULL " +
            "ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC LIMIT 1", nativeQuery = true)
    Optional<String> findInstituteIdByUserId(@Param("userId") String userId);

    /**
     * Count activity logs by status
     * Used by scheduler status endpoint to show queue size
     */
    long countByStatus(String status);

    /**
     * Find processed activity logs for a user within a date range (limit to last 5)
     * Used for student analysis report generation
     */
    @Query(value = "SELECT * FROM activity_log " +
            "WHERE user_id = :userId " +
            "AND status = 'processed' " +
            "AND created_at BETWEEN :startDate AND :endDate " +
            "ORDER BY created_at DESC " +
            "LIMIT 5", nativeQuery = true)
    List<ActivityLog> findProcessedLogsForAnalysis(
            @Param("userId") String userId,
            @Param("startDate") java.sql.Timestamp startDate,
            @Param("endDate") java.sql.Timestamp endDate);

    /**
     * Find ALL processed activity logs for a user within a date range (capped at 50, newest first).
     * Used by the v2 comprehensive report's LearningInsightsCollector, which parses each row's
     * processed_json into aggregated topic-mastery / Bloom's / confidence / misconception graphs.
     * The cap bounds parsing cost while staying representative over a typical report window.
     */
    @Query(value = "SELECT * FROM activity_log " +
            "WHERE user_id = :userId " +
            "AND status = 'processed' " +
            "AND created_at BETWEEN :startDate AND :endDate " +
            "ORDER BY created_at DESC " +
            "LIMIT 50", nativeQuery = true)
    List<ActivityLog> findAllProcessedLogsForInsights(
            @Param("userId") String userId,
            @Param("startDate") java.sql.Timestamp startDate,
            @Param("endDate") java.sql.Timestamp endDate);

    /**
     * Student report raw detail: what the learner studied in a window, one row per slide —
     * [slide_id, title, slide_type, visits, engaged_minutes, max_percentage_watched,
     * first_seen, last_seen], most time first. The llm_* analytics rows are not study time
     * and are left out. READ-ONLY.
     */
    @Query(value = """
            SELECT a.slide_id,
                   s.title,
                   s.source_type,
                   COUNT(*) AS visits,
                   COALESCE(SUM(a.engaged_ms), 0) / 60000.0 AS engaged_minutes,
                   MAX(a.percentage_watched) AS max_percentage_watched,
                   MIN(a.created_at) AS first_seen,
                   MAX(a.created_at) AS last_seen
            FROM activity_log a
            LEFT JOIN slide s ON s.id = a.slide_id
            WHERE a.user_id = :userId
              AND a.slide_id IS NOT NULL
              AND a.created_at BETWEEN :startDate AND :endDate
              AND (a.source_type IS NULL OR a.source_type NOT LIKE 'llm\\_%')
            GROUP BY a.slide_id, s.title, s.source_type
            ORDER BY engaged_minutes DESC, last_seen DESC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<Object[]> findSlideActivityForUserInRange(
            @Param("userId") String userId,
            @Param("startDate") java.sql.Timestamp startDate,
            @Param("endDate") java.sql.Timestamp endDate,
            @Param("maxRows") int maxRows);

    /**
     * Find processed activity logs by user_id and slide_id
     * Used by LLM analytics API to fetch processed data for specific slide
     */
    @Query("SELECT a FROM ActivityLog a WHERE a.userId = :userId AND a.slideId = :slideId AND a.status = 'processed' ORDER BY a.createdAt DESC")
    List<ActivityLog> findByUserIdAndSlideIdAndStatusProcessed(
            @Param("userId") String userId,
            @Param("slideId") String slideId);

    /**
     * Every learner's LATEST processed analysis for one source (an assessment).
     *
     * <p>Backs the class-level AI report: rather than spending a fresh LLM call
     * per assessment, that report aggregates the per-learner analyses already
     * generated here — topics, Bloom's levels and shared misconceptions — so it
     * costs no additional AI credits.
     *
     * <p>DISTINCT ON keeps one row per learner: a re-attempted assessment leaves
     * several processed rows behind, and counting them all would weight those
     * learners twice in every class average.
     */
    @Query(value = """
            SELECT DISTINCT ON (a.user_id) a.*
            FROM activity_log a
            WHERE a.source_id = :sourceId
              AND a.source_type = 'llm_assessment'
              AND a.status = 'processed'
              AND a.processed_json IS NOT NULL
            ORDER BY a.user_id, a.created_at DESC
            """, nativeQuery = true)
    List<ActivityLog> findProcessedBySourceId(@Param("sourceId") String sourceId);

    /**
     * Find processed activity logs by user_id and source_id
     * Used by LLM analytics API to fetch processed data for specific source
     */
    @Query("SELECT a FROM ActivityLog a WHERE a.userId = :userId AND a.sourceId = :sourceId AND a.status = 'processed' ORDER BY a.createdAt DESC")
    List<ActivityLog> findByUserIdAndSourceIdAndStatusProcessed(
            @Param("userId") String userId,
            @Param("sourceId") String sourceId);

    /**
     * A learner's own AI insight reports, newest first, for the "Activity Insights" list
     * in My Reports.
     *
     * <p>Scoped to the slide-based report types. Assessment reports
     * ({@code llm_assessment}) are deliberately excluded: they key off an assessment id
     * rather than a slide, so their title cannot be resolved by this join, and learners
     * already reach them from the assessment report screen.
     *
     * <p>Only 'processed' rows appear — a 'failed' row holds an error marker, not a
     * report, and a 'raw' one has not been analysed yet.
     */
    @Query(value = """
            SELECT a.id AS id,
                   a.source_type AS sourceType,
                   a.slide_id AS slideId,
                   a.source_id AS sourceId,
                   s.title AS title,
                   a.created_at AS createdAt
            FROM activity_log a
            LEFT JOIN slide s ON s.id = a.slide_id
            WHERE a.user_id = :userId
              AND a.status = 'processed'
              AND a.source_type IN ('llm_quiz', 'llm_question', 'llm_assignment')
            ORDER BY a.created_at DESC
            """,
            countQuery = """
            SELECT COUNT(*)
            FROM activity_log a
            WHERE a.user_id = :userId
              AND a.status = 'processed'
              AND a.source_type IN ('llm_quiz', 'llm_question', 'llm_assignment')
            """,
            nativeQuery = true)
    Page<LearnerInsightSummaryProjection> findInsightSummariesForLearner(
            @Param("userId") String userId,
            Pageable pageable);

    /**
     * Find all activity logs for a user + source (any status), newest first.
     * Used by on-demand AI report processing to locate the raw/failed row to
     * process immediately when a learner opens the report before the hourly cron.
     */
    @Query("SELECT a FROM ActivityLog a WHERE a.userId = :userId AND a.sourceId = :sourceId ORDER BY a.createdAt DESC")
    List<ActivityLog> findByUserIdAndSourceIdOrderByCreatedAtDesc(
            @Param("userId") String userId,
            @Param("sourceId") String sourceId);

    /**
     * Update processed JSON and status for an activity log
     * Used by LLM analytics processor to update processed data without loading full
     * entity
     */
    @Modifying
    @Transactional
    @Query("UPDATE ActivityLog a SET a.processedJson = :processedJson, a.status = :status WHERE a.id = :id")
    void updateProcessedData(@Param("id") String id, @Param("processedJson") String processedJson,
            @Param("status") String status);

    /**
     * BUG-6/BUG-10: Fetch assignment activity logs for a user within a date range,
     * with assignmentSlideTracked JOIN FETCHed in-session so the collection is
     * initialized when the collector runs in a CompletableFuture worker thread.
     * Uses JPQL (not native), no LIMIT, no status filter.
     */
    @Query("SELECT DISTINCT a FROM ActivityLog a JOIN FETCH a.assignmentSlideTracked ast " +
           "WHERE a.userId = :userId AND a.createdAt BETWEEN :start AND :end")
    List<ActivityLog> findAssignmentActivityLogsForUserInRange(
            @Param("userId") String userId,
            @Param("start") java.sql.Timestamp start,
            @Param("end") java.sql.Timestamp end);

    // ── Student report v2: content-type engagement counts (READ-ONLY) ─────────

    /**
     * Returns rows of [source_type, count] for a user's activity logs in the date range.
     * Used by ActivityCollector to populate content_engagement in StudyHabitsSection.
     * READ-ONLY: SELECT only, no mutations.
     */
    @org.springframework.data.jpa.repository.Query(value = """
            SELECT al.source_type AS sourceType, COUNT(al.id) AS cnt
            FROM activity_log al
            WHERE al.user_id = :userId
              AND al.created_at BETWEEN :start AND :end
              AND al.source_type IS NOT NULL
            GROUP BY al.source_type
            """, nativeQuery = true)
    List<Object[]> getContentTypeCountsForUser(
            @org.springframework.data.repository.query.Param("userId") String userId,
            @org.springframework.data.repository.query.Param("start") java.sql.Timestamp start,
            @org.springframework.data.repository.query.Param("end") java.sql.Timestamp end);

}