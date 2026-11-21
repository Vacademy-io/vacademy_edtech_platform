package vacademy.io.admin_core_service.features.slide.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.slide.dto.QuizSlideQuestionDTO;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlide;
import vacademy.io.admin_core_service.features.slide.entity.QuizSlideQuestion;

import static org.assertj.core.api.Assertions.assertThat;

/** The CBE secret split on the quiz-slide save path: new questions and updates. */
class QuizSlideCbeSecretTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String FULL = """
            {"type":"CBE_RESPONSE","data":{"version":1,"gradingNotes":"notes",
              "parts":[{"id":"p_a","label":"(a)","kind":"SPREADSHEET","marks":10,"template":null,
                        "solution":{"html":"<p>secret answer</p>"},
                        "markingScheme":[{"id":"m1","label":"Line","marks":10}],"solutionFileId":null}]}}
            """;
    private static final String REDACTED =
            "{\"type\":\"CBE_RESPONSE\",\"data\":{\"version\":1,\"parts\":[{\"id\":\"p_a\",\"label\":\"(a)\",\"kind\":\"SPREADSHEET\",\"marks\":10,\"template\":null}]}}";
    private static final String STORED_SECRET =
            "{\"parts\":[{\"id\":\"p_a\",\"solution\":{\"html\":\"stored\"}}],\"gradingNotes\":\"stored notes\"}";

    private final QuizSlideService service = new QuizSlideService();

    private static QuizSlideQuestionDTO dto(String type, String config, String secret) {
        QuizSlideQuestionDTO dto = new QuizSlideQuestionDTO();
        dto.setId("qq-1");
        dto.setQuestionType(type);
        dto.setAutoEvaluationJson(config);
        dto.setEvaluationSecretJson(secret);
        return dto;
    }

    private static QuizSlideQuestion stored(String type, String config, String secret) {
        QuizSlideQuestion q = new QuizSlideQuestion();
        q.setId("qq-1");
        q.setQuestionType(type);
        q.setAutoEvaluationJson(config);
        q.setEvaluationSecretJson(secret);
        return q;
    }

    @Test
    @DisplayName("new question: a client that sends the full config still stores it redacted")
    void newQuestionSplitsTheSecretOut() throws Exception {
        QuizSlideQuestion entity = new QuizSlideQuestion(dto("CBE_RESPONSE", FULL, null), new QuizSlide());

        assertThat(entity.getAutoEvaluationJson()).doesNotContain("secret answer", "markingScheme", "notes");
        assertThat(MAPPER.readTree(entity.getAutoEvaluationJson()).at("/data/parts/0/marks").asInt()).isEqualTo(10);
        assertThat(MAPPER.readTree(entity.getEvaluationSecretJson()).at("/parts/0/solution/html").asText())
                .isEqualTo("<p>secret answer</p>");
        assertThat(MAPPER.readTree(entity.getEvaluationSecretJson()).path("gradingNotes").asText()).isEqualTo("notes");
    }

    @Test
    @DisplayName("new question: the editor's explicit secret is stored as sent")
    void newQuestionTakesExplicitSecret() {
        QuizSlideQuestion entity = new QuizSlideQuestion(dto("CBE_RESPONSE", REDACTED, STORED_SECRET), new QuizSlide());

        assertThat(entity.getAutoEvaluationJson()).isEqualTo(REDACTED);
        assertThat(entity.getEvaluationSecretJson()).contains("stored notes");
    }

    @Test
    @DisplayName("new question: anything but CBE is stored exactly as before, with no secret")
    void otherTypesUntouched() {
        String key = "{\"correctAnswers\":[\"o1\"]}";
        QuizSlideQuestion entity = new QuizSlideQuestion(dto("MCQS", key, STORED_SECRET), new QuizSlide());

        assertThat(entity.getAutoEvaluationJson()).isEqualTo(key);
        assertThat(entity.getEvaluationSecretJson()).isNull();
    }

    @Test
    @DisplayName("update: a save without the secret (editor could not load it) keeps the stored one")
    void updateWithoutSecretKeepsStored() {
        QuizSlideQuestion question = stored("CBE_RESPONSE", REDACTED, STORED_SECRET);
        QuizSlideQuestionDTO dto = dto("CBE_RESPONSE", REDACTED, null);

        service.applyCbeSecretOnUpdate(dto, question);

        assertThat(question.getEvaluationSecretJson()).isEqualTo(STORED_SECRET);
        assertThat(dto.getAutoEvaluationJson()).isEqualTo(REDACTED);
    }

    @Test
    @DisplayName("update: an explicit secret replaces the stored one, and a full config is redacted")
    void updateReplacesSecret() throws Exception {
        QuizSlideQuestion question = stored("CBE_RESPONSE", REDACTED, STORED_SECRET);
        QuizSlideQuestionDTO dto = dto("CBE_RESPONSE", FULL, null);

        service.applyCbeSecretOnUpdate(dto, question);

        assertThat(dto.getAutoEvaluationJson()).doesNotContain("secret answer", "notes");
        assertThat(MAPPER.readTree(question.getEvaluationSecretJson()).at("/parts/0/solution/html").asText())
                .isEqualTo("<p>secret answer</p>");
    }

    @Test
    @DisplayName("update: a question switched away from CBE drops its secret")
    void typeSwitchDropsSecret() {
        QuizSlideQuestion question = stored("CBE_RESPONSE", REDACTED, STORED_SECRET);

        service.applyCbeSecretOnUpdate(dto("MCQS", "{\"correctAnswers\":[\"o1\"]}", null), question);

        assertThat(question.getEvaluationSecretJson()).isNull();
    }
}
