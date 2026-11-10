package vacademy.io.admin_core_service.features.learner_tracking.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.CbeAttemptResponse;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.CbeSubmitRequest;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CbeSlideSubmitServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String SLIDE = "slide-1";
    private static final String USER = "learner-1";

    private static final String FULL = """
            {"type":"CBE_RESPONSE","data":{"version":1,"gradingNotes":"own figure",
              "parts":[{"id":"p_a","label":"(a)","kind":"SPREADSHEET","marks":16,
                        "solution":{"sheet":{"sheets":[{"name":"S","cells":{"B7":{"v":3200}}}]}},
                        "markingScheme":[{"id":"m1","label":"Goodwill","marks":2}],"solutionFileId":"f1"},
                       {"id":"p_b","label":"(b)","kind":"DOCUMENT","marks":4,
                        "solution":{"html":"<p>model</p>"},"markingScheme":[]}]}}
            """;

    private final SlideRepository slides = mock(SlideRepository.class);
    private final QuestionSlideRepository questions = mock(QuestionSlideRepository.class);
    private final QuestionSlideTrackedRepository tracked = mock(QuestionSlideTrackedRepository.class);
    private final ActivityLogRepository logs = mock(ActivityLogRepository.class);
    private final LearnerQuizAttemptRepository locks = mock(LearnerQuizAttemptRepository.class);
    private final LearnerQuizAccessService access = mock(LearnerQuizAccessService.class);
    private final LearnerTrackingAsyncService async = mock(LearnerTrackingAsyncService.class);
    private final CbeGradingClient grader = mock(CbeGradingClient.class);

    private final CbeSlideSubmitService service = new CbeSlideSubmitService(slides, questions, tracked, logs,
            locks, access, async, grader, MAPPER, mock(PlatformTransactionManager.class));

    private final Map<String, QuestionSlideTracked> rows = new HashMap<>();
    private QuestionSlide question;

    @BeforeEach
    void setUp() {
        Slide slide = new Slide();
        slide.setId(SLIDE);
        slide.setSourceType("QUESTION");
        slide.setSourceId("qs-1");
        slide.setStatus("PUBLISHED");
        when(slides.findById(SLIDE)).thenReturn(Optional.of(slide));

        CbeConfigSecrets.Split split = CbeConfigSecrets.split(FULL, null);
        question = new QuestionSlide();
        question.setId("qs-1");
        question.setQuestionType("CBE_RESPONSE");
        question.setAutoEvaluationJson(split.redactedConfig());
        question.setEvaluationSecretJson(split.secret());
        question.setPoints(20);
        RichTextData text = new RichTextData();
        text.setContent("<p>Prepare the consolidated SFP.</p><p>Show workings.</p>");
        question.setTextData(text);
        RichTextData scenario = new RichTextData();
        scenario.setContent("<p>P acquired S.</p><table><tr><td>Cash</td><td>100</td></tr></table>");
        question.setParentRichText(scenario);
        when(questions.findByIdWithText("qs-1")).thenReturn(Optional.of(question));

        when(access.requireAccess(any(), eq(SLIDE), any(), any(), any()))
                .thenReturn(new LearnerQuizAccessService.Access("inst-1", "ps-server", "ch-server"));
        when(logs.saveAndFlush(any(ActivityLog.class))).thenAnswer(i -> i.getArgument(0));
        when(tracked.saveAndFlush(any(QuestionSlideTracked.class))).thenAnswer(i -> {
            QuestionSlideTracked row = i.getArgument(0);
            rows.put(row.getId(), row);
            return row;
        });
        when(tracked.save(any(QuestionSlideTracked.class))).thenAnswer(i -> i.getArgument(0));
        when(tracked.findById(anyString())).thenAnswer(i -> Optional.ofNullable(rows.get(i.<String>getArgument(0))));
    }

    private static CustomUserDetails learner() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(USER);
        dto.setUsername(USER);
        dto.setRootUser(true);
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private static CbeSubmitRequest request() throws Exception {
        CbeSubmitRequest request = new CbeSubmitRequest();
        request.setSlideId(SLIDE);
        request.setChapterId("ch-client");
        request.setModuleId("mod-1");
        request.setSubjectId("sub-1");
        request.setPackageSessionId("ps-client");
        request.setAnswer(MAPPER.readTree("""
                {"parts":{"p_a":{"kind":"SPREADSHEET","sheet":{"sheets":[{"name":"S","cells":{"B7":{"v":3000}}}]}},
                          "p_b":{"kind":"DOCUMENT","html":"<p>my view</p>"}}}
                """));
        return request;
    }

    private static Map<String, Object> evaluation(double marks) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("marks_awarded", marks);
        e.put("max_marks", 20);
        e.put("verdict", "PARTIAL");
        e.put("feedback", "Goodwill missed the impairment.");
        e.put("criteria_breakdown", List.of(Map.of("criteria_name", "(a) Goodwill", "marks", 0, "max_marks", 2)));
        return e;
    }

    private QuestionSlideTracked onlyRow() {
        assertThat(rows).hasSize(1);
        return rows.values().iterator().next();
    }

    @Test
    @DisplayName("success: graded, saved EVALUATED with marks, slide completed, solution returned")
    @SuppressWarnings("unchecked")
    void gradedSubmit() throws Exception {
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(0L);
        when(tracked.countCbeSubmissions(USER, SLIDE)).thenReturn(0L);
        when(grader.grade(any())).thenReturn(evaluation(13.5));

        CbeSlideSubmitService.Outcome outcome = service.submit(request(), learner(), "inst-1");

        assertThat(outcome.httpStatus()).isEqualTo(200);
        CbeAttemptResponse body = outcome.body();
        assertThat(body.getAttemptNumber()).isEqualTo(1);
        assertThat(body.getAttemptsLeft()).isEqualTo(2);
        assertThat(body.getMaxAttempts()).isEqualTo(3);
        assertThat(body.getEvaluation().path("marks_awarded").asDouble()).isEqualTo(13.5);
        assertThat(body.getSolution().at("/parts/0/markingScheme/0/label").asText()).isEqualTo("Goodwill");
        assertThat(body.getSolution().toString()).doesNotContain("own figure", "f1");

        QuestionSlideTracked row = onlyRow();
        assertThat(row.getResponseStatus()).isEqualTo("EVALUATED");
        assertThat(row.getMarks()).isEqualTo(13.5);
        JsonNode stored = MAPPER.readTree(row.getResponseJson());
        assertThat(stored.path("type").asText()).isEqualTo("CBE_RESPONSE");
        assertThat(stored.at("/answer/parts/p_b/html").asText()).isEqualTo("<p>my view</p>");
        assertThat(stored.at("/evaluation/verdict").asText()).isEqualTo("PARTIAL");
        assertThat(row.getActivityLog().getUserId()).isEqualTo(USER);
        assertThat(row.getActivityLog().getSourceType()).isEqualTo("QUESTION");

        // ai_service gets the FULL config (with secrets), plain-text question and scenario
        ArgumentCaptor<Map<String, Object>> sent = ArgumentCaptor.forClass(Map.class);
        verify(grader).grade(sent.capture());
        Map<String, Object> call = sent.getValue();
        assertThat(call).containsEntry("institute_id", "inst-1").containsEntry("user_id", USER)
                .containsEntry("source_id", SLIDE).containsEntry("max_marks", 20.0);
        assertThat(call.get("config").toString()).contains("3200", "own figure", "markingScheme");
        assertThat(call.get("question_text")).isEqualTo("Prepare the consolidated SFP.\nShow workings.");
        assertThat(call.get("scenario_text")).isEqualTo("P acquired S.\nCash | 100");

        // completion cascade on the existing path, with the server-chosen batch/chapter
        verify(async).updateLearnerOperationsForQuestion(eq(USER), eq(SLIDE), eq("ch-server"), eq("mod-1"),
                eq("sub-1"), eq("ps-server"), any());
        verify(locks).lockLearnerOnQuiz("cbe-attempt|" + USER + "|" + SLIDE);
    }

    @Test
    @DisplayName("402: answer saved ungraded, 402 returned, attempt not used, slide still completed")
    void noCredits() throws Exception {
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(1L);
        when(tracked.countCbeSubmissions(USER, SLIDE)).thenReturn(1L);
        when(grader.grade(any())).thenThrow(new CbeGradingClient.NoCreditsException("out"));

        CbeSlideSubmitService.Outcome outcome = service.submit(request(), learner(), "inst-1");

        assertThat(outcome.httpStatus()).isEqualTo(402);
        assertThat(outcome.body().getEvaluation()).isNull();
        assertThat(outcome.body().getErrorCode()).isEqualTo("NO_CREDITS");
        assertThat(outcome.body().getAttemptNumber()).isEqualTo(2);
        assertThat(outcome.body().getAttemptsLeft()).isEqualTo(2);
        assertThat(outcome.body().getSolution()).isNotNull();
        QuestionSlideTracked row = onlyRow();
        assertThat(row.getResponseStatus()).isEqualTo("EVALUATION_FAILED");
        assertThat(row.getMarks()).isNull();
        JsonNode stored = MAPPER.readTree(row.getResponseJson());
        assertThat(stored.path("error").asText()).isEqualTo("NO_CREDITS");
        assertThat(stored.at("/answer/parts/p_a/kind").asText()).isEqualTo("SPREADSHEET");
        verify(async).updateLearnerOperationsForQuestion(eq(USER), eq(SLIDE), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("ai_service failure: answer saved as EVALUATION_FAILED, 200 with evaluation null and a message")
    void gradingFails() throws Exception {
        when(grader.grade(any())).thenThrow(new CbeGradingClient.GradingFailedException("boom", null));

        CbeSlideSubmitService.Outcome outcome = service.submit(request(), learner(), "inst-1");

        assertThat(outcome.httpStatus()).isEqualTo(200);
        assertThat(outcome.body().getEvaluation()).isNull();
        assertThat(outcome.body().getMessage()).isNotBlank();
        assertThat(outcome.body().getErrorCode()).isEqualTo("EVALUATION_FAILED");
        assertThat(outcome.body().getAttemptsLeft()).isEqualTo(3);
        assertThat(onlyRow().getResponseStatus()).isEqualTo("EVALUATION_FAILED");
    }

    @Test
    @DisplayName("attempts: 3 by default; 409 once used up, before any AI call or write")
    void defaultCapExhausted() {
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(3L);

        assertThatThrownBy(() -> service.submit(request(), learner(), "inst-1"))
                .isInstanceOf(ConflictException.class);
        verify(grader, never()).grade(any());
        verify(logs, never()).saveAndFlush(any());
        verify(tracked, never()).saveAndFlush(any());
        verify(async, never()).updateLearnerOperationsForQuestion(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("attempts: re_attempt_count > 0 overrides the default")
    void configuredCap() throws Exception {
        question.setReAttemptCount(5);
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(3L);
        when(tracked.countCbeSubmissions(USER, SLIDE)).thenReturn(3L);
        when(grader.grade(any())).thenReturn(evaluation(20));

        CbeSlideSubmitService.Outcome outcome = service.submit(request(), learner(), "inst-1");
        assertThat(outcome.body().getMaxAttempts()).isEqualTo(5);
        assertThat(outcome.body().getAttemptsLeft()).isEqualTo(1);

        question.setReAttemptCount(1);
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(1L);
        assertThatThrownBy(() -> service.submit(request(), learner(), "inst-1"))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("not enrolled: refused before anything is written")
    void notEnrolled() {
        when(access.requireAccess(any(), eq(SLIDE), any(), any(), any()))
                .thenThrow(new ForbiddenException("NOT_ENROLLED"));
        assertThatThrownBy(() -> service.submit(request(), learner(), "inst-1"))
                .isInstanceOf(ForbiddenException.class);
        verify(tracked, never()).saveAndFlush(any());
        verify(grader, never()).grade(any());
    }

    @Test
    @DisplayName("a non-CBE question slide, or an unpublished one, is refused")
    void wrongSlide() throws Exception {
        question.setQuestionType("MCQS");
        question.setAutoEvaluationJson("{\"type\":\"MCQS\"}");
        assertThatThrownBy(() -> service.submit(request(), learner(), "inst-1"))
                .isInstanceOf(InvalidRequestException.class);

        question.setQuestionType("CBE_RESPONSE");
        slides.findById(SLIDE).orElseThrow().setStatus("DRAFT");
        assertThatThrownBy(() -> service.submit(request(), learner(), "inst-1"))
                .isInstanceOf(vacademy.io.common.exceptions.ResourceNotFoundException.class);
        verify(grader, never()).grade(any());
    }

    @Test
    @DisplayName("identity comes from the token: no token, no submit")
    void noToken() {
        assertThatThrownBy(() -> service.submit(request(), null, "inst-1"))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("my-attempts: latest attempt and counts; solution only after a submission")
    void myAttempts() {
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(0L);
        when(tracked.countCbeSubmissions(USER, SLIDE)).thenReturn(0L);
        when(tracked.findLatestCbeSubmission(USER, SLIDE)).thenReturn(Optional.empty());

        CbeAttemptResponse none = service.myAttempts(SLIDE, learner());
        assertThat(none.getSolution()).isNull();
        assertThat(none.getAttemptsLeft()).isEqualTo(3);
        assertThat(none.getResponseStatus()).isNull();

        QuestionSlideTracked latest = new QuestionSlideTracked();
        latest.setId("t1");
        latest.setAttemptNumber(2);
        latest.setResponseStatus("EVALUATED");
        latest.setMarks(18.0);
        latest.setResponseJson("{\"type\":\"CBE_RESPONSE\",\"answer\":{\"parts\":{}},"
                + "\"evaluation\":{\"marks_awarded\":18}}");
        when(tracked.countCbeChecksUsed(USER, SLIDE)).thenReturn(2L);
        when(tracked.countCbeSubmissions(USER, SLIDE)).thenReturn(2L);
        when(tracked.findLatestCbeSubmission(USER, SLIDE)).thenReturn(Optional.of(latest));

        CbeAttemptResponse some = service.myAttempts(SLIDE, learner());
        assertThat(some.getAttemptNumber()).isEqualTo(2);
        assertThat(some.getAttemptsUsed()).isEqualTo(2);
        assertThat(some.getAttemptsLeft()).isEqualTo(1);
        assertThat(some.getEvaluation().path("marks_awarded").asInt()).isEqualTo(18);
        assertThat(some.getAnswer().has("parts")).isTrue();
        assertThat(some.getSolution().at("/parts/1/solution/html").asText()).isEqualTo("<p>model</p>");
        verify(access, never()).requireAccess(any(), anyString(), isNull(), any(), any());
    }
}
