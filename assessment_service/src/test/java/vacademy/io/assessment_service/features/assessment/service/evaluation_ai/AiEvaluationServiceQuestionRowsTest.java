package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

/**
 * A staff-made attempt (offline upload, bulk-intake copy) never went through a
 * learner submit, so it has no question rows — and the checker, which grades per
 * row, failed every such copy with "no questions found for attempt" (2026-09-20).
 */
class AiEvaluationServiceQuestionRowsTest {

        private QuestionAssessmentSectionMappingRepository mappings;
        private QuestionWiseMarksRepository marks;
        private AiEvaluationService service;

        @BeforeEach
        void setUp() {
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                marks = mock(QuestionWiseMarksRepository.class);
                service = new AiEvaluationService(mock(AiEvaluationProcessRepository.class),
                                mock(AiEvaluationAsyncService.class), mock(AiEvaluationCancellationService.class),
                                mock(EvaluationAccessValidator.class), mappings, marks, mock(TypedAnswerEvaluation.class),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class));
        }

        private static StudentAttempt attempt() {
                Assessment a = new Assessment();
                a.setId("a1");
                AssessmentUserRegistration reg = new AssessmentUserRegistration();
                reg.setAssessment(a);
                StudentAttempt attempt = new StudentAttempt();
                attempt.setId("att-1");
                attempt.setRegistration(reg);
                return attempt;
        }

        private static QuestionAssessmentSectionMapping mapping(String questionId, String status, String sectionStatus) {
                Question q = new Question();
                q.setId(questionId);
                Section s = new Section();
                s.setId("sec-1");
                s.setStatus(sectionStatus);
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(q);
                m.setSection(s);
                m.setStatus(status);
                return m;
        }

        @Test
        void an_attempt_without_rows_gets_one_pending_zero_mark_row_per_live_question() {
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of());
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of(
                                mapping("q1", "ACTIVE", "ACTIVE"),
                                mapping("q2", "ACTIVE", "ACTIVE"),
                                mapping("q-gone", "DELETED", "ACTIVE"),
                                mapping("q-old-section", "ACTIVE", "DELETED")));

                service.ensureQuestionRows(attempt());

                @SuppressWarnings("unchecked")
                ArgumentCaptor<List<QuestionWiseMarks>> saved = ArgumentCaptor.forClass(List.class);
                verify(marks).saveAll(saved.capture());
                assertThat(saved.getValue()).extracting(r -> r.getQuestion().getId()).containsExactly("q1", "q2");
                assertThat(saved.getValue()).allSatisfy(r -> {
                        assertThat(r.getStatus()).isEqualTo("PENDING");
                        assertThat(r.getMarks()).isZero();
                        assertThat(r.getStudentAttempt().getId()).isEqualTo("att-1");
                        assertThat(r.getSection().getId()).isEqualTo("sec-1");
                });
        }

        @Test
        void an_attempt_that_already_has_rows_is_left_alone() {
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of(new QuestionWiseMarks()));

                service.ensureQuestionRows(attempt());

                verify(mappings, never()).getQuestionAssessmentSectionMappingByAssessmentId(anyString());
                verify(marks, never()).saveAll(anyList());
        }

        @Test
        void nothing_happens_without_a_registration_or_questions() {
                service.ensureQuestionRows(new StudentAttempt());
                when(marks.findByStudentAttemptId("att-1")).thenReturn(List.of());
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of());
                service.ensureQuestionRows(attempt());
                verify(marks, never()).saveAll(anyList());
        }
}
