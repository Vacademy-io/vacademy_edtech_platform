package vacademy.io.admin_core_service.features.onboarding.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.onboarding.dto.CompleteStepInstanceRequest;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingInstanceDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingResolvedFieldDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingSubmittedStepDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepInstanceDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingInstance;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStepInstance;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingInstanceService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingRoleAccessResolutionService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingStepInstanceService;
import vacademy.io.admin_core_service.features.parent_link.service.ParentLinkService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Learner-app-facing onboarding endpoints. Every endpoint resolves "who is asking" from the
 * JWT -- never accepts an arbitrary subjectUserId param. Two callers are in scope:
 * <ul>
 *     <li>the subject themself (their own account IS subject_user_id or resolved_subject_user_id
 *     on the instance)</li>
 *     <li>a PARENT with their OWN separate auth_service login, linked to the subject via
 *     {@code users.linked_parent_id} -- checked via {@link OnboardingRoleAccessResolutionService#isLinkedGuardianOf}
 *     (a pure DB-relationship check, independent of JWT authorities/institute/enrolment, since
 *     onboarding's own PARENT concept is already resolved from the DB {@code is_parent} flag,
 *     not any JWT claim).</li>
 * </ul>
 * The caller's effective role (STUDENT vs PARENT) is resolved for real from their own
 * auth_service user row, so a parent acting on a child's instance gets PARENT-scoped field
 * access, while the same account acting on their own (if they happen to also be a subject
 * somewhere) gets whatever role applies there.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/learner/onboarding")
@RequiredArgsConstructor
public class LearnerOnboardingController {

    private final OnboardingInstanceService onboardingInstanceService;
    private final OnboardingStepInstanceService onboardingStepInstanceService;
    private final OnboardingRoleAccessResolutionService roleAccessResolutionService;
    private final ParentLinkService parentLinkService;
    private final AuthService authService;

    /**
     * Every onboarding instance the caller can see: their own (as subject or resolved subject)
     * PLUS every linked child's, if the caller is a parent -- so a parent logging into their
     * own learner-app account discovers their child's pending steps instead of seeing nothing.
     */
    @GetMapping("/instances")
    public ResponseEntity<List<OnboardingInstanceDTO>> myInstances(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        UserDTO caller = getCallerUser(userDetails);
        String roleKey = roleAccessResolutionService.resolveRoleKey(false, caller);

        List<String> subjectIds = new ArrayList<>();
        subjectIds.add(userDetails.getUserId());
        if (caller != null && Boolean.TRUE.equals(caller.getIsParent())) {
            // Best-effort widening: a transient auth_service failure here should degrade to
            // "just the caller's own instances" (already added above), not break the whole
            // endpoint for a parent who has every right to at least see that much.
            try {
                for (UserDTO child : parentLinkService.getChildrenOfParent(userDetails.getUserId())) {
                    if (child != null && StringUtils.hasText(child.getId())) {
                        subjectIds.add(child.getId());
                    }
                }
            } catch (Exception e) {
                log.warn("Failed to resolve linked children for parent {}: {}", userDetails.getUserId(), e.getMessage());
            }
        }

        Map<String, OnboardingInstance> visibleById = new LinkedHashMap<>();
        for (String subjectId : subjectIds) {
            for (OnboardingInstance instance : onboardingInstanceService.listBySubject(subjectId, instituteId)) {
                visibleById.putIfAbsent(instance.getId(), instance);
            }
        }

        // Only needed when the caller sees someone else's instance -- either a parent with a
        // separate login viewing an existing child's, or the caller IS the original subject
        // but a later parent-resolution now points the instance at a different real student
        // (getEffectiveSubjectUserId(), not getSubjectUserId() -- subject_user_id never changes,
        // so comparing against it would wrongly treat a resolved instance as still "the caller's
        // own" and never show the resolved child's name).
        // Batch-resolved once for the whole page rather than per instance.
        List<String> otherSubjectIds = visibleById.values().stream()
                .map(OnboardingInstance::getEffectiveSubjectUserId)
                .filter(id -> StringUtils.hasText(id) && !id.equals(userDetails.getUserId()))
                .distinct().toList();
        Map<String, String> nameBySubjectId = Map.of();
        if (!otherSubjectIds.isEmpty()) {
            try {
                nameBySubjectId = authService.getUsersFromAuthServiceByUserIds(otherSubjectIds).stream()
                        .collect(Collectors.toMap(UserDTO::getId, UserDTO::getFullName, (a, b) -> a));
            } catch (Exception e) {
                log.warn("Failed to resolve subject names for parent {}: {}", userDetails.getUserId(), e.getMessage());
            }
        }
        Map<String, String> finalNameBySubjectId = nameBySubjectId;

        List<OnboardingInstanceDTO> instances = visibleById.values().stream()
                .map(instance -> {
                    OnboardingInstanceDTO dto = toDto(instance, roleKey);
                    dto.setSubjectFullName(finalNameBySubjectId.get(instance.getEffectiveSubjectUserId()));
                    return dto;
                }).toList();
        return ResponseEntity.ok(instances);
    }

    @GetMapping("/step-instances/{stepInstanceId}")
    public ResponseEntity<OnboardingStepInstanceDTO> getStepInstance(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId) {
        OnboardingStepInstance stepInstance = onboardingStepInstanceService.getStepInstance(stepInstanceId);
        assertOwnsStepInstance(userDetails, stepInstance);
        String roleKey = resolveCallerRoleKey(userDetails);
        return ResponseEntity.ok(onboardingStepInstanceService.toDtoForRole(stepInstance, roleKey));
    }

    /**
     * This step's fields resolved for the caller's own role -- filtered to only fields they can
     * VIEW, each carrying whether they may EDIT it and its already-submitted value if any. Lets
     * the learner app render editable / read-only / hidden fields correctly, instead of the
     * previous generic feature-fields lookup which showed every field as editable regardless of
     * role.
     */
    @GetMapping("/step-instances/{stepInstanceId}/fields")
    public ResponseEntity<List<OnboardingResolvedFieldDTO>> getResolvedFields(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId) {
        OnboardingStepInstance stepInstance = onboardingStepInstanceService.getStepInstance(stepInstanceId);
        assertOwnsStepInstance(userDetails, stepInstance);
        String roleKey = resolveCallerRoleKey(userDetails);
        return ResponseEntity.ok(onboardingStepInstanceService.getResolvedFieldsForRole(stepInstanceId, roleKey));
    }

    /**
     * Everything the subject filled in on one onboarding instance, step by step -- the backing
     * call for the "my onboarding details" summary, which stays available long after the flow
     * finished. One request for the whole history rather than one per step.
     *
     * <p>Ownership is checked on the INSTANCE here rather than per step-instance: same rule
     * ({@link #assertOwnsStepInstance} resolves the instance anyway), one check instead of N.
     * Field-level VIEW permission is still applied per step inside the service, so a parent or
     * student only ever gets back what their own role may see.
     */
    @GetMapping("/instances/{instanceId}/submitted-steps")
    public ResponseEntity<List<OnboardingSubmittedStepDTO>> getSubmittedSteps(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("instanceId") String instanceId) {
        assertOwnsInstance(userDetails, onboardingInstanceService.getInstance(instanceId));
        return ResponseEntity.ok(onboardingStepInstanceService.getSubmittedStepsForRole(
                instanceId, resolveCallerRoleKey(userDetails)));
    }

    @PostMapping("/step-instances/{stepInstanceId}/submit")
    public ResponseEntity<OnboardingStepInstanceDTO> submitStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId,
            @RequestBody CompleteStepInstanceRequest request) {
        OnboardingStepInstance stepInstance = onboardingStepInstanceService.getStepInstance(stepInstanceId);
        assertOwnsStepInstance(userDetails, stepInstance);
        String roleKey = resolveCallerRoleKey(userDetails);
        return ResponseEntity.ok(onboardingStepInstanceService.toDtoForRole(
                onboardingStepInstanceService.completeStep(stepInstanceId, request.getPayload(),
                        roleKey, userDetails.getUserId()),
                roleKey));
    }

    /**
     * Saves whatever fields the caller has edit access to WITHOUT requiring every mandatory
     * field on the step and WITHOUT completing/advancing -- e.g. the student fills in "did you
     * receive it?" today, but the admin's own tracking-id/vendor fields (or any OTHER field the
     * caller can't edit) don't need to be present yet for this to save.
     */
    @PostMapping("/step-instances/{stepInstanceId}/save")
    public ResponseEntity<OnboardingStepInstanceDTO> saveStep(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @PathVariable("stepInstanceId") String stepInstanceId,
            @RequestBody CompleteStepInstanceRequest request) {
        OnboardingStepInstance stepInstance = onboardingStepInstanceService.getStepInstance(stepInstanceId);
        assertOwnsStepInstance(userDetails, stepInstance);
        String roleKey = resolveCallerRoleKey(userDetails);
        return ResponseEntity.ok(onboardingStepInstanceService.toDtoForRole(
                onboardingStepInstanceService.saveStepProgress(stepInstanceId, request.getPayload(),
                        roleKey, userDetails.getUserId()),
                roleKey));
    }

    /**
     * Allows: the instance's own subject, its resolved subject (once a parent resolution has
     * happened and the real student has their own login), or a parent linked to either of
     * those via {@code users.linked_parent_id}. The guardian check only runs when the direct
     * self-match fails, so the common case (subject acting for themself) costs no extra call.
     */
    private void assertOwnsStepInstance(CustomUserDetails userDetails, OnboardingStepInstance stepInstance) {
        assertOwnsInstance(userDetails, onboardingInstanceService.getInstance(stepInstance.getOnboardingInstanceId()));
    }

    /** The ownership rule itself: the subject, the resolved subject, or either one's linked guardian. */
    private void assertOwnsInstance(CustomUserDetails userDetails, OnboardingInstance instance) {
        String callerId = userDetails.getUserId();
        boolean owns = callerId.equals(instance.getSubjectUserId())
                || callerId.equals(instance.getResolvedSubjectUserId())
                || roleAccessResolutionService.isLinkedGuardianOf(callerId, instance.getSubjectUserId())
                || (StringUtils.hasText(instance.getResolvedSubjectUserId())
                    && roleAccessResolutionService.isLinkedGuardianOf(callerId, instance.getResolvedSubjectUserId()));
        if (!owns) {
            throw new ForbiddenException("Not authorized to access this onboarding step");
        }
    }

    private UserDTO getCallerUser(CustomUserDetails userDetails) {
        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userDetails.getUserId()));
        return users.isEmpty() ? null : users.get(0);
    }

    /**
     * STUDENT vs PARENT, resolved for real from the caller's own auth_service user row
     * (is_parent) via {@link OnboardingRoleAccessResolutionService#resolveRoleKey} -- not
     * hardcoded. A caller not found in auth_service (shouldn't happen for an authenticated
     * JWT) safely falls back to STUDENT, the more restrictive of the two non-admin roles.
     */
    private String resolveCallerRoleKey(CustomUserDetails userDetails) {
        return roleAccessResolutionService.resolveRoleKey(false, getCallerUser(userDetails));
    }

    private OnboardingInstanceDTO toDto(OnboardingInstance instance, String roleKey) {
        OnboardingInstanceDTO dto = OnboardingInstanceDTO.fromEntity(instance);
        dto.setStepInstances(onboardingStepInstanceService.toDtosForRole(
                onboardingStepInstanceService.listStepInstances(instance.getId()), roleKey));
        return dto;
    }
}
