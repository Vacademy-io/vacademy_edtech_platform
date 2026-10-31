package vacademy.io.admin_core_service.core.crypto;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.common.exceptions.VacademyException;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM cipher for HR PII stored at rest (bank account numbers, PAN,
 * UAN, statutory info). Same crypto scheme as {@code TokenEncryptionService}
 * (12-byte IV prefixed to ciphertext+tag, base64), with two additions:
 *
 * 1. Ciphertext is tagged with the {@code ENCv1:} prefix so reads can tell
 *    encrypted values from legacy plaintext rows: {@link #decryptField} returns
 *    an unprefixed value AS-IS (pre-encryption data keeps working; it becomes
 *    encrypted the next time the row is written).
 * 2. A static holder ({@link #instance()}) so JPA {@code AttributeConverter}s
 *    work whether Hibernate instantiates them through Spring's BeanContainer
 *    or reflectively.
 *
 * Key management: set HR_FIELD_ENCRYPTION_KEY to a base64-encoded 32-byte key
 * (openssl rand -base64 32). Without it a deterministic dev key is used, with
 * a loud warning — production must set the env var.
 */
@Service
public class HrFieldCipher {

    private static final Logger log = LoggerFactory.getLogger(HrFieldCipher.class);

    public static final String ENC_PREFIX = "ENCv1:";

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH_BYTES = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private static volatile HrFieldCipher INSTANCE;

    private final SecretKeySpec keySpec;

    public HrFieldCipher(@Value("${hr.field.encryption.key:}") String base64Key) {
        if (base64Key == null || base64Key.isBlank()) {
            log.warn("⚠ HR_FIELD_ENCRYPTION_KEY is not set — HR PII fields are encrypted with an "
                    + "insecure dev key. Set this env var before deploying to production.");
            this.keySpec = new SecretKeySpec(new byte[32], "AES");
        } else {
            byte[] keyBytes = Base64.getDecoder().decode(base64Key);
            if (keyBytes.length != 32) {
                throw new IllegalArgumentException(
                        "HR_FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
            }
            this.keySpec = new SecretKeySpec(keyBytes, "AES");
        }
    }

    @PostConstruct
    void register() {
        INSTANCE = this;
    }

    /** Static accessor for JPA converters; null only before Spring context init. */
    public static HrFieldCipher instance() {
        return INSTANCE;
    }

    /** Encrypts and prefixes; null/blank and already-encrypted values pass through. */
    public String encryptField(String plaintext) {
        if (plaintext == null || plaintext.isBlank() || plaintext.startsWith(ENC_PREFIX)) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
            return ENC_PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            // Never write plaintext on a crypto failure — fail the transaction.
            throw new VacademyException("Failed to encrypt HR field: " + e.getMessage());
        }
    }

    /**
     * Decrypts an {@code ENCv1:}-prefixed value; returns unprefixed (legacy
     * plaintext) values as-is. A decrypt failure (rotated key, corrupt row)
     * throws — silently returning ciphertext would leak it into DTOs/exports.
     */
    public String decryptField(String stored) {
        if (stored == null || !stored.startsWith(ENC_PREFIX)) {
            return stored;
        }
        try {
            byte[] combined = Base64.getDecoder().decode(stored.substring(ENC_PREFIX.length()));
            byte[] iv = new byte[IV_LENGTH_BYTES];
            byte[] ciphertext = new byte[combined.length - IV_LENGTH_BYTES];
            System.arraycopy(combined, 0, iv, 0, IV_LENGTH_BYTES);
            System.arraycopy(combined, IV_LENGTH_BYTES, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new VacademyException("Failed to decrypt HR field: " + e.getMessage());
        }
    }
}
