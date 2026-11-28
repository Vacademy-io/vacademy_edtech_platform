package vacademy.io.admin_core_service.features.learner_tracking.cbe;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;

import java.util.List;
import java.util.Optional;

/**
 * SQL behind the AI check of Spreadsheet &amp; Written Response ({@code CBE_RESPONSE})
 * questions inside quiz slides ({@link QuizCbeGradingService}). Scalar and projection reads
 * plus native updates only, so the open-in-view persistence context never hands back a stale
 * tracked row.
 *
 * <p>Keep apostrophes out of the SQL text below, including comments, and use cast() rather
 * than the double-colon form: Spring Data parses these strings when the service boots.
 */
public interface QuizCbeGradingRepository extends Repository<ActivityLog, String> {

    /**
     * The CBE questions of a quiz with everything grading needs, the secret included.
     * Server side only: nothing here is ever returned to a learner as it stands.
     */
    @Query(value = """
            SELECT q.id AS questionId,
                   q.marks AS marks,
                   q.auto_evaluation_json AS autoEvaluationJson,
                   q.evaluation_secret_json AS evaluationSecretJson,
                   rt_text.content AS textContent,
                   rt_parent.content AS scenarioContent
            FROM quiz_slide_question q
            LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
            LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
            WHERE q.quiz_slide_id = :quizId
              AND q.status = 'ACTIVE'
              AND UPPER(q.question_type) = 'CBE_RESPONSE'
            ORDER BY q.question_order, q.id
            """, nativeQuery = true)
    List<CbeQuizQuestionRow> findCbeQuestions(@Param("quizId") String quizId);

    /** The answers recorded on one attempt. */
    @Query(value = """
            SELECT t.id AS id,
                   t.question_id AS questionId,
                   t.response_json AS responseJson,
                   t.response_status AS responseStatus
            FROM quiz_slide_question_tracked t
            WHERE t.activity_id = :attemptId
            """, nativeQuery = true)
    List<TrackedRow> findRowsOfAttempt(@Param("attemptId") String attemptId);

    @Query(value = "SELECT t.response_json FROM quiz_slide_question_tracked t WHERE t.id = :id", nativeQuery = true)
    Optional<String> findResponseJson(@Param("id") String id);

    @Modifying
    @Query(value = """
            UPDATE quiz_slide_question_tracked
               SET response_json = :responseJson,
                   response_status = :responseStatus
             WHERE id = :id
            """, nativeQuery = true)
    int updateRow(@Param("id") String id, @Param("responseJson") String responseJson,
            @Param("responseStatus") String responseStatus);

    /**
     * AI checks this learner has had on this question of this quiz, across attempts, apart
     * from the row being reserved: graded ones and one still being graded. The state lives in
     * response_json, written by {@link QuizCbeRows} without spaces.
     */
    @Query(value = """
            SELECT COUNT(*)
            FROM quiz_slide_question_tracked t
            JOIN activity_log al ON al.id = t.activity_id
            WHERE al.user_id = :userId
              AND al.slide_id = :slideId
              AND al.source_type = 'QUIZ'
              AND t.question_id = :questionId
              AND t.id <> :excludeRowId
              AND (t.response_json LIKE '%"cbeState":"EVALUATED"%'
                   OR t.response_json LIKE '%"cbeState":"EVALUATING"%')
            """, nativeQuery = true)
    long countChecksUsed(@Param("userId") String userId, @Param("slideId") String slideId,
            @Param("questionId") String questionId, @Param("excludeRowId") String excludeRowId);

    interface CbeQuizQuestionRow {
        String getQuestionId();
        Double getMarks();
        String getAutoEvaluationJson();
        String getEvaluationSecretJson();
        String getTextContent();
        String getScenarioContent();
    }

    interface TrackedRow {
        String getId();
        String getQuestionId();
        String getResponseJson();
        String getResponseStatus();
    }
}
