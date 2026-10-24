package vacademy.io.admin_core_service.features.telephony.persistence.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One AI voice agent (persona) an institute authored — referenced by the CALL_AI
 * workflow node, the IVR AI branch, campaigns and the manual AI-call button (the
 * agent id doubles as the VACADEMY_AI "campaignId"). See V355 + AiAgentService.
 */
@Entity
@Table(name = "ai_agent")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AiAgent {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "name", nullable = false, length = 128)
    private String name;

    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /** OUTBOUND | INBOUND | BOTH. */
    @Column(name = "direction", nullable = false, length = 16)
    @Builder.Default
    private String direction = "OUTBOUND";

    @Column(name = "language", length = 32)
    private String language;

    /**
     * Voice id — from the palette of whichever engine {@link #ttsModel} selects.
     * The two palettes share NO names (Sarvam: priya/shubh/...; Rumik: ira/adam/...),
     * and they fail differently on a wrong one: Sarvam 400s (no audio), Rumik quietly
     * substitutes its default voice (a voice nobody chose, with Hindi verb gender
     * conjugated for the one they did). AiAgentService settles voice and engine
     * together; the bot drops cross-vendor names defensively too.
     */
    @Column(name = "voice", length = 64)
    private String voice;

    /**
     * TTS engine: {@code rumik} (Silk Mulberry 1.5, the default for new agents) or
     * {@code sarvam} (bulbul:v3). Priced: see ai_tts_model_pricing — Sarvam carries
     * a +4 credits/min surcharge because it costs 6x per character.
     *
     * <p>V421 backfilled every pre-existing agent to 'sarvam' explicitly. NULL is
     * only reachable for a row written outside AiAgentService, and both the billing
     * lookup and the bot treat NULL as 'sarvam' — the two fallbacks must stay in
     * lockstep or we would bill an engine we did not use.
     */
    @Column(name = "tts_model", length = 32)
    private String ttsModel;

    /**
     * TTS speech-cache tier for this agent: {@code OFF} | {@code FIXED} | {@code FULL}
     * (V466). Per-agent rather than per-box because the voice bot's env switches are
     * process-wide, and rolling out to one agent, watching a batch, then widening is
     * the shape this needs. See docs/crm/TTS_SPEECH_CACHE.md.
     */
    @Column(name = "speech_cache_mode", length = 16)
    private String speechCacheMode;

    @Column(name = "opening_line", columnDefinition = "TEXT")
    private String openingLine;

    @Column(name = "system_prompt", columnDefinition = "TEXT")
    private String systemPrompt;

    /** JSON array of the questions the agent should extract answers for. */
    @Column(name = "extraction_questions", columnDefinition = "TEXT")
    private String extractionQuestions;

    /** JSON array of allowed dispositions; blank = classifier defaults from settings. */
    @Column(name = "dispositions", columnDefinition = "TEXT")
    private String dispositions;

    /** JSON array of E.164 handoff targets; blank = telephony voicemail fallback. */
    @Column(name = "handoff_numbers", columnDefinition = "TEXT")
    private String handoffNumbers;

    @Column(name = "max_call_minutes")
    private Integer maxCallMinutes;

    /** Bulbul speaking rate 0.5–2.0 (1.0 native); null = bot's global TTS_PACE. */
    @Column(name = "pace")
    private Double pace;

    /** Bulbul v3 expressiveness 0.01–2.0 (~0.6 default); null = model default. */
    @Column(name = "temperature")
    private Double temperature;

    /** Pitch-range expansion applied by the bot to the voice AUDIO, engine-agnostic
     *  (V504): 1.0 = off, 1.6 = conversational, 2.5 max; null = bot's global default. */
    @Column(name = "voice_modulation")
    private Double voiceModulation;

    // Optional: a booking_page this agent auto-books on when a call yields a meeting
    // request (see AiCallOutcomeProcessor). Null = agent never books.
    @Column(name = "booking_page_id", length = 36)
    private String bookingPageId;

    /**
     * JSON array of AiCallActionRule: what to send (WhatsApp/email) or book when a call
     * ends in a given state. NULL/blank = this agent sends nothing, which is every agent
     * that existed before V462. See AiCallActionService and docs/crm/AI_CALL_ACTIONS.md.
     */
    @Column(name = "send_rules", columnDefinition = "TEXT")
    private String sendRules;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;
}
