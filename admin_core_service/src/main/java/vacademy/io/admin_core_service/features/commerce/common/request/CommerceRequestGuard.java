package vacademy.io.admin_core_service.features.commerce.common.request;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Exactly-once for staff state changes (pack, ship, cancel, receipts, ...).
 *
 * <p>The change runs in a transaction of its own whose first statement inserts the
 * {@code commerce_request} row of the client key. A repeat of the request meets the unique key:
 * it waits for the first transaction and then fails on the key (the first committed) or goes
 * ahead (the first rolled back). The failure is caught outside the transaction and answered in a
 * new one: the same body gets the current state of the thing it changed ({@code replayed}), a
 * different body gets 409 {@code IDEMPOTENCY_MISMATCH}. A change that is refused rolls its row
 * back with it, so the same key can be sent again once the cause is fixed.
 *
 * <p>The request hash is SHA-256 over the action, the path ids and the canonical body without
 * {@code client_request_id}: keys sorted, numbers without trailing zeros.
 */
@Slf4j
@Component
public class CommerceRequestGuard {

    public static final String IDEMPOTENCY_MISMATCH = "IDEMPOTENCY_MISMATCH";
    /** What a staff client sends: 8 to 64 letters, digits, hyphens or underscores. */
    public static final Pattern CLIENT_KEY = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");
    private static final int MAX_KEY = 64;
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .findAndRegisterModules()
            .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));

    private final CommerceRequestRepository repository;
    private final TransactionTemplate ownTransaction;

    /** What one guarded change is: its key, kind, target and body hash. */
    public record Key(String instituteId, String clientRequestId, String action, String referenceType,
                      String referenceId, String requestHash, String actorUserId) {
    }

    /** The answer, and whether it is the answer to an earlier request with the same key. */
    public record Outcome<T>(T value, boolean replayed) {
    }

    public CommerceRequestGuard(CommerceRequestRepository repository, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** The client key of a request, trimmed. @throws InvalidRequestException (400) when malformed */
    public static String requireClientKey(String raw) {
        String key = raw == null ? null : raw.trim();
        if (key == null || !CLIENT_KEY.matcher(key).matches()) {
            throw new InvalidRequestException("VALIDATION: client_request_id is required: 8 to 64 letters, digits, "
                    + "hyphens or underscores");
        }
        return key;
    }

    /**
     * Runs {@code work} once for the key. {@code current} answers a replay; it runs in a
     * transaction of its own and must only read.
     *
     * @throws ConflictException (409) IDEMPOTENCY_MISMATCH when the key was used for another body
     */
    public <T> Outcome<T> run(Key key, Supplier<T> work, Supplier<T> current) {
        if (key == null || key.clientRequestId() == null || key.clientRequestId().isBlank()
                || key.clientRequestId().length() > MAX_KEY) {
            throw new InvalidRequestException("VALIDATION: client_request_id is required");
        }
        // A replay of a finished request is the common case; it never waits on a row lock.
        CommerceRequest earlier = find(key);
        if (earlier != null) {
            return replay(key, earlier, current);
        }
        try {
            T value = ownTransaction.execute(status -> {
                repository.insert(UUID.randomUUID().toString(), key.instituteId(), key.clientRequestId(),
                        clip(key.action(), 32), clip(key.referenceType(), 32), clip(key.referenceId(), 36),
                        key.requestHash(), clip(key.actorUserId(), 36));
                return work.get();
            });
            return new Outcome<>(value, false);
        } catch (DataIntegrityViolationException e) {
            CommerceRequest first = find(key);
            if (first == null) {
                // Not the key: another constraint refused the change.
                throw e;
            }
            return replay(key, first, current);
        }
    }

    private CommerceRequest find(Key key) {
        return ownTransaction.execute(status -> repository
                .findByInstituteIdAndClientRequestId(key.instituteId(), key.clientRequestId()).orElse(null));
    }

    private <T> Outcome<T> replay(Key key, CommerceRequest first, Supplier<T> current) {
        if (!key.requestHash().equals(first.getRequestHash()) || !clip(key.action(), 32).equals(first.getAction())) {
            throw new ConflictException(IDEMPOTENCY_MISMATCH + ": client_request_id was already used for another "
                    + "request");
        }
        return new Outcome<>(ownTransaction.execute(status -> current.get()), true);
    }

    // ------------------------------------------------------------------ hash

    /** SHA-256 hex of the action, the path ids and the body without {@code client_request_id}. */
    public static String hash(String action, Object body, String... pathIds) {
        JsonNode tree = body == null ? MAPPER.nullNode() : MAPPER.valueToTree(body);
        if (tree instanceof ObjectNode object) {
            object.remove("client_request_id");
            object.remove("clientRequestId");
        }
        StringBuilder text = new StringBuilder(action == null ? "" : action).append('|');
        for (String id : pathIds) {
            text.append(id == null ? "" : id).append('|');
        }
        text.append(canonical(tree));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    /** Keys sorted, nulls left out, numbers without trailing zeros. */
    static String canonical(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return "null";
        }
        if (node.isObject()) {
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            names.sort(null);
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (String name : names) {
                JsonNode value = node.get(name);
                if (value == null || value.isNull()) {
                    continue;
                }
                if (!first) {
                    out.append(',');
                }
                first = false;
                out.append(quote(name)).append(':').append(canonical(value));
            }
            return out.append('}').toString();
        }
        if (node.isArray()) {
            StringBuilder out = new StringBuilder("[");
            Iterator<JsonNode> items = ((ArrayNode) node).elements();
            boolean first = true;
            while (items.hasNext()) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                out.append(canonical(items.next()));
            }
            return out.append(']').toString();
        }
        if (node.isNumber()) {
            return node.decimalValue().stripTrailingZeros().toPlainString();
        }
        if (node.isTextual()) {
            return quote(node.asText());
        }
        return node.toString();
    }

    private static String quote(String text) {
        try {
            return MAPPER.writeValueAsString(text);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String clip(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
