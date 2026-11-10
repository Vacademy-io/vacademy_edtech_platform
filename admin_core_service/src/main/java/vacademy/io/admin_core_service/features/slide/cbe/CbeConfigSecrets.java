package vacademy.io.admin_core_service.features.slide.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The secret half of a Spreadsheet &amp; Written Response ({@code CBE_RESPONSE}) question
 * config, for question slides. See docs/CBE_RESPONSE_QUESTION.md section 3.
 *
 * <p>{@code question_slide.auto_evaluation_json} reaches learners through the native slide
 * queries, so it only ever holds the redacted config. The secret keys
 * ({@code parts[].solution}, {@code parts[].markingScheme}, {@code parts[].solutionFileId},
 * {@code data.gradingNotes}) live in {@code question_slide.evaluation_secret_json} as
 * {@code {"parts":[{"id","solution","markingScheme","solutionFileId"}],"gradingNotes"}}.
 * Splitting happens on the server, so a client that sends the full config cannot leak it.
 */
public final class CbeConfigSecrets {

    public static final String QUESTION_TYPE = "CBE_RESPONSE";

    static final List<String> PART_SECRET_KEYS = List.of("solution", "markingScheme", "solutionFileId");
    static final String GRADING_NOTES = "gradingNotes";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CbeConfigSecrets() {
    }

    public static boolean isCbe(String questionType) {
        return QUESTION_TYPE.equalsIgnoreCase(questionType == null ? null : questionType.trim());
    }

    /** True when the stored question type or the config itself says CBE_RESPONSE. */
    public static boolean isCbe(String questionType, String autoEvaluationJson) {
        if (isCbe(questionType)) {
            return true;
        }
        if (!StringUtils.hasText(autoEvaluationJson) || !autoEvaluationJson.contains(QUESTION_TYPE)) {
            return false;
        }
        JsonNode root = readOrNull(autoEvaluationJson);
        return root != null && QUESTION_TYPE.equals(root.path("type").asText(null));
    }

    /**
     * @param redactedConfig the config with every secret key removed (null when no config was sent)
     * @param secret         the secret the request carried, or null when it carried none, in which
     *                       case whatever is stored must be kept
     * @param explicit       true when {@code secret} came from {@code evaluation_secret_json}: it
     *                       replaces the stored one outright. Otherwise it was pulled out of the
     *                       config and is laid over the stored one part by part
     *                       ({@link #resolve}).
     */
    public record Split(String redactedConfig, String secret, boolean explicit) {

        /** The secret to store given what is stored now; null means leave the column alone. */
        public String resolve(String storedSecret) {
            if (secret == null) {
                return null;
            }
            return explicit ? secret : overlay(storedSecret, secret);
        }
    }

    /**
     * Splits what a client sent. A secret key present in the config, even with a null value,
     * counts as the client stating the secret; an explicit, non-blank
     * {@code evaluation_secret_json} wins over that. A config that is not JSON is kept as it is
     * (there is nothing to strip that a learner could read as a solution).
     */
    public static Split split(String autoEvaluationJson, String explicitSecretJson) {
        String redacted = autoEvaluationJson;
        String extracted = null;
        if (StringUtils.hasText(autoEvaluationJson)) {
            JsonNode root = readOrNull(autoEvaluationJson);
            if (root instanceof ObjectNode rootObject) {
                ObjectNode secret = JsonNodeFactory.instance.objectNode();
                boolean found = extractInto(rootObject, secret);
                redacted = rootObject.toString();
                if (found) {
                    extracted = secret.toString();
                }
            }
        }
        if (!isBlankSecret(explicitSecretJson)) {
            return new Split(redacted, normaliseSecret(explicitSecretJson), true);
        }
        return new Split(redacted, extracted, false);
    }

    /**
     * {@code incoming} over {@code stored}: a part {@code incoming} names replaces the stored
     * part with that id, parts it does not name keep what is stored, and grading notes are
     * replaced only when {@code incoming} has the key. So a client that sends the full config
     * for one part and the redacted one for another loses nothing.
     */
    public static String overlay(String stored, String incoming) {
        JsonNode in = readOrNull(incoming);
        if (!(in instanceof ObjectNode incomingObject)) {
            return incoming;
        }
        JsonNode base = readOrNull(stored);
        if (!(base instanceof ObjectNode storedObject)) {
            return incomingObject.toString();
        }
        ObjectNode out = storedObject.deepCopy();
        if (incomingObject.has(GRADING_NOTES)) {
            out.set(GRADING_NOTES, incomingObject.get(GRADING_NOTES));
        }
        ArrayNode outParts = out.get("parts") instanceof ArrayNode existing ? existing : out.putArray("parts");
        if (incomingObject.get("parts") instanceof ArrayNode incomingParts) {
            for (JsonNode part : incomingParts) {
                String key = partKey(part);
                boolean replaced = false;
                for (int i = 0; i < outParts.size() && key != null; i++) {
                    if (key.equals(partKey(outParts.get(i)))) {
                        outParts.set(i, part);
                        replaced = true;
                        break;
                    }
                }
                if (!replaced) {
                    outParts.add(part);
                }
            }
        }
        return out.toString();
    }

    private static String partKey(JsonNode part) {
        String id = part.path("id").asText(null);
        if (StringUtils.hasText(id)) {
            return "id:" + id;
        }
        return part.has("index") ? "index:" + part.get("index").asInt() : null;
    }

    /** The config with the secret put back, as ai_service needs it to grade. */
    public static String merge(String redactedConfig, String secretJson) {
        JsonNode root = readOrNull(redactedConfig);
        ObjectNode rootObject = root instanceof ObjectNode object ? object
                : JsonNodeFactory.instance.objectNode().put("type", QUESTION_TYPE);
        JsonNode secret = readOrNull(secretJson);
        if (secret == null || !secret.isObject()) {
            return rootObject.toString();
        }
        ObjectNode data = dataNode(rootObject, true);
        if (secret.hasNonNull(GRADING_NOTES)) {
            data.set(GRADING_NOTES, secret.get(GRADING_NOTES));
        }
        JsonNode configParts = data.get("parts");
        JsonNode secretParts = secret.get("parts");
        if (configParts instanceof ArrayNode parts && secretParts instanceof ArrayNode stored) {
            Map<String, JsonNode> byId = new HashMap<>();
            Map<Integer, JsonNode> byIndex = new HashMap<>();
            for (JsonNode s : stored) {
                String id = s.path("id").asText(null);
                if (StringUtils.hasText(id)) {
                    byId.put(id, s);
                } else if (s.has("index")) {
                    byIndex.put(s.get("index").asInt(), s);
                }
            }
            for (int i = 0; i < parts.size(); i++) {
                if (!(parts.get(i) instanceof ObjectNode part)) {
                    continue;
                }
                String id = part.path("id").asText(null);
                JsonNode s = StringUtils.hasText(id) ? byId.get(id) : byIndex.get(i);
                if (s == null) {
                    continue;
                }
                for (String key : PART_SECRET_KEYS) {
                    if (s.has(key)) {
                        part.set(key, s.get(key));
                    }
                }
            }
        }
        return rootObject.toString();
    }

    /**
     * What the learner sees after a submission: each part's model solution and marking scheme
     * ({@code solutionFileId} and the grading notes stay with staff). Null when nothing is stored.
     */
    public static JsonNode solutionForLearner(String secretJson) {
        JsonNode secret = readOrNull(secretJson);
        if (secret == null || !(secret.get("parts") instanceof ArrayNode stored)) {
            return null;
        }
        ObjectNode out = JsonNodeFactory.instance.objectNode();
        ArrayNode parts = out.putArray("parts");
        for (JsonNode s : stored) {
            ObjectNode p = parts.addObject();
            p.set("id", s.path("id").isMissingNode() ? JsonNodeFactory.instance.nullNode() : s.get("id"));
            p.set("solution", s.has("solution") ? s.get("solution") : JsonNodeFactory.instance.nullNode());
            p.set("markingScheme", s.has("markingScheme") ? s.get("markingScheme")
                    : JsonNodeFactory.instance.arrayNode());
        }
        return out;
    }

    /** Sum of {@code parts[].marks}; null when the config has no positive part marks. */
    public static Double totalPartMarks(String config) {
        JsonNode root = readOrNull(config);
        if (!(root instanceof ObjectNode rootObject)) {
            return null;
        }
        JsonNode parts = dataNode(rootObject, false).path("parts");
        if (!parts.isArray()) {
            return null;
        }
        double total = 0;
        for (JsonNode part : parts) {
            JsonNode marks = part.path("marks");
            if (marks.isNumber()) {
                total += marks.asDouble();
            } else if (marks.isTextual()) {
                try {
                    total += Double.parseDouble(marks.asText().trim());
                } catch (NumberFormatException ignored) {
                    // a non-numeric mark adds nothing
                }
            }
        }
        return total > 0 ? total : null;
    }

    /** Null, whitespace, {@code null}, or an empty object: nothing that may replace a stored secret. */
    static boolean isBlankSecret(String secretJson) {
        if (!StringUtils.hasText(secretJson)) {
            return true;
        }
        String trimmed = secretJson.trim();
        if ("null".equals(trimmed)) {
            return true;
        }
        JsonNode node = readOrNull(trimmed);
        return node != null && node.isObject() && node.isEmpty();
    }

    // ------------------------------------------------------------------ internals

    /** Moves the secret keys out of {@code root} into {@code secret}; true if any key was present. */
    private static boolean extractInto(ObjectNode root, ObjectNode secret) {
        boolean found = false;
        ObjectNode data = dataNode(root, false);
        if (data.has(GRADING_NOTES)) {
            secret.set(GRADING_NOTES, data.remove(GRADING_NOTES));
            found = true;
        }
        ArrayNode secretParts = secret.putArray("parts");
        if (data.get("parts") instanceof ArrayNode parts) {
            for (int i = 0; i < parts.size(); i++) {
                if (!(parts.get(i) instanceof ObjectNode part)) {
                    continue;
                }
                ObjectNode s = JsonNodeFactory.instance.objectNode();
                String id = part.path("id").asText(null);
                if (StringUtils.hasText(id)) {
                    s.put("id", id);
                } else {
                    s.put("index", i);
                }
                boolean partHasSecret = false;
                for (String key : PART_SECRET_KEYS) {
                    if (part.has(key)) {
                        s.set(key, part.remove(key));
                        partHasSecret = true;
                    }
                }
                if (partHasSecret) {
                    secretParts.add(s);
                    found = true;
                }
            }
        }
        // A config sent without the data wrapper keeps parts at the top level.
        if (data != root && root.has(GRADING_NOTES)) {
            JsonNode notes = root.remove(GRADING_NOTES);
            if (!secret.has(GRADING_NOTES)) {
                secret.set(GRADING_NOTES, notes);
            }
            found = true;
        }
        return found;
    }

    private static ObjectNode dataNode(ObjectNode root, boolean create) {
        JsonNode data = root.get("data");
        if (data instanceof ObjectNode object) {
            return object;
        }
        if (root.has("parts") || !create) {
            return root;
        }
        return root.putObject("data");
    }

    /** Stored in the canonical shape; a secret that is not a JSON object is stored as sent. */
    private static String normaliseSecret(String secretJson) {
        JsonNode node = readOrNull(secretJson);
        return node != null && node.isObject() ? node.toString() : secretJson;
    }

    private static JsonNode readOrNull(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
