package vacademy.io.assessment_service.features.open_evaluation.idempotency;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.MapperFeature;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.common.auth.apikey.ApiKeyFormat;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.tracing.RequestIds;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;

/**
 * {@code Idempotency-Key} for partner POSTs (spec 7.0).
 *
 * <ul>
 *   <li>Optional. No header → the call simply runs.</li>
 *   <li>Scoped per institute, not per key, so a retry after key rotation or from a second
 *       key of the same institute still replays. Kept 48 h.</li>
 *   <li>Same key + same request → the stored response, with {@code Idempotent-Replayed: true}.</li>
 *   <li>Same key + different request → 422 {@code idempotency_key_reused}.</li>
 *   <li>Same key while the first call still runs → 409 {@code request_in_progress}. A claim
 *       older than {@value #STALE_CLAIM_MINUTES} minutes is treated as abandoned (the pod
 *       died) and taken over.</li>
 *   <li>Responses that carry a secret are never stored: the caller marks them, only the
 *       resource id is kept, and a replay rebuilds the response without the secret.</li>
 *   <li>Outcomes worth replaying are stored: 2xx and 4xx except 409/429. 5xx, 409 and 429
 *       release the key so the retry runs again.</li>
 * </ul>
 * The request fingerprint is SHA-256 over method, path and the canonical JSON of the body
 * (object keys sorted), so whitespace and key order do not matter.
 */
@Slf4j
@Service
public class IdempotencyService {

    public static final String HEADER = "Idempotency-Key";
    public static final String REPLAYED_HEADER = "Idempotent-Replayed";
    static final Duration RETENTION = Duration.ofHours(48);
    static final int STALE_CLAIM_MINUTES = 10;
    private static final Pattern KEY_SHAPE = Pattern.compile("^[\\x21-\\x7E]{1,255}$");

    static final String STATUS_IN_PROGRESS = "IN_PROGRESS";
    static final String STATUS_COMPLETED = "COMPLETED";

    private final NamedParameterJdbcTemplate jdbc;
    private final Clock clock;
    private final ObjectMapper canonical;
    private final ObjectMapper responseMapper;

    @Autowired
    public IdempotencyService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this(new NamedParameterJdbcTemplate(jdbcTemplate), objectMapper, Clock.systemUTC());
    }

    IdempotencyService(NamedParameterJdbcTemplate jdbc, ObjectMapper objectMapper, Clock clock) {
        this.jdbc = jdbc;
        this.responseMapper = objectMapper;
        this.canonical = canonicalMapper(objectMapper);
        this.clock = clock;
    }

    /** How a stored outcome should be rebuilt when its body was not stored. */
    @FunctionalInterface
    public interface Rebuild extends Function<String, ResponseEntity<?>> {
    }

    /**
     * Runs {@code action} under the caller's {@code Idempotency-Key} (or directly when the
     * header is absent).
     *
     * @param idemKey      raw header value, may be null
     * @param method       HTTP method, part of the fingerprint
     * @param path         request path, part of the fingerprint
     * @param body         parsed request body (DTO, Map or JsonNode), part of the fingerprint
     * @param secretBearing true when the response carries a secret and must not be stored
     * @param resourceId   extracts the created resource id from the response (for replays
     *                     of secret-bearing responses); may return null
     * @param rebuild      rebuilds the response from the resource id when its body was not
     *                     stored; required when {@code secretBearing}
     */
    public ResponseEntity<?> execute(ApiKeyPrincipal principal, String idemKey, String method, String path,
            Object body, boolean secretBearing, Function<ResponseEntity<?>, String> resourceId, Rebuild rebuild,
            Supplier<ResponseEntity<?>> action) {
        return run(principal, idemKey, method, path, body, secretBearing, resourceId, rebuild, null, action);
    }

    /**
     * Like {@link #execute} for a response that carries a short-lived secret inside an
     * otherwise replayable body (POST /uploads: presigned PUT URLs). The caller gets the full
     * response; only {@code redact.apply(body)} is stored, so a replay returns the resources
     * without the secret (spec 7.0).
     */
    public ResponseEntity<?> executeRedacted(ApiKeyPrincipal principal, String idemKey, String method, String path,
            Object body, UnaryOperator<Object> redact, Supplier<ResponseEntity<?>> action) {
        if (redact == null) {
            throw new IllegalArgumentException("redact is required");
        }
        return run(principal, idemKey, method, path, body, false, null, null, redact, action);
    }

    private ResponseEntity<?> run(ApiKeyPrincipal principal, String idemKey, String method, String path,
            Object body, boolean secretBearing, Function<ResponseEntity<?>, String> resourceId, Rebuild rebuild,
            UnaryOperator<Object> redact, Supplier<ResponseEntity<?>> action) {
        if (idemKey == null || idemKey.isBlank()) {
            return action.get();
        }
        String key = idemKey.trim();
        if (!KEY_SHAPE.matcher(key).matches()) {
            throw OpenApiException.validation(HEADER, "invalid",
                    "Idempotency-Key must be 1 to 255 printable ASCII characters.");
        }
        String instituteId = principal.getInstituteId();
        String hash = fingerprint(method, path, body);

        Optional<ResponseEntity<?>> replay = claimOrReplay(principal, instituteId, key, hash, rebuild);
        if (replay.isPresent()) {
            return replay.get();
        }

        ResponseEntity<?> response;
        try {
            response = action.get();
        } catch (RuntimeException e) {
            // Errors thrown as exceptions are rendered by the advice. Store the replayable
            // ones (4xx except 409/429) so a retry sees the same answer; release the rest.
            if (e instanceof OpenApiException api && storable(api.getStatus().value())) {
                complete(instituteId, key, api.getStatus().value(), errorBody(api), true, null);
            } else {
                release(instituteId, key);
            }
            throw e;
        }
        int status = response.getStatusCode().value();
        if (!storable(status)) {
            release(instituteId, key);
            return response;
        }
        try {
            String id = resourceId == null ? null : resourceId.apply(response);
            if (secretBearing) {
                complete(instituteId, key, status, null, false, id);
            } else {
                Object stored = redact == null ? response.getBody() : redact.apply(response.getBody());
                complete(instituteId, key, status, serialize(stored), true, id);
            }
        } catch (RuntimeException e) {
            // The action succeeded; never turn that into an error. Without a stored answer
            // the key is released so a retry is not stuck "in progress".
            log.warn("Could not record idempotent response; releasing the key: {}", e.getMessage());
            release(instituteId, key);
        }
        return response;
    }

    /** Deletes keys older than 48 h, in small batches so a backlog never holds a long lock. */
    @Scheduled(fixedDelayString = "${assessment.open-api.idempotency-purge-ms:3600000}",
            initialDelayString = "${assessment.open-api.idempotency-purge-initial-delay-ms:300000}")
    public void purgeExpired() {
        Timestamp cutoff = Timestamp.valueOf(LocalDateTime.ofInstant(clock.instant().minus(RETENTION), ZoneOffset.UTC));
        int total = 0;
        try {
            for (int i = 0; i < 100; i++) {
                int deleted = jdbc.update(
                        "DELETE FROM api_idempotency_key WHERE ctid IN ("
                                + "SELECT ctid FROM api_idempotency_key WHERE created_at < :cutoff LIMIT 1000)",
                        new MapSqlParameterSource("cutoff", cutoff));
                total += deleted;
                if (deleted < 1000) {
                    break;
                }
            }
        } catch (RuntimeException e) {
            log.warn("Idempotency key purge failed: {}", e.getMessage());
        }
        if (total > 0) {
            log.info("Purged {} expired idempotency keys", total);
        }
    }

    // ------------------------------------------------------------------ internals

    private Optional<ResponseEntity<?>> claimOrReplay(ApiKeyPrincipal principal, String instituteId, String key,
            String hash, Rebuild rebuild) {
        for (int attempt = 0; attempt < 2; attempt++) {
            int inserted = jdbc.update(
                    "INSERT INTO api_idempotency_key (institute_id, idem_key, key_id, request_hash, status, created_at) "
                            + "VALUES (:instituteId, :idemKey, :keyId, :hash, '" + STATUS_IN_PROGRESS + "', :now) "
                            + "ON CONFLICT (institute_id, idem_key) DO NOTHING",
                    new MapSqlParameterSource()
                            .addValue("instituteId", instituteId)
                            .addValue("idemKey", key)
                            .addValue("keyId", principal.getKeyId())
                            .addValue("hash", hash)
                            .addValue("now", nowTimestamp()));
            if (inserted == 1) {
                return Optional.empty(); // we own it: run the call
            }
            List<StoredKey> rows = jdbc.query(
                    "SELECT request_hash, status, http_status, response_body::text, body_stored, resource_id, created_at "
                            + "FROM api_idempotency_key WHERE institute_id = :instituteId AND idem_key = :idemKey",
                    new MapSqlParameterSource().addValue("instituteId", instituteId).addValue("idemKey", key),
                    (rs, i) -> new StoredKey(rs.getString(1), rs.getString(2), (Integer) rs.getObject(3),
                            rs.getString(4), rs.getBoolean(5), rs.getString(6), rs.getTimestamp(7)));
            if (rows.isEmpty()) {
                continue; // deleted in between (purge or release): try to claim again
            }
            StoredKey stored = rows.get(0);
            Instant createdAt = stored.createdAt() == null ? Instant.EPOCH
                    : stored.createdAt().toLocalDateTime().toInstant(ZoneOffset.UTC);
            Instant now = clock.instant();
            boolean expired = createdAt.isBefore(now.minus(RETENTION));
            boolean staleClaim = STATUS_IN_PROGRESS.equals(stored.status())
                    && createdAt.isBefore(now.minus(Duration.ofMinutes(STALE_CLAIM_MINUTES)));
            if (expired || staleClaim) {
                jdbc.update("DELETE FROM api_idempotency_key WHERE institute_id = :instituteId AND idem_key = :idemKey "
                                + "AND created_at = :createdAt",
                        new MapSqlParameterSource().addValue("instituteId", instituteId).addValue("idemKey", key)
                                .addValue("createdAt", stored.createdAt()));
                continue;
            }
            if (!stored.requestHash().equals(hash)) {
                throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.IDEMPOTENCY_KEY_REUSED,
                        "This Idempotency-Key was already used with a different request.");
            }
            if (STATUS_IN_PROGRESS.equals(stored.status())) {
                throw new OpenApiException(HttpStatus.CONFLICT, ApiErrorCode.REQUEST_IN_PROGRESS,
                        "A request with this Idempotency-Key is still running. Retry shortly.", null,
                        Map.of("Retry-After", "2"));
            }
            return Optional.of(replay(stored, rebuild));
        }
        throw new OpenApiException(HttpStatus.CONFLICT, ApiErrorCode.REQUEST_IN_PROGRESS,
                "A request with this Idempotency-Key is still running. Retry shortly.", null, Map.of("Retry-After", "2"));
    }

    private ResponseEntity<?> replay(StoredKey stored, Rebuild rebuild) {
        int status = stored.httpStatus() == null ? 200 : stored.httpStatus();
        HttpHeaders headers = new HttpHeaders();
        headers.set(REPLAYED_HEADER, "true");
        if (!stored.bodyStored()) {
            if (rebuild == null) {
                throw new IllegalStateException("A secret-bearing idempotent response needs a rebuild function");
            }
            ResponseEntity<?> rebuilt = rebuild.apply(stored.resourceId());
            HttpHeaders merged = new HttpHeaders();
            merged.putAll(rebuilt.getHeaders());
            merged.set(REPLAYED_HEADER, "true");
            return ResponseEntity.status(status).headers(merged).body(rebuilt.getBody());
        }
        headers.setContentType(MediaType.APPLICATION_JSON);
        JsonNode body = null;
        if (stored.responseBody() != null) {
            try {
                body = responseMapper.readTree(stored.responseBody());
            } catch (Exception e) {
                throw new IllegalStateException("Stored idempotent response is unreadable", e);
            }
            // A replayed error carries this request's id, not the original's (which was
            // never stored).
            if (body != null && body.path("error").isObject()) {
                String requestId = RequestIds.current();
                ((com.fasterxml.jackson.databind.node.ObjectNode) body.get("error")).put("request_id", requestId);
                if (requestId != null) {
                    headers.set(RequestIds.HEADER, requestId);
                }
            }
        }
        return ResponseEntity.status(status).headers(headers).body(body);
    }

    private void complete(String instituteId, String key, int status, String body, boolean bodyStored,
            String resourceId) {
        try {
            jdbc.update("UPDATE api_idempotency_key SET status = '" + STATUS_COMPLETED + "', http_status = :status, "
                            + "response_body = CAST(:body AS jsonb), body_stored = :bodyStored, resource_id = :resourceId, "
                            + "completed_at = :now WHERE institute_id = :instituteId AND idem_key = :idemKey",
                    new MapSqlParameterSource()
                            .addValue("status", status)
                            .addValue("body", body)
                            .addValue("bodyStored", bodyStored)
                            .addValue("resourceId", resourceId)
                            .addValue("now", nowTimestamp())
                            .addValue("instituteId", instituteId)
                            .addValue("idemKey", key));
        } catch (RuntimeException e) {
            // The call itself succeeded; failing it now would make the partner retry a
            // completed action. Drop the key instead so a retry is not stuck "in progress".
            log.warn("Could not store idempotent response; releasing the key: {}", e.getMessage());
            release(instituteId, key);
        }
    }

    private void release(String instituteId, String key) {
        try {
            jdbc.update("DELETE FROM api_idempotency_key WHERE institute_id = :instituteId AND idem_key = :idemKey "
                            + "AND status = '" + STATUS_IN_PROGRESS + "'",
                    new MapSqlParameterSource().addValue("instituteId", instituteId).addValue("idemKey", key));
        } catch (RuntimeException e) {
            log.warn("Could not release idempotency key: {}", e.getMessage());
        }
    }

    /**
     * Sorted-key copy of the application mapper, so request DTOs serialize exactly as Spring
     * reads them (java.time fields, naming). Modules on the classpath are registered too, in
     * case the injected mapper was built without them.
     */
    static ObjectMapper canonicalMapper(ObjectMapper base) {
        ObjectMapper copy;
        try {
            copy = base == null ? JsonMapper.builder().build() : base.copy();
        } catch (IllegalStateException subclassWithoutCopy) {
            copy = JsonMapper.builder().build();
        }
        copy.findAndRegisterModules();
        copy.configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
        copy.configure(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY, true);
        return copy;
    }

    static boolean storable(int status) {
        return status < 500 && status != 409 && status != 429;
    }

    String fingerprint(String method, String path, Object body) {
        String canonicalBody;
        try {
            JsonNode tree = body instanceof JsonNode node ? node : canonical.valueToTree(body);
            canonicalBody = tree == null || tree.isNull() ? "" : canonical.writeValueAsString(canonical.treeToValue(tree, Object.class));
        } catch (Exception e) {
            throw new IllegalArgumentException("Request body cannot be fingerprinted", e);
        }
        String material = (method == null ? "" : method.toUpperCase()) + " " + (path == null ? "" : path) + "\n"
                + canonicalBody;
        return ApiKeyFormat.sha256Hex(material);
    }

    private String serialize(Object body) {
        if (body == null) {
            return null;
        }
        try {
            return responseMapper.writeValueAsString(body);
        } catch (Exception e) {
            throw new IllegalStateException("Response cannot be stored for idempotent replay", e);
        }
    }

    private String errorBody(OpenApiException e) {
        try {
            return responseMapper.writeValueAsString(vacademy.io.common.auth.apikey.ApiErrorWriter.envelope(
                    e.getCode(), e.getMessage(), null, e.getDetails()));
        } catch (Exception ex) {
            return null;
        }
    }

    private Timestamp nowTimestamp() {
        return Timestamp.valueOf(LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC));
    }

    record StoredKey(String requestHash, String status, Integer httpStatus, String responseBody, boolean bodyStored,
            String resourceId, Timestamp createdAt) {
    }
}
