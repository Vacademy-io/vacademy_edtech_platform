package vacademy.io.admin_core_service.features.telephony.queue;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.format.DateTimeParseException;

/**
 * Copies the voice bot's failed vendor calls into {@code external_api_call_log}, so they are
 * listed with every other failed third-party call on the platform portal.
 *
 * <p>The voice bot has no database. It keeps its recent failures (an HTTP error or connection
 * failure on any outside host, Sarvam's "Credits exhausted" and other socket refusals, a
 * mid-call switch to the fallback vendor) and returns them as {@code vendorFailures} on the
 * {@code /health} that {@link AiVoiceBoxHealthPoller} reads every 30 s. Each entry carries a
 * unique id; the insert is keyed on it (stored in {@code run_id}), so a second replica, a
 * restart or the same entry seen on the next poll never writes it twice.
 *
 * <p>Entries hold the host, method and first two path segments, the status and a short
 * reason. No key, header, query or body is ever in them.
 */
@Component
public class VoiceBotVendorFailureRecorder {

    private static final Logger log = LoggerFactory.getLogger(VoiceBotVendorFailureRecorder.class);

    static final String SOURCE_SERVICE = "voice_bot";

    private final JdbcTemplate jdbc;

    public VoiceBotVendorFailureRecorder(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Never throws: the health poll must not depend on this. */
    public void record(String boxSlug, JsonNode failures) {
        if (failures == null || !failures.isArray()) return;
        int written = 0;
        for (JsonNode f : failures) {
            try {
                written += recordOne(f);
            } catch (Exception e) {
                log.debug("voice-bot vendor failure not recorded for box {}: {}", boxSlug, e.getClass().getSimpleName());
            }
        }
        if (written > 0) log.info("voice box {}: {} failed vendor call(s) recorded", boxSlug, written);
    }

    int recordOne(JsonNode f) {
        String id = text(f, "id");
        Instant at = instant(text(f, "at"));
        String vendor = text(f, "vendor");
        if (id == null || at == null || vendor == null) return 0;
        Integer status = f.hasNonNull("httpStatus") && f.get("httpStatus").canConvertToInt()
                ? f.get("httpStatus").asInt() : null;
        String operation = text(f, "operation");
        return jdbc.update("""
                INSERT INTO external_api_call_log
                    (occurred_at, vendor, source_service, operation, status, http_status, error_message, run_id,
                     request_summary, response_summary)
                SELECT ?, ?, ?, ?, 'FAILED', ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb)
                 WHERE NOT EXISTS (SELECT 1 FROM external_api_call_log WHERE occurred_at = ? AND run_id = ?)
                """,
                Timestamp.from(at), clip(vendor, 255), SOURCE_SERVICE, clip(operation == null ? "call" : operation, 64),
                status, clip(text(f, "reason"), 1000), clip(id, 255), json(f.get("request")), json(f.get("response")),
                // An entry always comes back with the same `at`, so the time index finds it; run_id
                // alone has no index and the bot's whole list is re-read every poll.
                Timestamp.from(at), clip(id, 255));
    }

    /** An object node as JSON text for a jsonb column; null when absent. The bot already redacted it. */
    private static String json(JsonNode node) {
        return node == null || node.isNull() || !node.isContainerNode() ? null : node.toString();
    }

    private static String clip(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() || v.asText().isBlank() ? null : v.asText();
    }

    private static Instant instant(String iso) {
        if (iso == null) return null;
        try {
            return Instant.parse(iso);
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
