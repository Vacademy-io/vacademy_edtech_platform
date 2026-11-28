package vacademy.io.admin_core_service.features.utm_attribution.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution;
import vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns a {@link UtmListFilterDTO} into the set of list-surface ids whose
 * person has a matching campaign touch — the same "pre-resolve, then IN" shape
 * the custom-field filters use, so every list query stays untouched and the two
 * filter families combine with a plain set intersection
 * ({@link Resolution#and(Resolution)}).
 *
 * The join is on IDENTITY, not on the row: a touch is keyed by user id, or by
 * the email / mobile the visitor typed when no user existed yet. Each identity
 * key is matched in its own UNION branch (rather than one OR-joined predicate)
 * so PostgreSQL can hash-join each branch against the small, already-filtered
 * touch set instead of nested-looping the whole leads table.
 *
 * A mobile with fewer than 8 digits is never used as a key. Optional phone
 * fields save as "+91" in this product, and matching on that would join every
 * learner who skipped the field to every touch that did the same.
 */
@Service
@Slf4j
public class UtmListFilterResolver {

    private static final Resolution NO_FILTERS = new Resolution(null, null);

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * @return matched ids for the surface (null = no UTM filter sent), or an
     *         exclusion set when {@code untagged_only} is requested. An empty
     *         matched set means "a filter was sent and nothing matches" — the
     *         caller must short-circuit to an empty page.
     */
    public Resolution resolve(UtmListFilterDTO filter, Surface surface, String instituteId) {
        if (filter == null || !filter.hasAny()) return NO_FILTERS;
        if (instituteId == null || instituteId.isBlank()) {
            // Touches are institute-scoped; without an institute there is
            // nothing safe to match against. Treat as "matches nothing".
            return new Resolution(new HashSet<>(), null);
        }
        try {
            if (Boolean.TRUE.equals(filter.getUntaggedOnly())) {
                // Everyone with ANY touch is excluded — the dimension lists are
                // irrelevant (a person cannot be both untagged and on a campaign).
                Set<String> tagged = fetchIds(new UtmListFilterDTO(), surface, instituteId);
                return new Resolution(null, tagged);
            }
            return new Resolution(fetchIds(filter, surface, instituteId), null);
        } catch (Exception e) {
            // A broken attribution filter must not take the whole list down —
            // log it and fall back to "matches nothing" so the admin sees an
            // empty page for THIS filter rather than an unfiltered list that
            // silently ignores what they asked for.
            log.warn("[utm-filter] resolution failed for institute {} on {}: {}",
                    instituteId, surface, e.getMessage());
            return new Resolution(new HashSet<>(), null);
        }
    }

    // ── Internals ─────────────────────────────────────────────────────────

    private Set<String> fetchIds(UtmListFilterDTO filter, Surface surface, String instituteId) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("instituteId", instituteId);
        String touches = touchesCte(filter, params);
        String sql = surface == Surface.RESPONSE
                ? responseIdsSql(touches)
                : userIdsSql(touches);
        Query query = entityManager.createNativeQuery(sql);
        params.forEach(query::setParameter);
        @SuppressWarnings("unchecked")
        List<Object> raw = query.getResultList();
        Set<String> ids = new HashSet<>();
        for (Object o : raw) {
            if (o != null) ids.add(o.toString());
        }
        return ids;
    }

    /**
     * The touch set every branch joins against: this institute's touches
     * narrowed by every dimension the filter carries. Materialised so the
     * planner computes it once rather than re-running it per UNION branch.
     */
    private String touchesCte(UtmListFilterDTO filter, Map<String, Object> params) {
        StringBuilder sb = new StringBuilder();
        sb.append("WITH t AS MATERIALIZED (")
          .append("SELECT u.user_id, u.email, ")
          // Null out placeholder mobiles so they can never act as a match key.
          .append("CASE WHEN u.mobile_number IS NOT NULL ")
          .append("AND LENGTH(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g')) >= 8 ")
          .append("THEN u.mobile_number END AS mobile_number ")
          .append("FROM utm_attribution u WHERE u.institute_id = :instituteId ");
        appendIn(sb, params, "LOWER(u.utm_source)", "sources", UtmListFilterDTO.normalise(filter.getSources()));
        appendIn(sb, params, "LOWER(u.utm_medium)", "mediums", UtmListFilterDTO.normalise(filter.getMediums()));
        appendIn(sb, params, "LOWER(u.utm_campaign)", "campaigns", UtmListFilterDTO.normalise(filter.getCampaigns()));
        appendIn(sb, params, "LOWER(u.utm_content)", "contents", UtmListFilterDTO.normalise(filter.getContents()));
        appendIn(sb, params, "LOWER(u.utm_term)", "terms", UtmListFilterDTO.normalise(filter.getTerms()));
        appendIn(sb, params, "u.source_type", "sourceTypes", UtmListFilterDTO.normaliseUpper(filter.getSourceTypes()));
        sb.append(") ");
        return sb.toString();
    }

    private static void appendIn(StringBuilder sb, Map<String, Object> params,
                                 String column, String param, List<String> values) {
        if (values == null || values.isEmpty()) return;
        sb.append("AND ").append(column).append(" IN (:").append(param).append(") ");
        params.put(param, values);
    }

    /** Leads views: audience_response ids of this institute whose person touched. */
    private String responseIdsSql(String touches) {
        return touches
                + "SELECT ar.id FROM t "
                + "JOIN audience_response ar ON ar.user_id = t.user_id "
                + "JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId "
                + "WHERE t.user_id IS NOT NULL "
                + "UNION "
                + "SELECT ar.id FROM t "
                + "JOIN audience_response ar ON ar.student_user_id = t.user_id "
                + "JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId "
                + "WHERE t.user_id IS NOT NULL "
                + "UNION "
                + "SELECT ar.id FROM t "
                + "JOIN audience_response ar ON LOWER(ar.parent_email) = t.email "
                + "JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId "
                + "WHERE t.email IS NOT NULL "
                + "UNION "
                + "SELECT ar.id FROM t "
                + "JOIN audience_response ar ON ar.parent_mobile = t.mobile_number "
                + "JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId "
                + "WHERE t.mobile_number IS NOT NULL";
    }

    /**
     * Students / All Contacts: user ids. A touch that already carries a user id
     * IS that person; the contact branches recover the id for touches recorded
     * before one existed, through whichever record later captured the same
     * email or mobile (the learner row, or a lead in this institute).
     */
    private String userIdsSql(String touches) {
        return touches
                + "SELECT t.user_id FROM t WHERE t.user_id IS NOT NULL "
                + "UNION "
                + "SELECT s.user_id FROM t JOIN student s ON LOWER(s.email) = t.email "
                + "WHERE t.email IS NOT NULL AND s.user_id IS NOT NULL "
                + "UNION "
                + "SELECT s.user_id FROM t JOIN student s ON s.mobile_number = t.mobile_number "
                + "WHERE t.mobile_number IS NOT NULL AND s.user_id IS NOT NULL "
                + "UNION "
                + "SELECT ar.user_id FROM t "
                + "JOIN audience_response ar ON LOWER(ar.parent_email) = t.email "
                + "JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId "
                + "WHERE t.email IS NOT NULL AND ar.user_id IS NOT NULL "
                + "UNION "
                + "SELECT ar.user_id FROM t "
                + "JOIN audience_response ar ON ar.parent_mobile = t.mobile_number "
                + "JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :instituteId "
                + "WHERE t.mobile_number IS NOT NULL AND ar.user_id IS NOT NULL";
    }

    /** Guard used by callers deciding whether to spend a resolution at all. */
    public static boolean hasFilter(UtmListFilterDTO filter) {
        return filter != null && filter.hasAny();
    }
}
