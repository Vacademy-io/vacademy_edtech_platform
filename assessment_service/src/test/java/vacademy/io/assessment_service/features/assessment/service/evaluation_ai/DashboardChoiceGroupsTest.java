package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * "Answer any FOUR of these five" on a dashboard paper. Without a group nothing here
 * changes anything; with one, the extra answers are graded but leave the total.
 */
class DashboardChoiceGroupsTest {

    private final ChoiceGroupStore store = mock(ChoiceGroupStore.class);
    private final QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
    private final DashboardChoiceGroups choice = new DashboardChoiceGroups(store, mappings, new ObjectMapper());

    private static ChoiceGroupStore.ChoiceGroupRow group(int attempt, String policy, String... ids) {
        return new ChoiceGroupStore.ChoiceGroupRow("g", "VIII", List.of(ids), attempt, policy, 0);
    }

    private static AiQuestionEvaluation row(String qid, int number, double marks, String answer) {
        AiQuestionEvaluation r = new AiQuestionEvaluation();
        r.setQuestion(new Question(qid));
        r.setQuestionNumber(number);
        r.setStatus("COMPLETED");
        r.setMarksAwarded(BigDecimal.valueOf(marks));
        r.setMaxMarks(BigDecimal.valueOf(3));
        r.setExtractedAnswer(answer);
        return r;
    }

    @Test
    void without_groups_nothing_is_left_out_and_nothing_is_sent() {
        when(store.list("A")).thenReturn(List.of());
        assertThat(choice.notCounted("A", List.of(row("q1", 1, 3, "x")))).isEmpty();
        assertThat(choice.notCountedByMarks("A", Map.of("q1", 3.0))).isEmpty();
        assertThat(choice.paperMax("A")).isNull();
        CopyCheckGradeRequestDto request = CopyCheckGradeRequestDto.builder().answerMode("COPY").build();
        choice.contribute("A", request);
        assertThat(request.getChoiceGroups()).isNull();
        assertThat(request.getPaperMax()).isNull();
    }

    @Test
    void best_policy_leaves_out_the_lowest_marked_extra_answer() {
        when(store.list("A")).thenReturn(List.of(group(4, "best", "q1", "q2", "q3", "q4", "q5")));
        List<AiQuestionEvaluation> rows = List.of(row("q1", 9, 1, "a"), row("q2", 10, 3, "b"), row("q3", 11, 2.5, "c"),
                row("q4", 12, 3, "d"), row("q5", 13, 2, "e"));
        assertThat(choice.notCounted("A", rows)).containsExactly("q1");
    }

    @Test
    void best_policy_follows_a_teachers_edit() {
        when(store.list("A")).thenReturn(List.of(group(4, "best", "q1", "q2", "q3", "q4", "q5")));
        List<AiQuestionEvaluation> rows = new ArrayList<>(List.of(row("q1", 9, 1, "a"), row("q2", 10, 3, "b"),
                row("q3", 11, 2.5, "c"), row("q4", 12, 3, "d"), row("q5", 13, 2, "e")));
        rows.get(0).setMarksAwarded(BigDecimal.valueOf(3));   // teacher raised q1
        assertThat(choice.notCounted("A", rows)).containsExactly("q5");
    }

    @Test
    void first_policy_uses_the_ai_order_when_it_decided_and_paper_order_otherwise() {
        when(store.list("A")).thenReturn(List.of(group(2, "first", "q1", "q2", "q3")));
        List<AiQuestionEvaluation> rows = List.of(row("q1", 14, 3, "a"), row("q2", 15, 1, "b"), row("q3", 16, 2, "c"));
        rows.get(0).setEvaluationResultJson("{\"counted\":false}");   // written after the others on the copy
        rows.get(1).setEvaluationResultJson("{\"counted\":true}");
        rows.get(2).setEvaluationResultJson("{\"counted\":true}");
        assertThat(choice.notCounted("A", rows)).containsExactly("q1");

        List<AiQuestionEvaluation> noAi = List.of(row("q1", 14, 3, "a"), row("q2", 15, 0, ""), row("q3", 16, 2, "c"));
        // Only two answered: both count; the unanswered q2 is the one left out (it scored 0 anyway).
        assertThat(choice.notCounted("A", noAi)).containsExactly("q2");
        List<AiQuestionEvaluation> allThree = List.of(row("q1", 14, 3, "a"), row("q2", 15, 1, "b"), row("q3", 16, 2, "c"));
        assertThat(choice.notCounted("A", allThree)).containsExactly("q3");
    }

    @Test
    void a_question_awaiting_a_grade_is_never_the_one_left_out() {
        when(store.list("A")).thenReturn(List.of(group(1, "best", "q1", "q2")));
        AiQuestionEvaluation failed = row("q1", 1, 0, "");
        failed.setStatus("FAILED");
        assertThat(choice.notCounted("A", List.of(failed, row("q2", 2, 2, "b")))).containsExactly("q2");
    }

    @Test
    void manual_marks_and_revaluation_use_the_same_rule() {
        when(store.list("A")).thenReturn(List.of(group(4, "best", "q1", "q2", "q3", "q4", "q5")));
        Map<String, Double> marks = new LinkedHashMap<>(Map.of("q1", 3.0, "q2", 1.0, "q3", 3.0, "q4", 2.0, "q5", 3.0));
        marks.put("other", 6.0);
        assertThat(choice.notCountedByMarks("A", marks)).containsExactly("q2");
        // Only four marked: nothing to leave out.
        assertThat(choice.notCountedByMarks("A", Map.of("q1", 3.0, "q2", 1.0, "q3", 3.0, "q4", 2.0))).isEmpty();
    }

    @Test
    void paper_max_counts_attempt_of_each_group() {
        List<ChoiceGroupStore.ChoiceGroupRow> rows = List.of(group(4, "best", "a", "b", "c", "d", "e"), group(2, "best", "f", "g", "h"));
        Map<String, Double> marks = new LinkedHashMap<>();
        for (String id : List.of("a", "b", "c", "d", "e", "f", "g", "h")) marks.put(id, 3.0);
        marks.put("rest", 22.0);
        assertThat(DashboardChoiceGroups.paperMax(rows, marks)).isEqualTo(40.0);
    }

    @Test
    void replace_validates_before_storing() {
        Map<String, Double> marks = Map.of("a", 3.0, "b", 3.0, "c", 3.0);
        assertThatThrownBy(() -> choice.replace("A", List.of(new DashboardChoiceGroups.GroupInput("IX", List.of("a", "b", "c"), 3, "best")), marks))
                .isInstanceOf(VacademyException.class).hasMessageContaining("not a choice");
        assertThatThrownBy(() -> choice.replace("A", List.of(new DashboardChoiceGroups.GroupInput("IX", List.of("a", "zz"), 1, "best")), marks))
                .isInstanceOf(VacademyException.class).hasMessageContaining("not part of this paper");
        assertThatThrownBy(() -> choice.replace("A", List.of(new DashboardChoiceGroups.GroupInput("IX", List.of("a", "b"), 1, "random")), marks))
                .isInstanceOf(VacademyException.class).hasMessageContaining("best");
        verify(store, never()).replace(any(), any());

        double max = choice.replace("A", List.of(new DashboardChoiceGroups.GroupInput("IX", List.of("a", "b", "c"), 2, null)), marks);
        assertThat(max).isEqualTo(6.0);
        verify(store).replace(eq("A"), any());
    }

    @Test
    void groups_reach_an_uploaded_copy_only_and_never_override_a_provider() {
        when(store.list("A")).thenReturn(List.of(group(1, "best", "q1", "q2")));
        CopyCheckGradeRequestDto typed = CopyCheckGradeRequestDto.builder().answerMode("TYPED").build();
        choice.contribute("A", typed);
        assertThat(typed.getChoiceGroups()).isNull();

        CopyCheckGradeRequestDto api = CopyCheckGradeRequestDto.builder().answerMode("COPY")
                .choiceGroups(List.of(Map.of("question_ids", List.of("x")))).build();
        choice.contribute("A", api);
        assertThat(api.getChoiceGroups()).hasSize(1).first().satisfies(g -> assertThat(g.get("question_ids")).isEqualTo(List.of("x")));

        CopyCheckGradeRequestDto copy = CopyCheckGradeRequestDto.builder().answerMode("COPY").build();
        choice.contribute("A", copy);
        assertThat(copy.getChoiceGroups()).hasSize(1);
        assertThat(copy.getChoiceGroups().get(0)).containsEntry("attempt", 1).containsEntry("policy", "best");
        assertThat(Set.copyOf((List<?>) copy.getChoiceGroups().get(0).get("question_ids"))).isEqualTo(Set.of("q1", "q2"));
    }
}
