package vacademy.io.admin_core_service.features.parent_link.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.parent_link.dto.BackfillSummaryDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.CredentialTemplateConfigDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.NewGuardianLinkRequestDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ParentLinkActionRequestDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ParentLinkActionResponseDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.PendingGuardianStudentDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ShareCredentialsResultDTO;
import vacademy.io.admin_core_service.features.parent_link.service.ParentLinkService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Guardian (parent-student) linking — surfaced to users as "Guardian". Every route keyed by an
 * institute is for staff of that institute.
 * Deliberately separate from {@code AdmissionService}'s existing
 * parent/child creation (which powers the enquiry/application admission
 * form) so that flow is left untouched.
 */
@RestController
@RequestMapping("/admin-core-service/parent-link/v1")
public class ParentLinkController {

    @Autowired
    private ParentLinkService parentLinkService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/parent")
    public ResponseEntity<UserDTO> getParent(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("studentUserId") String studentUserId) {
        return ResponseEntity.ok(parentLinkService.getParentOfStudent(studentUserId));
    }

    @GetMapping("/children")
    public ResponseEntity<List<UserDTO>> getChildren(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("parentUserId") String parentUserId) {
        return ResponseEntity.ok(parentLinkService.getChildrenOfParent(parentUserId));
    }

    @PostMapping("/link")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "CREATE",
            entityIdExpr = "#request.anchorUserId",
            descriptionExpr = "'linked guardian and student (' + #request.direction + ', ' + #request.mode + ')'")
    public ResponseEntity<ParentLinkActionResponseDTO> link(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody ParentLinkActionRequestDTO request) {
        instituteAccessValidator.requireInstituteStaff(userDetails, request == null ? null : request.getInstituteId());
        parentLinkService.requireCanLink(userDetails, request);
        return ResponseEntity.ok(parentLinkService.link(request));
    }

    @PostMapping("/link-new-guardian")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "CREATE",
            entityIdExpr = "#request.instituteId",
            descriptionExpr = "'created a new guardian (' + #request.mode + ')'")
    public ResponseEntity<ParentLinkActionResponseDTO> linkNewGuardian(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody NewGuardianLinkRequestDTO request) {
        instituteAccessValidator.requireInstituteStaff(userDetails, request == null ? null : request.getInstituteId());
        parentLinkService.requireCanLinkNewGuardian(userDetails, request);
        return ResponseEntity.ok(parentLinkService.linkNewGuardian(request));
    }

    @GetMapping("/backfill/pending")
    public ResponseEntity<List<PendingGuardianStudentDTO>> getPendingGuardianStudents(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        return ResponseEntity.ok(parentLinkService.previewPendingGuardians(instituteId));
    }

    @PostMapping("/backfill")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "CREATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'ran guardian backfill for institute'")
    public ResponseEntity<BackfillSummaryDTO> backfill(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        return ResponseEntity.ok(parentLinkService.backfillGuardians(instituteId));
    }

    @GetMapping("/backfill-leads/pending")
    public ResponseEntity<List<PendingGuardianStudentDTO>> getPendingLeadGuardianStudents(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        return ResponseEntity.ok(parentLinkService.previewPendingLeadGuardians(instituteId));
    }

    @PostMapping("/backfill-leads")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "CREATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'ran guardian backfill for institute leads'")
    public ResponseEntity<BackfillSummaryDTO> backfillLeads(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        return ResponseEntity.ok(parentLinkService.backfillLeadGuardians(instituteId));
    }

    /**
     * Explicit "share guardian credentials" action from the student side-view,
     * so a guardian can be onboarded to the Parent Portal after the fact.
     * {@code recipient} optionally overrides the institute's configured
     * STUDENT/GUARDIAN choice for this one send.
     */
    @PostMapping("/share-credentials")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "SHARE_CREDENTIALS",
            entityIdExpr = "#studentUserId",
            descriptionExpr = "'shared guardian credentials'")
    public ResponseEntity<ShareCredentialsResultDTO> shareCredentials(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("studentUserId") String studentUserId,
            @RequestParam(name = "recipient", required = false) String recipient) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        return ResponseEntity.ok(
                parentLinkService.shareGuardianCredentials(instituteId, studentUserId, recipient));
    }

    /**
     * Institute-wide guardian credential export (one row per guardian) for
     * distributing Parent Portal logins — notably for backfilled guardians
     * whose synthetic address can't receive the credential email.
     */
    @GetMapping("/export-credentials")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "EXPORT_CREDENTIALS",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'exported guardian credentials'")
    public ResponseEntity<byte[]> exportCredentials(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        byte[] body = parentLinkService.exportGuardianCredentialsCsv(instituteId)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header("Content-Type", "text/csv; charset=UTF-8")
                .header("Content-Disposition", "attachment; filename=\"guardian-credentials.csv\"")
                .body(body);
    }

    @GetMapping("/credential-template")
    public ResponseEntity<CredentialTemplateConfigDTO> getCredentialTemplate(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        return ResponseEntity.ok(parentLinkService.getCredentialTemplateConfig(instituteId));
    }

    @PostMapping("/credential-template")
    @Auditable(
            entityType = "GUARDIAN_LINK",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'set guardian credential email template'")
    public ResponseEntity<Void> setCredentialTemplate(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId, @RequestParam("templateId") String templateId) {
        instituteAccessValidator.requireInstituteStaff(userDetails, instituteId);
        parentLinkService.setCredentialTemplate(instituteId, templateId);
        return ResponseEntity.ok().build();
    }
}
