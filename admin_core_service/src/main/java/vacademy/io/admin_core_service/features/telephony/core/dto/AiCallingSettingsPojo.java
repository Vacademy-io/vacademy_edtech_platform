package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Server-side mirror of the AI_CALLING_SETTING JSON the admin saves from the
 * "AI Calling" settings tab. Read via {@code AiCallingSettingsService}; consumed
 * by the outcome classifier to decide assign-vs-retry.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiCallingSettingsPojo {

    private boolean enabled;
    /**
     * AI-voice provider for this institute (e.g. AAVTAAR). Drop in a different agent
     * by registering its SPI beans and setting this — no code change to the caller.
     */
    private String provider = "AAVTAAR";
    private String defaultCampaignId;

    /**
     * Campaign registry: every Aavtaar campaign id this institute uses, each tagged
     * INBOUND (the lead dialed our AI line) or OUTBOUND (we dialed the lead). An
     * incoming AI-call webhook is classified INBOUND when its {@code campaignId}
     * matches one tagged INBOUND here — that's how inbound calls are labelled (there's
     * no provider call id to correlate, so the lead is matched by phone instead). Also
     * lets the call/recording view map a campaignId back to a friendly campaign name.
     * Empty = no campaigns registered (every call stays outbound, current behaviour).
     */
    private List<CampaignConfig> campaigns = new ArrayList<>();

    private int connectThresholdSec = 20;

    /**
     * Show the manual "AI call" button in lead lists. Independent of {@link #enabled}:
     * turning this off only hides the icon — AI workflows keep running.
     */
    private boolean showInLeadList = false;

    private int maxRetries = 3;
    private int maxCallsPerDayPerLead = 3;

    /**
     * A connected call in which the caller said at least this many words is treated as
     * ENGAGED: if it still lands on a "no conclusion" disposition (Incomplete, an
     * unmapped label, a refused booking) it is handed to a human instead of re-dialed.
     * Measured by the bot from the transcript, not judged by the model. 40 is the
     * threshold at which the 2026-09-09 audit found every call was a real two-sided
     * conversation rather than a greeting exchange; voicemail greetings run 25–35.
     */
    private int engagedCallerWords = 40;

    /**
     * Hard ceiling on AI dials for the WHOLE institute in a rolling 24h window
     * (across every lead, campaign and click-to-call — all funnel through
     * {@code AiCallService.placeCall}). The cheapest runaway-spend guardrail: one
     * fat-fingered bulk campaign can otherwise place hundreds of calls, each
     * billing telephony + STT + LLM + TTS. 0 = fall back to the server-wide
     * default ({@code telephony.ai.max-calls-per-day-default}).
     */
    private int maxCallsPerDay = 0;

    /** Minutes the CALL_AI node waits before re-dialing a no-answer lead (per pause/resume cycle). */
    private int retryGapMinutes = 120;
    /** Minutes before re-checking a lead deferred for being outside its calling shift / at the day cap. */
    private int recheckMinutes = 30;

    /**
     * Time windows (institute timezone) the AI bot may (re)dial in — supports
     * multiple shifts (e.g. 09:00–13:00 and 16:00–20:00). Consumed by the timed
     * retry re-dialer; immediate new-lead/manual/bulk calls fire right away.
     */
    private List<Shift> callingShifts = List.of(new Shift("09:00", "21:00"));

    // Legacy single window — kept so older saved settings still deserialize; the UI
    // now edits callingShifts.
    private String windowStart = "09:00";
    private String windowEnd = "21:00";
    private String timezone = "Asia/Kolkata";

    /** Dispositions that mean "good response" → assign a counsellor. */
    private List<String> assignOnDispositions = List.of("Interested", "Likely_Interested");
    /** Dispositions that are terminal → set a status and stop (no retry, no assign). */
    private List<String> stopOnDispositions = List.of("Not_Interested");

    /**
     * Admin-defined outcomes beyond {@link #BUILT_IN_DISPOSITIONS} — the extra
     * disposition strings this institute's own AI agents may return. Saved by the
     * "AI Calling" settings tab as free text; they behave exactly like the built-ins
     * in the Outcome → Action table.
     *
     * <p>Modelled here (rather than being an unknown property) because the Call Log's
     * disposition filter builds its vocabulary from this setting — an outcome an admin
     * configured must be filterable.
     */
    private List<String> customDispositions = new ArrayList<>();

    /**
     * Disposition -> lead-status-key map, e.g. {@code {"Quiz_Link_Sent": "FOLLOWUP"}}.
     *
     * <p>Without this the only workflow-independent status writer matches a disposition
     * to a status whose NAME equals it, so an agent vocabulary like {@code Quiz_Link_Sent}
     * or {@code Counselling_Scheduled} matches nothing and the lead keeps whatever it had.
     * That is survivable while a workflow is alive to route the outcome, and silently
     * wrong the moment one is not — a booked counselling session sitting at Not Reachable
     * because the call landed after the workflow closed.
     *
     * <p>Consulted BEFORE the name match, which stays as the fallback. Keys are matched
     * case- and separator-insensitively, so "quiz link sent" finds "Quiz_Link_Sent".
     * An unmapped disposition, or one pointing at a status the institute does not have,
     * leaves the lead untouched exactly as before.
     */
    private java.util.Map<String, String> dispositionStatusMap = new java.util.LinkedHashMap<>();

    private String assignmentMode = "ROUND_ROBIN";
    private boolean assignExhaustedToHuman = true;

    /**
     * Hand a lead the AI has QUALIFIED to the audience's counsellor pool even when the lead
     * already has an owner.
     *
     * <p>Off by default, because the owner-keeps-the-lead rule exists for a real flow: a
     * counsellor rings a lead, marks it DNP, the bot re-calls it, and rotating that lead away
     * would take it off the person actively working it.
     *
     * <p>On, for the opposite flow: a bulk list of previously-worked leads is moved into an
     * AI-calling list. Every one of them arrives already owned, so the pool is never consulted
     * and a booked counselling session lands silently on whoever last held the lead — often
     * someone who has already given up on it. Turning this on makes a genuine qualification
     * route to the pool that the list is attached to.
     *
     * <p>Scope is deliberately narrow: only a REAL qualification (a disposition in
     * {@link #assignOnDispositions}) can move an owned lead. The exhausted-retries hand-off
     * ({@link #assignExhaustedToHuman}) never does — "nobody picked up" is not a reason to
     * take a lead off its counsellor.
     */
    private boolean reassignQualifiedToPool = false;

    /**
     * Auto-capture unknown INBOUND callers as leads. When the AI helpline answers a
     * caller whose number isn't already a lead, create (or match) a lead so the call
     * is followable in Recent Leads + the Call Log. OFF by default — auto-creating
     * leads changes CRM data, so it's an explicit per-institute opt-in (an inbound
     * helpline wants it; a purely-outbound institute does not).
     */
    private InboundLeadCapture inboundLeadCapture = new InboundLeadCapture();

    /**
     * The product's fixed AI-outcome vocabulary — the rows the "AI Calling" settings
     * tab always renders in its Outcome → Action table, before the institute adds any
     * {@link #customDispositions}. Mirrored by {@code DISPOSITIONS} in
     * {@code AiCallingSettings.tsx}; keep the two in step.
     */
    public static final List<String> BUILT_IN_DISPOSITIONS = List.of(
            "Interested", "Likely_Interested", "Callback",
            "Requirement_Not_Clear", "Incomplete", "Not_Interested");

    public static AiCallingSettingsPojo defaults() {
        return new AiCallingSettingsPojo();
    }

    /**
     * Every AI outcome this institute has configured, in settings-tab order:
     * the built-ins, then the admin's custom ones, then anything referenced only by
     * the assign/stop lists. De-duplicated case-insensitively, order-preserving —
     * this is the AI half of the Call Log's disposition filter vocabulary.
     */
    public List<String> configuredDispositions() {
        java.util.LinkedHashMap<String, String> byKey = new java.util.LinkedHashMap<>();
        List<List<String>> sources = List.of(
                BUILT_IN_DISPOSITIONS,
                customDispositions == null ? List.<String>of() : customDispositions,
                assignOnDispositions == null ? List.<String>of() : assignOnDispositions,
                stopOnDispositions == null ? List.<String>of() : stopOnDispositions);
        for (List<String> source : sources) {
            for (String d : source) {
                if (d == null || d.isBlank()) continue;
                byKey.putIfAbsent(d.trim().toUpperCase(), d.trim());
            }
        }
        return List.copyOf(byKey.values());
    }

    /**
     * Resolve the raw provider campaign id for a provider-agnostic agent name, from the
     * {@link #campaigns} registry. Preference order: an exact (name, provider) entry, then
     * a (name, any-provider) entry, then {@link #defaultCampaignId}. This is what lets a
     * workflow author pick a named agent and have it resolve to the right id for whichever
     * provider is active — no raw campaign id in the node.
     */
    public String resolveCampaignId(String provider, String agentName) {
        if (agentName != null && !agentName.isBlank() && campaigns != null) {
            String byProvider = null, byAny = null;
            String wanted = agentName.trim();
            for (CampaignConfig c : campaigns) {
                if (c == null || c.getCampaignId() == null || c.getCampaignId().isBlank()) continue;
                if (c.getName() == null || !c.getName().equalsIgnoreCase(wanted)) continue;
                if (provider != null && provider.equalsIgnoreCase(c.getProvider())) {
                    byProvider = c.getCampaignId();
                } else if (c.getProvider() == null || c.getProvider().isBlank()) {
                    byAny = c.getCampaignId();
                }
            }
            if (byProvider != null) return byProvider;
            if (byAny != null) return byAny;
        }
        // defaultCampaignId may hold an agent NAME rather than a raw campaign id: the
        // Settings "Default Campaign ID" field is free text, and admins routinely paste
        // the agent's name (e.g. "Jin AI") instead of its uuid. If it matches a
        // registered campaign's name, resolve to that campaign's real id; otherwise use
        // it verbatim (a raw provider campaign id, e.g. an Aavtaar id). This makes every
        // call path — manual, bulk, workflow — reach the right agent despite the mix-up.
        if (defaultCampaignId != null && !defaultCampaignId.isBlank() && campaigns != null) {
            String byName = null;
            for (CampaignConfig c : campaigns) {
                if (c == null || c.getCampaignId() == null || c.getCampaignId().isBlank()) continue;
                if (!defaultCampaignId.equalsIgnoreCase(c.getName())) continue;
                if (provider != null && provider.equalsIgnoreCase(c.getProvider())) {
                    return c.getCampaignId();          // a provider-specific name match wins
                }
                if (byName == null) byName = c.getCampaignId(); // else fall back to any-provider match
            }
            if (byName != null) return byName;
        }
        return defaultCampaignId;
    }

    /** A single calling window. {@code start}/{@code end} are "HH:mm" (24h). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Shift {
        private String start;
        private String end;
    }

    /**
     * Inbound-caller lead capture config. {@link #enabled} off ⇒ current behaviour
     * (an unknown inbound caller leaves only the ai_call_result row, no lead). On ⇒
     * the outcome processor creates/matches a lead for the caller (de-duped by phone)
     * and back-fills the call log so it shows named and followable.
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class InboundLeadCapture {
        private boolean enabled = false;
    }

    /**
     * One configured AI campaign and its direction. {@code name} is the
     * provider-agnostic "agent" a workflow author picks (e.g. "Class Feedback");
     * {@code campaignId} is the raw id THIS {@code provider} uses for that agent;
     * {@code direction} is "INBOUND" / "OUTBOUND" (case-insensitive). The same
     * {@code name} can appear once per provider, so switching provider resolves the
     * same named agent to the right campaign id — that's how a call stays
     * provider-agnostic. {@code provider} blank ⇒ applies to any provider.
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CampaignConfig {
        private String campaignId;
        private String name;
        private String direction;
        /** Which provider this campaign id belongs to (e.g. AAVTAAR). Blank ⇒ any provider. */
        private String provider;
    }
}
