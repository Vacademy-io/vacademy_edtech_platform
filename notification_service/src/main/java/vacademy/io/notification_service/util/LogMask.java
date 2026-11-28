package vacademy.io.notification_service.util;

/**
 * How a phone number or an e-mail address appears in a log line: never whole. A phone keeps its
 * last four digits, an e-mail address its first letter and its domain.
 */
public final class LogMask {

    private LogMask() {
    }

    /** {@code ••••3210}; {@code "null"} for none, {@code ••••} when there are fewer than four digits. */
    public static String phone(String phone) {
        if (phone == null) {
            return "null";
        }
        String digits = phone.replaceAll("\\D", "");
        if (digits.length() < 4) {
            return "••••";
        }
        return "••••" + digits.substring(digits.length() - 4);
    }

    /** {@code a•••@example.com}; {@code "null"} for none, {@code •••} when it is not an address. */
    public static String email(String email) {
        if (email == null) {
            return "null";
        }
        String e = email.trim();
        int at = e.lastIndexOf('@');
        if (at < 1 || at == e.length() - 1) {
            return "•••";
        }
        return e.charAt(0) + "•••" + e.substring(at);
    }
}
