package vacademy.io.admin_core_service.features.credits.client;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;

/**
 * What ai_service's usage-limit gate ({@code POST /ai-service/internal/metering/v1/authorize})
 * said about one AI operation.
 *
 * <p>{@code decision} is NONE (no limits apply: no policy, policy OFF, or the use case is not
 * limit-eligible), OK, WARN, WOULD_BLOCK (shadow mode: logged, allowed) or BLOCK. Only
 * {@code allow == false} stops work; every other answer, and every failure to get an answer,
 * lets the work run exactly as it does today.
 *
 * <p>{@code block} is the 429 body ai_service would send a browser (error, use_case,
 * use_case_label, scope, period, limit, used, unit, resets_at, set_by, message) when
 * {@code allow} is false, otherwise null.
 */
public record AuthorizeResult(boolean allow, String decision, Map<String, Object> block) {

    public static final String NONE = "NONE";
    public static final String BLOCK = "BLOCK";

    /** No limits in play, or the gate could not be asked: the work runs as today. */
    public static final AuthorizeResult ALLOW_NONE = new AuthorizeResult(true, NONE, null);

    static final String DEFAULT_MESSAGE = "You've reached the AI usage limit set for this feature. Please try again later.";

    /**
     * True only for a real refusal. A null result (a mocked or absent client) is not a
     * refusal: the limit gate fails open everywhere.
     */
    public static boolean blocks(AuthorizeResult result) {
        return result != null && !result.allow();
    }

    /** The user-facing sentence from the block body, or a generic one. */
    public String message() {
        Object m = block == null ? null : block.get("message");
        String s = m == null ? null : m.toString().trim();
        return s == null || s.isEmpty() ? DEFAULT_MESSAGE : s;
    }

    /** The block body's {@code resets_at}, or null when absent or unreadable. */
    public Instant resetsAt() {
        Object v = block == null ? null : block.get("resets_at");
        if (v == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(v.toString().trim()).toInstant();
        } catch (Exception e) {
            try {
                return Instant.parse(v.toString().trim());
            } catch (Exception ignored) {
                return null;
            }
        }
    }
}
