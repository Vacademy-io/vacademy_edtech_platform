package vacademy.io.admin_core_service.features.learner.service;

import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Picks the delivery zone of a zone-priced shipping charge for a PIN code — the server half of
 * the storefront's zone lookup (additional-charges-util.ts matchZone), so both sides land on the
 * same rate. Keep the two in step.
 *
 * <p>A zone serves a PIN when the PIN starts with one of its {@code pinPrefixes} (none listed =
 * every PIN) and with none of its {@code excludePinPrefixes}. The first zone in config order that
 * serves the PIN wins, so a catch-all zone goes last. Prefixes are compared as written.
 */
public final class ShippingZoneMatcher {

    private static final Pattern PIN_CODE = Pattern.compile("^\\d{6}$");

    private ShippingZoneMatcher() {
    }

    /**
     * One {@code zones[]} entry of a charge. A null prefix list is absent; a null entry stands for
     * one that is not a string — it keeps the list non-empty but matches no PIN, as in the cart.
     */
    public record Zone(String key, List<String> pinPrefixes, List<String> excludePinPrefixes,
                       String planId, Double amount) {

        public Zone {
            pinPrefixes = pinPrefixes == null ? List.of() : pinPrefixes.stream().toList();
            excludePinPrefixes = excludePinPrefixes == null ? List.of() : excludePinPrefixes.stream().toList();
        }

        /** Whether the zone can be charged: the cart shows no rate (and blocks checkout) without both. */
        public boolean priced() {
            return planId != null && amount != null;
        }

        /** Whether this zone delivers to {@code pin} (a normalised six-digit PIN). */
        boolean serves(String pin) {
            return (pinPrefixes.isEmpty() || startsWithAny(pin, pinPrefixes))
                    && !startsWithAny(pin, excludePinPrefixes);
        }
    }

    /** The PIN trimmed when it is exactly six digits, else null. */
    public static String normalisePin(String pin) {
        if (pin == null) {
            return null;
        }
        String trimmed = pin.trim();
        return PIN_CODE.matcher(trimmed).matches() ? trimmed : null;
    }

    /** The first zone that serves {@code pin}; empty when the PIN is not valid or no zone serves it. */
    public static Optional<Zone> match(List<Zone> zones, String pin) {
        String normalised = normalisePin(pin);
        if (normalised == null || zones == null) {
            return Optional.empty();
        }
        for (Zone zone : zones) {
            if (zone != null && zone.serves(normalised)) {
                return Optional.of(zone);
            }
        }
        return Optional.empty();
    }

    private static boolean startsWithAny(String pin, List<String> prefixes) {
        for (String prefix : prefixes) {
            if (prefix != null && pin.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }
}
