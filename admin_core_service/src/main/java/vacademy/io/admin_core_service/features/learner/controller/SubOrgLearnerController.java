package vacademy.io.admin_core_service.features.learner.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner.dto.*;
import vacademy.io.admin_core_service.features.learner.service.SubOrgLearnerService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgAccessScopeService;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/sub-org/v1")
public class SubOrgLearnerController {

    @Autowired
    private SubOrgLearnerService subOrgLearnerService;

    /** Limits every sub-org-keyed read to the channel partners the caller is assigned to.
     *  Root / true institute admins are unrestricted. */
    @Autowired
    private SubOrgAccessScopeService subOrgAccessScopeService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;


    @GetMapping("/members")
    public ResponseEntity<SubOrgResponseDTO> getUsersByPackageAndSubOrg(
            @RequestParam("package_session_id") String packageSessionId,
            @RequestParam("sub_org_id") String subOrgId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        subOrgAccessScopeService.assertNotCrossSubOrg(user, subOrgId);
        SubOrgResponseDTO response = subOrgLearnerService
                .getUsersByPackageSessionAndSubOrg(packageSessionId, subOrgId);
        
        return ResponseEntity.ok(response);
    }
    @PostMapping("/add-member")
    public ResponseEntity<SubOrgEnrollResponseDTO> enrollLearner(
            @RequestBody SubOrgEnrollRequestDTO request,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        SubOrgEnrollResponseDTO response = subOrgLearnerService.enrollLearnerToSubOrg(request,user);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/terminate-member")
    public ResponseEntity<SubOrgTerminateResponseDTO> terminateLearners(
            @RequestBody SubOrgTerminateRequestDTO request,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        SubOrgTerminateResponseDTO response = subOrgLearnerService.terminateLearners(request,user);

        return ResponseEntity.ok(response);
    }

    @GetMapping("/member-admin-details")
    public ResponseEntity<UserAdminDetailsResponseDTO> getAdminDetailsByUserId(
            @RequestParam("userId") String userId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        UserAdminDetailsResponseDTO response = subOrgLearnerService.getAdminDetailsByUserId(userId);

        return ResponseEntity.ok(response);
    }
    @GetMapping("/sub-org-admins")
    public ResponseEntity<SubOrgAdminsResponseDTO> getSubOrgAdmins(
            @RequestParam("userId") String userId,
            @RequestParam("packageSessionId") String packageSessionId,
            @RequestParam("subOrgId") String subOrgId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        subOrgAccessScopeService.assertNotCrossSubOrg(user, subOrgId);
        SubOrgAdminsResponseDTO response = subOrgLearnerService.getSubOrgAdmins(userId, packageSessionId, subOrgId);

        return ResponseEntity.ok(response);
    }

    /**
     * Sub-orgs already present in a package session, with their admins (name + email).
     * Drives the sub-org picker in the admin "Enroll Learner" wizard, shown only for package
     * sessions flagged {@code is_org_associated}.
     */
    @GetMapping("/by-package-session")
    public ResponseEntity<java.util.List<vacademy.io.admin_core_service.features.learner.dto.PackageSessionSubOrgDTO>> getSubOrgsByPackageSession(
            @RequestParam("packageSessionId") String packageSessionId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        return ResponseEntity.ok(subOrgLearnerService.getSubOrgsByPackageSession(packageSessionId));
    }

    /**
     * Search box of the same picker: sub-orgs anywhere in the institute whose name contains
     * {@code search} (at least 2 characters), so an organization with no member in the batch yet
     * can still be picked. Limited to the sub-orgs the caller may see.
     */
    @GetMapping("/search")
    public ResponseEntity<java.util.List<vacademy.io.admin_core_service.features.learner.dto.PackageSessionSubOrgDTO>> searchSubOrgs(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("search") String search,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        java.util.List<String> visible = subOrgAccessScopeService.resolveVisibleSubOrgIds(user, instituteId);
        return ResponseEntity.ok(subOrgLearnerService.searchInstituteSubOrgs(instituteId, search, visible));
    }

    @GetMapping("/all-admins")
    public ResponseEntity<SubOrgAdminsResponseDTO> getAllAdminsBySubOrg(
            @RequestParam("subOrgId") String subOrgId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {

        subOrgAccessScopeService.assertNotCrossSubOrg(user, subOrgId);
        SubOrgAdminsResponseDTO response = subOrgLearnerService.getAllAdminsBySubOrg(subOrgId);

        return ResponseEntity.ok(response);
    }

}
