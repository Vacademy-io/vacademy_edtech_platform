package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AddQuestionsAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentLinkQuestionsManager;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.evaluation.service.QuestionEvaluationService;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricSyncService;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;

import java.time.LocalDate;
import java.util.ArrayList;
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

class OpenQuestionServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AssessmentLinkQuestionsManager linkManager;
    private QuestionRepository questionRepository;
    private QuestionAssessmentSectionMappingRepository mappings;
    private ApiExamStore store;
    private ChoiceGroupStore choiceGroupStore;
    private RubricSyncService rubricSync;
    private EntityManager entityManager;
    private OpenQuestionService service;
    private final List<QuestionAssessmentSectionMapping> linked = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        QuestionEvaluationService evaluation = new QuestionEvaluationService();
        ReflectionTestUtils.setField(evaluation, "objectMapper", MAPPER);
        AddQuestionPaperFromImportManager importManager = new AddQuestionPaperFromImportManager();
        ReflectionTestUtils.setField(importManager, "questionEvaluationService", evaluation);
        linkManager = mock(AssessmentLinkQuestionsManager.class);
        questionRepository = mock(QuestionRepository.class);
        mappings = mock(QuestionAssessmentSectionMappingRepository.class);
        store = mock(ApiExamStore.class);
        choiceGroupStore = mock(ChoiceGroupStore.class);
        rubricSync = mock(RubricSyncService.class);
        entityManager = mock(EntityManager.class);
        TypedQuery<Section> sectionQuery = mock(TypedQuery.class);
        when(entityManager.createQuery(anyString(), eq(Section.class))).thenReturn(sectionQuery);
        when(sectionQuery.setParameter(anyString(), any())).thenReturn(sectionQuery);
        when(sectionQuery.getResultList()).thenReturn(List.of());
        when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("exam-1")).thenReturn(linked);
        when(questionRepository.saveAll(any())).thenAnswer(inv -> {
            int i = 0;
            for (Question q : (Iterable<Question>) inv.getArgument(0)) {
                q.setId("q-" + (++i));
            }
            return inv.getArgument(0);
        });
        service = new OpenQuestionService(importManager, linkManager, questionRepository, mock(OptionRepository.class),
                mappings, mock(SectionRepository.class), store, choiceGroupStore, rubricSync, MAPPER);
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
    }

    private static List<ExamValidator.ValidatedQuestion> validated(String mode, ExamInputs.QuestionInput... qs) {
        ExamInputs.CreateExam e = ExamValidatorTest.exam(qs);
        e.setMode(mode);
        return ExamValidator.validateCreate(e, LocalDate.of(2026, 10, 1)).questions();
    }

    @Test
    void create_links_new_sections_with_marking_json_and_stages_rubrics() throws Exception {
        ExamInputs.QuestionInput la = ExamValidatorTest.longAnswer("21", "B", "2");
        la.setModelAnswer("Energy is released.");
        la.setRubric(ExamValidatorTest.rubric("Oxidation", 1, "", "Energy", 1, ""));
        List<ExamValidator.ValidatedQuestion> qs = validated("handwritten", ExamValidatorTest.mcq("1", "A", "C"), la);

        OpenQuestionService.Created created = service.createQuestions(OpenFixtures.key(), "exam-1", qs,
                List.of(new ExamInputs.SectionInput("A", 1), new ExamInputs.SectionInput("B", 2)));

        ArgumentCaptor<AddQuestionsAssessmentDetailsDTO> request = ArgumentCaptor.forClass(AddQuestionsAssessmentDetailsDTO.class);
        verify(linkManager).saveQuestionsToAssessment(any(), request.capture(), eq("exam-1"), eq(INSTITUTE), eq("EXAM"));
        AddQuestionsAssessmentDetailsDTO dto = request.getValue();
        assertThat(dto.getUpdatedSections()).isEmpty();
        assertThat(dto.getAddedSections()).extracting(s -> s.getSectionName()).containsExactly("A", "B");
        assertThat(dto.getAddedSections()).extracting(s -> s.getSectionOrder()).containsExactly(1, 2);
        var marking = dto.getAddedSections().get(1).getQuestionAndMarking().get(0);
        assertThat(marking.getIsAdded()).isTrue();
        assertThat(marking.getIsDeleted()).isFalse();
        assertThat(marking.getIsUpdated()).isFalse();
        assertThat(QuestionMapper.totalMark(marking.getMarkingJson())).isEqualTo(2.0);
        assertThat(dto.getAddedSections().get(1).getTotalMarks()).isEqualTo(2.0);

        Question mcq = created.byLabel().get("1");
        assertThat(mcq.getInstituteId()).isEqualTo(INSTITUTE);
        assertThat(created.rubricChanges()).containsOnlyKeys(created.byLabel().get("21").getId());
        ObjectNode change = created.rubricChanges().get(created.byLabel().get("21").getId());
        assertThat(change.path("model_answer").asText()).isEqualTo("Energy is released.");
        assertThat(change.path("rubric").path("rubric").get(0).path("criteria_name").asText()).isEqualTo("Oxidation");
        assertThat(change.path("rubric").path("max_marks").asDouble()).isEqualTo(2.0);
    }

    @Test
    void adding_questions_after_open_is_409_exam_open() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        ExamInputs.AddQuestions body = new ExamInputs.AddQuestions();
        body.setQuestions(List.of(ExamValidatorTest.mcq("2", null, "A")));
        assertThatThrownBy(() -> service.addQuestions(OpenFixtures.key(), "exam-1", body))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_OPEN));
        verify(linkManager, never()).saveQuestionsToAssessment(any(), any(), anyString(), anyString(), anyString());
    }

    @Test
    void added_labels_must_not_clash_with_existing_ones() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        linked.add(OpenFixtures.question("q1", "1", "MCQS", "1", "A", 1).mapping());
        ExamInputs.AddQuestions body = new ExamInputs.AddQuestions();
        body.setQuestions(List.of(ExamValidatorTest.mcq("1", null, "A")));
        assertThatThrownBy(() -> service.addQuestions(OpenFixtures.key(), "exam-1", body))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("questions[0].label").contains("duplicate"));
    }

    @Test
    void patch_after_open_allows_text_and_rubric_but_not_structure() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        linked.add(OpenFixtures.question("q1", "1", "LONG_ANSWER", "5", "A", 1).mapping());

        assertThatThrownBy(() -> service.patchQuestion(OpenFixtures.key(), "exam-1", "q1",
                MAPPER.createObjectNode().put("max_marks", 6)))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_OPEN);
                    assertThat(ex.getDetails().get("fields").toString()).contains("max_marks");
                });
        assertThatThrownBy(() -> service.patchQuestion(OpenFixtures.key(), "exam-1", "q1",
                MAPPER.createObjectNode().put("type", "numeric")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        assertThatThrownBy(() -> service.patchQuestion(OpenFixtures.key(), "exam-1", "nope",
                MAPPER.createObjectNode().put("text", "x")))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.QUESTION_NOT_FOUND));
    }

    @Test
    void unknown_question_fields_are_refused() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        linked.add(OpenFixtures.question("q1", "1", "LONG_ANSWER", "5", "A", 1).mapping());
        assertThatThrownBy(() -> service.patchQuestion(OpenFixtures.key(), "exam-1", "q1",
                MAPPER.createObjectNode().put("maxmarks", 4)))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("unknown_field"));
    }

    @Test
    void text_change_after_open_bumps_the_rubric_version_and_is_escaped() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        OpenQuestionService.ExamQuestion eq = OpenFixtures.question("q1", "1", "LONG_ANSWER", "5", "A", 1);
        eq.question().setTextData(new vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData(
                "t1", "HTML", "old"));
        linked.add(eq.mapping());

        OpenQuestionService.Patched patched = service.patchQuestion(OpenFixtures.key(), "exam-1", "q1",
                MAPPER.createObjectNode().put("text", "Explain a < b"));

        assertThat(eq.question().getTextData().getContent()).isEqualTo("Explain a &lt; b");
        assertThat(patched.question().getText()).isEqualTo("Explain a < b");
        assertThat(patched.rubricStaged()).isTrue();
        verify(rubricSync).stage(eq("exam-1"), anyMap());
    }

    @Test
    void patch_rubric_is_validated_against_max_marks_and_staged_in_engine_shape() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        OpenQuestionService.ExamQuestion eq = OpenFixtures.question("q1", "1", "LONG_ANSWER", "2", "A", 1);
        eq.question().setTextData(new vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData(
                "t1", "HTML", "Why?"));
        linked.add(eq.mapping());

        ObjectNode bad = MAPPER.createObjectNode();
        bad.putObject("rubric").putArray("criteria").addObject().put("name", "A").put("marks", 3);
        assertThatThrownBy(() -> service.patchQuestion(OpenFixtures.key(), "exam-1", "q1", bad))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.RUBRIC_MARKS_MISMATCH));

        ObjectNode good = MAPPER.createObjectNode();
        good.putObject("rubric").putArray("criteria").addObject().put("name", "A").put("marks", 2);
        OpenQuestionService.Patched patched = service.patchQuestion(OpenFixtures.key(), "exam-1", "q1", good);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, ObjectNode>> staged = ArgumentCaptor.forClass(Map.class);
        verify(rubricSync).stage(eq("exam-1"), staged.capture());
        assertThat(staged.getValue().get("q1").path("rubric").path("rubric").get(0).path("criteria_name").asText())
                .isEqualTo("A");
        assertThat(patched.question().getRubric()).containsKey("criteria");
        assertThat(eq.question().getSourceMeta()).contains("\"rubric_source\":\"partner\"");
    }

    @Test
    void a_grouped_question_cannot_be_deleted() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        linked.add(OpenFixtures.question("q1", "33", "LONG_ANSWER", "5", "A", 1).mapping());
        when(choiceGroupStore.isQuestionGrouped("exam-1", "q1")).thenReturn(true);
        assertThatThrownBy(() -> service.deleteQuestion(OpenFixtures.key(), "exam-1", "q1"))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getDetails().toString()).contains("in_choice_group"));
    }

    @Test
    void delete_unlinks_through_the_manager_and_clears_the_store_entry() {
        when(store.findForUpdate(INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        OpenQuestionService.ExamQuestion eq = OpenFixtures.question("q1", "1", "LONG_ANSWER", "5", "A", 1);
        linked.add(eq.mapping());

        service.deleteQuestion(OpenFixtures.key(), "exam-1", "q1");

        ArgumentCaptor<AddQuestionsAssessmentDetailsDTO> request = ArgumentCaptor.forClass(AddQuestionsAssessmentDetailsDTO.class);
        verify(linkManager).saveQuestionsToAssessment(any(), request.capture(), eq("exam-1"), eq(INSTITUTE), eq("EXAM"));
        var qm = request.getValue().getUpdatedSections().get(0).getQuestionAndMarking().get(0);
        assertThat(qm.getIsDeleted()).isTrue();
        assertThat(qm.getIsAdded()).isFalse();
        assertThat(eq.question().getStatus()).isEqualTo("DELETED");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, ObjectNode>> staged = ArgumentCaptor.forClass(Map.class);
        verify(rubricSync).stage(eq("exam-1"), staged.capture());
        assertThat(staged.getValue().get("q1").get("rubric").isNull()).isTrue();
        assertThat(staged.getValue().get("q1").get("model_answer").isNull()).isTrue();
    }
}
