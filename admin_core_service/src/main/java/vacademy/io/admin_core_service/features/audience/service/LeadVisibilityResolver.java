package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.LeadVisibility;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService.EffectiveAccess;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService.Mode;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgLeadScopeService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.List;

/**
 * Resolves which leads a caller may see in an institute — the visibility rules
 * of the CRM Leads list ({@link AudienceService#getLeads}), shared with the
 * {@code GET /v1/audience/lead-scope} endpoint so both always answer the same.
 *
 * <p>Three independent sources, applied in this order:
 * <ol>
 *   <li><b>Sub-org admin</b> (highest precedence) — detected by ACTIVE SUB_ORG
 *       FSPSSM linkage ({@link SubOrgLeadScopeService}). A sub-org admin also
 *       holds the parent institute's ADMIN role, so by role alone they would see
 *       the whole parent lead pool; instead they see the leads owned by the
 *       members of the sub-org(s) they administer, without the unassigned pool.</li>
 *   <li><b>Counsellor hierarchy</b> — a COUNSELLOR-role caller WITHOUT ADMIN
 *       ({@link CounsellorScopeService#isScopedCaller(String, CustomUserDetails)})
 *       sees themselves + every counsellor reporting up to them. ADMIN outranks
 *       COUNSELLOR: a dual-role caller stays institute-wide.</li>
 *   <li><b>Audience role access</b> ({@link AudienceRoleAccessService}) — the
 *       institute's per-role setting: COUNSELOR mode limits a caller with no
 *       hierarchy scope to their own leads; AUDIENCE_LIST bounds the readable
 *       lists and, with "only assigned leads", the rows inside them.</li>
 * </ol>
 *
 * <p>The sub-org and hierarchy checks need a non-blank institute id; with none,
 * only the role-access setting applies (and it resolves to DEFAULT).
 */
@Service
@RequiredArgsConstructor
public class LeadVisibilityResolver {

    private final AudienceRoleAccessService audienceRoleAccessService;
    private final SubOrgLeadScopeService subOrgLeadScopeService;
    private final CounsellorScopeService counsellorScopeService;

    /**
     * The caller's lead visibility in {@code instituteId}. {@code subOrgIds} is
     * left empty — the leads query doesn't need it; use
     * {@link #resolveWithSubOrgIds} when the sub-orgs themselves are reported.
     */
    public LeadVisibility resolve(CustomUserDetails user, String instituteId) {
        return resolve(user, instituteId, false);
    }

    /** {@link #resolve}, plus the sub-org ids a SUB_ORG caller administers. */
    public LeadVisibility resolveWithSubOrgIds(CustomUserDetails user, String instituteId) {
        return resolve(user, instituteId, true);
    }

    private LeadVisibility resolve(CustomUserDetails user, String instituteId, boolean withSubOrgIds) {
        // Caller-level access scoping driven by the institute's
        // AUDIENCE_ROLE_ACCESS setting. Admin resolves to DEFAULT;
        // pure counselors are auto-scoped; AUDIENCE_LIST roles are restricted
        // to their granted audience ids.
        EffectiveAccess access = audienceRoleAccessService.resolveForCaller(user, instituteId);

        boolean hasCaller = user != null && user.getUserId() != null;
        boolean hasInstitute = instituteId != null && !instituteId.isBlank();

        // The sub-org members or the counsellor hierarchy (bound to the leads
        // query's assignedCounselorIdsCsv), or null when neither applies.
        List<String> scopeOwnerIds = null;

        // Sub-org admin scoping (highest precedence). The member set always
        // includes the admin themselves, so a non-empty result also means "is a
        // sub-org admin"; an empty result means a normal admin/user and this
        // branch is a no-op.
        boolean subOrgScopeApplied = false;
        if (hasCaller && hasInstitute) {
            List<String> subOrgScope = subOrgLeadScopeService
                    .subOrgScopedCounsellorUserIds(user.getUserId());
            if (!subOrgScope.isEmpty()) {
                scopeOwnerIds = subOrgScope;
                subOrgScopeApplied = true;
            }
        }

        // Counsellor-hierarchy RBAC: a COUNSELLOR-role non-admin sees themselves
        // + every counsellor-role user reporting up to them through
        // parent_user_id chains in any org team they belong to. isScopedCaller
        // reads the caller's authenticated authorities (not a raw JWT decode),
        // so it can't miss ADMIN for a dual-role account.
        boolean treeScopeApplied = false;
        if (!subOrgScopeApplied && hasCaller && hasInstitute
                && counsellorScopeService.isScopedCaller(instituteId, user)) {
            List<String> scope = counsellorScopeService
                    .scopedCounsellorUserIds(instituteId, user.getUserId());
            if (!scope.isEmpty()) {
                scopeOwnerIds = scope;
                treeScopeApplied = true;
            }
        }
        boolean rbacApplied = subOrgScopeApplied || treeScopeApplied;

        // COUNSELOR mode with no hierarchy scope: only leads the caller is
        // directly linked to (replaces any assignedCounselorId the request sent).
        // When RBAC applied above, the broader subtree wins — a manager should
        // see their reports' leads, not just their own.
        String forcedOwnerId = null;
        boolean counselorSelf = access.getMode() == Mode.COUNSELOR && hasCaller && !rbacApplied;
        if (counselorSelf) {
            forcedOwnerId = user.getUserId();
        }

        // AUDIENCE_LIST + "only my assigned leads": the granted lists bound WHICH
        // campaigns are readable; this narrows the rows inside them to the
        // caller's own leads. access.isAssignedOnly() is already pool-gated by
        // AudienceRoleAccessService. A hierarchy-scoped caller keeps their
        // subtree (RBAC already did this half); only callers RBAC didn't touch
        // are force-scoped to themselves.
        boolean assignedOnlyApplied = access.getMode() == Mode.AUDIENCE_LIST
                && access.isAssignedOnly()
                && hasCaller;
        if (assignedOnlyApplied && !rbacApplied) {
            forcedOwnerId = user.getUserId();
        }

        // The shared unassigned pool (no counsellor on either linked_users or
        // user_lead_profile). COUNSELOR mode and "only my assigned leads" drop
        // it — an unassigned lead is by definition not "assigned to me", and
        // this half applies even to RBAC-scoped callers. A sub-org admin never
        // sees it: the pool belongs to the parent institute.
        boolean includeUnassigned = access.getMode() != Mode.COUNSELOR && !subOrgScopeApplied
                && !assignedOnlyApplied;

        // AUDIENCE_LIST: the granted lists. Empty means the admin granted none
        // — the caller sees nothing (intentional lock-out).
        List<String> allowedAudienceIds = null;
        if (access.getMode() == Mode.AUDIENCE_LIST) {
            List<String> allowed = access.getAllowedAudienceIds();
            allowedAudienceIds = allowed == null ? List.of() : List.copyOf(allowed);
        }

        boolean admin = !subOrgScopeApplied && hasInstitute
                && audienceRoleAccessService.resolvedCallerRoles(user, instituteId).contains("ADMIN");

        LeadVisibility.Mode mode;
        if (subOrgScopeApplied) {
            mode = LeadVisibility.Mode.SUB_ORG;
        } else if (access.getMode() == Mode.AUDIENCE_LIST) {
            mode = LeadVisibility.Mode.AUDIENCE_LIST;
        } else if (treeScopeApplied) {
            mode = LeadVisibility.Mode.COUNSELLOR_TREE;
        } else if (counselorSelf) {
            mode = LeadVisibility.Mode.COUNSELOR_SELF;
        } else if (admin) {
            mode = LeadVisibility.Mode.ADMIN;
        } else {
            mode = LeadVisibility.Mode.DEFAULT;
        }

        List<String> subOrgIds = subOrgScopeApplied && withSubOrgIds
                ? new ArrayList<>(subOrgLeadScopeService.callerSubOrgIds(user.getUserId()))
                : List.of();

        return new LeadVisibility(mode, scopeOwnerIds, forcedOwnerId, includeUnassigned,
                allowedAudienceIds, subOrgIds, admin && mode == LeadVisibility.Mode.ADMIN);
    }
}
