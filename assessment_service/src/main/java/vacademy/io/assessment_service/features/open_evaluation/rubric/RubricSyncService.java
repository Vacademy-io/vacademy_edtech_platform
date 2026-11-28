package vacademy.io.assessment_service.features.open_evaluation.rubric;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.exam.QuestionMapper;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Delivers partner rubric and model-answer changes to ai_service, which owns the rubric
 * store (spec 7.1 "rubric PATCH runs after commit", 7.4, contract C4).
 *
 * <p>Outbox on {@code api_exam.rubric_pending}: the facade {@link #stage stages} changes in
 * the same transaction as the exam or question write, and {@link #flush flushes} after
 * commit. If ai_service cannot be reached the change stays staged, the response says
 * {@code "sync": "pending"}, and {@link #retryPending} pushes it again every minute.
 *
 * <p>Ordering: a flush holds a per-exam advisory lock for the length of the PATCH, so two
 * pods never deliver an older staged map after a newer one. Staging bumps
 * {@code rubric_pending_seq}; a flush clears only the outbox it actually sent, so a change
 * staged while a PATCH was in flight is never lost.
 *
 * <p>Permanent refusal (412/409/422 from ai_service): the outbox is cleared so it does not
 * wedge, but not silently. The refused question ids are recorded on
 * {@code api_exam.rubric_sync_error} (shown as {@code sync: "failed"} until a later write of
 * those questions syncs), and the local copies the write already committed (the model answer
 * in {@code question.auto_evaluation_json}, {@code rubric_source} in {@code source_meta}) are
 * put back to what the store holds.
 */
@Slf4j
@Service
public class RubricSyncService {

    /** What a flush achieved. */
    public enum Outcome {
        /** ai_service accepted everything staged; {@link FlushResult#version()} is the new version. */
        SYNCED,
        /** Nothing was staged. */
        NOTHING,
        /** ai_service not reachable now; still staged, the retry job will push it. */
        PENDING,
        /**
         * ai_service refused the change for good (412 if_match, 409 locked/mismatch, 422):
         * recorded in {@code rubric_sync_error}, local copies restored from the store.
         */
        REJECTED
    }

    public record FlushResult(Outcome outcome, Integer version, int status, String detail) {
        static FlushResult nothing() {
            return new FlushResult(Outcome.NOTHING, null, 0, null);
        }
    }

    static final int RETRY_BATCH = 50;
    /** Sync-state value while a refused change is on record. */
    public static final String SYNC_FAILED = "failed";

    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionOperations newTransaction;
    private final AiServiceCopyCheckClient client;
    private final ObjectMapper objectMapper;
    private final OpenApiProperties properties;

    @Autowired
    public RubricSyncService(JdbcTemplate jdbcTemplate, PlatformTransactionManager transactionManager,
            AiServiceCopyCheckClient client, ObjectMapper objectMapper, OpenApiProperties properties) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), requiresNew(transactionManager), client, objectMapper,
                properties);
    }

    RubricSyncService(NamedParameterJdbcTemplate jdbc, TransactionOperations newTransaction,
            AiServiceCopyCheckClient client, ObjectMapper objectMapper, OpenApiProperties properties) {
        this.jdbc = jdbc;
        this.newTransaction = newTransaction;
        this.client = client;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    private static TransactionOperations requiresNew(PlatformTransactionManager tm) {
        TransactionTemplate template = new TransactionTemplate(tm);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return template;
    }

    /**
     * Stages changes for one exam. Run inside the caller's transaction, so the outbox
     * commits (or rolls back) with the write that caused it.
     *
     * @param changes question id → {@code {"rubric": {...}|null, "model_answer": "..."|null}}
     *                (an empty object only bumps the rubric version)
     */
    public void stage(String examId, Map<String, ObjectNode> changes) {
        if (changes == null || changes.isEmpty()) {
            return;
        }
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("id", examId);
        List<String> current = jdbc.queryForList(
                "SELECT rubric_pending::text FROM api_exam WHERE assessment_id = :id FOR UPDATE", p, String.class);
        if (current.isEmpty()) {
            throw new IllegalStateException("api_exam row missing for " + examId);
        }
        ObjectNode merged = merge(parse(current.get(0)), changes);
        jdbc.update("""
                UPDATE api_exam
                SET rubric_pending = CAST(:pending AS jsonb),
                    rubric_pending_seq = rubric_pending_seq + 1,
                    rubric_pending_since = COALESCE(rubric_pending_since, now()),
                    updated_at = now()
                WHERE assessment_id = :id
                """, p.addValue("pending", merged.toString()));
    }

    /** Whether changes for this exam are still waiting for ai_service. */
    public boolean hasPending(String examId) {
        Boolean pending = jdbc.queryForObject(
                "SELECT rubric_pending IS NOT NULL FROM api_exam WHERE assessment_id = :id",
                new MapSqlParameterSource().addValue("id", examId), Boolean.class);
        return Boolean.TRUE.equals(pending);
    }

    /** The staged changes (question id → change), empty object when none. */
    public ObjectNode pending(String examId) {
        List<String> rows = jdbc.queryForList("SELECT rubric_pending::text FROM api_exam WHERE assessment_id = :id",
                new MapSqlParameterSource().addValue("id", examId), String.class);
        return parse(rows.isEmpty() ? null : rows.get(0));
    }

    /**
     * The last permanent refusal still on record ({@code {"status", "code", "question_ids",
     * "at"}}), or empty. Cleared question by question as later writes of them sync.
     */
    public Optional<ObjectNode> syncError(String examId) {
        List<String> rows = jdbc.queryForList("SELECT rubric_sync_error::text FROM api_exam WHERE assessment_id = :id",
                new MapSqlParameterSource().addValue("id", examId), String.class);
        ObjectNode error = parse(rows.isEmpty() ? null : rows.get(0));
        return error.isEmpty() ? Optional.empty() : Optional.of(error);
    }

    /**
     * Pushes everything staged for the exam. Call after the staging transaction committed.
     * Waits for a flush already running for the same exam (another request or pod), then
     * sends whatever is still staged.
     *
     * @param ifMatch rubric version the caller expects ({@code If-Match}); null = no check
     */
    public FlushResult flush(String examId, Integer ifMatch) {
        return newTransaction.execute(status -> flushLocked(examId, ifMatch, true));
    }

    /**
     * Retries staged changes every minute (oldest first). Skips exams another pod is
     * flushing right now; they are picked up on the next round if still staged.
     */
    @Scheduled(fixedDelayString = "${assessment.open-api.rubric-sync-retry-ms:60000}",
            initialDelayString = "${assessment.open-api.rubric-sync-retry-ms:60000}")
    public void retryPending() {
        if (!properties.isEnabled()) {
            return;
        }
        List<String> examIds;
        try {
            examIds = jdbc.queryForList("""
                    SELECT assessment_id FROM api_exam
                    WHERE rubric_pending IS NOT NULL
                    ORDER BY rubric_pending_since
                    LIMIT :limit
                    """, new MapSqlParameterSource().addValue("limit", RETRY_BATCH), String.class);
        } catch (RuntimeException e) {
            log.warn("[rubric-sync] could not list staged rubric changes: {}", e.getMessage());
            return;
        }
        for (String examId : examIds) {
            try {
                FlushResult result = newTransaction.execute(status -> flushLocked(examId, null, false));
                if (result != null && result.outcome() == Outcome.PENDING) {
                    // ai_service still down: stop this round instead of timing out on every exam.
                    log.info("[rubric-sync] ai_service unreachable; {} exams left staged", examIds.size());
                    return;
                }
            } catch (RuntimeException e) {
                log.warn("[rubric-sync] retry for exam {} failed: {}", examId, e.getMessage());
            }
        }
    }

    FlushResult flushLocked(String examId, Integer ifMatch, boolean wait) {
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("id", examId)
                .addValue("lockKey", "api_exam_rubric:" + examId);
        if (wait) {
            jdbc.query("SELECT pg_advisory_xact_lock(hashtext(:lockKey))", p, rs -> {
            });
        } else {
            Boolean got = jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(hashtext(:lockKey))", p, Boolean.class);
            if (!Boolean.TRUE.equals(got)) {
                return FlushResult.nothing();
            }
        }
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT rubric_pending::text AS pending, rubric_pending_seq AS seq, institute_id,
                       rubric_sync_error::text AS sync_error
                FROM api_exam WHERE assessment_id = :id
                """, p);
        if (rows.isEmpty() || rows.get(0).get("pending") == null) {
            return FlushResult.nothing();
        }
        Map<String, Object> row = rows.get(0);
        long seq = ((Number) row.get("seq")).longValue();
        String instituteId = (String) row.get("institute_id");
        ObjectNode pending = parse((String) row.get("pending"));
        ObjectNode priorError = parse((String) row.get("sync_error"));
        List<String> sent = new ArrayList<>();
        pending.fieldNames().forEachRemaining(sent::add);

        AiServiceCopyCheckClient.RubricPatchResult result = client.patchRubric(examId, instituteId, pending, ifMatch);
        if (result.ok()) {
            // Questions this write delivered are no longer "failed".
            clear(examId, seq, priorError.isEmpty() ? null : withoutQuestions(priorError, sent), !priorError.isEmpty());
            return new FlushResult(Outcome.SYNCED, result.version(), result.status(), null);
        }
        if (result.retryable()) {
            // Status only: the body of an ai_service error can echo partner rubric text.
            log.warn("[rubric-sync] exam {}: ai_service not reachable (status {}); change stays staged",
                    examId, result.status());
            return new FlushResult(Outcome.PENDING, null, result.status(), result.detail());
        }
        // A refusal ai_service will repeat forever (version mismatch, locked rubric, tenant
        // mismatch, bad payload): take it out of the outbox so it does not wedge, but record
        // it and put the local copies back to what the store holds.
        log.warn("[rubric-sync] exam {}: ai_service refused staged rubric change for {} question(s) (status {}); "
                + "recorded as sync failed", examId, sent.size(), result.status());
        ObjectNode error = withRefusal(priorError, result.status(), sent);
        if (clear(examId, seq, error, true)) {
            restoreLocalCopies(examId, instituteId, pending);
        }
        // else: a newer change was merged in meanwhile; the outbox (refused part included) is
        // sent again by the next flush, and the local copies stay as the newest write left them.
        return new FlushResult(Outcome.REJECTED, null, result.status(), result.detail());
    }

    /** Clears the outbox if it is still the one sent; true when it was. */
    private boolean clear(String examId, long seq, ObjectNode syncError, boolean writeError) {
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("id", examId).addValue("seq", seq);
        if (!writeError) {
            return jdbc.update("""
                    UPDATE api_exam SET rubric_pending = NULL, rubric_pending_since = NULL
                    WHERE assessment_id = :id AND rubric_pending_seq = :seq
                    """, p) > 0;
        }
        return jdbc.update("""
                UPDATE api_exam SET rubric_pending = NULL, rubric_pending_since = NULL,
                    rubric_sync_error = CAST(:syncError AS jsonb), updated_at = now()
                WHERE assessment_id = :id AND rubric_pending_seq = :seq
                """, p.addValue("syncError", syncError == null || syncError.isEmpty() ? null : syncError.toString())) > 0;
    }

    /** The error record with this refusal added: newest status/code, union of question ids. */
    ObjectNode withRefusal(ObjectNode prior, int status, List<String> questionIds) {
        Set<String> ids = new LinkedHashSet<>();
        prior.path("question_ids").forEach(n -> ids.add(n.asText()));
        ids.addAll(questionIds);
        ObjectNode out = objectMapper.createObjectNode();
        out.put("status", status);
        out.put("code", refusalCode(status));
        ArrayNode arr = out.putArray("question_ids");
        ids.forEach(arr::add);
        out.put("at", Instant.now().toString());
        return out;
    }

    /** The error record without these questions; null when none is left. */
    static ObjectNode withoutQuestions(ObjectNode prior, List<String> questionIds) {
        ObjectNode out = prior.deepCopy();
        ArrayNode arr = out.putArray("question_ids");
        prior.path("question_ids").forEach(n -> {
            if (!questionIds.contains(n.asText())) {
                arr.add(n.asText());
            }
        });
        return arr.isEmpty() ? null : out;
    }

    static String refusalCode(int status) {
        return switch (status) {
            case 412 -> ApiErrorCode.RUBRIC_VERSION_MISMATCH;
            case 409 -> ApiErrorCode.CONFLICT;
            default -> "rejected";
        };
    }

    /**
     * After a refusal, puts the local copies of the refused questions back to what the store
     * holds: the model answer typed grading reads from {@code auto_evaluation_json}, and
     * {@code rubric_source} (removed when the store has no rubric for the question; kept when
     * it has one, since the store does not say who wrote it). Skipped, with a log line, when
     * the store cannot be read; the error record still flags the questions.
     */
    void restoreLocalCopies(String examId, String instituteId, ObjectNode refused) {
        List<String> ids = new ArrayList<>();
        refused.fields().forEachRemaining(e -> {
            if (e.getValue().has("rubric") || e.getValue().has("model_answer")) {
                ids.add(e.getKey());
            }
        });
        if (ids.isEmpty()) {
            return;
        }
        Optional<JsonNode> stored;
        try {
            stored = client.fetchRubric(examId, instituteId);
        } catch (AiServiceCopyCheckClient.RubricStoreUnavailableException e) {
            log.warn("[rubric-sync] exam {}: could not read the rubric store to restore local copies", examId);
            return;
        }
        JsonNode storedRubrics = stored.map(n -> n.path("rubric")).orElse(objectMapper.createObjectNode());
        JsonNode storedAnswers = stored.map(n -> n.path("model_answers")).orElse(objectMapper.createObjectNode());
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, auto_evaluation_json, source_meta::text AS source_meta FROM question WHERE id IN (:ids)",
                new MapSqlParameterSource().addValue("ids", ids));
        for (Map<String, Object> row : rows) {
            String qid = (String) row.get("id");
            JsonNode change = refused.path(qid);
            if (change.has("model_answer")) {
                JsonNode answer = storedAnswers.path(qid);
                jdbc.update("UPDATE question SET auto_evaluation_json = :autoEvaluation WHERE id = :id",
                        new MapSqlParameterSource().addValue("id", qid).addValue("autoEvaluation",
                                QuestionMapper.withModelAnswer((String) row.get("auto_evaluation_json"),
                                        answer.isTextual() ? answer.asText() : null)));
            }
            ObjectNode meta = parse((String) row.get("source_meta"));
            if (change.has("rubric") && !storedRubrics.path(qid).isObject() && meta.has("rubric_source")) {
                meta.remove("rubric_source");
                jdbc.update("UPDATE question SET source_meta = CAST(:meta AS jsonb) WHERE id = :id",
                        new MapSqlParameterSource().addValue("id", qid).addValue("meta", meta.toString()));
            }
        }
    }

    /**
     * Merges new changes into the staged map: per question, each key present in the new
     * change ({@code rubric}, {@code model_answer}) replaces the staged one; keys it leaves
     * out keep their staged value.
     */
    static ObjectNode merge(ObjectNode staged, Map<String, ObjectNode> changes) {
        ObjectNode out = staged == null ? new ObjectMapper().createObjectNode() : staged.deepCopy();
        changes.forEach((questionId, change) -> {
            JsonNode existing = out.get(questionId);
            ObjectNode target = existing instanceof ObjectNode o ? o : out.putObject(questionId);
            if (change == null) {
                return;
            }
            Iterator<Map.Entry<String, JsonNode>> fields = change.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                target.set(field.getKey(), field.getValue());
            }
        });
        return out;
    }

    private ObjectNode parse(String json) {
        if (json == null || json.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            JsonNode node = objectMapper.readTree(json);
            return node instanceof ObjectNode o ? o : objectMapper.createObjectNode();
        } catch (Exception e) {
            log.error("[rubric-sync] unreadable rubric_pending, ignoring it: {}", e.getMessage());
            return objectMapper.createObjectNode();
        }
    }
}
