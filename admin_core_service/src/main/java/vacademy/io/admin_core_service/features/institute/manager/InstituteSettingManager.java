package vacademy.io.admin_core_service.features.institute.manager;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.naming.NameSettingRequest;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

@Component
public class InstituteSettingManager {

    @Autowired
    InstituteRepository instituteRepository;

    @Autowired
    InstituteSettingService instituteSettingService;

    @Autowired
    private InstituteCustomFiledService instituteCustomFiledService;

    // Cache-evict the public openInstituteDetails snapshot so naming changes
    // are visible to the learner-side terminology on next page load.
    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public ResponseEntity<String> createNewNamingSetting(CustomUserDetails userDetails, String instituteId,
            NameSettingRequest request) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        instituteSettingService.createNewNamingSetting(institute.get(), request);
        return ResponseEntity.ok("Done");
    }

    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public ResponseEntity<String> updateNamingSetting(CustomUserDetails userDetails, String instituteId,
            NameSettingRequest request) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        instituteSettingService.updateNamingSetting(institute.get(), request);
        return ResponseEntity.ok("Done");
    }

    // Generic methods for any setting type
    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public ResponseEntity<String> createNewGenericSetting(CustomUserDetails userDetails, String instituteId,
            String settingKey, GenericSettingRequest request) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        instituteSettingService.createNewGenericSetting(institute.get(), settingKey, request.getSettingData());
        return ResponseEntity.ok("Done");
    }

    // Same rationale as saveGenericSetting — bust the openInstituteDetails
    // cache so learner-facing reads pick up the change immediately.
    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public ResponseEntity<String> updateGenericSetting(CustomUserDetails userDetails, String instituteId,
            String settingKey, GenericSettingRequest request) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        instituteSettingService.updateGenericSetting(institute.get(), settingKey, request.getSettingData());
        return ResponseEntity.ok("Done");
    }

    // Upsert method - creates if doesn't exist, updates if exists
    // CacheEvict — the public /details-non-batches/{instituteId} endpoint is
    // @Cacheable on "openInstituteDetails". Without this eviction, learner
    // surfaces (coupon-enabled toggle, drip conditions, branding, etc.) keep
    // reading the pre-toggle institute snapshot until cache TTL or restart.
    // "instituteById" backs the /internal/institute/v1/{id} endpoint that other
    // services read — notification_service resolves email senders and their daily
    // caps from it, so a cap set here must not keep serving the old value.
    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches", "instituteById" }, key = "#instituteId")
    public ResponseEntity<String> saveGenericSetting(CustomUserDetails userDetails, String instituteId,
            String settingKey, GenericSettingRequest request) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        instituteSettingService.saveGenericSetting(institute.get(), settingKey, request);

        if ("USER_IDENTIFIER".equals(settingKey)) {
            try {
                Object data = request.getSettingData();
                String userIdentifier = "EMAIL";
                if (data instanceof String) {
                    userIdentifier = (String) data;
                } else if (data instanceof java.util.Map) {
                    java.util.Map<?, ?> map = (java.util.Map<?, ?>) data;
                    if (map.containsKey("userIdentifier")) {
                        userIdentifier = map.get("userIdentifier").toString();
                    } else if (map.containsKey("user_identifier")) {
                        userIdentifier = map.get("user_identifier").toString();
                    } else if (map.containsKey("value")) {
                        userIdentifier = map.get("value").toString();
                    }
                }
                instituteSettingService.syncUserIdentifier(instituteId, userIdentifier);
            } catch (Exception e) {
                // We shouldn't fail the entire request if sync fails, but we want it to be
                // caught
                e.printStackTrace();
            }
        }

        return ResponseEntity.ok("Setting saved successfully");
    }

    // GET methods for retrieving settings
    public ResponseEntity<InstituteSettingDto> getAllSettings(CustomUserDetails userDetails, String instituteId) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        InstituteSettingDto settings = instituteSettingService.getAllSettings(institute.get());
        return ResponseEntity.ok(settings);
    }

    public ResponseEntity<SettingDto> getSpecificSetting(CustomUserDetails userDetails, String instituteId,
            String settingKey) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        SettingDto setting = instituteSettingService.getSpecificSetting(institute.get(), settingKey);
        return ResponseEntity.ok(setting);
    }

    public ResponseEntity<Object> getSettingData(CustomUserDetails userDetails, String instituteId, String settingKey) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        Object settingData = instituteSettingService.getSettingData(institute.get(), settingKey);
        return ResponseEntity.ok(settingData);
    }

    public ResponseEntity<String> getSettingsAsRawJson(CustomUserDetails userDetails, String instituteId) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");

        String rawJson = instituteSettingService.getSettingsAsRawJson(institute.get());
        return ResponseEntity.ok(rawJson != null ? rawJson : "{}");
    }

    @CacheEvict(value = { "openInstituteDetails", "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public ResponseEntity<String> updateCustomFieldSetting(CustomUserDetails userDetails, String instituteId,
            CustomFieldSettingRequest request, String isPresent) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty())
            throw new VacademyException("Institute Not Found");
        if (StringUtils.hasText(isPresent)) {
            return ResponseEntity.ok(handleCaseCustomFieldSettingPresent(institute.get(), request));
        }
        return ResponseEntity.ok(handleCaseCustomFieldSettingNotPresent(institute.get()));
    }

    private String handleCaseCustomFieldSettingNotPresent(Institute institute) {
        instituteSettingService.createDefaultCustomFieldSetting(institute);
        return "Done";
    }

    public List<vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldUsageDTO> getCustomFieldsWithUsage(
            String instituteId) {
        return instituteCustomFiledService.getCustomFieldsUsage(instituteId);
    }

    private String handleCaseCustomFieldSettingPresent(
            Institute institute,
            CustomFieldSettingRequest req) {

        List<CustomFieldDto> dtos = req.getCustomFieldsAndGroups();

        if (dtos != null) {
            for (var fieldDto : dtos) {

                if (!StringUtils.hasText(fieldDto.getCustomFieldId())) {

                    // Create new field
                    CustomFieldDTO newDto = new CustomFieldDTO();
                    newDto.setFieldName(fieldDto.getFieldName());
                    newDto.setFieldType(fieldDto.getFieldType());
                    newDto.setGroupName(fieldDto.getGroupName());
                    newDto.setGroupInternalOrder(fieldDto.getGroupInternalOrder());
                    newDto.setIndividualOrder(fieldDto.getIndividualOrder());
                    newDto.setConfig(fieldDto.getConfig());

                    CustomFields saved = instituteCustomFiledService
                            .createOrFindCustomFieldByKey(newDto, institute.getId());

                    Optional<InstituteCustomField> existing = instituteCustomFiledService
                            .getByInstituteIdAndFieldIdAndTypeAndTypeId(
                                    institute.getId(),
                                    saved.getId(),
                                    "DEFAULT_CUSTOM_FIELD",
                                    null);

                    InstituteCustomField savedMapping;

                    if (existing.isPresent()) {
                        savedMapping = existing.get();
                        patchInstituteCustomFieldMapping(savedMapping, fieldDto);
                        savedMapping = instituteCustomFiledService
                                .createorupdateinstutefieldmapping(savedMapping);
                    } else {
                        savedMapping = instituteCustomFiledService
                                .createInstituteMappingFromCustomField(saved, institute, newDto);
                    }

                    fieldDto.setCustomFieldId(saved.getId());
                    fieldDto.setId(savedMapping.getId());

                } else {
                    // Update existing custom field
                    updateExistingCustomField(fieldDto, institute);
                }
            }
        }

        // ---------- APPLY UNIQUENESS AFTER ALL DB OPERATIONS ----------
        applyUniqueness(req);

        instituteSettingService.updateCustomFieldSetting(institute, req);
        return "Done";
    }

    private void applyUniqueness(CustomFieldSettingRequest req) {

        // Filter out DELETED DTOs first
        List<CustomFieldDto> activeDtos = null;
        if (req.getCustomFieldsAndGroups() != null) {
            activeDtos = req.getCustomFieldsAndGroups().stream()
                    .filter(Objects::nonNull)
                    .filter(dto -> dto.getStatus() == null ||
                            !StatusEnum.INACTIVE.name().equalsIgnoreCase(dto.getStatus()))
                    .collect(Collectors.toList());
            req.setCustomFieldsAndGroups(activeDtos);
        }

        // Unique by customFieldId for DTO list
        if (activeDtos != null) {
            req.setCustomFieldsAndGroups(
                    activeDtos.stream()
                            .collect(Collectors.toMap(
                                    CustomFieldDto::getCustomFieldId, // unique by ID
                                    dto -> dto,
                                    (a, b) -> a, // keep first
                                    LinkedHashMap::new // preserve order
                            ))
                            .values()
                            .stream()
                            .collect(Collectors.toList()));
        }

        // Unique list of all custom field IDs (only non-deleted)
        if (req.getCustomFieldsAndGroups() != null) {
            req.setAllCustomFields(
                    req.getCustomFieldsAndGroups().stream()
                            .map(CustomFieldDto::getCustomFieldId)
                            .filter(Objects::nonNull)
                            .distinct()
                            .collect(Collectors.toList()));
        }

        // Unique / filtered group names
        if (req.getGroupNames() != null) {
            req.setGroupNames(req.getGroupNames()
                    .stream()
                    .filter(Objects::nonNull)
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .distinct()
                    .collect(Collectors.toList()));
        }

        // Other string lists → dedupe
        req.setCustomFieldsName(makeDistinct(req.getCustomFieldsName()));
        req.setCompulsoryCustomFields(makeDistinct(req.getCompulsoryCustomFields()));
        req.setFixedCustomFields(makeDistinct(req.getFixedCustomFields()));
        req.setCustomFieldLocations(makeDistinct(req.getCustomFieldLocations()));
    }

    private List<String> makeDistinct(List<String> input) {
        if (input == null)
            return null;

        return input.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .collect(Collectors.toList());
    }

    /**
     * Updates an existing custom field with only the provided data (PATCH behavior)
     */
    private void updateExistingCustomField(CustomFieldDto fieldDto, Institute institute) {
        // Find the existing custom field
        Optional<CustomFields> existingCustomField = instituteCustomFiledService
                .getCustomFieldById(fieldDto.getCustomFieldId());
        if (existingCustomField.isEmpty()) {
            throw new VacademyException("Custom field with ID " + fieldDto.getCustomFieldId() + " not found");
        }

        CustomFields customField = existingCustomField.get();
        boolean customFieldUpdated = false;

        // Update custom field properties only if provided and different
        if (StringUtils.hasText(fieldDto.getFieldName())
                && !fieldDto.getFieldName().equals(customField.getFieldName())) {
            customField.setFieldName(fieldDto.getFieldName());
            customFieldUpdated = true;
        }

        if (StringUtils.hasText(fieldDto.getFieldType())
                && !fieldDto.getFieldType().equals(customField.getFieldType())) {
            customField.setFieldType(fieldDto.getFieldType());
            customFieldUpdated = true;
        }

        if (StringUtils.hasText(fieldDto.getStatus())) {
            customField.setStatus(fieldDto.getStatus());
        }

        if (StringUtils.hasText(fieldDto.getConfig())) {
            customField.setConfig(fieldDto.getConfig());
        }

        // Save custom field if it was updated
        if (customFieldUpdated) {
            instituteCustomFiledService.createOrSaveAllFields(List.of(customField));
        }

        // Update institute custom field mapping
        Optional<InstituteCustomField> existingMapping = instituteCustomFiledService
                .getByInstituteIdAndFieldIdAndTypeAndTypeId(
                        institute.getId(), fieldDto.getCustomFieldId(), "DEFAULT_CUSTOM_FIELD", null);

        if (existingMapping.isPresent()) {
            InstituteCustomField mapping = existingMapping.get();
            patchInstituteCustomFieldMapping(mapping, fieldDto);
            instituteCustomFiledService.createorupdateinstutefieldmapping(mapping);
        } else {
            // If mapping doesn't exist but custom field does, create the mapping
            createInstituteMappingForExistingField(customField, fieldDto, institute);
        }
    }

    /**
     * Creates institute mapping for an existing custom field
     */
    private void createInstituteMappingForExistingField(CustomFields customField, CustomFieldDto fieldDto,
            Institute institute) {
        CustomFieldDTO mappingDto = new CustomFieldDTO();
        mappingDto.setFieldName(customField.getFieldName());
        mappingDto.setFieldType(customField.getFieldType());
        mappingDto.setGroupName(fieldDto.getGroupName());
        mappingDto.setGroupInternalOrder(fieldDto.getGroupInternalOrder());
        mappingDto.setIndividualOrder(fieldDto.getIndividualOrder());

        instituteCustomFiledService.createInstituteMappingFromCustomField(customField, institute, mappingDto);
    }

    /**
     * Patches institute custom field mapping with only provided fields
     */
    private void patchInstituteCustomFieldMapping(InstituteCustomField mapping, CustomFieldDto fieldDto) {
        // Update group name if provided
        if (StringUtils.hasText(fieldDto.getGroupName())) {
            mapping.setGroupName(fieldDto.getGroupName());
        }

        // Update group internal order if provided
        if (fieldDto.getGroupInternalOrder() != null) {
            mapping.setGroupInternalOrder(fieldDto.getGroupInternalOrder());
        }

        // Update individual order if provided
        if (fieldDto.getIndividualOrder() != null) {
            mapping.setIndividualOrder(fieldDto.getIndividualOrder());
        }

        // Update status if provided
        if (StringUtils.hasText(fieldDto.getStatus())) {
            mapping.setStatus(fieldDto.getStatus());
        }
    }
}
