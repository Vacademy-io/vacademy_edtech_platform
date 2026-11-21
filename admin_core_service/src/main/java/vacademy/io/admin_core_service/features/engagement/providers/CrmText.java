package vacademy.io.admin_core_service.features.engagement.providers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.regex.Pattern;

/** Shared text handling for the CRM data points: everything in them is untrusted CRM text. */
final class CrmText {

    private CrmText() {
    }

    private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+");
    /** 8+ digits with the usual separators: phone numbers, never short numbers like "2 PM" or "50 members". */
    private static final Pattern PHONE = Pattern.compile("\\+?\\d(?:[\\s().-]?\\d){7,}");

    /** Trim, collapse whitespace, drop the prompt's own delimiter runs, cap the length. */
    static String clean(Object value, int max) {
        if (value == null) return null;
        String s = value.toString().replaceAll("={3,}", "—").replaceAll("[\\p{Cntrl}\\s]+", " ").trim();
        if (s.isEmpty() || "null".equals(s)) return null;
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    /** {@link #clean} with contact details removed: notes are sent to the model, phones and emails need not be (M3). */
    static String cleanNote(Object value, int max) {
        if (value == null) return null;
        String s = PHONE.matcher(EMAIL.matcher(value.toString()).replaceAll("[email]")).replaceAll("[phone]");
        return clean(s, max);
    }

    /** A database time as an instant. Plain timestamp columns hold naive UTC. */
    static Instant instant(Object v) {
        if (v == null) return null;
        if (v instanceof Instant i) return i;
        if (v instanceof Timestamp t) return t.toLocalDateTime().toInstant(ZoneOffset.UTC);
        if (v instanceof LocalDateTime l) return l.toInstant(ZoneOffset.UTC);
        if (v instanceof OffsetDateTime o) return o.toInstant();
        if (v instanceof java.util.Date d) return d.toInstant();
        try {
            return Instant.parse(v.toString());
        } catch (Exception e) {
            return null;
        }
    }

    static void putTime(ObjectNode n, String key, Object v) {
        Instant i = instant(v);
        if (i != null) n.put(key, i.toString());
    }

    static void put(ObjectNode n, String key, String value) {
        if (value != null) n.put(key, value);
    }

    /** "3d ago", "5h ago", "in 2h", "in 4d" — relative to now, coarse on purpose. */
    static String relative(JsonNode isoInstant, Instant now) {
        if (isoInstant == null || !isoInstant.isTextual()) return "?";
        Instant t;
        try {
            t = Instant.parse(isoInstant.asText());
        } catch (Exception e) {
            return "?";
        }
        Duration d = Duration.between(t, now);
        boolean future = d.isNegative();
        long minutes = Math.abs(d.toMinutes());
        String span = minutes < 60 ? minutes + "m" : minutes < 48 * 60 ? (minutes / 60) + "h" : (minutes / 1440) + "d";
        return future ? "in " + span : span + " ago";
    }
}
