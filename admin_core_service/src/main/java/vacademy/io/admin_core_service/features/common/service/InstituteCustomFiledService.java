package vacademy.io.admin_core_service.features.common.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldMappingUsageDTO;
import vacademy.io.admin_core_service.features.common.util.CustomFieldKeyGenerator;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDeleteRequestDTO;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.enums.FieldTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteCustomFieldSetupDTO;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.sql.Timestamp;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class InstituteCustomFiledService {
    /** Read-only, used solely by {@link #holdsShreddedOptions(String)}. */
    private static final ObjectMapper shreddedOptionMapper = new ObjectMapper();

    @Autowired
    private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @Autowired
    private CustomFieldRepository customFieldRepository;

    @Autowired
    private CustomFieldKeyGenerator keyGenerator;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private AudienceRepository audienceRepository;

    @Autowired
    private LiveSessionRepository liveSessionRepository;

    @Transactional
    public void addOrUpdateCustomField(List<InstituteCustomFieldDTO> cfDTOs) {
        List<InstituteCustomField> instCFList = new ArrayList<>();

        for (InstituteCustomFieldDTO dto : cfDTOs) {
            CustomFieldDTO cfDto = dto.getCustomField();
            if (cfDto == null) {
                continue;
            }

            CustomFields cf;

            if (StringUtils.hasText(cfDto.getId())) {
                Optional<CustomFields> existingCF = customFieldRepository.findById(cfDto.getId());
                if (existingCF.isEmpty()) {
                    throw new VacademyException("Custom Field Not Found");
                }
                CustomFields loaded = existingCF.get();
                // The master row holds the field's definition — type, label, options.
                // Loading it without applying the incoming edits meant every change an
                // admin made to a field that already existed (switching TEXT to
                // DROPDOWN, renaming it, editing its options) was accepted by the API
                // and silently dropped; only the mapping's order survived the save.
                //
                // Required-ness is deliberately NOT written here. A master row is shared
                // by every form that reuses the field, and editors do force it on: the
                // enroll-invite builder sends `isMandatory: true` for seeded Email /
                // Phone whatever the row says. Writing that back would re-require Email
                // on the institute's other forms — including the lead forms that accept
                // email-less leads. The per-form flag is the mapping's is_mandatory,
                // written below.
                applyDefinitionUpdates(loaded, cfDto);
                // Single assignment: `cf` is captured by the lambda below, so it has
                // to stay effectively final.
                cf = customFieldRepository.save(loaded);

            } else {
                String fieldKey = keyGenerator.generateFieldKey(cfDto.getFieldName(), dto.getInstituteId());
                cf = findOrCreateCustomFieldWithLock(fieldKey, cfDto);
            }

            // First try to find ACTIVE field
            Optional<InstituteCustomField> optionalInstCF = instituteCustomFieldRepository
                    .findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                            dto.getInstituteId(),
                            cf.getId(),
                            dto.getType(),
                            dto.getTypeId(),
                            StatusEnum.ACTIVE.name());

            // If not found, try to find any field (including DELETED) to reactivate it
            if (optionalInstCF.isEmpty()) {
                List<InstituteCustomField> allFields = instituteCustomFieldRepository
                        .findByInstituteIdAndTypeAndTypeIdAndStatusIn(
                                dto.getInstituteId(),
                                dto.getType(),
                                dto.getTypeId(),
                                List.of(StatusEnum.ACTIVE.name(), StatusEnum.DELETED.name()));
                
                optionalInstCF = allFields.stream()
                        .filter(field -> field.getCustomFieldId().equals(cf.getId()))
                        .findFirst();
            }

            InstituteCustomField instCF;

            if (optionalInstCF.isPresent()) {
                instCF = optionalInstCF.get();
                // Reactivate if it was deleted
                if (StatusEnum.DELETED.name().equals(instCF.getStatus())) {
                    instCF.setStatus(StatusEnum.ACTIVE.name());
                }
                // Update mutable fields for existing mapping
                if (StringUtils.hasText(dto.getGroupName())) {
                    instCF.setGroupName(dto.getGroupName());
                }
                if (dto.getGroupInternalOrder() != null) {
                    instCF.setGroupInternalOrder(dto.getGroupInternalOrder());
                }
                if (dto.getIndividualOrder() != null) {
                    instCF.setIndividualOrder(dto.getIndividualOrder());
                }
                if (dto.getIsMandatory() != null) {
                    instCF.setIsMandatory(dto.getIsMandatory());
                }
            } else {
                instCF = new InstituteCustomField(dto);
                instCF.setCustomFieldId(cf.getId());
            }
            
            instCFList.add(instCF);
        }

        if (!instCFList.isEmpty()) {
            instituteCustomFieldRepository.saveAll(instCFList);
        }
    }

    /**
     * Find existing custom field or create new one with pessimistic locking to
     * prevent duplicates.
     *
     * Two-step lookup so we never hit the unique-constraint on field_key:
     *   1. Look up by (field_key, status=ACTIVE) — happy path, reuses the
     *      live custom_field row across features.
     *   2. If not found, look up by field_key regardless of status. If a
     *      DELETED row exists with this key (e.g. the admin previously
     *      removed the field from Settings), reactivate it instead of
     *      INSERTing a new row that would collide on field_key UNIQUE.
     *   3. Only as a last resort do we INSERT a brand-new row.
     *
     * Both repository calls return {@code List<CustomFields>} (not Optional)
     * to tolerate historical duplicates that share field_key — we always
     * take the first (most recent by created_at DESC).
     */
    private CustomFields findOrCreateCustomFieldWithLock(String fieldKey, CustomFieldDTO cfDto) {
        List<CustomFields> active = customFieldRepository.findByFieldKeyWithLock(fieldKey,
                StatusEnum.ACTIVE.name());
        if (!active.isEmpty()) {
            CustomFields existing = active.get(0);
            applyMutableFieldUpdates(existing, cfDto);
            return customFieldRepository.save(existing);
        }

        // No active row — check for ANY row with the same key (including
        // DELETED) and reactivate it. This unblocks two scenarios:
        //   - "I deleted this field, now I'm re-adding it in another feature"
        //   - Cross-feature reuse where the field was created in feature A
        //     and is now being added in feature B
        List<CustomFields> anyStatus = customFieldRepository.findByFieldKeyAnyStatusWithLock(fieldKey);
        if (!anyStatus.isEmpty()) {
            CustomFields existing = anyStatus.get(0);
            existing.setStatus(StatusEnum.ACTIVE.name());
            applyMutableFieldUpdates(existing, cfDto);
            return customFieldRepository.save(existing);
        }

        CustomFields newCF = new CustomFields(cfDto);
        newCF.setFieldKey(fieldKey);
        return customFieldRepository.save(newCF);
    }

    private void applyMutableFieldUpdates(CustomFields existing, CustomFieldDTO cfDto) {
        applyDefinitionUpdates(existing, cfDto);
        if (cfDto.getIsMandatory() != null) {
            existing.setIsMandatory(cfDto.getIsMandatory());
        }
    }

    /**
     * The parts of a field that live only on the master row and have no per-form
     * home: its type, its label and its option list. Editing any of them in a form
     * builder has to reach {@code custom_fields} or the edit is lost.
     */
    private void applyDefinitionUpdates(CustomFields existing, CustomFieldDTO cfDto) {
        if (StringUtils.hasText(cfDto.getConfig())) {
            if (holdsShreddedOptions(cfDto.getConfig())) {
                // A client that comma-split the stored JSON option array is now sending
                // the shards back as if they were the options. Writing them destroys a
                // live form's choices — on 19 Aug 2026 it turned five Vasco Maritime
                // fields into a wall of `[{"id":1`, `"value":"SOCIAL MEDIA"` checkboxes
                // on the public lead form. The shards carry no information the stored
                // config does not already hold, so keep what is on the row.
                log.warn("Ignoring shredded option config for custom field {} ({}): {}",
                        existing.getId(), existing.getFieldName(), cfDto.getConfig());
            } else {
                existing.setConfig(cfDto.getConfig());
            }
        } else if (StringUtils.hasText(cfDto.getFieldType())
                && !typeTakesOptions(cfDto.getFieldType())
                && holdsOptionList(existing.getConfig())) {
            // The field was a choice type and is not any more. Leaving the old option
            // list on the row makes those options reappear the moment it is switched
            // back to a choice type. A settings config (help text, file limits) is left
            // alone — only an option list is cleared.
            existing.setConfig(null);
        }
        if (StringUtils.hasText(cfDto.getFieldName())) {
            existing.setFieldName(cfDto.getFieldName());
        }
        if (StringUtils.hasText(cfDto.getFieldType())) {
            existing.setFieldType(cfDto.getFieldType());
        }
        // form_order is deliberately NOT written here. It is the shared catalog
        // position; a per-form reorder belongs in institute_custom_fields.individual_order,
        // and writing it back would let one form reshuffle every other form that
        // reuses the same field.
    }

    /** Field types that render an option list, so a config full of options belongs to them. */
    private boolean typeTakesOptions(String fieldType) {
        if (!StringUtils.hasText(fieldType)) {
            return false;
        }
        String normalized = fieldType.trim().toUpperCase();
        return FieldTypeEnum.DROPDOWN.name().equals(normalized)
                || FieldTypeEnum.RADIO.name().equals(normalized)
                || FieldTypeEnum.MULTI_SELECT.name().equals(normalized)
                || "SELECT".equals(normalized);
    }

    /**
     * True when the stored config is an option list rather than field settings.
     * Covers the three shapes in the wild: a bare JSON array, an object holding
     * {@code options}, and the legacy {@code coommaSepartedOptions} spelling.
     */
    private boolean holdsOptionList(String config) {
        if (!StringUtils.hasText(config)) {
            return false;
        }
        String trimmed = config.trim();
        return trimmed.startsWith("[")
                || trimmed.contains("coommaSepartedOptions")
                || trimmed.contains("commaSeparatedOptions")
                || trimmed.contains("\"options\"");
    }

    /**
     * An option label is never a piece of JSON. These are what a naive
     * {@code config.split(",")} leaves behind when it is fed the JSON array the
     * builder writes: {@code [{"id":1}, {"value":"SOCIAL MEDIA"}, {"label":"SOCIAL MEDIA"}} …
     */
    private static final java.util.regex.Pattern SHREDDED_OPTION =
            java.util.regex.Pattern.compile("^[\\[{]*\\s*\"(id|value|label|name)\"\\s*:");

    /**
     * True when {@code config} is an option array whose options are themselves
     * fragments of a serialised option array — the fingerprint of a client that
     * comma-split a JSON config and is now saving the pieces.
     */
    private boolean holdsShreddedOptions(String config) {
        if (!StringUtils.hasText(config)) {
            return false;
        }
        String trimmed = config.trim();
        if (!trimmed.startsWith("[")) {
            return false;
        }
        try {
            JsonNode parsed = shreddedOptionMapper.readTree(trimmed);
            if (!parsed.isArray() || parsed.isEmpty()) {
                return false;
            }
            for (JsonNode option : parsed) {
                for (String key : new String[] { "value", "label", "name" }) {
                    JsonNode field = option.get(key);
                    if (field != null && field.isTextual()
                            && SHREDDED_OPTION.matcher(field.asText().trim()).find()) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            // Not parseable as JSON — a legacy "A,B,C" config, which this check
            // has nothing to say about. Leave it to the caller to store as-is.
            return false;
        }
        return false;
    }

    /**
     * Unified per-feature custom-field sync.
     *
     * Used by every feature flow that owns its own list of custom fields
     * (Enroll Invite, Audience, Live Session, Assessment). Semantics:
     *
     *   1. Load every existing ACTIVE mapping for the (institute, type, typeId) tuple.
     *   2. Walk the incoming list:
     *        - If the entry has a customFieldId → reuse the existing master
     *          custom_fields row. Reactivate any matching DELETED mapping or
     *          create a new ACTIVE one.
     *        - If the entry has no customFieldId (an "ad-hoc" field added in
     *          the feature dialog) → create a new master custom_fields row
     *          AND a new mapping with the feature type/typeId. NO
     *          DEFAULT_CUSTOM_FIELD mapping is created — defaults are managed
     *          exclusively from Settings → Custom Fields.
     *   3. Soft-delete every previously-ACTIVE mapping that is no longer in
     *      the incoming list. Existing custom_field_values are untouched, so
     *      a future re-add of the same field reactivates and the answers
     *      come back.
     *
     * The caller is expected to have already persisted the parent entity
     * (so typeId is non-null) before calling this method.
     */
    @Transactional
    public void syncFeatureCustomFields(String instituteId,
                                        String type,
                                        String typeId,
                                        List<InstituteCustomFieldDTO> incoming) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(type) || !StringUtils.hasText(typeId)) {
            throw new VacademyException("instituteId, type and typeId are required for syncFeatureCustomFields");
        }

        List<InstituteCustomFieldDTO> safeIncoming = incoming == null ? new ArrayList<>() : incoming;

        // Normalize: stamp every incoming DTO with the right institute/type/typeId,
        // and clear any stale primary key so the upsert path can find or create
        // the correct mapping.
        safeIncoming.forEach(dto -> {
            if (dto == null) return;
            dto.setInstituteId(instituteId);
            dto.setType(type);
            dto.setTypeId(typeId);
            dto.setId(null);
        });

        // 1. Snapshot which mappings are currently ACTIVE *before* we upsert,
        //    so we know what was there before this save. We'll diff against
        //    this set in step 3.
        List<InstituteCustomField> existingBeforeUpsert = instituteCustomFieldRepository
                .findByInstituteIdAndTypeAndTypeIdAndStatusIn(instituteId, type, typeId,
                        List.of(StatusEnum.ACTIVE.name()));
        Set<String> existingFieldIdsBefore = existingBeforeUpsert.stream()
                .map(InstituteCustomField::getCustomFieldId)
                .collect(Collectors.toSet());

        // 2. Persist (insert / reactivate / update) every incoming mapping.
        List<InstituteCustomFieldDTO> toUpsert = safeIncoming.stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        if (!toUpsert.isEmpty()) {
            addOrUpdateCustomField(toUpsert);
        }

        // 3. Soft-delete pre-existing mappings that the admin removed.
        //    Compare the pre-upsert snapshot against the incoming DTOs.
        //    For new ad-hoc fields (empty custom_field.id in DTO), they
        //    won't be in the pre-upsert snapshot so they're safe.
        if (existingBeforeUpsert.isEmpty()) {
            return;
        }

        // Build the "wanted" set from incoming DTOs. For DTOs with a
        // custom_field.id, use that. For DTOs without one (new fields),
        // look up the generated key to find the master row that was just
        // created by addOrUpdateCustomField.
        Set<String> wantedFieldIds = new HashSet<>();
        for (InstituteCustomFieldDTO dto : toUpsert) {
            String cfId = dto.getCustomField() != null ? dto.getCustomField().getId() : null;
            if (StringUtils.hasText(cfId)) {
                wantedFieldIds.add(cfId);
            } else if (dto.getCustomField() != null && StringUtils.hasText(dto.getCustomField().getFieldName())) {
                // New field — find the master row that was just created by key
                String generatedKey = keyGenerator.generateFieldKey(dto.getCustomField().getFieldName(), instituteId);
                Optional<CustomFields> created = customFieldRepository.findTopByFieldKeyAndStatusOrderByCreatedAtDesc(
                        generatedKey, StatusEnum.ACTIVE.name());
                created.ifPresent(cf -> wantedFieldIds.add(cf.getId()));
            }
            if (StringUtils.hasText(dto.getFieldId())) {
                wantedFieldIds.add(dto.getFieldId());
            }
        }

        List<InstituteCustomField> toDelete = existingBeforeUpsert.stream()
                .filter(row -> !wantedFieldIds.contains(row.getCustomFieldId()))
                .collect(Collectors.toList());

        if (!toDelete.isEmpty()) {
            List<InstituteCustomField> freshRows = instituteCustomFieldRepository
                    .findAllById(toDelete.stream().map(InstituteCustomField::getId).collect(Collectors.toList()));
            freshRows.forEach(row -> row.setStatus(StatusEnum.DELETED.name()));
            instituteCustomFieldRepository.saveAll(freshRows);
        }
    }

    public List<InstituteCustomFieldDTO> findCustomFieldsAsJson(String instituteId, String type, String typeId) {

        // Step 1: Call the repository to fetch the joined entities
        List<Object[]> results = instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(instituteId, type,
                typeId);

        // Step 2: Convert the list of results into a list of InstituteCustomFieldDTOs and filter only ACTIVE ones
        List<InstituteCustomFieldDTO> dtoList = results.stream()
                .map(this::convertToInstituteCustomFieldDto)
                .filter(dto -> StatusEnum.ACTIVE.name().equals(dto.getStatus()))
                .collect(Collectors.toList());

        return dtoList;
    }

    public List<InstituteCustomFieldDTO> findActiveCustomFieldsWithNullTypeId(String instituteId) {
        List<Object[]> results = instituteCustomFieldRepository
                .findActiveInstituteCustomFieldsWithNullTypeId(instituteId, StatusEnum.ACTIVE.name());
        return results.stream().map(this::convertToInstituteCustomFieldDto).collect(Collectors.toList());
    }

    public int softDeleteInstituteCustomField(String instituteId, String type, String customFieldId) {
        return instituteCustomFieldRepository.updateStatusByInstituteIdAndTypeAndCustomFieldId(
                instituteId, type, customFieldId, StatusEnum.DELETED.name());
    }

    public int softDeleteInstituteCustomFieldsBulk(List<InstituteCustomFieldDeleteRequestDTO> requestDTOS,
            String instituteId) {
        if (requestDTOS == null || requestDTOS.isEmpty())
            return 0;
        int total = 0;
        for (InstituteCustomFieldDeleteRequestDTO entry : requestDTOS) {
            total += instituteCustomFieldRepository.updateStatusByInstituteIdAndTypeAndCustomFieldId(
                    instituteId, entry.getType(), entry.getCustomFieldId(), StatusEnum.DELETED.name());
        }
        return total;
    }

    /**
     * List every ACTIVE mapping for one custom field across all feature
     * instances. Used by the Settings → Custom Fields cascade-delete dialog
     * so the admin can pick which mappings to soft-delete (DEFAULT,
     * individual ENROLL_INVITE rows, individual AUDIENCE_FORM rows, etc.).
     *
     * <p>Returns a flat list — the frontend groups by {@code type} for display.
     */
    public List<CustomFieldMappingUsageDTO> getCustomFieldUsages(String instituteId, String customFieldId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(customFieldId)) {
            return new ArrayList<>();
        }
        List<InstituteCustomField> rows = instituteCustomFieldRepository
                .findByInstituteIdAndCustomFieldIdInAndStatusIn(
                        instituteId,
                        List.of(customFieldId),
                        List.of(StatusEnum.ACTIVE.name()));
        return rows.stream()
                .map(row -> CustomFieldMappingUsageDTO.builder()
                        .mappingId(row.getId())
                        .type(row.getType())
                        .typeId(row.getTypeId())
                        .typeDisplayName(resolveTypeDisplayName(row.getType(), row.getTypeId()))
                        .status(row.getStatus())
                        .build())
                .collect(Collectors.toList());
    }

    private String resolveTypeDisplayName(String type, String typeId) {
        if (!StringUtils.hasText(typeId)) return null;
        try {
            if (CustomFieldTypeEnum.ENROLL_INVITE.name().equals(type)) {
                return enrollInviteRepository.findById(typeId).map(e -> e.getName()).orElse(null);
            }
            if (CustomFieldTypeEnum.AUDIENCE_FORM.name().equals(type)) {
                return audienceRepository.findById(typeId).map(a -> a.getCampaignName()).orElse(null);
            }
            if (CustomFieldTypeEnum.SESSION.name().equals(type)) {
                return liveSessionRepository.findById(typeId).map(s -> s.getTitle()).orElse(null);
            }
        } catch (Exception e) {
            // Silently return null if the parent entity was deleted
        }
        return null;
    }

    /**
     * Soft-delete a list of {@code institute_custom_fields} rows by id.
     *
     * <p>"Delete" here means: status flipped to DELETED. Nothing else
     * happens — the master {@code custom_fields} row stays intact, and any
     * {@code custom_field_values} answers stored against the field stay in
     * place. This is intentional: the unified {@code syncFeatureCustomFields}
     * is reactivation-aware, so a future re-add of the same field on the
     * same feature instance flips the row back to ACTIVE and the answers
     * come back automatically.
     *
     * <p>Used by the Settings → Custom Fields cascade-delete dialog. Returns
     * the number of rows actually flipped (rows already DELETED are
     * skipped).
     */
    @Transactional
    public int softDeleteMappingsByIds(List<String> mappingIds) {
        if (CollectionUtils.isEmpty(mappingIds)) {
            return 0;
        }
        List<InstituteCustomField> rows = instituteCustomFieldRepository.findAllById(mappingIds);
        int flipped = 0;
        for (InstituteCustomField row : rows) {
            if (!StatusEnum.DELETED.name().equals(row.getStatus())) {
                row.setStatus(StatusEnum.DELETED.name());
                flipped++;
            }
        }
        if (flipped > 0) {
            instituteCustomFieldRepository.saveAll(rows);
        }
        return flipped;
    }

    public List<InstituteCustomFieldSetupDTO> findUniqueActiveCustomFieldsByInstituteId(String instituteId) {
        List<Object[]> results = instituteCustomFieldRepository
                .findUniqueActiveCustomFieldsByInstituteId(instituteId, StatusEnum.ACTIVE.name());
        return results.stream().map(this::convertToInstituteCustomFieldSetupDto).collect(Collectors.toList());
    }

    /**
     * Searchable, paginated list of the distinct values a custom field holds
     * across an institute's learners — feeds the Manage Students filter bar's
     * multi-select dropdown for free-text custom fields (e.g. VetEducation's
     * "Practice Type") that have no fixed DROPDOWN option list to draw from.
     */
    public Page<String> getStudentCustomFieldValues(String instituteId, String customFieldId,
            String search, int pageNo, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNo, 0), pageSize > 0 ? pageSize : 20);
        if (instituteId == null || instituteId.isBlank()
                || customFieldId == null || customFieldId.isBlank()) {
            return Page.empty(pageable);
        }
        String normalizedSearch = (search != null && !search.isBlank()) ? search.trim() : null;
        return customFieldValuesRepository.findDistinctStudentCustomFieldValues(
                instituteId, customFieldId, normalizedSearch, pageable);
    }

    /**
     * Helper method to convert a result object array into a populated
     * InstituteCustomFieldDTO.
     *
     * @param result An object array containing [InstituteCustomField,
     *               CustomFields].
     * @return A populated InstituteCustomFieldDTO.
     */
    private InstituteCustomFieldDTO convertToInstituteCustomFieldDto(Object[] result) {
        InstituteCustomField icf = (InstituteCustomField) result[0];
        CustomFields cf = (CustomFields) result[1];

        // Create and populate the nested CustomFieldDTO
        CustomFieldDTO customFieldDTO = new CustomFieldDTO();
        customFieldDTO.setId(cf.getId());
        customFieldDTO.setFieldKey(cf.getFieldKey());
        customFieldDTO.setFieldName(cf.getFieldName());
        customFieldDTO.setFieldType(cf.getFieldType());
        customFieldDTO.setDefaultValue(cf.getDefaultValue());
        customFieldDTO.setConfig(cf.getConfig());
        customFieldDTO.setFormOrder(cf.getFormOrder());
        customFieldDTO.setIsMandatory(cf.getIsMandatory());
        customFieldDTO.setIsFilter(cf.getIsFilter());
        customFieldDTO.setIsSortable(cf.getIsSortable());
        customFieldDTO.setIsHidden(cf.getIsHidden());
        if (cf.getCreatedAt() != null) {
            customFieldDTO.setCreatedAt(new Timestamp(cf.getCreatedAt().getTime()));
        }
        if (cf.getUpdatedAt() != null) {
            customFieldDTO.setUpdatedAt(new Timestamp(cf.getUpdatedAt().getTime()));
        }

        customFieldDTO.setSessionId(icf.getTypeId());

        InstituteCustomFieldDTO instituteDTO = new InstituteCustomFieldDTO();
        instituteDTO.setId(icf.getId());
        instituteDTO.setFieldId(cf.getId()); // the CustomFields PK — used as dedup key in aggregation
        instituteDTO.setInstituteId(icf.getInstituteId());
        instituteDTO.setType(icf.getType());
        instituteDTO.setTypeId(icf.getTypeId());
        instituteDTO.setGroupName(icf.getGroupName());
        instituteDTO.setIndividualOrder(icf.getIndividualOrder());
        instituteDTO.setGroupInternalOrder(icf.getGroupInternalOrder());
        instituteDTO.setIsMandatory(icf.getIsMandatory());
        instituteDTO.setCustomField(customFieldDTO);
        instituteDTO.setStatus(icf.getStatus());
        return instituteDTO;
    }

    private InstituteCustomFieldSetupDTO convertToInstituteCustomFieldSetupDto(Object[] result) {
        InstituteCustomField icf = (InstituteCustomField) result[0];
        CustomFields cf = (CustomFields) result[1];

        InstituteCustomFieldSetupDTO setupDTO = new InstituteCustomFieldSetupDTO();
        setupDTO.setCustomFieldId(cf.getId());
        setupDTO.setFieldKey(cf.getFieldKey());
        setupDTO.setFieldName(cf.getFieldName());
        setupDTO.setFieldType(cf.getFieldType());
        setupDTO.setFormOrder(cf.getFormOrder());
        setupDTO.setIsHidden(cf.getIsHidden());
        setupDTO.setGroupName(icf.getGroupName());
        setupDTO.setType(icf.getType());
        setupDTO.setTypeId(icf.getTypeId());
        setupDTO.setStatus(icf.getStatus());

        return setupDTO;
    }

    public List<InstituteCustomField> createDefaultCustomFieldsForInstitute(Institute institute) {
        CustomFields nameCustomFields = CustomFields.builder()
                .fieldKey("full_name")
                .fieldName("Full Name")
                .defaultValue(null)
                .fieldType("text")
                .config("{}")
                .isMandatory(false)
                .isFilter(true)
                .isSortable(true)
                .build();

        CustomFields emailCustomFields = CustomFields.builder()
                .fieldKey("email")
                .fieldName("Email")
                .defaultValue(null)
                .fieldType("text")
                .config("{}")
                .isMandatory(false)
                .isFilter(true)
                .isSortable(true)
                .build();

        CustomFields phoneCustomFields = CustomFields.builder()
                .fieldKey("phone_number")
                .fieldName("Phone Number")
                .defaultValue(null)
                .fieldType("number")
                .config("{}")
                .isMandatory(false)
                .isFilter(true)
                .isSortable(true)
                .build();

        List<CustomFields> allDefaultCustomFields = List.of(nameCustomFields, emailCustomFields, phoneCustomFields);
        List<CustomFields> allSavedCustomFields = customFieldRepository.saveAll(allDefaultCustomFields);
        List<InstituteCustomField> defaultInstituteCustomFields = new ArrayList<>();

        allSavedCustomFields.forEach(customField -> {
            defaultInstituteCustomFields.add(InstituteCustomField.builder()
                    .customFieldId(customField.getId())
                    .instituteId(institute.getId())
                    .status("ACTIVE")
                    .type(CustomFieldTypeEnum.DEFAULT_CUSTOM_FIELD.name())
                    .build());
        });

        return instituteCustomFieldRepository.saveAll(defaultInstituteCustomFields);
    }

    public Optional<CustomFields> getCustomFieldById(String customFieldId) {
        return customFieldRepository.findById(customFieldId);
    }

    public CustomFields createCustomFieldFromRequest(CustomFieldDTO request, String instuteID) {
        if (Objects.isNull(request))
            throw new VacademyException("Invalid Request");

        // Generate field key if not provided
        String fieldKey = request.getFieldKey();
        if (fieldKey == null || fieldKey.trim().isEmpty()) {
            fieldKey = keyGenerator.generateFieldKey(request.getFieldName(), instuteID);
        }

        return customFieldRepository.save(CustomFields.builder()
                .fieldName(request.getFieldName())
                .fieldKey(fieldKey)
                .fieldType(request.getFieldType())
                .defaultValue(request.getDefaultValue())
                .config(request.getConfig())
                .isSortable(request.getIsSortable())
                .isMandatory(request.getIsMandatory()).build());
    }

    /**
     * Find custom field by field key for a specific institute.
     * First checks if the field exists with a proper institute mapping,
     * then falls back to global fieldKey lookup for backward compatibility with old
     * data.
     * Since fieldKey contains _inst_{instituteId}, the global lookup is still
     * institute-scoped.
     */
    public Optional<CustomFields> findCustomFieldByKeyAndInstitute(String fieldKey, String instituteId) {
        // First try to find via institute mapping (proper way)
        Optional<CustomFields> withMapping = customFieldRepository.findByFieldKeyAndInstituteId(fieldKey, instituteId);
        if (withMapping.isPresent()) {
            return withMapping;
        }
        // Fallback: check by fieldKey directly (for backward compatibility with old
        // data)
        // This works because fieldKey already contains _inst_{instituteId}
        return customFieldRepository.findTopByFieldKeyAndStatusOrderByCreatedAtDesc(fieldKey, StatusEnum.ACTIVE.name());
    }

    /**
     * Find custom field by field key globally
     */
    public Optional<CustomFields> findCustomFieldByKey(String fieldKey) {
        return customFieldRepository.findByFieldKey(fieldKey);
    }

    /**
     * Generate field key from field name
     */
    public String generateFieldKey(String fieldName, String instituteId) {
        return keyGenerator.generateFieldKey(fieldName, instituteId);
    }

    /**
     * Create or find existing custom field by key for institute.
     * Uses pessimistic locking to prevent race conditions and duplicates.
     */
    @Transactional
    public CustomFields createOrFindCustomFieldByKey(CustomFieldDTO request, String instituteId) {
        if (Objects.isNull(request))
            throw new VacademyException("Invalid Request");

        String fieldKey = keyGenerator.generateFieldKey(request.getFieldName(), instituteId);

        return findOrCreateCustomFieldWithLock(fieldKey, request);
    }

    public InstituteCustomField createInstituteMappingFromCustomField(CustomFields savedCustomField,
            Institute institute, CustomFieldDTO request) {
        return instituteCustomFieldRepository.save(InstituteCustomField.builder()
                .customFieldId(savedCustomField.getId())
                .instituteId(institute.getId())
                .type(CustomFieldTypeEnum.DEFAULT_CUSTOM_FIELD.name())
                .individualOrder(request.getIndividualOrder())
                .groupInternalOrder(request.getGroupInternalOrder()).build());
    }

    /**
     * Find default custom fields for an institute
     */
    public List<InstituteCustomField> findDefaultCustomFieldsByInstituteId(String instituteId) {
        return instituteCustomFieldRepository.findByInstituteIdAndTypeAndTypeIdAndStatusIn(
                instituteId,
                CustomFieldTypeEnum.DEFAULT_CUSTOM_FIELD.name(),
                null,
                List.of(StatusEnum.ACTIVE.name())
        );
    }

    /**
     * Copy default custom fields for an institute to enroll invite type.
     *
     * <p>Used only by <strong>system-generated</strong> enroll invite creation
     * paths (e.g. bulk course import, default enroll invite generation) where
     * there is no admin UI to pick fields. Admin-driven create / edit flows
     * should call {@link #syncFeatureCustomFields(String, String, String, java.util.List)}
     * directly with the explicit list the admin selected.
     *
     * <p>Routes through the unified sync so that re-runs are idempotent and
     * any previously soft-deleted mappings are reactivated rather than
     * duplicated.
     */
    public void copyDefaultCustomFieldsToEnrollInvite(String instituteId, String enrollInviteId) {
        if (instituteId == null || enrollInviteId == null) {
            return;
        }

        List<InstituteCustomFieldDTO> defaultCustomFieldsToCopy = getDefaultCustomFieldsForEnrollInvite(instituteId, enrollInviteId);
        if (!defaultCustomFieldsToCopy.isEmpty()) {
            syncFeatureCustomFields(instituteId,
                    CustomFieldTypeEnum.ENROLL_INVITE.name(),
                    enrollInviteId,
                    defaultCustomFieldsToCopy);
        }
    }

    /**
     * Get default custom fields for an institute and convert them to ENROLL_INVITE type for the given enroll invite ID
     */
    private List<InstituteCustomFieldDTO> getDefaultCustomFieldsForEnrollInvite(String instituteId, String enrollInviteId) {
        List<InstituteCustomField> defaultCustomFields = findDefaultCustomFieldsByInstituteId(instituteId);

        return defaultCustomFields.stream()
                .filter(defaultField -> defaultField.getCustomFieldId() != null) // Filter out any null customFieldIds
                .map(defaultField -> {
                    InstituteCustomFieldDTO dto = new InstituteCustomFieldDTO();
                    dto.setInstituteId(instituteId);
                    dto.setFieldId(defaultField.getCustomFieldId());
                    dto.setType(CustomFieldTypeEnum.ENROLL_INVITE.name());
                    dto.setTypeId(enrollInviteId);
                    dto.setStatus(StatusEnum.ACTIVE.name());
                    dto.setIndividualOrder(defaultField.getIndividualOrder());
                    dto.setGroupInternalOrder(defaultField.getGroupInternalOrder());
                    
                    // Set customField with id so addOrUpdateCustomField can find the existing CustomFields entity
                    CustomFieldDTO customFieldDTO = new CustomFieldDTO();
                    customFieldDTO.setId(defaultField.getCustomFieldId());
                    dto.setCustomField(customFieldDTO);
                    
                    return dto;
                })
                .collect(Collectors.toList());
    }

    /**
     * Same as the overload below, for callers that hold an institute id but not
     * the entity — the `institute` argument there is accepted and never read.
     */
    public String updateCustomField(CustomFieldDTO request, String fieldId) {
        return updateCustomField(null, request, fieldId);
    }

    public String updateCustomField(Institute institute, CustomFieldDTO request, String fieldId) {
        Optional<CustomFields> customFieldsOptional = customFieldRepository.findById(fieldId);
        if (customFieldsOptional.isEmpty()) {
            throw new VacademyException("Custom Field Not Found");
        }

        CustomFields customField = customFieldsOptional.get();

        // Update fields from request DTO
        if (request.getFieldKey() != null)
            customField.setFieldKey(request.getFieldKey());
        if (request.getFieldName() != null)
            customField.setFieldName(request.getFieldName());
        if (request.getFieldType() != null)
            customField.setFieldType(request.getFieldType());
        if (request.getDefaultValue() != null)
            customField.setDefaultValue(request.getDefaultValue());
        if (request.getConfig() != null)
            customField.setConfig(request.getConfig());

        if (request.getFormOrder() != null)
            customField.setFormOrder(request.getFormOrder());
        if (request.getIsMandatory() != null)
            customField.setIsMandatory(request.getIsMandatory());
        if (request.getIsFilter() != null)
            customField.setIsFilter(request.getIsFilter());
        if (request.getIsSortable() != null)
            customField.setIsSortable(request.getIsSortable());

        // Save updated field
        customFieldRepository.save(customField);

        return "Custom Field with id " + fieldId + " updated successfully.";
    }

    public Optional<InstituteCustomField> getCustomFieldByInstituteIdAndName(String instituteId, String fieldName) {
        return instituteCustomFieldRepository.findByInstituteIdAndFieldName(instituteId, fieldName);
    }

    public Optional<InstituteCustomField> getByInstituteIdAndFieldIdAndTypeAndTypeId(String instituteId, String fieldId,
            String type, String typeId) {
        return instituteCustomFieldRepository
                .findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(instituteId, fieldId,
                        type, typeId, StatusEnum.ACTIVE.name());
    }

    public InstituteCustomField createorupdateinstutefieldmapping(InstituteCustomField instituteCustomField) {
        return instituteCustomFieldRepository.save(instituteCustomField);
    }

    public List<InstituteCustomField> createOrUpdateMappings(List<InstituteCustomField> allMappings) {
        return instituteCustomFieldRepository.saveAll(allMappings);
    }

    public List<InstituteCustomField> getAllMappingFromIds(List<String> request) {
        return instituteCustomFieldRepository.findAllById(request);
    }

    public List<CustomFields> getAllCustomFields(List<String> allFieldIds) {
        return customFieldRepository.findAllById(allFieldIds);
    }

    public void createOrSaveAllFields(List<CustomFields> allFields) {
        customFieldRepository.saveAll(allFields);
    }

    public List<InstituteCustomField> getCusFieldByInstituteAndTypeAndTypeId(String instituteId, String type,
            String typeId, List<String> status) {
        return instituteCustomFieldRepository.findByInstituteIdAndTypeAndTypeIdAndStatusIn(instituteId, type, typeId,
                status);
    }

    public CustomFieldDTO getCustomFieldDtoFromId(String customFieldId) {
        Optional<CustomFields> customFields = customFieldRepository.findById(customFieldId);
        if (customFields.isPresent()) {
            return CustomFieldDTO.builder()
                    .id(customFieldId)
                    .fieldName(customFields.get().getFieldName())
                    .fieldKey(customFields.get().getFieldKey())
                    .fieldType(customFields.get().getFieldType())
                    .defaultValue(customFields.get().getDefaultValue())
                    .build();
        }
        throw new VacademyException("Custom Field Not Found");
    }

    /**
     * Find custom fields by institute, type, and typeId (all statuses)
     */
    public List<InstituteCustomField> findByInstituteIdAndTypeAndTypeId(String instituteId, String type, String typeId) {
        return instituteCustomFieldRepository.findByInstituteIdAndTypeAndTypeIdAndStatusIn(
                instituteId, type, typeId, List.of(StatusEnum.ACTIVE.name(), StatusEnum.DELETED.name()));
    }

    /**
     * Update status of multiple custom fields
     */
    @Transactional
    public void updateCustomFieldStatus(List<InstituteCustomField> fields) {
        if (!CollectionUtils.isEmpty(fields)) {
            instituteCustomFieldRepository.saveAll(fields);
        }
    }

    public List<InstituteCustomField> getAllMappingFromFieldsIds(String instituteId, List<CustomFields> allFields,
            List<String> status) {
        return instituteCustomFieldRepository.findByInstituteIdAndCustomFieldIdInAndStatusIn(instituteId,
                allFields.stream().map(CustomFields::getId).toList(), status);
    }

    public List<CustomFieldValues> updateOrCreateCustomFieldsValues(List<CustomFieldValues> response) {
        return customFieldValuesRepository.saveAll(response);
    }

    /**
     * Get all active DROPDOWN type custom fields for an institute
     * Database query handles deduplication using DISTINCT ON
     */
    public List<CustomFieldDTO> getActiveDropdownCustomFields(String instituteId) {
        List<CustomFields> dropdownFields = customFieldRepository.findDropdownCustomFieldsByInstituteId(
                instituteId,
                FieldTypeEnum.DROPDOWN.name(),
                StatusEnum.ACTIVE.name());

        return dropdownFields.stream()
                .map(field -> CustomFieldDTO.builder()
                        .id(field.getId())
                        .fieldKey(field.getFieldKey())
                        .fieldName(field.getFieldName())
                        .fieldType(field.getFieldType())
                        .defaultValue(field.getDefaultValue())
                        .config(field.getConfig())
                        .formOrder(field.getFormOrder())
                        .isMandatory(field.getIsMandatory())
                        .isFilter(field.getIsFilter())
                        .isSortable(field.getIsSortable())
                        .isHidden(field.getIsHidden())
                        .createdAt(new Timestamp(field.getCreatedAt().getTime()))
                        .updatedAt(new Timestamp(field.getUpdatedAt().getTime()))
                        .build())
                .collect(Collectors.toList());
    }

    public List<vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldUsageDTO> getCustomFieldsUsage(
            String instituteId) {
        List<Object[]> rawData = instituteCustomFieldRepository.findCustomFieldUsageAggregation(instituteId);

        // Map to hold Usage DTOs keyed by CustomField ID
        Map<String, vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldUsageDTO> usageMap = new HashMap<>();

        for (Object[] row : rawData) {
            CustomFields cf = (CustomFields) row[0];
            String type = (String) row[1];
            Long count = (Long) row[2];

            vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldUsageDTO usageDTO = usageMap
                    .computeIfAbsent(cf.getId(), k -> {
                        CustomFieldDTO cfDTO = CustomFieldDTO.builder()
                                .id(cf.getId())
                                .fieldName(cf.getFieldName())
                                .fieldKey(cf.getFieldKey())
                                .fieldType(cf.getFieldType())
                                .defaultValue(cf.getDefaultValue())
                                .config(cf.getConfig())
                                .formOrder(cf.getFormOrder())
                                .isMandatory(cf.getIsMandatory())
                                .isFilter(cf.getIsFilter())
                                .isSortable(cf.getIsSortable())
                                .isHidden(cf.getIsHidden())
                                .build();

                        return vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldUsageDTO
                                .builder()
                                .customField(cfDTO)
                                .isDefault(false)
                                .enrollInviteCount(0)
                                .audienceCount(0)
                                .sessionCount(0)
                                .assessmentCount(0)
                                .build();
                    });

            if (CustomFieldTypeEnum.DEFAULT_CUSTOM_FIELD.name().equals(type)) {
                usageDTO.setDefault(true);
            } else if (CustomFieldTypeEnum.ENROLL_INVITE.name().equals(type)) {
                usageDTO.setEnrollInviteCount(usageDTO.getEnrollInviteCount() + count);
            } else if (CustomFieldTypeEnum.AUDIENCE_FORM.name().equals(type)) {
                usageDTO.setAudienceCount(usageDTO.getAudienceCount() + count);
            } else if (CustomFieldTypeEnum.SESSION.name().equals(type)) {
                usageDTO.setSessionCount(usageDTO.getSessionCount() + count);
            } else if (CustomFieldTypeEnum.ASSESSMENT.name().equals(type)) {
                usageDTO.setAssessmentCount(usageDTO.getAssessmentCount() + count);
            }
        }

        return new ArrayList<>(usageMap.values());
    }
}
