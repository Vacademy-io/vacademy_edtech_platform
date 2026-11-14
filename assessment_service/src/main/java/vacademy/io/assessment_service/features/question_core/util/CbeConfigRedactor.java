package vacademy.io.assessment_service.features.question_core.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;

import java.util.List;

/**
 * Strips the secret half of a CBE_RESPONSE question config (auto_evaluation_json,
 * docs/CBE_RESPONSE_QUESTION.md §3) before it reaches a learner:
 * {@code data.parts[].solution}, {@code data.parts[].markingScheme},
 * {@code data.parts[].solutionFileId} and {@code data.gradingNotes} — exactly these,
 * nothing else.
 *
 * Any other question type's JSON is returned untouched (same String instance). A
 * CBE config that cannot be parsed is withheld entirely (null): failing closed is
 * the only safe answer when we cannot tell where the solution is.
 */
@Slf4j
public final class CbeConfigRedactor {

    public static final String CBE_TYPE = "CBE_RESPONSE";
    public static final List<String> SECRET_PART_KEYS = List.of("solution", "markingScheme", "solutionFileId");
    public static final String SECRET_DATA_KEY = "gradingNotes";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CbeConfigRedactor() {
    }

    /** Redact by the JSON's own {@code type}. Non-CBE JSON passes through untouched. */
    public static String redact(String autoEvaluationJson) {
        return redact(autoEvaluationJson, null);
    }

    /**
     * @param questionType the question's {@code question_type} when the caller knows it;
     *                     a CBE question is redacted even if its JSON lost its {@code type}.
     */
    public static String redact(String autoEvaluationJson, String questionType) {
        if (autoEvaluationJson == null || autoEvaluationJson.isBlank()) {
            return autoEvaluationJson;
        }
        boolean knownCbe = CBE_TYPE.equalsIgnoreCase(questionType);
        // Cheap guard: every other question's JSON skips the parse entirely.
        if (!knownCbe && !autoEvaluationJson.contains(CBE_TYPE)) {
            return autoEvaluationJson;
        }
        try {
            JsonNode root = MAPPER.readTree(autoEvaluationJson);
            if (root == null || !root.isObject()) {
                return knownCbe ? null : autoEvaluationJson;
            }
            if (!knownCbe && !CBE_TYPE.equalsIgnoreCase(root.path("type").asText(""))) {
                return autoEvaluationJson;
            }
            redactInPlace((ObjectNode) root);
            return MAPPER.writeValueAsString(root);
        } catch (Exception e) {
            log.warn("[CBE] unreadable CBE config withheld from learner payload: {}", e.getMessage());
            return null;
        }
    }

    /** Removes the secret keys from a parsed config ({type, data:{...}}) in place. */
    public static void redactInPlace(ObjectNode root) {
        if (root == null) return;
        JsonNode data = root.get("data");
        if (data == null || !data.isObject()) return;
        ObjectNode dataObj = (ObjectNode) data;
        dataObj.remove(SECRET_DATA_KEY);
        JsonNode parts = dataObj.get("parts");
        if (parts != null && parts.isArray()) {
            for (JsonNode part : parts) {
                if (part != null && part.isObject()) {
                    ((ObjectNode) part).remove(SECRET_PART_KEYS);
                }
            }
        }
    }

    /**
     * Saving over a stored CBE question: every secret key the incoming config leaves out
     * ({@code data.gradingNotes}, or a part's {@code solution} / {@code markingScheme} /
     * {@code solutionFileId}, matched to the stored part by {@code id}) is copied from the
     * stored config. A config the editor loaded redacted (a caller the read path did not
     * count as staff) therefore cannot wipe the solution when it is saved back; a key the
     * client does send, even as null, is taken as the client's decision. Mirrors admin_core
     * CbeConfigSecrets.split/overlay for question slides.
     *
     * @return {@code incoming} unchanged (same instance) when nothing was missing, either side
     * is unreadable, or the incoming JSON is not a CBE config.
     */
    public static String keepStoredSecrets(String stored, String incoming) {
        if (stored == null || stored.isBlank() || incoming == null || incoming.isBlank()) return incoming;
        try {
            JsonNode in = MAPPER.readTree(incoming);
            JsonNode base = MAPPER.readTree(stored);
            if (!(in instanceof ObjectNode) || base == null || !base.isObject()) return incoming;
            if (!CBE_TYPE.equalsIgnoreCase(in.path("type").asText(""))) return incoming;
            JsonNode inData = in.get("data");
            JsonNode baseData = base.get("data");
            if (!(inData instanceof ObjectNode inDataObj) || baseData == null || !baseData.isObject()) return incoming;
            boolean changed = false;
            if (!inDataObj.has(SECRET_DATA_KEY) && baseData.has(SECRET_DATA_KEY)) {
                inDataObj.set(SECRET_DATA_KEY, baseData.get(SECRET_DATA_KEY));
                changed = true;
            }
            JsonNode inParts = inDataObj.get("parts");
            JsonNode baseParts = baseData.get("parts");
            if (inParts != null && inParts.isArray() && baseParts != null && baseParts.isArray()) {
                for (JsonNode part : inParts) {
                    if (!(part instanceof ObjectNode partObj)) continue;
                    String id = partObj.path("id").asText("");
                    if (id.isBlank()) continue;
                    JsonNode storedPart = null;
                    for (JsonNode candidate : baseParts) {
                        if (id.equals(candidate.path("id").asText(null))) {
                            storedPart = candidate;
                            break;
                        }
                    }
                    if (storedPart == null) continue;
                    for (String key : SECRET_PART_KEYS) {
                        if (!partObj.has(key) && storedPart.has(key)) {
                            partObj.set(key, storedPart.get(key));
                            changed = true;
                        }
                    }
                }
            }
            if (!changed) return incoming;
            log.info("[CBE] save carried a config without some secret keys; kept the stored ones");
            return MAPPER.writeValueAsString(in);
        } catch (Exception e) {
            return incoming;
        }
    }

    public static boolean isCbe(String questionType) {
        return CBE_TYPE.equalsIgnoreCase(questionType);
    }
}
