package vacademy.io.admin_core_service.features.audience.leadagent.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Institute-wide "is this contact already a lead?" lookups for the Lead Agent.
 *
 * <p>Matches on the lead row itself ({@code audience_response.parent_mobile} /
 * {@code parent_email}), which every lead path fills ({@code AudienceService.submitLead} writes
 * the submitted mobile and email there) and which the platform's own dedup
 * ({@code LeadDeduplicationService}) uses. Auth tables are not in this database, so the auth
 * user's own phone/email is deliberately not consulted. Any lead list of the institute counts,
 * including duplicates and opted-out leads; soft-deleted leads ({@code audience_status =
 * 'INACTIVE'}) do not. The expressions match the indexes
 * {@code idx_audience_response_parent_mobile_last10} (V537) and
 * {@code idx_audience_response_parent_email_lower_trim} (V548: some stored emails carry
 * surrounding whitespace, so the trim is needed to match them).
 */
@Component
@RequiredArgsConstructor
public class LeadAgentContactLookup {

    private static final String PHONES_SQL = """
            SELECT DISTINCT RIGHT(regexp_replace(ar.parent_mobile, '[^0-9]', '', 'g'), 10) AS last10
            FROM audience_response ar
            JOIN audience a ON a.id = ar.audience_id
            WHERE a.institute_id = :instituteId
              AND ar.parent_mobile IS NOT NULL
              AND RIGHT(regexp_replace(ar.parent_mobile, '[^0-9]', '', 'g'), 10) IN (:phones)
              AND (ar.audience_status IS NULL OR ar.audience_status <> 'INACTIVE')
            """;

    private static final String EMAILS_SQL = """
            SELECT DISTINCT LOWER(TRIM(ar.parent_email)) AS email
            FROM audience_response ar
            JOIN audience a ON a.id = ar.audience_id
            WHERE a.institute_id = :instituteId
              AND ar.parent_email IS NOT NULL
              AND LOWER(TRIM(ar.parent_email)) IN (:emails)
              AND (ar.audience_status IS NULL OR ar.audience_status <> 'INACTIVE')
            """;

    private final NamedParameterJdbcTemplate jdbc;

    /** Which of these last-10-digit phones already belong to a live lead of the institute. */
    public Set<String> existingPhones(String instituteId, Collection<String> last10Phones) {
        if (last10Phones == null || last10Phones.isEmpty()) return Set.of();
        List<String> found = jdbc.queryForList(PHONES_SQL, new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("phones", List.copyOf(last10Phones)), String.class);
        return new LinkedHashSet<>(found);
    }

    /** Which of these lower-cased emails already belong to a live lead of the institute. */
    public Set<String> existingEmails(String instituteId, Collection<String> lowerEmails) {
        if (lowerEmails == null || lowerEmails.isEmpty()) return Set.of();
        List<String> found = jdbc.queryForList(EMAILS_SQL, new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("emails", List.copyOf(lowerEmails)), String.class);
        Set<String> out = new LinkedHashSet<>();
        for (String e : found) {
            if (e != null) out.add(e.toLowerCase(Locale.ROOT));
        }
        return out;
    }

    /** The lead an earlier intake already created for this external id (lead_candidate id), if any. */
    public Optional<String> findIntakeResponseId(String instituteId, String externalId) {
        List<String> ids = jdbc.queryForList(
                "SELECT response_id FROM lead_agent_intake WHERE institute_id = :i AND external_id = :e",
                new MapSqlParameterSource().addValue("i", instituteId).addValue("e", externalId), String.class);
        return ids.isEmpty() ? Optional.empty() : Optional.ofNullable(ids.get(0));
    }

    /**
     * Records that this external id produced this lead. Must run in the transaction that created
     * the lead, so the record and the lead commit (or roll back) together.
     */
    public void recordIntake(String instituteId, String externalId, String audienceId, String responseId) {
        jdbc.update("INSERT INTO lead_agent_intake (institute_id, external_id, audience_id, response_id) "
                        + "VALUES (:i, :e, :a, :r) ON CONFLICT (institute_id, external_id) DO NOTHING",
                new MapSqlParameterSource().addValue("i", instituteId).addValue("e", externalId)
                        .addValue("a", audienceId).addValue("r", responseId));
    }

    /** Holds a transaction-scoped advisory lock on {@code key} until the surrounding transaction ends. */
    public void lock(String key) {
        jdbc.queryForObject("SELECT 1 FROM pg_advisory_xact_lock(hashtext(:k))",
                new MapSqlParameterSource("k", key), Integer.class);
    }

    // ── normalisation shared with the intake service ─────────────────────

    /** Last 10 digits of a phone, or null when it has fewer than 7 digits (not a usable number). */
    public static String last10(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        if (digits.length() < 7) return null;
        return digits.length() > 10 ? digits.substring(digits.length() - 10) : digits;
    }

    /** Trimmed, lower-cased email, or null when it is not an address. */
    public static String normEmail(String email) {
        if (email == null) return null;
        String e = email.trim().toLowerCase(Locale.ROOT);
        return e.length() >= 3 && e.contains("@") ? e : null;
    }
}
