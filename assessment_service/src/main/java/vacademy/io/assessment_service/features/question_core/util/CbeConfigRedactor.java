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

    public static boolean isCbe(String questionType) {
        return CBE_TYPE.equalsIgnoreCase(questionType);
    }
}
