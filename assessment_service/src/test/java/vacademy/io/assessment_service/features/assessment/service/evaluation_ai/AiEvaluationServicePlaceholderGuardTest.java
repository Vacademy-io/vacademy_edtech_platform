package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

/**
 * An offline test created with the slide form carries one placeholder question,
 * "Upload your answer sheet." — a container for the upload, not something to
 * grade. The AI checker grades per question, so against that it returns a
 * confident random score. These tests pin the guard that refuses to start.
 */
class AiEvaluationServicePlaceholderGuardTest {

        private QuestionAssessmentSectionMappingRepository mappings;
        private AiEvaluationService service;

        @BeforeEach
        void setUp() {
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                service = new AiEvaluationService(
                                mock(AiEvaluationProcessRepository.class),
                                mock(AiEvaluationAsyncService.class),
                                mock(AiEvaluationCancellationService.class),
                                mock(EvaluationAccessValidator.class),
                                mappings, mock(QuestionWiseMarksRepository.class), mock(TypedAnswerEvaluation.class),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class));
        }

        private static Assessment assessment() {
                Assessment a = new Assessment();
                a.setId("assessment-1");
                return a;
        }

        private static QuestionAssessmentSectionMapping mapping(String html, String status) {
                Question q = new Question();
                q.setTextData(new AssessmentRichTextData(null, "HTML", html));
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(q);
                m.setStatus(status);
                return m;
        }

        @Test
        void the_single_placeholder_question_is_not_gradable() {
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId(anyString()))
                                .thenReturn(List.of(mapping("<p>Upload your answer sheet.</p>", "ACTIVE")));

                assertThat(service.isPlaceholderOnly(assessment())).isTrue();
                assertThatThrownBy(() -> service.requireGradableQuestions(assessment()))
                                .isInstanceOf(VacademyException.class)
                                .hasMessageContaining("no digitised questions");
        }

        @Test
        void a_real_paper_passes_even_when_it_starts_with_the_placeholder() {
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId(anyString()))
                                .thenReturn(List.of(
                                                mapping("Upload your answer sheet.", "ACTIVE"),
                                                mapping("<p>Explain the water cycle.</p>", "ACTIVE")));

                assertThat(service.isPlaceholderOnly(assessment())).isFalse();
                service.requireGradableQuestions(assessment()); // no throw
        }

        @Test
        void a_single_real_question_passes_and_deleted_rows_do_not_count() {
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId(anyString()))
                                .thenReturn(List.of(
                                                mapping("Upload your answer sheet.", "DELETED"),
                                                mapping("<p>Name two rivers of India.</p>", null)));

                assertThat(service.isPlaceholderOnly(assessment())).isFalse();
        }

        @Test
        void nothing_mapped_is_left_to_the_existing_no_questions_failure() {
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId(anyString()))
                                .thenReturn(List.of());

                assertThat(service.isPlaceholderOnly(assessment())).isFalse();
                assertThat(service.isPlaceholderOnly(null)).isFalse();
        }
}
