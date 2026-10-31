package vacademy.io.admin_core_service.features.common.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.dto.SystemFieldInfoDTO;
import vacademy.io.admin_core_service.features.common.entity.SystemFieldCustomFieldMapping;
import vacademy.io.admin_core_service.features.common.enums.EntityTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.SystemFieldCustomFieldMappingRepository;

import java.util.*;

/**
 * Service that provides metadata about available system fields for each entity type.
 * This helps the admin UI show what fields are available for mapping.
 */
@Service
public class SystemFieldMetadataService {

    @Autowired
    private SystemFieldCustomFieldMappingRepository mappingRepository;

    /**
     * Get all available system fields for an entity type.
     * Includes mapping status if a custom field is already linked.
     */
    public List<SystemFieldInfoDTO> getAvailableSystemFields(String instituteId, String entityType) {
        List<SystemFieldInfoDTO> fields = getFieldsForEntityType(entityType);
        
        // Get existing mappings to mark which fields are already mapped
        List<SystemFieldCustomFieldMapping> existingMappings = 
            mappingRepository.findAllMappingsForEntityType(instituteId, entityType);
        
        Map<String, String> mappedFields = new HashMap<>();
        for (SystemFieldCustomFieldMapping mapping : existingMappings) {
            mappedFields.put(mapping.getSystemFieldName(), mapping.getCustomFieldId());
        }

        // Mark mapped fields
        for (SystemFieldInfoDTO field : fields) {
            String customFieldId = mappedFields.get(field.getFieldName());
            if (customFieldId != null) {
                field.setMapped(true);
                field.setMappedCustomFieldId(customFieldId);
            }
        }

        return fields;
    }

    /**
     * Get field definitions for each entity type.
     * This is a static definition of what fields exist in each entity.
     */
    private List<SystemFieldInfoDTO> getFieldsForEntityType(String entityType) {
        if (EntityTypeEnum.STUDENT.name().equals(entityType)) {
            return getStudentFields();
        }
        // Add more entity types as needed
        return Collections.emptyList();
    }

    private List<SystemFieldInfoDTO> getStudentFields() {
        return Arrays.asList(
            createField("STUDENT", "full_name", "Full Name", "TEXT"),
            createField("STUDENT", "email", "Email", "TEXT"),
            createField("STUDENT", "mobile_number", "Mobile Number", "TEXT"),
            createField("STUDENT", "username", "Username", "TEXT"),
            createField("STUDENT", "address_line", "Address", "TEXT"),
            createField("STUDENT", "city", "City", "TEXT"),
            createField("STUDENT", "region", "Region/State", "TEXT"),
            createField("STUDENT", "pin_code", "PIN Code", "TEXT"),
            createField("STUDENT", "country", "Country", "TEXT"),
            createField("STUDENT", "date_of_birth", "Date of Birth", "DATE"),
            createField("STUDENT", "gender", "Gender", "TEXT"),
            createField("STUDENT", "fathers_name", "Father's Name", "TEXT"),
            createField("STUDENT", "mothers_name", "Mother's Name", "TEXT"),
            createField("STUDENT", "parents_mobile_number", "Parent's Mobile", "TEXT"),
            createField("STUDENT", "parents_email", "Parent's Email", "TEXT"),
            createField("STUDENT", "linked_institute_name", "Linked Institute", "TEXT")
        );
    }

    private SystemFieldInfoDTO createField(String entityType, String fieldName, 
                                            String displayName, String fieldType) {
        return SystemFieldInfoDTO.builder()
            .entityType(entityType)
            .fieldName(fieldName)
            .displayName(displayName)
            .fieldType(fieldType)
            .isMapped(false)
            .build();
    }

    /**
     * Get supported entity types for the admin UI dropdown.
     */
    public List<String> getSupportedEntityTypes() {
        return Arrays.asList(
            EntityTypeEnum.STUDENT.name()
            // Add more as implemented
        );
    }
}
