package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;

/**
 * Deep per-call detail for the Call Log "more details" popover — richer than the
 * search row, built to explain <em>why</em> a call ended the way it did (FAILED /
 * BUSY / NO_ANSWER especially). Adds the provider's own hangup/cause/error fields
 * (best-effort parsed out of the stored raw webhook body) plus price + full timing
 * that the paginated list omits.
 *
 * <p>{@code providerDetails} is a curated, human-labeled subset safe to show to
 * any dashboard viewer. {@code rawProviderResponse} is the verbatim webhook body
 * and may contain phone numbers, so it is populated only for callers whose role
 * may see full numbers (same gate as the masked numbers — see
 * {@link vacademy.io.admin_core_service.features.telephony.core.CallNumberVisibilityService}).
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CallDetailDTO {

    private String id;
    private String providerType;
    private String direction;
    private String status;
    private String terminationReason;
    private String providerCallId;

    private Timestamp startTime;
    private Timestamp answerTime;
    private Timestamp endTime;
    private Integer durationSeconds;
    private BigDecimal price;

    /** Curated provider fields (hangup cause, SIP/cause code, error, …) parsed from the raw body. */
    private List<KeyVal> providerDetails;

    /** Verbatim provider webhook body — null unless the caller may unmask numbers. */
    private String rawProviderResponse;

    // ── AI-voice technical diagnostics (V416) ────────────────────────────────
    // All null for human calls, for AI providers that emit no diagnostics, and for
    // every call that predates the blob. NULL MEANS "NOT MEASURED" — the UI must
    // never render a missing verdict as healthy, or a fleet chart will claim
    // "fixed" about something that is not.

    /** GREEN / AMBER / RED. The one field the triage hover leads with. */
    private String diagHealth;

    /** Fired fault codes, e.g. ["DEAD_AIR","TTS_WEDGE"]. Closed, append-only vocabulary of 12. */
    private List<String> diagFaults;

    // ── AI-voice follow-up gist (V510) ───────────────────────────────────────
    // The counsellor's one-sentence answer to "do I call this lead myself?" — the
    // recommendation and the concrete reason from the call. Not a grade of the
    // assistant, not the disposition restated. NULL = NOT ASSESSED, never CALL.

    /** CALL / CALL_LATER / SKIP — colours the gist and feeds a filter; never shown alone. */
    private String followUp;

    /** One sentence, e.g. "Worth a call — runs a 50-member hybrid studio, asked about pricing." */
    private String followUpGist;

    /** Words the caller actually said (measured). Null = not measured, NOT zero. */
    private Integer callerWordCount;

    /** Highest-priority fired code — what to headline when several fired. */
    /**
     * Was the TTS speech cache actually running on this call?
     *
     * <p>Decided HERE, not in the UI. The panel must not appear for the agents
     * nobody has enabled it for — showing a grid of "not measured" advertises a
     * feature the institute has not turned on and buries the rows that matter.
     * And a per-call answer is the honest one: a call placed before the agent was
     * switched on genuinely had no cache, whatever the agent's mode says today.
     *
     * <p>Derived from the diagnostics blob rather than joined from
     * ai_agent.speech_cache_mode for that reason — the blob is what the bot
     * recorded at the time, and its counters are null exactly when the cache was
     * off or unreadable.
     */
    private Boolean ttsCacheActive;

    private String diagHeadline;

    /** Human sentence for {@link #diagHeadline}, e.g. "Voice synthesis stalled — caller heard silence". */
    private String diagHeadlineText;

    /** Bot's threshold-set version, so an old verdict is never read against today's rules. */
    private Integer diagRulesVersion;

    /**
     * The full diagnostics blob (tts, playout, turnTaking, latency, setup, machine,
     * infra). Gated behind the same {@code VIEW_CALL_NUMBERS} authority as
     * {@link #rawProviderResponse}: it carries verbatim caller utterances
     * (turnTaking.answersDeletedSamples) and raw crash strings. The summary fields
     * above stay visible to every dashboard viewer.
     */
    private Map<String, Object> diagnostics;

    @Data
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class KeyVal {
        private String label;
        private String value;
    }
}
