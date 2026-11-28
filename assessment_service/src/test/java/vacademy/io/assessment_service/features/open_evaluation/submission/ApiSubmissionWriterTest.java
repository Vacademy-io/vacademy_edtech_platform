package vacademy.io.assessment_service.features.open_evaluation.submission;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineResponseSubmitRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.QuestionAttemptData;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ApiSubmissionWriterTest {

    @Test
    void groups_answers_by_section_in_paper_order_with_the_database_type() {
        List<TypedAnswers.Resolved> resolved = TypedAnswers.resolve(TypedAnswersTest.paper(), List.of(
                new SubmissionInputs.AnswerInput("q5", null, "Energy is released.", null, null),
                new SubmissionInputs.AnswerInput("q1", null, null, List.of("C"), null),
                new SubmissionInputs.AnswerInput("q3", null, null, null, JsonNodeFactory.instance.numberNode(7))));

        OfflineResponseSubmitRequest request = ApiSubmissionWriter.request(resolved);

        assertThat(request.getSections()).hasSize(2);
        assertThat(request.getSections().get(0).getSectionId()).isEqualTo("sec-A");
        assertThat(request.getSections().get(0).getQuestions()).extracting("questionId").containsExactly("q1", "q3");
        assertThat(request.getSections().get(0).getQuestions().get(0).getType()).isEqualTo("MCQS");
        assertThat(request.getSections().get(0).getQuestions().get(0).getOptionIds()).containsExactly("o3");
        assertThat(request.getSections().get(0).getQuestions().get(1).getValidAnswer()).isEqualTo(7.0);
        assertThat(request.getSections().get(1).getQuestions().get(0).getAnswer()).isEqualTo("Energy is released.");
        assertThat(request.getSections().get(1).getQuestions().get(0).getType()).isEqualTo("LONG_ANSWER");
    }

    /**
     * Regression (live probe 2026-10-02): the raw answer was read as HTML by ai_service
     * ({@code typed_answers.answer_text}), so "< energy out and out >" was deleted as a tag.
     * Stored escaped, answer_text gives back exactly what was typed: it turns {@code <br>} into
     * a newline, finds no tag to drop, and html.unescape restores the characters (checked by
     * running answer_text on these strings: "x &lt; 5 and y &gt; 3<br>line2" ->
     * "x < 5 and y > 3\nline2"; "a &amp;lt; b" -> "a &lt; b").
     */
    @Test
    void long_answers_are_stored_escaped_so_the_grader_sees_the_exact_text() {
        List<TypedAnswers.Resolved> resolved = TypedAnswers.resolve(TypedAnswersTest.paper(), List.of(
                new SubmissionInputs.AnswerInput("q5", null, "x < 5 and y > 3\nline2", null, null),
                new SubmissionInputs.AnswerInput("q6", null, "Since a<b, and b>c. Literal: a &lt; b. \"q\" 'a'", null, null),
                new SubmissionInputs.AnswerInput("q4", null, null, null, JsonNodeFactory.instance.textNode("a<b"))));

        OfflineResponseSubmitRequest request = ApiSubmissionWriter.request(resolved);

        assertThat(request.getSections().get(1).getQuestions().get(0).getAnswer())
                .isEqualTo("x &lt; 5 and y &gt; 3<br>line2");
        assertThat(request.getSections().get(1).getQuestions().get(1).getAnswer())
                .isEqualTo("Since a&lt;b, and b&gt;c. Literal: a &amp;lt; b. &quot;q&quot; &#39;a&#39;");
        // one-word answers are matched exactly against the raw key, so they stay as sent
        assertThat(request.getSections().get(0).getQuestions().get(0).getAnswer()).isEqualTo("a<b");
        // the escaped form decodes back to what the partner sent
        assertThat(vacademy.io.common.core.utils.PlainText.unescape(
                request.getSections().get(1).getQuestions().get(0).getAnswer())).isEqualTo("x < 5 and y > 3\nline2");
    }

    @Test
    void validation_runs_on_the_raw_text_not_the_escaped_one() {
        // 20,000 '<' is within the limit raw, although it is 80,000 characters escaped
        String max = "<".repeat(TypedAnswers.MAX_TEXT);
        List<TypedAnswers.Resolved> resolved = TypedAnswers.resolve(TypedAnswersTest.paper(), List.of(
                new SubmissionInputs.AnswerInput("q5", null, max, null, null)));
        assertThat(resolved.get(0).text()).isEqualTo(max);
        assertThat(ApiSubmissionWriter.storedAnswer(resolved.get(0))).hasSize(4 * TypedAnswers.MAX_TEXT);
    }

    @Test
    void writes_through_the_offline_entry_path() {
        AdminOfflineDataEntryManager manager = mock(AdminOfflineDataEntryManager.class);
        StudentAttempt attempt = new StudentAttempt();
        Assessment assessment = new Assessment();

        new ApiSubmissionWriter(manager).writeTyped(attempt, assessment, new ArrayList<>());

        verify(manager).applyResponses(eq(attempt), eq(assessment), any(OfflineResponseSubmitRequest.class));
    }

    @Test
    void option_only_responses_serialize_exactly_as_before() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        QuestionAttemptData.OptionsJson options = QuestionAttemptData.OptionsJson.builder()
                .type("MCQS").optionIds(List.of("o1")).build();
        assertThat(mapper.writeValueAsString(options)).isEqualTo("{\"type\":\"MCQS\",\"optionIds\":[\"o1\"]}");

        QuestionAttemptData.OptionsJson typed = QuestionAttemptData.OptionsJson.builder()
                .type("LONG_ANSWER").optionIds(List.of()).answer("text").build();
        assertThat(mapper.readTree(mapper.writeValueAsString(typed)).path("answer").asText()).isEqualTo("text");
        assertThat(mapper.readTree(mapper.writeValueAsString(typed)).has("validAnswer")).isFalse();
    }
}
