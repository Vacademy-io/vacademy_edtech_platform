package vacademy.io.admin_core_service.features.commerce.tax.service;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Shape and checksum of a GSTIN: 15 characters, a two-digit state
 * code, a PAN, an entity character, Z, and a check character. It does not ask the GST portal
 * whether the number is registered.
 */
public final class GstinValidator {

    private static final String ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final Pattern SHAPE = Pattern.compile("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$");

    private GstinValidator() {
    }

    /** Upper-case and trimmed, or null for a blank value. */
    public static String normalise(String gstin) {
        if (gstin == null) {
            return null;
        }
        String cleaned = gstin.trim().toUpperCase(Locale.ROOT);
        return cleaned.isEmpty() ? null : cleaned;
    }

    public static boolean isValid(String gstin) {
        String value = normalise(gstin);
        if (value == null || !SHAPE.matcher(value).matches()) {
            return false;
        }
        int state = Integer.parseInt(value.substring(0, 2));
        if (state < 1 || state > 99) {
            return false;
        }
        return checkCharacter(value.substring(0, 14)) == value.charAt(14);
    }

    /** The two-digit state code a valid GSTIN starts with. */
    public static String stateCode(String gstin) {
        String value = normalise(gstin);
        return value == null || value.length() < 2 ? null : value.substring(0, 2);
    }

    /** The check character for the first 14 characters (the base-36 scheme the GST system uses). */
    static char checkCharacter(String first14) {
        int sum = 0;
        for (int i = 0; i < first14.length(); i++) {
            int product = ALPHABET.indexOf(first14.charAt(i)) * (i % 2 == 0 ? 1 : 2);
            sum += product / 36 + product % 36;
        }
        return ALPHABET.charAt((36 - sum % 36) % 36);
    }
}
