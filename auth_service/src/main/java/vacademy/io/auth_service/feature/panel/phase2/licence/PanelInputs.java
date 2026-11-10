package vacademy.io.auth_service.feature.panel.phase2.licence;

import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.regex.Pattern;

/** Request checks shared by the seat and installer endpoints. Every check runs before any query. */
public final class PanelInputs {

    /** Institute ids are UUIDs; this also keeps odd text out of queries and logs. */
    private static final Pattern INSTITUTE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern ROW_ID = Pattern.compile("[A-Za-z0-9_-]{1,36}");

    private PanelInputs() {
    }

    public static String instituteId(String raw) {
        if (raw == null || !INSTITUTE_ID.matcher(raw).matches()) {
            throw PanelApiException.badRequest("institute_id is required");
        }
        return raw;
    }

    /** A room, device, grant, partner, link or invite id from a path. Unknown shapes read as not found. */
    public static String rowId(String raw, String what) {
        if (raw == null || !ROW_ID.matcher(raw).matches()) {
            throw PanelApiException.notFound("No such " + what);
        }
        return raw;
    }

    /** Trimmed, 1..max characters, no control characters. */
    public static String text(String raw, int max, String field) {
        String clean = raw == null ? "" : raw.trim();
        if (clean.isEmpty() || clean.length() > max || PanelSecrets.hasControlChars(clean)) {
            throw PanelApiException.badRequest(field + " must be 1 to " + max + " characters");
        }
        return clean;
    }

    /** As {@link #text}, but blank means null. */
    public static String optionalText(String raw, int max, String field) {
        return raw == null || raw.isBlank() ? null : text(raw, max, field);
    }

    public static int range(Integer value, int min, int max, String field) {
        if (value == null || value < min || value > max) {
            throw PanelApiException.badRequest(field + " must be between " + min + " and " + max);
        }
        return value;
    }

    /** An ISO-8601 instant with an offset, such as 2027-03-31T18:29:59Z. */
    public static Instant instant(String raw, String field) {
        if (raw == null || raw.isBlank() || raw.length() > 40) {
            throw PanelApiException.badRequest(field + " must be an ISO-8601 time with an offset");
        }
        try {
            return Instant.parse(raw.trim());
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(raw.trim()).toInstant();
            } catch (DateTimeParseException again) {
                throw PanelApiException.badRequest(field + " must be an ISO-8601 time with an offset");
            }
        }
    }

    public static String iso(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    public static String iso(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    public static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
