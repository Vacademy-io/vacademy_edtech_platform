package vacademy.io.assessment_service.features.open_evaluation.idempotency;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenEvaluationExceptionHandler;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code Idempotent-Replayed: true} on the wire (spec 7.0), through the MVC stack and the
 * partner error advice, over an in-memory api_idempotency_key: the stored-response replay of
 * a success and of a stored 4xx carry it; the first call and a natural-key 409 (never stored)
 * do not.
 *
 * <p>The live lifecycle probe of 2026-10-02 saw the header on replays of POST /exams,
 * POST /exams/{id}/submissions and unfinalize. A client that reads it case-sensitively
 * ({@code dict(headers).get("Idempotent-Replayed")}) can miss it behind Cloudflare, which may
 * send header names in lower case; HTTP header names are case-insensitive.
 */
@SuppressWarnings("unchecked")
class IdempotencyReplayStackTest {

    private static final Instant NOW = Instant.parse("2026-10-02T10:00:00Z");
    private static final ApiKeyPrincipal KEY = ApiKeyPrincipal.builder().keyId("k1").instituteId("inst-1").build();

    private final Map<String, Object[]> table = new HashMap<>();
    private final AtomicInteger runs = new AtomicInteger();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.update(anyString(), any(SqlParameterSource.class))).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            MapSqlParameterSource p = inv.getArgument(1);
            String key = (String) p.getValue("idemKey");
            if (sql.contains("INSERT INTO api_idempotency_key")) {
                if (table.containsKey(key)) {
                    return 0;
                }
                table.put(key, new Object[] {p.getValue("hash"), "IN_PROGRESS", null, null, false,
                        Timestamp.valueOf(LocalDateTime.ofInstant(NOW, ZoneOffset.UTC))});
                return 1;
            }
            if (sql.contains("SET status = 'COMPLETED'")) {
                Object[] row = table.get(key);
                row[1] = "COMPLETED";
                row[2] = p.getValue("status");
                row[3] = p.getValue("body");
                row[4] = p.getValue("bodyStored");
                return 1;
            }
            if (sql.startsWith("DELETE") && sql.contains("IN_PROGRESS")) {
                Object[] row = table.get(key);
                if (row != null && "IN_PROGRESS".equals(row[1])) {
                    table.remove(key);
                    return 1;
                }
            }
            return 0;
        });
        when(jdbc.query(anyString(), any(SqlParameterSource.class), any(RowMapper.class))).thenAnswer(inv -> {
            MapSqlParameterSource p = inv.getArgument(1);
            Object[] row = table.get((String) p.getValue("idemKey"));
            return row == null ? List.of() : List.of(new IdempotencyService.StoredKey((String) row[0], (String) row[1],
                    (Integer) row[2], (String) row[3], (Boolean) row[4], null, (Timestamp) row[5]));
        });
        IdempotencyService idempotency = new IdempotencyService(jdbc, new ObjectMapper(), Clock.fixed(NOW, ZoneOffset.UTC));
        mvc = MockMvcBuilders.standaloneSetup(new Stub(idempotency, runs))
                .setControllerAdvice(new OpenEvaluationExceptionHandler())
                .build();
    }

    @Test
    void a_stored_success_is_replayed_with_the_header_and_never_runs_again() throws Exception {
        mvc.perform(post("/stub/create").header("Idempotency-Key", "k-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().doesNotExist("Idempotent-Replayed"));
        mvc.perform(post("/stub/create").header("Idempotency-Key", "k-1").contentType(MediaType.APPLICATION_JSON)
                        .content("{ \"title\" : \"x\" }"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotent-Replayed", "true"))
                .andExpect(jsonPath("$.id").value("exam-1"));
        assertThat(runs).hasValue(1);
    }

    @Test
    void a_stored_422_is_replayed_with_the_header_in_the_envelope() throws Exception {
        mvc.perform(post("/stub/invalid").header("Idempotency-Key", "k-2").contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(header().doesNotExist("Idempotent-Replayed"));
        mvc.perform(post("/stub/invalid").header("Idempotency-Key", "k-2").contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(header().string("Idempotent-Replayed", "true"))
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
        assertThat(runs).hasValue(1);
    }

    @Test
    void a_natural_key_409_is_not_stored_so_it_is_never_a_replay() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/stub/exists").header("Idempotency-Key", "k-3").contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isConflict())
                    .andExpect(header().doesNotExist("Idempotent-Replayed"))
                    .andExpect(jsonPath("$.error.details.submission_id").value("sub-1"));
        }
        assertThat(runs).hasValue(2);
    }

    @RestController
    static class Stub {
        private final IdempotencyService idempotency;
        private final AtomicInteger runs;

        Stub(IdempotencyService idempotency, AtomicInteger runs) {
            this.idempotency = idempotency;
            this.runs = runs;
        }

        @PostMapping("/stub/create")
        ResponseEntity<?> create(@RequestBody Map<String, Object> body,
                @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
                HttpServletRequest request) {
            return idempotency.execute(KEY, idemKey, "POST", request.getRequestURI(), body, false, r -> "exam-1", null,
                    () -> {
                        runs.incrementAndGet();
                        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", "exam-1"));
                    });
        }

        @PostMapping("/stub/invalid")
        ResponseEntity<?> invalid(@RequestBody Map<String, Object> body,
                @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
                HttpServletRequest request) {
            return idempotency.execute(KEY, idemKey, "POST", request.getRequestURI(), body, false, r -> null, null,
                    () -> {
                        runs.incrementAndGet();
                        throw OpenApiException.validation("title", "required", "title is required.");
                    });
        }

        @PostMapping("/stub/exists")
        ResponseEntity<?> exists(@RequestBody Map<String, Object> body,
                @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
                HttpServletRequest request) {
            return idempotency.execute(KEY, idemKey, "POST", request.getRequestURI(), body, false, r -> null, null,
                    () -> {
                        runs.incrementAndGet();
                        throw OpenApiException.conflict("submission_exists", "exists", Map.of("submission_id", "sub-1"));
                    });
        }
    }
}
