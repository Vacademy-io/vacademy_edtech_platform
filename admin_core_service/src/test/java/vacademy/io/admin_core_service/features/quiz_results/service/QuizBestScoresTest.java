package vacademy.io.admin_core_service.features.quiz_results.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer.Verdict;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizQuestionProjection;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizSlideMetaProjection;
import vacademy.io.admin_core_service.features.quiz_results.repository.QuizResultsRepository;
import vacademy.io.admin_core_service.features.quiz_results.repository.QuizResultsRepository.AttemptResponseProjection;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Best-attempt quiz scores for course certificates: every attempt graded on its own by the
 * SERVER, the best one kept, an attempt opened but never answered not counted, and a verdict
 * the client merely claimed never counted as correct.
 */
class QuizBestScoresTest {

    private static final String BATCH = "batch-1";

    private QuizResultsRepository repository;
    private AutoEvaluationScorer scorer;
    private QuizResultsService service;
    private final List<AttemptResponseProjection> responses = new ArrayList<>();
    private final List<QuizQuestionProjection> questions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        repository = mock(QuizResultsRepository.class);
        scorer = mock(AutoEvaluationScorer.class);
        service = new QuizResultsService(repository, scorer);

        QuizSlideMetaProjection meta = mock(QuizSlideMetaProjection.class);
        when(meta.getSlideId()).thenReturn("quiz-1");
        when(meta.getTotalMarks()).thenReturn(4.0);
        when(meta.getPassPercentage()).thenReturn(50.0);
        when(repository.getQuizSlides(eq(BATCH), isNull())).thenReturn(List.of(meta));

        question("q1", "MCQS", "{\"correctAnswers\":[\"q1-A\"]}");
        question("q2", "MCQS", "{\"correctAnswers\":[\"q2-A\"]}");
        when(repository.getQuestions(eq(BATCH), isNull(), anyBoolean())).thenReturn(questions);
        when(repository.getQuestionOptions(eq(BATCH), isNull(), anyBoolean())).thenReturn(List.of());
        when(repository.getAllAttemptResponses(eq(BATCH), any())).thenReturn(responses);

        // The server grader: an answer ending in -A is right, -B wrong, anything else unreadable.
        when(scorer.evaluate(any(), any(), any())).thenAnswer(inv -> {
            String json = inv.getArgument(1);
            if (json == null) return Verdict.UNKNOWN;
            if (json.contains("-A\"")) return Verdict.CORRECT;
            if (json.contains("-B\"")) return Verdict.WRONG;
            return Verdict.UNKNOWN;
        });
        when(scorer.evaluateForQuestionType(any(), any(), any(), any())).thenReturn(Verdict.UNKNOWN);
    }

    private void question(String id, String type, String key) {
        QuizQuestionProjection q = mock(QuizQuestionProjection.class);
        when(q.getSlideId()).thenReturn("quiz-1");
        when(q.getQuestionId()).thenReturn(id);
        when(q.getQuestionType()).thenReturn(type);
        when(q.getAutoEvaluationJson()).thenReturn(key);
        when(q.getMarks()).thenReturn(2.0);
        when(q.getPartialMarking()).thenReturn(false);
        questions.add(q);
    }

    private void answer(String attempt, String user, String questionId, String status, String responseJson) {
        AttemptResponseProjection row = mock(AttemptResponseProjection.class);
        when(row.getActivityId()).thenReturn(attempt);
        when(row.getSlideId()).thenReturn("quiz-1");
        when(row.getUserId()).thenReturn(user);
        when(row.getQuestionId()).thenReturn(questionId);
        when(row.getResponseStatus()).thenReturn(status);
        when(row.getResponseJson()).thenReturn(responseJson);
        responses.add(row);
    }

    private static String pick(String option) {
        return "{\"answer\":\"" + option + "\"}";
    }

    @Test
    void keepsTheBestAttemptAcrossRetries() {
        answer("a1", "u1", "q1", "CORRECT", pick("q1-A"));
        answer("a1", "u1", "q2", "CORRECT", pick("q2-A"));   // 100%
        answer("a2", "u1", "q1", "WRONG", pick("q1-B"));
        answer("a2", "u1", "q2", "WRONG", pick("q2-B"));     // 0% - a later practice retry

        QuizResultsService.QuizBestScore best = service.getBestScores(BATCH, null).get("quiz-1").get("u1");

        assertEquals(100.0, best.bestPercent());
        assertEquals(2, best.attempts());
        assertEquals(50.0, best.passPercentage());
        assertFalse(best.awaitingGrading());
    }

    @Test
    void legacySubmittedAnswersAreGradedByTheServer() {
        answer("a1", "u1", "q1", "SUBMITTED", pick("q1-A"));
        answer("a1", "u1", "q2", "SUBMITTED", pick("q2-B"));

        assertEquals(50.0, service.getBestScores(BATCH, null).get("quiz-1").get("u1").bestPercent());
    }

    @Test
    void aVerdictTheClientOnlyClaimedNeverCountsAsCorrect() {
        // Unreadable answers with a client-written CORRECT: the submit path keeps that status,
        // so a crafted submission could otherwise score 100% and earn a certificate.
        answer("a1", "u1", "q1", "CORRECT", "{\"x\":1}");
        answer("a1", "u1", "q2", "CORRECT", "{\"x\":1}");

        QuizResultsService.QuizBestScore best = service.getBestScores(BATCH, null).get("quiz-1").get("u1");

        assertEquals(0.0, best.bestPercent());
        assertTrue(best.awaitingGrading());
    }

    @Test
    void aServerGradedSpreadsheetVerdictIsTrusted() {
        questions.clear();
        question("q1", "CBE_RESPONSE", "{\"type\":\"CBE_RESPONSE\"}");
        question("q2", "MCQS", "{\"correctAnswers\":[\"q2-A\"]}");
        answer("a1", "u1", "q1", "CORRECT", "{\"parts\":{}}");
        answer("a1", "u1", "q2", "CORRECT", pick("q2-A"));

        assertEquals(100.0, service.getBestScores(BATCH, null).get("quiz-1").get("u1").bestPercent());
    }

    @Test
    void anAttemptWithNoAnswersIsNotAnAttempt() {
        answer("a1", "u1", null, null, null);

        Map<String, Map<String, QuizResultsService.QuizBestScore>> scores = service.getBestScores(BATCH, null);

        assertTrue(scores.isEmpty());
    }

    @Test
    void answersToDeletedQuestionsDoNotScore() {
        answer("a1", "u1", "deleted-question", "CORRECT", pick("deleted-question-A"));
        answer("a1", "u1", "q1", "CORRECT", pick("q1-A"));

        assertEquals(50.0, service.getBestScores(BATCH, null).get("quiz-1").get("u1").bestPercent());
    }

    @Test
    void noQuizzesMeansNoScores() {
        when(repository.getQuizSlides(anyString(), isNull())).thenReturn(List.of());
        assertNull(service.getBestScores(BATCH, "u1").get("quiz-1"));
    }
}
