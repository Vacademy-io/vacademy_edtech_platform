package vacademy.io.assessment_service.features.open_evaluation.grade;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupService;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ApiGradeContextProviderTest {

    private ApiExamStore examStore;
    private ChoiceGroupService choiceGroups;
    private OpenQuestionService questions;
    private ApiGradeContextProvider provider;
    private AiEvaluationProcess process;

    @BeforeEach
    void setUp() {
        examStore = mock(ApiExamStore.class);
        choiceGroups = mock(ChoiceGroupService.class);
        questions = mock(OpenQuestionService.class);
        provider = new ApiGradeContextProvider(examStore, choiceGroups, questions);
        process = new AiEvaluationProcess();
        Assessment a = new Assessment();
        a.setId("exam-1");
        process.setAssessment(a);
        process.setInstituteId("inst-1");
        ApiExamStore.ApiExamRow base = OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null);
        ApiExamStore.ApiExamRow exam = new ApiExamStore.ApiExamRow(base.assessmentId(), base.instituteId(), base.keyId(),
                null, "handwritten", "ug", "Financial Accounting", null, null, "en", "en", "Award step marks &lt;strictly&gt;",
                base.conductedOn(), false, null, null, Instant.now(), Instant.now(), "B.Com", "PUBLISHED", false);
        when(examStore.find("inst-1", "exam-1")).thenReturn(Optional.of(exam));
    }

    @Test
    void sends_exam_context_and_subject_for_api_exams() {
        CopyCheckGradeRequestDto request = CopyCheckGradeRequestDto.builder().build();
        when(choiceGroups.enabled()).thenReturn(false);

        provider.contribute(process, request);

        assertThat(provider.subject(process)).isEqualTo("Financial Accounting");
        assertThat(request.getExamContext()).containsEntry("level", "ug").containsEntry("subject", "Financial Accounting")
                .containsEntry("instructions", "Award step marks <strictly>").containsEntry("answer_language", "en");
        assertThat(request.getChoiceGroups()).isNull();
        assertThat(request.getPaperMax()).isNull();
    }

    @Test
    void sends_choice_groups_and_paper_max_only_while_the_flag_is_on() {
        when(choiceGroups.enabled()).thenReturn(true);
        when(choiceGroups.list("exam-1")).thenReturn(List.of(
                new ChoiceGroupStore.ChoiceGroupRow("g1", "Part B", List.of("q1", "q2"), 1, "best", 0)));
        when(questions.load("exam-1")).thenReturn(List.of(
                OpenFixtures.question("q1", "1", "LONG_ANSWER", "10", "B", 1),
                OpenFixtures.question("q2", "2", "LONG_ANSWER", "10", "B", 2),
                OpenFixtures.question("q3", "3", "LONG_ANSWER", "5", "A", 1)));
        CopyCheckGradeRequestDto request = CopyCheckGradeRequestDto.builder().build();

        provider.contribute(process, request);

        assertThat(request.getChoiceGroups()).hasSize(1);
        assertThat(request.getChoiceGroups().get(0)).containsEntry("attempt", 1).containsEntry("policy", "best");
        assertThat(request.getPaperMax()).isEqualTo(15.0);
    }

    @Test
    void a_dashboard_exam_is_left_alone() {
        when(examStore.find("inst-1", "exam-1")).thenReturn(Optional.empty());
        CopyCheckGradeRequestDto request = CopyCheckGradeRequestDto.builder().build();
        provider.contribute(process, request);
        assertThat(request.getExamContext()).isNull();
        assertThat(provider.subject(process)).isNull();
        assertThat(provider.subject(new AiEvaluationProcess())).isNull();
    }
}
