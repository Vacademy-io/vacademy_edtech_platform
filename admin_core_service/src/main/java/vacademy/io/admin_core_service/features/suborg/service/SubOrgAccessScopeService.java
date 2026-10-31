package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.entity.InstituteSubOrg;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Resolves <b>which</b> sub-orgs (channel partners) a caller is allowed to see.
 *
 * <p>Two kinds of caller reach the sub-org surfaces:
 * <ul>
 *   <li><b>Unrestricted</b> — the platform root user and a true parent-institute
 *       ADMIN. They see every sub-org under the institute.</li>
 *   <li><b>Assignment-scoped</b> — everyone else. They see only the sub-orgs assigned
 *       to them, never the institute's full network.</li>
 * </ul>
 *
 * <p>An assignment can come from either of two places, and they UNION:
 * <ol>
 *   <li><b>Per-user</b> — an ACTIVE {@code SUB_ORG}-linked
 *       {@code FacultySubjectPackageSessionMapping} row, created by adding the person to
 *       a sub-org's team. This is also how sub-org admins are wired up.</li>
 *   <li><b>Per-role</b> — {@code ROLE_DISPLAY_SETTINGS.<roleId>.subOrganizations
 *       .assignedSubOrgIds}, set from Settings → Display Settings. Covers a whole team
 *       (e.g. a regional sales role) in one place, including people added to the role
 *       later, instead of wiring each member by hand.</li>
 * </ol>
 *
 * <p>Why FSPSSM and not a role check: a sub-org admin is <i>also</i> granted the
 * parent institute's {@code ADMIN} role (see {@code SubOrgTeamService
 * .ensureCallerCanAccessSubOrg}), so by role they are indistinguishable from a
 * true institute admin. The presence of SUB_ORG-linked FSPSSM rows is the only
 * reliable fingerprint — the same signal {@link SubOrgLeadScopeService} uses for
 * lead visibility.
 *
 * <p>It <b>fails closed</b>: a caller who is neither root, nor an institute ADMIN,
 * nor assigned to any sub-org gets an EMPTY scope (no rows), not the full list.
 * The Display Settings toggle only controls whether the module is reachable in the
 * UI; it never widens what the API returns.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgAccessScopeService {

    private static final String ROLE_NAME_ADMIN = "ADMIN";

    /** Institute-setting key the frontend persists role display config under (plural — the
     *  Java enum spells it singular, so the literal is hardcoded to match what is stored). */
    private static final String ROLE_DISPLAY_SETTINGS_KEY = "ROLE_DISPLAY_SETTINGS";
    private static final String SUB_ORG_SECTION = "subOrganizations";
    private static final String ASSIGNED_IDS_FIELD = "assignedSubOrgIds";
    private static final String PERMISSIONS_FIELD = "permissions";

    /** Capability keys mirrored from the frontend SubOrgModulePermissions. Reads default
     *  ON, writes default OFF, so a role granted the module but never configured further
     *  is read-only. */
    public static final String PERM_CREATE = "canCreate";
    public static final String PERM_EDIT_CONFIG = "canEditConfig";
    public static final String PERM_MANAGE_TEAM = "canManageTeam";
    public static final String PERM_VIEW_FINANCE = "canViewFinance";
    public static final String PERM_MANAGE_FINANCE = "canManageFinance";
    public static final String PERM_EXPORT = "canExport";
    private static final Set<String> READ_PERMISSIONS =
            Set.of(PERM_VIEW_FINANCE, PERM_EXPORT);

    private final SubOrgLeadScopeService subOrgLeadScopeService;
    /** Roles live in auth_service's DB — admin_core has no user_role table. */
    private final InstituteRoleUserClient instituteRoleUserClient;
    private final InstituteSubOrgRepository instituteSubOrgRepository;
    private final InstituteSettingService instituteSettingService;

    /**
     * The sub-org ids this caller may see under {@code parentInstituteId}.
     *
     * @return {@code null} when the caller is unrestricted (root / true institute
     *         admin) — callers must treat null as "no filter, return everything".
     *         Otherwise the (possibly EMPTY) list of assigned sub-org ids; an empty
     *         list means the caller sees nothing.
     */
    public List<String> resolveVisibleSubOrgIds(CustomUserDetails user, String parentInstituteId) {
        // No authenticated principal (internal/HMAC callers) — behave exactly as
        // before this scoping existed; the endpoint's own guard decides access.
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            return null;
        }
        if (user.isRootUser()) {
            return null;
        }

        // Precedence matters — see isTrueInstituteAdmin's javadoc for why this exact order.
        List<String> perUser = subOrgLeadScopeService.callerSubOrgIds(user.getUserId());
        if (!perUser.isEmpty()) {
            return unionWithRoleGrants(perUser, user.getUserId(), parentInstituteId);
        }

        if (isTrueInstituteAdmin(user.getUserId(), parentInstituteId)) {
            return null;
        }

        List<String> viaRole = roleAssignedSubOrgIds(user.getUserId(), parentInstituteId);
        return viaRole.isEmpty() ? Collections.emptyList() : viaRole;
    }

    /**
     * Why the order is per-user assignment → ADMIN role → role grant, and not something
     * simpler:
     *
     * <ul>
     *   <li><b>Per-user first.</b> A sub-org admin is ALSO granted the parent institute's
     *       ADMIN role, so checking ADMIN first would hand them the whole network. Their
     *       SUB_ORG-linked FSPSSM rows are the only thing that distinguishes them.</li>
     *   <li><b>ADMIN before role grants.</b> A real institute admin must never be scoped
     *       DOWN by a role that happens to list a few partners — that would quietly shrink
     *       an admin's view (and could lock them out of partners they own) the moment
     *       someone configured the ADMIN role's card. Admins keep full visibility.</li>
     *   <li><b>Role grant last.</b> It is a way to GRANT access to non-admins, never a way
     *       to restrict anyone who already had more.</li>
     * </ul>
     */
    private boolean isTrueInstituteAdmin(String userId, String parentInstituteId) {
        if (!StringUtils.hasText(parentInstituteId)) {
            return false;
        }
        // A failed lookup is "not admin" — falls through to the role-grant scope, never widens.
        Optional<Set<String>> roles = instituteRoleUserClient.findRolesOfUser(parentInstituteId, userId);
        return roles.isPresent() && roles.get().contains(ROLE_NAME_ADMIN);
    }

    private List<String> unionWithRoleGrants(List<String> base, String userId, String instituteId) {
        LinkedHashSet<String> ids = new LinkedHashSet<>(base);
        ids.addAll(roleAssignedSubOrgIds(userId, instituteId));
        return new ArrayList<>(ids);
    }

    /**
     * Sub-orgs granted to this caller by any ACTIVE role they hold in the institute.
     *
     * <p>Role display settings are keyed by role UUID while the JWT only carries role names,
     * so the caller's role ids are resolved from auth_service first. Fails closed on any
     * error — a malformed settings blob must never widen visibility.
     */
    @SuppressWarnings("unchecked")
    private List<String> roleAssignedSubOrgIds(String userId, String parentInstituteId) {
        if (!StringUtils.hasText(parentInstituteId)) {
            return Collections.emptyList();
        }
        try {
            Set<String> roleIds = instituteRoleUserClient
                    .findRoleIdsOfUser(parentInstituteId, userId).orElse(Set.of());
            if (roleIds.isEmpty()) {
                return Collections.emptyList();
            }
            Object data = instituteSettingService
                    .getSettingByInstituteIdAndKey(parentInstituteId, ROLE_DISPLAY_SETTINGS_KEY);
            if (!(data instanceof Map)) {
                return Collections.emptyList();
            }
            Map<String, Object> byRole = (Map<String, Object>) data;
            LinkedHashSet<String> out = new LinkedHashSet<>();
            for (String roleId : roleIds) {
                if (roleId == null) continue;
                Object roleCfg = byRole.get(roleId);
                if (!(roleCfg instanceof Map)) continue;
                Object section = ((Map<String, Object>) roleCfg).get(SUB_ORG_SECTION);
                if (!(section instanceof Map)) continue;
                Object list = ((Map<String, Object>) section).get(ASSIGNED_IDS_FIELD);
                if (!(list instanceof List)) continue;
                for (Object o : (List<Object>) list) {
                    if (o != null && StringUtils.hasText(String.valueOf(o))) {
                        out.add(String.valueOf(o));
                    }
                }
            }
            return new ArrayList<>(out);
        } catch (Exception e) {
            log.warn("roleAssignedSubOrgIds({}, {}) failed, treating as no role grant: {}",
                    userId, parentInstituteId, e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Guard for the Sub-Organizations module's own per-sub-org endpoints (finance
     * detail, seat usage, scoped invites, subscription status, the config PATCHes).
     * An assignment-scoped caller may only touch a sub-org assigned to them; a
     * caller with no assignments must be a true ADMIN of the sub-org's parent
     * institute. So an unassigned channel partner is unreachable through the API
     * even with a hand-crafted request.
     *
     * <p>Use {@link #assertNotCrossSubOrg} instead on endpoints outside this module
     * that non-admin staff legitimately hit today — this one denies them.
     *
     * @param parentInstituteId may be null — resolved from the sub-org linkage when absent.
     */
    public void assertCanAccessSubOrg(CustomUserDetails user, String subOrgId, String parentInstituteId) {
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "subOrgId is required");
        }
        if (user == null || !StringUtils.hasText(user.getUserId()) || user.isRootUser()) {
            return;
        }

        String instituteId = StringUtils.hasText(parentInstituteId)
                ? parentInstituteId
                : resolveParentInstituteId(subOrgId);

        // Same precedence as resolveVisibleSubOrgIds — keep the two in step or a caller
        // could be listed a sub-org they are then refused when opening it.
        List<String> perUser = subOrgLeadScopeService.callerSubOrgIds(user.getUserId());
        if (!perUser.isEmpty()) {
            requireAssigned(unionWithRoleGrants(perUser, user.getUserId(), instituteId), subOrgId);
            return;
        }

        if (!StringUtils.hasText(instituteId)) {
            // Orphaned sub-org (no institute_suborg linkage row) — there is no institute
            // to check the ADMIN role against, so there is no decision to make here.
            // Fall through rather than deny, preserving pre-scoping behaviour for what
            // is a data anomaly, not a permission question.
            return;
        }
        if (isTrueInstituteAdmin(user.getUserId(), instituteId)) {
            return;
        }
        requireAssigned(roleAssignedSubOrgIds(user.getUserId(), instituteId), subOrgId);
    }

    /**
     * Lenient guard for sub-org-keyed endpoints OUTSIDE the Sub-Organizations module
     * — e.g. the learner side-view's Sub-Org tab, which plain teachers/staff have
     * always been able to open.
     *
     * <p>It restricts only callers who ARE assignment-scoped: they must not read
     * across into a channel partner that isn't theirs. Callers with no sub-org
     * assignments keep the access they had before scoping existed, so this can
     * never revoke an existing non-admin flow.
     */
    public void assertNotCrossSubOrg(CustomUserDetails user, String subOrgId) {
        if (user == null || !StringUtils.hasText(user.getUserId())
                || user.isRootUser() || !StringUtils.hasText(subOrgId)) {
            return;
        }
        List<String> assigned = subOrgLeadScopeService.callerSubOrgIds(user.getUserId());
        if (assigned.isEmpty()) {
            return;
        }
        requireAssigned(assigned, subOrgId);
    }

    /**
     * Guard for a capability inside the Sub-Organizations module (edit config, manage
     * team, manage finances…). Refuses the call server-side so the Display Settings
     * toggles are real authorization rather than a hidden button.
     *
     * <p>Constrains ONLY role-granted callers. Deliberately passes:
     * <ul>
     *   <li>root and true institute ADMINs — unrestricted by design;</li>
     *   <li><b>sub-org admins</b> (any caller with SUB_ORG-linked FSPSSM rows) — they
     *       already have their own permission model (FSPSSM {@code access_permission},
     *       ALLOWED_TEAM_ROLES). Layering this on top would revoke capabilities that
     *       work today, so this can never take access away from anyone who had it
     *       before role grants existed.</li>
     * </ul>
     */
    public void assertRolePermission(CustomUserDetails user, String instituteId, String permissionKey) {
        if (user == null || !StringUtils.hasText(user.getUserId()) || user.isRootUser()) {
            return;
        }
        if (!subOrgLeadScopeService.callerSubOrgIds(user.getUserId()).isEmpty()) {
            return;
        }
        if (isTrueInstituteAdmin(user.getUserId(), instituteId)) {
            return;
        }
        if (!hasRolePermission(user.getUserId(), instituteId, permissionKey)) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Access denied: your role is not permitted to perform this action");
        }
    }

    /** Resolve one capability flag across every ACTIVE role the caller holds (any grant wins). */
    @SuppressWarnings("unchecked")
    private boolean hasRolePermission(String userId, String instituteId, String permissionKey) {
        boolean defaultValue = READ_PERMISSIONS.contains(permissionKey);
        if (!StringUtils.hasText(instituteId)) {
            return defaultValue;
        }
        try {
            Set<String> roleIds = instituteRoleUserClient
                    .findRoleIdsOfUser(instituteId, userId).orElse(Set.of());
            if (roleIds.isEmpty()) return defaultValue;
            Object data = instituteSettingService
                    .getSettingByInstituteIdAndKey(instituteId, ROLE_DISPLAY_SETTINGS_KEY);
            if (!(data instanceof Map)) return defaultValue;
            Map<String, Object> byRole = (Map<String, Object>) data;
            boolean sawExplicit = false;
            for (String roleId : roleIds) {
                if (roleId == null) continue;
                Object roleCfg = byRole.get(roleId);
                if (!(roleCfg instanceof Map)) continue;
                Object section = ((Map<String, Object>) roleCfg).get(SUB_ORG_SECTION);
                if (!(section instanceof Map)) continue;
                Object perms = ((Map<String, Object>) section).get(PERMISSIONS_FIELD);
                if (!(perms instanceof Map)) continue;
                Object v = ((Map<String, Object>) perms).get(permissionKey);
                if (v instanceof Boolean b) {
                    if (Boolean.TRUE.equals(b)) return true;   // any role granting it wins
                    sawExplicit = true;
                }
            }
            return sawExplicit ? false : defaultValue;
        } catch (Exception e) {
            log.warn("hasRolePermission({}, {}, {}) failed, falling back to default: {}",
                    userId, instituteId, permissionKey, e.getMessage());
            return defaultValue;
        }
    }

    private void requireAssigned(List<String> assigned, String subOrgId) {
        if (!assigned.contains(subOrgId)) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Access denied: this sub-organization is not assigned to you");
        }
    }

    /** Parent institute of a sub-org, via the institute_suborg linkage. Null when unlinked. */
    private String resolveParentInstituteId(String subOrgId) {
        try {
            List<InstituteSubOrg> links = instituteSubOrgRepository.findBySuborgId(subOrgId);
            for (InstituteSubOrg link : links) {
                if (link != null && StringUtils.hasText(link.getInstituteId())) {
                    return link.getInstituteId();
                }
            }
        } catch (Exception e) {
            log.warn("resolveParentInstituteId({}) failed: {}", subOrgId, e.getMessage());
        }
        return null;
    }
}
