package vacademy.io.admin_core_service.features.onboarding.steptype;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.request.CustomFieldValueDto;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldValueSourceTypeEnum;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepFieldConfigDTO;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStep;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStepInstance;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingStepInstanceStatus;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingStepTypeEnum;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingRoleAccessResolutionService;
import vacademy.io.admin_core_service.features.onboarding.service.OnboardingStudentCreationService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * FORM step type -- v1's only step type. Renders/validates the step's configured
 * {@link OnboardingStepFieldConfigDTO} entries (parsed from {@link OnboardingStep#getFieldsConfig()},
 * each backed by a shared institute_custom_fields row) and stores submitted values via the
 * existing custom-fields infrastructure, exactly the way AUDIENCE_FORM responses are stored
 * today, just under a new source type.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FormStepTypeHandler implements OnboardingStepTypeHandler {

    private final InstituteCustomFieldRepository instituteCustomFieldRepository;
    private final CustomFieldValueService customFieldValueService;
    private final CustomFieldValuesRepository customFieldValuesRepository;
    private final CustomFieldRepository customFieldRepository;
    private final OnboardingStudentCreationService onboardingStudentCreationService;
    private final OnboardingRoleAccessResolutionService roleAccessResolutionService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public boolean supports(String stepType) {
        return OnboardingStepTypeEnum.FORM.name().equalsIgnoreCase(stepType);
    }

    @Override
    @SuppressWarnings("unchecked")
    public OnboardingStepInstanceStatus onSubmit(OnboardingStepInstance stepInstance,
                                                  OnboardingStep step,
                                                  Map<String, Object> payload,
                                                  String actorRoleKey,
                                                  String actorUserId,
                                                  boolean requireComplete) {
        List<OnboardingStepFieldConfigDTO> fieldConfigs = parseFieldConfigs(step.getFieldsConfig());

        // Values already saved in an EARLIER call (by this actor or a different role) -- a step
        // whose fields span multiple roles (admin fills tracking id/vendor, student later fills
        // "received?") must not treat an already-saved field as "missing" just because THIS
        // caller can't edit it / didn't resend it in this payload.
        Map<String, String> existingValues = customFieldValuesRepository
                .findBySourceTypeAndSourceId(CustomFieldValueSourceTypeEnum.ONBOARDING_STEP_INSTANCE.name(), stepInstance.getId())
                .stream()
                .collect(Collectors.toMap(CustomFieldValues::getCustomFieldId, CustomFieldValues::getValue, (a, b) -> a));

        List<CustomFieldValueDto> valuesToSave = new ArrayList<>();
        List<String> missingMandatory = new ArrayList<>();

        for (OnboardingStepFieldConfigDTO fieldConfig : fieldConfigs) {
            Optional<InstituteCustomField> instituteCustomField =
                    instituteCustomFieldRepository.findById(fieldConfig.getInstituteCustomFieldId());
            if (instituteCustomField.isEmpty()) {
                log.warn("step {} fields_config references missing institute_custom_field {}",
                        step.getId(), fieldConfig.getInstituteCustomFieldId());
                continue;
            }

            // Never trust the client's edit intent: re-check per-field permission for the
            // actual caller role server-side. A field the caller can't edit is treated as not
            // submitted THIS call, so a tampered/naive payload can't write to it -- it just
            // falls through to the already-saved value (if any) for the mandatory check below.
            boolean canEdit = roleAccessResolutionService
                    .resolveFieldAccess(step.getId(), fieldConfig.getInstituteCustomFieldId(), actorRoleKey)
                    .canEdit;

            String customFieldId = instituteCustomField.get().getCustomFieldId();
            Object rawValue = (!canEdit || payload == null) ? null : payload.get(fieldConfig.getInstituteCustomFieldId());
            String newValue = rawValue == null ? null : String.valueOf(rawValue);
            String effectiveValue = StringUtils.hasText(newValue) ? newValue : existingValues.get(customFieldId);

            // A hidden field is never rendered on any form (getResolvedFieldsForRole drops it),
            // so requiring one would strand every caller on a step they can't possibly complete.
            boolean required = Boolean.TRUE.equals(fieldConfig.getIsMandatory())
                    && !Boolean.TRUE.equals(fieldConfig.getIsHidden());
            if (requireComplete && required && !StringUtils.hasText(effectiveValue)) {
                // Name the field, not its mapping UUID -- the message surfaces verbatim in the
                // admin/learner form's error toast.
                missingMandatory.add(customFieldRepository.findById(customFieldId)
                        .map(CustomFields::getFieldName)
                        .filter(StringUtils::hasText)
                        .orElse(fieldConfig.getInstituteCustomFieldId()));
            }

            // Only ever write a value this specific call actually provided -- re-saving the
            // already-stored value on every later call (e.g. every time someone else submits
            // their own part of the same step) would be a wasted write with no effect.
            if (StringUtils.hasText(newValue)) {
                CustomFieldValueDto dto = new CustomFieldValueDto();
                dto.setCustomFieldId(customFieldId);
                dto.setSourceType(CustomFieldValueSourceTypeEnum.ONBOARDING_STEP_INSTANCE.name());
                dto.setSourceId(stepInstance.getId());
                dto.setType(CustomFieldTypeEnum.ONBOARDING_STEP.name());
                dto.setTypeId(step.getId());
                dto.setValue(newValue);
                valuesToSave.add(dto);
            }
        }

        // Persist whatever new values THIS call actually provided regardless of whether the
        // step can fully complete yet -- a partial save (requireComplete=false) always saves;
        // a failed complete attempt (some other role's mandatory field still missing) must not
        // discard THIS caller's otherwise-valid input either.
        customFieldValueService.upsertCustomFieldValues(valuesToSave);

        if (!requireComplete) {
            return OnboardingStepInstanceStatus.IN_PROGRESS;
        }

        if (!missingMandatory.isEmpty()) {
            // InvalidRequestException -> 400 via the shared GlobalExceptionHandler. A bare
            // RuntimeException/IllegalArgumentException falls through that handler's generic
            // RuntimeException catch-all, which maps to 511 -- wrong for a client validation error.
            throw new InvalidRequestException(
                    "Missing mandatory field(s): " + String.join(", ", missingMandatory));
        }

        if (isCreateStudentConfigured(step)) {
            // Parent-vs-student resolution (is_parent + student_* fields) already ran centrally
            // in OnboardingStepInstanceService.completeStep, before this handler was invoked --
            // stepInstance's onboarding_instance already carries the correct subject by now.
            String selectedPackageSessionId = resolveSelectedPackageSessionId(stepInstance, step, payload);
            onboardingStudentCreationService.createStudentIfAbsent(stepInstance, selectedPackageSessionId);
        }

        return OnboardingStepInstanceStatus.COMPLETED;
    }

    /**
     * The step is built with a course POOL ({@code package_session_ids}), not one fixed course --
     * so a single flow works across every course a lead might land in, and doesn't need rebuilding
     * every time a new course is created. Empty/absent pool -- the completing admin picks ANY
     * course (open choice); non-empty pool -- they must pick one FROM that pool (validated
     * server-side, never trusted from the client). Either way the actual choice travels in the
     * same submit payload as the field values, under the reserved key "package_session_id" (safe
     * to co-mingle with institute_custom_field_id keys, which are UUIDs).
     *
     * <p>No course picked is only ever allowed when the step's {@code skip_if_already_enrolled}
     * setting is on AND the subject already has an ACTIVE enrollment elsewhere at this institute
     * -- e.g. re-running (or a later step of) a flow on someone who was already enrolled outside
     * it. Returns null in that case, which {@link OnboardingStudentCreationService#createStudentIfAbsent}
     * treats as "nothing more to enroll, just ensure the role/student row."
     */
    private String resolveSelectedPackageSessionId(OnboardingStepInstance stepInstance, OnboardingStep step,
                                                     Map<String, Object> payload) {
        Object raw = payload == null ? null : payload.get("package_session_id");
        String selected = raw == null ? null : String.valueOf(raw);
        if (StringUtils.hasText(selected)) {
            List<String> pool = readConfigList(step.getStepTypeConfig(), "package_session_ids");
            if (!pool.isEmpty() && !pool.contains(selected)) {
                throw new InvalidRequestException("Selected course is not one of the allowed courses for this step");
            }
            return selected;
        }
        if (skipCourseSelectionIfAlreadyEnrolled(step)
                && onboardingStudentCreationService.subjectAlreadyHasActiveEnrollment(stepInstance)) {
            return null;
        }
        throw new InvalidRequestException("Pick a course to enroll the student into");
    }

    private boolean isCreateStudentConfigured(OnboardingStep step) {
        return "true".equalsIgnoreCase(readConfig(step.getStepTypeConfig(), "create_student"));
    }

    private boolean skipCourseSelectionIfAlreadyEnrolled(OnboardingStep step) {
        return "true".equalsIgnoreCase(readConfig(step.getStepTypeConfig(), "skip_if_already_enrolled"));
    }

    private List<OnboardingStepFieldConfigDTO> parseFieldConfigs(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return List.of(objectMapper.readValue(json, OnboardingStepFieldConfigDTO[].class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private String readConfig(String json, String key) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode v = objectMapper.readTree(json).get(key);
            return v == null || v.isNull() ? null : v.asText();
        } catch (Exception e) {
            return null;
        }
    }

    private List<String> readConfigList(String json, String key) {
        if (json == null || json.isBlank()) return List.of();
        try {
            JsonNode v = objectMapper.readTree(json).get(key);
            if (v == null || v.isNull() || !v.isArray()) return List.of();
            List<String> out = new ArrayList<>();
            v.forEach(n -> {
                if (n != null && !n.isNull() && StringUtils.hasText(n.asText())) out.add(n.asText());
            });
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }
}
