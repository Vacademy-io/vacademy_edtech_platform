package vacademy.io.admin_core_service.features.course_pulse.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.course_pulse.dto.ContentMapSlideProjection;
import vacademy.io.admin_core_service.features.course_pulse.dto.FeedEventProjection;
import vacademy.io.admin_core_service.features.course_pulse.dto.PulseRosterRowProjection;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;

import java.time.Instant;
import java.util.List;

/**
 * Read-only queries for Course Pulse. All are bounded by the active set (rows whose
 * last_seen_at is inside the offline window), so cost scales with concurrent learners,
 * not with the size of activity_log.
 *
 * The "latest per learner" subquery uses DISTINCT ON (user_id) ordered by last_seen_at DESC,
 * so a learner with several open slide rows collapses to their most recent one. Time fields
 * are computed against now() in SQL; unquoted camelCase aliases are lower-cased by Postgres
 * and matched case-insensitively to the projection getters.
 */
public interface PulseRepository extends JpaRepository<ActivityLog, String> {

    /**
     * All currently-present learners for a batch (last_seen within the offline window), each with
     * their latest slide, time-on-slide, and per-slide struggle counts. Bounded by the active set,
     * so the service computes KPI counts, needs-help state, ordering and the roster cap in Java.
     *
     * Struggle is signal-based, not dwell-based: wrong question/quiz answers and failing code
     * submissions ON THE CURRENT SLIDE. Passive slides (video/audio/document) have no such records,
     * so they never register as "needs help" -- a learner watching a 2-hour video is not flagged.
     */
    @Query(value = """
            SELECT userId, fullName, slideId, slideTitle, slideType, chapterId,
                   onSlideSeconds, lastSeenAgoSeconds,
                   (
                       (SELECT COUNT(*) FROM question_slide_tracked qst
                            JOIN activity_log a2 ON a2.id = qst.activity_id
                            WHERE a2.user_id = latest.userId AND a2.slide_id = latest.slideId
                              AND qst.response_status = 'INCORRECT')
                     + (SELECT COUNT(*) FROM quiz_slide_question_tracked quiz
                            JOIN activity_log a3 ON a3.id = quiz.activity_id
                            WHERE a3.user_id = latest.userId AND a3.slide_id = latest.slideId
                              AND quiz.response_status = 'INCORRECT')
                   ) AS wrongCount,
                   (SELECT COUNT(*) FROM coding_submissions cs
                        WHERE cs.learner_id = latest.userId AND cs.slide_id = latest.slideId
                          AND cs.total_count > 0 AND cs.passed_count < cs.total_count) AS failedCodeCount
            FROM (
                SELECT DISTINCT ON (al.user_id)
                       al.user_id                                                AS userId,
                       st.full_name                                              AS fullName,
                       al.slide_id                                               AS slideId,
                       sl.title                                                  AS slideTitle,
                       sl.source_type                                            AS slideType,
                       cts.chapter_id                                            AS chapterId,
                       CAST(EXTRACT(EPOCH FROM (now() - al.created_at)) AS bigint)        AS onSlideSeconds,
                       CAST(EXTRACT(EPOCH FROM (now() - al.last_seen_at)) AS bigint)      AS lastSeenAgoSeconds
                FROM activity_log al
                    JOIN chapter_to_slides cts
                        ON cts.slide_id = al.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m
                        ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE m.package_session_id = :batchId
                  AND al.last_seen_at > :offlineCutoff
                ORDER BY al.user_id, al.last_seen_at DESC
            ) latest
            """, nativeQuery = true)
    List<PulseRosterRowProjection> getActiveLearners(@Param("batchId") String batchId,
                                                     @Param("offlineCutoff") Instant offlineCutoff);

    @Query(value = """
            SELECT COUNT(*)
            FROM student_session_institute_group_mapping
            WHERE package_session_id = :batchId
              AND status = 'ACTIVE'
            """, nativeQuery = true)
    long countEnrolled(@Param("batchId") String batchId);

    /**
     * Content Map: every slide with at least one live learner, carrying its full
     * subject → module → chapter hierarchy labels. Each learner appears on exactly one
     * slide (DISTINCT ON latest), so summing slide heads up the tree is an exact
     * distinct-learner count per node.
     */
    @Query(value = """
            SELECT subj.id           AS subjectId,
                   subj.subject_name AS subjectName,
                   mod.id            AS moduleId,
                   mod.module_name   AS moduleName,
                   ch.id             AS chapterId,
                   ch.chapter_name   AS chapterName,
                   sl.id             AS slideId,
                   sl.title          AS slideTitle,
                   sl.source_type    AS slideType,
                   COUNT(DISTINCT latest.user_id)            AS headsNow,
                   CAST(COALESCE(AVG(latest.on_slide_seconds), 0) AS bigint) AS avgOnSlideSeconds
            FROM (
                SELECT DISTINCT ON (al.user_id)
                       al.user_id                                          AS user_id,
                       al.slide_id                                         AS slide_id,
                       CAST(EXTRACT(EPOCH FROM (now() - al.created_at)) AS bigint)  AS on_slide_seconds
                FROM activity_log al
                    JOIN chapter_to_slides cts
                        ON cts.slide_id = al.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m
                        ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                WHERE m.package_session_id = :batchId
                  AND al.last_seen_at > :offlineCutoff
                ORDER BY al.user_id, al.last_seen_at DESC
            ) latest
                JOIN slide sl ON sl.id = latest.slide_id
                JOIN chapter_to_slides cts2
                    ON cts2.slide_id = latest.slide_id AND cts2.status <> 'DELETED'
                JOIN chapter_package_session_mapping m2
                    ON m2.chapter_id = cts2.chapter_id AND m2.status <> 'DELETED'
                   AND m2.package_session_id = :batchId
                JOIN chapter ch ON ch.id = cts2.chapter_id
                JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id
                JOIN modules mod ON mod.id = mcm.module_id
                JOIN subject_module_mapping smm ON smm.module_id = mod.id
                JOIN subject subj ON subj.id = smm.subject_id
            GROUP BY subj.id, subj.subject_name, mod.id, mod.module_name,
                     ch.id, ch.chapter_name, sl.id, sl.title, sl.source_type
            """, nativeQuery = true)
    List<ContentMapSlideProjection> getContentMap(@Param("batchId") String batchId,
                                                  @Param("offlineCutoff") Instant offlineCutoff);

    /**
     * Live Feed: recent submission/attempt events across the tracked tables, unioned and
     * capped by a time window + row limit. Batch is resolved via activity_log's slide for
     * activity-based events, and directly for coding submissions.
     */
    @Query(value = """
            SELECT occurredAtEpoch, userId, fullName, slideId, slideTitle, slideType, eventType, detail
            FROM (
                SELECT CAST(EXTRACT(EPOCH FROM ast.created_at) * 1000 AS bigint) AS occurredAtEpoch,
                       al.user_id AS userId, st.full_name AS fullName,
                       al.slide_id AS slideId, sl.title AS slideTitle, sl.source_type AS slideType,
                       'SUBMITTED_ASSIGNMENT' AS eventType,
                       CASE WHEN ast.late_submission THEN 'late submission' ELSE 'submitted' END AS detail
                FROM assignment_slide_tracked ast
                    JOIN activity_log al ON al.id = ast.activity_id
                    JOIN chapter_to_slides cts ON cts.slide_id = al.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE m.package_session_id = :batchId AND ast.created_at > :sinceCutoff

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM aest.created_at) * 1000 AS bigint),
                       al.user_id, st.full_name, al.slide_id, sl.title, sl.source_type,
                       'SUBMITTED_ASSESSMENT', 'submitted'
                FROM assessment_slide_tracked aest
                    JOIN activity_log al ON al.id = aest.activity_id
                    JOIN chapter_to_slides cts ON cts.slide_id = al.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE m.package_session_id = :batchId AND aest.created_at > :sinceCutoff

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM cs.submitted_at) * 1000 AS bigint),
                       cs.learner_id, st.full_name, cs.slide_id, sl.title, sl.source_type,
                       'CODE_SUBMISSION',
                       cs.verdict || ' (' || cs.passed_count || '/' || cs.total_count || ')'
                FROM coding_submissions cs
                    JOIN slide sl ON sl.id = cs.slide_id
                    LEFT JOIN student st ON st.user_id = cs.learner_id
                WHERE cs.package_session_id = :batchId AND cs.submitted_at > :sinceCutoff

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM qst.created_at) * 1000 AS bigint),
                       al.user_id, st.full_name, al.slide_id, sl.title, sl.source_type,
                       'ANSWERED_QUESTION', qst.response_status
                FROM question_slide_tracked qst
                    JOIN activity_log al ON al.id = qst.activity_id
                    JOIN chapter_to_slides cts ON cts.slide_id = al.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE m.package_session_id = :batchId AND qst.created_at > :sinceCutoff

                UNION ALL

                SELECT CAST(EXTRACT(EPOCH FROM quiz.created_at) * 1000 AS bigint),
                       al.user_id, st.full_name, al.slide_id, sl.title, sl.source_type,
                       'ANSWERED_QUIZ', quiz.response_status
                FROM quiz_slide_question_tracked quiz
                    JOIN activity_log al ON al.id = quiz.activity_id
                    JOIN chapter_to_slides cts ON cts.slide_id = al.slide_id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    JOIN slide sl ON sl.id = al.slide_id
                    LEFT JOIN student st ON st.user_id = al.user_id
                WHERE m.package_session_id = :batchId AND quiz.created_at > :sinceCutoff
            ) feed
            ORDER BY occurredAtEpoch DESC
            LIMIT :limitCount
            """, nativeQuery = true)
    List<FeedEventProjection> getFeed(@Param("batchId") String batchId,
                                      @Param("sinceCutoff") Instant sinceCutoff,
                                      @Param("limitCount") int limitCount);

    /**
     * One learner, latest slides first: each slide once, with when it was last seen, engaged time,
     * visits and the furthest percentage watched, since a cutoff. Learner Academic Activity tab.
     * Row: [slide_id, title, source_type, chapter_name, last_seen_at, engaged_ms, visits, max_percent].
     */
    @Query(value = """
            SELECT s.id,
                   s.title,
                   s.source_type,
                   (SELECT c.chapter_name FROM chapter_to_slides cts
                        JOIN chapter c ON c.id = cts.chapter_id
                        WHERE cts.slide_id = s.id AND cts.status <> 'DELETED'
                        LIMIT 1),
                   MAX(COALESCE(al.last_seen_at, CAST(al.created_at AS timestamptz))) AS seen,
                   SUM(COALESCE(al.engaged_ms, 0)),
                   COUNT(*),
                   MAX(al.percentage_watched)
            FROM activity_log al
                JOIN slide s ON s.id = al.slide_id
            WHERE al.user_id = :userId
              AND al.slide_id IS NOT NULL
              AND al.created_at >= :since
            GROUP BY s.id, s.title, s.source_type
            ORDER BY seen DESC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<Object[]> getLearnerRecentSlides(@Param("userId") String userId,
                                          @Param("since") java.sql.Timestamp since,
                                          @Param("maxRows") int maxRows);

    /**
     * One learner since a cutoff, as one row: [engaged_ms, active_days, slides_opened, visits,
     * engaged_ms in the last seven days, engaged_ms in the seven days before]. Academic Activity tab.
     */
    @Query(value = """
            SELECT COALESCE(SUM(COALESCE(al.engaged_ms, 0)), 0),
                   COUNT(DISTINCT DATE(al.created_at AT TIME ZONE 'UTC' AT TIME ZONE :zone)),
                   COUNT(DISTINCT al.slide_id),
                   COUNT(*),
                   COALESCE(SUM(COALESCE(al.engaged_ms, 0)) FILTER (WHERE al.created_at >= :weekAgo), 0),
                   COALESCE(SUM(COALESCE(al.engaged_ms, 0))
                            FILTER (WHERE al.created_at >= :twoWeeksAgo AND al.created_at < :weekAgo), 0)
            FROM activity_log al
            WHERE al.user_id = :userId
              AND al.slide_id IS NOT NULL
              AND al.created_at >= :since
            """, nativeQuery = true)
    List<Object[]> getLearnerTotals(@Param("userId") String userId,
                                    @Param("zone") String zone,
                                    @Param("since") java.sql.Timestamp since,
                                    @Param("weekAgo") java.sql.Timestamp weekAgo,
                                    @Param("twoWeeksAgo") java.sql.Timestamp twoWeeksAgo);

    /** One learner since a cutoff: [slide_source_type, engaged_ms, slides_opened] rows, most time first. */
    @Query(value = """
            SELECT s.source_type, SUM(COALESCE(al.engaged_ms, 0)), COUNT(DISTINCT s.id)
            FROM activity_log al
                JOIN slide s ON s.id = al.slide_id
            WHERE al.user_id = :userId
              AND al.slide_id IS NOT NULL
              AND al.created_at >= :since
            GROUP BY s.source_type
            ORDER BY 2 DESC
            """, nativeQuery = true)
    List<Object[]> getLearnerContentMix(@Param("userId") String userId,
                                        @Param("since") java.sql.Timestamp since);

    /**
     * One learner since a cutoff, by local weekday and hour: [iso_weekday, hour, engaged_ms] rows.
     * Monday is 1. Study rhythm on the Academic Activity tab.
     */
    @Query(value = """
            SELECT CAST(EXTRACT(ISODOW FROM al.created_at AT TIME ZONE 'UTC' AT TIME ZONE :zone) AS int),
                   CAST(EXTRACT(HOUR FROM al.created_at AT TIME ZONE 'UTC' AT TIME ZONE :zone) AS int),
                   SUM(COALESCE(al.engaged_ms, 0))
            FROM activity_log al
            WHERE al.user_id = :userId
              AND al.slide_id IS NOT NULL
              AND COALESCE(al.engaged_ms, 0) > 0
              AND al.created_at >= :since
            GROUP BY 1, 2
            """, nativeQuery = true)
    List<Object[]> getLearnerRhythm(@Param("userId") String userId,
                                    @Param("zone") String zone,
                                    @Param("since") java.sql.Timestamp since);
}
