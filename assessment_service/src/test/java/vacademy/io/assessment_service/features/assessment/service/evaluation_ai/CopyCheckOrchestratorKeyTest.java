package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.when;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;

import com.fasterxml.jackson.databind.ObjectMapper;

import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

/**
 * The AI grader marks a handwritten objective answer against the KEY. The key
 * lives in auto_evaluation_json in the platform's own shapes; before this the
 * orchestrator looked for fields that never existed there, so every MCQ went to
 * the grader with no options and no key.
 */
class CopyCheckOrchestratorKeyTest {

        private CopyCheckOrchestratorService service;
        private QuestionAssessmentSectionMappingRepository mappings;

        @BeforeEach
        void setUp() {
                mappings = mock(QuestionAssessmentSectionMappingRepository.class);
                service = new CopyCheckOrchestratorService(
                                mock(AiEvaluationProcessRepository.class),
                                mock(QuestionWiseMarksRepository.class),
                                mock(AiQuestionEvaluationService.class),
                                mock(EvaluationUtilityService.class),
                                mock(AiServiceCopyCheckClient.class),
                                new ObjectMapper(),
                                mock(OptionRepository.class),
                                mappings,
                                mock(TypedAnswerEvaluation.class),
                                mock(org.springframework.transaction.PlatformTransactionManager.class),
                                mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.class), null);
        }

        private static Option option(String id, String html) {
                Option o = new Option();
                o.setId(id);
                o.setText(new AssessmentRichTextData(null, "HTML", html));
                return o;
        }

        private static Question question(String type, String autoEvaluationJson) {
                Question q = new Question();
                q.setId("q1");
                q.setQuestionType(type);
                q.setAutoEvaluationJson(autoEvaluationJson);
                return q;
        }

        @Test
        void mcqs_key_names_the_position_and_the_printed_option() {
                List<Option> options = List.of(
                                option("o1", "<p>(a) Sahara Desert</p>"),
                                option("o2", "<p>(b) Himalayas</p>"),
                                option("o3", "<p>(c) Andes</p>"));
                String key = service.correctAnswerFor(
                                question("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o2\"]}}"),
                                options);
                assertThat(key).isEqualTo("Option 2: (b) Himalayas");
        }

        @Test
        void mcqm_lists_every_correct_option_and_snake_case_ids_are_read_too() {
                List<Option> options = List.of(option("a", "A"), option("b", "B"), option("c", "C"));
                String key = service.correctAnswerFor(
                                question("MCQM", "{\"type\":\"MCQM\",\"data\":{\"correct_option_ids\":[\"a\",\"c\"]}}"),
                                options);
                assertThat(key).isEqualTo("Option 1: A; Option 3: C");
        }

        @Test
        void one_word_and_numeric_get_a_key_but_a_long_answer_never_does() {
                assertThat(service.correctAnswerFor(
                                question("ONE_WORD", "{\"type\":\"ONE_WORD\",\"data\":{\"answer\":\"New Delhi\"}}"),
                                List.of())).isEqualTo("New Delhi");
                assertThat(service.correctAnswerFor(
                                question("NUMERIC", "{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":[4,\"4.0\"]}}"),
                                List.of())).isEqualTo("4 or 4.0");
                // Written answers are graded on the rubric alone, as they always were —
                // a stored reference answer must not turn into a "correct answer" the
                // grader compares wording against.
                assertThat(service.correctAnswerFor(
                                question("LONG_ANSWER",
                                                "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"type\":\"HTML\",\"content\":\"<p>Light &nbsp;and water.</p>\"}}}"),
                                List.of())).isNull();
        }

        @Test
        void no_key_is_null_not_a_made_up_answer() {
                assertThat(service.correctAnswerFor(
                                question("LONG_ANSWER",
                                                "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"type\":\"HTML\",\"content\":\"\"}}}"),
                                List.of())).isNull();
                assertThat(service.correctAnswerFor(
                                question("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"missing\"]}}"),
                                List.of(option("o1", "A")))).isNull();
                assertThat(service.correctAnswerFor(question("MCQS", null), List.of())).isNull();
                assertThat(service.correctAnswerFor(question("MCQS", "not json"), List.of())).isNull();
        }

        @Test
        void rows_are_handed_to_the_grader_in_paper_order() {
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("a1")).thenReturn(List.of(
                                mapping("q-b1", 2, 1), mapping("q-a2", 1, 2), mapping("q-a1", 1, 1)));
                List<QuestionWiseMarks> rows = new java.util.ArrayList<>(List.of(row("q-b1"), row("q-a2"), row("q-a1"), row("q-orphan")));

                List<QuestionWiseMarks> ordered = service.inPaperOrder(rows, assessment);

                org.assertj.core.api.Assertions.assertThat(ordered).extracting(r -> r.getQuestion().getId())
                                .containsExactly("q-a1", "q-a2", "q-b1", "q-orphan");
        }

        private static QuestionAssessmentSectionMapping mapping(String questionId, int sectionOrder, int questionOrder) {
                vacademy.io.assessment_service.features.question_core.entity.Question q = new vacademy.io.assessment_service.features.question_core.entity.Question();
                q.setId(questionId);
                vacademy.io.assessment_service.features.assessment.entity.Section s = new vacademy.io.assessment_service.features.assessment.entity.Section();
                s.setSectionOrder(sectionOrder);
                QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
                m.setQuestion(q);
                m.setSection(s);
                m.setQuestionOrder(questionOrder);
                m.setStatus("ACTIVE");
                return m;
        }

        private static QuestionWiseMarks row(String questionId) {
                vacademy.io.assessment_service.features.question_core.entity.Question q = new vacademy.io.assessment_service.features.question_core.entity.Question();
                q.setId(questionId);
                return QuestionWiseMarks.builder().question(q).build();
        }

        @Test
        void the_printed_number_and_section_come_from_the_digitised_papers_provenance() {
                vacademy.io.assessment_service.features.question_core.entity.Question q = new vacademy.io.assessment_service.features.question_core.entity.Question();
                q.setSourceMeta("{\"paper_url\": \"u\", \"question_number\": \"2\", \"section\": \"Section B\", \"marks\": 1.0}");
                org.assertj.core.api.Assertions.assertThat(service.printedLabel(q)).containsExactly("2", "Section B");
                q.setSourceMeta(null);
                org.assertj.core.api.Assertions.assertThat(service.printedLabel(q)).containsExactly(null, null);
                q.setSourceMeta("not json");
                org.assertj.core.api.Assertions.assertThat(service.printedLabel(q)).containsExactly(null, null);
        }
}
