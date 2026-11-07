package vacademy.io.assessment_service.features.open_evaluation.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenEvaluationExceptionHandler;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** A NUL (U+0000) in any partner JSON string is 422 invalid_characters, never a 500 from Postgres. */
class NulCharacterGuardTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicInteger reached = new AtomicInteger();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new Stub(reached))
                .setControllerAdvice(new NulCharacterGuard(mapper), new OpenEvaluationExceptionHandler())
                .build();
    }

    private static byte[] json(String raw) {
        return raw.getBytes(StandardCharsets.UTF_8);
    }

    private String fieldOf(String raw) {
        try {
            NulCharacterGuard.reject(json(raw), mapper);
            return null;
        } catch (OpenApiException e) {
            assertThat(e.getStatus().value()).isEqualTo(422);
            @SuppressWarnings("unchecked")
            List<Map<String, String>> errors = (List<Map<String, String>>) e.getDetails().get("errors");
            assertThat(errors.get(0).get("code")).isEqualTo("invalid_characters");
            return errors.get(0).get("field");
        }
    }

    @Test
    void names_the_field_holding_the_nul() {
        assertThat(fieldOf("{\"title\":\"a\\u0000b\"}")).isEqualTo("title");
        assertThat(fieldOf("{\"title\":\"ok\",\"questions\":[{\"text\":\"ok\"},{\"text\":\"x\\u0000\"}]}"))
                .isEqualTo("questions[1].text");
        assertThat(fieldOf("{\"questions\":[{\"rubric\":{\"criteria\":[{\"guidance\":\"\\u0000\"}]}}]}"))
                .isEqualTo("questions[0].rubric.criteria[0].guidance");
        assertThat(fieldOf("{\"candidates\":[{\"external_id\":\"S\\u00001\"}]}")).isEqualTo("candidates[0].external_id");
        assertThat(fieldOf("{\"answers\":[{\"question_label\":\"1\",\"text\":\"energy\\u0000\"}]}"))
                .isEqualTo("answers[0].text");
        assertThat(fieldOf("{\"metadata\":{\"k\\u0000\":\"v\"}}")).isEqualTo("metadata.k\\u0000");
        assertThat(fieldOf("\"\\u0000\"")).isEqualTo("body");
    }

    @Test
    void a_trailing_nul_is_refused_too_not_trimmed_away() {
        // trim() drops a trailing NUL ("1" + NUL becomes "1"): the old path stored the label silently.
        assertThat(fieldOf("{\"questions\":[{\"label\":\"1\\u0000\"}]}")).isEqualTo("questions[0].label");
    }

    @Test
    void ordinary_bodies_and_an_escaped_backslash_u0000_pass() {
        assertThatCode(() -> NulCharacterGuard.reject(json("{\"title\":\"x < 5 \\n\\t\"}"), mapper)).doesNotThrowAnyException();
        // a backslash followed by "u0000" typed literally (JSON "\\" + "u0000") is text, not a NUL
        assertThatCode(() -> NulCharacterGuard.reject(json("{\"title\":\"\\\\u0000\"}"), mapper)).doesNotThrowAnyException();
        assertThatCode(() -> NulCharacterGuard.reject(json("not json u0000"), mapper)).doesNotThrowAnyException();
        assertThatCode(() -> NulCharacterGuard.reject(null, mapper)).doesNotThrowAnyException();
    }

    @Test
    void the_endpoint_answers_422_in_the_envelope_and_never_runs() throws Exception {
        mvc.perform(post("/stub").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Half\\u0000yearly\",\"mode\":\"typed\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"))
                .andExpect(jsonPath("$.error.details.errors[0].field").value("title"))
                .andExpect(jsonPath("$.error.details.errors[0].code").value("invalid_characters"));
        assertThat(reached).hasValue(0);
    }

    @Test
    void a_clean_body_still_reaches_the_controller_intact() throws Exception {
        mvc.perform(post("/stub").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Half yearly\",\"mode\":\"typed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Half yearly"));
        mvc.perform(post("/stub-tree").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"metadata\":{\"note\":\"\\u0000\"}}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.details.errors[0].field").value("metadata.note"));
        assertThat(reached).hasValue(1);
    }

    @Test
    void postgres_refusing_a_character_is_422_not_500() throws Exception {
        // Safety net for anything the body guard cannot see (e.g. a query parameter).
        mvc.perform(post("/stub-db").param("sql_state", "22021"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"))
                .andExpect(jsonPath("$.error.details.errors[0].code").value("invalid_characters"));
        mvc.perform(post("/stub-db").param("sql_state", "22P05"))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(post("/stub-db").param("sql_state", "23505"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("internal_error"));
    }

    @RestController
    static class Stub {
        private final AtomicInteger reached;

        Stub(AtomicInteger reached) {
            this.reached = reached;
        }

        @PostMapping("/stub")
        Map<String, Object> create(@RequestBody ExamInputs.CreateExam body) {
            reached.incrementAndGet();
            return Map.of("title", body.getTitle());
        }

        @PostMapping("/stub-db")
        Map<String, Object> db(@org.springframework.web.bind.annotation.RequestParam("sql_state") String sqlState) {
            throw new org.springframework.dao.DataIntegrityViolationException("could not execute statement",
                    new RuntimeException("flush", new java.sql.SQLException("ERROR from Postgres", sqlState)));
        }

        @PostMapping("/stub-tree")
        Map<String, Object> tree(@RequestBody JsonNode body) {
            reached.incrementAndGet();
            return Map.of();
        }
    }
}
