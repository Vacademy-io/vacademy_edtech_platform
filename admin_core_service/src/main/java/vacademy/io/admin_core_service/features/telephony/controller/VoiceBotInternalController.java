package vacademy.io.admin_core_service.features.telephony.controller;

import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingConfigService;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Internal API for the Vacademy AI voice-bot service (the bot is stateless — no
 * DB). Gated by {@code InternalAuthFilter} (URI contains "internal": clientName +
 * Signature headers validated against {@code client_secret_key}; register a
 * {@code voice_bot_service} row there).
 *
 *   GET  /internal/voice-bot/call-context?corr=   — everything the bot needs at
 *        WS-connect time: lead + institute + agent persona + handoff + the
 *        webhook token for posting the end-of-call report.
 *   POST /internal/voice-bot/handoff              — the bot registered a mid-call
 *        human transfer; persists the resolved target on the call-log row, then
 *        the bot closes its stream and Plivo falls through to /plivo/ai-next.
 *
 * Phase B: the agent persona is a built-in default template parameterised by the
 * institute + AI-calling settings. Phase C replaces it with the ai_agent registry
 * (this endpoint's contract is already shaped for that).
 */
@RestController
@RequestMapping("/admin-core-service/internal/voice-bot")
public class VoiceBotInternalController {

    private static final Logger log = LoggerFactory.getLogger(VoiceBotInternalController.class);

    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private TelephonyConfigCache configCache;
    @Autowired private AiCallingSettingsService aiCallingSettingsService;
    @Autowired private AiCallingConfigService aiCallingConfigService;
    @Autowired private UserMobileResolver userMobileResolver;
    @Autowired private InstituteRepository instituteRepository;
    @Autowired private vacademy.io.admin_core_service.features.telephony.core.AiAgentService aiAgentService;
    // @Lazy: AudienceService is a large service; avoid an eager bean cycle. Used only to
    // read the lead's custom/form fields so the agent can personalise the call.
    @Autowired @org.springframework.context.annotation.Lazy
    private vacademy.io.admin_core_service.features.audience.service.AudienceService audienceService;

    @Autowired private vacademy.io.admin_core_service.features.telephony.core.AiCallActionService
            aiCallActionService;

    @Autowired private vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository
            audienceResponseRepo;

    // A lead with at least IMPORT_MIN_ROWS campaign-mates stamped within IMPORT_WINDOW_MINUTES
    // either side arrived in a bulk import, so its submitted_at is the import time. Real form
    // traffic peaked at 11 a minute across all institutes (2026-10-10); imports at 100-470.
    private static final int IMPORT_WINDOW_MINUTES = 5;
    private static final int IMPORT_MIN_ROWS = 40;

    @Autowired private vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository
            apiCallRepo;

    private final ObjectMapper mapper = new ObjectMapper();

    /** The public-API call behind this call-log row, or null for every other call. */
    /**
     * An API call's variables as the bot's lead fields. The bot fills {{institute_name}} from
     * a field named "institute name" and {{booked_slot}} from "booked slot", so the client's
     * snake_case names are mirrored under those spellings too.
     */
    static Map<String, String> apiVariablesForBot(Map<String, String> variables) {
        if (variables == null || variables.isEmpty()) return Map.of();
        Map<String, String> out = new LinkedHashMap<>(variables);
        for (Map.Entry<String, String> e : variables.entrySet()) {
            String k = e.getKey() == null ? "" : e.getKey().trim().toLowerCase(java.util.Locale.ROOT);
            if ("institute_name".equals(k)) out.putIfAbsent("institute name", e.getValue());
            if ("booked_slot".equals(k)) out.putIfAbsent("booked slot", e.getValue());
        }
        return out;
    }

    private AiCallApiCall apiCallFor(TelephonyCallLog row) {
        if (row == null || !vacademy.io.admin_core_service.features.telephony.spi.dto.CallSubjectType
                .API_CONTACT.name().equals(row.getSubjectType()) || row.getSubjectId() == null) {
            return null;
        }
        try {
            return apiCallRepo.findByIdAndInstituteId(row.getSubjectId(), row.getInstituteId()).orElse(null);
        } catch (RuntimeException e) {
            log.warn("call-context: API call lookup failed for {}: {}", row.getSubjectId(), e.getMessage());
            return null;
        }
    }

    @GetMapping("/call-context")
    public ResponseEntity<Map<String, Object>> callContext(
            @RequestParam("corr") String corr,
            @RequestParam(value = "agent", required = false) String agentId) {

        TelephonyCallLog row = callLogRepo.findById(corr)
                .orElseThrow(() -> new VacademyException("Unknown call " + corr));
        String instituteId = row.getInstituteId();

        String instituteName = instituteRepository.findById(instituteId)
                .map(i -> i.getInstituteName()).orElse("our institute");
        // A call placed through the public AI calling API: the client sent the contact's
        // name and template variables with the request. Its user id is a pseudo id that
        // exists nowhere, so the auth-service lookups below would only find nothing.
        AiCallApiCall apiCall = apiCallFor(row);
        String leadName = apiCall != null ? apiCall.getContactName()
                : row.getUserId() == null || "UNKNOWN".equals(row.getUserId())
                ? null
                : userMobileResolver.findDisplayName(row.getUserId()).orElse(null);
        // Gender for how the bot addresses the lead (honorific + Hindi second-person):
        // the stored record gender wins; else a conservative name guess (null when
        // unknown, so the bot uses gender-neutral address instead of defaulting to "sir").
        String leadGender = (apiCall != null || row.getUserId() == null || "UNKNOWN".equals(row.getUserId()))
                ? vacademy.io.admin_core_service.features.telephony.core.NameGender.of(leadName)
                : userMobileResolver.findGender(row.getUserId())
                        .orElseGet(() -> vacademy.io.admin_core_service.features.telephony.core
                                .NameGender.of(leadName));

        AiCallingSettingsPojo settings = aiCallingSettingsService.get(instituteId);

        // Registry agent first (agentId = ai_agent.id, minted by the settings
        // bridge as the VACADEMY_AI campaignId); built-in template as fallback.
        var registryAgent = agentId == null ? java.util.Optional.<vacademy.io.admin_core_service
                .features.telephony.persistence.entity.AiAgent>empty()
                : aiAgentService.find(agentId, instituteId)
                        .filter(a -> Boolean.TRUE.equals(a.getEnabled()));
        Map<String, Object> agent = registryAgent
                .map(a -> registryAgentMap(a, instituteName, settings))
                .orElseGet(() -> defaultAgent(agentId, instituteName, settings));
        if (apiCall != null) {
            // The contact belongs to the client's CRM, not ours: there is no lead to send a
            // WhatsApp/email to or to book against, so the agent must not offer either.
            agent.keySet().removeAll(List.of("sendArtefacts", "sendArtefactsMidCall", "sendOffers", "sendConditions",
                    "bookingEnabled"));
        }

        // Handoff targets: per-agent numbers win; else the institute's voicemail/
        // fallback number (already a "reach a human" concept on the telephony config).
        List<String> handoffNumbers = new ArrayList<>(registryAgent
                .map(a -> aiAgentService.parseList(a.getHandoffNumbers()))
                .orElse(List.of()));
        if (handoffNumbers.isEmpty()) {
            configCache.get(instituteId).ifPresent(resolved -> {
                String fallback = resolved.getConfig().getInboundVoicemailNumber();
                if (fallback != null && !fallback.isBlank()) handoffNumbers.add(fallback.trim());
            });
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("corr", corr);
        out.put("instituteId", instituteId);
        out.put("instituteName", instituteName);
        out.put("direction", row.getDirection());
        // INBOUND (IVR AI_AGENT node): the person on the line is the CALLER —
        // to_number is our own DID there, so prefer from_number.
        boolean inbound = vacademy.io.admin_core_service.features.telephony.enums
                .CallDirection.INBOUND.name().equalsIgnoreCase(row.getDirection());
        out.put("leadPhone", inbound
                ? (row.getFromNumber() != null ? row.getFromNumber() : row.getToNumber())
                : (row.getToNumber() != null ? row.getToNumber() : row.getFromNumber()));
        out.put("leadName", leadName);
        if (leadGender != null) out.put("leadGender", leadGender);
        // The lead's captured form/custom fields (company, role, …) so the agent can
        // reference what it already knows instead of re-asking. Empty for unknown callers.
        // For an API call, the client's variables play this part: they fill the agent's
        // {{placeholders}} and are listed to the model as what it already knows.
        Map<String, String> leadFields = apiCall != null
                ? apiVariablesForBot(apiCall.getVariables())
                : row.getResponseId() == null
                ? Map.of() : audienceService.getLeadCustomFields(row.getResponseId());
        if (leadFields != null && !leadFields.isEmpty()) out.put("leadFields", leadFields);
        // When and how the lead enquired, so the agent can answer "when did I fill a form?"
        // with the real date instead of a stock line repeated three times (call 6313b454).
        Map<String, Object> leadEnquiry = leadEnquiry(row.getResponseId());
        if (leadEnquiry != null) out.put("leadEnquiry", leadEnquiry);
        out.put("responseId", row.getResponseId());
        out.put("userId", row.getUserId());
        out.put("agent", agent);
        out.put("handoff", Map.of(
                "enabled", !handoffNumbers.isEmpty(),
                "numbers", handoffNumbers));
        // Prior attempts in the last 7 days (excluding this call) → the bot echoes it
        // as callRetry so the outcome classifier's exhaustion path works (Aavtaar
        // sends its own counter; our bot cannot know it).
        out.put("callRetry", callLogRepo.countRecentOutboundAttempts(
                instituteId,
                row.getUserId() == null ? "UNKNOWN" : row.getUserId(),
                vacademy.io.admin_core_service.features.telephony.enums.ProviderType.VACADEMY_AI,
                java.sql.Timestamp.from(java.time.Instant.now().minus(java.time.Duration.ofDays(7))),
                corr));
        // For the end-of-call report POST. MUST be the same effective secret the
        // receiver checks (AiVoiceWebhookController.authorized) — institute-level
        // else global — or every report 401s on envs with a global secret set.
        out.put("webhookToken", aiCallingConfigService.getEffectiveWebhookSecret(instituteId));
        return ResponseEntity.ok(out);
    }

    /**
     * The lead's enquiry: its source type and, when genuine, the instant it was submitted.
     * dateKnown=false when the row came in a bulk import, because its submitted_at is then
     * the import time and the agent would state a wrong date; recordedAt carries that stamp
     * (the enquiry happened on or before it). Null when there is no lead row. Never fails
     * the call context: an error only drops this block.
     */
    private Map<String, Object> leadEnquiry(String responseId) {
        if (responseId == null || responseId.isBlank()) return null;
        try {
            var resp = audienceResponseRepo.findById(responseId).orElse(null);
            if (resp == null) return null;
            java.sql.Timestamp at = resp.getSubmittedAt() != null ? resp.getSubmittedAt() : resp.getCreatedAt();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("sourceType", resp.getSourceType());
            if (at == null) {
                m.put("dateKnown", false);
                return m;
            }
            long windowMs = IMPORT_WINDOW_MINUTES * 60_000L;
            boolean imported = resp.getAudienceId() != null
                    && audienceResponseRepo.countByAudienceSubmittedBetween(resp.getAudienceId(),
                            new java.sql.Timestamp(at.getTime() - windowMs),
                            new java.sql.Timestamp(at.getTime() + windowMs)) >= IMPORT_MIN_ROWS;
            m.put("dateKnown", !imported);
            m.put(imported ? "recordedAt" : "submittedAt", at.toInstant().toString());
            return m;
        } catch (Exception e) {
            log.warn("call-context: lead enquiry lookup failed for {}: {}", responseId, e.getMessage());
            return null;
        }
    }

    /**
     * Mid-call action: the agent offered something, the caller took it, and the bot fired
     * a SEND sentinel while still talking.
     *
     * <p>Deliberately thin and deliberately forgiving. The bot calls this fire-and-forget
     * from inside a live conversation, so it must never be slow and the bot must never have
     * to care about the answer. An artefact the agent has no MID_CALL rule for returns 200
     * with created=0, not an error: a mis-generated sentinel is a no-op, never a 500 in the
     * bot log during a call.
     *
     * <p>Idempotent on (call, rule) via the ledger unique index, so a marker the model
     * repeats within one call cannot double-send.
     */
    @PostMapping("/action")
    public ResponseEntity<Map<String, Object>> action(@RequestBody Map<String, Object> body) {
        String corr = asString(body.get("corr"));
        String artefact = asString(body.get("artefact"));
        if (corr == null || corr.isBlank()) throw new VacademyException("corr is required");
        if (artefact == null || artefact.isBlank()) {
            throw new VacademyException("artefact is required");
        }
        TelephonyCallLog row = callLogRepo.findById(corr)
                .orElseThrow(() -> new VacademyException("Unknown call " + corr));

        // The bot supplies the agent id: telephony_call_log carries no agent column, and
        // the bot already holds it (the /answer URL carries it and call-context echoed it
        // back), so passing it is free and avoids a lookup that has no source of truth.
        String agentId = asString(body.get("agentId"));
        vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent agent =
                (agentId == null || agentId.isBlank()) ? null
                        : aiAgentService.find(agentId, row.getInstituteId()).orElse(null);
        if (agent == null) {
            log.info("vacademy-ai: mid-call action {} for corr={} has no registry agent — ignored",
                    artefact, corr);
            return ResponseEntity.ok(Map.of("ok", true, "created", 0));
        }

        AiCallApiCall apiCall = apiCallFor(row);
        if (apiCall != null) {
            // No sends on API calls (see callContext): a marker the model emits anyway is ignored.
            log.info("vacademy-ai: mid-call action {} for API call {} ignored", artefact, apiCall.getId());
            return ResponseEntity.ok(Map.of("ok", true, "created", 0));
        }
        String leadName = (row.getUserId() == null || "UNKNOWN".equals(row.getUserId())) ? null
                : userMobileResolver.findDisplayName(row.getUserId()).orElse(null);
        String leadPhone = (row.getUserId() == null || "UNKNOWN".equals(row.getUserId())) ? null
                : userMobileResolver.findMobile(row.getUserId()).orElse(null);
        int created = aiCallActionService.applyMidCall(agent, row.getInstituteId(), row.getId(),
                row.getUserId(), row.getResponseId(), artefact, leadName, leadPhone, null);
        log.info("vacademy-ai: mid-call action corr={} artefact={} created={}",
                corr, artefact, created);
        return ResponseEntity.ok(Map.of("ok", true, "created", created));
    }

    @PostMapping("/handoff")
    public ResponseEntity<Map<String, Object>> handoff(@RequestBody Map<String, Object> body) {
        String corr = asString(body.get("corr"));
        if (corr == null || corr.isBlank()) throw new VacademyException("corr is required");
        TelephonyCallLog row = callLogRepo.findById(corr)
                .orElseThrow(() -> new VacademyException("Unknown call " + corr));

        String number = asString(body.get("number"));
        String userId = asString(body.get("userId"));
        if ((number == null || number.isBlank()) && userId != null && !userId.isBlank()) {
            number = userMobileResolver.findMobile(userId).orElse(null);
        }
        if (number == null || number.isBlank()) {
            throw new VacademyException("No reachable handoff target");
        }

        try {
            row.setAiHandoffTarget(mapper.writeValueAsString(Map.of("number", number.trim())));
        } catch (Exception e) {
            throw new VacademyException("Could not store handoff target");
        }
        callLogRepo.save(row);
        log.info("vacademy-ai: handoff registered corr={} target={}", corr, number);
        return ResponseEntity.ok(Map.of("ok", true, "number", number.trim()));
    }

    /**
     * Persona map from a registry {@code ai_agent} row (Phase C). The agent's own
     * CONTENT (system prompt + the questions to find out) is AUTHORITATIVE — a blank
     * field means "none", NOT "inherit the built-in admissions template's values".
     * Otherwise a religious-shivir (or any non-admissions) agent that leaves
     * "Questions to find out" empty would still be told to ask "which course/class
     * are you interested in", contradicting its own prompt. Only benign STRUCTURAL
     * defaults (voice/language/dispositions vocabulary/max minutes) gap-fill.
     */
    private Map<String, Object> registryAgentMap(
            vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent a,
            String instituteName, AiCallingSettingsPojo settings) {
        Map<String, Object> base = defaultAgent(a.getId(), instituteName, settings);
        base.put("id", a.getId());
        base.put("name", a.getName());
        if (a.getLanguage() != null) base.put("language", a.getLanguage());
        if (a.getVoice() != null) base.put("voice", a.getVoice());
        if (a.getOpeningLine() != null) base.put("openingLine", a.getOpeningLine());
        // Authoritative content — never inherit the admissions template's prompt/questions.
        base.put("systemPrompt", a.getSystemPrompt() != null && !a.getSystemPrompt().isBlank()
                ? a.getSystemPrompt() : "You are a friendly, concise phone assistant.");
        base.put("extractionQuestions", aiAgentService.parseList(a.getExtractionQuestions()));
        List<String> dispositions = aiAgentService.parseList(a.getDispositions());
        if (!dispositions.isEmpty()) base.put("dispositions", dispositions);
        if (a.getMaxCallMinutes() != null && a.getMaxCallMinutes() > 0) {
            base.put("maxCallMinutes", a.getMaxCallMinutes());
        }
        // Voice tuning (V379): consumed by the bot's build_tts. Absent = the bot's
        // global TTS_PACE / Sarvam model default.
        if (a.getPace() != null) base.put("pace", a.getPace());
        // The CLOSED artefact vocabulary for this agent's send rules. The post-call
        // analyser may only fill promisedSends from sendArtefacts, and a mid-call
        // <<SEND:key>> is only honoured for a key in sendArtefactsMidCall — so a model
        // that invents an artefact sends nothing. Both are omitted when the agent has no
        // rules, which keeps the analysis prompt byte-identical for every agent alive today.
        List<String> artefacts = aiCallActionService.artefactKeys(a, null);
        if (!artefacts.isEmpty()) {
            base.put("sendArtefacts", artefacts);
            List<String> midCall = aiCallActionService.artefactKeys(a,
                    vacademy.io.admin_core_service.features.telephony.core
                            .AiCallActionService.TIMING_MID_CALL);
            if (!midCall.isEmpty()) base.put("sendArtefactsMidCall", midCall);
            // The offers themselves, so a rule is self-contained: the admin writes the
            // question once, on the rule, instead of hand-syncing it into the prompt.
            List<Map<String, String>> offers = aiCallActionService.offers(a);
            if (!offers.isEmpty()) base.put("sendOffers", offers);
            // The admin's own trigger sentences, for the post-call analyser to judge.
            List<String> conditions = aiCallActionService.conditions(a);
            if (!conditions.isEmpty()) base.put("sendConditions", conditions);
        }
        // A linked booking page means the platform books a meeting the caller agrees to
        // (AiCallOutcomeProcessor auto-book), so the agent may offer one. The bot reads this
        // only for a NON-education agent, whose prompt otherwise forbids offering any meeting
        // its script does not offer (AAIBUZZ/IRPL calls c43e9ce7, e6cb5f47, 2026-10-16: a demo
        // nobody offered, booked). Omitted when unset, so every other agent's map is unchanged.
        if (a.getBookingPageId() != null && !a.getBookingPageId().isBlank()) {
            base.put("bookingEnabled", true);
        }
        if (a.getTemperature() != null) base.put("temperature", a.getTemperature());
        // V504: consumed by the bot's ProsodyShaper (app/prosody.py). Absent = the
        // bot's global PROSODY_EXPAND, which defaults to off.
        if (a.getVoiceModulation() != null) base.put("voiceModulation", a.getVoiceModulation());
        // V421 — snake_case ON PURPOSE: the bot reads agent.get("tts_model"). The
        // neighbours here are camelCase, so this looks like a typo and is not.
        // Always emitted (never conditional on non-null) because the bot's own
        // fallback for a MISSING key is "sarvam", and an agent stamped 'rumik' whose
        // key we dropped would be served Sarvam while billed for Rumik.
        base.put("tts_model", a.getTtsModel() != null && !a.getTtsModel().isBlank()
                ? a.getTtsModel() : TtsVoiceCatalog.MODEL_SARVAM);
        // V466 — snake_case for the same reason as tts_model above: the bot reads
        // agent.get("speech_cache_mode"). Always emitted, never conditional: a
        // dropped key would fall back to the bot's default, and the ONLY safe
        // default for "may this agent replay stored audio" is OFF.
        base.put("speech_cache_mode",
                a.getSpeechCacheMode() != null && !a.getSpeechCacheMode().isBlank()
                        ? a.getSpeechCacheMode().trim().toUpperCase() : "OFF");
        return base;
    }

    /**
     * Phase B built-in persona. Dispositions are constrained to the vocabulary the
     * outcome classifier + settings already understand.
     */
    private Map<String, Object> defaultAgent(String agentId, String instituteName,
                                             AiCallingSettingsPojo settings) {
        List<String> dispositions = new ArrayList<>();
        if (settings.getAssignOnDispositions() != null) dispositions.addAll(settings.getAssignOnDispositions());
        if (settings.getStopOnDispositions() != null) dispositions.addAll(settings.getStopOnDispositions());
        if (!dispositions.contains("Callback")) dispositions.add("Callback");
        if (!dispositions.contains("Incomplete")) dispositions.add("Incomplete");

        Map<String, Object> agent = new LinkedHashMap<>();
        agent.put("id", agentId == null || agentId.isBlank() ? "default" : agentId);
        agent.put("name", "Vacademy Agent");
        agent.put("language", "hinglish");
        agent.put("voice", "priya");
        // The built-in persona stays on Sarvam. It is the fallback when an institute
        // has configured no agent at all, so there is no agent row to price against;
        // billing resolves an unresolvable agent to 'sarvam' too, and the two must
        // agree or the fallback persona would be served one engine and billed another.
        agent.put("tts_model", TtsVoiceCatalog.MODEL_SARVAM);
        // The built-in persona predates any admin decision about caching, so it
        // gets the same answer an unconfigured agent gets.
        agent.put("speech_cache_mode", "OFF");
        agent.put("openingLine",
                "Namaste! Main " + instituteName + " se baat kar rahi hoon. Kya aapke paas do minute hain?");
        agent.put("systemPrompt",
                "You are a warm, upbeat counsellor calling on behalf of " + instituteName + ". "
                + "Speak natural Hinglish (Roman script), 1-2 short sentences per reply, ONE question per turn. "
                + "Goal: understand the caller's learning needs, gauge interest, and answer basic questions. "
                + "Say numbers and dates as spoken words, never bare digits. "
                + "If the caller asks for a human or is annoyed, transfer. If the conversation is done, end politely.");
        agent.put("extractionQuestions", List.of(
                "What class/grade is the student in?",
                "Which course or exam are they interested in?",
                "Preferred time for a counsellor follow-up?"));
        agent.put("dispositions", dispositions);
        agent.put("maxCallMinutes", 6);
        return agent;
    }

    private static String asString(Object o) {
        return o == null ? null : o.toString();
    }
    // ── TTS speech-cache mirror ─────────────────────────────────────────────
    //
    // The bot PUSHES here rather than admin-core polling it, because this
    // direction is the one that is authenticated: the bot already reaches these
    // routes for call-context and reports. Admin-core has no credential for
    // reaching the bot, which is why warm-on-save has never fired.

    @Autowired(required = false)
    private vacademy.io.admin_core_service.features.super_admin.service.TtsCacheAnalyticsService ttsCache;

    /** One ledger report. Bounded, so it upserts rather than replaces. */
    @PostMapping("/tts-cache/report")
    public ResponseEntity<?> ttsCacheReport(@RequestBody java.util.Map<String, Object> body) {
        if (ttsCache == null) return ResponseEntity.ok(java.util.Map.of("ingested", 0));
        @SuppressWarnings("unchecked")
        java.util.List<java.util.Map<String, Object>> entries =
                (java.util.List<java.util.Map<String, Object>>) body.get("entries");
        int n = ttsCache.ingest(entries);
        return ResponseEntity.ok(java.util.Map.of("ingested", n));
    }

    /** Claim queued flushes. FOR UPDATE SKIP LOCKED, so two replicas polling at
     *  once cannot both run the same destructive command. */
    @PostMapping("/tts-cache/commands")
    public ResponseEntity<?> ttsCacheCommands() {
        if (ttsCache == null) return ResponseEntity.ok(java.util.Map.of("commands", java.util.List.of()));
        return ResponseEntity.ok(java.util.Map.of("commands", ttsCache.claimCommands(20)));
    }

    /** What the flush actually did. The log exists because a destructive action
     *  with no record is not one anybody should trigger from a web page. */
    @PostMapping("/tts-cache/commands/{id}/result")
    public ResponseEntity<?> ttsCacheCommandResult(@PathVariable String id,
                                                   @RequestBody java.util.Map<String, Object> body) {
        if (ttsCache != null) {
            ttsCache.recordCommandResult(id,
                    Boolean.TRUE.equals(body.get("ok")),
                    String.valueOf(body.getOrDefault("result", "")),
                    body.get("entriesRemoved") instanceof Number n ? n.intValue() : null,
                    body.get("bytesRemoved") instanceof Number b ? b.longValue() : null);
        }
        return ResponseEntity.ok(java.util.Map.of("ok", true));
    }
}
