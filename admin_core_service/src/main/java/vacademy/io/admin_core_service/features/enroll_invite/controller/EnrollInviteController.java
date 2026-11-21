package vacademy.io.admin_core_service.features.enroll_invite.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.enroll_invite.dto.AssignCpoToPackageSessionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteFilterDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteListItemDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.UpdateEnrollInvitePackageSessionPaymentOptionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/enroll-invite")
public class EnrollInviteController {
    @Autowired
    private EnrollInviteService enrollInviteService;

    @Autowired
    private PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;

    // `user` is optional on the three mutations below on purpose: it only feeds
    // created_by / updated_by, and a caller without the JWT attribute must keep
    // getting the same response it always did, not a 400.
    @PostMapping
    @Auditable(
            entityType = "ENROLL_INVITE",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created invite link ' + #enrollInviteDTO?.name")
    public ResponseEntity<String> createEnrollInvite(@RequestBody EnrollInviteDTO enrollInviteDTO,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        return ResponseEntity.ok(enrollInviteService.createEnrollInvite(enrollInviteDTO, user));
    }

    @PostMapping("/get-enroll-invite")
    public ResponseEntity<Page<EnrollInviteListItemDTO>> getEnrollInvite(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(name = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(name = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize,
            @RequestBody EnrollInviteFilterDTO enrollInviteFilterDTO,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(enrollInviteService.getEnrollInvitesByInstituteIdAndFilters(instituteId,
                enrollInviteFilterDTO, pageNo, pageSize, user));
    }

    @PostMapping("/by-referral-option-ids")
    public ResponseEntity<List<EnrollInviteDTO>> getByReferralOptionIds(
            @RequestParam("instituteId") String instituteId,
            @RequestBody List<String> referralOptionIds) {
        return ResponseEntity
                .ok(enrollInviteService.findEnrollInvitesByReferralOptionIds(referralOptionIds, instituteId));
    }

    @GetMapping("/{instituteId}/{enrollInviteId}")
    public ResponseEntity<EnrollInviteDTO> getEnrollInvite(@PathVariable("instituteId") String instituteId,
            @PathVariable("enrollInviteId") String enrollInviteId) {
        return ResponseEntity.ok(enrollInviteService.findByEnrollInviteId(enrollInviteId, instituteId));
    }

    @GetMapping("/default/{instituteId}/{packageSessionId}")
    public ResponseEntity<EnrollInviteDTO> getDefaultEnrollInvite(@PathVariable("instituteId") String instituteId,
            @PathVariable("packageSessionId") String packageSessionId) {
        return ResponseEntity
                .ok(enrollInviteService.findDefaultEnrollInviteByPackageSessionId(packageSessionId, instituteId));
    }

    @PutMapping("/update-default-enroll-invite-config")
    @Auditable(
            entityType = "ENROLL_INVITE",
            action = "MAKE_DEFAULT",
            entityIdExpr = "#enrollInviteId",
            descriptionExpr = "'made invite link ' + @enrollInviteService.auditName(#enrollInviteId)"
                    + " + ' the default for ' + (@auditNarrator.coursesFor({#packageSessionId}) ?: 'its batch')")
    public ResponseEntity<String> updateDefaultEnrollInviteConfig(@RequestParam("enrollInviteId") String enrollInviteId,
            @RequestParam("packageSessionId") String packageSessionId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        return ResponseEntity.ok(
                enrollInviteService.updateDefaultEnrollInviteConfig(enrollInviteId, packageSessionId, user));
    }

    @PostMapping("/get-by-payment-option-ids")
    public ResponseEntity<List<EnrollInviteDTO>> getByPaymentOptionIds(
            @RequestParam("instituteId") String instituteId,
            @RequestBody List<String> paymentOptionIds) {
        return ResponseEntity.ok(enrollInviteService.findByPaymentOptionIds(paymentOptionIds, instituteId));
    }

    @DeleteMapping("/enroll-invites")
    @Auditable(
            entityType = "ENROLL_INVITE",
            action = "DELETE",
            entityIdExpr = "T(java.lang.String).join(',', #enrollInviteIds)",
            // Names must be read before the service soft-deletes the rows; the
            // label is computed in the description (not captureBefore) because
            // auditLabel already does its own lookup and never throws.
            descriptionExpr = "'deleted ' + (@enrollInviteService.auditLabel(#enrollInviteIds) ?: 'invite link(s)')")
    public ResponseEntity<String> deleteEnrollInvites(@RequestBody List<String> enrollInviteIds) {
        return ResponseEntity.ok(enrollInviteService.deleteEnrollInvites(enrollInviteIds));
    }

    // public, not private: Spring MVC will happily dispatch to a private handler,
    // but the AOP proxy behind @Auditable cannot intercept one, so the row would
    // silently never be written.
    @PutMapping("/enroll-invite-payment-option")
    @Auditable(
            entityType = "ENROLL_INVITE",
            action = "UPDATE",
            entityIdExpr = "T(java.lang.String).join(',', #updateEnrollInvitePackageSessionPaymentOptionDTO.![enrollInviteId])",
            descriptionExpr = "'updated payment plans of ' + (@enrollInviteService.auditLabel("
                    + "#updateEnrollInvitePackageSessionPaymentOptionDTO.![enrollInviteId]) ?: 'invite link(s)')")
    public ResponseEntity<String> updateEnrollInvitePaymentOption(
            @RequestBody List<UpdateEnrollInvitePackageSessionPaymentOptionDTO> updateEnrollInvitePackageSessionPaymentOptionDTO) {
        return ResponseEntity.ok(
                enrollInviteService.updatePaymentOptionsForInvites(updateEnrollInvitePackageSessionPaymentOptionDTO));
    }

    @PutMapping("/enroll-invite")
    @Auditable(
            entityType = "ENROLL_INVITE",
            action = "UPDATE",
            captureBefore = "@enrollInviteService.auditSnapshot(#enrollInviteDTO?.id)",
            entityIdExpr = "#enrollInviteDTO?.id",
            descriptionExpr = "'updated invite link ' + (#enrollInviteDTO?.name ?: #enrollInviteDTO?.id)")
    public ResponseEntity<String> updateEnrollInvite(@RequestBody EnrollInviteDTO enrollInviteDTO,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        return ResponseEntity.ok(enrollInviteService.updateEnrollInvite(enrollInviteDTO, user));
    }

    @GetMapping("/by-user-and-institute")
    public ResponseEntity<List<EnrollInviteDTO>> getEnrollInvitesByUserIdAndInstituteId(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {

        List<EnrollInviteDTO> enrollInvites = enrollInviteService
                .getEnrollInvitesByUserIdAndInstituteId(user.getUserId(), instituteId);

        return ResponseEntity.ok(enrollInvites);
    }

    @PutMapping("/{enrollInviteId}/assign-cpo")
    @Auditable(
            entityType = "ENROLL_INVITE",
            action = "ASSIGN",
            entityIdExpr = "#enrollInviteId",
            descriptionExpr = "'assigned fee plan to invite link ' + @enrollInviteService.auditName(#enrollInviteId)"
                    + " + ' for ' + (@auditNarrator.coursesFor({#request?.packageSessionId}) ?: 'its batch')")
    public ResponseEntity<Void> assignCpoToPackageSession(
            @PathVariable("enrollInviteId") String enrollInviteId,
            @RequestBody AssignCpoToPackageSessionDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        packageSessionEnrollInviteToPaymentOptionService
                .assignCpoToPackageSession(enrollInviteId, request);
        return ResponseEntity.noContent().build();
    }
}
