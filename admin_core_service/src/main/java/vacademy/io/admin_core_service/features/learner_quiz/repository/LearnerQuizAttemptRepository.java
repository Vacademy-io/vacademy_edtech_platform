package vacademy.io.admin_core_service.features.learner_quiz.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;

import java.util.List;
import java.util.Optional;

/**
 * SQL behind learner quiz grading. Attempts stay in the tables they have always used:
 * one activity_log row per attempt and one quiz_slide_question_tracked row per question.
 *
 * <p>Keep apostrophes out of the SQL text below, including comments, and use cast() rather
 * than the double-colon form: Spring Data parses these strings when the service boots.
 */
public interface LearnerQuizAttemptRepository extends Repository<ActivityLog, String> {

    /**
     * Serialises one learner's writes on one quiz until the current transaction ends, so
     * count-then-insert cannot pass the attempt cap from two tabs at once. Transaction
     * scoped, which is what PgBouncer transaction pooling requires.
     */
    @Query(value = "SELECT CAST(pg_advisory_xact_lock(hashtextextended(:lockKey, 0)) AS text)", nativeQuery = true)
    String lockLearnerOnQuiz(@Param("lockKey") String lockKey);

    /** A row with no recorded answers is not an attempt: other writers can create one freely. */
    @Query(value = """
            SELECT COUNT(*)
            FROM activity_log al
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND al.source_type = 'QUIZ'
              AND EXISTS (SELECT 1 FROM quiz_slide_question_tracked t WHERE t.activity_id = al.id)
            """, nativeQuery = true)
    long countQuizAttempts(@Param("userId") String userId, @Param("slideId") String slideId);

    /** One activity row and whether answers are recorded on it. Reads the primary. */
    @Query(value = """
            SELECT al.id AS attemptId,
                   al.user_id AS userId,
                   al.slide_id AS slideId,
                   al.source_type AS sourceType,
                   (SELECT COUNT(*) FROM quiz_slide_question_tracked t WHERE t.activity_id = al.id) AS answerCount
            FROM activity_log al
            WHERE al.id = :attemptId
            """, nativeQuery = true)
    Optional<AttemptStateRow> findAttemptState(@Param("attemptId") String attemptId);

    @Query(value = """
            SELECT s.id AS slideId,
                   s.status AS slideStatus,
                   s.source_type AS sourceType,
                   q.id AS quizId,
                   q.marks_per_question AS marksPerQuestion,
                   q.negative_marking AS negativeMarking,
                   q.pass_percentage AS passPercentage,
                   q.partial_marking AS partialMarking,
                   q.re_attempt_count AS reAttemptCount
            FROM slide s
            JOIN quiz_slide q ON q.id = s.source_id
            WHERE s.id = :slideId
              AND s.source_type = 'QUIZ'
            """, nativeQuery = true)
    Optional<QuizMetaRow> findQuizBySlideId(@Param("slideId") String slideId);

    @Query(value = """
            SELECT q.id AS questionId,
                   q.question_type AS questionType,
                   q.marks AS marks,
                   q.negative_marking AS negativeMarking,
                   q.auto_evaluation_json AS autoEvaluationJson,
                   COALESCE(rtt_text.content, rt_text.content) AS textContent,
                   COALESCE(rtt_exp.content, rt_exp.content) AS explanationContent
            FROM quiz_slide_question q
            LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
            LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id
                 AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
            LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
            LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id
                 AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
            WHERE q.quiz_slide_id = :quizId
              AND q.status = 'ACTIVE'
            ORDER BY q.question_order, q.id
            """, nativeQuery = true)
    List<QuizQuestionRow> findActiveQuestions(@Param("quizId") String quizId, @Param("lang") String lang);

    /**
     * In the order the learner slide queries list options, which is what a positional answer
     * key means. Those queries read a question's options with a subquery per question and
     * state no order, so this reads them the same way rather than naming an order of its own.
     * Row order would not do: editing one option moves its row but not its place in that read.
     */
    @Query(value = """
            SELECT j.value ->> 'id' AS optionId,
                   q.id AS questionId,
                   j.value ->> 'text' AS textContent
            FROM quiz_slide_question q
            CROSS JOIN LATERAL json_array_elements(COALESCE((
                SELECT json_agg(json_build_object('id', o.id, 'text', COALESCE(rtt_text.content, rt_text.content)))
                FROM quiz_slide_question_options o
                LEFT JOIN rich_text_data rt_text ON rt_text.id = o.text_id
                LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id
                     AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                WHERE o.quiz_slide_question_id = q.id
            ), CAST('[]' AS json))) WITH ORDINALITY AS j(value, position)
            WHERE q.quiz_slide_id = :quizId
              AND q.status = 'ACTIVE'
            ORDER BY q.id, j.position
            """, nativeQuery = true)
    List<QuizOptionRow> findOptions(@Param("quizId") String quizId, @Param("lang") String lang);

    /**
     * Live memberships that give this learner this slide. Same membership rule as
     * existsActiveMembership. The package_institute join is what ties the membership to
     * the institute that owns the course.
     */
    @Query(value = """
            SELECT DISTINCT m.institute_id AS instituteId,
                   m.package_session_id AS packageSessionId,
                   cts.chapter_id AS chapterId
            FROM chapter_to_slides cts
            JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cts.chapter_id
            JOIN student_session_institute_group_mapping m ON m.package_session_id = cpsm.package_session_id
            JOIN package_session ps ON ps.id = m.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = m.institute_id
            WHERE cts.slide_id = :slideId
              AND cts.status <> 'DELETED'
              AND cpsm.status <> 'DELETED'
              AND m.user_id = :userId
              AND m.status = 'ACTIVE'
              AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
            """, nativeQuery = true)
    List<SlideMembershipRow> findLiveMemberships(@Param("userId") String userId, @Param("slideId") String slideId);

    /** The institutes whose courses include this slide. */
    @Query(value = """
            SELECT DISTINCT pi.institute_id
            FROM chapter_to_slides cts
            JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cts.chapter_id
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            WHERE cts.slide_id = :slideId
            """, nativeQuery = true)
    List<String> findInstitutesOfSlide(@Param("slideId") String slideId);

    @Query(value = "SELECT setting_json FROM institutes WHERE id = :instituteId", nativeQuery = true)
    Optional<String> findInstituteSettingJson(@Param("instituteId") String instituteId);

    /** Every recorded answer of this learner on this quiz, newest attempt first. */
    @Query(value = """
            SELECT al.id AS attemptId,
                   al.end_time AS endTime,
                   al.created_at AS createdAt,
                   t.question_id AS questionId,
                   t.response_json AS responseJson,
                   t.response_status AS responseStatus
            FROM activity_log al
            LEFT JOIN quiz_slide_question_tracked t ON t.activity_id = al.id
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND al.source_type = 'QUIZ'
            ORDER BY al.created_at DESC, al.id
            """, nativeQuery = true)
    List<RecordedAnswerRow> findRecordedAnswers(@Param("userId") String userId, @Param("slideId") String slideId);

    /** Question slides: the question behind a slide, with its explanation in the learner language. */
    @Query(value = """
            SELECT q.id AS questionId,
                   q.question_type AS questionType,
                   q.auto_evaluation_json AS autoEvaluationJson,
                   COALESCE(rtt_exp.content, rt_exp.content) AS explanationContent
            FROM slide s
            JOIN question_slide q ON q.id = s.source_id
            LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
            LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id
                 AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
            WHERE s.id = :slideId
              AND s.source_type = 'QUESTION'
              AND q.id = :questionId
            """, nativeQuery = true)
    Optional<CheckableQuestionRow> findQuestionSlideQuestion(@Param("slideId") String slideId,
            @Param("questionId") String questionId, @Param("lang") String lang);

    /** Questions set on a video, reached through the video slide they belong to. */
    @Query(value = """
            SELECT q.id AS questionId,
                   q.question_type AS questionType,
                   q.auto_evaluation_json AS autoEvaluationJson,
                   COALESCE(rtt_exp.content, rt_exp.content) AS explanationContent
            FROM slide s
            JOIN video_slide_question q ON q.video_slide_id = s.source_id
            LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
            LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id
                 AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
            WHERE s.id = :slideId
              AND s.source_type = 'VIDEO'
              AND q.id = :questionId
            """, nativeQuery = true)
    Optional<CheckableQuestionRow> findVideoSlideQuestion(@Param("slideId") String slideId,
            @Param("questionId") String questionId, @Param("lang") String lang);

    @Query(value = "SELECT source_type AS sourceType, status AS status FROM slide WHERE id = :slideId", nativeQuery = true)
    Optional<SlideKindRow> findSlideKind(@Param("slideId") String slideId);

    /** The institutes owning this slide, with who created each course that holds it. */
    @Query(value = """
            SELECT DISTINCT pi.institute_id AS instituteId, p.created_by_user_id AS createdByUserId
            FROM chapter_to_slides cts
            JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cts.chapter_id
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            LEFT JOIN package p ON p.id = ps.package_id
            WHERE cts.slide_id = :slideId
            """, nativeQuery = true)
    List<CourseOwnerRow> findOwnersOfSlide(@Param("slideId") String slideId);

    /** As {@link #findOwnersOfSlide}, for a chapter. */
    @Query(value = """
            SELECT DISTINCT pi.institute_id AS instituteId, p.created_by_user_id AS createdByUserId
            FROM chapter_package_session_mapping cpsm
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package_institute pi ON pi.package_id = ps.package_id
            LEFT JOIN package p ON p.id = ps.package_id
            WHERE cpsm.chapter_id = :chapterId
            """, nativeQuery = true)
    List<CourseOwnerRow> findOwnersOfChapter(@Param("chapterId") String chapterId);

    /** As {@link #findOwnersOfSlide}, for a batch. */
    @Query(value = """
            SELECT DISTINCT pi.institute_id AS instituteId, p.created_by_user_id AS createdByUserId
            FROM package_session ps
            JOIN package_institute pi ON pi.package_id = ps.package_id
            LEFT JOIN package p ON p.id = ps.package_id
            WHERE ps.id = :packageSessionId
            """, nativeQuery = true)
    List<CourseOwnerRow> findOwnersOfBatch(@Param("packageSessionId") String packageSessionId);

    interface AttemptStateRow {
        String getAttemptId();
        String getUserId();
        String getSlideId();
        String getSourceType();
        long getAnswerCount();
    }

    interface SlideKindRow {
        String getSourceType();
        String getStatus();
    }

    interface CourseOwnerRow {
        String getInstituteId();
        String getCreatedByUserId();
    }

    interface QuizMetaRow {
        String getSlideId();
        String getSlideStatus();
        String getSourceType();
        String getQuizId();
        Double getMarksPerQuestion();
        Double getNegativeMarking();
        Double getPassPercentage();
        Boolean getPartialMarking();
        Integer getReAttemptCount();
    }

    interface QuizQuestionRow {
        String getQuestionId();
        String getQuestionType();
        Double getMarks();
        Double getNegativeMarking();
        String getAutoEvaluationJson();
        String getTextContent();
        String getExplanationContent();
    }

    interface QuizOptionRow {
        String getOptionId();
        String getQuestionId();
        String getTextContent();
    }

    interface SlideMembershipRow {
        String getInstituteId();
        String getPackageSessionId();
        String getChapterId();
    }

    interface RecordedAnswerRow {
        String getAttemptId();
        java.sql.Timestamp getEndTime();
        java.sql.Timestamp getCreatedAt();
        String getQuestionId();
        String getResponseJson();
        String getResponseStatus();
    }

    interface CheckableQuestionRow {
        String getQuestionId();
        String getQuestionType();
        String getAutoEvaluationJson();
        String getExplanationContent();
    }
}
