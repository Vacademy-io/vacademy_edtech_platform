package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** An AI-checked copy's total under "answer any 2 of these 3". */
class TypedAnswerEvaluationChoiceTest {

    private final QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
    private final QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
    private final ObjectMapper json = new ObjectMapper();
    private final ChoiceGroupStore store = mock(ChoiceGroupStore.class);

    private TypedAnswerEvaluation evaluation(boolean withChoice) {
        TypedAnswerEvaluation t = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings), mappings, marks, json);
        if (withChoice) ReflectionTestUtils.setField(t, "choiceGroups", new DashboardChoiceGroups(store, mappings, json));
        return t;
    }

    private static StudentAttempt uploadedCopy() {
        Assessment a = new Assessment();
        a.setId("A");
        a.setEvaluationType("MANUAL");
        AssessmentUserRegistration reg = new AssessmentUserRegistration();
        reg.setAssessment(a);
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("att");
        attempt.setRegistration(reg);
        attempt.setAttemptData("{\"fileId\":\"f1\"}");
        return attempt;
    }

    private static AiQuestionEvaluation row(String qid, int n, double m) {
        AiQuestionEvaluation r = new AiQuestionEvaluation();
        r.setQuestion(new Question(qid));
        r.setQuestionNumber(n);
        r.setStatus("COMPLETED");
        r.setMarksAwarded(BigDecimal.valueOf(m));
        r.setMaxMarks(BigDecimal.valueOf(3));
        r.setExtractedAnswer("answer");
        return r;
    }

    private final List<AiQuestionEvaluation> rows = List.of(row("x", 1, 6), row("q1", 2, 3), row("q2", 3, 1), row("q3", 4, 2.5));

    @Test
    void the_extra_answer_leaves_the_total() {
        when(store.list("A")).thenReturn(List.of(new ChoiceGroupStore.ChoiceGroupRow("g", "IX", List.of("q1", "q2", "q3"), 2, "best", 0)));
        assertThat(evaluation(true).attemptTotal(uploadedCopy(), rows)).isEqualTo(11.5);   // 6 + 3 + 2.5
    }

    @Test
    void without_groups_every_answer_counts_as_before() {
        when(store.list("A")).thenReturn(List.of());
        assertThat(evaluation(true).attemptTotal(uploadedCopy(), rows)).isEqualTo(12.5);
        assertThat(evaluation(false).attemptTotal(uploadedCopy(), rows)).isEqualTo(12.5);
    }
}
