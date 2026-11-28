package vacademy.io.admin_core_service.features.common.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldListFilterDTO;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.util.CustomFieldValueSql;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Shared resolver that turns custom-field filter entries into concrete sets of
 * matching IDs, using one indexed lookup per (field, source_type) instead of
 * per-row correlated subqueries in the big list queries (the pattern the leads
 * views adopted after the correlated variant timed out).
 *
 * Semantics: within one entry, values OR together; across entries the matched
 * sets intersect (AND). IS_EMPTY entries can't be expressed as a positive
 * match set ("no row" has no ID to return), so they resolve to an EXCLUSION
 * set instead — every ID that HAS a non-blank value for that field — which the
 * surface query applies as a NOT-IN predicate.
 *
 * Typed comparisons (BETWEEN / GTE / LTE) cast the stored TEXT value at query
 * time behind a format guard, so rows whose text isn't a date/number simply
 * don't match instead of erroring.
 */
@Service
@Slf4j
public class CustomFieldListFilterResolver {

    private static final Pattern DATE_PATTERN = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}");

    /** Which answer rows a surface matches against. */
    public enum Surface {
        /** Leads views — AUDIENCE_RESPONSE answers; IDs are audience_response ids. */
        RESPONSE,
        /** Students list — USER answers; IDs are user ids. */
        USER,
        /** All Contacts — either-match across USER and AUDIENCE_RESPONSE; IDs are user ids. */
        CONTACT,
    }

    /** Outcome of resolving a filter list for one surface. */
    public static class Resolution {
        /** IDs matching every positive entry; null = no positive entries. */
        public final Set<String> matchedIds;
        /** IDs to exclude (from IS_EMPTY entries); null = none. */
        public final Set<String> excludedIds;

        public Resolution(Set<String> matchedIds, Set<String> excludedIds) {
            this.matchedIds = matchedIds;
            this.excludedIds = excludedIds;
        }

        /** Positive filters exist but nothing matches → surface returns an empty page. */
        public boolean shortCircuitsToEmpty() {
            return matchedIds != null && matchedIds.isEmpty();
        }

        /**
         * CSV form for the ANY(STRING_TO_ARRAY(...)) predicates. INVARIANT:
         * callers MUST check {@link #shortCircuitsToEmpty()} first — an empty
         * matched set serializes to "" which the SQL predicates treat as
         * "filter off", i.e. the FULL unfiltered list, the opposite of the
         * intended empty result.
         */
        public String matchedIdsCsv() {
            return matchedIds == null ? null : String.join(",", matchedIds);
        }

        public String excludedIdsCsv() {
            return (excludedIds == null || excludedIds.isEmpty()) ? null : String.join(",", excludedIds);
        }

        /**
         * AND this resolution with another one produced for the SAME surface —
         * e.g. the custom-field match set with the UTM-attribution match set.
         * Matched sets intersect (null = unconstrained on that side); exclusion
         * sets union. When both a matched and an exclusion set survive, the
         * exclusions are folded into the matched set so the surface query
         * applies each id set exactly once.
         */
        public Resolution and(Resolution other) {
            if (other == null) return this;
            Set<String> matched;
            if (matchedIds == null) {
                matched = other.matchedIds == null ? null : new HashSet<>(other.matchedIds);
            } else if (other.matchedIds == null) {
                matched = new HashSet<>(matchedIds);
            } else {
                matched = new HashSet<>(matchedIds);
                matched.retainAll(other.matchedIds);
            }
            Set<String> excluded = null;
            if (excludedIds != null && !excludedIds.isEmpty()) excluded = new HashSet<>(excludedIds);
            if (other.excludedIds != null && !other.excludedIds.isEmpty()) {
                if (excluded == null) excluded = new HashSet<>(other.excludedIds);
                else excluded.addAll(other.excludedIds);
            }
            if (matched != null && excluded != null) {
                matched.removeAll(excluded);
                excluded = null;
            }
            return new Resolution(matched, excluded);
        }
    }

    private static final Resolution NO_FILTERS = new Resolution(null, null);

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    public Resolution resolve(List<CustomFieldListFilterDTO> filters, Surface surface) {
        if (filters == null || filters.isEmpty()) {
            return NO_FILTERS;
        }
        Set<String> matched = null;
        Set<String> excluded = null;
        for (CustomFieldListFilterDTO filter : filters) {
            if (filter == null || filter.getFieldId() == null || filter.getFieldId().isBlank()) {
                continue;
            }
            String operator = normalizeOperator(filter.getOperator());
            if (operator == null) {
                log.warn("Unrecognized custom-field filter operator '{}' on field {}; skipping entry",
                        filter.getOperator(), filter.getFieldId());
                continue;
            }
            List<String> values = sanitizeValues(filter.getValues());
            if (requiresValues(operator) && values.isEmpty()) {
                continue;
            }
            // Range operators need exact bound counts; a malformed entry is
            // skipped rather than silently matching the wrong thing.
            if ("BETWEEN".equals(operator) && values.size() != 2) {
                log.warn("BETWEEN filter on field {} expects [from, to], got {} value(s); skipping",
                        filter.getFieldId(), values.size());
                continue;
            }
            if (("GTE".equals(operator) || "LTE".equals(operator)) && values.size() != 1) {
                log.warn("{} filter on field {} expects exactly one bound, got {}; skipping",
                        operator, filter.getFieldId(), values.size());
                continue;
            }
            if ("IS_EMPTY".equals(operator)) {
                // Exclusion semantics: drop everyone who HAS a value for the field.
                Set<String> hasValue = fetchIds(surface, filter.getFieldId(), "NOT_EMPTY", values);
                excluded = excluded == null ? new HashSet<>(hasValue) : union(excluded, hasValue);
                continue;
            }
            Set<String> ids = fetchIds(surface, filter.getFieldId(), operator, values);
            if (matched == null) {
                matched = ids;
            } else {
                matched.retainAll(ids);
            }
            if (matched.isEmpty()) {
                return new Resolution(matched, excluded);
            }
        }
        if (matched != null && excluded != null) {
            matched.removeAll(excluded);
            // Exclusions already folded into the matched set — don't apply twice.
            return new Resolution(matched, null);
        }
        return new Resolution(matched, excluded);
    }

    /**
     * Searchable, paginated distinct values a custom field holds across an
     * institute's contacts (union of learner and lead answers) — feeds the
     * multi-select dropdowns on the All Contacts filter bar.
     */
    public Page<String> getContactCustomFieldValues(String instituteId, String customFieldId,
            String search, int pageNo, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNo, 0), pageSize > 0 ? pageSize : 20);
        if (instituteId == null || instituteId.isBlank()
                || customFieldId == null || customFieldId.isBlank()) {
            return Page.empty(pageable);
        }
        String normalizedSearch = (search != null && !search.isBlank()) ? search.trim() : null;
        return customFieldValuesRepository.findDistinctContactCustomFieldValues(
                instituteId, customFieldId, normalizedSearch, pageable);
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private Set<String> fetchIds(Surface surface, String fieldId, String operator, List<String> values) {
        Set<String> ids = new HashSet<>();
        if (surface == Surface.RESPONSE || surface == Surface.CONTACT) {
            String select = surface == Surface.RESPONSE
                    ? "SELECT DISTINCT cfv.source_id FROM custom_field_values cfv "
                    : "SELECT DISTINCT ar.user_id FROM custom_field_values cfv "
                            + "JOIN audience_response ar ON ar.id = cfv.source_id ";
            String where = "WHERE cfv.source_type = 'AUDIENCE_RESPONSE' AND cfv.custom_field_id = :fieldId "
                    + (surface == Surface.CONTACT ? "AND ar.user_id IS NOT NULL " : "");
            ids.addAll(runIdQuery(select + where, fieldId, operator, values));
        }
        if (surface == Surface.USER || surface == Surface.CONTACT) {
            String sql = "SELECT DISTINCT cfv.source_id FROM custom_field_values cfv "
                    + "WHERE cfv.source_type = 'USER' AND cfv.custom_field_id = :fieldId ";
            ids.addAll(runIdQuery(sql, fieldId, operator, values));
        }
        return ids;
    }

    @SuppressWarnings("unchecked")
    private List<String> runIdQuery(String baseSql, String fieldId, String operator, List<String> values) {
        StringBuilder sql = new StringBuilder(baseSql).append("AND ");
        switch (operator) {
            case "CONTAINS" -> {
                // Values are escaped (escapeLike) so literal %/_ in the search
                // text match themselves rather than acting as wildcards.
                List<String> parts = new ArrayList<>();
                for (int i = 0; i < values.size(); i++) {
                    parts.add("cfv.value ILIKE CONCAT('%', :v" + i + ", '%') ESCAPE '\\'");
                }
                sql.append("(").append(String.join(" OR ", parts)).append(")");
            }
            case "NOT_EMPTY" -> sql.append("cfv.value IS NOT NULL AND cfv.value <> ''");
            case "BETWEEN", "GTE", "LTE" -> {
                boolean dateMode = allIsoDates(values);
                if (!dateMode && !allNumeric(values)) {
                    // Un-castable bounds would blow up the query — treat as no match.
                    log.warn("Custom-field filter {} on field {} has non-date, non-numeric bounds {}; matching nothing",
                            operator, fieldId, values);
                    return List.of();
                }
                // Date mode compares the yyyy-MM-dd prefix as TEXT — ISO dates
                // order lexicographically, and it avoids CAST entirely (a stored
                // value like '2026-13-99' passes a format regex but would blow
                // up a date cast). Numeric mode wraps the row cast in CASE so
                // the guard is GUARANTEED to run first — a bare `guard AND
                // CAST(...)` lets the planner reorder quals and cast 'TBD'.
                String rowKey = dateMode
                        ? "LEFT(cfv.value, 10)"
                        : "(CASE WHEN cfv.value ~ '^-?\\d+(\\.\\d+)?$' THEN CAST(cfv.value AS numeric) END)";
                String boundParam = dateMode ? ":v%d" : "CAST(:v%d AS numeric)";
                if (dateMode) {
                    sql.append("cfv.value ~ '^\\d{4}-\\d{2}-\\d{2}' AND ");
                }
                sql.append(rowKey);
                if ("BETWEEN".equals(operator)) {
                    sql.append(" BETWEEN ").append(String.format(boundParam, 0))
                            .append(" AND ").append(String.format(boundParam, 1));
                } else {
                    sql.append("GTE".equals(operator) ? " >= " : " <= ").append(String.format(boundParam, 0));
                }
            }
            default -> sql.append(CustomFieldValueSql.matchesAnyOf("cfv.value", "values"));
        }

        Query query = entityManager.createNativeQuery(sql.toString());
        query.setParameter("fieldId", fieldId);
        switch (operator) {
            case "CONTAINS" -> {
                for (int i = 0; i < values.size(); i++) {
                    query.setParameter("v" + i, escapeLike(values.get(i)));
                }
            }
            case "NOT_EMPTY" -> { /* no value params */ }
            case "BETWEEN" -> {
                query.setParameter("v0", values.get(0));
                query.setParameter("v1", values.get(1));
            }
            case "GTE", "LTE" -> query.setParameter("v0", values.get(0));
            default -> query.setParameter("values", values);
        }

        List<Object> raw = query.getResultList();
        return raw.stream()
                .filter(java.util.Objects::nonNull)
                .map(Object::toString)
                .collect(Collectors.toList());
    }

    /** @return the canonical operator, or null for an unrecognized one (the
     *          entry is skipped with a warning — coercing a typo to IN would
     *          confidently return wrong rows). */
    private String normalizeOperator(String operator) {
        if (operator == null || operator.isBlank()) return "IN";
        String op = operator.trim().toUpperCase(Locale.ENGLISH);
        return switch (op) {
            case "IN", "CONTAINS", "IS_EMPTY", "NOT_EMPTY", "BETWEEN", "GTE", "LTE" -> op;
            default -> null;
        };
    }

    /** True when every bound parses as a real ISO date (not just format-shaped). */
    private boolean allIsoDates(List<String> values) {
        for (String v : values) {
            if (!DATE_PATTERN.matcher(v).find()) return false;
            try {
                java.time.LocalDate.parse(v.trim().substring(0, 10));
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    /** Escapes LIKE wildcards so CONTAINS matches them literally (paired with ESCAPE '\'). */
    private String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private boolean requiresValues(String operator) {
        return !"IS_EMPTY".equals(operator) && !"NOT_EMPTY".equals(operator);
    }

    private List<String> sanitizeValues(List<String> values) {
        if (values == null) return List.of();
        List<String> cleaned = values.stream()
                .filter(v -> v != null && !v.isEmpty())
                .distinct()
                .collect(Collectors.toList());
        return cleaned;
    }

    private boolean allNumeric(List<String> values) {
        try {
            for (String v : values) {
                new BigDecimal(v.trim());
            }
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private Set<String> union(Set<String> a, Set<String> b) {
        a.addAll(b);
        return a;
    }
}
