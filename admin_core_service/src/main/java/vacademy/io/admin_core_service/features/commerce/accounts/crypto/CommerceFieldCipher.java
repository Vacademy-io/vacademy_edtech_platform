package vacademy.io.admin_core_service.features.commerce.accounts.crypto;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.VacademyException;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Encrypts single commerce fields (a supplier's PAN) with AES-256-GCM.
 *
 * <p>Stored form: {@code cfc1:<keyId>:<base64url without padding of iv || ciphertext || tag>}. The
 * additional data names the institute, the record and the field ({@link #aad}), so a value copied to
 * another row, institute or field does not decrypt.
 *
 * <p>Keys come from {@code commerce.field.encryption.key} ({@code <keyId>:<base64 of 32 bytes>}) and
 * {@code commerce.field.encryption.previous-keys} (comma-separated, decrypt only). No key, or any
 * malformed key, leaves the cipher "not configured": writes that need it are refused with 503
 * {@code ENCRYPTION_NOT_CONFIGURED} and the application still starts. There is no built-in key.
 * Key material and plain values never appear in a log line, an exception message or {@link #toString}.
 */
@Slf4j
@Component
public class CommerceFieldCipher {

    public static final String ENCRYPTION_NOT_CONFIGURED = "ENCRYPTION_NOT_CONFIGURED";
    static final String PREFIX = "cfc1";

    private static final Pattern KEY_ID = Pattern.compile("^[a-z0-9]{1,8}$");
    private static final int KEY_BYTES = 32;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String HMAC = "HmacSHA256";
    private static final String PROBE_VALUE = "commerce-field-cipher-probe";
    private static final String PROBE_AAD = aad("probe", "probe", "probe");

    private final SecureRandom random = new SecureRandom();
    /** Every loaded key by id; the active one first. Empty when not configured. */
    private final Map<String, SecretKeySpec> keys;
    private final String activeKeyId;
    private final List<String> previousKeyIds;

    public CommerceFieldCipher(@Value("${commerce.field.encryption.key:}") String activeKey,
                               @Value("${commerce.field.encryption.previous-keys:}") String previousKeys) {
        Map<String, SecretKeySpec> loaded = new LinkedHashMap<>();
        List<String> previous = new ArrayList<>();
        String active = null;
        if (activeKey == null || activeKey.isBlank()) {
            log.warn("Commerce field encryption key is not set; PAN writes are refused");
        } else {
            try {
                active = parseInto(activeKey.trim(), "active key", loaded);
                if (previousKeys != null && !previousKeys.isBlank()) {
                    int position = 0;
                    for (String part : previousKeys.split(",")) {
                        position++;
                        if (part.isBlank()) {
                            continue;
                        }
                        previous.add(parseInto(part.trim(), "previous key " + position, loaded));
                    }
                }
            } catch (MalformedKeyException e) {
                log.error("Commerce field encryption key is malformed ({}); PAN writes are refused", e.getMessage());
                loaded.clear();
                previous.clear();
                active = null;
            }
        }
        this.keys = Collections.unmodifiableMap(loaded);
        this.activeKeyId = active;
        this.previousKeyIds = List.copyOf(previous);
    }

    /** {@code "commerce|" + instituteId + "|" + recordId + "|" + field}. */
    public static String aad(String instituteId, String recordId, String field) {
        return "commerce|" + instituteId + "|" + recordId + "|" + field;
    }

    public boolean isConfigured() {
        return activeKeyId != null;
    }

    /** The id of the key new values are written with; null when not configured. */
    public String activeKeyId() {
        return activeKeyId;
    }

    /** Ids of the keys loaded for reading old values only. */
    public List<String> previousKeyIds() {
        return previousKeyIds;
    }

    /**
     * Encrypts with the active key.
     *
     * @throws VacademyException 503 ENCRYPTION_NOT_CONFIGURED when no key is configured
     */
    public String encrypt(String plain, String aad) {
        if (plain == null || aad == null) {
            throw new IllegalArgumentException("value and additional data are required");
        }
        SecretKeySpec key = activeKey();
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
            return PREFIX + ":" + activeKeyId + ":" + Base64.getUrlEncoder().withoutPadding().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("value could not be encrypted");
        }
    }

    /**
     * Decrypts a stored value with the key it names.
     *
     * @throws VacademyException     503 ENCRYPTION_NOT_CONFIGURED when that key is not loaded
     * @throws IllegalStateException when the value is not in the stored form or fails its check
     */
    public String decrypt(String stored, String aad) {
        if (stored == null || aad == null) {
            throw new IllegalStateException("stored value cannot be read");
        }
        String[] parts = stored.split(":", -1);
        if (parts.length != 3 || !PREFIX.equals(parts[0]) || !KEY_ID.matcher(parts[1]).matches()) {
            throw new IllegalStateException("stored value cannot be read");
        }
        SecretKeySpec key = keys.get(parts[1]);
        if (key == null) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    ENCRYPTION_NOT_CONFIGURED + ": the key that wrote this value is not loaded");
        }
        byte[] data;
        try {
            data = Base64.getUrlDecoder().decode(parts[2]);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("stored value cannot be read");
        }
        if (data.length < IV_BYTES + TAG_BITS / 8) {
            throw new IllegalStateException("stored value cannot be read");
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, data, 0, IV_BYTES));
            cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            byte[] plain = cipher.doFinal(data, IV_BYTES, data.length - IV_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("stored value cannot be read");
        }
    }

    /**
     * A keyed hash to find equal values without decrypting: hex HMAC-SHA256 over
     * {@code instituteId + "|" + value} with a key derived from the active key for {@code purpose}.
     *
     * @throws VacademyException 503 ENCRYPTION_NOT_CONFIGURED when no key is configured
     */
    public String keyedHash(String purpose, String instituteId, String value) {
        if (purpose == null || instituteId == null || value == null) {
            throw new IllegalArgumentException("purpose, institute and value are required");
        }
        SecretKeySpec key = activeKey();
        try {
            Mac derive = Mac.getInstance(HMAC);
            derive.init(key);
            byte[] hashKey = derive.doFinal(("commerce-hash:" + purpose).getBytes(StandardCharsets.UTF_8));
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(hashKey, HMAC));
            return HexFormat.of().formatHex(mac.doFinal((instituteId + "|" + value).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("value could not be hashed");
        }
    }

    /** Encrypts and decrypts a fixed probe in memory; false when not configured or on any error. */
    public boolean roundTrip() {
        if (!isConfigured()) {
            return false;
        }
        try {
            return PROBE_VALUE.equals(decrypt(encrypt(PROBE_VALUE, PROBE_AAD), PROBE_AAD));
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override
    public String toString() {
        return "CommerceFieldCipher{configured=" + isConfigured() + ", activeKeyId=" + activeKeyId
                + ", previousKeyIds=" + previousKeyIds + "}";
    }

    private SecretKeySpec activeKey() {
        SecretKeySpec key = activeKeyId == null ? null : keys.get(activeKeyId);
        if (key == null) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    ENCRYPTION_NOT_CONFIGURED + ": field encryption is not set up");
        }
        return key;
    }

    /** Parses {@code <keyId>:<base64>} into {@code into}; the reason of a failure names no key text. */
    private static String parseInto(String entry, String label, Map<String, SecretKeySpec> into) {
        int colon = entry.indexOf(':');
        if (colon <= 0) {
            throw new MalformedKeyException(label + ": expected <keyId>:<base64 of 32 bytes>");
        }
        String id = entry.substring(0, colon);
        if (!KEY_ID.matcher(id).matches()) {
            throw new MalformedKeyException(label + ": key id must be 1 to 8 lower-case letters or digits");
        }
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(entry.substring(colon + 1).trim());
        } catch (IllegalArgumentException e) {
            throw new MalformedKeyException(label + ": key is not valid base64");
        }
        if (raw.length != KEY_BYTES) {
            throw new MalformedKeyException(label + ": key must be exactly 32 bytes, found " + raw.length);
        }
        if (into.containsKey(id)) {
            throw new MalformedKeyException(label + ": key id is used twice");
        }
        into.put(id, new SecretKeySpec(raw, "AES"));
        return id;
    }

    private static final class MalformedKeyException extends RuntimeException {
        MalformedKeyException(String reason) {
            super(reason, null, false, false);
        }
    }
}
