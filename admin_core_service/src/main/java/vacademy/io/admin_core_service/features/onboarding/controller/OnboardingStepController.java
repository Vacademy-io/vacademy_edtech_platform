package vacademy.io.admin_core_service.features.onboarding.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepTriggerDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.ReorderStepsRequest;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingFlow;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStep;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingFlowService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingRoleAccessResolutionService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingStepService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingStepWorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Map;

/**
 * Editing steps is institute-admin-only; LISTING them is not -- the student side-view reads a
 * flow's step definitions to know which steps are optional and which assign a course, and a
 * staff role granted a step has to be able to load that. So {@link #listSteps} requires staff
 * plus a grant in the flow, and everything else stays admin-only.
 *
 * <p>Institute is always resolved from the FLOW
 * entity itself (via {@code flowId}, which every route under this controller carries in its
 * path) rather than trusted from any client-supplied instituteId param -- a caller who is a
 * genuine admin of their OWN institute could otherwise pass someone else's flowId/stepId
 * alongside their own instituteId and operate on a different institute's data.
 */
@RestController
@RequestMapping("/admin-core-service/onboarding/flows/{flowId}/steps")
@RequiredArgsConstructor
public class OnboardingStepController {

    private final OnboardingStepService onboardingStepService;
    private final OnboardingFlowService onboardingFlowService;
    private final OnboardingStepWorkflowTriggerService onboardingStepWorkflowTriggerService;
    private final OnboardingRoleAccessResolutionService roleAccessResolutionService;
    private final InstituteAccessValidator instituteAccessValidator;

    @PostMapping
    public ResponseEntity<OnboardingStepDTO> createStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @RequestBody OnboardingStepDTO request) {
        OnboardingFlow flow = requireAdminForFlow(userDetails, flowId);
        return ResponseEntity.ok(OnboardingStepDTO.fromEntity(
                onboardingStepService.createStep(flow.getInstituteId(), flowId, request)));
    }

    @GetMapping
    public ResponseEntity<List<OnboardingStepDTO>> listSteps(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId) {
        OnboardingFlow flow = onboardingFlowService.getFlow(flowId);
        instituteAccessValidator.requireStaffAccess(userDetails, flow.getInstituteId());
        if (!roleAccessResolutionService.hasAnyGrantInFlow(userDetails, flow.getInstituteId(), flowId)) {
            throw new ForbiddenException("Access denied: your role has no access to this onboarding flow");
        }
        List<OnboardingStepDTO> steps = onboardingStepService.listSteps(flowId).stream()
                .map(OnboardingStepDTO::fromEntity).toList();
        return ResponseEntity.ok(steps);
    }

    @PutMapping("/{stepId}")
    public ResponseEntity<OnboardingStepDTO> updateStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @PathVariable("stepId") String stepId,
            @RequestBody OnboardingStepDTO request) {
        OnboardingFlow flow = requireAdminForStep(userDetails, flowId, stepId);
        return ResponseEntity.ok(OnboardingStepDTO.fromEntity(
                onboardingStepService.updateStep(flow.getInstituteId(), stepId, request)));
    }

    @DeleteMapping("/{stepId}")
    public ResponseEntity<Void> deleteStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @PathVariable("stepId") String stepId) {
        requireAdminForStep(userDetails, flowId, stepId);
        onboardingStepService.deleteStep(stepId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/reorder")
    public ResponseEntity<Void> reorderSteps(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @RequestBody ReorderStepsRequest request) {
        OnboardingFlow flow = requireAdminForFlow(userDetails, flowId);
        if (request != null && request.getSteps() != null) {
            for (ReorderStepsRequest.StepOrderEntry entry : request.getSteps()) {
                OnboardingStep step = onboardingStepService.getStep(entry.getStepId());
                if (!flowId.equals(step.getFlowId())) {
                    // Prevents smuggling a foreign step id into an otherwise-legitimate reorder
                    // request for a flow the caller genuinely admins.
                    throw new InvalidRequestException("Step " + entry.getStepId() + " does not belong to flow " + flowId);
                }
            }
        }
        onboardingStepService.reorderSteps(request);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{stepId}/workflow-triggers")
    public ResponseEntity<List<OnboardingStepTriggerDTO>> getStepWorkflowTriggers(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @PathVariable("stepId") String stepId) {
        requireAdminForStep(userDetails, flowId, stepId);
        return ResponseEntity.ok(onboardingStepWorkflowTriggerService.getStepWorkflowTriggers(stepId));
    }

    @PostMapping("/{stepId}/workflow-triggers")
    public ResponseEntity<Map<String, Object>> saveStepWorkflowTriggers(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("flowId") String flowId,
            @PathVariable("stepId") String stepId,
            @RequestBody List<OnboardingStepTriggerDTO> triggers) {
        OnboardingFlow flow = requireAdminForStep(userDetails, flowId, stepId);
        return ResponseEntity.ok(
                onboardingStepWorkflowTriggerService.saveStepWorkflowTriggers(flow.getInstituteId(), stepId, triggers));
    }

    private OnboardingFlow requireAdminForFlow(CustomUserDetails userDetails, String flowId) {
        OnboardingFlow flow = onboardingFlowService.getFlow(flowId);
        instituteAccessValidator.requireAdminAccess(userDetails, flow.getInstituteId());
        return flow;
    }

    private OnboardingFlow requireAdminForStep(CustomUserDetails userDetails, String flowId, String stepId) {
        OnboardingStep step = onboardingStepService.getStep(stepId);
        if (!flowId.equals(step.getFlowId())) {
            throw new InvalidRequestException("Step " + stepId + " does not belong to flow " + flowId);
        }
        return requireAdminForFlow(userDetails, flowId);
    }
}
