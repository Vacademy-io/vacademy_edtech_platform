package vacademy.io.assessment_service.features.open_evaluation.rubric;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.transaction.support.TransactionOperations;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RubricSyncServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private NamedParameterJdbcTemplate jdbc;
    private AiServiceCopyCheckClient client;
    private OpenApiProperties properties;
    private RubricSyncService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        client = mock(AiServiceCopyCheckClient.class);
        properties = mock(OpenApiProperties.class);
        when(properties.isEnabled()).thenReturn(true);
        service = new RubricSyncService(jdbc, TransactionOperations.withoutTransaction(), client, MAPPER, properties);
    }

    private void staged(String pendingJson, long seq) {
        staged(pendingJson, seq, null);
    }

    private void staged(String pendingJson, long seq, String syncError) {
        Map<String, Object> row = new HashMap<>();
        row.put("sync_error", syncError);
        row.put("pending", pendingJson);
        row.put("seq", seq);
        row.put("institute_id", "inst-1");
        when(jdbc.queryForList(contains("rubric_pending_seq AS seq"), any(SqlParameterSource.class)))
                .thenReturn(pendingJson == null ? List.of() : List.of(row));
    }

    private static ObjectNode change(String json) {
        try {
            return (ObjectNode) MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void merge_replaces_keys_sent_and_keeps_the_rest() {
        ObjectNode staged = change("{\"q1\":{\"rubric\":{\"max_marks\":2},\"model_answer\":\"old\"},\"q2\":{\"model_answer\":\"x\"}}");
        Map<String, ObjectNode> changes = new java.util.LinkedHashMap<>();
        changes.put("q1", change("{\"model_answer\":null}"));
        changes.put("q3", change("{}"));

        ObjectNode merged = RubricSyncService.merge(staged, changes);

        assertThat(merged.path("q1").path("rubric").path("max_marks").asInt()).isEqualTo(2);
        assertThat(merged.path("q1").get("model_answer").isNull()).isTrue();
        assertThat(merged.path("q2").path("model_answer").asText()).isEqualTo("x");
        assertThat(merged.has("q3")).isTrue();
        // the staged input is not mutated
        assertThat(staged.path("q1").path("model_answer").asText()).isEqualTo("old");
    }

    @Test
    void stage_merges_into_the_locked_row_and_bumps_the_sequence() {
        when(jdbc.queryForList(contains("FOR UPDATE"), any(SqlParameterSource.class), eq(String.class)))
                .thenReturn(new ArrayList<>(java.util.Collections.singletonList("{\"q1\":{\"model_answer\":\"a\"}}")));

        service.stage("exam-1", Map.of("q2", change("{\"rubric\":null}")));

        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("rubric_pending_seq = rubric_pending_seq + 1"), params.capture());
        String pending = (String) params.getValue().getValue("pending");
        assertThat(pending).contains("\"q1\":{\"model_answer\":\"a\"}").contains("\"q2\":{\"rubric\":null}");
    }

    @Test
    void synced_flush_clears_only_the_outbox_it_sent() {
        staged("{\"q1\":{\"model_answer\":\"a\"}}", 7);
        when(client.patchRubric(eq("exam-1"), eq("inst-1"), any(JsonNode.class), isNull()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(5, 200, null, false));

        RubricSyncService.FlushResult result = service.flush("exam-1", null);

        assertThat(result.outcome()).isEqualTo(RubricSyncService.Outcome.SYNCED);
        assertThat(result.version()).isEqualTo(5);
        verify(jdbc).query(contains("pg_advisory_xact_lock"), any(SqlParameterSource.class), any(RowCallbackHandler.class));
        verify(jdbc).update(contains("rubric_pending = NULL"),
                argThat((SqlParameterSource p) -> Long.valueOf(7).equals(p.getValue("seq"))));
    }

    @Test
    void unreachable_ai_service_keeps_the_change_staged() {
        staged("{\"q1\":{}}", 1);
        when(client.patchRubric(anyString(), anyString(), any(JsonNode.class), any()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(null, 503, "down", true));

        RubricSyncService.FlushResult result = service.flush("exam-1", null);

        assertThat(result.outcome()).isEqualTo(RubricSyncService.Outcome.PENDING);
        verify(jdbc, never()).update(contains("rubric_pending = NULL"), any(SqlParameterSource.class));
    }

    @Test
    void permanent_refusal_is_taken_out_of_the_outbox_but_recorded() {
        staged("{\"q1\":{}}", 3);
        when(client.patchRubric(anyString(), anyString(), any(JsonNode.class), eq(4)))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(null, 412, "version", false));

        RubricSyncService.FlushResult result = service.flush("exam-1", 4);

        assertThat(result.outcome()).isEqualTo(RubricSyncService.Outcome.REJECTED);
        assertThat(result.status()).isEqualTo(412);
        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("rubric_sync_error = CAST(:syncError AS jsonb)"), params.capture());
        String error = (String) params.getValue().getValue("syncError");
        assertThat(error).contains("\"status\":412").contains("\"code\":\"rubric_version_mismatch\"")
                .contains("\"question_ids\":[\"q1\"]");
    }

    @Test
    void refusal_puts_the_local_model_answer_and_rubric_source_back_to_the_store() throws Exception {
        staged("{\"q1\":{\"model_answer\":\"new\",\"rubric\":{\"max_marks\":5}},\"q2\":{}}", 3,
                "{\"status\":409,\"code\":\"conflict\",\"question_ids\":[\"q9\"],\"at\":\"x\"}");
        when(client.patchRubric(anyString(), anyString(), any(JsonNode.class), isNull()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(null, 422, "{\"input\":\"secret\"}", false));
        when(jdbc.update(contains("rubric_sync_error"), any(SqlParameterSource.class))).thenReturn(1);
        when(client.fetchRubric("exam-1", "inst-1")).thenReturn(Optional.of(
                MAPPER.readTree("{\"rubric\":{},\"model_answers\":{\"q1\":\"old answer\"}}")));
        Map<String, Object> question = new HashMap<>();
        question.put("id", "q1");
        question.put("auto_evaluation_json", "{\"type\":\"LONG_ANSWER\",\"data\":{\"answer\":{\"content\":\"new\"}}}");
        question.put("source_meta", "{\"source\":\"API\",\"rubric_source\":\"partner\"}");
        when(jdbc.queryForList(contains("FROM question WHERE id IN"), any(SqlParameterSource.class)))
                .thenReturn(List.of(question));

        RubricSyncService.FlushResult result = service.flush("exam-1", null);

        assertThat(result.outcome()).isEqualTo(RubricSyncService.Outcome.REJECTED);
        ArgumentCaptor<SqlParameterSource> error = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("rubric_sync_error"), error.capture());
        assertThat((String) error.getValue().getValue("syncError")).contains("\"q9\"").contains("\"q1\"")
                .contains("\"q2\"").contains("\"status\":422");
        // Only q1 carried rubric/model_answer keys, so only q1 is read back.
        verify(jdbc).queryForList(contains("FROM question WHERE id IN"),
                argThat((SqlParameterSource p) -> List.of("q1").equals(p.getValue("ids"))));
        ArgumentCaptor<SqlParameterSource> answer = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("SET auto_evaluation_json"), answer.capture());
        assertThat((String) answer.getValue().getValue("autoEvaluation")).contains("old answer").doesNotContain("new\"");
        ArgumentCaptor<SqlParameterSource> meta = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("SET source_meta"), meta.capture());
        assertThat((String) meta.getValue().getValue("meta")).doesNotContain("rubric_source").contains("API");
    }

    @Test
    void refusal_of_an_outbox_that_grew_meanwhile_leaves_it_staged_and_local_copies_alone() {
        staged("{\"q1\":{\"model_answer\":\"a\"}}", 3);
        when(client.patchRubric(anyString(), anyString(), any(JsonNode.class), isNull()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(null, 409, "x", false));
        // seq moved on: the conditional clear matches no row (mock default 0)

        service.flush("exam-1", null);

        verify(client, never()).fetchRubric(anyString(), anyString());
        verify(jdbc, never()).update(contains("UPDATE question"), any(SqlParameterSource.class));
    }

    @Test
    void a_later_sync_of_a_failed_question_clears_it_from_the_error_record() {
        staged("{\"q1\":{\"model_answer\":\"a\"}}", 7,
                "{\"status\":412,\"code\":\"rubric_version_mismatch\",\"question_ids\":[\"q1\",\"q2\"],\"at\":\"x\"}");
        when(client.patchRubric(anyString(), anyString(), any(JsonNode.class), isNull()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(6, 200, null, false));

        service.flush("exam-1", null);

        ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("rubric_sync_error"), params.capture());
        assertThat((String) params.getValue().getValue("syncError")).contains("\"q2\"").doesNotContain("\"q1\"");
    }

    @Test
    void error_record_helpers() {
        ObjectNode prior = change("{\"status\":409,\"question_ids\":[\"q1\"]}");
        assertThat(RubricSyncService.withoutQuestions(prior, List.of("q1"))).isNull();
        assertThat(RubricSyncService.refusalCode(412)).isEqualTo("rubric_version_mismatch");
        assertThat(RubricSyncService.refusalCode(409)).isEqualTo("conflict");
        assertThat(RubricSyncService.refusalCode(422)).isEqualTo("rejected");
    }

    @Test
    void nothing_staged_means_no_call() {
        staged(null, 0);
        assertThat(service.flush("exam-1", null).outcome()).isEqualTo(RubricSyncService.Outcome.NOTHING);
        verify(client, never()).patchRubric(anyString(), anyString(), any(), any());
    }

    @Test
    void retry_job_skips_exams_another_pod_is_flushing_and_stops_when_ai_service_is_down() {
        when(jdbc.queryForList(contains("ORDER BY rubric_pending_since"), any(SqlParameterSource.class), eq(String.class)))
                .thenReturn(List.of("busy", "e2", "e3"));
        when(jdbc.queryForObject(contains("pg_try_advisory_xact_lock"),
                argThat((SqlParameterSource p) -> p != null && "api_exam_rubric:busy".equals(p.getValue("lockKey"))),
                eq(Boolean.class))).thenReturn(false);
        when(jdbc.queryForObject(contains("pg_try_advisory_xact_lock"),
                argThat((SqlParameterSource p) -> p != null && !"api_exam_rubric:busy".equals(p.getValue("lockKey"))),
                eq(Boolean.class))).thenReturn(true);
        staged("{\"q1\":{}}", 1);
        when(client.patchRubric(anyString(), anyString(), any(JsonNode.class), isNull()))
                .thenReturn(new AiServiceCopyCheckClient.RubricPatchResult(null, 0, "timeout", true));

        service.retryPending();

        verify(client, never()).patchRubric(eq("busy"), anyString(), any(), any());
        verify(client).patchRubric(eq("e2"), anyString(), any(JsonNode.class), isNull());
        verify(client, never()).patchRubric(eq("e3"), anyString(), any(), any());
    }

    @Test
    void retry_job_is_quiet_while_the_api_is_switched_off() {
        when(properties.isEnabled()).thenReturn(false);
        service.retryPending();
        verify(jdbc, never()).queryForList(anyString(), any(MapSqlParameterSource.class), eq(String.class));
    }
}
