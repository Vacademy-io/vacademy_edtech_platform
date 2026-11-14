package vacademy.io.auth_service.feature.panel.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Secrets for the panel feature. Plain values leave once in a response and only their SHA-256 hex
 * is stored.
 */
public final class PanelSecrets {

    /** Crockford base32: no I, L, O or U, so a code read off a screen cannot be mistyped into them. */
    private static final char[] CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();

    public static final int CODE_LENGTH = 8;
    /** Enough for a base64url 256-bit token; anything longer is not one of ours. */
    public static final int MAX_TOKEN_LENGTH = 64;

    private static final SecureRandom RANDOM = new SecureRandom();

    private PanelSecrets() {
    }

    /** A base64url token: 16 bytes gives 22 characters, 32 bytes gives 43. */
    public static String token(int bytes) {
        byte[] raw = new byte[bytes];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    /** 8 Crockford characters, 40 bits. */
    public static String code() {
        byte[] raw = new byte[5];
        RANDOM.nextBytes(raw);
        long bits = 0;
        for (byte b : raw) {
            bits = (bits << 8) | (b & 0xFF);
        }
        char[] out = new char[CODE_LENGTH];
        for (int i = CODE_LENGTH - 1; i >= 0; i--) {
            out[i] = CROCKFORD[(int) (bits & 31)];
            bits >>>= 5;
        }
        return new String(out);
    }

    /** Accepts K7QF-2M9X, lower case and the usual look-alikes. Null when it cannot be a code. */
    public static String normaliseCode(String raw) {
        if (raw == null || raw.length() > 32) {
            return null;
        }
        String clean = raw.toUpperCase(Locale.ROOT)
                .replaceAll("[^0-9A-Z]", "")
                .replace('O', '0')
                .replace('I', '1')
                .replace('L', '1');
        return clean.length() == CODE_LENGTH ? clean : null;
    }

    /**
     * True when the value holds a control character. Postgres refuses NUL in text, so ids and names
     * from a request are checked with this before they reach a query.
     */
    public static boolean hasControlChars(String value) {
        return value != null && value.chars().anyMatch(c -> c < 0x20 || c == 0x7F);
    }

    public static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Constant-time compare of a presented secret against a stored hash. */
    public static boolean matches(String presented, String storedHash) {
        if (presented == null || storedHash == null || presented.length() > MAX_TOKEN_LENGTH) {
            return false;
        }
        return MessageDigest.isEqual(sha256Hex(presented).getBytes(StandardCharsets.UTF_8),
                storedHash.getBytes(StandardCharsets.UTF_8));
    }

    public record MatchNumbers(int matchCode, String options) {
    }

    /** One right number and two decoys, all two digits, shown to the phone in shuffled order. */
    public static MatchNumbers matchNumbers() {
        Set<Integer> picked = new LinkedHashSet<>();
        while (picked.size() < 3) {
            picked.add(10 + RANDOM.nextInt(90));
        }
        List<Integer> options = new ArrayList<>(picked);
        int right = options.get(0);
        Collections.shuffle(options, RANDOM);
        return new MatchNumbers(right, options.stream().map(String::valueOf).collect(Collectors.joining(",")));
    }

    public static List<Integer> parseOptions(String stored) {
        List<Integer> out = new ArrayList<>();
        if (stored != null && !stored.isBlank()) {
            for (String part : stored.split(",")) {
                out.add(Integer.parseInt(part.trim()));
            }
        }
        return out;
    }
}
