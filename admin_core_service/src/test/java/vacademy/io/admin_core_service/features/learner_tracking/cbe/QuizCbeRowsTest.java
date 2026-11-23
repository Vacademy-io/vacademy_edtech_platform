package vacademy.io.admin_core_service.features.learner_tracking.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class QuizCbeRowsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String CLIENT = """
            {"questionName":"Prepare the SFP","questionType":"CBE_RESPONSE","type":"CBE_RESPONSE",
             "marks":10,"maxMarks":10,"isCorrect":true,
             "answer":{"parts":{"p_a":{"kind":"SPREADSHEET","sheet":{"sheets":[{"name":"S","cells":{"B7":{"v":3000}}}]}}}}}
            """;

    @Test
    @DisplayName("the stored row keeps the answer and drops every mark the client claimed")
    void pendingDropsClaims() {
        JsonNode answer = QuizCbeRows.answerOf(CLIENT);
        JsonNode row = QuizCbeRows.pending(CLIENT, answer, 10.0);

        assertThat(row.path("marks").asDouble()).isEqualTo(0.0);
        assertThat(row.path("isCorrect").asBoolean()).isFalse();
        assertThat(row.path("maxMarks").asDouble()).isEqualTo(10.0);
        assertThat(row.path("cbeState").asText()).isEqualTo("PENDING");
        assertThat(row.path("type").asText()).isEqualTo("CBE_RESPONSE");
        assertThat(row.path("questionName").asText()).isEqualTo("Prepare the SFP");
        assertThat(row.path("answer").toString()).contains("3000");
        assertThat(QuizCbeRows.pendingStatus(answer)).isEqualTo("SUBMITTED");
    }

    @Test
    @DisplayName("an empty answer is stored as skipped")
    void emptyAnswerIsSkipped() {
        String client = "{\"answer\":{\"parts\":{\"p_a\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>&nbsp;</p>\"}}}}";
        JsonNode answer = QuizCbeRows.answerOf(client);
        JsonNode row = QuizCbeRows.pending(client, answer, 4.0);

        assertThat(row.path("cbeState").asText()).isEqualTo("SKIPPED");
        assertThat(row.path("answer").isNull()).isTrue();
        assertThat(QuizCbeRows.pendingStatus(answer)).isEqualTo("SKIPPED");
        assertThat(QuizCbeRows.pendingStatus(null)).isEqualTo("SKIPPED");
    }

    @Test
    @DisplayName("the answer is found under answer, cbeAnswer or at the top level")
    void answerShapes() {
        assertThat(QuizCbeRows.answerOf("{\"cbeAnswer\":{\"parts\":{}}}")).isNotNull();
        assertThat(QuizCbeRows.answerOf("{\"parts\":{}}")).isNotNull();
        assertThat(QuizCbeRows.answerOf("{\"selectedOptions\":[]}")).isNull();
        assertThat(QuizCbeRows.answerOf("not json")).isNull();
    }

    @Test
    @DisplayName("question maximum: own marks, else the parts total, else the quiz default")
    void questionMaximum() {
        String config = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":[{\"id\":\"a\",\"marks\":6},{\"id\":\"b\",\"marks\":4}]}}";
        assertThat(QuizCbeRows.questionMaxMarks(12.0, config, 1.0)).isEqualTo(12.0);
        assertThat(QuizCbeRows.questionMaxMarks(null, config, 1.0)).isEqualTo(10.0);
        assertThat(QuizCbeRows.questionMaxMarks(null, "{}", 2.0)).isEqualTo(2.0);
        assertThat(QuizCbeRows.gradedStatus(10, 10)).isEqualTo("CORRECT");
        assertThat(QuizCbeRows.gradedStatus(9.5, 10)).isEqualTo("WRONG");
    }
}
