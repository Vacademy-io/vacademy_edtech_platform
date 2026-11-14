package vacademy.io.auth_service.feature.institute_oauth.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM for institute OAuth client secrets. Same storage format and key as admin-core's
 * {@code TokenEncryptionService}: base64 of [12-byte IV][ciphertext + 16-byte tag], key =
 * {@code OAUTH_TOKEN_ENCRYPTION_KEY} (base64 of 32 random bytes, {@code openssl rand -base64 32}).
 *
 * <p>Unlike admin-core there is no insecure fallback key: with no usable key the cipher reports
 * {@link #isConfigured()} false, secrets cannot be saved, and every institute keeps using the
 * platform client. The login path must never fail because this is misconfigured.
 */
@Component
public class OAuthClientSecretCipher {

    private static final Logger log = LoggerFactory.getLogger(OAuthClientSecretCipher.class);

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH_BYTES = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private final SecretKeySpec keySpec;
    private final SecureRandom secureRandom = new SecureRandom();

    public OAuthClientSecretCipher(@Value("${institute.oauth.client.encryption-key:}") String base64Key) {
        this.keySpec = parseKey(base64Key);
    }

    private static SecretKeySpec parseKey(String base64Key) {
        if (base64Key == null || base64Key.isBlank()) {
            log.warn("institute.oauth.client.encryption-key (OAUTH_TOKEN_ENCRYPTION_KEY) is not set; "
                    + "institute OAuth clients are disabled and every login uses the platform client.");
            return null;
        }
        try {
            byte[] keyBytes = Base64.getDecoder().decode(base64Key.trim());
            if (keyBytes.length != 32) {
                log.error("OAUTH_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key (got {} bytes); "
                        + "institute OAuth clients are disabled.", keyBytes.length);
                return null;
            }
            return new SecretKeySpec(keyBytes, "AES");
        } catch (IllegalArgumentException e) {
            log.error("OAUTH_TOKEN_ENCRYPTION_KEY is not valid base64; institute OAuth clients are disabled.");
            return null;
        }
    }

    public boolean isConfigured() {
        return keySpec != null;
    }

    public String encrypt(String plainText) {
        if (keySpec == null) {
            throw new IllegalStateException("OAuth client encryption key is not configured");
        }
        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to encrypt OAuth client secret", e);
        }
    }

    /**
     * @return the plaintext, or null when the key is missing or the value does not decrypt
     *         (wrong key, hand-written plaintext, corruption) — callers treat null as "no client".
     */
    public String decryptOrNull(String encrypted) {
        if (keySpec == null || encrypted == null || encrypted.isBlank()) {
            return null;
        }
        try {
            byte[] combined = Base64.getDecoder().decode(encrypted);
            if (combined.length <= IV_LENGTH_BYTES) {
                return null;
            }
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, keySpec,
                    new GCMParameterSpec(GCM_TAG_LENGTH_BITS, combined, 0, IV_LENGTH_BYTES));
            byte[] plain = cipher.doFinal(combined, IV_LENGTH_BYTES, combined.length - IV_LENGTH_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.error("Failed to decrypt an institute OAuth client secret: {}", e.getClass().getSimpleName());
            return null;
        }
    }
}
