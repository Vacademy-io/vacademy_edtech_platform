package vacademy.io.admin_core_service.features.suborg.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.faculty.dto.UserSubOrgLinkRow;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.institute.entity.InstituteSubOrg;
import vacademy.io.admin_core_service.features.institute.repository.InstituteSubOrgRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgTeamAddRequestDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgTeamAssignRequestDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgTeamListRequestDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgTeamMemberInstallmentsDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgTeamRemoveRequestDTO;
import vacademy.io.common.auth.dto.PagedUserWithRolesResponse;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import jakarta.servlet.http.HttpServletRequest;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Service-level operations for managing sub-org team members.
 *
 * Scope rules:
 *  - Caller is "ADMIN" / "TEACHER" → unrestricted (can target any sub-org).
 *  - Caller is a sub-org admin (only FSPSSM SUB_ORG access) → can ONLY target sub-orgs they
 *    have an active SUB_ORG-linked FSPSSM entry for.
 *  - Anyone else → 403.
 *
 * The team list is sourced from FSPSSM (linkage_type=SUB_ORG, suborg_id=...) and joined with
 * auth-service for user details. Custom roles are filtered client-side via the role list.
 */
@Service
@Slf4j
public class SubOrgTeamService {

    private static final Set<String> SYSTEM_ROLES = new HashSet<>(Arrays.asList("ADMIN", "TEACHER", "STUDENT"));

    @Autowired
    private FacultySubjectPackageSessionMappingRepository facultyMappingRepository;

    @Autowired
    private InstituteSubOrgRepository instituteSubOrgRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Autowired
    private JwtService jwtService;

    // Used to resolve the FSPSSM access_permission CSV from the sub-org's settingJson
    // (ADMIN_PERMISSIONS) so team members inherit the same permission set the parent
    // institute admin picked at sub-org creation. Without this, the previous hardcoded
    // "FULL" fallback masked CREATE_COURSE etc. that the admin had explicitly granted.
    @Autowired
    private vacademy.io.admin_core_service.features.suborg.service.SubOrgSubscriptionService subOrgSubscriptionService;

    /** Enforces the per-role "Manage team members" capability. Only constrains callers
     *  whose channel-partner access comes from a ROLE grant — admins and sub-org admins
     *  are governed by their existing model and pass through untouched. */
    @Autowired
    private SubOrgAccessScopeService subOrgAccessScopeService;

    @Autowired
    private vacademy.io.admin_core_service.core.security.InstituteAccessValidator instituteAccessValidator;

    /** Resolves a sub-org invite's package sessions when an assign request doesn't name them. */
    @Autowired
    private vacademy.io.admin_core_service.features.enroll_invite.service
            .PackageSessionEnrollInviteToPaymentOptionService pslipoService;

    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;

    @Value("${spring.application.name}")
    private String applicationName;

    /** List team members under a sub-org. */
    public PagedUserWithRolesResponse listTeamMembers(SubOrgTeamListRequestDTO request, CustomUserDetails caller) {
        String subOrgId = request.getSubOrgId();
        String instituteId = request.getInstituteId();
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException("sub_org_id is required");
        }
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("institute_id is required");
        }

        ensureCallerCanAccessSubOrg(caller, instituteId, subOrgId);

        // 1. Resolve user IDs in scope from FSPSSM
        List<String> userIds = facultyMappingRepository
                .findDistinctUserIdsBySubOrgIdAndLinkage(subOrgId, List.of("ACTIVE"));
        if (userIds.isEmpty()) {
            return PagedUserWithRolesResponse.builder()
                    .content(java.util.Collections.emptyList())
                    .pageNumber(request.getPageNumber() != null ? request.getPageNumber() : 0)
                    .pageSize(request.getPageSize() != null ? request.getPageSize() : 10)
                    .totalElements(0L)
                    .totalPages(0)
                    .first(true)
                    .last(true)
                    .build();
        }

        // 2. Hand off to auth-service's existing public users-of-status endpoint,
        //    forwarding the caller's JWT (auth-service does its own auth check).
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("roles", request.getRoles());
        body.put("status", request.getStatus());
        body.put("name", request.getName());
        body.put("page_number", request.getPageNumber() != null ? request.getPageNumber() : 0);
        body.put("page_size", request.getPageSize() != null ? request.getPageSize() : 10);
        body.put("user_ids", userIds);

        String authHeader = currentRequestAuthHeader();
        if (authHeader == null) {
            throw new VacademyException("Missing Authorization header");
        }

        String url = authServerBaseUrl + "/auth-service/v1/user-roles/users-of-status?instituteId=" + instituteId;
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", authHeader);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("clientId", instituteId);

        PagedUserWithRolesResponse authResponse;
        try {
            ResponseEntity<String> response = sharedRestTemplate().exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), String.class);
            ObjectMapper mapper = new ObjectMapper();
            authResponse = mapper.readValue(response.getBody(), PagedUserWithRolesResponse.class);
        } catch (Exception e) {
            log.error("Failed to load sub-org team members from auth-service", e);
            throw new VacademyException("Failed to load sub-org team members");
        }

        // Defensive post-filter: if auth-service is on an older build without the user_ids
        // field on UserRoleFilterDTO, it will ignore the filter and return all users with the
        // matching roles. Trim the response to only the user IDs we actually scoped.
        if (authResponse != null && authResponse.getContent() != null) {
            int upstreamSize = authResponse.getContent().size();
            Set<String> allowedIds = new java.util.HashSet<>(userIds);
            List<vacademy.io.common.auth.dto.UserWithRolesDTO> filtered = authResponse.getContent().stream()
                    .filter(u -> u.getId() != null && allowedIds.contains(u.getId()))
                    .collect(java.util.stream.Collectors.toList());
            log.info("[SubOrgTeam] subOrg={} fspssm-userIds={} upstream-rows={} filtered-rows={}",
                    subOrgId, userIds, upstreamSize, filtered.size());
            // If the post-filter removed rows, the upstream pagination numbers no longer
            // describe this page accurately. Reflect the actual filtered counts so the UI
            // doesn't show ghost rows / wrong totals.
            if (filtered.size() != upstreamSize) {
                authResponse.setContent(filtered);
                authResponse.setTotalElements(filtered.size());
                authResponse.setTotalPages(filtered.isEmpty() ? 0 : 1);
                authResponse.setFirst(true);
                authResponse.setLast(true);
            }
        }
        return authResponse;
    }

    private RestTemplate sharedRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(30000);
        return new RestTemplate(factory);
    }

    private String currentRequestAuthHeader() {
        try {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs == null) return null;
            HttpServletRequest request = attrs.getRequest();
            return request.getHeader("Authorization");
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * Add a team member to a sub-org.
     * - Validates sub-org scope and the requested role.
     * - Calls auth-service to invite/create the user with the role.
     * - Creates one FSPSSM entry per package session, with linkage_type=SUB_ORG.
     */
    @Transactional
    public Map<String, Object> addTeamMember(SubOrgTeamAddRequestDTO request, CustomUserDetails caller) {
        if (request.getUser() == null || !StringUtils.hasText(request.getUser().getEmail())
                || !StringUtils.hasText(request.getUser().getFullName())) {
            throw new VacademyException("user.email and user.full_name are required");
        }
        if (!StringUtils.hasText(request.getSubOrgId())) {
            throw new VacademyException("sub_org_id is required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }

        ensureCallerCanAccessSubOrg(caller, request.getInstituteId(), request.getSubOrgId());
        subOrgAccessScopeService.assertRolePermission(caller, request.getInstituteId(),
                SubOrgAccessScopeService.PERM_MANAGE_TEAM);

        // For non-admin callers, reject system roles.
        boolean callerIsSystemAdmin = hasSystemRole(caller, request.getInstituteId(), "ADMIN", "TEACHER");
        String roleName = request.getRoleName();
        if (!callerIsSystemAdmin) {
            if (!StringUtils.hasText(roleName) || SYSTEM_ROLES.contains(roleName.toUpperCase())) {
                throw new VacademyException("Sub-org admins can only assign custom roles");
            }
            // ALLOWED_TEAM_ROLES allow-list (configured at sub-org creation, editable
            // later by the parent admin). Empty / null = no restriction. Parent admins
            // bypass this gate so they can add members in any role they choose.
            List<String> allowed = readAllowedTeamRolesFromSubOrgSettings(
                    request.getSubOrgId(), request.getInstituteId());
            if (allowed != null && !allowed.isEmpty()
                    && allowed.stream().noneMatch(r -> r.equalsIgnoreCase(roleName))) {
                throw new VacademyException(
                        "Role '" + roleName + "' is not in this sub-org's allowed roles. "
                                + "Allowed: " + String.join(", ", allowed));
            }
        }

        // Only an ADMIN of the institute may create another ADMIN there. hasSystemRole reads
        // authorities minted for the clientId institute, which need not be this one.
        if ("ADMIN".equalsIgnoreCase(roleName)) {
            instituteAccessValidator.requireInstituteAdmin(caller, request.getInstituteId());
        }

        // Validate package sessions are within caller's scope (sub-org admins only).
        // Invite-level access is auto-linked from the selected PSes, so there's no separate
        // invite_ids field on the request — the form doesn't let the caller pick invites.
        List<String> requestedPsIds = request.getPackageSessionIds() != null
                ? request.getPackageSessionIds() : new ArrayList<>();
        if (requestedPsIds.isEmpty()) {
            throw new VacademyException("At least one package session must be selected");
        }
        if (!callerIsSystemAdmin) {
            Set<String> accessiblePs = new HashSet<>(facultyMappingRepository
                    .findAccessIdsByUserIdAndInstituteId(caller.getUserId(), request.getInstituteId(),
                            List.of("ACTIVE")));
            for (String psId : requestedPsIds) {
                if (!accessiblePs.contains(psId)) {
                    throw new VacademyException("Package session " + psId + " is outside your access scope");
                }
            }
        }

        // 1. Invite user via auth-service. UserDTO uses SnakeCaseStrategy so the field is is_root_user.
        Map<String, Object> invitePayload = new java.util.HashMap<>();
        invitePayload.put("email", request.getUser().getEmail());
        invitePayload.put("full_name", request.getUser().getFullName());
        invitePayload.put("mobile_number", request.getUser().getMobileNumber());
        invitePayload.put("roles", List.of(roleName));
        invitePayload.put("is_root_user", false);

        String inviteRoute = "/auth-service/internal/v1/user-invitation/invite?instituteId=" + request.getInstituteId();
        ResponseEntity<String> inviteResponse = internalClientUtils.makeHmacRequest(
                applicationName, HttpMethod.POST.name(), authServerBaseUrl, inviteRoute, invitePayload);

        String userId;
        try {
            ObjectMapper mapper = new ObjectMapper();
            Map<String, Object> respMap = mapper.readValue(inviteResponse.getBody(), new TypeReference<>() {});
            userId = extractUserId(respMap);
            if (!StringUtils.hasText(userId)) {
                throw new VacademyException("Auth service did not return a user id");
            }
        } catch (Exception e) {
            log.error("Failed to invite user via auth-service", e);
            throw new VacademyException("Failed to create user");
        }

        // 2. Create FSPSSM entries. For each PS:
        //    - One PACKAGE_SESSION row
        //    - One ENROLL_INVITE row per SUBORG_LEARNER invite linked to that PS via PSLIPO
        //      (mirrors syncFacultyMappingForSubOrgAdmin so team members get the same invite-
        //      scoped visibility their sub-org admin has).
        // Resolution order: explicit request override → sub-org's ADMIN_PERMISSIONS
        // setting (e.g. "FULL,CREATE_COURSE") → legacy "FULL" fallback inside the
        // resolver. Avoid hardcoding "FULL" here — that path silently dropped any
        // granular permission the institute admin chose at sub-org creation.
        String accessPermission;
        if (StringUtils.hasText(request.getAccessPermission())) {
            accessPermission = request.getAccessPermission();
        } else {
            accessPermission = subOrgSubscriptionService
                    .resolveAdminPermissionCsv(request.getSubOrgId(), request.getInstituteId());
        }
        int psGranted = 0;
        int inviteGranted = 0;
        Set<String> grantedInviteIds = new HashSet<>();
        for (String psId : requestedPsIds) {
            FacultySubjectPackageSessionMapping psMapping = new FacultySubjectPackageSessionMapping();
            psMapping.setUserId(userId);
            psMapping.setPackageSessionId(psId);
            psMapping.setName(request.getUser().getFullName());
            psMapping.setStatus("ACTIVE");
            psMapping.setUserType("ROLE");
            psMapping.setTypeId(request.getRoleId());
            psMapping.setAccessType("PACKAGE_SESSION");
            psMapping.setAccessId(psId);
            psMapping.setAccessPermission(accessPermission);
            psMapping.setLinkageType("SUB_ORG");
            psMapping.setSuborgId(request.getSubOrgId());
            facultyMappingRepository.save(psMapping);
            psGranted++;

            // Auto-link SUBORG_LEARNER invites for this (subOrgId, psId) pair
            List<String> linkedInviteIds = enrollInviteRepository
                    .findInviteIdsForSubOrgAndPackageSession(request.getSubOrgId(), psId);
            for (String inviteId : linkedInviteIds) {
                if (!grantedInviteIds.add(inviteId)) continue; // dedupe across PSes
                FacultySubjectPackageSessionMapping inviteMapping = new FacultySubjectPackageSessionMapping();
                inviteMapping.setUserId(userId);
                inviteMapping.setName(request.getUser().getFullName());
                inviteMapping.setStatus("ACTIVE");
                inviteMapping.setUserType("ROLE");
                inviteMapping.setTypeId(request.getRoleId());
                inviteMapping.setAccessType("ENROLL_INVITE");
                inviteMapping.setAccessId(inviteId);
                inviteMapping.setAccessPermission(accessPermission);
                inviteMapping.setLinkageType("SUB_ORG");
                inviteMapping.setSuborgId(request.getSubOrgId());
                facultyMappingRepository.save(inviteMapping);
                inviteGranted++;
            }
        }

        Map<String, Object> result = new java.util.HashMap<>();
        result.put("user_id", userId);
        result.put("granted_count", psGranted + inviteGranted);
        result.put("ps_granted", psGranted);
        result.put("invite_granted", inviteGranted);
        return result;
    }

    /**
     * Grant an EXISTING institute user access to a sub-org.
     *
     * <p>Why this exists next to {@link #addTeamMember}: that method creates a person. It
     * posts to auth-service {@code /user-invitation/invite}, which can fire an invitation
     * email — correct when adding somebody new, but wrong when an admin is just assigning
     * a channel partner to a colleague who already has an account. This path writes only
     * the FSPSSM rows, so assigning is silent and side-effect free.
     *
     * <p>Idempotent: package sessions the user already holds an ACTIVE SUB_ORG grant for
     * are skipped, so re-assigning does not pile up duplicate rows.
     *
     * @return counts of what was newly granted (and what was already in place).
     */
    @Transactional
    public Map<String, Object> assignExistingUser(SubOrgTeamAssignRequestDTO request, CustomUserDetails caller) {
        if (request == null || !StringUtils.hasText(request.getSubOrgId())
                || !StringUtils.hasText(request.getUserId())) {
            throw new VacademyException("sub_org_id and user_id are required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }

        ensureCallerCanAccessSubOrg(caller, request.getInstituteId(), request.getSubOrgId());
        subOrgAccessScopeService.assertRolePermission(caller, request.getInstituteId(),
                SubOrgAccessScopeService.PERM_MANAGE_TEAM);

        List<String> psIds = (request.getPackageSessionIds() != null
                && !request.getPackageSessionIds().isEmpty())
                ? request.getPackageSessionIds()
                : resolveSubOrgPackageSessionIds(request.getSubOrgId(), request.getInstituteId());
        if (psIds.isEmpty()) {
            throw new VacademyException(
                    "This sub-org has no courses linked yet, so there is nothing to grant access to");
        }

        // Everything this user already has ACTIVE under THIS sub-org, so a repeat assign
        // is a no-op rather than a second set of rows.
        Set<String> existing = new HashSet<>(facultyMappingRepository
                .findAccessIdsByUserIdAndSubOrgId(request.getUserId(), request.getSubOrgId(),
                        List.of("ACTIVE")));

        String accessPermission = subOrgSubscriptionService
                .resolveAdminPermissionCsv(request.getSubOrgId(), request.getInstituteId());

        int psGranted = 0;
        int inviteGranted = 0;
        int skipped = 0;
        Set<String> grantedInviteIds = new HashSet<>();
        for (String psId : psIds) {
            if (!StringUtils.hasText(psId)) continue;
            if (existing.contains(psId)) {
                skipped++;
            } else {
                facultyMappingRepository.save(
                        buildSubOrgMapping(request, "PACKAGE_SESSION", psId, psId, accessPermission));
                psGranted++;
            }
            // Mirror the invite-scoped rows addTeamMember creates, so an assigned member
            // sees the same sub-org learners their admin does.
            for (String inviteId : enrollInviteRepository
                    .findInviteIdsForSubOrgAndPackageSession(request.getSubOrgId(), psId)) {
                if (!grantedInviteIds.add(inviteId)) continue;
                if (existing.contains(inviteId)) {
                    skipped++;
                    continue;
                }
                facultyMappingRepository.save(
                        buildSubOrgMapping(request, "ENROLL_INVITE", inviteId, null, accessPermission));
                inviteGranted++;
            }
        }

        Map<String, Object> result = new java.util.HashMap<>();
        result.put("user_id", request.getUserId());
        result.put("sub_org_id", request.getSubOrgId());
        result.put("granted_count", psGranted + inviteGranted);
        result.put("ps_granted", psGranted);
        result.put("invite_granted", inviteGranted);
        result.put("already_had", skipped);
        return result;
    }

    private FacultySubjectPackageSessionMapping buildSubOrgMapping(
            SubOrgTeamAssignRequestDTO request, String accessType, String accessId,
            String packageSessionId, String accessPermission) {
        FacultySubjectPackageSessionMapping m = new FacultySubjectPackageSessionMapping();
        m.setUserId(request.getUserId());
        m.setPackageSessionId(packageSessionId);
        m.setStatus("ACTIVE");
        m.setUserType("ROLE");
        m.setAccessType(accessType);
        m.setAccessId(accessId);
        m.setAccessPermission(accessPermission);
        m.setLinkageType("SUB_ORG");
        m.setSuborgId(request.getSubOrgId());
        return m;
    }

    /** Package sessions reachable through a sub-org's ACTIVE invites. */
    private List<String> resolveSubOrgPackageSessionIds(String subOrgId, String instituteId) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>();
        for (EnrollInvite invite : enrollInviteRepository.findBySubOrgIdAndInstituteId(
                subOrgId, instituteId, List.of("ACTIVE"))) {
            for (var link : pslipoService.findByInvite(invite)) {
                if (link.getPackageSession() != null && link.getPackageSession().getId() != null) {
                    ids.add(link.getPackageSession().getId());
                }
            }
        }
        return new ArrayList<>(ids);
    }

    /**
     * Remove a team member from a sub-org. Marks all SUB_ORG-linked FSPSSM entries for
     * (user_id, sub_org_id) as INACTIVE. Other sub-orgs the user belongs to are untouched.
     */
    @Transactional
    public Map<String, Object> removeTeamMember(SubOrgTeamRemoveRequestDTO request, CustomUserDetails caller) {
        if (!StringUtils.hasText(request.getSubOrgId()) || !StringUtils.hasText(request.getUserId())) {
            throw new VacademyException("sub_org_id and user_id are required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }

        ensureCallerCanAccessSubOrg(caller, request.getInstituteId(), request.getSubOrgId());
        subOrgAccessScopeService.assertRolePermission(caller, request.getInstituteId(),
                SubOrgAccessScopeService.PERM_MANAGE_TEAM);

        List<FacultySubjectPackageSessionMapping> mappings = facultyMappingRepository
                .findByUserIdAndSubOrgIdAndLinkage(request.getUserId(), request.getSubOrgId());
        if (mappings.isEmpty()) {
            throw new VacademyException("User has no active membership in this sub-org");
        }

        // Default to HARD when unspecified so pre-existing callers keep the old
        // "deactivate immediately" behaviour.
        boolean soft = "SOFT".equalsIgnoreCase(request.getMode());
        Timestamp accessTill = parseAccessTillDate(request.getAccessTillDate());
        if (soft && accessTill == null) {
            throw new VacademyException("A last access date is required for a soft removal");
        }

        int updated = 0;
        for (FacultySubjectPackageSessionMapping m : mappings) {
            if (soft) {
                // SOFT: keep the CURRENTLY-ACTIVE memberships alive, just stamp the
                // cut-off — the nightly SubOrgTeamAccessExpiryJob flips them to
                // INACTIVE once it passes. Never revive already-removed (INACTIVE)
                // mappings.
                if ("ACTIVE".equalsIgnoreCase(m.getStatus())) {
                    m.setAccessTillDate(accessTill);
                    updated++;
                }
            } else {
                // HARD: revoke access now. Stamp the cut-off on the rows we flip.
                if (!"INACTIVE".equalsIgnoreCase(m.getStatus())) {
                    m.setStatus("INACTIVE");
                    m.setAccessTillDate(accessTill != null ? accessTill : Timestamp.from(Instant.now()));
                    updated++;
                }
            }
        }
        if (soft && updated == 0) {
            throw new VacademyException("User has no active membership in this sub-org to remove");
        }
        facultyMappingRepository.saveAll(mappings);

        Map<String, Object> result = new java.util.HashMap<>();
        result.put("user_id", request.getUserId());
        result.put("sub_org_id", request.getSubOrgId());
        result.put("mode", soft ? "SOFT" : "HARD");
        if (soft) {
            result.put("access_till_date", accessTill.toString());
            result.put("scheduled_mappings", updated);
        } else {
            result.put("deactivated_mappings", updated);
        }
        return result;
    }

    /**
     * Returns one row per team member who has any non-PAID StudentFeePayment. The candidate
     * set is the same FSPSSM-derived user list backing {@link #listTeamMembers}, so caller-
     * scope semantics match the team list 1:1. Team members without SFP rows are omitted
     * (the frontend can treat absent members as "no installments due").
     */
    @Transactional(readOnly = true)
    public SubOrgTeamMemberInstallmentsDTO getPendingInstallments(String subOrgId,
                                                                  String instituteId,
                                                                  CustomUserDetails caller) {
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException("sub_org_id is required");
        }
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("institute_id is required");
        }
        ensureCallerCanAccessSubOrg(caller, instituteId, subOrgId);

        List<String> userIds = facultyMappingRepository
                .findDistinctUserIdsBySubOrgIdAndLinkage(subOrgId, List.of("ACTIVE"));
        if (userIds.isEmpty()) {
            return SubOrgTeamMemberInstallmentsDTO.builder()
                    .subOrgId(subOrgId)
                    .members(java.util.Collections.emptyList())
                    .build();
        }

        List<SubOrgTeamMemberInstallmentsDTO.Row> rows = new ArrayList<>();
        for (String userId : userIds) {
            List<StudentFeePayment> all = studentFeePaymentRepository.findByUserId(userId);
            if (all.isEmpty()) continue;

            BigDecimal outstanding = BigDecimal.ZERO;
            int pending = 0;
            StudentFeePayment nextDue = null;
            for (StudentFeePayment sfp : all) {
                if ("PAID".equalsIgnoreCase(sfp.getStatus())) continue;
                BigDecimal expected = sfp.getAmountExpected() != null ? sfp.getAmountExpected() : BigDecimal.ZERO;
                BigDecimal paid = sfp.getAmountPaid() != null ? sfp.getAmountPaid() : BigDecimal.ZERO;
                outstanding = outstanding.add(expected.subtract(paid).max(BigDecimal.ZERO));
                pending++;
                if (sfp.getDueDate() != null
                        && (nextDue == null || nextDue.getDueDate() == null
                            || sfp.getDueDate().before(nextDue.getDueDate()))) {
                    nextDue = sfp;
                }
            }
            if (pending == 0) continue;

            SubOrgTeamMemberInstallmentsDTO.Row.RowBuilder b = SubOrgTeamMemberInstallmentsDTO.Row.builder()
                    .userId(userId)
                    .outstandingAmount(outstanding)
                    .pendingInstallmentsCount(pending)
                    .totalInstallments(all.size());
            if (nextDue != null) {
                b.nextDueDate(nextDue.getDueDate())
                        .nextDueAmount(nextDue.getAmountExpected())
                        .nextDueStatus(nextDue.getStatus());
            }
            rows.add(b.build());
        }

        return SubOrgTeamMemberInstallmentsDTO.builder()
                .subOrgId(subOrgId)
                .members(rows)
                .build();
    }

    // ─────────── helpers ───────────

    /**
     * Parse a SOFT "last access date". Accepts a bare {@code yyyy-MM-dd} (kept
     * through end-of-day, UTC) or a full ISO-8601 instant. Returns null on blank
     * or unparseable input.
     */
    private Timestamp parseAccessTillDate(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String value = raw.trim();
        try {
            if (value.length() == 10 && value.charAt(4) == '-') {
                LocalDate day = LocalDate.parse(value);
                return Timestamp.from(day.atTime(LocalTime.MAX).atZone(ZoneOffset.UTC).toInstant());
            }
            return Timestamp.from(Instant.parse(value));
        } catch (DateTimeParseException e) {
            log.warn("Ignoring unparseable access_till_date '{}': {}", raw, e.getMessage());
            return null;
        }
    }

    private void ensureCallerCanAccessSubOrg(CustomUserDetails caller, String instituteId, String subOrgId) {
        if (caller == null) {
            throw new VacademyException("Authentication required");
        }
        // The presence of SUB_ORG FSPSSM entries is the actual fingerprint of a sub-org admin —
        // checking the "ADMIN" role alone is unreliable because sub-org admins are also assigned
        // the ADMIN role for the parent institute.
        List<String> accessibleSubOrgs = facultyMappingRepository
                .findDistinctSubOrgIdsByUserAndLinkage(caller.getUserId(), List.of("ACTIVE"));

        if (accessibleSubOrgs.isEmpty()) {
            // No SUB_ORG linkages → treat as a true admin if they have ADMIN/TEACHER.
            if (hasSystemRole(caller, instituteId, "ADMIN", "TEACHER")) {
                return;
            }
            throw new VacademyException("You do not have access to this sub-org");
        }

        // Has SUB_ORG linkages → must be one of the caller's own sub-orgs.
        if (!accessibleSubOrgs.contains(subOrgId)) {
            throw new VacademyException("You do not have access to this sub-org");
        }
    }

    /**
     * Sub-orgs the caller is allowed to manage:
     * - Sub-org admins (have SUB_ORG FSPSSM linkages) → look those up via the suborgId column.
     *   We deliberately don't filter by {@code instituteId} here, because a sub-org admin
     *   may be logged into the sub-org's own institute context, while the {@link InstituteSubOrg}
     *   row stores institute_id = parent.
     * - True admins (no SUB_ORG linkages, has ADMIN/TEACHER role) → every sub-org under the
     *   requested institute.
     */
    public List<Map<String, Object>> listAccessibleSubOrgs(CustomUserDetails caller, String instituteId) {
        if (caller == null) {
            throw new VacademyException("Authentication required");
        }
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("institute_id is required");
        }

        List<String> accessibleSubOrgs = facultyMappingRepository
                .findDistinctSubOrgIdsByUserAndLinkage(caller.getUserId(), List.of("ACTIVE"));

        List<InstituteSubOrg> rows = new ArrayList<>();
        if (accessibleSubOrgs.isEmpty()) {
            if (!hasSystemRole(caller, instituteId, "ADMIN", "TEACHER")) {
                return java.util.Collections.emptyList();
            }
            rows = instituteSubOrgRepository.findByInstituteId(instituteId);
        } else {
            // For each FSPSSM-accessible suborgId, fetch its InstituteSubOrg row(s).
            for (String suborgId : accessibleSubOrgs) {
                rows.addAll(instituteSubOrgRepository.findBySuborgId(suborgId));
            }
        }

        // De-duplicate by suborgId in case multiple rows reference the same sub-org.
        Set<String> seen = new HashSet<>();
        List<Map<String, Object>> result = new ArrayList<>();
        for (InstituteSubOrg row : rows) {
            if (row.getSuborgId() == null || !seen.add(row.getSuborgId())) continue;
            Map<String, Object> m = new java.util.HashMap<>();
            m.put("id", row.getSuborgId());
            m.put("name", row.getName());
            result.add(m);
        }
        return result;
    }

    /**
     * For every user linked (via active SUB_ORG FSPSSM rows) to a sub-org the caller can see,
     * returns the list of those sub-orgs. Powers the "Sub-Orgs" column + filter on the institute
     * Teams list. Reuses {@link #listAccessibleSubOrgs} so the caller scoping is identical:
     * a real institute admin sees all sub-orgs, a sub-org admin sees only their own.
     *
     * Shape: [ { "user_id": String, "sub_orgs": [ { "id": String, "name": String } ] } ].
     * The {@code id} is the child-institute id (= FSPSSM.suborg_id), matching the filter options.
     */
    public List<Map<String, Object>> listUserSubOrgLinks(CustomUserDetails caller, String instituteId) {
        List<Map<String, Object>> accessible = listAccessibleSubOrgs(caller, instituteId);
        if (accessible.isEmpty()) {
            return new ArrayList<>();
        }

        Map<String, String> idToName = new java.util.HashMap<>();
        List<String> subOrgIds = new ArrayList<>();
        for (Map<String, Object> so : accessible) {
            String id = (String) so.get("id");
            if (id == null) continue;
            idToName.put(id, (String) so.get("name"));
            subOrgIds.add(id);
        }
        if (subOrgIds.isEmpty()) {
            return new ArrayList<>();
        }

        List<UserSubOrgLinkRow> rows =
                facultyMappingRepository.findUserSubOrgLinks(subOrgIds, List.of("ACTIVE"));

        // userId -> ordered, de-duplicated list of {id, name}
        Map<String, List<Map<String, Object>>> byUser = new java.util.LinkedHashMap<>();
        Map<String, Set<String>> seenPerUser = new java.util.HashMap<>();
        for (UserSubOrgLinkRow row : rows) {
            String userId = row.getUserId();
            String subOrgId = row.getSubOrgId();
            if (userId == null || subOrgId == null || !idToName.containsKey(subOrgId)) continue;
            if (!seenPerUser.computeIfAbsent(userId, k -> new HashSet<>()).add(subOrgId)) continue;
            Map<String, Object> entry = new java.util.HashMap<>();
            entry.put("id", subOrgId);
            entry.put("name", idToName.get(subOrgId));
            byUser.computeIfAbsent(userId, k -> new ArrayList<>()).add(entry);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, List<Map<String, Object>>> e : byUser.entrySet()) {
            Map<String, Object> m = new java.util.HashMap<>();
            m.put("user_id", e.getKey());
            m.put("sub_orgs", e.getValue());
            result.add(m);
        }
        return result;
    }

    /**
     * Package-session IDs the caller can grant access to from the Add Member form.
     * Invite-level FSPSSM rows are auto-linked server-side from the selected PSes via PSLIPO,
     * so the caller never picks invites explicitly.
     *
     * - Sub-org admin → their FSPSSM-accessible PS IDs.
     * - True admin    → every active PS under the institute.
     * - Anyone else   → empty list.
     */
    public Map<String, Object> listAccessibleGrants(CustomUserDetails caller, String instituteId) {
        if (caller == null) {
            throw new VacademyException("Authentication required");
        }
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("institute_id is required");
        }

        Map<String, Object> result = new java.util.HashMap<>();
        List<String> psIds;

        List<String> subOrgs = facultyMappingRepository
                .findDistinctSubOrgIdsByUserAndLinkage(caller.getUserId(), List.of("ACTIVE"));
        if (subOrgs.isEmpty()) {
            if (!hasSystemRole(caller, instituteId, "ADMIN", "TEACHER")) {
                result.put("package_session_ids", java.util.Collections.emptyList());
                return result;
            }
            psIds = packageSessionRepository.findPackageSessionsByInstituteId(instituteId, List.of("ACTIVE"))
                    .stream().map(PackageSession::getId).collect(java.util.stream.Collectors.toList());
        } else {
            psIds = facultyMappingRepository.findAccessIdsByUserIdAndInstituteId(
                    caller.getUserId(), instituteId, List.of("ACTIVE"));
        }

        result.put("package_session_ids", psIds);
        return result;
    }

    /**
     * Mirror of StudentListManager.hasRole — checks JWT authorities first, then JWT claim
     * fallback. We avoid a DB role check here because user_role lives in auth-service.
     */
    @SuppressWarnings("unchecked")
    /**
     * Looks up ALLOWED_TEAM_ROLES from the sub-org's org-level invite settingJson.
     * Returns null/empty when no allow-list is configured (legacy / unrestricted).
     */
    private List<String> readAllowedTeamRolesFromSubOrgSettings(String subOrgId,
                                                                String parentInstituteId) {
        try {
            List<vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite> candidates =
                    enrollInviteRepository.findBySubOrgIdAndInstituteId(
                            subOrgId, parentInstituteId, List.of("ACTIVE"));
            ObjectMapper mapper = new ObjectMapper();
            for (var invite : candidates) {
                if (!StringUtils.hasText(invite.getSettingJson())) continue;
                try {
                    var dto = mapper.readValue(invite.getSettingJson(),
                            vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO.class);
                    if (dto != null && dto.getSetting() != null
                            && dto.getSetting().getSubOrgSetting() != null) {
                        List<String> roles = dto.getSetting().getSubOrgSetting().getAllowedTeamRoles();
                        if (roles != null && !roles.isEmpty()) return roles;
                    }
                } catch (Exception ignored) { /* try next invite */ }
            }
        } catch (Exception e) {
            log.debug("Could not read ALLOWED_TEAM_ROLES for sub-org {}: {}", subOrgId, e.getMessage());
        }
        return null;
    }

    private boolean hasSystemRole(CustomUserDetails user, String instituteId, String... roles) {
        if (user == null) return false;
        boolean fromAuthorities = user.getAuthorities().stream()
                .map(a -> a.getAuthority())
                .anyMatch(authority -> {
                    for (String role : roles) {
                        if (role.equalsIgnoreCase(authority)) return true;
                    }
                    return false;
                });
        if (fromAuthorities) return true;

        if (instituteId == null) return false;
        try {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs == null) return false;
            HttpServletRequest request = attrs.getRequest();
            String authHeader = request.getHeader("Authorization");
            if (authHeader == null || !authHeader.startsWith("Bearer ")) return false;
            String jwt = authHeader.substring(7);

            Map<String, Object> authorities = jwtService.extractClaim(jwt,
                    claims -> (Map<String, Object>) claims.get("authorities"));
            if (authorities == null) return false;

            Map<String, Object> instituteAuth = (Map<String, Object>) authorities.get(instituteId);
            if (instituteAuth == null) return false;

            List<String> jwtRoles = (List<String>) instituteAuth.get("roles");
            if (jwtRoles == null) return false;

            for (String role : roles) {
                if (jwtRoles.stream().anyMatch(r -> role.equalsIgnoreCase(r))) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    @SuppressWarnings("unchecked")
    private String extractUserId(Map<String, Object> resp) {
        if (resp == null) return null;
        if (resp.get("userId") instanceof String s) return s;
        if (resp.get("id") instanceof String s) return s;
        Object userObj = resp.get("user");
        if (userObj instanceof Map) {
            Object id = ((Map<String, Object>) userObj).get("id");
            if (id instanceof String s) return s;
        }
        return null;
    }
}
