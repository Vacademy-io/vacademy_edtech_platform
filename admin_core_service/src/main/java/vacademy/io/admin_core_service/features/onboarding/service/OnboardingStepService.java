package vacademy.io.admin_core_service.features.onboarding.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepFieldConfigDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.ReorderStepsRequest;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStep;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingStepTypeEnum;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingStepRepository;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class OnboardingStepService {

    private final OnboardingStepRepository onboardingStepRepository;
    private final InstituteCustomFieldRepository instituteCustomFieldRepository;
    private final InstituteCustomFiledService instituteCustomFiledService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional
    public OnboardingStep createStep(String instituteId, String flowId, OnboardingStepDTO request) {
        // Always server-derived, ignoring any client-supplied step_order: uq_onboarding_step_flow_order
        // is unique per (flow_id, step_order) across EVERY status, including ARCHIVED (deleted) steps,
        // so counting only ACTIVE steps (as both this and the frontend's own count previously did)
        // reuses an already-taken order the moment a step has ever been deleted from this flow.
        int nextOrder = onboardingStepRepository.findMaxStepOrder(flowId) + 1;

        OnboardingStep step = OnboardingStep.builder()
                .flowId(flowId)
                .stepOrder(nextOrder)
                .stepName(request.getStepName())
                .stepType(StringUtils.hasText(request.getStepType()) ? request.getStepType() : OnboardingStepTypeEnum.FORM.name())
                .stepTypeConfig(toJson(request.getStepTypeConfig()))
                .isOptional(Boolean.TRUE.equals(request.getIsOptional()))
                .grantsStudentRole(Boolean.TRUE.equals(request.getGrantsStudentRole()))
                .sendsLoginCredentials(Boolean.TRUE.equals(request.getSendsLoginCredentials()))
                .roleAccess(toJson(request.getRoleAccess()))
                .status("ACTIVE")
                .build();
        step = onboardingStepRepository.save(step);
        // Inline "new_field" creation needs the step's own id (institute_custom_fields.type_id),
        // which only exists after the first save -- resolve fields now and persist them.
        step.setFieldsConfig(toJson(resolveFieldConfigs(instituteId, step.getId(), request.getFields())));
        return onboardingStepRepository.save(step);
    }

    @Transactional
    public OnboardingStep updateStep(String instituteId, String stepId, OnboardingStepDTO request) {
        OnboardingStep step = getStep(stepId);
        if (StringUtils.hasText(request.getStepName())) step.setStepName(request.getStepName());
        if (StringUtils.hasText(request.getStepType())) step.setStepType(request.getStepType());
        if (request.getStepTypeConfig() != null) step.setStepTypeConfig(toJson(request.getStepTypeConfig()));
        if (request.getIsOptional() != null) step.setIsOptional(request.getIsOptional());
        if (request.getGrantsStudentRole() != null) step.setGrantsStudentRole(request.getGrantsStudentRole());
        if (request.getSendsLoginCredentials() != null) step.setSendsLoginCredentials(request.getSendsLoginCredentials());
        if (request.getRoleAccess() != null) step.setRoleAccess(toJson(request.getRoleAccess()));
        if (request.getFields() != null) {
            List<OnboardingStepFieldConfigDTO> resolved = resolveFieldConfigs(instituteId, stepId, request.getFields());
            step.setFieldsConfig(toJson(resolved));
            deactivateMappingsNotIn(instituteId, stepId, resolved);
        }
        return onboardingStepRepository.save(step);
    }

    /**
     * Soft-deletes the step's ONBOARDING_STEP mappings that this save no longer lists.
     *
     * <p>Removing a field from the builder used to drop it from fields_config and leave its
     * institute_custom_fields mapping ACTIVE forever, so the two sources of "which fields does
     * this step have" silently diverged -- and they are read by different screens: the builder
     * (and anything else using the feature-fields lookup) reads the MAPPINGS, while every form
     * renders from FIELDS_CONFIG. A field present in one and not the other is therefore visible
     * in the step but absent from the form it's supposed to appear on, with nothing to explain
     * the difference. Making a removal actually deactivate the mapping is what lets the builder
     * safely union the two on load (see the frontend's step-dialog hydration): anything in the
     * mappings but not in fields_config is then genuine drift to restore, rather than a field
     * someone deliberately deleted coming back from the dead.
     */
    private void deactivateMappingsNotIn(String instituteId, String stepId,
                                          List<OnboardingStepFieldConfigDTO> keptFields) {
        Set<String> keptIds = keptFields.stream()
                .map(OnboardingStepFieldConfigDTO::getInstituteCustomFieldId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());
        List<InstituteCustomField> existing = instituteCustomFieldRepository
                .findByInstituteIdAndTypeAndTypeIdAndStatusIn(instituteId,
                        CustomFieldTypeEnum.ONBOARDING_STEP.name(), stepId, List.of(StatusEnum.ACTIVE.name()));
        for (InstituteCustomField mapping : existing) {
            if (keptIds.contains(mapping.getId())) continue;
            // Soft-delete only: the master custom_fields row and any already-submitted
            // custom_field_values answers are untouched, matching how the shared custom-field
            // machinery deletes mappings everywhere else -- re-attaching the field later
            // reactivates it and brings the existing answers back with it.
            mapping.setStatus(StatusEnum.DELETED.name());
            instituteCustomFieldRepository.save(mapping);
        }
    }

    public void deleteStep(String stepId) {
        OnboardingStep step = getStep(stepId);
        step.setStatus("ARCHIVED");
        onboardingStepRepository.save(step);
    }

    /**
     * uq_onboarding_step_flow_order is UNIQUE(flow_id, step_order), checked immediately (not
     * deferred) -- reassigning each step's order one row at a time, in the request's own order,
     * can collide with whatever a NOT-YET-processed step in the same request still holds (e.g.
     * moving step A from position 1 to last while B/C shift down: B's new order 0 is fine, but
     * C's new order 1 collides with A's still-unprocessed old order 1). Phase 1 moves every
     * step to a guaranteed-unique negative order (impossible to collide with any real row, since
     * real orders are always positive) before phase 2 applies the real target orders -- avoids
     * ANY intermediate collision regardless of reorder pattern.
     */
    @Transactional
    public void reorderSteps(ReorderStepsRequest request) {
        if (request == null || CollectionUtils.isEmpty(request.getSteps())) return;
        List<OnboardingStep> steps = new ArrayList<>();
        int tempOrder = -1;
        for (ReorderStepsRequest.StepOrderEntry entry : request.getSteps()) {
            OnboardingStep step = getStep(entry.getStepId());
            step.setStepOrder(tempOrder--);
            steps.add(onboardingStepRepository.saveAndFlush(step));
        }
        for (int i = 0; i < steps.size(); i++) {
            OnboardingStep step = steps.get(i);
            step.setStepOrder(request.getSteps().get(i).getOrder());
            onboardingStepRepository.save(step);
        }
    }

    public OnboardingStep getStep(String stepId) {
        return onboardingStepRepository.findById(stepId)
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding step not found: " + stepId));
    }

    public List<OnboardingStep> listSteps(String flowId) {
        return onboardingStepRepository.findByFlowIdAndStatusOrderByStepOrderAsc(flowId, "ACTIVE");
    }

    /** Parses a step's fields_config JSON -- the single source of truth for its attached FORM fields. */
    public List<OnboardingStepFieldConfigDTO> listFieldConfigs(String stepId) {
        return parseFieldConfigs(getStep(stepId).getFieldsConfig());
    }

    private List<OnboardingStepFieldConfigDTO> resolveFieldConfigs(String instituteId, String stepId,
                                                                     List<OnboardingStepFieldConfigDTO> fields) {
        if (CollectionUtils.isEmpty(fields)) return List.of();
        List<OnboardingStepFieldConfigDTO> resolved = new ArrayList<>();
        int order = 1;
        for (OnboardingStepFieldConfigDTO fieldDto : fields) {
            String instituteCustomFieldId = resolveInstituteCustomFieldId(instituteId, stepId, fieldDto);
            if (!StringUtils.hasText(instituteCustomFieldId)) continue;
            resolved.add(OnboardingStepFieldConfigDTO.builder()
                    .instituteCustomFieldId(instituteCustomFieldId)
                    .fieldOrder(fieldDto.getFieldOrder() != null ? fieldDto.getFieldOrder() : order++)
                    .isMandatory(Boolean.TRUE.equals(fieldDto.getIsMandatory()))
                    .isHidden(Boolean.TRUE.equals(fieldDto.getIsHidden()))
                    .roleAccess(fieldDto.getRoleAccess())
                    .build());
        }
        return resolved;
    }

    /**
     * Attaches an existing institute_custom_fields row, or creates a new custom field, to this
     * step -- either way, resolves to a mapping row SCOPED TO THIS STEP (type=ONBOARDING_STEP,
     * typeId=stepId), never the picker's original row id. The "attach existing field" picker
     * hands us an institute_custom_fields row from the institute's general catalog (e.g.
     * DEFAULT_CUSTOM_FIELD) -- reusing that row's id directly would leave the field invisible
     * to every ONBOARDING_STEP feature-fields lookup, since that row's own type/typeId still
     * points wherever it was originally defined, not at this step. Idempotent: re-saving a step
     * reuses the same per-step mapping instead of creating a duplicate each time.
     */
    private String resolveInstituteCustomFieldId(String instituteId, String stepId, OnboardingStepFieldConfigDTO fieldDto) {
        String customFieldId;
        if (StringUtils.hasText(fieldDto.getInstituteCustomFieldId())) {
            customFieldId = instituteCustomFieldRepository.findById(fieldDto.getInstituteCustomFieldId())
                    .map(InstituteCustomField::getCustomFieldId)
                    .orElse(null);
            if (!StringUtils.hasText(customFieldId)) return null;
        } else if (fieldDto.getNewField() != null && StringUtils.hasText(stepId)) {
            CustomFieldDTO customFieldDTO = new CustomFieldDTO();
            customFieldDTO.setFieldName(String.valueOf(fieldDto.getNewField().get("field_name")));
            customFieldDTO.setFieldType(String.valueOf(fieldDto.getNewField().get("field_type")));
            Object defaultValue = fieldDto.getNewField().get("default_value");
            if (defaultValue != null) customFieldDTO.setDefaultValue(String.valueOf(defaultValue));
            Object config = fieldDto.getNewField().get("config");
            if (config != null) customFieldDTO.setConfig(String.valueOf(config));
            customFieldId = instituteCustomFiledService.createOrFindCustomFieldByKey(customFieldDTO, instituteId).getId();
        } else {
            return null;
        }

        Optional<InstituteCustomField> existingMapping = instituteCustomFieldRepository
                .findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                        instituteId, customFieldId, CustomFieldTypeEnum.ONBOARDING_STEP.name(), stepId,
                        StatusEnum.ACTIVE.name());
        if (existingMapping.isPresent()) return existingMapping.get().getId();

        InstituteCustomField mapping = instituteCustomFieldRepository.save(InstituteCustomField.builder()
                .instituteId(instituteId)
                .customFieldId(customFieldId)
                .type(CustomFieldTypeEnum.ONBOARDING_STEP.name())
                .typeId(stepId)
                .status(StatusEnum.ACTIVE.name())
                .build());
        return mapping.getId();
    }

    private List<OnboardingStepFieldConfigDTO> parseFieldConfigs(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return List.of(objectMapper.readValue(json, OnboardingStepFieldConfigDTO[].class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private String toJson(Object obj) {
        if (obj == null) return null;
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return null;
        }
    }
}
