package vacademy.io.assessment_service.features.open_evaluation.choice;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChoiceGroupServiceTest {

    private ChoiceGroupStore store;
    private ApiExamStore examStore;
    private OpenQuestionService questions;
    private OpenApiProperties properties;
    private ChoiceGroupService service;
    private final Map<String, OpenQuestionService.ExamQuestion> byLabel = new LinkedHashMap<>();

    @BeforeEach
    void setUp() {
        store = mock(ChoiceGroupStore.class);
        examStore = mock(ApiExamStore.class);
        questions = mock(OpenQuestionService.class);
        properties = mock(OpenApiProperties.class);
        when(properties.isChoiceGroupsEnabled()).thenReturn(true);
        service = new ChoiceGroupService(store, examStore, questions, properties);
        byLabel.put("1", OpenFixtures.question("q1", "1", "LONG_ANSWER", "2", "A", 1));
        byLabel.put("11", OpenFixtures.question("q11", "11", "LONG_ANSWER", "10", "B", 1));
        byLabel.put("12", OpenFixtures.question("q12", "12", "LONG_ANSWER", "10", "B", 2));
        byLabel.put("13", OpenFixtures.question("q13", "13", "LONG_ANSWER", "8", "B", 3));
        when(questions.byLabel("exam-1")).thenReturn(byLabel);
    }

    private static ExamInputs.ReplaceChoiceGroups body(ExamInputs.ChoiceGroupInput... groups) {
        ExamInputs.ReplaceChoiceGroups b = new ExamInputs.ReplaceChoiceGroups();
        b.setChoiceGroups(List.of(groups));
        return b;
    }

    @Test
    void replace_stores_question_ids_and_returns_paper_max() {
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        when(store.list("exam-1")).thenReturn(List.of(
                new ChoiceGroupStore.ChoiceGroupRow("g1", "Part B", List.of("q11", "q12", "q13"), 2, "best", 0)));

        ChoiceGroupService.Replaced replaced = service.replace(OpenFixtures.key(), "exam-1",
                body(new ExamInputs.ChoiceGroupInput("Part B", List.of("11", "12", "13"), 2, "BEST")));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ChoiceGroupStore.ChoiceGroupRow>> rows = ArgumentCaptor.forClass(List.class);
        verify(store).replace(eq("exam-1"), rows.capture());
        assertThat(rows.getValue().get(0).questionIds()).containsExactly("q11", "q12", "q13");
        assertThat(rows.getValue().get(0).policy()).isEqualTo("best");
        assertThat(replaced.totalMarks()).isEqualTo(30.0);
        assertThat(replaced.paperMax()).isEqualTo(22.0); // 2 + top two of (10, 10, 8)
        assertThat(replaced.choiceGroups().get(0).getQuestionLabels()).containsExactly("11", "12", "13");
        verify(examStore).touch("exam-1");
    }

    @Test
    void groups_cannot_change_once_a_copy_is_graded_or_running() {
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        when(examStore.hasGradedOrRunningEvaluation("exam-1")).thenReturn(true);
        assertThatThrownBy(() -> service.replace(OpenFixtures.key(), "exam-1", body()))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.EXAM_HAS_SUBMISSIONS));
        verify(store, never()).replace(anyString(), any());
    }

    @Test
    void open_exam_without_graded_copies_may_still_change_groups_and_an_empty_list_clears_them() {
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
        when(store.list("exam-1")).thenReturn(List.of());
        ChoiceGroupService.Replaced replaced = service.replace(OpenFixtures.key(), "exam-1", body());
        verify(store).replace("exam-1", List.of());
        assertThat(replaced.paperMax()).isEqualTo(replaced.totalMarks());
    }

    @Test
    void labels_in_a_different_case_map_to_the_question_ids() {
        List<ChoiceGroupStore.ChoiceGroupRow> rows = ChoiceGroupService.toRows(
                List.of(new ExamInputs.ChoiceGroupInput("x", List.of("11", "12"), 1, "First")),
                Map.of("11", byLabel.get("11"), "12", byLabel.get("12")));
        assertThat(rows.get(0).questionIds()).containsExactly("q11", "q12");

        Map<String, OpenQuestionService.ExamQuestion> upper = new LinkedHashMap<>();
        upper.put("33-OR", OpenFixtures.question("q34", "33-OR", "LONG_ANSWER", "5", "C", 2));
        upper.put("33", OpenFixtures.question("q33", "33", "LONG_ANSWER", "5", "C", 1));
        rows = ChoiceGroupService.toRows(List.of(new ExamInputs.ChoiceGroupInput(null, List.of("33", "33-or"), 1, "first")),
                upper);
        assertThat(rows.get(0).questionIds()).containsExactly("q33", "q34");
        assertThat(rows.get(0).policy()).isEqualTo("first");
    }

    @Test
    void unknown_labels_are_refused() {
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));
        assertThatThrownBy(() -> service.replace(OpenFixtures.key(), "exam-1",
                body(new ExamInputs.ChoiceGroupInput(null, List.of("11", "99"), 1, "first"))))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
    }

    @Test
    void while_the_engine_ignores_groups_both_paths_answer_feature_not_available() {
        when(properties.isChoiceGroupsEnabled()).thenReturn(false);
        when(examStore.findForUpdate(OpenFixtures.INSTITUTE, "exam-1")).thenReturn(Optional.of(OpenFixtures.draft("exam-1")));

        assertThatThrownBy(() -> service.replace(OpenFixtures.key(), "exam-1",
                body(new ExamInputs.ChoiceGroupInput(null, List.of("11", "12"), 1, "first"))))
                .isInstanceOfSatisfying(OpenApiException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE);
                    assertThat(ex.getStatus().value()).isEqualTo(422);
                });
        assertThatThrownBy(() -> service.storeForCreate("exam-1",
                List.of(new ExamInputs.ChoiceGroupInput(null, List.of("11", "12"), 1, "first")), byLabel))
                .isInstanceOfSatisfying(OpenApiException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE));
        verify(store, never()).replace(anyString(), any());
        assertThat(service.enabled()).isFalse();
    }
}
