package vacademy.io.admin_core_service.features.utm_attribution.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * Campaign-attribution filter for the admin list surfaces (Recent Leads, Lead
 * List, Lead Board, All Contacts, Students, course learners).
 *
 * Sent as {@code utm_filters: {sources, mediums, campaigns, contents, terms,
 * source_types, untagged_only}} alongside the surface's other filters. Values
 * within one dimension OR together (source = facebook OR instagram); the
 * dimensions AND together (source in {...} AND campaign in {...}), matching how
 * the custom-field filters on the same pages already behave.
 *
 * A row matches when the person behind it — the lead, the learner, the contact
 * — has at least one recorded {@code utm_attribution} touch satisfying every
 * dimension. The match is on identity (user id, or the email / mobile the form
 * captured) rather than on the row itself, because three of the six capture
 * surfaces never learn a user id at submit time.
 *
 * {@code untagged_only} is the inverse: keep only people with NO recorded touch
 * at all. It is the "organic vs. campaign" question, and it cannot be expressed
 * as a positive value list, so it is its own flag. When set it wins over the
 * value lists (there is nothing for them to match).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UtmListFilterDTO {

    private List<String> sources;
    private List<String> mediums;
    private List<String> campaigns;
    private List<String> contents;
    private List<String> terms;
    /** AUDIENCE | LIVE_SESSION | ASSESSMENT | ENROLL_INVITE | PRODUCT_PAGE | CATALOGUE */
    private List<String> sourceTypes;
    private Boolean untaggedOnly;

    /** True when any dimension carries a value or the untagged flag is set. */
    public boolean hasAny() {
        return Boolean.TRUE.equals(untaggedOnly)
                || hasValues(sources) || hasValues(mediums) || hasValues(campaigns)
                || hasValues(contents) || hasValues(terms) || hasValues(sourceTypes);
    }

    /** True when at least one positive value list is non-empty. */
    public boolean hasPositiveValues() {
        return hasValues(sources) || hasValues(mediums) || hasValues(campaigns)
                || hasValues(contents) || hasValues(terms) || hasValues(sourceTypes);
    }

    private static boolean hasValues(List<String> values) {
        return values != null && values.stream().anyMatch(v -> v != null && !v.isBlank());
    }

    /**
     * Lower-cased, trimmed, de-duplicated copy of a value list, or null when
     * empty. UTM values are compared case-insensitively — the link builder
     * lower-cases what it emits, but links pasted from elsewhere carry whatever
     * case the marketer typed, and "Facebook" and "facebook" are one source.
     */
    public static List<String> normalise(List<String> values) {
        if (values == null) return null;
        List<String> out = values.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(v -> !v.isEmpty())
                .map(v -> v.toLowerCase(Locale.ROOT))
                .distinct()
                .toList();
        return out.isEmpty() ? null : out;
    }

    /** Source types are stored upper-case; normalise the other way. */
    public static List<String> normaliseUpper(List<String> values) {
        if (values == null) return null;
        List<String> out = values.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(v -> !v.isEmpty())
                .map(v -> v.toUpperCase(Locale.ROOT))
                .distinct()
                .toList();
        return out.isEmpty() ? null : out;
    }
}
