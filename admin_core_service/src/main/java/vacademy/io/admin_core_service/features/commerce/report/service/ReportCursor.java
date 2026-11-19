package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * The opaque {@code cursor} / {@code next_cursor} of a register page: the sort key (date, number,
 * id) of the last document of the page, base64url-encoded. Clients pass it back unchanged.
 *
 * <p>Not signed: every part is checked when it comes back (length, a real date, a number and an id
 * of the characters this server writes, no control character), and the report applies the
 * institute, location, GSTIN and range again on every page, so a changed cursor only moves the
 * page within what the caller may already see. Anything else: 400 {@code VALIDATION}.
 */
public final class ReportCursor {

    /** Longest cursor accepted (encoded). */
    static final int MAX_LENGTH = 400;
    /** A document number or a stored time: letters, digits and the separators numbers use. */
    private static final Pattern NUMBER = Pattern.compile("^[\\p{L}\\p{N} /_.:#+\\-]{1,100}$");
    /** An id: a UUID or a similar key. */
    static final Pattern ID = Pattern.compile("^[A-Za-z0-9_\\-]{1,64}$");

    private ReportCursor() {
    }

    public static String encode(LocalDate date, String number, String id) {
        String raw = date + "|" + number + "|" + id;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /** The keyset of a cursor; null for none; 400 {@code VALIDATION} for a cursor this server did not write. */
    public static Keyset decode(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String trimmed = cursor.trim();
            if (trimmed.length() > MAX_LENGTH) {
                throw new IllegalArgumentException("length");
            }
            String raw = new String(Base64.getUrlDecoder().decode(trimmed), StandardCharsets.UTF_8);
            int first = raw.indexOf('|');
            int last = raw.lastIndexOf('|');
            if (first != 10 || last <= first + 1 || last == raw.length() - 1) {
                throw new IllegalArgumentException("parts");
            }
            LocalDate date = LocalDate.parse(raw.substring(0, first));
            String number = raw.substring(first + 1, last);
            String id = raw.substring(last + 1);
            if (!NUMBER.matcher(number).matches() || !ID.matcher(id).matches()) {
                throw new IllegalArgumentException("characters");
            }
            return new Keyset(date, number, id);
        } catch (RuntimeException e) {
            throw invalid();
        }
    }

    static InvalidRequestException invalid() {
        return new InvalidRequestException("VALIDATION: cursor is not valid; start from the first page");
    }
}
