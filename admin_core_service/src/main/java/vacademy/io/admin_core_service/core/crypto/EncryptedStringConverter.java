package vacademy.io.admin_core_service.core.crypto;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * JPA converter encrypting a String column at rest via {@link HrFieldCipher}.
 * Apply explicitly ({@code @Convert(converter = EncryptedStringConverter.class)})
 * on PII fields — never autoApply. Legacy plaintext rows (no ENCv1: prefix)
 * read through unchanged and are encrypted on next write.
 */
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    @Override
    public String convertToDatabaseColumn(String attribute) {
        HrFieldCipher cipher = HrFieldCipher.instance();
        return cipher != null ? cipher.encryptField(attribute) : attribute;
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        HrFieldCipher cipher = HrFieldCipher.instance();
        return cipher != null ? cipher.decryptField(dbData) : dbData;
    }
}
