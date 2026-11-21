package vacademy.io.notification_service.util;

import java.util.Arrays;
import java.util.List;

/**
 * Utility class for checking if email domains are blocked from receiving notifications.
 */
public class EmailDomainBlocklistUtil {

    /**
     * List of email domains that should not receive email notifications.
     * Add more domains here as needed in the future.
     */
    private static final List<String> BLOCKED_EMAIL_DOMAINS = Arrays.asList(
            "@fivesep.in",
            "@vacademy.com"
            // Add more blocked domains here, e.g.:
            // "@example.com",
            // "@testdomain.org"
    );

    /**
     * True for an address under the reserved {@code .invalid} top-level domain (RFC 2606). Such
     * an address can never be delivered: the platform uses it for accounts that have no mailbox
     * (a shop buyer known only by phone). Mailing it would only bounce.
     */
    public static boolean isReservedUndeliverable(String email) {
        if (email == null) {
            return false;
        }
        String e = email.trim().toLowerCase();
        if (e.endsWith(">")) {
            e = e.substring(0, e.length() - 1).trim();
        }
        return e.endsWith(".invalid");
    }

    /**
     * Checks if an email address belongs to a blocked domain.
     * 
     * @param email The email address to check
     * @return true if the email domain is blocked, false otherwise
     */
    public static boolean isEmailDomainBlocked(String email) {
        if (email == null || email.trim().isEmpty()) {
            return false;
        }
        
        String emailLower = email.toLowerCase().trim();
        return BLOCKED_EMAIL_DOMAINS.stream()
                .anyMatch(blockedDomain -> emailLower.endsWith(blockedDomain.toLowerCase()));
    }
}

