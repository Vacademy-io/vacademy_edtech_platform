package vacademy.io.assessment_service.features.open_evaluation.submission;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TypedAnswersTest {

    static List<OpenQuestionService.ExamQuestion> paper() {
        OpenQuestionService.ExamQuestion mcq = OpenFixtures.question("q1", "1", "MCQS", "1", "A", 1);
        mcq.question().setSourceMeta("{\"source\":\"API\",\"question_number\":\"1\",\"section\":\"A\","
                + "\"option_labels\":{\"A\":\"o1\",\"B\":\"o2\",\"C\":\"o3\"}}");
        OpenQuestionService.ExamQuestion multi = OpenFixtures.question("q2", "2", "MCQM", "2", "A", 2);
        multi.question().setSourceMeta("{\"source\":\"API\",\"question_number\":\"2\",\"section\":\"A\","
                + "\"option_labels\":{\"A\":\"m1\",\"B\":\"m2\"}}");
        return new ArrayList<>(List.of(mcq, multi,
                OpenFixtures.question("q3", "3", "NUMERIC", "1", "A", 3),
                OpenFixtures.question("q4", "4", "ONE_WORD", "1", "A", 4),
                OpenFixtures.question("q5", "5(a)", "LONG_ANSWER", "5", "B", 1),
                OpenFixtures.question("q6", "6", "LONG_ANSWER", "5", "B", 2)));
    }

    static SubmissionInputs.AnswerInput text(String id, String label, String text) {
        return new SubmissionInputs.AnswerInput(id, label, text, null, null);
    }

    @Test
    void resolves_by_id_and_label_and_translates_option_labels() {
        List<TypedAnswers.Resolved> out = TypedAnswers.resolve(paper(), List.of(
                new SubmissionInputs.AnswerInput(null, "1", null, List.of("b"), null),
                new SubmissionInputs.AnswerInput("q2", null, null, List.of("A", "B"), null),
                new SubmissionInputs.AnswerInput("q3", null, null, null, JsonNodeFactory.instance.numberNode(42.5)),
                new SubmissionInputs.AnswerInput("q4", null, null, null, JsonNodeFactory.instance.textNode("Mitochondria")),
                text(null, "5(A)", "Glucose breaks down and releases energy.")));

        assertThat(out).hasSize(5);
        assertThat(out.get(0).optionIds()).containsExactly("o2");
        assertThat(out.get(1).optionIds()).containsExactly("m1", "m2");
        assertThat(out.get(2).numeric()).isEqualTo(42.5);
        assertThat(out.get(3).text()).isEqualTo("Mitochondria");
        assertThat(out.get(4).question().id()).isEqualTo("q5");
        assertThat(out.get(4).internalType()).isEqualTo("LONG_ANSWER");
        assertThat(TypedAnswers.nonBlankLongAnswers(out)).isEqualTo(1);
    }

    @Test
    void blank_answers_are_not_answered_and_not_billed() {
        List<TypedAnswers.Resolved> out = TypedAnswers.resolve(paper(), List.of(
                text("q5", null, "   "),
                new SubmissionInputs.AnswerInput("q1", null, null, List.of(), null)));

        assertThat(out).isEmpty();
        assertThat(TypedAnswers.nonBlankLongAnswers(out)).isZero();
    }

    @Test
    void unknown_option_label_is_422_unknown_option_label() {
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), List.of(
                new SubmissionInputs.AnswerInput("q1", null, null, List.of("Z"), null))))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(ApiErrorCode.UNKNOWN_OPTION_LABEL);
                    assertThat(e.getDetails()).containsEntry("option_label", "Z").containsEntry("question_label", "1");
                });
    }

    @Test
    void hindi_text_is_422_language_not_supported() {
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), List.of(
                text("q6", null, "अनुच्छेद 356 राष्ट्रपति को शक्ति देता है"))))
                .isInstanceOfSatisfying(OpenApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.LANGUAGE_NOT_SUPPORTED));
    }

    @Test
    void wrong_field_unknown_question_and_duplicates_are_validation_errors() {
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), List.of(
                text("q1", null, "B"),
                text("nope", null, "x"),
                text("q5", null, "a"),
                text(null, "5(a)", "b"),
                new SubmissionInputs.AnswerInput("q1", null, null, List.of("A", "B"), null))))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED);
                    @SuppressWarnings("unchecked")
                    List<java.util.Map<String, String>> errors = (List<java.util.Map<String, String>>) e.getDetails().get("errors");
                    assertThat(errors).extracting(m -> m.get("code"))
                            .contains("wrong_field", "unknown", "duplicate");
                });
    }

    @Test
    void single_choice_takes_one_label_and_numeric_needs_a_number() {
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), List.of(
                new SubmissionInputs.AnswerInput("q1", null, null, List.of("A", "B"), null))))
                .isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), List.of(
                new SubmissionInputs.AnswerInput("q3", null, null, null, JsonNodeFactory.instance.textNode("ten")))))
                .isInstanceOf(OpenApiException.class);
    }

    @Test
    void text_longer_than_twenty_thousand_characters_is_refused() {
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), List.of(text("q5", null, "a".repeat(20_001)))))
                .isInstanceOf(OpenApiException.class);
    }

    @Test
    void more_answers_than_questions_is_refused() {
        List<SubmissionInputs.AnswerInput> many = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            many.add(text("q5", null, "x"));
        }
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), many)).isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> TypedAnswers.resolve(paper(), null)).isInstanceOf(OpenApiException.class);
    }
}
