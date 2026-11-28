package vacademy.io.auth_service.feature.util;

import java.security.SecureRandom;
import java.util.UUID;

public class UsernameGenerator {

    private static final String ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private static final SecureRandom random = new SecureRandom();

    /**
     * Generates a username based on the full name.
     * If fullName is null or empty, generates an 8-character random string.
     */
    public static String generateUsername(String fullName) {
        // Keep only characters that are legal in a username. Without this, a name
        // pasted with invisible characters produces a username made of them — prod
        // holds several accounts called "‌‌‌‌xxxx", which are
        // unloggable-in because the value can never be retyped or matched. trim()
        // does not remove these: they are not whitespace to Character.isWhitespace.
        // \p{L}\p{N} keeps letters and digits in any script (so international names
        // still produce a readable prefix) while dropping \p{Cf} format characters,
        // punctuation and whitespace.
        String cleanName = fullName == null ? ""
                : fullName.replaceAll("[^\\p{L}\\p{N}]", "");

        if (cleanName.isEmpty()) {
            return UUID.randomUUID()
                    .toString()
                    .replaceAll("-", "")
                    .substring(0, 8)
                    .toLowerCase();
        }

        String prefix = cleanName;
        prefix = prefix.length() >= 4
                ? prefix.substring(0, 4)
                : String.format("%-4s", prefix).replace(' ', 'x');  // pad with 'x' if less than 4

        // ✅ ensure both prefix and random part are lowercase
        return (prefix + getRandomAlphaNumeric(4)).toLowerCase();
    }

    /**
     * Generates a secure random alphanumeric password of given length.
     */
    public static String generatePassword(int length) {
        if (length <= 0) {
            throw new IllegalArgumentException("Password length must be greater than 0");
        }

        StringBuilder password = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            int index = random.nextInt(ALPHANUMERIC.length());
            password.append(ALPHANUMERIC.charAt(index));
        }
        return password.toString();
    }

    /**
     * Lowercase random suffix used to make a taken username unique.
     */
    public static String randomSuffix(int count) {
        return getRandomAlphaNumeric(count).toLowerCase();
    }

    /**
     * Generates a random alphanumeric string of the specified count.
     */
    private static String getRandomAlphaNumeric(int count) {
        StringBuilder builder = new StringBuilder(count);
        for (int i = 0; i < count; i++) {
            int index = random.nextInt(ALPHANUMERIC.length());
            builder.append(ALPHANUMERIC.charAt(index));
        }
        return builder.toString();
    }
}
