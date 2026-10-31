package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Idempotency-Key for the v1.3 creates (POST /v1/counsellors, POST /v1/agents), whose
 * resources live in tables that have no column for it (ai_calling_api_idempotency, V597).
 *
 * <p>Same contract as the call creates: a key is honoured for 24 hours per institute; the
 * same request again gets the resource back (200, {@code idempotent_replay: true}); a
 * different request with the key is 409 idempotency_key_reused; a retry that arrives while
 * the first request is still working is 409 request_in_progress with Retry-After. The row is
 * claimed BEFORE the create runs (INSERT … ON CONFLICT DO NOTHING), so two concurrent
 * requests can never both create; a create that fails releases the claim so a retry runs.
 */
@Component
@RequiredArgsConstructor
public class ApiIdempotencyStore {

    static final int IN_PROGRESS_RETRY_AFTER = 5;
    /** A claim still without a resource after this long belongs to a request that died. */
    static final java.time.Duration IN_PROGRESS_TTL = java.time.Duration.ofMinutes(2);
    private static final ObjectMapper CANONICAL = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private final NamedParameterJdbcTemplate jdbc;

    /**
     * The create's response, whether it was a replay, and whether this request created the
     * resource (false when the create found it already there: answered 200, not 201).
     */
    public record Outcome(Map<String, Object> body, boolean replay, boolean created) {
    }

    /**
     * Runs {@code create} at most once per key. {@code create} returns the new resource's id
     * and its response body; {@code view} renders an existing resource for a replay.
     */
    public Outcome run(String instituteId, String keyId, String operation, String rawKey, Object request,
                       Supplier<Created> create, Function<String, Map<String, Object>> view) {
        String key = AiCallingApiService.normaliseIdempotencyKey(rawKey);
        if (key == null) {
            Created c = create.get();
            return new Outcome(c.body(), false, c.created());
        }
        String hash = hash(request);
        Row row = find(instituteId, operation, key);
        if (row != null && row.createdAt() != null
                && row.createdAt().plus(AiCallingApiService.IDEMPOTENCY_TTL).isBefore(Instant.now())) {
            expire(instituteId, operation, key);
            row = null;
        }
        if (row != null && row.resourceId() == null && row.createdAt() != null
                && row.createdAt().plus(IN_PROGRESS_TTL).isBefore(Instant.now())) {
            // The request that claimed this key died before finishing (pod restart, timeout):
            // let this retry run instead of answering request_in_progress for 24 hours. A
            // create it half-did is found again by the create itself (e.g. the counsellor's
            // email now exists and is a counsellor here).
            releaseStale(instituteId, operation, key);
            row = null;
        }
        if (row == null && !claim(instituteId, operation, key, hash, keyId)) {
            row = find(instituteId, operation, key);
        }
        if (row != null) {
            return replay(row, hash, view);
        }
        Created created;
        try {
            created = create.get();
        } catch (RuntimeException e) {
            release(instituteId, operation, key);
            throw e;
        }
        complete(instituteId, operation, key, created.resourceId());
        return new Outcome(created.body(), false, created.created());
    }

    /** What a create produced; {@code created} false = it already existed (nothing was made). */
    public record Created(String resourceId, Map<String, Object> body, boolean created) {
    }

    record Row(String requestHash, String resourceId, Instant createdAt) {
    }

    private Outcome replay(Row row, String hash, Function<String, Map<String, Object>> view) {
        if (!hash.equals(row.requestHash())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "idempotency_key_reused",
                    "This Idempotency-Key was already used for a different request.");
        }
        if (row.resourceId() == null) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "request_in_progress",
                    "A request with this Idempotency-Key is still being processed. Retry in "
                            + IN_PROGRESS_RETRY_AFTER + " seconds.", null, IN_PROGRESS_RETRY_AFTER);
        }
        Map<String, Object> body = view.apply(row.resourceId());
        body.put("idempotent_replay", true);
        return new Outcome(body, true, false);
    }

    Row find(String instituteId, String operation, String key) {
        List<Row> rows = jdbc.query("""
                SELECT request_hash, resource_id, created_at FROM ai_calling_api_idempotency
                 WHERE institute_id = :i AND operation = :o AND idempotency_key = :k
                """, params(instituteId, operation, key), (rs, n) -> {
            Timestamp ts = rs.getTimestamp("created_at");
            return new Row(rs.getString("request_hash"), rs.getString("resource_id"),
                    ts == null ? null : ts.toInstant());
        });
        return rows.isEmpty() ? null : rows.get(0);
    }

    boolean claim(String instituteId, String operation, String key, String hash, String keyId) {
        return jdbc.update("""
                INSERT INTO ai_calling_api_idempotency
                       (institute_id, operation, idempotency_key, request_hash, api_key_id, created_at)
                VALUES (:i, :o, :k, :h, :kid, NOW())
                ON CONFLICT (institute_id, operation, idempotency_key) DO NOTHING
                """, params(instituteId, operation, key).addValue("h", hash).addValue("kid", keyId)) == 1;
    }

    void complete(String instituteId, String operation, String key, String resourceId) {
        jdbc.update("""
                UPDATE ai_calling_api_idempotency SET resource_id = :r
                 WHERE institute_id = :i AND operation = :o AND idempotency_key = :k
                """, params(instituteId, operation, key).addValue("r", resourceId));
    }

    void release(String instituteId, String operation, String key) {
        jdbc.update("""
                DELETE FROM ai_calling_api_idempotency
                 WHERE institute_id = :i AND operation = :o AND idempotency_key = :k AND resource_id IS NULL
                """, params(instituteId, operation, key));
    }

    void releaseStale(String instituteId, String operation, String key) {
        jdbc.update("""
                DELETE FROM ai_calling_api_idempotency
                 WHERE institute_id = :i AND operation = :o AND idempotency_key = :k
                   AND resource_id IS NULL AND created_at < NOW() - INTERVAL '2 minutes'
                """, params(instituteId, operation, key));
    }

    void expire(String instituteId, String operation, String key) {
        jdbc.update("""
                DELETE FROM ai_calling_api_idempotency
                 WHERE institute_id = :i AND operation = :o AND idempotency_key = :k
                   AND created_at < NOW() - INTERVAL '24 hours'
                """, params(instituteId, operation, key));
    }

    static final String LOCK = "lock";

    /**
     * A short-lived mutex in the same table (operation "lock"), for a check-then-create that
     * spans an HTTP call and so cannot hold a database transaction: the counsellor create
     * looks an email up in auth_service and then creates it. A lock older than two minutes
     * belongs to a request that died and is taken over. Returns false when another request
     * holds it.
     */
    public boolean tryLock(String scope, String name) {
        jdbc.update("""
                DELETE FROM ai_calling_api_idempotency
                 WHERE institute_id = :i AND operation = 'lock' AND idempotency_key = :k
                   AND created_at < NOW() - INTERVAL '2 minutes'
                """, params(scope, LOCK, name));
        return claim(scope, LOCK, name, LOCK, null);
    }

    public void unlock(String scope, String name) {
        jdbc.update("""
                DELETE FROM ai_calling_api_idempotency
                 WHERE institute_id = :i AND operation = 'lock' AND idempotency_key = :k
                """, params(scope, LOCK, name));
    }

    private static MapSqlParameterSource params(String instituteId, String operation, String key) {
        return new MapSqlParameterSource().addValue("i", instituteId).addValue("o", operation).addValue("k", key);
    }

    static String hash(Object request) {
        byte[] bytes;
        try {
            bytes = CANONICAL.writeValueAsBytes(request);
        } catch (Exception e) {
            bytes = String.valueOf(request).getBytes(StandardCharsets.UTF_8);
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e); // every JVM ships SHA-256
        }
    }
}
