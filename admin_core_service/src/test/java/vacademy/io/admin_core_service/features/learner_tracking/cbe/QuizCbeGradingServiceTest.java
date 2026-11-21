package vacademy.io.admin_core_service.features.learner_tracking.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.AttemptStateRow;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.QuizMetaRow;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizReviewPolicy;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.QuizCbeGradingRepository.CbeQuizQuestionRow;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.QuizCbeGradingRepository.TrackedRow;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.QuizCbeGradeRequest;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.QuizCbeGradeResponse;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class QuizCbeGradingServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String SLIDE = "slide-q";
    private static final String QUIZ = "quiz-1";
    private static final String ATTEMPT = "11111111-2222-3333-4444-555555555555";
    private static final String USER = "learner-1";
    private static final String QUESTION = "q-cbe";
    private static final String ROW = "row-cbe";

    private static final String FULL = """
            {"type":"CBE_RESPONSE","data":{"version":1,"gradingNotes":"own figure",
              "parts":[{"id":"p_a","label":"(a)","kind":"SPREADSHEET","marks":10,
                        "solution":{"sheet":{"sheets":[{"name":"S","cells":{"B7":{"v":3200}}}]}},
                        "markingScheme":[{"id":"m1","label":"Goodwill","marks":10}]}]}}
            """;
    private static final String ANSWER = """
            {"parts":{"p_a":{"kind":"SPREADSHEET","sheet":{"sheets":[{"name":"S","cells":{"B7":{"v":3000}}}]}}}}
            """;

    private final QuizCbeGradingRepository repository = mock(QuizCbeGradingRepository.class);
    private final LearnerQuizAttemptRepository quizRepository = mock(LearnerQuizAttemptRepository.class);
    private final LearnerQuizAccessService access = mock(LearnerQuizAccessService.class);
    private final QuizReviewPolicy policy = mock(QuizReviewPolicy.class);
    private final CbeGradingClient grader = mock(CbeGradingClient.class);

    private final QuizCbeGradingService service = new QuizCbeGradingService(repository, quizRepository, access,
            policy, grader, MAPPER, mock(PlatformTransactionManager.class));

    /** The tracked row as the database holds it, updated by the service's native updates. */
    private final Map<String, String[]> db = new HashMap<>();

    @BeforeEach
    void setUp() throws Exception {
        AttemptStateRow attempt = mock(AttemptStateRow.class);
        when(attempt.getUserId()).thenReturn(USER);
        when(attempt.getSlideId()).thenReturn(SLIDE);
        when(attempt.getSourceType()).thenReturn("QUIZ");
        when(attempt.getAnswerCount()).thenReturn(2L);
        when(quizRepository.findAttemptState(ATTEMPT)).thenReturn(Optional.of(attempt));

        QuizMetaRow meta = mock(QuizMetaRow.class);
        when(meta.getQuizId()).thenReturn(QUIZ);
        when(meta.getMarksPerQuestion()).thenReturn(1.0);
        when(meta.getReAttemptCount()).thenReturn(null);
        when(quizRepository.findQuizBySlideId(SLIDE)).thenReturn(Optional.of(meta));

        CbeConfigSecrets.Split split = CbeConfigSecrets.split(FULL, null);
        CbeQuizQuestionRow question = mock(CbeQuizQuestionRow.class);
        when(question.getQuestionId()).thenReturn(QUESTION);
        when(question.getMarks()).thenReturn(10.0);
        when(question.getAutoEvaluationJson()).thenReturn(split.redactedConfig());
        when(question.getEvaluationSecretJson()).thenReturn(split.secret());
        when(question.getTextContent()).thenReturn("<p>Prepare the SFP.</p>");
        when(question.getScenarioContent()).thenReturn("<p>P acquired S.</p>");
        when(repository.findCbeQuestions(QUIZ)).thenReturn(List.of(question));

        String pending = QuizCbeRows.pending("{\"questionName\":\"SFP\"}", MAPPER.readTree(ANSWER), 10.0).toString();
        db.put(ROW, new String[] {pending, "SUBMITTED"});
        when(repository.findRowsOfAttempt(ATTEMPT)).thenAnswer(i -> List.of(row(ROW, QUESTION)));
        when(repository.findResponseJson(anyString())).thenAnswer(i ->
                Optional.ofNullable(db.get(i.<String>getArgument(0))).map(r -> r[0]));
        when(repository.updateRow(anyString(), anyString(), anyString())).thenAnswer(i -> {
            db.put(i.getArgument(0), new String[] {i.getArgument(1), i.getArgument(2)});
            return 1;
        });

        when(access.requireAccess(any(), eq(SLIDE), any(), any(), any()))
                .thenReturn(new LearnerQuizAccessService.Access("inst-1", "ps-1", "ch-1"));
        when(policy.settingsOf("inst-1")).thenReturn(new QuizReviewPolicy.QuizSettings(true, false));
        when(policy.mayShowAnswers(any(), anyInt(), any())).thenReturn(false);
        when(quizRepository.countQuizAttempts(USER, SLIDE)).thenReturn(1L);
    }

    private TrackedRow row(String id, String questionId) {
        TrackedRow row = mock(TrackedRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getQuestionId()).thenReturn(questionId);
        when(row.getResponseJson()).thenAnswer(i -> db.get(id)[0]);
        when(row.getResponseStatus()).thenAnswer(i -> db.get(id)[1]);
        return row;
    }

    private static CustomUserDetails learner(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setRootUser(true);
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private static QuizCbeGradeRequest request() {
        QuizCbeGradeRequest request = new QuizCbeGradeRequest();
        request.setSlideId(SLIDE);
        request.setAttemptId(ATTEMPT);
        return request;
    }

    private static Map<String, Object> evaluation(double marks) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("marks_awarded", marks);
        e.put("max_marks", 10);
        e.put("verdict", "PARTIAL");
        e.put("feedback", "Goodwill is off by 200.");
        e.put("criteria_breakdown", List.of(Map.of("criteria_name", "(a) Goodwill", "marks", marks,
                "max_marks", 10, "reason", "W4 wrong")));
        e.put("credits_charged", 3);
        e.put("confidence", 0.8);
        return e;
    }

    private JsonNode stored() throws Exception {
        return MAPPER.readTree(db.get(ROW)[0]);
    }

    @Test
    @DisplayName("a pending answer is graded once: marks, verdict and feedback are recorded on the attempt")
    void gradesPendingAnswer() throws Exception {
        when(grader.grade(any())).thenReturn(evaluation(7.5));

        QuizCbeGradeResponse response = service.grade(request(), learner(USER), "inst-1");

        assertThat(response.getQuestions()).hasSize(1);
        QuizCbeGradeResponse.Question q = response.getQuestions().get(0);
        assertThat(q.getState()).isEqualTo("EVALUATED");
        assertThat(q.getMarks()).isEqualTo(7.5);
        assertThat(q.getMaxMarks()).isEqualTo(10.0);
        assertThat(q.getResponseStatus()).isEqualTo("WRONG");
        assertThat(q.getEvaluation().path("feedback").asText()).isEqualTo("Goodwill is off by 200.");
        // Billing and model internals never reach the learner or the row.
        assertThat(q.getEvaluation().has("credits_charged")).isFalse();
        assertThat(q.getSolution()).isNull();

        JsonNode row = stored();
        assertThat(row.path("cbeState").asText()).isEqualTo("EVALUATED");
        assertThat(row.path("marks").asDouble()).isEqualTo(7.5);
        assertThat(row.path("isPartial").asBoolean()).isTrue();
        assertThat(row.path("evaluation").has("confidence")).isFalse();
        assertThat(row.has("cbeStartedAt")).isFalse();
        assertThat(db.get(ROW)[1]).isEqualTo("WRONG");

        // The grader got the full config (with the solution) and the learner's answer.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(grader).grade(body.capture());
        assertThat(body.getValue().get("institute_id")).isEqualTo("inst-1");
        assertThat(body.getValue().get("max_marks")).isEqualTo(10.0);
        assertThat(body.getValue().get("config").toString()).contains("\"solution\"");
        assertThat(body.getValue().get("answer").toString()).contains("3000");
    }

    @Test
    @DisplayName("full marks record CORRECT")
    void fullMarksAreCorrect() throws Exception {
        when(grader.grade(any())).thenReturn(evaluation(10));

        service.grade(request(), learner(USER), "inst-1");

        assertThat(db.get(ROW)[1]).isEqualTo("CORRECT");
        assertThat(stored().path("isCorrect").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("an answer already graded is returned as it is, without a second AI call")
    void gradedAnswerIsNotGradedAgain() throws Exception {
        when(grader.grade(any())).thenReturn(evaluation(6));
        service.grade(request(), learner(USER), "inst-1");

        QuizCbeGradeResponse again = service.grade(request(), learner(USER), "inst-1");

        verify(grader, org.mockito.Mockito.times(1)).grade(any());
        assertThat(again.getQuestions().get(0).getMarks()).isEqualTo(6.0);
        assertThat(again.getQuestions().get(0).getState()).isEqualTo("EVALUATED");
    }

    @Test
    @DisplayName("out of credits: the answer stays ungraded with NO_CREDITS and is tried again next time")
    void noCreditsKeepsAnswerForRetry() throws Exception {
        when(grader.grade(any())).thenThrow(new CbeGradingClient.NoCreditsException("none"));

        QuizCbeGradeResponse response = service.grade(request(), learner(USER), "inst-1");

        QuizCbeGradeResponse.Question q = response.getQuestions().get(0);
        assertThat(q.getState()).isEqualTo("FAILED");
        assertThat(q.getErrorCode()).isEqualTo("NO_CREDITS");
        assertThat(q.getMarks()).isEqualTo(0.0);
        assertThat(db.get(ROW)[1]).isEqualTo("SUBMITTED");
        assertThat(stored().path("answer").isObject()).isTrue();

        org.mockito.Mockito.doReturn(evaluation(4)).when(grader).grade(any());
        QuizCbeGradeResponse retried = service.grade(request(), learner(USER), "inst-1");
        assertThat(retried.getQuestions().get(0).getState()).isEqualTo("EVALUATED");
        assertThat(retried.getQuestions().get(0).getMarks()).isEqualTo(4.0);
    }

    @Test
    @DisplayName("an unlimited quiz allows 3 AI checks per question; past that the answer is not graded")
    void checksAreCapped() throws Exception {
        when(repository.countChecksUsed(USER, SLIDE, QUESTION, ROW)).thenReturn(3L);

        QuizCbeGradeResponse response = service.grade(request(), learner(USER), "inst-1");

        verify(grader, never()).grade(any());
        assertThat(response.getQuestions().get(0).getState()).isEqualTo("NO_CHECKS_LEFT");
        assertThat(response.getQuestions().get(0).getMaxChecks()).isEqualTo(3);
        assertThat(db.get(ROW)[1]).isEqualTo("SUBMITTED");
    }

    @Test
    @DisplayName("the starting template only: not graded, not charged, recorded as skipped")
    void unattemptedIsSkipped() throws Exception {
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("verdict", "UNATTEMPTED");
        reply.put("marks_awarded", 0);
        when(grader.grade(any())).thenReturn(reply);

        QuizCbeGradeResponse response = service.grade(request(), learner(USER), "inst-1");

        assertThat(response.getQuestions().get(0).getState()).isEqualTo("UNATTEMPTED");
        assertThat(db.get(ROW)[1]).isEqualTo("SKIPPED");
    }

    @Test
    @DisplayName("a check another call started a moment ago is left to finish")
    void runningCheckIsLeftAlone() throws Exception {
        com.fasterxml.jackson.databind.node.ObjectNode row = (com.fasterxml.jackson.databind.node.ObjectNode) stored();
        row.put("cbeState", "EVALUATING");
        row.put("cbeStartedAt", System.currentTimeMillis());
        db.put(ROW, new String[] {row.toString(), "SUBMITTED"});

        QuizCbeGradeResponse response = service.grade(request(), learner(USER), "inst-1");

        verify(grader, never()).grade(any());
        assertThat(response.getQuestions().get(0).getState()).isEqualTo("EVALUATING");
    }

    @Test
    @DisplayName("another learner cannot grade or read an attempt")
    void foreignAttemptIsRefused() {
        assertThatThrownBy(() -> service.grade(request(), learner("someone-else"), "inst-1"))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.results(SLIDE, ATTEMPT, learner("someone-else"), "inst-1"))
                .isInstanceOf(ForbiddenException.class);
        verify(grader, never()).grade(any());
    }

    @Test
    @DisplayName("solutions come back only when the quiz review may show answers")
    void solutionFollowsReviewPolicy() throws Exception {
        when(grader.grade(any())).thenReturn(evaluation(5));
        when(policy.mayShowAnswers(any(), anyInt(), any())).thenReturn(true);

        QuizCbeGradeResponse response = service.grade(request(), learner(USER), "inst-1");

        assertThat(response.isShowSolutions()).isTrue();
        JsonNode solution = response.getQuestions().get(0).getSolution();
        assertThat(solution.path("parts").get(0).path("markingScheme").get(0).path("label").asText())
                .isEqualTo("Goodwill");
        // The grading notes stay with staff.
        assertThat(solution.toString()).doesNotContain("own figure");
    }

    @Test
    @DisplayName("results read the learner's own answer back and grade nothing")
    void resultsGradeNothing() {
        QuizCbeGradeResponse response = service.results(SLIDE, ATTEMPT, learner(USER), "inst-1");

        verify(grader, never()).grade(any());
        assertThat(response.getQuestions().get(0).getState()).isEqualTo("PENDING");
        assertThat(response.getQuestions().get(0).getAnswer().toString()).contains("3000");
    }

    @Test
    @DisplayName("marks out of the parts total scale to the question's own marks")
    void scalesMarks() {
        assertThat(QuizCbeGradingService.scaledMarks(5.0, 10, 20)).isEqualTo(10.0);
        assertThat(QuizCbeGradingService.scaledMarks(12.0, 10, 10)).isEqualTo(10.0);
        assertThat(QuizCbeGradingService.scaledMarks(-1.0, 10, 10)).isEqualTo(0.0);
        assertThat(QuizCbeGradingService.scaledMarks(null, 10, 10)).isEqualTo(0.0);
        assertThat(QuizCbeGradingService.maxChecks(null)).isEqualTo(3);
        assertThat(QuizCbeGradingService.maxChecks(5)).isEqualTo(5);
    }
}
