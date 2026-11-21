package vacademy.io.admin_core_service.features.slide.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.slide.dto.QuestionSlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;

import static org.assertj.core.api.Assertions.assertThat;

/** The CBE secret split on the question-slide save path (create and update). */
class QuestionSlideCbeSecretTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String FULL = """
            {"type":"CBE_RESPONSE","data":{"version":1,"gradingNotes":"notes",
              "parts":[{"id":"p_a","label":"(a)","kind":"SPREADSHEET","marks":10,"template":null,
                        "solution":{"html":"<p>secret answer</p>"},
                        "markingScheme":[{"id":"m1","label":"Line","marks":10}],"solutionFileId":null}]}}
            """;
    private static final String STORED_SECRET =
            "{\"parts\":[{\"id\":\"p_a\",\"solution\":{\"html\":\"stored\"}}],\"gradingNotes\":\"stored notes\"}";

    private final QuestionSlideService service = new QuestionSlideService();

    private static QuestionSlideDTO dto(String type, String config, String secret) {
        QuestionSlideDTO dto = new QuestionSlideDTO();
        dto.setId("qs-1");
        dto.setQuestionType(type);
        dto.setAutoEvaluationJson(config);
        dto.setEvaluationSecretJson(secret);
        return dto;
    }

    private static QuestionSlide stored(String type, String config, String secret) {
        QuestionSlide q = new QuestionSlide();
        q.setId("qs-1");
        q.setQuestionType(type);
        q.setAutoEvaluationJson(config);
        q.setEvaluationSecretJson(secret);
        return q;
    }

    @Test
    @DisplayName("create: a careless client that sends the full config still stores it redacted")
    void createSplitsTheSecretOut() throws Exception {
        QuestionSlideDTO dto = dto("CBE_RESPONSE", FULL, null);
        service.separateCbeSecretForCreate(dto);

        QuestionSlide entity = new QuestionSlide(dto);
        assertThat(entity.getAutoEvaluationJson()).doesNotContain("secret answer", "markingScheme", "notes");
        assertThat(MAPPER.readTree(entity.getEvaluationSecretJson()).at("/parts/0/solution/html").asText())
                .isEqualTo("<p>secret answer</p>");
        assertThat(MAPPER.readTree(entity.getEvaluationSecretJson()).path("gradingNotes").asText())
                .isEqualTo("notes");
    }

    @Test
    @DisplayName("create: a non-CBE question stores no secret even if one is sent")
    void createIgnoresSecretForOtherTypes() {
        QuestionSlideDTO dto = dto("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}",
                STORED_SECRET);
        service.separateCbeSecretForCreate(dto);
        assertThat(dto.getEvaluationSecretJson()).isNull();
        assertThat(dto.getAutoEvaluationJson()).contains("correctOptionIds");
    }

    @Test
    @DisplayName("update: a redacted config with no secret does not wipe the stored secret")
    void updateWithoutSecretKeepsStored() {
        String redacted = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":[{\"id\":\"p_a\",\"marks\":12}]}}";
        QuestionSlide entity = stored("CBE_RESPONSE", redacted, STORED_SECRET);

        service.updateData(dto(null, redacted.replace("12", "14"), null), entity);
        assertThat(entity.getEvaluationSecretJson()).isEqualTo(STORED_SECRET);
        assertThat(entity.getAutoEvaluationJson()).contains("14");

        service.updateData(dto(null, null, "   "), entity);
        assertThat(entity.getEvaluationSecretJson()).isEqualTo(STORED_SECRET);

        service.updateData(dto("CBE_RESPONSE", redacted, "{}"), entity);
        assertThat(entity.getEvaluationSecretJson()).isEqualTo(STORED_SECRET);
    }

    @Test
    @DisplayName("update: the full config is stored redacted and its secret replaces the stored part")
    void updateWithFullConfigSplits() throws Exception {
        QuestionSlide entity = stored("CBE_RESPONSE", "{}", STORED_SECRET);
        service.updateData(dto(null, FULL, null), entity);

        assertThat(entity.getAutoEvaluationJson()).doesNotContain("secret answer", "gradingNotes");
        var secret = MAPPER.readTree(entity.getEvaluationSecretJson());
        assertThat(secret.at("/parts/0/solution/html").asText()).isEqualTo("<p>secret answer</p>");
        assertThat(secret.path("gradingNotes").asText()).isEqualTo("notes");
    }

    @Test
    @DisplayName("update: an explicit evaluation_secret_json replaces the stored one")
    void updateWithExplicitSecretReplaces() throws Exception {
        QuestionSlide entity = stored("CBE_RESPONSE", "{}", STORED_SECRET);
        String explicit = "{\"parts\":[{\"id\":\"p_a\",\"solution\":{\"html\":\"explicit\"}}]}";
        service.updateData(dto(null, null, explicit), entity);
        assertThat(MAPPER.readTree(entity.getEvaluationSecretJson())).isEqualTo(MAPPER.readTree(explicit));
        assertThat(entity.getAutoEvaluationJson()).isEqualTo("{}");
    }
}
