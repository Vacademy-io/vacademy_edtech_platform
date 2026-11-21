package vacademy.io.admin_core_service.core.crypto;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * JPA converter storing a {@code Map<String,Object>} as an encrypted JSON TEXT
 * column (used for hr_employee_profile.statutory_info, which V480 converted
 * from jsonb to TEXT). Legacy rows holding plaintext JSON parse through
 * unchanged and are encrypted on next write.
 */
@Converter
public class EncryptedJsonMapConverter implements AttributeConverter<Map<String, Object>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    @Override
    public String convertToDatabaseColumn(Map<String, Object> attribute) {
        if (attribute == null) {
            return null;
        }
        try {
            String json = MAPPER.writeValueAsString(attribute);
            HrFieldCipher cipher = HrFieldCipher.instance();
            return cipher != null ? cipher.encryptField(json) : json;
        } catch (Exception e) {
            throw new VacademyException("Failed to serialize statutory info: " + e.getMessage());
        }
    }

    @Override
    public Map<String, Object> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return null;
        }
        try {
            HrFieldCipher cipher = HrFieldCipher.instance();
            String json = cipher != null ? cipher.decryptField(dbData) : dbData;
            return MAPPER.readValue(json, MAP_TYPE);
        } catch (Exception e) {
            throw new VacademyException("Failed to read statutory info: " + e.getMessage());
        }
    }
}
