package vacademy.io.admin_core_service.features.telephony.core;

/**
 * The one place a stored phone number becomes an E.164 destination.
 *
 * <p>Both outbound adapters (Vacademy AI over Plivo, Airtel click2dial) used to carry
 * their own copy of this logic — "mirrors" that had already begun to drift. One copy,
 * one set of tests.
 *
 * <p>Incident 2026-09-11, 43 failed AI calls in one campaign: the audience list had
 * been through Excel/pandas with the phone column as a NUMBER, so every lead was
 * stored as {@code 9425677707.0}. Stripping non-digits turned that into the 11-digit
 * {@code 94256777070}, which fell through to the "already has a country code" branch
 * and was dialled as {@code +94256777070} — a Sri Lankan number. Plivo refused it and
 * each row died as {@code provider_initiate_failure}. A trailing {@code .0} is now
 * removed BEFORE digits are extracted; no real phone number ends in ".0".
 */
public final class PhoneNumbers {

    private PhoneNumbers() {}

    /**
     * Normalise a stored number to E.164, or {@code null} when nothing dialable is
     * left. Indian numbers are the default: a bare 10-digit mobile, an
     * {@code 0}-prefixed trunk form and a {@code 91}-prefixed form all resolve to
     * {@code +91…}; anything else is treated as already carrying its country code.
     */
    public static String toE164(String raw) {
        if (raw == null) return null;
        // Float artefact from spreadsheets: "9425677707.0" / "9425677707.00".
        String cleaned = raw.trim().replaceAll("\\.0+$", "");
        // Scientific notation means the digits are already gone ("9.43E+09");
        // refuse rather than dial whatever survives the strip.
        if (cleaned.matches("(?i).*\\d[eE][+-]?\\d.*")) return null;
        String digits = cleaned.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) return null;
        if (digits.length() == 10) return "+91" + digits;              // bare Indian mobile
        if (digits.length() == 11 && digits.startsWith("0")) return "+91" + digits.substring(1);
        if (digits.length() == 12 && digits.startsWith("91")) return "+" + digits;
        if (digits.length() < 10 || digits.length() > 15) return null; // not a phone number
        return "+" + digits;                                            // already has a country code
    }
}
