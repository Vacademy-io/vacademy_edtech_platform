package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Which teacher marks stop an automatic AI re-run: only marks an AI run would overwrite. */
class TypedAnswerEvaluationTeacherMarksTest {

    private final QuestionWiseMarksRepository marks = mock(QuestionWiseMarksRepository.class);
    private final TypedAnswerEvaluation typed = new TypedAnswerEvaluation(mock(EvaluationUtilityService.class),
            mock(QuestionAssessmentSectionMappingRepository.class), marks, new ObjectMapper());

    private static QuestionWiseMarks row(String questionType, String source) {
        Question q = new Question();
        q.setId("q-" + questionType);
        q.setQuestionType(questionType);
        return QuestionWiseMarks.builder().question(q).marksSource(source).build();
    }

    private boolean reviewed(QuestionWiseMarks... rows) {
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("att-1");
        when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(rows));
        return typed.hasTeacherReviewedMarks(attempt);
    }

    @Test
    void ai_review_page_marks_count_as_before() {
        assertThat(reviewed(row("LONG_ANSWER", "AI_REVIEWED"))).isTrue();
        assertThat(reviewed(row("LONG_ANSWER", "AI"), row("MCQS", null))).isFalse();
    }

    @Test
    void teacher_mark_on_a_written_or_cbt_question_counts() {
        assertThat(reviewed(row("LONG_ANSWER", "TEACHER"))).isTrue();
        assertThat(reviewed(row("CBE_RESPONSE", "TEACHER"))).isTrue();
    }

    @Test
    void teacher_bonus_on_an_mcq_does_not_stop_an_ai_rerun() {
        assertThat(reviewed(row("MCQS", "TEACHER"), row("NUMERIC", "TEACHER"))).isFalse();
    }

    @Test
    void manual_hand_mark_counts_exactly_like_teacher() {
        assertThat(reviewed(row("LONG_ANSWER", "MANUAL"))).isTrue();
        assertThat(reviewed(row("CBE_RESPONSE", "MANUAL"))).isTrue();
        assertThat(reviewed(row("MCQS", "MANUAL"), row("NUMERIC", "MANUAL"))).isFalse();
    }
}
