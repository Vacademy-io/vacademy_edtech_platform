package vacademy.io.notification_service.features.send.service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Membership merge tags that only admin-core can resolve: the member's practice, their plan
 * end date and the link to their subscriptions page. Admin-core builds them in
 * {@code MembershipPlaceholderService} (the same values its enrolment-policy reminders use) and
 * serves them at {@code /internal/membership/placeholders}; this class decides when a message
 * needs them and how they merge with what the caller supplied.
 */
public final class MembershipPlaceholders {

    private MembershipPlaceholders() {
    }

    /** Every key admin-core returns, mirrored from MembershipPlaceholderService.KEYS. */
    public static final List<String> KEYS = List.of(
            "learner_name", "first_name", "last_name", "practice_name",
            "expiry_date", "expiry_date_long", "subscription_link");

    /**
     * Keys whose presence in a message is worth a call to admin-core. first_name / last_name
     * are left out on purpose: callers and {@link UnifiedVariableAliases} already supply them,
     * so on their own they must not cost a lookup on every send.
     */
    private static final List<String> LOOKUP_KEYS = List.of(
            "learner_name", "practice_name", "expiry_date", "expiry_date_long", "subscription_link");

    /** True when any of the texts carries a membership token that needs admin-core. */
    public static boolean usedIn(String... texts) {
        for (String text : texts) {
            if (text == null || text.isEmpty()) {
                continue;
            }
            for (String key : LOOKUP_KEYS) {
                if (text.contains("{{" + key + "}}")) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * The caller's variables plus the member's membership values for every key the caller left
     * out or blank. A value the caller did supply always wins.
     */
    public static Map<String, String> fillMissing(Map<String, String> variables, Map<String, String> membership) {
        Map<String, String> out = variables != null ? new HashMap<>(variables) : new HashMap<>();
        if (membership == null) {
            return out;
        }
        for (String key : KEYS) {
            String current = out.get(key);
            String value = membership.get(key);
            if ((current == null || current.isBlank()) && value != null) {
                out.put(key, value);
            }
        }
        return out;
    }

    /** An empty value for every key, for a recipient admin-core has nothing for. */
    public static Map<String, String> blanks() {
        Map<String, String> out = new HashMap<>();
        KEYS.forEach(k -> out.put(k, ""));
        return out;
    }

    /** Replaces the membership tokens in {@code text}; tokens with no value are left for the caller. */
    public static String apply(String text, Map<String, String> membership) {
        if (text == null || membership == null) {
            return text;
        }
        String out = text;
        for (String key : KEYS) {
            String value = membership.get(key);
            if (value != null) {
                out = out.replace("{{" + key + "}}", value);
            }
        }
        return out;
    }
}
