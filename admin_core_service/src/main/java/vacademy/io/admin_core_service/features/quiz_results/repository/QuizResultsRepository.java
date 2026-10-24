package vacademy.io.admin_core_service.features.quiz_results.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizAttemptProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizLearnerProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizOptionProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizQuestionProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizResponseProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizSlideMetaProjection;

import java.util.List;

/**
 * Read-only queries behind the course-details Quiz Results tab.
 *
 * <p>These deliberately fetch <em>facts</em> (which quizzes, who attempted, what they
 * answered, what the answer key says) and leave the scoring to
 * {@link vacademy.io.admin_core_service.features.quiz_results.service.QuizResultsService}.
 * Aggregating in SQL off {@code quiz_slide_question_tracked.response_status} was the
 * obvious design and it is wrong: the quiz viewer graded client-side and its "Finish"
 * path wrote the literal placeholder {@code "SUBMITTED"} for every question until the
 * server-side scoring fix landed, so on production ~93% of stored responses carry no
 * verdict at all. A SQL SUM over that column reports a class that scored full marks as
 * having scored zero. The service re-derives the verdict from the stored answer key for
 * exactly those rows.
 *
 * <p>Two rules hold across all of them:
 * <ul>
 *   <li><b>Latest attempt only.</b> Quizzes can be re-attemptable, so responses are read
 *       off the newest activity_log row per (learner, slide) via {@code DISTINCT ON}.
 *       Summing every attempt would credit a learner who retried until they passed with
 *       thirty answers on a ten-question quiz.
 *   <li><b>Batch-scoped.</b> A slide is shared across batches through
 *       chapter_package_session_mapping, so filtering on slide alone mixes other classes
 *       into a teacher's numbers. Every query joins the batch roster.
 * </ul>
 *
 * <p>Unquoted camelCase aliases are lower-cased by Postgres and matched case-insensitively
 * against the projection getters.
 */
public interface QuizResultsRepository extends JpaRepository<ActivityLog, String> {

    /**
     * Every quiz slide in the batch with its place in the course tree and its answer-key
     * totals. Touches no activity data, so it stays cheap however much history exists.
     * A slide mapped through several chapters collapses to its first mapping.
     */
    @Query(value = """
            SELECT * FROM (
            SELECT DISTINCT ON (s.id)
                   s.id              AS slideId,
                   s.source_id       AS quizSlideId,
                   s.title           AS slideTitle,
                   s.status          AS slideStatus,
                   cts.slide_order   AS slideOrder,
                   ch.id             AS chapterId,
                   ch.chapter_name   AS chapterName,
                   mod.module_name   AS moduleName,
                   subj.subject_name AS subjectName,
                   qz.pass_percentage       AS passPercentage,
                   qz.time_limit_in_minutes AS timeLimitInMinutes,
                   qz.re_attempt_count      AS reAttemptCount,
                   (SELECT COUNT(*) FROM quiz_slide_question q
                     WHERE q.quiz_slide_id = qz.id
                       AND COALESCE(q.status, 'ACTIVE') <> 'DELETED')                    AS questionCount,
                   (SELECT COALESCE(SUM(COALESCE(q.marks, qz.marks_per_question, 1)), 0)
                      FROM quiz_slide_question q
                     WHERE q.quiz_slide_id = qz.id
                       AND COALESCE(q.status, 'ACTIVE') <> 'DELETED')                    AS totalMarks
            FROM slide s
                JOIN quiz_slide qz ON qz.id = s.source_id
                JOIN chapter_to_slides cts
                    ON cts.slide_id = s.id AND cts.status <> 'DELETED'
                JOIN chapter_package_session_mapping m
                    ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                   AND m.package_session_id = :batchId
                JOIN chapter ch ON ch.id = cts.chapter_id
                LEFT JOIN module_chapter_mapping mcm ON mcm.chapter_id = ch.id
                LEFT JOIN modules mod ON mod.id = mcm.module_id
                LEFT JOIN subject_module_mapping smm ON smm.module_id = mod.id
                LEFT JOIN subject subj ON subj.id = smm.subject_id
            WHERE s.source_type = 'QUIZ'
              AND COALESCE(s.status, '') <> 'DELETED'
              AND (CAST(:slideId AS text) IS NULL OR s.id = CAST(:slideId AS text))
            ORDER BY s.id, cts.created_at NULLS LAST
            ) q
            -- DISTINCT ON dictates the inner ORDER BY (it must lead with s.id), which would
            -- otherwise hand the tab a list sorted by slide UUID. The outer sort restores
            -- course order, which is what "Course order" in the UI means.
            ORDER BY q.subjectName NULLS LAST, q.moduleName NULLS LAST,
                     q.chapterName NULLS LAST, q.slideOrder NULLS LAST, q.slideTitle
            """, nativeQuery = true)
    List<QuizSlideMetaProjection> getQuizSlides(@Param("batchId") String batchId,
                                                @Param("slideId") String slideId);

    /** Enrolled learners in the batch - the participation denominator. */
    @Query(value = """
            SELECT COUNT(DISTINCT user_id)
            FROM student_session_institute_group_mapping
            WHERE package_session_id = :batchId
              AND status IN ('ACTIVE', 'INACTIVE')
            """, nativeQuery = true)
    long countEnrolledLearners(@Param("batchId") String batchId);

    /**
     * The batch roster, for the per-quiz learner table. Driven off enrolment rather than
     * activity so learners who never opened the quiz are still rows - "who hasn't done it
     * yet" is the main question this screen answers, and an activity-driven list can
     * never show them.
     */
    @Query(value = """
            SELECT DISTINCT ON (ssigm.user_id)
                   ssigm.user_id    AS userId,
                   ssigm.status     AS enrollmentStatus,
                   st.full_name     AS fullName,
                   st.email         AS email,
                   st.mobile_number AS mobileNumber
            FROM student_session_institute_group_mapping ssigm
                JOIN student st ON st.user_id = ssigm.user_id
            WHERE ssigm.package_session_id = :batchId
              AND ssigm.status IN ('ACTIVE', 'INACTIVE')
            ORDER BY ssigm.user_id, ssigm.status
            LIMIT :rowLimit
            """, nativeQuery = true)
    List<QuizLearnerProjection> getBatchRoster(@Param("batchId") String batchId,
                                               @Param("rowLimit") int rowLimit);

    /**
     * One row per (learner, quiz) the batch has attempted: the latest attempt's id and
     * engaged time, plus how many attempts there have been in total. The window functions
     * are evaluated before {@code DISTINCT ON} picks the newest row, so the counts cover
     * every attempt while the ids describe only the latest.
     */
    @Query(value = """
            WITH quiz_slides AS (
                SELECT DISTINCT s.id AS slide_id
                FROM slide s
                    JOIN chapter_to_slides cts
                        ON cts.slide_id = s.id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m
                        ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                       AND m.package_session_id = :batchId
                WHERE s.source_type = 'QUIZ'
                  AND COALESCE(s.status, '') <> 'DELETED'
                  AND (CAST(:slideId AS text) IS NULL OR s.id = CAST(:slideId AS text))
            ),
            batch_learner AS (
                SELECT DISTINCT ssigm.user_id AS user_id
                FROM student_session_institute_group_mapping ssigm
                WHERE ssigm.package_session_id = :batchId
                  AND ssigm.status IN ('ACTIVE', 'INACTIVE')
            )
            SELECT DISTINCT ON (al.slide_id, al.user_id)
                   al.slide_id   AS slideId,
                   al.user_id    AS userId,
                   al.id         AS activityId,
                   al.engaged_ms AS engagedMs,
                   COUNT(*)      OVER (PARTITION BY al.slide_id, al.user_id) AS attemptCount,
                   MAX(al.created_at) OVER (PARTITION BY al.slide_id, al.user_id) AS lastAttemptAt
            FROM activity_log al
                JOIN quiz_slides qs ON qs.slide_id = al.slide_id
                JOIN batch_learner bl ON bl.user_id = al.user_id
            WHERE al.source_type = 'QUIZ'
              AND (CAST(:userId AS text) IS NULL OR al.user_id = CAST(:userId AS text))
            ORDER BY al.slide_id, al.user_id, al.created_at DESC
            """, nativeQuery = true)
    List<QuizAttemptProjection> getAttempts(@Param("batchId") String batchId,
                                            @Param("slideId") String slideId,
                                            @Param("userId") String userId);

    /**
     * Every tracked response on those latest attempts. Bounded by learners x questions for
     * the quizzes in scope (a few thousand rows for the largest production batch), which
     * is what makes grading them in Java affordable.
     */
    @Query(value = """
            WITH quiz_slides AS (
                SELECT DISTINCT s.id AS slide_id
                FROM slide s
                    JOIN chapter_to_slides cts
                        ON cts.slide_id = s.id AND cts.status <> 'DELETED'
                    JOIN chapter_package_session_mapping m
                        ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                       AND m.package_session_id = :batchId
                WHERE s.source_type = 'QUIZ'
                  AND COALESCE(s.status, '') <> 'DELETED'
                  AND (CAST(:slideId AS text) IS NULL OR s.id = CAST(:slideId AS text))
            ),
            batch_learner AS (
                SELECT DISTINCT ssigm.user_id AS user_id
                FROM student_session_institute_group_mapping ssigm
                WHERE ssigm.package_session_id = :batchId
                  AND ssigm.status IN ('ACTIVE', 'INACTIVE')
            ),
            latest AS (
                SELECT DISTINCT ON (al.slide_id, al.user_id)
                       al.slide_id AS slide_id,
                       al.user_id  AS user_id,
                       al.id       AS activity_id
                FROM activity_log al
                    JOIN quiz_slides qs ON qs.slide_id = al.slide_id
                    JOIN batch_learner bl ON bl.user_id = al.user_id
                WHERE al.source_type = 'QUIZ'
                  AND (CAST(:userId AS text) IS NULL OR al.user_id = CAST(:userId AS text))
                ORDER BY al.slide_id, al.user_id, al.created_at DESC
            )
            SELECT l.slide_id        AS slideId,
                   l.user_id         AS userId,
                   t.question_id     AS questionId,
                   t.response_status AS responseStatus,
                   t.response_json   AS responseJson
            FROM latest l
                JOIN quiz_slide_question_tracked t ON t.activity_id = l.activity_id
            """, nativeQuery = true)
    List<QuizResponseProjection> getLatestAttemptResponses(@Param("batchId") String batchId,
                                                           @Param("slideId") String slideId,
                                                           @Param("userId") String userId);

    /**
     * EVERY attempt one learner made at one quiz, oldest first, so the service can number
     * them ("attempt 2 of 3"). Unlike {@link #getAttempts} this does not collapse to the
     * latest row: the whole point of the learner side-view is to show the attempt history.
     */
    @Query(value = """
            SELECT al.id         AS activityId,
                   al.created_at AS attemptedAt,
                   al.engaged_ms AS engagedMs
            FROM activity_log al
            WHERE al.slide_id = :slideId
              AND al.user_id = :userId
              AND al.source_type = 'QUIZ'
              AND EXISTS (
                    SELECT 1 FROM student_session_institute_group_mapping ssigm
                    WHERE ssigm.user_id = al.user_id
                      AND ssigm.package_session_id = :batchId
                      AND ssigm.status IN ('ACTIVE', 'INACTIVE'))
            ORDER BY al.created_at ASC
            """, nativeQuery = true)
    List<LearnerAttemptProjection> getLearnerAttempts(@Param("batchId") String batchId,
                                                      @Param("slideId") String slideId,
                                                      @Param("userId") String userId);

    /** Every tracked response across all of that learner's attempts at the quiz. */
    @Query(value = """
            SELECT t.activity_id     AS activityId,
                   t.question_id     AS questionId,
                   t.response_status AS responseStatus,
                   t.response_json   AS responseJson
            FROM quiz_slide_question_tracked t
                JOIN activity_log al ON al.id = t.activity_id
            WHERE al.slide_id = :slideId
              AND al.user_id = :userId
              AND al.source_type = 'QUIZ'
            """, nativeQuery = true)
    List<LearnerResponseProjection> getLearnerResponses(@Param("slideId") String slideId,
                                                        @Param("userId") String userId);

    /** One attempt row of a learner's quiz history. */
    interface LearnerAttemptProjection {
        String getActivityId();
        java.sql.Timestamp getAttemptedAt();
        Long getEngagedMs();
    }

    /** One answer, tagged with the attempt it belongs to. */
    interface LearnerResponseProjection {
        String getActivityId();
        String getQuestionId();
        String getResponseStatus();
        String getResponseJson();
    }

    /**
     * The active questions of the quizzes in scope, with answer keys and marks.
     * {@code includeText} keeps the question/explanation bodies out of the overview's
     * payload, where only the keys are needed - a course can carry a hundred quizzes.
     */
    @Query(value = """
            SELECT s.id                     AS slideId,
                   q.id                     AS questionId,
                   q.question_order         AS questionOrder,
                   q.question_type          AS questionType,
                   q.question_response_type AS questionResponseType,
                   CASE WHEN CAST(:includeText AS boolean) THEN txt.content ELSE NULL END  AS textContent,
                   CASE WHEN CAST(:includeText AS boolean) THEN expl.content ELSE NULL END AS explanationContent,
                   CAST(COALESCE(q.marks, qz.marks_per_question, 1) AS double precision) AS marks,
                   qz.partial_marking       AS partialMarking,
                   q.auto_evaluation_json   AS autoEvaluationJson
            FROM slide s
                JOIN quiz_slide qz ON qz.id = s.source_id
                JOIN quiz_slide_question q
                    ON q.quiz_slide_id = qz.id AND COALESCE(q.status, 'ACTIVE') <> 'DELETED'
                LEFT JOIN rich_text_data txt ON txt.id = q.text_id
                LEFT JOIN rich_text_data expl ON expl.id = q.explanation_text_id
            WHERE s.source_type = 'QUIZ'
              AND COALESCE(s.status, '') <> 'DELETED'
              AND (CAST(:slideId AS text) IS NULL OR s.id = CAST(:slideId AS text))
              AND EXISTS (
                    SELECT 1 FROM chapter_to_slides cts
                        JOIN chapter_package_session_mapping m
                            ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    WHERE cts.slide_id = s.id AND cts.status <> 'DELETED'
                      AND m.package_session_id = :batchId)
            ORDER BY s.id, q.question_order NULLS LAST, q.created_at NULLS LAST, q.id
            """, nativeQuery = true)
    List<QuizQuestionProjection> getQuestions(@Param("batchId") String batchId,
                                              @Param("slideId") String slideId,
                                              @Param("includeText") boolean includeText);

    /**
     * Options for those questions, ordered by creation. The order matters: the
     * AI-authoring path still writes answer keys as positional indices, and
     * {@code AutoEvaluationScorer} resolves them against this list - so a different
     * ordering here would silently mark the wrong option correct.
     */
    @Query(value = """
            SELECT o.id                     AS optionId,
                   o.quiz_slide_question_id AS questionId,
                   CASE WHEN CAST(:includeText AS boolean) THEN txt.content ELSE NULL END AS textContent
            FROM slide s
                JOIN quiz_slide qz ON qz.id = s.source_id
                JOIN quiz_slide_question q
                    ON q.quiz_slide_id = qz.id AND COALESCE(q.status, 'ACTIVE') <> 'DELETED'
                JOIN quiz_slide_question_options o ON o.quiz_slide_question_id = q.id
                LEFT JOIN rich_text_data txt ON txt.id = o.text_id
            WHERE s.source_type = 'QUIZ'
              AND COALESCE(s.status, '') <> 'DELETED'
              AND (CAST(:slideId AS text) IS NULL OR s.id = CAST(:slideId AS text))
              AND EXISTS (
                    SELECT 1 FROM chapter_to_slides cts
                        JOIN chapter_package_session_mapping m
                            ON m.chapter_id = cts.chapter_id AND m.status <> 'DELETED'
                    WHERE cts.slide_id = s.id AND cts.status <> 'DELETED'
                      AND m.package_session_id = :batchId)
            ORDER BY o.quiz_slide_question_id, o.created_on NULLS LAST, o.id
            """, nativeQuery = true)
    List<QuizOptionProjection> getQuestionOptions(@Param("batchId") String batchId,
                                                  @Param("slideId") String slideId,
                                                  @Param("includeText") boolean includeText);
}
