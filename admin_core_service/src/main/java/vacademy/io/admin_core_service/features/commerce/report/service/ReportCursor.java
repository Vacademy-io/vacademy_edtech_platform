package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;

/**
 * The opaque {@code cursor} / {@code next_cursor} of a register page: the sort key (date, number,
 * id) of the last document of the page, base64url-encoded. Clients pass it back unchanged.
 */
public final class ReportCursor {

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
            String raw = new String(Base64.getUrlDecoder().decode(cursor.trim()), StandardCharsets.UTF_8);
            int first = raw.indexOf('|');
            int last = raw.lastIndexOf('|');
            if (first < 0 || last <= first + 1 || last == raw.length() - 1) {
                throw new IllegalArgumentException("parts");
            }
            return new Keyset(LocalDate.parse(raw.substring(0, first)), raw.substring(first + 1, last),
                    raw.substring(last + 1));
        } catch (RuntimeException e) {
            throw new InvalidRequestException("VALIDATION: cursor is not valid; start from the first page");
        }
    }
}
