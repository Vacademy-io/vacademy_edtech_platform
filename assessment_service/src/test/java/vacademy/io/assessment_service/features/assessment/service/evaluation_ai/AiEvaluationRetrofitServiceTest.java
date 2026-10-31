package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.fasterxml.jackson.databind.ObjectMapper;

import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AdoptQuestionsRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AdoptQuestionsResponse;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Turning an already-published placeholder test into an AI-checkable one must
 * change exactly one thing per attempt: ungraded uploads get a row per real
 * question (and lose the ungraded placeholder row); a sheet the teacher already
 * scored keeps its score untouched.
 */
class AiEvaluationRetrofitServiceTest {

        private AssessmentRepository assessments;
        private QuestionAssessmentSectionMappingRepository mappings;
        private QuestionAssessmentSectionMappingService mappingService;
        private SectionRepository sections;
        private QuestionRepository questions;
        private StudentAttemptRepository attempts;
        private QuestionWiseMarksRepository marks;
        private AiEvaluationService evaluationService;
        private AiEvaluationRetrofitService service;

        private Assessment assessment;
        private Section section;
        private QuestionAssessmentSectionMapping placeholder;

        @BeforeEach
        void setUp() {
                assessments = mock(AssessmentRepository.class);
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                mappingService = mock(QuestionAssessmentSectionMappingService.class);
                sections = mock(SectionRepository.class);
                questions = mock(QuestionRepository.class);
                attempts = mock(StudentAttemptRepository.class);
                marks = mock(QuestionWiseMarksRepository.class);
                evaluationService = new AiEvaluationService(
                                mock(vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository.class),
                                mock(AiEvaluationAsyncService.class), mock(AiEvaluationCancellationService.class),
                                mock(EvaluationAccessValidator.class), mappings, marks, mock(TypedAnswerEvaluation.class),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class));
                service = new AiEvaluationRetrofitService(assessments, mappings, mappingService, sections, questions,
                                attempts, marks, evaluationService, mock(EvaluationAccessValidator.class),
                                new ObjectMapper());

                assessment = new Assessment();
                assessment.setId("a1");
                section = new Section();
                section.setId("s1");
                section.setTotalMarks(80.0);
                Question ph = new Question();
                ph.setId("q-ph");
                ph.setTextData(new AssessmentRichTextData(null, "HTML", "<p>Upload your answer sheet.</p>"));
                placeholder = new QuestionAssessmentSectionMapping();
                placeholder.setQuestion(ph);
                placeholder.setSection(section);
                placeholder.setStatus("ACTIVE");

                when(assessments.findByAssessmentIdAndInstituteId("a1", "inst")).thenReturn(Optional.of(assessment));
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of(placeholder));
                when(questions.existsById(anyString())).thenReturn(true);
                when(questions.getReferenceById(anyString())).thenAnswer(inv -> {
                        Question q = new Question();
                        q.setId(inv.getArgument(0));
                        return q;
                });
        }

        private static AdoptQuestionsRequest request(double... markList) {
                List<AdoptQuestionsRequest.AdoptedQuestion> qs = new ArrayList<>();
                for (int i = 0; i < markList.length; i++) {
                        qs.add(AdoptQuestionsRequest.AdoptedQuestion.builder()
                                        .questionId("q" + (i + 1)).questionType(i == 0 ? "MCQS" : "LONG_ANSWER")
                                        .marks(markList[i]).build());
                }
                return AdoptQuestionsRequest.builder().questions(qs).build();
        }

        private static StudentAttempt attempt(String id, String status) {
                StudentAttempt a = new StudentAttempt();
                a.setId(id);
                a.setStatus(status);
                return a;
        }

        private QuestionWiseMarks placeholderRow(String status, double mark) {
                Question ph = new Question();
                ph.setId("q-ph");
                return QuestionWiseMarks.builder().question(ph).status(status).marks(mark).build();
        }

        @Test
        void swaps_the_placeholder_for_the_questions_and_prepares_only_ungraded_uploads() {
                when(attempts.findAllParticipantsFromAssessmentAndStatusNotIn(eq("a1"), anyList()))
                                .thenReturn(List.of(attempt("ended-ungraded", "ENDED"), attempt("ended-graded", "ENDED"),
                                                attempt("live", "LIVE")));
                when(marks.findByStudentAttemptId("ended-ungraded")).thenReturn(List.of(placeholderRow("PENDING", 0)));
                when(marks.findByStudentAttemptId("ended-graded")).thenReturn(List.of(placeholderRow("evaluated", 65)));

                AdoptQuestionsResponse out = service.adoptQuestions(mock(CustomUserDetails.class), "inst", "a1",
                                request(1, 5, 4));

                // placeholder out, three real questions in, in the SAME section
                verify(mappingService).softDeleteMappingsByQuestionIdsAndSectionId(List.of("q-ph"), "s1");
                @SuppressWarnings("unchecked")
                ArgumentCaptor<List<QuestionAssessmentSectionMapping>> added = ArgumentCaptor.forClass(List.class);
                verify(mappingService).addMultipleMappings(added.capture());
                assertThat(added.getValue()).hasSize(3);
                assertThat(added.getValue()).allMatch(m -> m.getSection() == section && "ACTIVE".equals(m.getStatus()));
                assertThat(added.getValue().get(0).getMarkingJson())
                                .contains("\"type\":\"MCQS\"").contains("\"totalMark\":\"1\"");
                assertThat(added.getValue().get(1).getMarkingJson()).contains("\"totalMark\":\"5\"");
                assertThat(section.getTotalMarks()).isEqualTo(10.0);
                assertThat(assessment.getAiEvaluationEnabled()).isTrue();
                assertThat(assessment.getSubmissionType()).isEqualTo("PDF");

                // ungraded upload: placeholder row gone, one PENDING row per question
                verify(marks).deleteAll(argThatHasSize(1));
                @SuppressWarnings("unchecked")
                ArgumentCaptor<List<QuestionWiseMarks>> created = ArgumentCaptor.forClass(List.class);
                verify(marks).saveAll(created.capture());
                assertThat(created.getValue()).hasSize(3);
                assertThat(created.getValue()).allMatch(r -> "PENDING".equals(r.getStatus()) && r.getMarks() == 0
                                && r.getSection() == section && r.getStudentAttempt().getId().equals("ended-ungraded"));

                assertThat(out.getAttemptIdsReady()).containsExactly("ended-ungraded");
                assertThat(out.getAttemptsLeftAsGraded()).isEqualTo(1);
                assertThat(out.getAttemptsInProgress()).isEqualTo(1);
                assertThat(out.getQuestionsMapped()).isEqualTo(3);
                assertThat(out.getTotalMarks()).isEqualTo(10.0);
        }

        private static List<QuestionWiseMarks> argThatHasSize(int n) {
                return org.mockito.ArgumentMatchers.argThat(list -> list != null && list.size() == n);
        }

        @Test
        void refuses_bad_input_before_touching_anything() {
                CustomUserDetails user = mock(CustomUserDetails.class);
                assertThatThrownBy(() -> service.adoptQuestions(user, "inst", "a1", request()))
                                .isInstanceOf(VacademyException.class).hasMessageContaining("No questions");
                assertThatThrownBy(() -> service.adoptQuestions(user, "inst", "a1", request(1, 0)))
                                .isInstanceOf(VacademyException.class).hasMessageContaining("greater than 0");
                when(questions.existsById("q2")).thenReturn(false);
                assertThatThrownBy(() -> service.adoptQuestions(user, "inst", "a1", request(1, 2)))
                                .isInstanceOf(VacademyException.class).hasMessageContaining("Question not found: q2");
                verify(mappingService, never()).softDeleteMappingsByQuestionIdsAndSectionId(anyList(), anyString());
                verify(mappingService, never()).addMultipleMappings(any());
        }

        @Test
        void refuses_a_test_that_already_has_real_questions() {
                Question real = new Question();
                real.setId("real");
                real.setTextData(new AssessmentRichTextData(null, "HTML", "Explain the water cycle."));
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(real);
                m.setSection(section);
                m.setStatus("ACTIVE");
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of(m));

                assertThatThrownBy(() -> service.adoptQuestions(mock(CustomUserDetails.class), "inst", "a1", request(2)))
                                .isInstanceOf(VacademyException.class).hasMessageContaining("already has its own questions");
                assertThat(assessment.getAiEvaluationEnabled()).isNull();
        }

        @Test
        void a_row_the_ai_already_scored_counts_as_graded() {
                QuestionWiseMarks row = placeholderRow("PENDING", 0);
                row.setAiEvaluatedAt(new Date());
                assertThat(service.isGraded(row)).isTrue();
                assertThat(service.isGraded(placeholderRow("PENDING", 0))).isFalse();
                assertThat(service.isGraded(placeholderRow("evaluated", 0))).isTrue();
        }
}
