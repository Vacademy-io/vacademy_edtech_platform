package vacademy.io.admin_core_service.features.common.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.SystemFieldCustomFieldMapping;
import vacademy.io.admin_core_service.features.common.enums.EntityTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.SystemFieldCustomFieldMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;

import java.lang.reflect.Field;
import java.util.*;

/**
 * Service to synchronize data between system fields (entity columns) and custom fields.
 * 
 * This service handles bidirectional sync:
 * 1. When a custom field value changes → update corresponding system field(s)
 * 2. When a system field changes → update corresponding custom field(s)
 * 
 * Loop Prevention Strategy:
 * - Uses ThreadLocal to track sync operations within the same thread
 * - Tracks specific entity+field combinations to allow different fields to sync
 * - Clears tracking in finally block to prevent memory leaks
 */
@Service
public class FieldSyncService {

    private static final Logger logger = LoggerFactory.getLogger(FieldSyncService.class);

    @Autowired
    private SystemFieldCustomFieldMappingRepository mappingRepository;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private InstituteStudentRepository studentRepository;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository ssigmRepository;

    /**
     * Tracks which entity+field combinations are currently being synced to prevent loops.
     * Key format: "{entityType}:{entityId}:{fieldIdentifier}"
     */
    private static final ThreadLocal<Set<String>> SYNC_KEYS_IN_PROGRESS = 
        ThreadLocal.withInitial(HashSet::new);

    /**
     * Sync custom field value change to system field(s).
     * Call this when a custom field value is created or updated.
     * 
     * @param customFieldId The custom field that changed
     * @param sourceType    The source type (e.g., "USER", "STUDENT")
     * @param sourceId      The entity ID (e.g., userId, studentId)
     * @param newValue      The new value
     */
    @Transactional
    public void syncCustomFieldToSystemField(String customFieldId, String sourceType, 
                                              String sourceId, String newValue) {
        // Validate required parameters
        if (!StringUtils.hasText(customFieldId) || !StringUtils.hasText(sourceType) 
                || !StringUtils.hasText(sourceId)) {
            logger.debug("Missing required parameters for custom field sync");
            return;
        }
        
        String syncKey = buildSyncKey(sourceType, sourceId, "cf:" + customFieldId);
        
        if (isSyncInProgress(syncKey)) {
            logger.debug("Sync already in progress for key {}, skipping to prevent loop", syncKey);
            return;
        }

        try {
            markSyncInProgress(syncKey);

            List<SystemFieldCustomFieldMapping> mappings = 
                mappingRepository.findMappingsForCustomFieldSync(customFieldId);

            if (CollectionUtils.isEmpty(mappings)) {
                return;
            }

            for (SystemFieldCustomFieldMapping mapping : mappings) {
                String systemFieldKey = buildSyncKey(mapping.getEntityType(), sourceId, 
                                                      "sf:" + mapping.getSystemFieldName());
                if (isSyncInProgress(systemFieldKey)) {
                    continue; // Skip if target field is already being synced
                }
                
                try {
                    markSyncInProgress(systemFieldKey);
                    updateSystemFieldForSource(mapping.getEntityType(), sourceType, sourceId,
                                     mapping.getSystemFieldName(), newValue);
                    logger.info("Synced custom field {} to system field {}.{}", 
                               customFieldId, mapping.getEntityType(), mapping.getSystemFieldName());
                } catch (Exception e) {
                    logger.error("Failed to sync custom field {} to system field: {}", 
                                customFieldId, e.getMessage());
                } finally {
                    clearSyncInProgress(systemFieldKey);
                }
            }
        } finally {
            clearSyncInProgress(syncKey);
        }
    }

    /**
     * Sync system field change to custom field(s).
     * Call this when an entity field is updated.
     * 
     * @param instituteId     The institute ID
     * @param entityType      The entity type (STUDENT, USER, etc.)
     * @param entityId        The entity ID
     * @param systemFieldName The field that changed (e.g., "fullName")
     * @param newValue        The new value
     */
    @Transactional
    public void syncSystemFieldToCustomField(String instituteId, String entityType,
                                              String entityId, String systemFieldName, 
                                              String newValue) {
        // Validate required parameters
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(entityType) 
                || !StringUtils.hasText(entityId) || !StringUtils.hasText(systemFieldName)) {
            logger.debug("Missing required parameters for system field sync");
            return;
        }
        
        String syncKey = buildSyncKey(entityType, entityId, "sf:" + systemFieldName);
        
        if (isSyncInProgress(syncKey)) {
            logger.debug("Sync already in progress for key {}, skipping to prevent loop", syncKey);
            return;
        }

        try {
            markSyncInProgress(syncKey);

            List<SystemFieldCustomFieldMapping> mappings = 
                mappingRepository.findMappingsForSystemFieldSync(instituteId, entityType, systemFieldName);

            if (CollectionUtils.isEmpty(mappings)) {
                return;
            }

            for (SystemFieldCustomFieldMapping mapping : mappings) {
                String customFieldKey = buildSyncKey(entityType, entityId, 
                                                      "cf:" + mapping.getCustomFieldId());
                if (isSyncInProgress(customFieldKey)) {
                    continue; // Skip if target field is already being synced
                }
                
                try {
                    markSyncInProgress(customFieldKey);
                    upsertCustomFieldValue(mapping.getCustomFieldId(), entityType, entityId, newValue);
                    logger.info("Synced system field {}.{} to custom field {}", 
                               entityType, systemFieldName, mapping.getCustomFieldId());
                } catch (Exception e) {
                    logger.error("Failed to sync system field to custom field {}: {}", 
                                mapping.getCustomFieldId(), e.getMessage());
                } finally {
                    clearSyncInProgress(customFieldKey);
                }
            }
        } finally {
            clearSyncInProgress(syncKey);
        }
    }

    /**
     * Sync all system fields for an entity to their mapped custom fields.
     * Useful for initial population or bulk sync.
     */
    @Transactional
    public void syncAllSystemFieldsToCustomFields(String instituteId, String entityType, String entityId) {
        List<SystemFieldCustomFieldMapping> mappings = 
            mappingRepository.findAllMappingsForEntityType(instituteId, entityType);

        if (CollectionUtils.isEmpty(mappings)) {
            return;
        }

        Object entity = loadEntity(entityType, entityId);
        if (entity == null) {
            logger.warn("Entity not found: {} with ID {}", entityType, entityId);
            return;
        }

        for (SystemFieldCustomFieldMapping mapping : mappings) {
            if (mapping.getSyncDirection().name().equals("TO_SYSTEM")) {
                continue; // Skip mappings that don't sync to custom
            }

            try {
                String value = getFieldValue(entity, mapping.getSystemFieldName());
                if (StringUtils.hasText(value)) {
                    upsertCustomFieldValue(mapping.getCustomFieldId(), entityType, entityId, value);
                }
            } catch (Exception e) {
                logger.error("Failed to sync field {}: {}", mapping.getSystemFieldName(), e.getMessage());
            }
        }
    }

    /**
     * Sync all custom fields for an entity to their mapped system fields.
     */
    @Transactional
    public void syncAllCustomFieldsToSystemFields(String instituteId, String entityType, String entityId) {
        List<SystemFieldCustomFieldMapping> mappings = 
            mappingRepository.findAllMappingsForEntityType(instituteId, entityType);

        if (CollectionUtils.isEmpty(mappings)) {
            return;
        }

        // Get all custom field values for this entity
        List<CustomFieldValues> values = 
            customFieldValuesRepository.findBySourceTypeAndSourceId(entityType, entityId);
        
        Map<String, String> customFieldValueMap = new HashMap<>();
        for (CustomFieldValues cfv : values) {
            customFieldValueMap.put(cfv.getCustomFieldId(), cfv.getValue());
        }

        for (SystemFieldCustomFieldMapping mapping : mappings) {
            if (mapping.getSyncDirection().name().equals("TO_CUSTOM")) {
                continue; // Skip mappings that don't sync to system
            }

            String value = customFieldValueMap.get(mapping.getCustomFieldId());
            if (StringUtils.hasText(value)) {
                try {
                    updateSystemField(entityType, entityId, mapping.getSystemFieldName(), value);
                } catch (Exception e) {
                    logger.error("Failed to sync to system field {}: {}", 
                                mapping.getSystemFieldName(), e.getMessage());
                }
            }
        }
    }

    /**
     * Get mappings for an entity type to show admin what fields are linked.
     */
    public List<SystemFieldCustomFieldMapping> getMappingsForEntityType(String instituteId, String entityType) {
        return mappingRepository.findAllMappingsForEntityType(instituteId, entityType);
    }

    /**
     * Entry point for CustomFieldValueSyncListener, which calls it after the transaction
     * that saved the values has committed. Runs in its own transaction because the
     * committed one can no longer write.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void syncCustomFieldValuesAfterCommit(Collection<CustomFieldValueChange> changes) {
        Set<String> customFieldIds = new HashSet<>();
        for (CustomFieldValueChange change : changes) {
            customFieldIds.add(change.customFieldId());
        }
        Set<String> mapped = new HashSet<>(mappingRepository.findCustomFieldIdsWithSystemSync(customFieldIds));
        for (CustomFieldValueChange change : changes) {
            if (!mapped.contains(change.customFieldId())) {
                continue;
            }
            try {
                syncCustomFieldToSystemField(change.customFieldId(), change.sourceType(),
                        change.sourceId(), change.value());
            } catch (Exception e) {
                logger.error("Failed to sync custom field {} for {} {}: {}", change.customFieldId(),
                        change.sourceType(), change.sourceId(), e.getMessage());
            }
        }
    }

    /** A saved custom field value, captured for the after-commit sync. */
    public record CustomFieldValueChange(String customFieldId, String sourceType, String sourceId, String value) {
    }

    // ==================== Private Helper Methods ====================

    /**
     * Custom field values are keyed by user (USER) or by enrolment (SSIGM rows), not by
     * student id, so resolve the source to its student rows before writing. Blank values
     * never clear a system field: the same field is often answered on several sources and
     * an empty one must not wipe a value another source filled.
     */
    private void updateSystemFieldForSource(String entityType, String sourceType, String sourceId,
                                            String fieldName, String value) {
        if (!EntityTypeEnum.STUDENT.name().equals(entityType) || !StringUtils.hasText(value)) {
            return;
        }
        for (Student student : resolveStudents(sourceType, sourceId)) {
            if (Objects.equals(getFieldValue(student, fieldName), value)) {
                continue;
            }
            setFieldValue(student, fieldName, value);
            studentRepository.save(student);
        }
    }

    private List<Student> resolveStudents(String sourceType, String sourceId) {
        if ("USER".equals(sourceType)) {
            return studentRepository.findByUserIdIn(List.of(sourceId));
        }
        if ("STUDENT_SESSION_INSTITUTE_GROUP_MAPPING".equals(sourceType)
                || "STUDENT_SESSION_MAPPING".equals(sourceType)) {
            return ssigmRepository.findById(sourceId)
                    .map(ssigm -> studentRepository.findByUserIdIn(List.of(ssigm.getUserId())))
                    .orElse(List.of());
        }
        if (EntityTypeEnum.STUDENT.name().equals(sourceType)) {
            return studentRepository.findById(sourceId).map(List::of).orElse(List.of());
        }
        return List.of();
    }

    private void updateSystemField(String entityType, String entityId, 
                                   String fieldName, String value) {
        if (EntityTypeEnum.STUDENT.name().equals(entityType)) {
            updateStudentField(entityId, fieldName, value);
        }
        // Add more entity types as needed
    }

    private void updateStudentField(String studentId, String fieldName, String value) {
        Optional<Student> studentOpt = studentRepository.findById(studentId);
        if (studentOpt.isEmpty()) {
            logger.warn("Student not found: {}", studentId);
            return;
        }

        Student student = studentOpt.get();
        setFieldValue(student, fieldName, value);
        studentRepository.save(student);
    }

    private void upsertCustomFieldValue(String customFieldId, String sourceType, 
                                         String sourceId, String value) {
        Optional<CustomFieldValues> existing = customFieldValuesRepository
            .findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                customFieldId, sourceType, sourceId);

        CustomFieldValues cfv;
        if (existing.isPresent()) {
            cfv = existing.get();
            cfv.setValue(value);
        } else {
            cfv = CustomFieldValues.builder()
                .customFieldId(customFieldId)
                .sourceType(sourceType)
                .sourceId(sourceId)
                .value(value)
                .build();
        }
        customFieldValuesRepository.save(cfv);
    }

    private Object loadEntity(String entityType, String entityId) {
        if (EntityTypeEnum.STUDENT.name().equals(entityType)) {
            return studentRepository.findById(entityId).orElse(null);
        }
        // Add more entity types as needed
        return null;
    }

    private String getFieldValue(Object entity, String fieldName) {
        try {
            String javaFieldName = snakeToCamel(fieldName);
            Field field = entity.getClass().getDeclaredField(javaFieldName);
            field.setAccessible(true);
            Object value = field.get(entity);
            return value != null ? value.toString() : null;
        } catch (Exception e) {
            logger.error("Failed to get field value {}: {}", fieldName, e.getMessage());
            return null;
        }
    }

    private void setFieldValue(Object entity, String fieldName, String value) {
        try {
            String javaFieldName = snakeToCamel(fieldName);
            Field field = entity.getClass().getDeclaredField(javaFieldName);
            field.setAccessible(true);
            
            // Handle type conversion
            Class<?> fieldType = field.getType();
            Object convertedValue = convertValue(value, fieldType);
            
            field.set(entity, convertedValue);
        } catch (Exception e) {
            logger.error("Failed to set field value {}: {}", fieldName, e.getMessage());
        }
    }

    private Object convertValue(String value, Class<?> targetType) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        
        try {
            if (targetType == String.class) {
                return value;
            } else if (targetType == Integer.class || targetType == int.class) {
                return Integer.parseInt(value.trim());
            } else if (targetType == Long.class || targetType == long.class) {
                return Long.parseLong(value.trim());
            } else if (targetType == Boolean.class || targetType == boolean.class) {
                return Boolean.parseBoolean(value.trim());
            } else if (targetType == Double.class || targetType == double.class) {
                return Double.parseDouble(value.trim());
            } else if (targetType == java.util.Date.class || targetType == java.sql.Date.class) {
                // Attempt to parse common date formats
                return java.sql.Date.valueOf(value.trim());
            }
        } catch (IllegalArgumentException e) {
            logger.warn("Failed to convert value '{}' to type {}: {}", value, targetType.getSimpleName(), e.getMessage());
            return null;
        }
        
        return value;
    }

    private String snakeToCamel(String snakeCase) {
        StringBuilder result = new StringBuilder();
        boolean capitalizeNext = false;
        for (char c : snakeCase.toCharArray()) {
            if (c == '_') {
                capitalizeNext = true;
            } else if (capitalizeNext) {
                result.append(Character.toUpperCase(c));
                capitalizeNext = false;
            } else {
                result.append(c);
            }
        }
        return result.toString();
    }

    // ==================== Loop Prevention Helpers ====================

    private String buildSyncKey(String entityType, String entityId, String fieldIdentifier) {
        return entityType + ":" + entityId + ":" + fieldIdentifier;
    }

    private boolean isSyncInProgress(String syncKey) {
        return SYNC_KEYS_IN_PROGRESS.get().contains(syncKey);
    }

    private void markSyncInProgress(String syncKey) {
        SYNC_KEYS_IN_PROGRESS.get().add(syncKey);
    }

    private void clearSyncInProgress(String syncKey) {
        Set<String> keys = SYNC_KEYS_IN_PROGRESS.get();
        keys.remove(syncKey);
        // Clean up ThreadLocal if empty to prevent memory leaks
        if (keys.isEmpty()) {
            SYNC_KEYS_IN_PROGRESS.remove();
        }
    }
}
