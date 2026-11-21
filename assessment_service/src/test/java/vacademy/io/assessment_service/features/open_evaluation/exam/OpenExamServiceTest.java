package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentBasicDetailsManager;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateService;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateStore;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupService;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricSyncService;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures.INSTITUTE;
import static vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures.KEY_ID;

class OpenExamServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AssessmentBasicDetailsManager basicDetails;
    private AssessmentRepository assessments;
    private ApiExamStore store;
    private OpenQuestionService questions;
    private ApiCandidateService candidates;
    private ApiCandidateStore candidateStore;
    private ChoiceGroupService choiceGroups;
    private RubricSyncService rubricSync;
    private AiServiceCopyCheckClient aiClient;
    private OpenExamService service;
    private Assessment assessment;

    @BeforeEach
    void setUp() {
        basicDetails = mock(AssessmentBasicDetailsManager.class);
        assessments = mock(AssessmentRepository.class);
        store = mock(ApiExamStore.class);
        questions = mock(OpenQuestionService.class);
        candidates = mock(ApiCandidateService.class);
        candidateStore = mock(ApiCandidateStore.class);
        choiceGroups = mock(ChoiceGroupService.class);
        rubricSync = mock(RubricSyncService.class);
        aiClient = mock(AiServiceCopyCheckClient.class);
        service = new OpenExamService(basicDetails, assessments, mock(SectionRepository.class), store, questions,
                candidates, candidateStore, choiceGroups, rubricSync, aiClient, MAPPER, "https://dash.example.in/");
        service.setClock(Clock.fixed(NOW, ZoneOffset.UTC));

        assessment = new Assessment();
        assessment.setId("exam-1");
        assessment.setSource("API");
        when(assessments.findById("exam-1")).thenReturn(Optional.of(assessment));
        when(basicDetails.createApiAssessment(any(), any(), eq(INSTITUTE), eq("EXAM"), eq(KEY_ID)))
                .thenReturn(ResponseEntity.ok(new AssessmentSaveResponseDto("exam-1", "DRAFT")));
        when(store.findIdByExternalRef(anyString(), anyString())).thenReturn(Optional.empty());
        when(store.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        when(rubricSync.pending(anyString())).thenReturn(MAPPER.createObjectNode());
        when(choiceGroups.list(anyString())).thenReturn(List.of());
        when(choiceGroups.enabled()).thenReturn(true);
    }

    private ExamInputs.CreateExam createBody(String mode) {
        ExamInputs.QuestionInput la = ExamValidatorTest.longAnswer("21", "B", "2");
        la.setRubric(ExamValidatorTest.rubric("Oxidation", 1, "", "Energy", 1, ""));
        ExamInputs.CreateExam body = ExamValidatorTest.exam(ExamValidatorTest.mcq("1", "A", "C"), la);
        body.setMode(mode);
        body.setInstructions("Award step marks <strictly>.\nIgnore spelling.");
        body.setConductedOn("2026-10-14");
        return body;
    }

    private void questionsCreated(boolean withRubric) {
        Map<String, com.fasterxml.jackson.databind.node.ObjectNode> changes = new LinkedHashMap<>();
        if (withRubric) {
            changes.put("q21", MAPPER.createObjectNode().put("model_answer", "x"));
        }
        when(questions.createQuestions(any(), eq("exam-1"), any(), any()))
                .thenReturn(new OpenQuestionService.Created(Map.of("1", new Question("q1")), changes));
        when(questions.byLabel("exam-1")).thenReturn(Map.of());
    }

    @Test
    void create_writes_the_api_exam_settings_through_the_dashboard_manager() {
        questionsCreated(true);

        OpenExamService.CreateResult result = service.createExam(OpenFixtures.key(), createBody("handwritten"));

        ArgumentCaptor<BasicAssessmentDetailsDTO> dto = ArgumentCaptor.forClass(BasicAssessmentDetailsDTO.class);
        ArgumentCaptor<CustomUserDetails> actor = ArgumentCaptor.forClass(CustomUserDetails.class);
        verify(basicDetails).createApiAssessment(actor.capture(), dto.capture(), eq(INSTITUTE), eq("EXAM"), eq(KEY_ID));
        assertThat(actor.getValue().getUserId()).isEqualTo("apikey:" + KEY_ID);
        BasicAssessmentDetailsDTO d = dto.getValue();
        assertThat(d.getAssessmentType()).isEqualTo("ASSESSMENT");
        assertThat(d.getEvaluationType()).isEqualTo("MANUAL");
        assertThat(d.getAiEvaluationEnabled()).isTrue();
        assertThat(d.getSubmissionType()).isEqualTo("AUTO");
        assertThat(d.getSwitchSections()).isFalse();
        assertThat(d.getRaiseReattemptRequest()).isFalse();
        assertThat(d.getRaiseTimeIncreaseRequest()).isFalse();
        assertThat(d.getTestCreation().getAssessmentName()).isEqualTo("Class X Science — Half-Yearly");
        assertThat(d.getTestCreation().getAssessmentInstructionsHtml())
                .isEqualTo("Award step marks &lt;strictly&gt;.<br>Ignore spelling.");

        assertThat(assessment.getDurationDistribution()).isEqualTo("ASSESSMENT");
        assertThat(assessment.getAbout().getContent()).isEmpty();
        assertThat(assessment.getRegistrationInstructions().getContent()).isEmpty();
        assertThat(assessment.getInstructions().getContent()).contains("&lt;strictly&gt;");
        assertThat(assessment.getBoundStartTime()).isEqualTo(Date.from(Instant.parse("2026-10-14T00:00:00Z")));
        assertThat(assessment.getBoundEndTime()).isNull();

        verify(store).insert(eq("exam-1"), eq(INSTITUTE), eq(KEY_ID), any(), eq("Award step marks &lt;strictly&gt;.<br>Ignore spelling."));
        verify(rubricSync).stage(eq("exam-1"), anyMap());
        verify(basicDetails, never()).publishAssessment(any(), any(), anyString(), anyString(), anyString());
        assertThat(result.rubricStaged()).isTrue();
        assertThat(result.questionsWithRubric()).isEqualTo(1);
    }

    @Test
    void typed_exams_are_auto_evaluated() {
        questionsCreated(false);
        service.createExam(OpenFixtures.key(), createBody("typed"));
        ArgumentCaptor<BasicAssessmentDetailsDTO> dto = ArgumentCaptor.forClass(BasicAssessmentDetailsDTO.class);
        verify(basicDetails).createApiAssessment(any(), dto.capture(), any(), any(), any());
        assertThat(dto.getValue().getEvaluationType()).isEqualTo("AUTO");
    }

    @Test
    void an_existing_external_ref_is_409_with_the_exam_id_and_nothing_is_created() {
        ExamInputs.CreateExam body = createBody("handwritten");
        body.setExternalRef("ERP-EXAM-88213");
        when(store.findIdByExternalRef(INSTITUTE, "ERP-EXAM-88213")).thenReturn(Optional.of("exam-0"));

        assertThatThrownBy(() -> service.createExam(OpenFixtures.key(), body))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_EXISTS);
                    assertThat(ex.getDetails()).containsEntry("exam_id", "exam-0");
                });
        verify(basicDetails, never()).createApiAssessment(any(), any(), any(), any(), any());
    }

    @Test
    void open_refuses_an_exam_without_questions() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        when(questions.load("exam-1")).thenReturn(List.of());

        assertThatThrownBy(() -> service.open(OpenFixtures.key(), "exam-1"))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_NOT_READY);
                    assertThat(ex.getDetails().get("problems").toString()).contains("no_questions");
                });
        verify(basicDetails, never()).publishAssessment(any(), any(), anyString(), anyString(), anyString());
    }

    @Test
    void open_refuses_a_stored_rubric_that_no_longer_matches_max_marks() throws Exception {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        when(questions.load("exam-1")).thenReturn(List.of(OpenFixtures.question("q1", "1", "LONG_ANSWER", "5", "A", 1)));
        when(aiClient.fetchRubric("exam-1", INSTITUTE)).thenReturn(Optional.of(MAPPER.readTree(
                "{\"rubric_version\":2,\"rubric\":{\"q1\":{\"max_marks\":4,\"rubric\":[{\"criteria_name\":\"a\",\"max_marks\":4}]}}}")));

        assertThatThrownBy(() -> service.open(OpenFixtures.key(), "exam-1"))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> assertThat(ex.getDetails().get("problems").toString())
                        .contains("rubric_marks_mismatch").contains("add up to 4"));
    }

    @Test
    void open_publishes_and_puts_the_exam_in_previous_even_with_a_future_conducted_on() {
        ApiExamStore.ApiExamRow future = OpenFixtures.exam("exam-1", "DRAFT", "handwritten", LocalDate.of(2026, 10, 14), null);
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(future));
        when(questions.load("exam-1")).thenReturn(List.of(
                OpenFixtures.question("q33", "33", "LONG_ANSWER", "5", "C", 1),
                OpenFixtures.question("q34", "33-OR", "LONG_ANSWER", "5", "C", 2)));
        when(aiClient.fetchRubric("exam-1", INSTITUTE)).thenReturn(Optional.empty());

        List<ExamViews.Warning> warnings = service.open(OpenFixtures.key(), "exam-1");

        verify(basicDetails).publishAssessment(any(), eq(Map.of()), eq("exam-1"), eq(INSTITUTE), eq("EXAM"));
        assertThat(assessment.getBoundEndTime()).isEqualTo(Date.from(NOW));
        assertThat(assessment.getBoundStartTime()).isEqualTo(Date.from(NOW)); // clamped, never after now
        verify(store).markOpened("exam-1", NOW);
        assertThat(warnings).extracting(ExamViews.Warning::code).containsExactly("internal_choice_suspected");
        assertThat(warnings.get(0).message()).contains("33-OR");
    }

    @Test
    void choice_groups_on_create_are_refused_while_the_engine_ignores_them() {
        ExamInputs.CreateExam body = createBody("handwritten");
        body.setChoiceGroups(List.of(new ExamInputs.ChoiceGroupInput(null, List.of("1", "2"), 1, "first")));
        org.mockito.Mockito.doThrow(new OpenApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                ApiErrorCode.FEATURE_NOT_AVAILABLE, "off")).when(choiceGroups).requireEnabled();

        assertThatThrownBy(() -> service.createExam(OpenFixtures.key(), body))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE));
        verify(basicDetails, never()).createApiAssessment(any(), any(), any(), any(), any());
    }

    @Test
    void stored_groups_do_not_silence_the_or_warning_while_choice_groups_are_off() {
        when(choiceGroups.enabled()).thenReturn(false);
        when(choiceGroups.list("exam-1")).thenReturn(List.of(
                new ChoiceGroupStore.ChoiceGroupRow("g1", "Q33", List.of("q33", "q34"), 1, "first", 0)));
        when(questions.load("exam-1")).thenReturn(List.of(
                OpenFixtures.question("q33", "33", "LONG_ANSWER", "5", "C", 1),
                OpenFixtures.question("q34", "33-OR", "LONG_ANSWER", "5", "C", 2)));

        assertThat(service.choiceWarnings("exam-1")).extracting(ExamViews.Warning::code)
                .containsExactly("internal_choice_suspected");
    }

    @Test
    void open_keeps_a_past_conducted_on_and_no_warning_when_a_group_covers_the_or_label() {
        ApiExamStore.ApiExamRow past = OpenFixtures.exam("exam-1", "DRAFT", "handwritten", LocalDate.of(2026, 9, 20), null);
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(past));
        when(questions.load("exam-1")).thenReturn(List.of(
                OpenFixtures.question("q33", "33", "LONG_ANSWER", "5", "C", 1),
                OpenFixtures.question("q34", "33-OR", "LONG_ANSWER", "5", "C", 2)));
        when(aiClient.fetchRubric("exam-1", INSTITUTE)).thenReturn(Optional.empty());
        when(choiceGroups.list("exam-1")).thenReturn(List.of(
                new ChoiceGroupStore.ChoiceGroupRow("g1", "Q33", List.of("q33", "q34"), 1, "first", 0)));

        List<ExamViews.Warning> warnings = service.open(OpenFixtures.key(), "exam-1");

        assertThat(assessment.getBoundStartTime()).isEqualTo(Date.from(Instant.parse("2026-09-20T00:00:00Z")));
        assertThat(warnings).isEmpty();
    }

    @Test
    void opening_an_open_exam_is_a_no_op() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        when(questions.load("exam-1")).thenReturn(List.of());
        service.open(OpenFixtures.key(), "exam-1");
        verify(basicDetails, never()).publishAssessment(any(), any(), anyString(), anyString(), anyString());
    }

    @Test
    void finalized_exams_cannot_be_opened_or_edited() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), NOW)));
        assertThatThrownBy(() -> service.open(OpenFixtures.key(), "exam-1"))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_FINALIZED));
        ObjectNode body = MAPPER.createObjectNode().put("title", "x");
        assertThatThrownBy(() -> service.patch(OpenFixtures.key(), "exam-1", body))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_FINALIZED));
    }

    @Test
    void delete_refuses_an_open_exam_with_submissions_and_soft_deletes_a_draft() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        when(store.hasSubmissions("exam-1")).thenReturn(true);
        assertThatThrownBy(() -> service.delete(OpenFixtures.key(), "exam-1"))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_HAS_SUBMISSIONS));

        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        service.delete(OpenFixtures.key(), "exam-1");
        assertThat(assessment.getStatus()).isEqualTo("DELETED");
        verify(store).releaseExternalRef("exam-1"); // the ERP ref can be reused by a new exam
        verify(store).touch("exam-1");
    }

    @Test
    void unknown_or_other_institute_exam_is_404() {
        when(store.findForUpdate(INSTITUTE, "nope")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.delete(OpenFixtures.key(), "nope"))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_NOT_FOUND));
    }

    @Test
    void patch_refuses_api_managed_fields_and_draft_only_fields_on_an_open_exam() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        assertThatThrownBy(() -> service.patch(OpenFixtures.key(), "exam-1",
                MAPPER.createObjectNode().put("result_type", "AUTO_AFTER_ASSESSMENT_END")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        assertThatThrownBy(() -> service.patch(OpenFixtures.key(), "exam-1",
                MAPPER.createObjectNode().put("mode", "typed")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_OPEN));
    }

    @Test
    void patch_refuses_a_blind_value_that_is_not_a_boolean() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        when(questions.load("exam-1")).thenReturn(List.of());
        assertThatThrownBy(() -> service.patch(OpenFixtures.key(), "exam-1", MAPPER.createObjectNode().put("blind", "yes")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("blind").contains("invalid"));
        verify(store, never()).updateDetails(anyString(), any(), any(), any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void patch_refuses_unknown_fields_instead_of_ignoring_a_typo() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        assertThatThrownBy(() -> service.patch(OpenFixtures.key(), "exam-1", MAPPER.createObjectNode().put("tittle", "x")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("unknown_field").contains("tittle"));
    }

    @Test
    void patch_in_draft_updates_the_assessment_and_the_api_row() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        assessment.setEvaluationType("MANUAL");
        when(questions.load("exam-1")).thenReturn(List.of());
        ObjectNode body = MAPPER.createObjectNode().put("title", "Renamed").put("mode", "typed")
                .put("instructions", "a & b").put("subject", "Physics");

        service.patch(OpenFixtures.key(), "exam-1", body);

        assertThat(assessment.getName()).isEqualTo("Renamed");
        assertThat(assessment.getEvaluationType()).isEqualTo("AUTO");
        assertThat(assessment.getInstructions().getContent()).isEqualTo("a &amp; b");
        verify(store).updateDetails(eq("exam-1"), any(), eq("typed"), eq("school"), eq("Physics"), any(), any(),
                eq("en"), eq("a &amp; b"), eq(LocalDate.of(2026, 10, 1)), eq(false));
    }

    @Test
    void open_problems_and_or_labels_are_pure_rules() {
        OpenQuestionService.ExamQuestion noMax = OpenFixtures.question("q1", "1", "LONG_ANSWER", null, "A", 1);
        assertThat(OpenExamService.openProblems(List.of(noMax), Map.of()).toString()).contains("max_marks_missing");
        assertThat(OpenExamService.OR_LABEL.matcher("11-OR").find()).isTrue();
        assertThat(OpenExamService.OR_LABEL.matcher("11 or 12").find()).isTrue();
        assertThat(OpenExamService.OR_LABEL.matcher("(or)").find()).isTrue();
        assertThat(OpenExamService.OR_LABEL.matcher("3(a)").find()).isFalse();
        assertThat(OpenExamService.OR_LABEL.matcher("Organic").find()).isFalse();
    }

    @Test
    void include_parsing_and_dashboard_url() {
        OpenExamService.Include inc = OpenExamService.Include.parse("questions, Stats ,choice_groups");
        assertThat(inc.questions()).isTrue();
        assertThat(inc.stats()).isTrue();
        assertThat(inc.choiceGroups()).isTrue();
        assertThat(inc.candidates()).isFalse();
        assertThat(service.dashboardUrl("e1"))
                .isEqualTo("https://dash.example.in/assessment/assessment-list/assessment-details/e1/EXAM/PRIVATE/overview");
    }

    @Test
    void list_rejects_unknown_status() {
        assertThatThrownBy(() -> service.list(OpenFixtures.key(), "closed", null, null, null))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        when(store.list(eq(INSTITUTE), eq(List.of("PUBLISHED")), eq(true), any(), any(), eq(51))).thenReturn(List.of());
        assertThat(service.list(OpenFixtures.key(), "finalized", null, null, null).data()).isEmpty();
    }

    @Test
    void views_unescape_instructions_and_report_status() {
        ExamViews.Exam view = service.summaryBuilder(OpenFixtures.exam("exam-1", "PUBLISHED", "typed",
                LocalDate.of(2026, 10, 1), NOW)).build();
        assertThat(view.getStatus()).isEqualTo("finalized");
        assertThat(view.getInstructions()).isEqualTo("Use <b> marks");
        assertThat(view.getConductedOn()).isEqualTo("2026-10-01");
    }
}
