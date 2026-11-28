package vacademy.io.admin_core_service.features.onboarding.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.onboarding.dto.CompleteStepInstanceRequest;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingResolvedFieldDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepInstanceDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingSubmittedFieldDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.SkipStepInstanceRequest;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingInstance;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStepInstance;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingRoleKey;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingInstanceService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingRoleAccessResolutionService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingStepInstanceService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

/**
 * Staff-facing step-instance actions -- every method here previously ran with ZERO institute or
 * role verification: completeStep/skipStep hardcoded the caller as ADMIN regardless of who was
 * actually calling, and getSubmittedValues had no ownership check at all. Any authenticated
 * platform account (any institute, any role) could complete/skip/read another institute's
 * onboarding steps. Every method now resolves the real institute via the step instance's parent
 * onboarding_instance and requires the caller to actually be staff with a grant on that step.
 *
 * <p>The caller is no longer assumed to be an ADMIN. A step's role_access grid may name any
 * institute role (a COUNSELLOR, a custom role), and
 * {@link OnboardingRoleAccessResolutionService#resolveStaffRoleKeyForStep} resolves this caller
 * to the single role they act as on THIS step -- ADMIN if they hold it (ADMIN outranks), else
 * their most permissive granted role, else nothing at all, which is a 403. That resolved role
 * is then what gets passed down, so the per-step and per-field permission checks that already
 * existed for STUDENT/PARENT apply verbatim to staff roles too, rather than being bypassed by a
 * hardcoded ADMIN.
 */
@RestController
@RequestMapping("/admin-core-service/onboarding/step-instances")
@RequiredArgsConstructor
public class OnboardingStepInstanceController {

    private final OnboardingStepInstanceService onboardingStepInstanceService;
    private final OnboardingInstanceService onboardingInstanceService;
    private final OnboardingRoleAccessResolutionService roleAccessResolutionService;
    private final InstituteAccessValidator instituteAccessValidator;

    @PostMapping("/{stepInstanceId}/complete")
    public ResponseEntity<OnboardingStepInstanceDTO> completeStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId,
            @RequestBody CompleteStepInstanceRequest request) {
        String roleKey = requireStepAccess(userDetails, stepInstanceId, true);
        return ResponseEntity.ok(onboardingStepInstanceService.toDto(
                onboardingStepInstanceService.completeStep(stepInstanceId, request.getPayload(),
                        roleKey, userDetails.getUserId())));
    }

    /**
     * Saves whatever fields the caller has filled in WITHOUT requiring every mandatory field on
     * the step and WITHOUT completing/advancing -- e.g. recording a delivery's tracking id and
     * vendor while the step's own "did the student receive it?" field is the student's to fill
     * in later. {@link #completeStep} sees this saved data too, once someone actually completes.
     */
    @PostMapping("/{stepInstanceId}/save")
    public ResponseEntity<OnboardingStepInstanceDTO> saveStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId,
            @RequestBody CompleteStepInstanceRequest request) {
        String roleKey = requireStepAccess(userDetails, stepInstanceId, true);
        return ResponseEntity.ok(onboardingStepInstanceService.toDto(
                onboardingStepInstanceService.saveStepProgress(stepInstanceId, request.getPayload(),
                        roleKey, userDetails.getUserId())));
    }

    /**
     * Skipping bypasses a step outright, so it needs EDIT on the step, not merely view -- a role
     * given read-only visibility into a step must not be able to make it go away.
     */
    @PostMapping("/{stepInstanceId}/skip")
    public ResponseEntity<OnboardingStepInstanceDTO> skipStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId,
            @RequestBody SkipStepInstanceRequest request) {
        requireStepAccess(userDetails, stepInstanceId, true);
        return ResponseEntity.ok(onboardingStepInstanceService.toDto(
                onboardingStepInstanceService.skipStep(stepInstanceId, request.getReason(), userDetails.getUserId())));
    }

    /**
     * This step's fields as the caller's own form should render them: in the step builder's own
     * {@code field_order}, carrying each field's real {@code field_type}/{@code config} (so a
     * dropdown renders as a dropdown, a date as a date picker...), the step's own
     * {@code is_mandatory}, and any value already saved. Resolved for the caller's role, so a
     * non-admin sees only the fields their role may view, each flagged with whether they may
     * edit it.
     *
     * <p>Replaces this form's use of the generic
     * {@code /common/custom-fields/feature-fields?type=ONBOARDING_STEP} lookup, which returns
     * the institute_custom_fields CATALOG row: ordered by the catalog's order rather than the
     * step's, with the catalog row's {@code is_mandatory} (always null for onboarding -- this
     * domain keeps mandatory in fields_config, so every field looked optional while the server
     * still rejected the submit), no honoring of {@code is_hidden}, no role awareness, and
     * nothing the client could use to render anything but a plain text box.
     */
    @GetMapping("/{stepInstanceId}/fields")
    public ResponseEntity<List<OnboardingResolvedFieldDTO>> getFields(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId) {
        String roleKey = requireStepAccess(userDetails, stepInstanceId, false);
        return ResponseEntity.ok(onboardingStepInstanceService.getResolvedFieldsForRole(stepInstanceId, roleKey));
    }

    /**
     * Actual submitted values for a FORM step instance -- previously only field names were
     * viewable. Filtered to the fields the caller's role may view: ADMIN sees everything, a
     * staff role only what its grid entry allows, so "View form" can't become a way around the
     * per-field view permission the form itself honors.
     */
    @GetMapping("/{stepInstanceId}/submitted-values")
    public ResponseEntity<List<OnboardingSubmittedFieldDTO>> getSubmittedValues(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId) {
        String roleKey = requireStepAccess(userDetails, stepInstanceId, false);
        return ResponseEntity.ok(
                onboardingStepInstanceService.getSubmittedFieldValuesForRole(stepInstanceId, roleKey));
    }

    /**
     * Institute membership + staff, then the caller's resolved role on this step. Returns the
     * role key to act as. {@code requireEdit} additionally demands that role hold edit rights
     * somewhere on the step; ADMIN always passes both.
     *
     * <p>Staff (not merely "member of the institute"): {@code requireStaffAccess} refuses a
     * learner/parent principal, who has their own separately-scoped LearnerOnboardingController
     * and must never reach these endpoints by holding a stray authority.
     */
    private String requireStepAccess(CustomUserDetails userDetails, String stepInstanceId, boolean requireEdit) {
        OnboardingStepInstance stepInstance = onboardingStepInstanceService.getStepInstance(stepInstanceId);
        OnboardingInstance instance = onboardingInstanceService.getInstance(stepInstance.getOnboardingInstanceId());
        instituteAccessValidator.requireStaffAccess(userDetails, instance.getInstituteId());

        String roleKey = roleAccessResolutionService.resolveStaffRoleKeyForStep(
                userDetails, instance.getInstituteId(), stepInstance.getStepId());
        if (roleKey == null) {
            throw new ForbiddenException("Access denied: your role has no access to this onboarding step");
        }
        // Same test submitStep already applies before accepting a write, hoisted here so a skip
        // (which has no such guard of its own) is covered and so a view-only role gets a
        // meaningful 403 instead of a generic one.
        if (requireEdit && !OnboardingRoleKey.ADMIN.name().equals(roleKey)
                && !onboardingStepInstanceService.isActionableForRole(
                        onboardingStepInstanceService.getStepDefinition(stepInstance), roleKey)) {
            throw new ForbiddenException("Access denied: your role can view but not edit this onboarding step");
        }
        return roleKey;
    }
}
