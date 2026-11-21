package vacademy.io.common.core.utils;

/**
 * Strips characters that are invisible to a human but significant to a byte
 * comparison.
 *
 * <p>
 * Emails and names pasted from spreadsheets, PDFs, mail clients and
 * WhatsApp routinely carry a leading ZERO WIDTH SPACE (U+200B), a BOM
 * (U+FEFF), a non-breaking space (U+00A0) or a bidi control. They look
 * identical to the clean value everywhere a human can see them — the admin UI,
 * the CSV, the DB console — but they make every exact-match lookup miss.
 *
 * <p>
 * Note that {@code String.trim()} and {@code String.strip()} do <em>not</em>
 * remove any of these: {@code Character.isWhitespace('​')} is false, and
 * trim() only cuts chars below U+0020. That is precisely why they survive.
 *
 * <p>
 * Confirmed live on 2026-09-14: four learners imported with a U+200B in front
 * of their email could not authenticate at all. The JWT subject carried the
 * character, the internal user lookup URL double-encoded it to
 * {@code %25E2%2580%258B}, auth_service found no such user, and every
 * authenticated endpoint answered with a bodyless 403.
 */
public final class TextSanitizer {

    private TextSanitizer() {
    }

    /**
     * Characters removed outright — they carry no meaning in an identifier.
     * Zero-width and joiner marks, the BOM / word joiner, soft hyphen, and the
     * bidi formatting controls (which can also be used to disguise one string as
     * another).
     */
    private static final String INVISIBLE_CHARS =
            "[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\u00AD]";

    /**
     * Space lookalikes — collapsed to a plain space rather than deleted, so
     * "John Doe" stays two words.
     */
    private static final String SPACE_LOOKALIKES =
            "[\\u00A0\\u2000-\\u200A\\u2007\\u2028\\u2029\\u202F\\u205F\\u3000]";

    /**
     * Normalises any user-supplied text: drops invisible characters, folds space
     * lookalikes to a plain space, and strips the ends. Null-safe.
     */
    public static String clean(String value) {
        if (value == null) {
            return null;
        }
        return value
                .replaceAll(INVISIBLE_CHARS, "")
                .replaceAll(SPACE_LOOKALIKES, " ")
                .strip();
    }

    /**
     * Normalises a login identifier (username / email). Same as
     * {@link #clean(String)} but also removes any remaining internal whitespace,
     * which is never valid in one of ours and is the other common paste artefact.
     */
    public static String cleanIdentifier(String value) {
        String cleaned = clean(value);
        return cleaned == null ? null : cleaned.replaceAll("\\s+", "");
    }

    /**
     * True when the value contains something {@link #clean(String)} would remove.
     * Useful for logging that an input had to be repaired without logging the
     * invisible character itself.
     */
    public static boolean hasInvisibleChars(String value) {
        return value != null && !value.equals(clean(value));
    }
}
