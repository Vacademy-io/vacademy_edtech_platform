package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.evaluation.service.QuestionEvaluationService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Partner questions go through the dashboard's real
 * {@code AddQuestionPaperFromImportManager.makeQuestionAndOptionFromImportQuestion}; these
 * tests run that manager (no database) to prove the DTO the facade builds lands as the
 * scoring strategies and the copy checker expect.
 */
class QuestionMapperTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private AddQuestionPaperFromImportManager importManager;

    @BeforeEach
    void setUp() {
        QuestionEvaluationService evaluation = new QuestionEvaluationService();
        ReflectionTestUtils.setField(evaluation, "objectMapper", MAPPER);
        importManager = new AddQuestionPaperFromImportManager();
        ReflectionTestUtils.setField(importManager, "questionEvaluationService", evaluation);
    }

    private static ExamValidator.ValidatedQuestion validated(ExamInputs.QuestionInput q, String mode) {
        ExamInputs.CreateExam e = ExamValidatorTest.exam(q);
        e.setMode(mode);
        return ExamValidator.validateCreate(e, LocalDate.of(2026, 10, 1)).questions().get(0);
    }

    @Test
    void mcq_labels_become_option_ids_and_text_is_escaped() throws Exception {
        ExamInputs.QuestionInput in = ExamValidatorTest.mcq("1", "A", "C");
        in.setText("Is 2 < 3 & 5 > 4?\nPick one.");
        ExamValidator.ValidatedQuestion q = validated(in, "handwritten");

        Question question = importManager.makeQuestionAndOptionFromImportQuestion(
                QuestionMapper.toQuestionDto(q, "inst-1"), false, null);
        Map<String, String> byLabel = QuestionMapper.labelOptions(question, q, false);

        assertThat(question.getTextData().getContent()).isEqualTo("Is 2 &lt; 3 &amp; 5 &gt; 4?<br>Pick one.");
        assertThat(question.getQuestionType()).isEqualTo("MCQS");
        assertThat(question.getSourceType()).isEqualTo("API");
        assertThat(byLabel).containsOnlyKeys("A", "B", "C");
        JsonNode key = MAPPER.readTree(question.getAutoEvaluationJson()).path("data").path("correctOptionIds");
        assertThat(key).hasSize(1);
        assertThat(key.get(0).asText()).isEqualTo(byLabel.get("C"));

        JsonNode meta = MAPPER.readTree(question.getSourceMeta());
        assertThat(meta.path("source").asText()).isEqualTo("API");
        assertThat(meta.path("question_number").asText()).isEqualTo("1");
        assertThat(meta.path("section").asText()).isEqualTo("A");
        assertThat(meta.path("option_labels").path("C").asText()).isEqualTo(byLabel.get("C"));

        ExamViews.Question view = QuestionMapper.toView(question,
                QuestionMapper.markingJson("MCQS", BigDecimal.ONE, BigDecimal.ZERO), true);
        assertThat(view.getText()).isEqualTo("Is 2 < 3 & 5 > 4?\nPick one.");
        assertThat(view.getType()).isEqualTo("mcq_single");
        assertThat(view.getCorrectOptions()).containsExactly("C");
        assertThat(view.getOptions()).extracting(ExamViews.Option::label).containsExactly("A", "B", "C");
        assertThat(view.getMaxMarks()).isEqualTo(1.0);

        ExamViews.Question compact = QuestionMapper.toView(question, null, false);
        assertThat(compact.getText()).isNull();
        assertThat(compact.getOptions()).extracting(ExamViews.Option::text).containsOnlyNulls();
    }

    @Test
    void long_answer_keeps_the_escaped_model_answer_where_typed_grading_reads_it() throws Exception {
        ExamInputs.QuestionInput in = ExamValidatorTest.longAnswer("21", "B", "2");
        in.setModelAnswer("Glucose -> CO2 + H2O <energy>");
        ExamValidator.ValidatedQuestion q = validated(in, "typed");

        Question question = importManager.makeQuestionAndOptionFromImportQuestion(
                QuestionMapper.toQuestionDto(q, "inst-1"), false, null);

        JsonNode answer = MAPPER.readTree(question.getAutoEvaluationJson()).path("data").path("answer");
        assertThat(answer.path("content").asText()).isEqualTo("Glucose -&gt; CO2 + H2O &lt;energy&gt;");
        assertThat(QuestionMapper.modelAnswer(question)).isEqualTo("Glucose -> CO2 + H2O <energy>");

        question.setAutoEvaluationJson(QuestionMapper.withModelAnswer(question.getAutoEvaluationJson(), null));
        assertThat(QuestionMapper.modelAnswer(question)).isNull();
    }

    @Test
    void numeric_answers_land_as_valid_answers() throws Exception {
        ExamInputs.QuestionInput in = ExamValidatorTest.longAnswer("5", "A", "1");
        in.setType("numeric");
        in.setAnswer(MAPPER.readTree("[9.8, 9.81]"));
        ExamValidator.ValidatedQuestion q = validated(in, "typed");
        Question question = importManager.makeQuestionAndOptionFromImportQuestion(
                QuestionMapper.toQuestionDto(q, "inst-1"), false, null);
        assertThat(MAPPER.readTree(question.getAutoEvaluationJson()).path("data").path("validAnswers").toString())
                .isEqualTo("[9.8,9.81]");
        ExamViews.Question view = QuestionMapper.toView(question, null, true);
        assertThat(view.getAnswer()).isEqualTo(List.of(9.8, 9.81));
    }

    @Test
    void one_word_answer_round_trips() throws Exception {
        ExamInputs.QuestionInput in = ExamValidatorTest.longAnswer("6", "A", "1");
        in.setType("one_word");
        in.setAnswer(JsonNodeFactory.instance.textNode("Mitochondria"));
        ExamValidator.ValidatedQuestion q = validated(in, "typed");
        Question question = importManager.makeQuestionAndOptionFromImportQuestion(
                QuestionMapper.toQuestionDto(q, "inst-1"), false, null);
        assertThat(QuestionMapper.toView(question, null, true).getAnswer()).isEqualTo("Mitochondria");
    }

    @Test
    void marking_json_has_the_shape_the_strategies_read_and_marks_can_be_rewritten() throws Exception {
        String json = QuestionMapper.markingJson("LONG_ANSWER", new BigDecimal("2.5"), BigDecimal.ZERO);
        JsonNode node = MAPPER.readTree(json);
        assertThat(node.path("type").asText()).isEqualTo("LONG_ANSWER");
        assertThat(node.path("data").path("totalMark").asDouble()).isEqualTo(2.5);
        assertThat(node.path("data").path("negativeMark").asDouble()).isEqualTo(0.0);
        assertThat(node.path("data").path("negativeMarkingPercentage").asInt()).isZero();

        String rewritten = QuestionMapper.withMarks(json, "LONG_ANSWER", new BigDecimal("4"), null);
        assertThat(QuestionMapper.totalMark(rewritten)).isEqualTo(4.0);
        assertThat(QuestionMapper.negativeMark(rewritten)).isEqualTo(0.0);
        assertThat(QuestionMapper.totalMark("not json")).isNull();
    }

    @Test
    void source_meta_carries_partner_fields() throws Exception {
        ExamInputs.QuestionInput in = ExamValidatorTest.longAnswer("3(a)", "B", "5");
        in.setParentLabel("3");
        in.setTags(Map.of("co", "CO2", "bloom", "apply"));
        in.setExternalId("Q-77");
        in.setExpectsDiagram(true);
        in.setWordLimit(150);
        ExamValidator.ValidatedQuestion q = validated(in, "handwritten");
        Question question = new Question();
        question.setQuestionType("LONG_ANSWER");
        QuestionMapper.labelOptions(question, q, true);
        ExamViews.Question view = QuestionMapper.toView(question, null, true);
        assertThat(view.getLabel()).isEqualTo("3(a)");
        assertThat(view.getParentLabel()).isEqualTo("3");
        assertThat(view.getSection()).isEqualTo("B");
        assertThat(view.getExternalId()).isEqualTo("Q-77");
        assertThat(view.getExpectsDiagram()).isTrue();
        assertThat(view.getWordLimit()).isEqualTo(150);
        assertThat(view.getTags()).containsEntry("co", "CO2");
        assertThat(MAPPER.readTree(question.getSourceMeta()).path("rubric_source").asText()).isEqualTo("partner");
    }
}
