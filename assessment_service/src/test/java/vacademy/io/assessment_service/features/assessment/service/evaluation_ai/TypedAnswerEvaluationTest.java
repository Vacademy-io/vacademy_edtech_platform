package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * An online attempt's AI run covers its written answers only; the total must
 * still include the objective questions scored on submit. For an uploaded copy
 * the run covers every question and the total is unchanged: its verdicts.
 */
class TypedAnswerEvaluationTest {

        private QuestionWiseMarksRepository marks;
        private QuestionAssessmentSectionMappingRepository mappings;
        private TypedAnswerEvaluation typed;

        @BeforeEach
        void setUp() {
                marks = mock(QuestionWiseMarksRepository.class);
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                ObjectMapper json = new ObjectMapper();
                typed = new TypedAnswerEvaluation(new EvaluationUtilityService(json, mappings), mappings, marks, json);
        }

        private static Question question(String id) {
                Question q = new Question();
                q.setId(id);
                q.setQuestionType("LONG_ANSWER");
                return q;
        }

        private static QuestionWiseMarks stored(String qid, double value) {
                return QuestionWiseMarks.builder().question(question(qid)).marks(value).build();
        }

        private static AiQuestionEvaluation verdict(String qid, String status, Double value) {
                return AiQuestionEvaluation.builder().question(question(qid)).status(status)
                                .marksAwarded(value == null ? null : BigDecimal.valueOf(value)).build();
        }

        private static StudentAttempt attempt(String evaluationType, String attemptData) {
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                assessment.setEvaluationType(evaluationType);
                AssessmentUserRegistration registration = new AssessmentUserRegistration();
                registration.setAssessment(assessment);
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("att-1");
                attempt.setRegistration(registration);
                attempt.setAttemptData(attemptData);
                return attempt;
        }

        private static StudentAttempt online() {
                return attempt("AUTO", "{\"sections\":[]}");
        }

        @Test
        void onlineTotalIsAiMarksForEssaysPlusAutoMarksForTheRest() {
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(
                                stored("mcq1", 1), stored("mcq2", 1), stored("essay", 2.5)));
                double total = typed.attemptTotal(online(), List.of(verdict("essay", "COMPLETED", 7.5)));
                // 1 + 1 from the MCQs, 7.5 from the AI - never the essay's stored 2.5.
                assertThat(total).isEqualTo(9.5);
        }

        @Test
        void aQuestionTheAiCouldNotGradeCountsForNothingYet() {
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("mcq", 1), stored("essay", 2.5)));
                assertThat(typed.attemptTotal(online(), List.of(verdict("essay", "FAILED", null)))).isEqualTo(1.0);
        }

        @Test
        void anUploadedCopyTotalIsItsVerdictsAsBefore() {
                // Even with a stray stored row the run did not cover: a copy's total
                // is the sum of its verdicts and nothing else, exactly as before.
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(stored("q1", 0), stored("stray", 5)));
                double total = typed.attemptTotal(attempt("MANUAL", "{\"fileId\":\"f1\"}"),
                                List.of(verdict("q1", "COMPLETED", 3.0), verdict("q2", "COMPLETED", 4.0)));
                assertThat(total).isEqualTo(7.0);
                verify(marks, never()).findByStudentAttemptId("att-1");
        }

        @Test
        void aManualEvaluationAttemptWithoutAFileIsAMissingCopyNotTypedAnswers() {
                assertThat(typed.isTypedAttempt(attempt("MANUAL", "{\"sections\":[]}"),
                                attempt("MANUAL", null).getRegistration().getAssessment())).isFalse();
                assertThat(typed.isTypedAttempt(online(), online().getRegistration().getAssessment())).isTrue();
                assertThat(typed.isTypedAttempt(attempt("AUTO", "{\"fileId\":\"f1\"}"),
                                online().getRegistration().getAssessment())).isFalse();
        }

        @Test
        void readsTheTypedAnswerFromTheResponseJson() {
                QuestionWiseMarks row = QuestionWiseMarks.builder()
                                .responseJson("{\"responseData\":{\"type\":\"LONG_ANSWER\",\"answer\":\"Dear Sir\"}}").build();
                assertThat(typed.typedAnswer(row)).isEqualTo("Dear Sir");
                assertThat(typed.typedAnswer(QuestionWiseMarks.builder().responseJson("{}").build())).isNull();
                assertThat(typed.typedAnswer(QuestionWiseMarks.builder().responseJson("not json").build())).isNull();
        }

        @Test
        void onlyAnOptedInOnlineAttemptOnAPaperWithAWrittenQuestionAwaitsTheAi() {
                Assessment on = new Assessment();
                on.setId("a1");
                on.setAiEvaluationEnabled(true);
                on.setEvaluationType("AUTO");
                StudentAttempt online = new StudentAttempt();
                online.setAttemptData("{\"sections\":[]}");
                StudentAttempt uploaded = new StudentAttempt();
                uploaded.setAttemptData("{\"fileId\":\"f1\"}");
                when(mappings.existsQuestionOfTypesInAssessment("a1", List.of("LONG_ANSWER"))).thenReturn(true);

                assertThat(typed.awaitsAiGrading(online, on)).isTrue();
                assertThat(typed.awaitsAiGrading(uploaded, on)).isFalse();

                Assessment off = new Assessment();
                off.setId("a2");
                assertThat(typed.awaitsAiGrading(online, off)).isFalse();

                Assessment manualUpload = new Assessment();
                manualUpload.setId("a3");
                manualUpload.setAiEvaluationEnabled(true);
                manualUpload.setEvaluationType("MANUAL");
                assertThat(typed.awaitsAiGrading(online, manualUpload)).isFalse();
                verify(mappings, never()).existsQuestionOfTypesInAssessment("a2", List.of("LONG_ANSWER"));

                when(mappings.existsQuestionOfTypesInAssessment(anyString(), anyList())).thenReturn(false);
                assertThat(typed.awaitsAiGrading(online, on)).isFalse();
        }
}
