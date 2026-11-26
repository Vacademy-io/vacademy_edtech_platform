package vacademy.io.assessment_service.features.assessment.copy;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Old id -> new id for one assessment copy, and the rewriting of ids that live inside
 * JSON text: the answer key ({@code auto_evaluation_json.data.correctOptionIds}), a paper
 * set's question order, a choice group's question list.
 *
 * <p>Only a JSON string value (or object key) that is exactly an old id is replaced, so
 * text that merely contains an id is never touched. A value that is not JSON is returned
 * unchanged, and so is JSON with nothing to replace (byte for byte, so the copy does not
 * reformat numbers or whitespace it had no reason to change).
 */
final class CopyIdRemapper {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    private final Map<String, String> ids;

    CopyIdRemapper(Map<String, String> ids) {
        this.ids = ids;
    }

    /** The new id of {@code oldId}, or {@code oldId} itself when it was not copied. */
    String id(String oldId) {
        if (oldId == null) return null;
        return ids.getOrDefault(oldId, oldId);
    }

    String json(String text) {
        if (text == null || text.isBlank() || ids.isEmpty()) return text;
        JsonNode root;
        try {
            root = MAPPER.readTree(text);
        } catch (Exception notJson) {
            return text;
        }
        if (root == null) return text;
        if (root.isTextual()) {
            String mapped = ids.get(root.asText());
            return mapped == null ? text : TextNode.valueOf(mapped).toString();
        }
        if (!rewrite(root)) return text;
        try {
            return MAPPER.writeValueAsString(root);
        } catch (Exception e) {
            return text;
        }
    }

    /** Rewrites ids in place; true when anything changed. */
    private boolean rewrite(JsonNode node) {
        boolean changed = false;
        if (node instanceof ObjectNode object) {
            List<String> renamed = new ArrayList<>();
            Iterator<Map.Entry<String, JsonNode>> fields = object.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                JsonNode value = field.getValue();
                if (value.isTextual() && ids.containsKey(value.asText())) {
                    field.setValue(TextNode.valueOf(ids.get(value.asText())));
                    changed = true;
                } else if (value.isContainerNode()) {
                    changed |= rewrite(value);
                }
                if (ids.containsKey(field.getKey())) renamed.add(field.getKey());
            }
            for (String key : renamed) {
                JsonNode value = object.remove(key);
                object.set(ids.get(key), value);
                changed = true;
            }
        } else if (node instanceof ArrayNode array) {
            for (int i = 0; i < array.size(); i++) {
                JsonNode value = array.get(i);
                if (value.isTextual() && ids.containsKey(value.asText())) {
                    array.set(i, TextNode.valueOf(ids.get(value.asText())));
                    changed = true;
                } else if (value.isContainerNode()) {
                    changed |= rewrite(value);
                }
            }
        }
        return changed;
    }

    /**
     * A question's marking with the marks reset to 1 and no negative marking, for a copy
     * made without the marking scheme. The question type and any partial-marking ratio
     * (a share of the full mark, not a mark) are kept. Unreadable marking is kept as is.
     */
    static String defaultMarking(String markingJson) {
        if (markingJson == null || markingJson.isBlank()) return markingJson;
        try {
            JsonNode root = MAPPER.readTree(markingJson);
            if (!(root instanceof ObjectNode object) || !(object.get("data") instanceof ObjectNode data)) {
                return markingJson;
            }
            // Same value types the admin's Step 2 writes: marks as strings.
            data.put("totalMark", "1");
            data.put("negativeMark", "0");
            data.put("negativeMarkingPercentage", 0);
            return MAPPER.writeValueAsString(object);
        } catch (Exception e) {
            return markingJson;
        }
    }

    /**
     * {@code json} without the top-level {@code key}; unchanged (byte for byte) when the key
     * is absent or the text is not a JSON object.
     */
    static String withoutKey(String json, String key) {
        if (json == null || json.isBlank()) return json;
        try {
            if (!(MAPPER.readTree(json) instanceof ObjectNode object) || !object.has(key)) return json;
            object.remove(key);
            return MAPPER.writeValueAsString(object);
        } catch (Exception e) {
            return json;
        }
    }
}
