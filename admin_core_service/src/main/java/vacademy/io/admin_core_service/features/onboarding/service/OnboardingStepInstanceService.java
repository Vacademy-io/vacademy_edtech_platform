package vacademy.io.admin_core_service.features.onboarding.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldValueSourceTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingResolvedFieldDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepFieldConfigDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepInstanceDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingSubmittedFieldDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingSubmittedStepDTO;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingInstance;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStep;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStepInstance;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingRoleKey;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingStepInstanceStatus;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingInstanceRepository;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingStepInstanceRepository;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingStepRepository;
import vacademy.io.admin_core_service.features.onboarding.steptype.OnboardingStepTypeHandler;
import vacademy.io.admin_core_service.features.onboarding.steptype.OnboardingStepTypeHandlerRegistry;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Advances a single onboarding_step_instance through PENDING -> IN_PROGRESS -> COMPLETED/SKIPPED,
 * dispatching to the step-type handler and firing per-step workflow triggers along the way.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OnboardingStepInstanceService {

    private final OnboardingStepInstanceRepository stepInstanceRepository;
    private final OnboardingInstanceRepository onboardingInstanceRepository;
    private final OnboardingStepRepository onboardingStepRepository;
    private final OnboardingStepTypeHandlerRegistry stepTypeHandlerRegistry;
    private final OnboardingTriggerContextBuilder triggerContextBuilder;
    private final AuthService authService;
    private final InstituteCustomFieldRepository instituteCustomFieldRepository;
    private final CustomFieldRepository customFieldRepository;
    private final CustomFieldValuesRepository customFieldValuesRepository;
    private final OnboardingStudentCreationService onboardingStudentCreationService;
    private final OnboardingRoleAccessResolutionService roleAccessResolutionService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final String AUTO_COMPLETE_ACTOR = "SYSTEM_AUTO";

    /**
     * @Lazy breaks the same init-time bean cycle CallAiNodeHandler/SetLeadStatusNodeHandler guard
     * against: this service -> WorkflowTriggerService -> WorkflowEngineService -> NodeHandlerRegistry
     * -> StartOnboardingFlowNodeHandler -> OnboardingInstanceService -> this service.
     */
    @Autowired
    @Lazy
    private WorkflowTriggerService workflowTriggerService;

    /** Creates (or reuses) the PENDING step-instance row for `step` and moves it to IN_PROGRESS. */
    @Transactional
    public OnboardingStepInstance enterStep(OnboardingInstance instance, OnboardingStep step) {
        OnboardingStepInstance stepInstance = stepInstanceRepository
                .findByOnboardingInstanceIdAndStepId(instance.getId(), step.getId())
                .orElseGet(() -> OnboardingStepInstance.builder()
                        .onboardingInstanceId(instance.getId())
                        .stepId(step.getId())
                        .status(OnboardingStepInstanceStatus.PENDING.name())
                        .build());

        stepInstance.setStatus(OnboardingStepInstanceStatus.IN_PROGRESS.name());
        stepInstance.setEnteredAt(new Date());
        OnboardingStepInstance savedStepInstance = stepInstanceRepository.save(stepInstance);

        instance.setCurrentStepId(step.getId());
        onboardingInstanceRepository.save(instance);

        OnboardingStepTypeHandler handler = stepTypeHandlerRegistry.getHandler(step.getStepType());
        if (handler != null) {
            try {
                handler.onEnter(savedStepInstance, step);
            } catch (Exception e) {
                log.warn("onEnter failed for step {} (stepInstance {}): {}", step.getId(), savedStepInstance.getId(), e.getMessage());
            }
        }

        fireTrigger(instance, step, WorkflowTriggerEvent.ONBOARDING_STEP_ENTERED);
        return tryAutoCompleteOnEntry(step, savedStepInstance);
    }

    /**
     * The "assign course" step's skip-course-selection setting means "this step has nothing
     * left to do for a subject who's already enrolled" -- so rather than making an admin open
     * the step and hit Complete with an empty course picker just to get past it, complete it
     * immediately on entry. Reuses the normal completion path (not a shortcut) so any OTHER
     * mandatory field on the same step still blocks it exactly as a manual completion would --
     * if that happens, this simply leaves the step IN_PROGRESS for a human to finish, same as if
     * auto-complete had never been attempted.
     */
    private OnboardingStepInstance tryAutoCompleteOnEntry(OnboardingStep step, OnboardingStepInstance stepInstance) {
        if (!isCreateStudentConfigured(step) || !skipCourseSelectionIfAlreadyEnrolled(step)) {
            return stepInstance;
        }
        if (!onboardingStudentCreationService.subjectAlreadyHasActiveEnrollment(stepInstance)) {
            return stepInstance;
        }
        try {
            return submitStep(stepInstance.getId(), Map.of(), OnboardingRoleKey.ADMIN.name(), AUTO_COMPLETE_ACTOR, true);
        } catch (Exception e) {
            log.info("Could not auto-complete step {} (stepInstance {}) on entry despite an existing enrollment: {}",
                    step.getId(), stepInstance.getId(), e.getMessage());
            return stepInstance;
        }
    }

    @Transactional
    public OnboardingStepInstance completeStep(String stepInstanceId, Map<String, Object> payload,
                                                String actorRoleKey, String actorUserId) {
        return submitStep(stepInstanceId, payload, actorRoleKey, actorUserId, true);
    }

    /**
     * Persists whatever fields the caller has edit access to WITHOUT requiring every mandatory
     * field on the step to be present, and WITHOUT completing/advancing -- the step-instance
     * status is left exactly as it was. For a step whose fields span multiple roles (e.g. an
     * admin records a delivery's tracking id/vendor while the step's own "did you receive it?"
     * field is the student's to fill in later), each side can save their own part independently.
     * Whoever eventually calls {@link #completeStep} triggers the real mandatory check, which
     * sees every value saved so far (this call's and everyone else's), not just its own payload.
     */
    @Transactional
    public OnboardingStepInstance saveStepProgress(String stepInstanceId, Map<String, Object> payload,
                                                    String actorRoleKey, String actorUserId) {
        return submitStep(stepInstanceId, payload, actorRoleKey, actorUserId, false);
    }

    private OnboardingStepInstance submitStep(String stepInstanceId, Map<String, Object> payload,
                                               String actorRoleKey, String actorUserId, boolean requireComplete) {
        OnboardingStepInstance stepInstance = getStepInstance(stepInstanceId);
        OnboardingStep step = onboardingStepRepository.findById(stepInstance.getStepId())
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding step not found: " + stepInstance.getStepId()));

        boolean alreadyFinalized = OnboardingStepInstanceStatus.COMPLETED.name().equals(stepInstance.getStatus())
                || OnboardingStepInstanceStatus.SKIPPED.name().equals(stepInstance.getStatus());
        if (alreadyFinalized) {
            if (!requireComplete) {
                // A "save" (unlike "complete") is never itself a repeat of a prior call the
                // client already saw succeed -- so silently discarding it here (as the
                // idempotent-no-op path below does for completeStep) would report fake success
                // for input that was actually never persisted. Surface it as a real error instead
                // of a silent no-op, so the caller doesn't think their edit was saved when it
                // wasn't (e.g. another actor completed/skipped this step in between).
                throw new InvalidRequestException(
                        "This step is already " + stepInstance.getStatus().toLowerCase() + " -- nothing more can be saved on it.");
            }
            // Idempotent no-op on a step already finalized -- a double-click, client retry, or
            // replayed request must not re-run side effects (credentials email isn't itself
            // idempotent, and re-advancing would regress an already-COMPLETED next step back to
            // IN_PROGRESS and re-fire its ONBOARDING_STEP_ENTERED trigger).
            return stepInstance;
        }

        OnboardingInstance instance = onboardingInstanceRepository.findById(stepInstance.getOnboardingInstanceId())
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding instance not found: " + stepInstance.getOnboardingInstanceId()));

        boolean requestsParentResolution = payload != null
                && "true".equalsIgnoreCase(String.valueOf(payload.get("is_parent")));

        // A step that assigns a course, that resolves "filled by a parent" into a brand-new user
        // account, or whose role_access denies this role edit permission, is not something an
        // arbitrary caller may act on -- otherwise a caller could either enroll themselves in
        // any course (empty pool), create arbitrary new accounts under themselves-as-parent with
        // zero oversight, or save/complete a step an admin explicitly locked away from them via
        // role_access. Applies to a partial save too, not just complete -- there's no legitimate
        // reason to write into a step you have no editable field on anyway.
        //
        // The bar is "actionable for this role", NOT "is an admin": a staff role the flow
        // builder granted edit on this step (a COUNSELLOR, a custom role) is meant to work it.
        // Only the parent-resolution path stays admin-only, since that one mints a real user
        // account off free-text name/email in the payload.
        if (!OnboardingRoleKey.ADMIN.name().equals(actorRoleKey)
                && (requestsParentResolution || !isActionableForRole(step, actorRoleKey))) {
            throw new ForbiddenException(requestsParentResolution
                    ? "Filling this step in on a parent's behalf must be done by an admin."
                    : "Your role does not have edit access to this onboarding step.");
        }

        // Leads can be filled out by either the student or a parent on their behalf. Resolve
        // that BEFORE any identity-touching side effect -- role grant, credentials, or course
        // enrollment can each live on their own, independent step, so this can't be scoped to
        // just the create_student step. Once resolved, instance.subjectUserId is reassigned to
        // the real student for the rest of this completion AND every later step (same managed
        // entity within this transaction, visible to applyCompletionSideEffects below and to
        // FormStepTypeHandler's own instance lookup).
        boolean touchesIdentity = Boolean.TRUE.equals(step.getGrantsStudentRole())
                || Boolean.TRUE.equals(step.getSendsLoginCredentials())
                || isCreateStudentConfigured(step);
        if (touchesIdentity && requestsParentResolution) {
            onboardingStudentCreationService.resolveSubjectUserId(instance, true,
                    readPayloadString(payload, "student_full_name"),
                    readPayloadString(payload, "student_email"),
                    readPayloadString(payload, "student_mobile_number"));
        }

        OnboardingStepTypeHandler handler = stepTypeHandlerRegistry.getHandler(step.getStepType());
        OnboardingStepInstanceStatus resultStatus = handler != null
                ? handler.onSubmit(stepInstance, step, payload, actorRoleKey, actorUserId, requireComplete)
                : (requireComplete ? OnboardingStepInstanceStatus.COMPLETED : OnboardingStepInstanceStatus.IN_PROGRESS);

        stepInstance.setStatus(resultStatus.name());
        if (resultStatus == OnboardingStepInstanceStatus.COMPLETED) {
            stepInstance.setCompletedAt(new Date());
            stepInstance.setCompletedByUserId(actorUserId);
            stepInstance.setCompletedByRole(actorRoleKey);
        }
        OnboardingStepInstance savedStepInstance = stepInstanceRepository.save(stepInstance);

        if (resultStatus != OnboardingStepInstanceStatus.COMPLETED) {
            // Covers BOTH a genuine partial save AND a failed complete attempt (some other
            // role's mandatory field is still missing) -- either way, nothing to advance yet.
            return savedStepInstance;
        }

        applyCompletionSideEffects(instance, step);
        fireTrigger(instance, step, WorkflowTriggerEvent.ONBOARDING_STEP_COMPLETED);
        advanceToNextStep(instance, step);
        return savedStepInstance;
    }

    @Transactional
    public OnboardingStepInstance skipStep(String stepInstanceId, String reason, String actorUserId) {
        OnboardingStepInstance stepInstance = getStepInstance(stepInstanceId);

        // Idempotent no-op on a step already finalized -- see completeStep for why (double-click /
        // retry must not re-fire triggers or re-advance an already-COMPLETED next step).
        if (OnboardingStepInstanceStatus.COMPLETED.name().equals(stepInstance.getStatus())
                || OnboardingStepInstanceStatus.SKIPPED.name().equals(stepInstance.getStatus())) {
            return stepInstance;
        }

        OnboardingStep step = onboardingStepRepository.findById(stepInstance.getStepId())
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding step not found: " + stepInstance.getStepId()));
        if (!Boolean.TRUE.equals(step.getIsOptional())) {
            // InvalidRequestException -> 400 via GlobalExceptionHandler; see FormStepTypeHandler
            // for the same fix on the mandatory-field-validation path.
            throw new InvalidRequestException("Step is not optional and cannot be skipped: " + step.getId());
        }
        OnboardingInstance instance = onboardingInstanceRepository.findById(stepInstance.getOnboardingInstanceId())
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding instance not found: " + stepInstance.getOnboardingInstanceId()));

        stepInstance.setStatus(OnboardingStepInstanceStatus.SKIPPED.name());
        stepInstance.setSkipReason(reason);
        stepInstance.setCompletedAt(new Date());
        stepInstance.setCompletedByUserId(actorUserId);
        stepInstance.setCompletedByRole(OnboardingRoleKey.ADMIN.name());
        OnboardingStepInstance savedStepInstance = stepInstanceRepository.save(stepInstance);

        fireTrigger(instance, step, WorkflowTriggerEvent.ONBOARDING_STEP_SKIPPED);
        advanceToNextStep(instance, step);
        return savedStepInstance;
    }

    private void applyCompletionSideEffects(OnboardingInstance instance, OnboardingStep step) {
        String targetUserId = instance.getEffectiveSubjectUserId();
        if (Boolean.TRUE.equals(step.getGrantsStudentRole())) {
            authService.addRolesToUserInternal(targetUserId, List.of("STUDENT"), instance.getInstituteId());
        }
        if (Boolean.TRUE.equals(step.getSendsLoginCredentials())) {
            // auth_service's send-passwords path is email-only and silently skips (no exception,
            // no log) any user missing an email -- which a parent-resolved child can easily be,
            // since resolveSubjectUserId only requires email OR mobile. Without this pre-check
            // that skip is completely invisible; log it here so it's at least diagnosable.
            List<UserDTO> targetUsers = authService.getUsersFromAuthServiceByUserIds(List.of(targetUserId));
            UserDTO targetUser = targetUsers.isEmpty() ? null : targetUsers.get(0);
            if (targetUser == null || !StringUtils.hasText(targetUser.getEmail())) {
                log.warn("Onboarding step {} completed with sends_login_credentials=true for user {}, " +
                                "but that user has no email on file -- credentials email will NOT be delivered " +
                                "(the platform has no SMS credential-delivery path).",
                        step.getId(), targetUserId);
            }
            try {
                authService.sendCredToUsers(List.of(targetUserId));
            } catch (Exception e) {
                log.warn("Failed to send login credentials to {} for onboarding step {}: {}",
                        targetUserId, step.getId(), e.getMessage());
            }
        }
    }

    private void advanceToNextStep(OnboardingInstance instance, OnboardingStep completedOrSkippedStep) {
        Optional<OnboardingStep> next = onboardingStepRepository
                .findFirstByFlowIdAndStatusAndStepOrderGreaterThanOrderByStepOrderAsc(
                        instance.getFlowId(), "ACTIVE", completedOrSkippedStep.getStepOrder());
        if (next.isPresent()) {
            enterStep(instance, next.get());
        } else {
            instance.setStatus("COMPLETED");
            instance.setCompletedAt(new Date());
            instance.setCurrentStepId(null);
            onboardingInstanceRepository.save(instance);
            try {
                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.ONBOARDING_FLOW_COMPLETED.name(),
                        instance.getFlowId(),
                        instance.getInstituteId(),
                        triggerContextBuilder.forFlowChange(instance, "COMPLETED"));
            } catch (Exception e) {
                log.warn("Failed to fire ONBOARDING_FLOW_COMPLETED for instance {}: {}", instance.getId(), e.getMessage());
            }
        }
    }

    private void fireTrigger(OnboardingInstance instance, OnboardingStep step, WorkflowTriggerEvent event) {
        try {
            workflowTriggerService.handleTriggerEvents(
                    event.name(),
                    step.getId(),
                    instance.getInstituteId(),
                    triggerContextBuilder.forStepChange(instance, step, event.name()));
        } catch (Exception e) {
            log.warn("Failed to fire {} for step {} (instance {}): {}",
                    event.name(), step.getId(), instance.getId(), e.getMessage());
        }
    }

    public OnboardingStepInstance getStepInstance(String stepInstanceId) {
        return stepInstanceRepository.findById(stepInstanceId)
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding step instance not found: " + stepInstanceId));
    }

    public List<OnboardingStepInstance> listStepInstances(String onboardingInstanceId) {
        return stepInstanceRepository.findByOnboardingInstanceId(onboardingInstanceId);
    }

    /** Enriches a single step instance with its step's name/type -- prefer this over the bare DTO mapper. */
    public OnboardingStepInstanceDTO toDto(OnboardingStepInstance stepInstance) {
        OnboardingStep step = onboardingStepRepository.findById(stepInstance.getStepId()).orElse(null);
        return OnboardingStepInstanceDTO.fromEntity(stepInstance, step);
    }

    /** Batch variant of {@link #toDto} -- one step lookup query regardless of list size. */
    public List<OnboardingStepInstanceDTO> toDtos(List<OnboardingStepInstance> stepInstances) {
        if (stepInstances.isEmpty()) return List.of();
        Map<String, OnboardingStep> stepsById = onboardingStepRepository
                .findAllById(stepInstances.stream().map(OnboardingStepInstance::getStepId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(OnboardingStep::getId, s -> s));
        return stepInstances.stream()
                .map(si -> OnboardingStepInstanceDTO.fromEntity(si, stepsById.get(si.getStepId())))
                .toList();
    }

    /** Learner-facing variant of {@link #toDto}: also sets learner_can_act for {@code roleKey}. */
    public OnboardingStepInstanceDTO toDtoForRole(OnboardingStepInstance stepInstance, String roleKey) {
        OnboardingStep step = onboardingStepRepository.findById(stepInstance.getStepId()).orElse(null);
        OnboardingStepInstanceDTO dto = OnboardingStepInstanceDTO.fromEntity(stepInstance, step);
        if (step != null) {
            dto.setLearnerCanAct(isActionableForRole(step, roleKey));
        }
        return dto;
    }

    /** Learner-facing variant of {@link #toDtos}: also sets learner_can_act for {@code roleKey} on every step. */
    public List<OnboardingStepInstanceDTO> toDtosForRole(List<OnboardingStepInstance> stepInstances, String roleKey) {
        if (stepInstances.isEmpty()) return List.of();
        Map<String, OnboardingStep> stepsById = onboardingStepRepository
                .findAllById(stepInstances.stream().map(OnboardingStepInstance::getStepId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(OnboardingStep::getId, s -> s));
        return stepInstances.stream()
                .map(si -> {
                    OnboardingStep step = stepsById.get(si.getStepId());
                    OnboardingStepInstanceDTO dto = OnboardingStepInstanceDTO.fromEntity(si, step);
                    if (step != null) {
                        dto.setLearnerCanAct(isActionableForRole(step, roleKey));
                    }
                    return dto;
                })
                .toList();
    }

    /**
     * Whether a caller acting as {@code roleKey} can actually act on this step. {@code roleKey}
     * is STUDENT/PARENT on the learner surface, or -- on the staff surface -- whichever institute
     * role {@code OnboardingRoleAccessResolutionService.resolveStaffRoleKeyForStep} resolved the
     * caller to. False for a create_student-configured step on the LEARNER side only (see the
     * first check below); otherwise true only if there's actually something this role may
     * DO on the step: either it has no attached fields and the step-level default itself grants
     * edit (a plain "read this, click complete" step), or at least one attached field resolves
     * editable for this role. Deliberately checks per-FIELD access (not just the step-level
     * default) so an admin who left the step-level default at STUDENT/PARENT can_edit=false but
     * explicitly granted edit on specific fields isn't wrongly locked out -- per
     * {@link OnboardingRoleAccessResolutionService}'s own contract, "a field-level entry (if
     * present) overrides the step-level default", so actionability has to honor that same
     * override, not just the fallback. Used both to decide whether the
     * learner app should block on this step (e.g. gate the dashboard) or let the learner through
     * as "waiting on an admin", AND to enforce server-side in {@link #completeStep} that a
     * non-admin can't complete a step with nothing they're actually permitted to submit.
     */
    public boolean isActionableForRole(OnboardingStep step, String roleKey) {
        // A create_student step assigns a course and can mint an account, so it is closed to the
        // LEARNER side -- otherwise a lead could enroll themselves in any course (empty pool).
        // It is not closed to staff: a counsellor explicitly granted edit on the step is exactly
        // who is meant to enroll their lead. ADMIN is staff too and never reaches here anyway
        // (every caller short-circuits on ADMIN before asking).
        if (isLearnerRole(roleKey) && isCreateStudentConfigured(step)) return false;
        // is_hidden fields are treated as absent everywhere (getResolvedFieldsForRole drops them,
        // FormStepTypeHandler's mandatory check skips them) -- so a step whose only fields are
        // hidden must fall into the "no attached fields" branch below, not be judged actionable
        // on a field nobody is ever shown.
        List<OnboardingStepFieldConfigDTO> fieldConfigs = parseFieldConfigs(step.getFieldsConfig())
                .stream().filter(fc -> !Boolean.TRUE.equals(fc.getIsHidden())).toList();
        if (fieldConfigs.isEmpty()) {
            OnboardingRoleAccessResolutionService.EffectiveAccess stepAccess =
                    roleAccessResolutionService.resolveStepAccess(step.getId(), roleKey);
            return stepAccess.canView && stepAccess.canEdit;
        }
        // Must require BOTH canView and canEdit, matching getResolvedFieldsForRole's own filter
        // (canView=false) -- a field with can_edit=true/can_view=false (an unusual but possible
        // admin misconfiguration, since the role-access grid doesn't couple the two checkboxes)
        // would otherwise report this step as actionable while getResolvedFieldsForRole returns
        // it as an empty field list, permanently stranding the caller on a step they can never
        // successfully submit (rejected server-side as "missing mandatory field").
        return fieldConfigs.stream().anyMatch(fc -> {
            OnboardingRoleAccessResolutionService.EffectiveAccess access = roleAccessResolutionService
                    .resolveFieldAccess(step.getId(), fc.getInstituteCustomFieldId(), roleKey);
            return access.canView && access.canEdit;
        });
    }

    /**
     * This step's fields resolved for {@code roleKey}: filtered to only fields the role can VIEW
     * (a field the role can't see is simply absent, not sent with can_view=false), each carrying
     * whether the role may EDIT it and its already-submitted value if any. Replaces the learner
     * app's previous reliance on the generic (role-unaware) feature-fields lookup, which rendered
     * every field as an editable text input regardless of the caller's actual permission.
     *
     * <p>Also serves the ADMIN surface (see {@code OnboardingStepInstanceController}'s /fields),
     * which used that same generic feature-fields lookup: besides being role-unaware, that
     * endpoint orders by the institute catalog's own order rather than the step builder's
     * per-step {@code field_order}, and reports the CATALOG row's is_mandatory (which this
     * domain never writes -- mandatory lives in the step's fields_config) so every field looked
     * optional on the admin form while the server still rejected the submit.
     *
     * <p>Each field carries its {@code field_type}/{@code config}/{@code default_value} so the
     * client renders it as its configured type; {@code is_hidden} fields are dropped here (see
     * {@code FormStepTypeHandler}, which excludes them from the mandatory check for the same
     * reason -- a hidden mandatory field would make the step permanently unsubmittable).
     */
    public List<OnboardingResolvedFieldDTO> getResolvedFieldsForRole(String stepInstanceId, String roleKey) {
        OnboardingStepInstance stepInstance = getStepInstance(stepInstanceId);
        OnboardingStep step = onboardingStepRepository.findById(stepInstance.getStepId())
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding step not found: " + stepInstance.getStepId()));
        List<OnboardingStepFieldConfigDTO> fieldConfigs = parseFieldConfigs(step.getFieldsConfig());
        if (fieldConfigs.isEmpty()) return List.of();

        Map<String, String> valueByCustomFieldId = customFieldValuesRepository
                .findBySourceTypeAndSourceId(CustomFieldValueSourceTypeEnum.ONBOARDING_STEP_INSTANCE.name(), stepInstanceId)
                .stream()
                .collect(Collectors.toMap(CustomFieldValues::getCustomFieldId, CustomFieldValues::getValue, (a, b) -> a));

        List<OnboardingResolvedFieldDTO> out = new ArrayList<>();
        for (OnboardingStepFieldConfigDTO fieldConfig : fieldConfigs) {
            if (Boolean.TRUE.equals(fieldConfig.getIsHidden())) continue;

            Optional<InstituteCustomField> instituteCustomField =
                    instituteCustomFieldRepository.findById(fieldConfig.getInstituteCustomFieldId());
            if (instituteCustomField.isEmpty()) continue;

            OnboardingRoleAccessResolutionService.EffectiveAccess access = roleAccessResolutionService
                    .resolveFieldAccess(step.getId(), fieldConfig.getInstituteCustomFieldId(), roleKey);
            if (!access.canView) continue;

            String customFieldId = instituteCustomField.get().getCustomFieldId();
            Optional<CustomFields> customField = customFieldRepository.findById(customFieldId);
            out.add(OnboardingResolvedFieldDTO.builder()
                    .instituteCustomFieldId(fieldConfig.getInstituteCustomFieldId())
                    .fieldName(customField.map(CustomFields::getFieldName).orElse(null))
                    .fieldType(customField.map(CustomFields::getFieldType).orElse(null))
                    .config(customField.map(CustomFields::getConfig).orElse(null))
                    .defaultValue(customField.map(CustomFields::getDefaultValue).orElse(null))
                    .fieldOrder(fieldConfig.getFieldOrder())
                    .isMandatory(fieldConfig.getIsMandatory())
                    .canEdit(access.canEdit)
                    .value(valueByCustomFieldId.get(customFieldId))
                    .build());
        }
        out.sort(Comparator.comparing(f -> f.getFieldOrder() == null ? 0 : f.getFieldOrder()));
        return out;
    }

    /**
     * The actual values submitted for a FORM step instance -- previously unavailable via any
     * onboarding endpoint, so the side-view's "View form" dialog could only show field NAMES.
     * Resolves each of the step's configured fields to its submitted value (null if that
     * particular field was never filled in, e.g. an optional field left blank).
     */
    public List<OnboardingSubmittedFieldDTO> getSubmittedFieldValues(String stepInstanceId) {
        OnboardingStepInstance stepInstance = getStepInstance(stepInstanceId);
        OnboardingStep step = onboardingStepRepository.findById(stepInstance.getStepId())
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding step not found: " + stepInstance.getStepId()));
        List<OnboardingStepFieldConfigDTO> fieldConfigs = parseFieldConfigs(step.getFieldsConfig());
        if (fieldConfigs.isEmpty()) return List.of();

        Map<String, String> valueByCustomFieldId = customFieldValuesRepository
                .findBySourceTypeAndSourceId(CustomFieldValueSourceTypeEnum.ONBOARDING_STEP_INSTANCE.name(), stepInstanceId)
                .stream()
                .collect(Collectors.toMap(CustomFieldValues::getCustomFieldId, CustomFieldValues::getValue, (a, b) -> a));

        List<OnboardingSubmittedFieldDTO> out = new ArrayList<>();
        for (OnboardingStepFieldConfigDTO fieldConfig : fieldConfigs) {
            Optional<InstituteCustomField> instituteCustomField =
                    instituteCustomFieldRepository.findById(fieldConfig.getInstituteCustomFieldId());
            if (instituteCustomField.isEmpty()) continue;
            String customFieldId = instituteCustomField.get().getCustomFieldId();
            Optional<CustomFields> customField = customFieldRepository.findById(customFieldId);
            out.add(OnboardingSubmittedFieldDTO.builder()
                    .instituteCustomFieldId(fieldConfig.getInstituteCustomFieldId())
                    .fieldName(customField.map(CustomFields::getFieldName).orElse(null))
                    .fieldType(customField.map(CustomFields::getFieldType).orElse(null))
                    .config(customField.map(CustomFields::getConfig).orElse(null))
                    .value(valueByCustomFieldId.get(customFieldId))
                    .build());
        }
        return out;
    }

    /**
     * {@link #getSubmittedFieldValues} narrowed to the fields {@code roleKey} may VIEW, for the
     * "View form" dialog. ADMIN sees every field, as before; a staff role given access to only
     * part of a step must not be handed the rest of the answers just because the step is
     * finished. Mirrors {@link #getResolvedFieldsForRole}'s own view filter.
     */
    public List<OnboardingSubmittedFieldDTO> getSubmittedFieldValuesForRole(String stepInstanceId, String roleKey) {
        List<OnboardingSubmittedFieldDTO> all = getSubmittedFieldValues(stepInstanceId);
        if (OnboardingRoleKey.ADMIN.name().equals(roleKey)) return all;
        String stepId = getStepInstance(stepInstanceId).getStepId();
        return all.stream()
                .filter(f -> roleAccessResolutionService
                        .resolveFieldAccess(stepId, f.getInstituteCustomFieldId(), roleKey).canView)
                .toList();
    }

    /**
     * The two roles the LEARNER surface can ever resolve a caller to
     * ({@code OnboardingRoleAccessResolutionService.resolveRoleKey}). Everything else -- ADMIN
     * and any institute role named in a step's grid -- is staff, acting through the admin
     * surface, and is trusted with the staff-only step behaviours.
     */
    private boolean isLearnerRole(String roleKey) {
        return OnboardingRoleKey.STUDENT.name().equals(roleKey)
                || OnboardingRoleKey.PARENT.name().equals(roleKey);
    }

    /**
     * Every step of one onboarding instance with the answers recorded on it, resolved for
     * {@code roleKey} -- the whole filled-in history in a single call, for the "what did I
     * submit during onboarding?" summary a subject can open once the flow is over.
     *
     * <p>Steps still PENDING contribute no answers but are still listed, so the summary reads as
     * the flow rather than as a disconnected pile of fields. Per-field VIEW permission and the
     * hidden-field filter come from {@link #getResolvedFieldsForRole}, so nothing surfaces here
     * that the form itself would have withheld from this caller.
     */
    public List<OnboardingSubmittedStepDTO> getSubmittedStepsForRole(String onboardingInstanceId, String roleKey) {
        List<OnboardingStepInstance> stepInstances = listStepInstances(onboardingInstanceId);
        if (stepInstances.isEmpty()) return List.of();

        // Step name/order live on the DEFINITION, not the instance -- fetched once per step
        // rather than per field.
        List<OnboardingSubmittedStepDTO> out = new ArrayList<>();
        for (OnboardingStepInstance stepInstance : stepInstances) {
            Optional<OnboardingStep> step = onboardingStepRepository.findById(stepInstance.getStepId());
            if (step.isEmpty()) continue;
            out.add(OnboardingSubmittedStepDTO.builder()
                    .stepInstanceId(stepInstance.getId())
                    .stepId(stepInstance.getStepId())
                    .stepName(step.get().getStepName())
                    .stepOrder(step.get().getStepOrder())
                    .status(stepInstance.getStatus())
                    .completedAt(stepInstance.getCompletedAt())
                    .skipReason(stepInstance.getSkipReason())
                    .fields(getResolvedFieldsForRole(stepInstance.getId(), roleKey))
                    .build());
        }
        out.sort(Comparator.comparing(s -> s.getStepOrder() == null ? 0 : s.getStepOrder()));
        return out;
    }

    /** The step DEFINITION behind a step instance -- for callers that hold the instance only. */
    public OnboardingStep getStepDefinition(OnboardingStepInstance stepInstance) {
        return onboardingStepRepository.findById(stepInstance.getStepId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Onboarding step not found: " + stepInstance.getStepId()));
    }

    private String readPayloadString(Map<String, Object> payload, String key) {
        if (payload == null) return null;
        Object raw = payload.get(key);
        return raw == null ? null : String.valueOf(raw);
    }

    private boolean isCreateStudentConfigured(OnboardingStep step) {
        String json = step.getStepTypeConfig();
        if (json == null || json.isBlank()) return false;
        try {
            JsonNode v = objectMapper.readTree(json).get("create_student");
            return v != null && ("true".equalsIgnoreCase(v.asText()) || v.asBoolean(false));
        } catch (Exception e) {
            return false;
        }
    }

    private boolean skipCourseSelectionIfAlreadyEnrolled(OnboardingStep step) {
        String json = step.getStepTypeConfig();
        if (json == null || json.isBlank()) return false;
        try {
            JsonNode v = objectMapper.readTree(json).get("skip_if_already_enrolled");
            return v != null && ("true".equalsIgnoreCase(v.asText()) || v.asBoolean(false));
        } catch (Exception e) {
            return false;
        }
    }

    private List<OnboardingStepFieldConfigDTO> parseFieldConfigs(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return List.of(objectMapper.readValue(json, OnboardingStepFieldConfigDTO[].class));
        } catch (Exception e) {
            return List.of();
        }
    }
}
