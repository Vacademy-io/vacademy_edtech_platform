package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer.Verdict;
import vacademy.io.admin_core_service.features.slide.entity.Option;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Grading and answer keys of QUESTION slides, in the key shapes the slide editor writes. */
class QuestionSlideGraderTest {

    private final QuestionSlideGrader grader = new QuestionSlideGrader(new AutoEvaluationScorer(new ObjectMapper()));

    private static QuestionSlide question(String type, String key, String... optionIds) {
        QuestionSlide q = new QuestionSlide();
        q.setId("qs-1");
        q.setQuestionType(type);
        q.setAutoEvaluationJson(key);
        List<Option> options = new ArrayList<>();
        for (int i = 0; i < optionIds.length; i++) {
            Option o = new Option();
            o.setId(optionIds[i]);
            o.setCreatedOn(new Timestamp(1_000L * (i + 1)));
            options.add(o);
        }
        // Stored out of order: positions follow created_on, not list order.
        java.util.Collections.reverse(options);
        q.setOptions(options);
        return q;
    }

    private static String picked(String... ids) {
        StringBuilder sb = new StringBuilder("{\"questionName\":\"q\",\"selectedOptions\":[");
        for (int i = 0; i < ids.length; i++) {
            sb.append(i == 0 ? "" : ",").append("{\"id\":\"").append(ids[i]).append("\",\"name\":\"<p>x</p>\"}");
        }
        return sb.append("]}").toString();
    }

    @Test
    @DisplayName("single choice keyed as data.correctOptionIds: right and wrong picks")
    void singleChoice() {
        QuestionSlide q = question("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"b\"]}}", "a", "b", "c");

        assertThat(grader.grade(q, picked("b"))).isEqualTo(Verdict.CORRECT);
        assertThat(grader.grade(q, picked("a"))).isEqualTo(Verdict.WRONG);
        assertThat(grader.answerKey(q).correctOptionIds()).containsExactly("b");
    }

    @Test
    @DisplayName("multiple choice needs exactly the keyed options")
    void multipleChoice() {
        QuestionSlide q = question("MCQM", "{\"type\":\"MCQM\",\"data\":{\"correctOptionIds\":[\"a\",\"c\"]}}", "a", "b", "c");

        assertThat(grader.grade(q, picked("c", "a"))).isEqualTo(Verdict.CORRECT);
        assertThat(grader.grade(q, picked("a"))).isEqualTo(Verdict.WRONG);
        assertThat(grader.grade(q, picked("a", "b", "c"))).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("a key stored as positions resolves through options ordered by created_on")
    void positionalKey() {
        QuestionSlide q = question("TRUE_FALSE", "{\"type\":\"TRUE_FALSE\",\"data\":{\"correctOptionIds\":[\"1\"]}}",
                "opt-true", "opt-false");

        assertThat(grader.grade(q, picked("opt-false"))).isEqualTo(Verdict.CORRECT);
        assertThat(grader.answerKey(q).correctOptionIds()).containsExactly("opt-false");
    }

    @Test
    @DisplayName("numeric compares as numbers and shows the accepted values")
    void numeric() {
        QuestionSlide q = question("NUMERIC", "{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":[2.5]}}");

        assertThat(grader.grade(q, picked("2.50"))).isEqualTo(Verdict.CORRECT);
        assertThat(grader.grade(q, picked("3"))).isEqualTo(Verdict.WRONG);
        assertThat(grader.answerKey(q).correctAnswers()).containsExactly("2.5");
    }

    @Test
    @DisplayName("one word: case and spacing ignored, as in assessments")
    void oneWord() {
        QuestionSlide q = question("ONE_WORD", "{\"type\":\"ONE_WORD\",\"data\":{\"answer\":\"Accrual  basis\"}}");

        assertThat(grader.grade(q, picked("  accrual basis "))).isEqualTo(Verdict.CORRECT);
        assertThat(grader.grade(q, picked("cash"))).isEqualTo(Verdict.WRONG);
        assertThat(grader.grade(q, "{\"selectedOptions\":[]}")).isEqualTo(Verdict.SKIPPED);
        assertThat(grader.answerKey(q).correctAnswers()).containsExactly("Accrual  basis");
    }

    @Test
    @DisplayName("long answers are never graded; the model answer is the key")
    void longAnswer() {
        QuestionSlide q = question("LONG_ANSWER",
                "{\"type\":\"ONE_WORD\",\"data\":{\"answer\":{\"id\":null,\"type\":\"HTML\",\"content\":\"<p>Model</p>\"}}}");

        assertThat(grader.grade(q, picked("anything"))).isEqualTo(Verdict.UNKNOWN);
        assertThat(grader.answerKey(q).correctAnswers()).containsExactly("<p>Model</p>");
    }

    @Test
    @DisplayName("an empty key grades nothing and reveals nothing")
    void emptyKey() {
        QuestionSlide q = question("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[]}}", "a", "b");

        assertThat(grader.grade(q, picked("a"))).isEqualTo(Verdict.UNKNOWN);
        assertThat(grader.answerKey(q).isEmpty()).isTrue();
    }

    @Test
    @DisplayName("a keyed option that is no longer on the question is not revealed")
    void staleOptionNotRevealed() {
        QuestionSlide q = question("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"gone\",\"b\"]}}", "a", "b");

        assertThat(grader.answerKey(q).correctOptionIds()).containsExactly("b");
    }

    @Test
    @DisplayName("Spreadsheet & Written Response is left to the AI check")
    void cbeUntouched() {
        QuestionSlide q = question("CBE_RESPONSE", "{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":[]}}");

        assertThat(grader.grade(q, "{\"answer\":{}}")).isEqualTo(Verdict.UNKNOWN);
        assertThat(grader.answerKey(q).isEmpty()).isTrue();
    }
}
