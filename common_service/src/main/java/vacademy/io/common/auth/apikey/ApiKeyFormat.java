package vacademy.io.common.auth.apikey;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * Shape, hashing and minting of institute API keys ({@code vak_<product>_<48 hex>}, e.g.
 * {@code vak_eval_…}).
 *
 * <p>Keys are verified by {@link #sha256Hex(String)} only (the stored {@code key_hash} is
 * UNIQUE), so this class never parses a key into parts. {@link #isWellFormed(String)} exists
 * only to turn away obvious garbage before it costs a hash and a verify round trip.
 */
public final class ApiKeyFormat {

    /** Request header that carries the key. Header only, never a query parameter. */
    public static final String HEADER = "X-API-Key";

    /** Marker of evaluation keys: {@code vak_eval_<48 hex>}. */
    public static final String EVALUATION_MARKER = "eval";

    /** Characters of the key kept for display and logs ({@code key_prefix}). */
    public static final int DISPLAY_PREFIX_LENGTH = 16;

    private static final Pattern WELL_FORMED = Pattern.compile("^vak_[a-z]+_[0-9a-f]{48}$");
    private static final Pattern MARKER = Pattern.compile("^[a-z]+$");
    private static final int SECRET_BYTES = 24; // 48 hex characters, 192 bits
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final HexFormat HEX = HexFormat.of();

    private ApiKeyFormat() {
    }

    /** True for {@code vak_<lowercase marker>_<48 lowercase hex>}; false for null or anything else. */
    public static boolean isWellFormed(String key) {
        // Length check first so an absurdly long header never reaches the regex.
        return key != null && key.length() <= 128 && WELL_FORMED.matcher(key).matches();
    }

    /** Lowercase hex SHA-256 of the UTF-8 bytes of the full key: the stored {@code key_hash}. */
    public static String sha256Hex(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HEX.formatHex(digest.digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // Every JRE ships SHA-256; this cannot happen.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** The first {@value #DISPLAY_PREFIX_LENGTH} characters, safe to show and log. */
    public static String displayPrefix(String key) {
        if (key == null) {
            return null;
        }
        return key.length() <= DISPLAY_PREFIX_LENGTH ? key : key.substring(0, DISPLAY_PREFIX_LENGTH);
    }

    /** A new key {@code vak_<marker>_<48 hex>} from {@link SecureRandom}. */
    public static String generate(String marker) {
        if (marker == null || !MARKER.matcher(marker).matches()) {
            throw new IllegalArgumentException("marker must be lowercase letters, e.g. \"eval\"");
        }
        byte[] secret = new byte[SECRET_BYTES];
        RANDOM.nextBytes(secret);
        return "vak_" + marker + "_" + HEX.formatHex(secret);
    }
}
