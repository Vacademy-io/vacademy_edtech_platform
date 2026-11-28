package vacademy.io.admin_core_service.features.institute_api.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * Key material for partner API keys (spec 6.1, contract C1).
 *
 * <ul>
 *   <li>Format: {@code vak_eval_<48 lowercase hex>} = 24 bytes (192 bits) of SecureRandom.</li>
 *   <li>Stored: hex SHA-256 of the full key (UTF-8). Verification is by hash only.</li>
 *   <li>Prefix: the first 16 characters, for display and logs only.</li>
 * </ul>
 */
public final class ApiKeySecrets {

    public static final String EVALUATION_KEY_PREFIX = "vak_eval_";
    public static final String LOGIN_LINKS_KEY_PREFIX = "vak_login_";
    public static final String AI_CALLING_KEY_PREFIX = "vak_call_";
    /** Publishable catalogue keys: meant to be visible in browser code (read-only + leads). */
    public static final String CATALOG_KEY_PREFIX = "vak_pub_";
    static final int RANDOM_BYTES = 24;
    static final int DISPLAY_PREFIX_LENGTH = 16;

    private static final Pattern HASH_HEX = Pattern.compile("^[0-9a-f]{64}$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private ApiKeySecrets() {
    }

    /** A new evaluation key in plaintext. Show it once; never store it. */
    public static String newEvaluationKey() {
        return newKey(EVALUATION_KEY_PREFIX);
    }

    /** A new login-links key ({@code vak_login_<48 hex>}) in plaintext. Show it once; never store it. */
    public static String newLoginLinksKey() {
        return newKey(LOGIN_LINKS_KEY_PREFIX);
    }

    /** A new AI calling (Telleo API) key ({@code vak_call_<48 hex>}) in plaintext. Show it once; never store it. */
    public static String newAiCallingKey() {
        return newKey(AI_CALLING_KEY_PREFIX);
    }

    /** A new publishable Catalogue API key ({@code vak_pub_<48 hex>}) in plaintext. Show it once; never store it. */
    public static String newCatalogKey() {
        return newKey(CATALOG_KEY_PREFIX);
    }

    private static String newKey(String prefix) {
        byte[] rnd = new byte[RANDOM_BYTES];
        RANDOM.nextBytes(rnd);
        return prefix + HexFormat.of().formatHex(rnd);
    }

    /** Lowercase hex SHA-256 of the key's UTF-8 bytes (64 chars). */
    public static String sha256Hex(String key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandatory on every JVM.
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public static String displayPrefix(String key) {
        return key.length() <= DISPLAY_PREFIX_LENGTH ? key : key.substring(0, DISPLAY_PREFIX_LENGTH);
    }

    /**
     * The hash as stored (lowercase), or null when the input is not 64 hex characters.
     * Uppercase hex is accepted and folded.
     */
    public static String normalizeHash(String keyHash) {
        if (keyHash == null) {
            return null;
        }
        String h = keyHash.trim().toLowerCase(java.util.Locale.ROOT);
        return HASH_HEX.matcher(h).matches() ? h : null;
    }
}
