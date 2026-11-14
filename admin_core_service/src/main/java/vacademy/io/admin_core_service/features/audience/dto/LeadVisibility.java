package vacademy.io.admin_core_service.features.audience.dto;

import java.util.List;

/**
 * Which leads a caller may see in an institute — the visibility half of the
 * CRM Leads list ({@code AudienceService.getLeads}), resolved once by
 * {@code LeadVisibilityResolver} so the Recent Leads / Lead Board query and the
 * {@code /v1/audience/lead-scope} endpoint can never disagree.
 *
 * <p>A lead is visible when ALL of these hold:
 * <ul>
 *   <li>its list is in {@link #allowedAudienceIds} (null = every list of the
 *       institute; empty = no list at all, the caller sees nothing);</li>
 *   <li>{@link #ownerIds()} is null, OR the lead's linked counsellor
 *       ({@code linked_users}) or its profile counsellor
 *       ({@code user_lead_profile.assigned_counselor_id}) is one of them, OR
 *       {@link #includeUnassigned} is set and the lead has no counsellor on either.</li>
 * </ul>
 *
 * <p>The owner restriction comes in two shapes because the leads query binds
 * them to two different parameters:
 * <ul>
 *   <li>{@link #scopeOwnerIds} — the sub-org members or the counsellor
 *       hierarchy, bound to {@code assignedCounselorIdsCsv} (the predicate that
 *       also carries the unassigned pool);</li>
 *   <li>{@link #forcedOwnerId} — the caller themselves, which REPLACES the
 *       request's {@code assignedCounselorId} (COUNSELOR mode, and AUDIENCE_LIST
 *       with "only assigned leads", when no hierarchy scope applies). The
 *       unassigned pool is always off in those cases.</li>
 * </ul>
 *
 * @param mode               the label for how the scope was decided
 * @param scopeOwnerIds      sub-org members / counsellor hierarchy, or null
 * @param forcedOwnerId      the caller's own id when they are limited to their own leads, or null
 * @param includeUnassigned  whether leads with no counsellor stay visible alongside the owners
 * @param allowedAudienceIds the lists the caller may read; null = all lists
 * @param subOrgIds          the sub-orgs a SUB_ORG caller administers (filled only when asked for)
 * @param admin              true only for a whole-institute ADMIN (a sub-org admin is not)
 */
public record LeadVisibility(
        Mode mode,
        List<String> scopeOwnerIds,
        String forcedOwnerId,
        boolean includeUnassigned,
        List<String> allowedAudienceIds,
        List<String> subOrgIds,
        boolean admin) {

    /**
     * How the scope was decided, most specific first. When several apply the
     * earlier one names it (an AUDIENCE_LIST counsellor who also has a team is
     * AUDIENCE_LIST — the list restriction must not be lost by a consumer that
     * only reads the label); the other fields always carry the full restriction.
     */
    public enum Mode {
        /** Administers a sub-org: only leads owned by the sub-org's members, no unassigned pool. */
        SUB_ORG,
        /** Restricted to granted lists (and maybe to their own / their team's leads inside them). */
        AUDIENCE_LIST,
        /** COUNSELLOR role without ADMIN: themselves + counsellors reporting up to them. */
        COUNSELLOR_TREE,
        /** COUNSELOR access mode with no hierarchy: only leads they are the counsellor of. */
        COUNSELOR_SELF,
        /** Institute ADMIN: every lead of the institute. */
        ADMIN,
        /** No restriction configured for the caller's roles: every lead of the institute. */
        DEFAULT
    }

    /**
     * The owner restriction as one set: {@link #scopeOwnerIds} when present,
     * else the caller alone when {@link #forcedOwnerId} is set, else null
     * (no owner restriction).
     */
    public List<String> ownerIds() {
        if (scopeOwnerIds != null) return scopeOwnerIds;
        if (forcedOwnerId != null) return List.of(forcedOwnerId);
        return null;
    }

    /** {@link #scopeOwnerIds} as the CSV the native leads queries take, or null. */
    public String scopeOwnerIdsCsv() {
        return scopeOwnerIds == null ? null : String.join(",", scopeOwnerIds);
    }
}
