package vacademy.io.admin_core_service.features.suborg.controller;

import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.admin_core_service.features.institute.entity.InstituteSubOrg;
import vacademy.io.admin_core_service.features.suborg.dto.CreateSubOrgSubscriptionDTO;
import vacademy.io.admin_core_service.features.suborg.dto.CreateSubOrgSubscriptionResponseDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SeatUsageDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgFinanceDetailDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgListItemDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgSubscriptionStatusDTO;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgAccessScopeService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgAdminCredentialService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgFinanceService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgListService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgManagementService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgSubscriptionService;
import vacademy.io.common.institute.dto.InstituteInfoDTO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/admin-core-service/institute/v1/sub-org")
@RequiredArgsConstructor
@Tag(name = "Sub-Organization Controller", description = "Endpoints for managing sub-organizations")
public class SubOrgController {

    private final SubOrgManagementService subOrgService;
    private final SubOrgListService subOrgListService;
    private final SubOrgSubscriptionService subOrgSubscriptionService;
    private final SubOrgFinanceService subOrgFinanceService;
    private final EnrollInviteRepository enrollInviteRepository;
    private final PackageSessionEnrollInviteToPaymentOptionService pslipoService;
    private final InstituteRoleUserClient instituteRoleUserClient;
    private final InstituteRepository instituteRepository;
    private final InstituteSubOrgRepository instituteSubOrgRepository;
    private final SubOrgAccessScopeService subOrgAccessScopeService;
    private final SubOrgAdminCredentialService subOrgAdminCredentialService;

    private static final String ROLE_NAME_ADMIN = "ADMIN";

    @PostMapping("/create")
    public ResponseEntity<String> createSubOrg(
            @RequestBody InstituteInfoDTO instituteInfoDTO,
            @RequestParam String parentInstituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_CREATE);
        return ResponseEntity.ok(subOrgService.createSubOrg(instituteInfoDTO, parentInstituteId));
    }

    /** Raw sub-org linkage rows. Scoped to the caller's assigned channel partners when
     *  their access comes from a SUB_ORG assignment rather than the institute ADMIN role —
     *  the deep page resolves its sub-org from this list, so an unscoped response would let
     *  an assignment-scoped user open any sub-org by URL. */
    @GetMapping("/get-all")
    public ResponseEntity<List<InstituteSubOrg>> getSubOrgs(
            @RequestParam String parentInstituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        List<String> visible = subOrgAccessScopeService
                .resolveVisibleSubOrgIds(user, parentInstituteId);
        if (visible == null) {
            return ResponseEntity.ok(subOrgService.getSubOrgs(parentInstituteId));
        }
        if (visible.isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(
                instituteSubOrgRepository.findByInstituteIdAndSuborgIdIn(parentInstituteId, visible));
    }

    /** Enriched, paginated list for the Manage VLEs table: admin email/phone, plan status,
     *  seats + invite. Newest sub-orgs first. Guarded to the caller's own institute — the
     *  row returns admin PII (email/phone).
     *
     *  Dual response shape for rollout safety: callers that pass NO paging params (older
     *  web bundles and mobile-app builds that predate pagination and expect a bare JSON
     *  array) get the full legacy {@code List}; passing {@code page} and/or {@code size}
     *  opts into the Spring {@code Page} wrapper. Do not collapse this until every shipped
     *  admin bundle sends paging params.
     *
     *  <p>Assignment scoping: callers whose sub-org access comes from a SUB_ORG assignment
     *  (sub-org admins, and custom/teacher roles granted the module via Display Settings)
     *  only ever get their assigned channel partners — scoped in the DB query, so counts and
     *  paging match. A caller with nothing assigned gets an empty list, not the full network.
     *  Only root and true institute ADMINs get the unrestricted list, and only that branch
     *  needs the institute-admin assertion (the row carries admin PII). */
    @GetMapping("/get-all-with-details")
    public ResponseEntity<?> getSubOrgsWithDetails(
            @RequestParam String parentInstituteId,
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "size", required = false) Integer size,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        if (user == null) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "User authentication required");
        }
        if (parentInstituteId == null || parentInstituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Institute ID is required");
        }
        List<String> visible = subOrgAccessScopeService
                .resolveVisibleSubOrgIds(user, parentInstituteId);
        if (visible == null) {
            assertInstituteAdmin(user, parentInstituteId);
        }
        Sort sort = Sort.by(Sort.Direction.DESC, "createdAt");
        if (page == null && size == null) {
            // Legacy shape: everything in one bare array (page of MAX size keeps one code path).
            return ResponseEntity.ok(subOrgListService
                    .getSubOrgsWithDetails(
                            parentInstituteId, PageRequest.of(0, Integer.MAX_VALUE, sort), visible)
                    .getContent());
        }
        Pageable pageable = PageRequest.of(page != null ? page : 0, size != null ? size : 10, sort);
        return ResponseEntity.ok(
                subOrgListService.getSubOrgsWithDetails(parentInstituteId, pageable, visible));
    }

    /**
     * Assert the caller may read this institute's sub-org data. Mirrors
     * SubOrgRegistrationAdminController#assertInstituteAdmin — bound to THIS instituteId:
     * root users bypass; else an ACTIVE ADMIN role for this institute; else legacy staff
     * membership. Prevents cross-institute enumeration of admin PII via a spoofed id.
     */
    private void assertInstituteAdmin(CustomUserDetails user, String instituteId) {
        if (user == null) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "User authentication required");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Institute ID is required");
        }
        if (user.isRootUser()) {
            return;
        }
        // Roles live in auth_service's DB (admin_core has no user_role table); a failed
        // lookup falls through to the staff-membership check below.
        if (instituteRoleUserClient.findRolesOfUser(instituteId, user.getUserId())
                .map(roles -> roles.contains(ROLE_NAME_ADMIN)).orElse(false)) {
            return;
        }
        boolean isStaff = instituteRepository.findInstitutesByUserId(user.getUserId())
                .stream()
                .anyMatch(institute -> instituteId.equals(institute.getId()));
        if (!isStaff) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Access denied: you do not have admin access to institute " + instituteId);
        }
    }

    @PostMapping("/create-with-subscription")
    public ResponseEntity<CreateSubOrgSubscriptionResponseDTO> createSubOrgWithSubscription(
            @RequestBody CreateSubOrgSubscriptionDTO request,
            @RequestParam String parentInstituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_CREATE);
        return ResponseEntity.ok(
                subOrgSubscriptionService.createSubOrgWithSubscription(request, parentInstituteId));
    }

    /**
     * Update the allow-list of custom roles a sub-org admin may assign on
     * /manage-suborg-teams. Body: {"allowed_team_roles": ["RoleA","RoleB"]} —
     * pass an empty list to clear (no restriction).
     */
    @org.springframework.web.bind.annotation.PatchMapping("/{subOrgId}/team-roles")
    public ResponseEntity<java.util.Map<String, Object>> updateAllowedTeamRoles(
            @org.springframework.web.bind.annotation.PathVariable String subOrgId,
            @RequestParam String parentInstituteId,
            @RequestBody java.util.Map<String, Object> body,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, parentInstituteId);
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_EDIT_CONFIG);
        Object raw = body != null ? body.get("allowed_team_roles") : null;
        List<String> roles = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) roles.add(String.valueOf(o));
            }
        }
        List<String> saved = subOrgSubscriptionService
                .updateAllowedTeamRoles(subOrgId, parentInstituteId, roles);
        java.util.Map<String, Object> out = new HashMap<>();
        out.put("sub_org_id", subOrgId);
        out.put("allowed_team_roles", saved);
        return ResponseEntity.ok(out);
    }

    /**
     * Update the admin permissions (FSPSSM access_permission CSV) for a sub-org. Body:
     * {"admin_permissions": ["FULL","CREATE_COURSE"]} — pass an empty list to clear and
     * fall back to the legacy "FULL" default. Existing FSPSSM rows are NOT rewritten;
     * the new value only applies to admin users enrolled after this call (back-fill is
     * a follow-up if the edit UX needs it).
     */
    @org.springframework.web.bind.annotation.PatchMapping("/{subOrgId}/admin-permissions")
    public ResponseEntity<java.util.Map<String, Object>> updateAdminPermissions(
            @org.springframework.web.bind.annotation.PathVariable String subOrgId,
            @RequestParam String parentInstituteId,
            @RequestBody java.util.Map<String, Object> body,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, parentInstituteId);
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_EDIT_CONFIG);
        Object raw = body != null ? body.get("admin_permissions") : null;
        List<String> perms = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) perms.add(String.valueOf(o));
            }
        }
        List<String> saved = subOrgSubscriptionService
                .updateAdminPermissions(subOrgId, parentInstituteId, perms);
        java.util.Map<String, Object> out = new HashMap<>();
        out.put("sub_org_id", subOrgId);
        out.put("admin_permissions", saved);
        return ResponseEntity.ok(out);
    }

    /**
     * Re-sends the sub-org admin's current login details by email (Manage VLEs → row menu →
     * "Share credentials"). Read-only on the admin's account; the reply carries auth-service's
     * own {@code sent}/{@code failed}/{@code message} so the UI can say what actually happened.
     */
    @PostMapping("/{subOrgId}/resend-admin-credentials")
    public ResponseEntity<Map<String, Object>> resendAdminCredentials(
            @PathVariable String subOrgId,
            @RequestParam String parentInstituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, parentInstituteId);
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_MANAGE_TEAM);
        return ResponseEntity.ok(
                subOrgAdminCredentialService.resendAdminLoginDetails(subOrgId, parentInstituteId));
    }

    /**
     * Re-runs the SUBORG_LEARNER mirror logic for every PS already linked to this sub-org's
     * org-level invite. Idempotent — only creates invites for institute-wide PaymentOptions
     * that aren't already mirrored. Surfaces a "Re-sync invites" button on the deep page so
     * institute admins can pick up payment options added after the sub-org was created.
     */
    @org.springframework.web.bind.annotation.PostMapping("/{subOrgId}/resync-invites")
    public ResponseEntity<java.util.Map<String, Object>> resyncSuborgLearnerInvites(
            @org.springframework.web.bind.annotation.PathVariable String subOrgId,
            @RequestParam String parentInstituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, parentInstituteId);
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_EDIT_CONFIG);
        return ResponseEntity.ok(
                subOrgSubscriptionService.resyncSuborgLearnerInvites(subOrgId, parentInstituteId));
    }

    /**
     * Consolidated config edit for a sub-org. Each field is optional — only present fields
     * are applied. Body shape:
     * <pre>{
     *   "auth_roles": ["TEACHER"],
     *   "allowed_team_roles": ["Mentor"],
     *   "admin_permissions": ["FULL"],
     *   "member_count": 25,
     *   "validity_in_days": 365
     * }</pre>
     * Returns the subset that was actually applied — so the FE can give precise toast feedback.
     */
    @org.springframework.web.bind.annotation.PatchMapping("/{subOrgId}/configuration")
    public ResponseEntity<java.util.Map<String, Object>> updateSubOrgConfiguration(
            @org.springframework.web.bind.annotation.PathVariable String subOrgId,
            @RequestParam String parentInstituteId,
            @RequestBody java.util.Map<String, Object> body,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, parentInstituteId);
        subOrgAccessScopeService.assertRolePermission(user, parentInstituteId,
                SubOrgAccessScopeService.PERM_EDIT_CONFIG);
        java.util.Map<String, Object> applied = subOrgSubscriptionService
                .updateSubOrgConfiguration(subOrgId, parentInstituteId,
                        body != null ? body : new HashMap<>());
        java.util.Map<String, Object> out = new HashMap<>();
        out.put("sub_org_id", subOrgId);
        out.put("applied", applied);
        return ResponseEntity.ok(out);
    }

    /**
     * Returns each ACTIVE invite for the sub-org enriched with the package sessions it
     * grants access to (package name + level name + session name). Earlier versions only
     * returned EnrollInviteDTO, which doesn't carry PS info — so the frontend couldn't
     * show the courses picked at creation time and tripped over "no package session"
     * checks on bundled org-level invites.
     */
    @GetMapping("/scoped-invites")
    public ResponseEntity<List<Map<String, Object>>> getScopedInvites(
            @RequestParam String subOrgId,
            @RequestParam String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, instituteId);
        List<EnrollInvite> invites = enrollInviteRepository
                .findBySubOrgIdAndInstituteId(subOrgId, instituteId,
                        List.of(StatusEnum.ACTIVE.name()));
        List<Map<String, Object>> out = new ArrayList<>(invites.size());
        for (EnrollInvite invite : invites) {
            EnrollInviteDTO base = invite.toEnrollInviteDTO();
            Map<String, Object> row = new HashMap<>();
            row.put("id", base.getId());
            row.put("name", base.getName());
            row.put("invite_code", base.getInviteCode());
            row.put("status", base.getStatus());
            row.put("tag", base.getTag());
            row.put("is_bundled", base.getIsBundled());
            row.put("sub_org_id", base.getSubOrgId());
            row.put("learner_access_days", base.getLearnerAccessDays());
            // Frontend needs settingJson to pre-fill the admin's role (authRoles) on the
            // Add User form without re-asking the admin.
            row.put("setting_json", base.getSettingJson());

            // Hoist allowed_team_roles up to a top-level field so the FE doesn't have to
            // parse settingJson just to filter the /manage-suborg-teams add-member dropdown.
            try {
                if (org.springframework.util.StringUtils.hasText(base.getSettingJson())) {
                    com.fasterxml.jackson.databind.ObjectMapper m = new com.fasterxml.jackson.databind.ObjectMapper();
                    var parsed = m.readValue(base.getSettingJson(),
                            vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO.class);
                    if (parsed != null && parsed.getSetting() != null
                            && parsed.getSetting().getSubOrgSetting() != null) {
                        var subSet = parsed.getSetting().getSubOrgSetting();
                        row.put("allowed_team_roles", subSet.getAllowedTeamRoles());
                        row.put("admin_permissions", subSet.getAdminPermissions());
                        row.put("auth_roles", subSet.getAuthRoles());
                        row.put("member_count_setting", subSet.getMemberCount());
                    }
                }
            } catch (Exception ignored) { /* leave field absent on parse failure */ }
            row.put("learner_access_days_top", invite.getLearnerAccessDays());

            List<PackageSessionLearnerInvitationToPaymentOption> links = pslipoService.findByInvite(invite);
            List<Map<String, Object>> psRows = new ArrayList<>();
            String paymentType = null;
            String complexPaymentOptionId = null;
            String paymentOptionId = null;
            for (PackageSessionLearnerInvitationToPaymentOption link : links) {
                PackageSession ps = link.getPackageSession();
                if (ps == null) continue;
                Map<String, Object> psRow = new HashMap<>();
                psRow.put("id", ps.getId());
                psRow.put("package_name", ps.getPackageEntity() != null
                        ? ps.getPackageEntity().getPackageName() : null);
                psRow.put("level_name", ps.getLevel() != null
                        ? ps.getLevel().getLevelName() : null);
                psRow.put("session_name", ps.getSession() != null
                        ? ps.getSession().getSessionName() : null);
                psRows.add(psRow);

                // Use the link's PaymentOption to surface payment_type + cpo id once. All
                // links on a given invite share the same PaymentOption, so reading from the
                // first non-null one is enough.
                PaymentOption opt = link.getPaymentOption();
                if (opt != null && paymentType == null) {
                    paymentType = opt.getType();
                    complexPaymentOptionId = opt.getComplexPaymentOptionId();
                    paymentOptionId = opt.getId();
                }
            }
            row.put("package_sessions", psRows);
            row.put("payment_type", paymentType);
            row.put("complex_payment_option_id", complexPaymentOptionId);
            row.put("payment_option_id", paymentOptionId);
            out.add(row);
        }
        return ResponseEntity.ok(out);
    }

    @GetMapping("/seat-usage")
    public ResponseEntity<SeatUsageDTO> getSeatUsage(
            @RequestParam String subOrgId,
            @RequestParam String packageSessionId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, null);
        return ResponseEntity.ok(
                subOrgSubscriptionService.getSeatUsage(subOrgId, packageSessionId));
    }

    /**
     * Detail panel for {@code /manage-sub-orgs}: admin-level payment summary (CPO installments
     * included when the sub-org was bought via CPO) + learner roster with outstanding dues.
     */
    @GetMapping("/finance-detail")
    public ResponseEntity<SubOrgFinanceDetailDTO> getFinanceDetail(
            @RequestParam String subOrgId,
            @RequestParam(required = false) String parentInstituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, parentInstituteId);
        return ResponseEntity.ok(subOrgFinanceService.getFinanceDetail(subOrgId, parentInstituteId));
    }

    @GetMapping("/subscription-status")
    public ResponseEntity<SubOrgSubscriptionStatusDTO> getSubscriptionStatus(
            @RequestParam String subOrgId,
            @RequestParam String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        subOrgAccessScopeService.assertCanAccessSubOrg(user, subOrgId, instituteId);
        // Get org-level invite for this sub-org
        List<EnrollInvite> orgInvites = enrollInviteRepository
                .findBySubOrgIdAndInstituteId(subOrgId, instituteId,
                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.DELETED.name()));

        String inviteCode = null;
        String shortUrl = null;
        if (!orgInvites.isEmpty()) {
            inviteCode = orgInvites.get(0).getInviteCode();
            shortUrl = orgInvites.get(0).getShortUrl();
        }

        // Get scoped invites to build seat usage list
        List<EnrollInvite> scopedInvites = enrollInviteRepository
                .findBySubOrgIdAndInstituteId(subOrgId, instituteId,
                        List.of(StatusEnum.ACTIVE.name()));

        List<SeatUsageDTO> seatUsages = new ArrayList<>();
        // For each scoped invite, get seat usage from its linked package sessions
        // This is a simplified version - full implementation would resolve package sessions
        // from the invite mappings

        return ResponseEntity.ok(SubOrgSubscriptionStatusDTO.builder()
                .subOrgId(subOrgId)
                .inviteCode(inviteCode)
                .shortUrl(shortUrl)
                .seatUsages(seatUsages)
                .build());
    }
}
