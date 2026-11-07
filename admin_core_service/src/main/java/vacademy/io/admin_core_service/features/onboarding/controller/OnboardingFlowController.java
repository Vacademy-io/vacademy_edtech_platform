package vacademy.io.admin_core_service.features.onboarding.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.onboarding.dto.CreateOnboardingFlowRequest;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingFlowDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.UpdateOnboardingFlowRequest;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingFlow;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingFlowService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingRoleAccessResolutionService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingStepService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;

/**
 * BUILDING a flow stays institute-admin-only -- flows are configuration. READING one does not:
 * a staff role a flow's steps grant (a COUNSELLOR, a custom role) has to be able to see the
 * flow it is expected to work, and the side-view reads a flow's step definitions to know which
 * steps are optional and which assign a course. So create/update/archive keep
 * {@link InstituteAccessValidator#requireAdminAccess}, while the GETs require staff plus an
 * actual grant in that flow. The institute is resolved from the flow entity itself where the
 * request doesn't carry an instituteId param directly (getFlow/updateFlow/archiveFlow).
 */
@RestController
@RequestMapping("/admin-core-service/onboarding/flows")
@RequiredArgsConstructor
public class OnboardingFlowController {

    private final OnboardingFlowService onboardingFlowService;
    private final OnboardingStepService onboardingStepService;
    private final OnboardingRoleAccessResolutionService roleAccessResolutionService;
    private final InstituteAccessValidator instituteAccessValidator;

    @PostMapping
    public ResponseEntity<OnboardingFlowDTO> createFlow(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestBody CreateOnboardingFlowRequest request) {
        instituteAccessValidator.requireAdminAccess(userDetails, instituteId);
        OnboardingFlow flow = onboardingFlowService.createFlow(instituteId, userDetails.getUserId(), request);
        return ResponseEntity.ok(OnboardingFlowDTO.fromEntity(flow));
    }

    @GetMapping
    public ResponseEntity<List<OnboardingFlowDTO>> listFlows(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status) {
        instituteAccessValidator.requireStaffAccess(userDetails, instituteId);
        boolean admin = instituteAccessValidator.isInstituteAdmin(userDetails);
        // Populate `steps` so the flow list's step-count column is accurate -- fromEntity()
        // alone never sets it, since OnboardingFlow itself carries no steps relationship.
        //
        // A non-admin sees only the flows they actually have a grant in, rather than a 403 for
        // the whole list or the institute's entire flow catalogue: this list feeds the
        // "start a flow for this lead" picker, which should offer exactly what they can run.
        List<OnboardingFlowDTO> flows = onboardingFlowService.listFlows(instituteId, status).stream()
                .filter(flow -> admin
                        || roleAccessResolutionService.hasAnyGrantInFlow(userDetails, instituteId, flow.getId()))
                .map(this::toDtoWithSteps).toList();
        return ResponseEntity.ok(flows);
    }

    @GetMapping("/{flowId}")
    public ResponseEntity<OnboardingFlowDTO> getFlow(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId) {
        OnboardingFlow flow = onboardingFlowService.getFlow(flowId);
        requireFlowRead(userDetails, flow);
        return ResponseEntity.ok(toDtoWithSteps(flow));
    }

    @PutMapping("/{flowId}")
    public ResponseEntity<OnboardingFlowDTO> updateFlow(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @RequestBody UpdateOnboardingFlowRequest request) {
        instituteAccessValidator.requireAdminAccess(userDetails, onboardingFlowService.getFlow(flowId).getInstituteId());
        return ResponseEntity.ok(OnboardingFlowDTO.fromEntity(onboardingFlowService.updateFlow(flowId, request)));
    }

    @DeleteMapping("/{flowId}")
    public ResponseEntity<Void> archiveFlow(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId) {
        instituteAccessValidator.requireAdminAccess(userDetails, onboardingFlowService.getFlow(flowId).getInstituteId());
        onboardingFlowService.archiveFlow(flowId);
        return ResponseEntity.noContent().build();
    }

    /** Staff, plus a grant somewhere in this flow. ADMIN always passes. */
    private void requireFlowRead(CustomUserDetails userDetails, OnboardingFlow flow) {
        instituteAccessValidator.requireStaffAccess(userDetails, flow.getInstituteId());
        if (!roleAccessResolutionService.hasAnyGrantInFlow(userDetails, flow.getInstituteId(), flow.getId())) {
            throw new ForbiddenException("Access denied: your role has no access to this onboarding flow");
        }
    }

    private OnboardingFlowDTO toDtoWithSteps(OnboardingFlow flow) {
        OnboardingFlowDTO dto = OnboardingFlowDTO.fromEntity(flow);
        dto.setSteps(onboardingStepService.listSteps(flow.getId()).stream()
                .map(OnboardingStepDTO::fromEntity).toList());
        return dto;
    }
}
