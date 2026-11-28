package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;

import java.util.Locale;

/**
 * The defensive reads the learner site does on hand- or AI-written catalogue JSON
 * ({@code isObject}, {@code text}, {@code norm} in the TS helpers): wrong types read as
 * "absent", never as an error.
 */
public final class CatalogJson {

    private CatalogJson() {
    }

    public static boolean isObject(JsonNode n) {
        return n != null && n.isObject();
    }

    /** {@code v[field]} when {@code v} is an object, else a missing node (never null). */
    public static JsonNode field(JsonNode v, String field) {
        if (!isObject(v)) return MissingNode.getInstance();
        JsonNode out = v.get(field);
        return out == null ? MissingNode.getInstance() : out;
    }

    /** TS {@code text}: a string trimmed, anything else "". */
    public static String text(JsonNode n) {
        return n != null && n.isTextual() ? n.asText().trim() : "";
    }

    /** TS {@code norm}: a string trimmed and lower-cased, anything else "". */
    public static String norm(JsonNode n) {
        return lower(text(n));
    }

    public static String lower(String s) {
        return s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
    }

    public static boolean hasText(String s) {
        return s != null && !s.trim().isEmpty();
    }

    /** {@code raw === true}. */
    public static boolean isTrue(JsonNode n) {
        return n != null && n.isBoolean() && n.booleanValue();
    }
}
