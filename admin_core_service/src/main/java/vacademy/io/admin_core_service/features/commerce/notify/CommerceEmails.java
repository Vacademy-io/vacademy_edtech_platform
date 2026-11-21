package vacademy.io.admin_core_service.features.commerce.notify;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Whether an e-mail address may be written to. A copy of notification_service's rule for the
 * reserved {@code .invalid} top-level domain (RFC 2606: never delivered), which every holder
 * account of a phone-only buyer uses, plus a plain shape check.
 */
public final class CommerceEmails {

    private static final Pattern SHAPE = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private CommerceEmails() {
    }

    /** True for an address of the shape a@b.c whose domain is not {@code .invalid}. */
    public static boolean deliverable(String email) {
        if (email == null) {
            return false;
        }
        String e = email.trim();
        if (e.isEmpty() || e.length() > 320 || !SHAPE.matcher(e).matches()) {
            return false;
        }
        return !isReservedUndeliverable(e);
    }

    /**
     * The test of notification_service's {@code EmailDomainBlocklistUtil.isReservedUndeliverable}:
     * the address (trimmed, lower case, a closing {@code >} removed) ends in {@code .invalid}.
     */
    public static boolean isReservedUndeliverable(String email) {
        if (email == null) {
            return false;
        }
        String e = email.trim().toLowerCase(Locale.ROOT);
        if (e.endsWith(">")) {
            e = e.substring(0, e.length() - 1).trim();
        }
        return e.endsWith(".invalid");
    }
}
