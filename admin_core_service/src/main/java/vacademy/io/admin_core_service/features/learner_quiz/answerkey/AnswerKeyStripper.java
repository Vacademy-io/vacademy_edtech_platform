package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Set;

/**
 * Removes what grading needs and a learner should not hold before submitting. Works on the
 * JSON tree rather than on each DTO, so a slide type nested anywhere in a response, or added
 * later with the same field names, is covered without knowing the DTO.
 */
@Component
@RequiredArgsConstructor
public class AnswerKeyStripper {

    /** Removed wherever they appear, in the spellings the DTOs serialise to. */
    private static final Set<String> ANSWER_FIELDS = Set.of(
            "auto_evaluation_json", "autoEvaluationJson",
            "explanation_text", "explanationText",
            "explanation_text_data", "explanationTextData");

    private static final List<String> SOURCE_TYPE_FIELDS = List.of("source_type", "sourceType");
    private static final List<String> DESCRIPTION_FIELDS = List.of("description", "slideDescription", "slide_description");

    private final ObjectMapper objectMapper;

    /** A copy of {@code body} as JSON with answers removed; {@code body} itself is not changed. */
    public JsonNode strip(Object body) {
        JsonNode tree = objectMapper.valueToTree(body);
        stripNode(tree);
        return tree;
    }

    /** The stored response of one attempt, without the correct answers recorded in it. */
    public String withoutCorrectOptions(String responseJson) {
        if (!StringUtils.hasText(responseJson) || !responseJson.contains("correctOptions")) {
            return responseJson;
        }
        try {
            JsonNode root = objectMapper.readTree(responseJson);
            if (root instanceof ObjectNode object) {
                object.remove("correctOptions");
                return object.toString();
            }
            return responseJson;
        } catch (Exception e) {
            // Unreadable, so it cannot be shown to be free of answers.
            return "{}";
        }
    }

    private void stripNode(JsonNode node) {
        if (node instanceof ArrayNode array) {
            array.forEach(this::stripNode);
            return;
        }
        if (!(node instanceof ObjectNode object)) {
            return;
        }
        object.remove(ANSWER_FIELDS);
        if (isQuiz(object)) {
            blankGeneratedDescription(object);
        }
        object.forEach(this::stripNode);
    }

    private static boolean isQuiz(ObjectNode object) {
        return SOURCE_TYPE_FIELDS.stream().map(object::path).anyMatch(n -> "QUIZ".equals(n.asText()));
    }

    /**
     * A quiz slide description can hold the quiz generator's raw output. A real description
     * is text, so anything shaped like that output goes.
     */
    private static void blankGeneratedDescription(ObjectNode object) {
        for (String field : DESCRIPTION_FIELDS) {
            JsonNode value = object.get(field);
            if (value != null && value.isTextual() && value.asText().trim().startsWith("{")) {
                object.putNull(field);
            }
        }
    }
}
