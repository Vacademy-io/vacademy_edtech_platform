package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response of {@code GET /admin-core-service/v1/audience/lead-scope}: the
 * caller's lead visibility in an institute, the same scope the CRM Leads list
 * applies (see {@link LeadVisibility}).
 *
 * <p>A lead is visible when its list is in {@code allowed_audience_ids} (null =
 * every list; empty = none) AND either {@code owner_ids} is null (no owner
 * restriction), or the lead's linked counsellor or profile counsellor is in
 * {@code owner_ids}, or {@code include_unassigned} is true and the lead has no
 * counsellor on either.
 *
 * <p>Nulls are serialised on purpose — {@code owner_ids: null} and
 * {@code allowed_audience_ids: null} mean "no restriction".
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.ALWAYS)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadScopeDTO {

    /** SUB_ORG | AUDIENCE_LIST | COUNSELLOR_TREE | COUNSELOR_SELF | ADMIN | DEFAULT. */
    private String mode;

    /** Counsellor user ids whose leads are visible; null = no owner restriction. */
    private List<String> ownerIds;

    /** Whether leads with no counsellor are visible alongside {@link #ownerIds}. */
    private boolean includeUnassigned;

    /** Lists the caller may read; null = every list of the institute, empty = none. */
    private List<String> allowedAudienceIds;

    /** Sub-orgs the caller administers (SUB_ORG mode); empty otherwise. */
    private List<String> subOrgIds;

    /**
     * True only for a whole-institute ADMIN (a sub-org admin is not). Named
     * {@code admin} with an explicit JSON name: a Lombok {@code isAdmin} field
     * would serialise as {@code admin}.
     */
    @JsonProperty("is_admin")
    private boolean admin;

    public static LeadScopeDTO from(LeadVisibility visibility) {
        return LeadScopeDTO.builder()
                .mode(visibility.mode().name())
                .ownerIds(visibility.ownerIds())
                .includeUnassigned(visibility.includeUnassigned())
                .allowedAudienceIds(visibility.allowedAudienceIds())
                .subOrgIds(visibility.subOrgIds())
                .admin(visibility.admin())
                .build();
    }
}
