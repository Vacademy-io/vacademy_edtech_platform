package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader.Graded;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader.Option;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader.Outcome;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader.Question;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader.Rules;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class QuizGraderTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final QuizGrader grader = new QuizGrader(new AutoEvaluationScorer(mapper), mapper);

    private static final List<Option> OPTIONS = List.of(new Option("a", "Alpha"), new Option("b", "Beta"),
            new Option("c", "Gamma"), new Option("d", "Delta"));
    private static final Rules PLAIN = new Rules(2.0, 0.5, false);
    private static final Rules PARTIAL = new Rules(3.0, 1.0, true);

    private static Question mcq(String type, String key) {
        return new Question("q1", type, null, null, key, "What?", "Because", OPTIONS);
    }

    @Test
    @DisplayName("quiz defaults apply when the question sets no marks")
    void quizDefaults() {
        Graded right = grader.grade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, List.of("a"), "server");
        assertThat(right.outcome()).isEqualTo(Outcome.CORRECT);
        assertThat(right.marks()).isEqualTo(2.0);
        assertThat(right.maxMarks()).isEqualTo(2.0);
        assertThat(right.responseStatus()).isEqualTo("CORRECT");

        Graded wrong = grader.grade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, List.of("b"), "server");
        assertThat(wrong.outcome()).isEqualTo(Outcome.WRONG);
        assertThat(wrong.marks()).isEqualTo(-0.5);
        assertThat(wrong.responseStatus()).isEqualTo("WRONG");
    }

    @Test
    @DisplayName("a question's own marks win over the quiz defaults")
    void questionMarksWin() {
        Question own = new Question("q1", "MCQS", 5.0, 2.0, "{\"correctAnswers\":[\"a\"]}", "t", null, OPTIONS);
        assertThat(grader.grade(own, PLAIN, List.of("a"), "server").marks()).isEqualTo(5.0);
        assertThat(grader.grade(own, PLAIN, List.of("b"), "server").marks()).isEqualTo(-2.0);
    }

    @Test
    void zeroNegativeOnQuestionIsNotTheDefault() {
        Question own = new Question("q1", "MCQS", null, 0.0, "{\"correctAnswers\":[\"a\"]}", "t", null, OPTIONS);
        assertThat(grader.grade(own, PLAIN, List.of("b"), "server").marks()).isEqualTo(0.0);
    }

    @Test
    @DisplayName("partial marking pays a correct subset and nothing once a wrong option is picked")
    void partialMarking() {
        Question q = mcq("MCQM", "{\"correctAnswers\":[\"a\",\"b\",\"c\"]}");
        Graded subset = grader.grade(q, PARTIAL, List.of("a", "b"), "server");
        assertThat(subset.outcome()).isEqualTo(Outcome.PARTIAL);
        assertThat(subset.marks()).isCloseTo(2.0, within(1e-9));
        assertThat(subset.responseStatus()).isEqualTo("WRONG");

        Graded withWrong = grader.grade(q, PARTIAL, List.of("a", "d"), "server");
        assertThat(withWrong.outcome()).isEqualTo(Outcome.WRONG);
        assertThat(withWrong.marks()).isEqualTo(-1.0);
    }

    @Test
    void partialMarkingOffPaysNothingForASubset() {
        Question q = mcq("MCQM", "{\"correctAnswers\":[\"a\",\"b\"]}");
        assertThat(grader.grade(q, PLAIN, List.of("a"), "server").outcome()).isEqualTo(Outcome.WRONG);
    }

    @Test
    @DisplayName("an unanswered question earns nothing and loses nothing")
    void skipped() {
        Graded g = grader.grade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, List.of(), "server");
        assertThat(g.outcome()).isEqualTo(Outcome.SKIPPED);
        assertThat(g.marks()).isEqualTo(0);
        assertThat(g.responseStatus()).isEqualTo("SKIPPED");
    }

    @Test
    @DisplayName("what cannot be marked is pending, never wrong")
    void pending() {
        Question longAnswer = new Question("q", "LONG_ANSWER", null, null, "{\"data\":{\"answer\":{\"content\":\"x\"}}}",
                "t", null, List.of());
        Graded typed = grader.grade(longAnswer, PLAIN, List.of("my essay"), "server");
        assertThat(typed.outcome()).isEqualTo(Outcome.PENDING);
        assertThat(typed.marks()).isEqualTo(0);
        assertThat(typed.responseStatus()).isEqualTo("SUBMITTED");

        Graded noKey = grader.grade(mcq("MCQS", ""), PLAIN, List.of("a"), "server");
        assertThat(noKey.outcome()).isEqualTo(Outcome.PENDING);
    }

    @Test
    @DisplayName("option ids the question does not have are dropped")
    void unknownOptionDropped() {
        Graded g = grader.grade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, List.of("not-an-option"), "server");
        assertThat(g.outcome()).isEqualTo(Outcome.SKIPPED);
    }

    @Test
    @DisplayName("response_json keeps the shape review and the activity dialog read")
    void responseJsonShape() throws Exception {
        Graded g = grader.grade(mcq("MCQM", "{\"correctAnswers\":[\"a\",\"b\"]}"), PARTIAL, List.of("a"), "server");
        JsonNode json = mapper.readTree(g.responseJson());
        assertThat(json.path("questionName").asText()).isEqualTo("What?");
        assertThat(json.path("selectedOptions").get(0).path("id").asText()).isEqualTo("a");
        assertThat(json.path("selectedOptions").get(0).path("name").asText()).isEqualTo("Alpha");
        assertThat(json.path("correctOptions")).hasSize(2);
        assertThat(json.path("marks").asDouble()).isEqualTo(1.5);
        assertThat(json.path("maxMarks").asDouble()).isEqualTo(3.0);
        assertThat(json.path("isCorrect").asBoolean()).isFalse();
        assertThat(json.path("isPartial").asBoolean()).isTrue();
        assertThat(json.path("questionType").asText()).isEqualTo("MCQM");
        assertThat(json.path("gradedBy").asText()).isEqualTo("server");
    }

    @Test
    @DisplayName("client marks do not survive a regrade")
    void regradeIgnoresClientMarks() throws Exception {
        String claimed = "{\"questionName\":\"q\",\"selectedOptions\":[{\"id\":\"b\",\"name\":\"Beta\"}],"
                + "\"correctOptions\":[{\"id\":\"b\",\"name\":\"Beta\"}],\"marks\":100,\"maxMarks\":100,\"isCorrect\":true}";
        Graded g = grader.regrade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, claimed, QuizGrader.GRADED_BY_LEGACY);
        assertThat(g.outcome()).isEqualTo(Outcome.WRONG);
        JsonNode json = mapper.readTree(g.responseJson());
        assertThat(json.path("marks").asDouble()).isEqualTo(-0.5);
        assertThat(json.path("maxMarks").asDouble()).isEqualTo(2.0);
        assertThat(json.path("correctOptions").get(0).path("id").asText()).isEqualTo("a");
        assertThat(json.path("gradedBy").asText()).isEqualTo("server-legacy");
    }

    @Test
    void regradeReadsTheOldestPayload() {
        Graded g = grader.regrade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, "{\"answer\":\"a\"}", "server-legacy");
        assertThat(g.outcome()).isEqualTo(Outcome.CORRECT);
    }

    @Test
    void regradeLeavesUnreadableAnswersAlone() {
        assertThat(grader.regrade(mcq("MCQS", "{\"correctAnswers\":[\"a\"]}"), PLAIN, "{\"mystery\":1}", "x")).isNull();
    }

    @Test
    void recognisesTheTutorsRecords() {
        assertThat(grader.isTutorRecord("{\"source\":\"tutor\",\"marks\":1}")).isTrue();
        assertThat(grader.isTutorRecord("{\"source\":\"other\"}")).isFalse();
        assertThat(grader.isTutorRecord("{\"marks\":1}")).isFalse();
        assertThat(grader.isTutorRecord(null)).isFalse();
        assertThat(grader.isTutorRecord("\"source\" not json")).isFalse();
    }

    @Test
    @DisplayName("the total never goes below zero")
    void totalFloor() {
        Graded a = new Graded("a", Outcome.WRONG, -3, 1, "WRONG", "{}");
        Graded b = new Graded("b", Outcome.CORRECT, 1, 1, "CORRECT", "{}");
        assertThat(QuizGrader.totalEarned(List.of(a, b))).isEqualTo(0);
        assertThat(QuizGrader.totalMarks(List.of(a, b))).isEqualTo(2);
    }

    @Test
    @DisplayName("a fail is not reported while answers wait for a person")
    void passRule() {
        assertThat(QuizGrader.passed(5, 10, 0, 50.0)).isTrue();
        assertThat(QuizGrader.passed(4, 10, 0, 50.0)).isFalse();
        assertThat(QuizGrader.passed(4, 10, 1, 50.0)).isNull();
        assertThat(QuizGrader.passed(6, 10, 1, 50.0)).isTrue();
        assertThat(QuizGrader.passed(6, 10, 0, null)).isNull();
        assertThat(QuizGrader.passed(0, 0, 0, 50.0)).isNull();
    }
}
