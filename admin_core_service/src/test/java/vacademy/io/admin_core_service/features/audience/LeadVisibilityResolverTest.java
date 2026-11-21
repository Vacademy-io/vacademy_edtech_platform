package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadScopeDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadVisibility;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService.EffectiveAccess;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService.Mode;
import vacademy.io.admin_core_service.features.audience.service.LeadVisibilityResolver;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgLeadScopeService;
import vacademy.io.common.auth.model.CustomUserDetails;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who sees which leads.
 *
 * <p>The resolver is the visibility half of the CRM Leads list (Recent Leads /
 * Lead Board) and of the lead-scope endpoint, so a wrong answer either hides a
 * counsellor's leads or shows them leads they must not see. Each caller shape
 * is pinned on its own, and {@link #matchesTheInlineGetLeadsRulesForEveryInput}
 * replays the rules {@code AudienceService.getLeads} used to run inline over
 * every combination of inputs, so the extraction cannot drift.
 */
class LeadVisibilityResolverTest {

    private static final String INSTITUTE = "inst-1";
    private static final String ME = "user-me";

    private AudienceRoleAccessService roleAccess;
    private SubOrgLeadScopeService subOrg;
    private CounsellorScopeService counsellorScope;
    private LeadVisibilityResolver resolver;

    @BeforeEach
    void setUp() {
        roleAccess = mock(AudienceRoleAccessService.class);
        subOrg = mock(SubOrgLeadScopeService.class);
        counsellorScope = mock(CounsellorScopeService.class);
        resolver = new LeadVisibilityResolver(roleAccess, subOrg, counsellorScope);
    }

    private static CustomUserDetails caller(String userId) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(userId);
        return user;
    }

    /** Stubs one caller shape; every collaborator answers for any user / institute. */
    private void given(EffectiveAccess access, List<String> subOrgMembers, boolean scopedCaller,
                       List<String> tree, Set<String> roles) {
        when(roleAccess.resolveForCaller(any(), any())).thenReturn(access);
        when(roleAccess.resolvedCallerRoles(any(), any())).thenReturn(roles);
        when(subOrg.subOrgScopedCounsellorUserIds(anyString())).thenReturn(subOrgMembers);
        when(subOrg.callerSubOrgIds(anyString())).thenReturn(List.of("sub-org-1"));
        when(counsellorScope.isScopedCaller(anyString(), any(CustomUserDetails.class))).thenReturn(scopedCaller);
        when(counsellorScope.scopedCounsellorUserIds(anyString(), anyString())).thenReturn(tree);
    }

    private static EffectiveAccess list(boolean assignedOnly, String... ids) {
        return new EffectiveAccess(Mode.AUDIENCE_LIST, new ArrayList<>(Arrays.asList(ids)), assignedOnly);
    }

    @Test
    void institute_admin_sees_every_lead() {
        given(EffectiveAccess.defaultMode(), List.of(), false, List.of(), Set.of("ADMIN"));

        LeadVisibility v = resolver.resolveWithSubOrgIds(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.ADMIN, v.mode());
        assertNull(v.ownerIds());
        assertNull(v.scopeOwnerIdsCsv());
        assertNull(v.forcedOwnerId());
        assertTrue(v.includeUnassigned());
        assertNull(v.allowedAudienceIds());
        assertEquals(List.of(), v.subOrgIds());
        assertTrue(v.admin());
    }

    /** A sub-org admin also holds ADMIN, but only sees their sub-org's members' leads. */
    @Test
    void sub_org_admin_is_limited_to_members_and_loses_the_unassigned_pool() {
        given(EffectiveAccess.defaultMode(), List.of(ME, "member-2"), false, List.of(), Set.of("ADMIN"));

        LeadVisibility v = resolver.resolveWithSubOrgIds(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.SUB_ORG, v.mode());
        assertEquals(List.of(ME, "member-2"), v.ownerIds());
        assertEquals(ME + ",member-2", v.scopeOwnerIdsCsv());
        assertNull(v.forcedOwnerId());
        assertFalse(v.includeUnassigned());
        assertNull(v.allowedAudienceIds());
        assertEquals(List.of("sub-org-1"), v.subOrgIds());
        assertFalse(v.admin());
        // The hierarchy is never consulted once the sub-org scope applies.
        verify(counsellorScope, never()).isScopedCaller(anyString(), any(CustomUserDetails.class));
    }

    @Test
    void the_leads_query_path_skips_the_sub_org_id_lookup() {
        given(EffectiveAccess.defaultMode(), List.of(ME), false, List.of(), Set.of("ADMIN"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.SUB_ORG, v.mode());
        assertEquals(List.of(), v.subOrgIds());
        verify(subOrg, never()).callerSubOrgIds(anyString());
    }

    @Test
    void counsellor_sees_their_tree_and_the_unassigned_pool() {
        given(EffectiveAccess.defaultMode(), List.of(), true, List.of(ME, "report-1"), Set.of("COUNSELLOR"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.COUNSELLOR_TREE, v.mode());
        assertEquals(List.of(ME, "report-1"), v.ownerIds());
        assertEquals(ME + ",report-1", v.scopeOwnerIdsCsv());
        assertNull(v.forcedOwnerId());
        assertTrue(v.includeUnassigned());
        assertNull(v.allowedAudienceIds());
        assertFalse(v.admin());
    }

    /** COUNSELOR mode keeps a manager's tree but drops the unassigned pool. */
    @Test
    void counselor_mode_with_a_tree_keeps_the_tree_without_the_pool() {
        given(new EffectiveAccess(Mode.COUNSELOR, List.of()), List.of(), true,
                List.of(ME, "report-1"), Set.of("COUNSELLOR"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.COUNSELLOR_TREE, v.mode());
        assertEquals(List.of(ME, "report-1"), v.ownerIds());
        assertNull(v.forcedOwnerId());
        assertFalse(v.includeUnassigned());
    }

    @Test
    void counselor_mode_without_a_tree_sees_only_their_own_leads() {
        given(new EffectiveAccess(Mode.COUNSELOR, List.of()), List.of(), false, List.of(), Set.of("SALES"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.COUNSELOR_SELF, v.mode());
        assertEquals(ME, v.forcedOwnerId());
        assertEquals(List.of(ME), v.ownerIds());
        assertNull(v.scopeOwnerIdsCsv());
        assertFalse(v.includeUnassigned());
        assertNull(v.allowedAudienceIds());
        assertFalse(v.admin());
    }

    @Test
    void audience_list_role_is_bounded_to_its_lists() {
        given(list(false, "aud-1", "aud-2"), List.of(), false, List.of(), Set.of("SALES"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.AUDIENCE_LIST, v.mode());
        assertEquals(List.of("aud-1", "aud-2"), v.allowedAudienceIds());
        assertNull(v.ownerIds());
        assertTrue(v.includeUnassigned());
        assertFalse(v.admin());
    }

    @Test
    void audience_list_assigned_only_narrows_to_own_leads() {
        given(list(true, "aud-1"), List.of(), false, List.of(), Set.of("SALES"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.AUDIENCE_LIST, v.mode());
        assertEquals(ME, v.forcedOwnerId());
        assertEquals(List.of(ME), v.ownerIds());
        assertFalse(v.includeUnassigned());
        assertEquals(List.of("aud-1"), v.allowedAudienceIds());
    }

    /** The list restriction must survive even when the caller also has a team. */
    @Test
    void audience_list_counsellor_with_a_tree_keeps_both_restrictions() {
        given(list(true, "aud-1"), List.of(), true, List.of(ME, "report-1"), Set.of("COUNSELLOR"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.AUDIENCE_LIST, v.mode());
        assertEquals(List.of(ME, "report-1"), v.ownerIds());
        assertNull(v.forcedOwnerId());
        assertFalse(v.includeUnassigned());
        assertEquals(List.of("aud-1"), v.allowedAudienceIds());
    }

    @Test
    void audience_list_with_no_granted_lists_sees_nothing() {
        given(list(false), List.of(), false, List.of(), Set.of("SALES"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.AUDIENCE_LIST, v.mode());
        assertEquals(List.of(), v.allowedAudienceIds());
    }

    @Test
    void unconfigured_non_admin_role_is_default_and_not_admin() {
        given(EffectiveAccess.defaultMode(), List.of(), false, List.of(), Set.of("TEACHER"));

        LeadVisibility v = resolver.resolve(caller(ME), INSTITUTE);

        assertEquals(LeadVisibility.Mode.DEFAULT, v.mode());
        assertNull(v.ownerIds());
        assertTrue(v.includeUnassigned());
        assertNull(v.allowedAudienceIds());
        assertFalse(v.admin());
    }

    @Test
    void lead_scope_json_is_snake_case_with_explicit_nulls() throws Exception {
        given(EffectiveAccess.defaultMode(), List.of(), false, List.of(), Set.of("ADMIN"));

        JsonNode json = new ObjectMapper().valueToTree(
                LeadScopeDTO.from(resolver.resolveWithSubOrgIds(caller(ME), INSTITUTE)));

        assertEquals(Set.of("mode", "owner_ids", "include_unassigned", "allowed_audience_ids",
                "sub_org_ids", "is_admin"), fieldNames(json));
        assertEquals("ADMIN", json.get("mode").asText());
        assertTrue(json.get("owner_ids").isNull());
        assertTrue(json.get("allowed_audience_ids").isNull());
        assertTrue(json.get("include_unassigned").asBoolean());
        assertTrue(json.get("is_admin").asBoolean());
        assertTrue(json.get("sub_org_ids").isArray());
    }

    private static Set<String> fieldNames(JsonNode json) {
        Set<String> names = new java.util.HashSet<>();
        json.fieldNames().forEachRemaining(names::add);
        return names;
    }

    // ── Equivalence with the rules getLeads ran inline before the extraction ──

    /** What getLeads bound to its leads query (or that it returned an empty page). */
    private record QueryScope(String assignedCounselorIdsCsv, String assignedCounselorId,
                              boolean includeUnassigned, String allowedAudienceIdsCsv, boolean emptyPage) {
    }

    /**
     * The visibility block of {@code AudienceService.getLeads} as it stood before
     * {@link LeadVisibilityResolver} existed — kept here verbatim (only the
     * collaborators renamed) as the reference the resolver must reproduce.
     */
    private QueryScope inlineRules(CustomUserDetails user, String instituteId, String requestAssignedId,
                                   String requestAudienceId) {
        String assignedCounselorId = requestAssignedId;
        EffectiveAccess access = roleAccess.resolveForCaller(user, instituteId);
        String assignedCounselorIdsCsv = null;
        boolean rbacApplied = false;
        boolean subOrgScopeApplied = false;
        if (user != null && user.getUserId() != null
                && instituteId != null
                && !instituteId.isBlank()) {
            List<String> subOrgScope = subOrg.subOrgScopedCounsellorUserIds(user.getUserId());
            if (!subOrgScope.isEmpty()) {
                assignedCounselorIdsCsv = String.join(",", subOrgScope);
                rbacApplied = true;
                subOrgScopeApplied = true;
            }
        }
        if (!subOrgScopeApplied && user != null && user.getUserId() != null
                && instituteId != null
                && !instituteId.isBlank()) {
            if (counsellorScope.isScopedCaller(instituteId, user)) {
                List<String> scope = counsellorScope.scopedCounsellorUserIds(instituteId, user.getUserId());
                if (!scope.isEmpty()) {
                    assignedCounselorIdsCsv = String.join(",", scope);
                    rbacApplied = true;
                }
            }
        }
        if (access.getMode() == Mode.COUNSELOR && user != null && user.getUserId() != null
                && !rbacApplied) {
            assignedCounselorId = user.getUserId();
        }
        boolean assignedOnlyApplied = access.getMode() == Mode.AUDIENCE_LIST
                && access.isAssignedOnly()
                && user != null && user.getUserId() != null;
        if (assignedOnlyApplied && !rbacApplied) {
            assignedCounselorId = user.getUserId();
        }
        boolean includeUnassigned = access.getMode() != Mode.COUNSELOR && !subOrgScopeApplied
                && !assignedOnlyApplied;
        String allowedAudienceIdsCsv = null;
        if (access.getMode() == Mode.AUDIENCE_LIST) {
            List<String> allowed = access.getAllowedAudienceIds();
            if (allowed == null || allowed.isEmpty()) {
                return new QueryScope(null, null, false, null, true);
            }
            allowedAudienceIdsCsv = String.join(",", allowed);
            if (requestAudienceId != null && !requestAudienceId.isBlank()
                    && !allowed.contains(requestAudienceId)) {
                return new QueryScope(null, null, false, null, true);
            }
        }
        return new QueryScope(assignedCounselorIdsCsv, assignedCounselorId, includeUnassigned,
                allowedAudienceIdsCsv, false);
    }

    /** How getLeads now turns the resolver's answer into query parameters. */
    private QueryScope viaResolver(CustomUserDetails user, String instituteId, String requestAssignedId,
                                   String requestAudienceId) {
        LeadVisibility visibility = resolver.resolve(user, instituteId);
        String assignedCounselorId = requestAssignedId;
        if (visibility.forcedOwnerId() != null) {
            assignedCounselorId = visibility.forcedOwnerId();
        }
        String allowedAudienceIdsCsv = null;
        List<String> allowed = visibility.allowedAudienceIds();
        if (allowed != null) {
            if (allowed.isEmpty()) {
                return new QueryScope(null, null, false, null, true);
            }
            allowedAudienceIdsCsv = String.join(",", allowed);
            if (requestAudienceId != null && !requestAudienceId.isBlank()
                    && !allowed.contains(requestAudienceId)) {
                return new QueryScope(null, null, false, null, true);
            }
        }
        return new QueryScope(visibility.scopeOwnerIdsCsv(), assignedCounselorId,
                visibility.includeUnassigned(), allowedAudienceIdsCsv, false);
    }

    @Test
    void matchesTheInlineGetLeadsRulesForEveryInput() {
        List<EffectiveAccess> accesses = List.of(
                EffectiveAccess.defaultMode(),
                new EffectiveAccess(Mode.COUNSELOR, List.of()),
                list(false, "aud-1", "aud-2"),
                list(true, "aud-1"),
                list(false),
                new EffectiveAccess(Mode.AUDIENCE_LIST, null, true));
        List<List<String>> subOrgs = List.of(List.of(), List.of(ME, "member-2"));
        List<List<String>> trees = List.of(List.of(), List.of(ME, "report-1"));
        List<CustomUserDetails> users = Arrays.asList(caller(ME), caller(null), null);
        List<String> institutes = Arrays.asList(INSTITUTE, " ", null);
        List<String> requestAssigned = Arrays.asList(null, "someone-else");
        List<String> requestAudience = Arrays.asList(null, "aud-1", "aud-9");

        int cases = 0;
        for (EffectiveAccess access : accesses) {
            for (List<String> subOrgMembers : subOrgs) {
                for (boolean scoped : List.of(false, true)) {
                    for (List<String> tree : trees) {
                        for (CustomUserDetails user : users) {
                            for (String institute : institutes) {
                                for (String assigned : requestAssigned) {
                                    for (String audience : requestAudience) {
                                        reset(roleAccess, subOrg, counsellorScope);
                                        given(access, subOrgMembers, scoped, tree, Collections.emptySet());
                                        String label = access.getMode() + "/assignedOnly=" + access.isAssignedOnly()
                                                + "/lists=" + access.getAllowedAudienceIds()
                                                + " subOrg=" + subOrgMembers + " scoped=" + scoped
                                                + " tree=" + tree + " user=" + (user == null ? null : user.getUserId())
                                                + " inst=" + institute + " assigned=" + assigned
                                                + " audience=" + audience;
                                        assertEquals(inlineRules(user, institute, assigned, audience),
                                                viaResolver(user, institute, assigned, audience), label);
                                        cases++;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        assertEquals(6 * 2 * 2 * 2 * 3 * 3 * 2 * 3, cases);
    }
}
