package vacademy.io.assessment_service.features.open_evaluation.idempotency;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Idempotency-Key semantics of spec 7.0. The database is mocked; the SQL shape is asserted. */
@SuppressWarnings("unchecked")
class IdempotencyServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");
    private static final ApiKeyPrincipal KEY = ApiKeyPrincipal.builder().keyId("k1").instituteId("inst-1").build();
    private static final String PATH = "/assessment-service/open/evaluation/v1/exams";

    private NamedParameterJdbcTemplate jdbc;
    private IdempotencyService service;
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicInteger runs = new AtomicInteger();

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        service = new IdempotencyService(jdbc, mapper, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private ResponseEntity<?> run(String idemKey, Object body) {
        return service.execute(KEY, idemKey, "POST", PATH, body, false, r -> null, null, () -> {
            runs.incrementAndGet();
            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", "exam-1", "status", "draft"));
        });
    }

    private void claimSucceeds() {
        when(jdbc.update(contains("INSERT INTO api_idempotency_key"), any(SqlParameterSource.class))).thenReturn(1);
    }

    private void claimConflictsWith(IdempotencyService.StoredKey stored) {
        when(jdbc.update(contains("INSERT INTO api_idempotency_key"), any(SqlParameterSource.class))).thenReturn(0);
        when(jdbc.query(contains("FROM api_idempotency_key"), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(stored));
    }

    private static Timestamp minutesAgo(long m) {
        return Timestamp.valueOf(LocalDateTime.ofInstant(NOW.minusSeconds(m * 60), ZoneOffset.UTC));
    }

    private String hashOf(Object body) {
        return service.fingerprint("POST", PATH, body);
    }

    @Test
    void bodies_with_java_time_fields_fingerprint_instead_of_failing() {
        record Body(String title, java.time.LocalDate examDate, Instant dueAt) {
        }
        Body a = new Body("Mid-term", java.time.LocalDate.of(2026, 10, 1), Instant.parse("2026-10-01T09:00:00Z"));
        Body b = new Body("Mid-term", java.time.LocalDate.of(2026, 10, 1), Instant.parse("2026-10-01T09:00:00Z"));
        Body other = new Body("Mid-term", java.time.LocalDate.of(2026, 10, 2), Instant.parse("2026-10-01T09:00:00Z"));
        assertThat(hashOf(a)).isEqualTo(hashOf(b));
        assertThat(hashOf(a)).isNotEqualTo(hashOf(other));
    }

    @Test
    void without_a_header_the_call_just_runs() {
        ResponseEntity<?> response = run(null, Map.of("title", "x"));
        assertThat(runs).hasValue(1);
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        verify(jdbc, never()).update(anyString(), any(SqlParameterSource.class));
    }

    @Test
    void first_call_runs_and_stores_the_response() {
        claimSucceeds();

        run("abc-1", Map.of("title", "x"));

        assertThat(runs).hasValue(1);
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("SET status = 'COMPLETED'"), params.capture());
        MapSqlParameterSource p = (MapSqlParameterSource) params.getValue();
        assertThat(p.getValue("status")).isEqualTo(201);
        assertThat((String) p.getValue("body")).contains("exam-1");
        assertThat(p.getValue("bodyStored")).isEqualTo(true);
        assertThat(p.getValue("instituteId")).isEqualTo("inst-1");
    }

    @Test
    void a_redacted_response_reaches_the_caller_whole_but_is_stored_without_the_secret() {
        claimSucceeds();

        ResponseEntity<?> response = service.executeRedacted(KEY, "abc-2", "POST", PATH, Map.of("f", 1),
                b -> Map.of("id", "up-1"), () -> ResponseEntity.status(HttpStatus.CREATED)
                        .body(Map.of("id", "up-1", "upload_url", "https://s3/presigned?sig=secret")));

        assertThat((Map<String, Object>) response.getBody()).containsKey("upload_url");
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("SET status = 'COMPLETED'"), params.capture());
        String stored = (String) ((MapSqlParameterSource) params.getValue()).getValue("body");
        assertThat(stored).contains("up-1").doesNotContain("presigned").doesNotContain("secret");
    }

    @Test
    void same_key_and_body_replays_without_running_again() {
        Map<String, Object> body = Map.of("title", "x");
        claimConflictsWith(new IdempotencyService.StoredKey(hashOf(body), "COMPLETED", 201,
                "{\"id\":\"exam-1\",\"status\":\"draft\"}", true, null, minutesAgo(5)));

        ResponseEntity<?> response = run("abc-1", body);

        assertThat(runs).hasValue(0);
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        assertThat(response.getHeaders().getFirst("Idempotent-Replayed")).isEqualTo("true");
        assertThat(((JsonNode) response.getBody()).get("id").asText()).isEqualTo("exam-1");
    }

    @Test
    void body_key_order_does_not_change_the_fingerprint() {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("title", "x");
        a.put("mode", "typed");
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("mode", "typed");
        b.put("title", "x");
        assertThat(hashOf(a)).isEqualTo(hashOf(b));
        assertThat(hashOf(a)).isNotEqualTo(hashOf(Map.of("title", "y", "mode", "typed")));
        assertThat(hashOf(a)).isNotEqualTo(service.fingerprint("POST", PATH + "/other", a));
    }

    @Test
    void same_key_with_a_different_body_is_422() {
        claimConflictsWith(new IdempotencyService.StoredKey(hashOf(Map.of("title", "other")), "COMPLETED", 201,
                "{}", true, null, minutesAgo(5)));

        assertThatThrownBy(() -> run("abc-1", Map.of("title", "x")))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getStatus().value()).isEqualTo(422);
                    assertThat(e.getCode()).isEqualTo("idempotency_key_reused");
                });
        assertThat(runs).hasValue(0);
    }

    @Test
    void same_key_while_running_is_409() {
        Map<String, Object> body = Map.of("title", "x");
        claimConflictsWith(new IdempotencyService.StoredKey(hashOf(body), "IN_PROGRESS", null, null, true, null,
                minutesAgo(1)));

        assertThatThrownBy(() -> run("abc-1", body))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getStatus().value()).isEqualTo(409);
                    assertThat(e.getCode()).isEqualTo("request_in_progress");
                });
        assertThat(runs).hasValue(0);
    }

    @Test
    void an_abandoned_claim_is_taken_over() {
        Map<String, Object> body = Map.of("title", "x");
        when(jdbc.update(contains("INSERT INTO api_idempotency_key"), any(SqlParameterSource.class)))
                .thenReturn(0).thenReturn(1);
        when(jdbc.query(contains("FROM api_idempotency_key"), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(new IdempotencyService.StoredKey(hashOf(body), "IN_PROGRESS", null, null, true,
                        null, minutesAgo(IdempotencyService.STALE_CLAIM_MINUTES + 1))));

        run("abc-1", body);

        verify(jdbc).update(contains("DELETE FROM api_idempotency_key"), any(SqlParameterSource.class));
        assertThat(runs).hasValue(1);
    }

    @Test
    void an_expired_key_is_reused_as_new() {
        Map<String, Object> body = Map.of("title", "x");
        when(jdbc.update(contains("INSERT INTO api_idempotency_key"), any(SqlParameterSource.class)))
                .thenReturn(0).thenReturn(1);
        when(jdbc.query(contains("FROM api_idempotency_key"), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(new IdempotencyService.StoredKey("different", "COMPLETED", 201, "{}", true, null,
                        minutesAgo(49 * 60))));

        run("abc-1", body);

        assertThat(runs).hasValue(1);
    }

    @Test
    void client_errors_are_stored_and_server_errors_release_the_key() {
        claimSucceeds();
        OpenApiException invalid = OpenApiException.validation("title", "required", "title is required.");
        assertThatThrownBy(() -> service.execute(KEY, "k-422", "POST", PATH, Map.of(), false, r -> null, null,
                () -> { throw invalid; })).isSameAs(invalid);
        verify(jdbc).update(contains("SET status = 'COMPLETED'"), any(SqlParameterSource.class));

        RuntimeException boom = new IllegalStateException("db down");
        assertThatThrownBy(() -> service.execute(KEY, "k-500", "POST", PATH, Map.of(), false, r -> null, null,
                () -> { throw boom; })).isSameAs(boom);
        verify(jdbc).update(contains("DELETE FROM api_idempotency_key"), any(SqlParameterSource.class));
    }

    @Test
    void conflict_and_rate_limit_answers_are_not_stored() {
        assertThat(IdempotencyService.storable(201)).isTrue();
        assertThat(IdempotencyService.storable(422)).isTrue();
        assertThat(IdempotencyService.storable(409)).isFalse();
        assertThat(IdempotencyService.storable(429)).isFalse();
        assertThat(IdempotencyService.storable(503)).isFalse();
    }

    @Test
    void secret_bearing_responses_are_never_stored_and_replay_rebuilds_without_the_secret() {
        claimSucceeds();
        service.execute(KEY, "wh-1", "POST", PATH, Map.of("url", "https://x"), true, r -> "ep-1",
                id -> ResponseEntity.ok(Map.of("id", id)),
                () -> ResponseEntity.status(201).body(Map.of("id", "ep-1", "secret", "whsec_abc")));
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("SET status = 'COMPLETED'"), params.capture());
        MapSqlParameterSource p = (MapSqlParameterSource) params.getValue();
        assertThat(p.getValue("body")).isNull();
        assertThat(p.getValue("bodyStored")).isEqualTo(false);
        assertThat(p.getValue("resourceId")).isEqualTo("ep-1");

        IdempotencyService replaying = new IdempotencyService(jdbc, mapper, Clock.fixed(NOW, ZoneOffset.UTC));
        Map<String, Object> body = Map.of("url", "https://x");
        when(jdbc.update(contains("INSERT INTO api_idempotency_key"), any(SqlParameterSource.class))).thenReturn(0);
        when(jdbc.query(contains("FROM api_idempotency_key"), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(new IdempotencyService.StoredKey(replaying.fingerprint("POST", PATH, body),
                        "COMPLETED", 201, null, false, "ep-1", minutesAgo(1))));
        ResponseEntity<?> replay = replaying.execute(KEY, "wh-1", "POST", PATH, body, true, r -> "ep-1",
                id -> ResponseEntity.ok(Map.of("id", id)), () -> {
                    throw new AssertionError("must not run again");
                });
        assertThat(replay.getStatusCode().value()).isEqualTo(201);
        assertThat((Map<String, Object>) replay.getBody()).containsEntry("id", "ep-1").doesNotContainKey("secret");
        assertThat(replay.getHeaders().getFirst("Idempotent-Replayed")).isEqualTo("true");
    }

    @Test
    void malformed_keys_are_422() {
        assertThatThrownBy(() -> run("has space", Map.of()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getStatus().value()).isEqualTo(422));
        assertThatThrownBy(() -> run("x".repeat(256), Map.of())).isInstanceOf(OpenApiException.class);
        assertThat(runs).hasValue(0);
    }

    @Test
    void scope_is_the_institute_not_the_key() {
        claimSucceeds();
        ApiKeyPrincipal otherKeySameInstitute = ApiKeyPrincipal.builder().keyId("k2").instituteId("inst-1").build();
        service.execute(otherKeySameInstitute, "abc-1", "POST", PATH, Map.of(), false, r -> null, null,
                () -> ResponseEntity.ok().build());
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc, times(1)).update(contains("INSERT INTO api_idempotency_key"), params.capture());
        assertThat(((MapSqlParameterSource) params.getValue()).getValue("instituteId")).isEqualTo("inst-1");
        verify(jdbc).update(contains("ON CONFLICT (institute_id, idem_key) DO NOTHING"), any(SqlParameterSource.class));
    }

    @Test
    void purge_deletes_only_keys_older_than_48_hours_in_batches() {
        when(jdbc.update(contains("DELETE FROM api_idempotency_key WHERE ctid IN"), any(SqlParameterSource.class)))
                .thenReturn(1000).thenReturn(3);
        service.purgeExpired();
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc, times(2)).update(contains("created_at < :cutoff LIMIT 1000"), params.capture());
        Timestamp cutoff = (Timestamp) ((MapSqlParameterSource) params.getValue()).getValue("cutoff");
        assertThat(cutoff.toLocalDateTime()).isEqualTo(LocalDateTime.ofInstant(NOW.minusSeconds(48 * 3600), ZoneOffset.UTC));
    }
}
