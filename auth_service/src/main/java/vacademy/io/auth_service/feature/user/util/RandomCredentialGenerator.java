package vacademy.io.auth_service.feature.user.util;

import org.apache.commons.lang3.RandomStringUtils;

import java.security.SecureRandom;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class RandomCredentialGenerator {

    private static final String CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    public static String generateRandomPassword() {
        return generateRandomString(6);
    }

    public static String generateRandomUsername(String fullName) {
        return generateUsername(fullName);
    }

    private static String generateRandomString(int length) {
        return IntStream.range(0, length)
                .mapToObj(i -> String.valueOf(CHARACTERS.charAt(RANDOM.nextInt(CHARACTERS.length()))))
                .collect(Collectors.joining());
    }

    private static String generateUsername(String fullName) {
        // Ensure full name has at least 4 characters, else pad with "X"
        // Bound the cut by the stripped length: "A B C" strips to 3 characters while the
        // raw length is 5, and cutting 4 threw StringIndexOutOfBoundsException.
        String stripped = fullName == null ? "" : fullName.replaceAll("\\s+", "");
        String namePart = stripped.substring(0, Math.min(stripped.length(), 4)).toLowerCase();
        if (namePart.length() < 4) {
            namePart = String.format("%-4s", namePart).replace(' ', 'X');
        }

        // Generate 4 random digits
        String randomDigits = RandomStringUtils.randomNumeric(4);

        return namePart + randomDigits;
    }
}
