package vacademy.io.admin_core_service.features.common.util;

/**
 * SQL fragments for matching custom_field_values.value against a list of
 * selected filter options.
 *
 * MULTI_SELECT answers (and some DROPDOWN ones) are stored as a JSON array
 * string, e.g. {@code ["SOCIAL MEDIA","WEBSITE"]}, while every other answer is
 * a plain string. The distinct-values dropdowns explode those arrays into one
 * option per element, so a filter on "SOCIAL MEDIA" must match any stored
 * array that contains it, not only the exact string.
 *
 * Free text can also start with "[" without being JSON ("[Free Demo Class] …"),
 * so the cast is guarded by pg_input_is_valid inside a CASE — Postgres
 * guarantees CASE branch order, a bare AND guard could be reordered by the
 * planner and cast invalid text.
 */
public final class CustomFieldValueSql {

    private CustomFieldValueSql() {
    }

    /**
     * Predicate: {@code valueColumn} equals one of {@code :paramName}, or is a
     * JSON array holding one of them. {@code paramName} is bound to a
     * List&lt;String&gt; exactly as for a plain {@code IN (:param)}.
     */
    public static String matchesAnyOf(String valueColumn, String paramName) {
        return "(" + valueColumn + " IN (:" + paramName + ") OR CASE WHEN " + valueColumn + " LIKE '[%'"
                + " AND pg_input_is_valid(" + valueColumn + ", 'jsonb')"
                + " THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(CAST(" + valueColumn + " AS jsonb)) AS opt(v)"
                + " WHERE opt.v IN (:" + paramName + "))"
                + " ELSE false END)";
    }
}
