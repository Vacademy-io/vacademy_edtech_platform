package vacademy.io.admin_core_service.features.super_admin.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * One AI call, as the super-admin call review needs it: who it was for, what it
 * cost us, what we billed, and enough to open the recording and the health
 * post-mortem without a second round trip.
 *
 * <p>COST IS MODELLED, not measured, and the flag says so. The voice bot does
 * not yet report its token or character usage (ai_token_usage has no voice
 * rows) and telephony_call_log.price has never been populated on a single row
 * of 9,690 — so every rupee here is duration x a rate-card row. A margin number
 * nobody can audit is worse than none, hence {@link #costIsModelled}.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@NoArgsConstructor
@AllArgsConstructor
public class SuperAdminCallDTO {
    private String id;
    private String correlationId;
    private String instituteId;
    private String instituteName;

    private String agentId;
    private String agentName;
    /** TTS engine actually used for this agent: google | sarvam | rumik | smallest. */
    private String ttsModel;
    private String voice;

    /** The provider's own call id — what you quote to Plivo in a ticket. */
    private String providerCallId;
    private String phoneNumber;
    private String customerName;
    private String direction;
    private String status;
    private String disposition;

    private java.util.Date callStart;
    private Integer durationSeconds;

    /** Recording lives on the joined telephony_call_log row, not on ai_call_result. */
    private String recordingUrl;
    private Boolean hasRecording;

    private String health;              // GREEN | AMBER | RED
    private List<String> faults;
    /** The full diagnostics blob, so the health sheet renders without a second call. */
    private String diagnostics;

    private Double costInr;
    private Double billedInr;
    /**
     * true = billedInr is final: every billable leg is in the ledger or was stamped
     * billed at 0 (0-rate override), or nothing was billable (not connected).
     * false = at least one leg is still to be charged and its share is an estimate
     * (billedInr = ledger of the charged leg + estimate of the pending one).
     */
    private Boolean billedFromLedger;
    private Double marginInr;
    private Double marginPct;
    /** Per-component rupee breakdown: plivo / stt / tts / llm. */
    private java.util.Map<String, Double> costBreakdown;
    private Boolean costIsModelled;

    /**
     * Characters the bot actually synthesised on this call (diagnostics.tts.chars).
     *
     * <p>Non-null means the {@code tts} cost line is the vendor's METERED quantity
     * rather than duration x the 779 chars/call-min fleet average. Null means the blob
     * was absent and the average was used — a distinction worth showing, because the
     * average is a mean and a monologue-heavy agent sits well above it.
     */
    private Integer ttsCharsMeasured;

    /** Sentences served from the TTS speech cache instead of the vendor, and the
     *  characters they represent. NULL (never 0) when the bot did not measure —
     *  the cache was off, or the row predates it. */
    private Integer ttsCacheHits;
    private Integer ttsCacheMisses;
    private Integer ttsCacheCharsSaved;
    /** Rupees the cache kept off this call's TTS bill. Null on the free engines
     *  (edge) and on smallest, whose invoice rate is still unconfirmed — there a
     *  cache hit is a latency win, not a rupee one. */
    private Double ttsCacheSavedInr;
}
