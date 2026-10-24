package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallActionRule;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

/**
 * CRUD for the AI-agent registry + the settings bridge: every save/delete
 * mirrors the agent into {@code AI_CALLING_SETTING.campaigns} as
 * {@code {name, campaignId = agent.id, direction, provider = VACADEMY_AI}} —
 * so the CALL_AI node's name-based {@code resolveCampaignId}, the inbound
 * campaign classifier and the Aavtaar coexistence all keep working unchanged.
 *
 * <p>The bridge mutates the RAW settings map (not the server pojo): the frontend
 * stores fields the pojo doesn't model, and a pojo round-trip would silently
 * drop them.
 */
@Service
@RequiredArgsConstructor
public class AiAgentService {

    private static final Logger log = LoggerFactory.getLogger(AiAgentService.class);

    private final AiAgentRepository repo;
    private final AiAgentSpeechWarmer speechWarmer;
    private final AiCallQueueItemRepository queueRepository;
    private final AiCallingSettingsMutator settingsMutator;

    private final ObjectMapper mapper = new ObjectMapper();

    public List<AiAgentDTO> list(String instituteId) {
        return repo.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                .map(this::toDto)
                .toList();
    }

    public Optional<AiAgent> find(String agentId, String instituteId) {
        return repo.findByIdAndInstituteId(agentId, instituteId);
    }

    @Transactional
    /** Re-warm one agent's speech cache (after a super-admin switches its tier). Fire-and-forget. */
    public void warmSpeechCache(String agentId) {
        repo.findById(agentId).ifPresent(a -> {
            try {
                speechWarmer.warm(toDto(a));
            } catch (Exception e) {
                log.warn("ai agent speech warm dispatch failed agent={}: {}", agentId, e.getMessage());
            }
        });
    }

    /** What a save did besides storing the agent: calls cancelled because it was turned off. */
    public record SaveResult(AiAgentDTO agent, int cancelledCalls) {
    }

    static final String CANCEL_REASON_DISABLED = "The AI agent was turned off, so this call was not placed.";

    public AiAgentDTO save(AiAgentDTO dto) {
        return saveWithResult(dto).agent();
    }

    /**
     * Create or replace an agent. Turning an enabled agent off also cancels every call still
     * waiting for it in the AI call queue (any trigger: workflow, bulk, manual, API), with a
     * reason on each item: those calls would otherwise reach the contact with the generic
     * built-in persona. The drain job refuses them at dial time as well (same rule: the
     * agent exists and is off), for items that reach it through the institute default.
     */
    public SaveResult saveWithResult(AiAgentDTO dto) {
        return saveWithResult(dto, null);
    }

    /**
     * As {@link #saveWithResult(AiAgentDTO)}, recording {@code actorId} (e.g. "api:&lt;keyId&gt;")
     * as who changed the settings bridge; null = the signed-in user of the request.
     */
    public SaveResult saveWithResult(AiAgentDTO dto, String actorId) {
        if (dto.getInstituteId() == null || dto.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        if (dto.getName() == null || dto.getName().isBlank()) {
            throw new VacademyException("Agent name is required");
        }

        AiAgent agent = (dto.getId() != null && !dto.getId().isBlank())
                ? repo.findByIdAndInstituteId(dto.getId(), dto.getInstituteId())
                        .orElseThrow(() -> new VacademyException("Agent not found"))
                : new AiAgent();
        boolean wasEnabled = agent.getId() != null && Boolean.TRUE.equals(agent.getEnabled());
        agent.setInstituteId(dto.getInstituteId());
        agent.setName(dto.getName().trim());
        agent.setEnabled(dto.getEnabled() == null ? Boolean.TRUE : dto.getEnabled());
        agent.setDirection(normalizeDirection(dto.getDirection()));
        agent.setLanguage(blankToNull(dto.getLanguage()));
        applyEngineAndVoice(agent, dto);
        agent.setOpeningLine(blankToNull(dto.getOpeningLine()));
        agent.setSystemPrompt(blankToNull(dto.getSystemPrompt()));
        agent.setExtractionQuestions(writeJson(dto.getExtractionQuestions()));
        agent.setDispositions(writeJson(dto.getDispositions()));
        agent.setHandoffNumbers(writeJson(dto.getHandoffNumbers()));
        agent.setMaxCallMinutes(dto.getMaxCallMinutes());
        // Voice tuning — clamp to Bulbul v3's documented ranges so a typo can't send
        // an out-of-range value to the TTS (pace 0.5–2.0, temperature 0.01–2.0).
        agent.setPace(clamp(dto.getPace(), 0.5, 2.0));
        agent.setTemperature(clamp(dto.getTemperature(), 0.01, 2.0));
        // V504: the bot clamps to the same range (prosody.clamp_expand); 1.0 = off.
        agent.setVoiceModulation(clamp(dto.getVoiceModulation(), 1.0, 2.5));
        agent.setSpeechCacheMode(normalizeSpeechCacheMode(dto.getSpeechCacheMode(),
                agent.getSpeechCacheMode() != null ? agent.getSpeechCacheMode()
                        : defaultSpeechCacheMode(dto)));
        agent.setBookingPageId(blankToNull(dto.getBookingPageId()));
        // Rules are OMITTED, not empty, by an older client that predates them. Writing null
        // on omission would silently wipe an institute's whole send configuration on the next
        // save from any such client — the same trap ttsModel documents above. An explicit
        // empty list still clears them, because that is a deliberate act.
        if (dto.getSendRules() != null) {
            agent.setSendRules(writeRules(dto.getSendRules()));
        }
        AiAgent saved = repo.save(agent);

        // Stamps updated_at (no trigger, read-only in the entity) and, by clearing the
        // persistence context, makes the next read return the database's created_at /
        // updated_at instead of the nulls a just-inserted entity carries.
        try {
            repo.touchUpdatedAt(saved.getId());
        } catch (RuntimeException e) {
            log.debug("ai-agent {}: could not stamp updated_at: {}", saved.getId(), e.getMessage());
        }
        boolean enabledNow = Boolean.TRUE.equals(saved.getEnabled());
        int cancelled = wasEnabled && !enabledNow
                ? cancelWaitingCalls(saved, CANCEL_REASON_DISABLED) : 0;

        bridgeIntoSettings(saved, /* remove= */ !enabledNow, actorId);
        AiAgentDTO out = toDto(saved);
        // Pre-render this agent's fixed lines into the voice bot's speech cache so
        // they are served from cache on call #1 instead of being learned slowly.
        // Fire-and-forget by contract: a warm that fails just means the first calls
        // pay the vendor, which is exactly today's behaviour. A disabled agent places
        // no calls, so warming it only spends vendor characters.
        if (enabledNow) {
            try {
                speechWarmer.warm(out);
            } catch (Exception e) {
                log.warn("ai agent speech warm dispatch failed agent={}: {}",
                        saved.getId(), e.getMessage());
            }
        }
        return new SaveResult(out, cancelled);
    }

    /**
     * Deletes the agent. Waiting calls are NOT cancelled here: once the agent is gone, a
     * workflow / bulk / manual call that named it dials with the fallback persona exactly as
     * before v1.3 (see AiCallQueueDrainJob.agentRefusal), and a public API call naming it is
     * cancelled by the drain job at dial time, as since v1.1. Returns 0 (kept for callers).
     */
    @Transactional
    public int delete(String agentId, String instituteId) {
        return delete(agentId, instituteId, null);
    }

    @Transactional
    public int delete(String agentId, String instituteId, String actorId) {
        AiAgent agent = repo.findByIdAndInstituteId(agentId, instituteId)
                .orElseThrow(() -> new VacademyException("Agent not found"));
        repo.delete(agent);
        bridgeIntoSettings(agent, /* remove= */ true, actorId);
        return 0;
    }

    /** The wire shape of a stored agent (lists parsed, rules read), for a caller that merges into it. */
    public AiAgentDTO dtoOf(AiAgent agent) {
        return toDto(agent);
    }

    /** Cancel the QUEUED calls for this agent (by id, or by name for a name-only item). */
    public int cancelWaitingCalls(AiAgent agent, String reason) {
        try {
            int n = queueRepository.cancelQueuedForAgent(agent.getInstituteId(), agent.getId(), agent.getName(), reason);
            if (n > 0) {
                log.info("ai-agent {}: cancelled {} waiting call(s): {}", agent.getId(), n, reason);
            }
            return n;
        } catch (RuntimeException e) {
            // The drain job refuses these at dial time anyway; never fail the save for it.
            log.warn("ai-agent {}: could not cancel waiting calls: {}", agent.getId(), e.getMessage());
            return 0;
        }
    }

    /**
     * Upsert/remove the agent's campaign entry inside the raw AI_CALLING_SETTING
     * data map. Best-effort: a bridge failure must not roll back the agent save —
     * the registry row is the source of truth and the bridge can be re-run.
     * Written through {@link AiCallingSettingsMutator}: under a row lock, from a fresh
     * read, touching only {@code campaigns}, so it cannot undo a concurrent change to
     * another field (e.g. the default agent set through the public API).
     */
    private void bridgeIntoSettings(AiAgent agent, boolean remove, String actorId) {
        try {
            InstituteSettingWriter.Actor actor = actorId == null
                    ? InstituteSettingWriter.Actor.fromRequest() : InstituteSettingWriter.Actor.tenant(actorId);
            settingsMutator.update(agent.getInstituteId(), data -> {
                com.fasterxml.jackson.databind.node.ArrayNode out = mapper.createArrayNode();
                com.fasterxml.jackson.databind.JsonNode existing = data.get("campaigns");
                if (existing != null && existing.isArray()) {
                    for (com.fasterxml.jackson.databind.JsonNode c : existing) {
                        if (!c.isObject()) continue;
                        com.fasterxml.jackson.databind.JsonNode id = c.get("campaignId");
                        if (id != null && agent.getId().equals(id.asText())) continue;
                        out.add(c);
                    }
                }
                if (!remove) {
                    // "BOTH" registers as OUTBOUND for the campaigns registry (its
                    // direction field is binary); inbound detection for BOTH agents
                    // comes via the IVR path, which stamps direction itself.
                    String direction = "INBOUND".equals(agent.getDirection()) ? "INBOUND" : "OUTBOUND";
                    com.fasterxml.jackson.databind.node.ObjectNode entry = out.addObject();
                    entry.put("campaignId", agent.getId());
                    entry.put("name", agent.getName());
                    entry.put("direction", direction);
                    entry.put("provider", ProviderType.VACADEMY_AI);
                }
                data.set("campaigns", out);
            }, actor);
        } catch (Exception e) {
            log.error("ai-agent: settings bridge failed for agent {} (institute {})",
                    agent.getId(), agent.getInstituteId(), e);
        }
    }

    public List<String> parseList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            List<String> l = mapper.readValue(json, new TypeReference<>() {});
            return l == null ? List.of() : l;
        } catch (Exception e) {
            return List.of();
        }
    }

    /**
     * Resolve the TTS engine and the voice together, because they are not
     * independent — the two palettes share no names, so a voice that survives a
     * model switch either kills the audio (Sarvam rejects an unknown speaker) or,
     * on Rumik, is quietly replaced by a default voice the institute never chose
     * while the bot keeps conjugating Hindi for the one they did.
     *
     * <p>Engine rules:
     * <ul>
     *   <li><b>Create, field absent:</b> {@code rumik}. New agents get the default
     *       engine explicitly stamped, so no DB default or NULL convention has to
     *       carry a pricing decision.
     *   <li><b>Update, field absent:</b> KEEP the stored engine. An older frontend
     *       that does not know about this field must not be able to reprice an
     *       agent by omission — and every other field here is last-write-wins, so
     *       this exception is deliberate.
     *   <li><b>Unrecognised value:</b> reject loudly. Defaulting a typo would
     *       silently serve one engine while billing for another; "silk muga" in
     *       particular must not fall through to Mulberry.
     * </ul>
     */
    private void applyEngineAndVoice(AiAgent agent, AiAgentDTO dto) {
        String requested = dto.getTtsModel();
        String engine;
        if (requested == null || requested.isBlank()) {
            engine = agent.getTtsModel() != null && !agent.getTtsModel().isBlank()
                    ? TtsVoiceCatalog.normalizeModel(agent.getTtsModel())
                    : TtsVoiceCatalog.NEW_AGENT_DEFAULT;
            if (engine == null) engine = TtsVoiceCatalog.MODEL_SARVAM; // unreadable stored value
        } else {
            engine = TtsVoiceCatalog.normalizeModel(requested);
            if (engine == null) {
                throw new VacademyException("Unsupported TTS model: " + requested);
            }
        }
        agent.setTtsModel(engine);

        // Deepgram Aura-2 is ENGLISH ONLY and does NOT refuse other scripts: probed
        // 2026-08-13, a Devanagari sentence returned HTTP 200 with 37 KB of audio.
        // So a Hinglish agent pointed at it produces a confident, fluent, completely
        // wrong call — no vendor error, no fallback, nothing in the logs. Every other
        // mis-selection in this method degrades to a working call in the wrong voice;
        // this one cannot, so it refuses at save time instead of at 9 PM on a dial.
        if (TtsVoiceCatalog.MODEL_DEEPGRAM.equals(engine)) {
            String lang = agent.getLanguage() == null ? "" : agent.getLanguage().trim().toLowerCase();
            if (!lang.isEmpty() && !lang.startsWith("en") && !lang.startsWith("english")) {
                throw new VacademyException(
                        "Deepgram has no Hindi voice, so it cannot be used for a '"
                        + agent.getLanguage() + "' agent — the caller would hear Devanagari "
                        + "read as English. Choose google, sarvam or smallest for Hindi/Hinglish, "
                        + "or set this agent's language to English.");
            }
        }

        String voice = blankToNull(dto.getVoice());
        if (voice != null && !TtsVoiceCatalog.isVoiceOf(engine, voice)) {
            // Belongs to the other engine (or is a typo). Fall back to the engine's
            // default rather than storing a name that mutes every call.
            log.warn("ai-agent {}: voice '{}' is not a {} voice — using '{}'",
                    agent.getId(), voice, engine, TtsVoiceCatalog.defaultVoice(engine));
            voice = null;
        }
        // Store the CATALOG's spelling, not the caller's and not a lowercased one.
        // Google voice ids are case-sensitive at the vendor; lowercasing them here
        // made every Chirp3-HD selection unusable, and because the bot falls back
        // to Sarvam rather than dying, the only symptom was "I picked a female
        // voice and the call is still male".
        String canonicalVoice = TtsVoiceCatalog.canonicalVoice(engine, voice);
        agent.setVoice(canonicalVoice != null ? canonicalVoice
                                              : TtsVoiceCatalog.defaultVoice(engine));
    }

    /**
     * TTS speech-cache tier, validated against the closed vocabulary (V466).
     *
     * <p>OMITTED means "leave it alone", not "turn it off". An older client that
     * predates this field would otherwise silently disable the cache on any agent
     * it saved — the same trap {@code ttsModel} and {@code sendRules} both
     * document above. An unrecognised value falls back to the stored one rather
     * than to OFF for the same reason: a typo should not quietly change what a
     * caller hears, and the DB CHECK constraint would reject it anyway.
     */
    /**
     * The tier a NEW agent starts on when the client sends none. A scripted agent
     * (a real authored prompt) on Smallest starts on FULL: its script repeats
     * across calls — Shreya's last 7 days, 312 calls: 65% of the characters she
     * spoke were sentences already spoken before — and FULL is the tier that
     * learns them. Smallest is the only engine FULL's render parity has been
     * checked on (TTS_SPEECH_CACHE.md §11); everything else starts OFF as before.
     */
    static String defaultSpeechCacheMode(AiAgentDTO dto) {
        String model = dto.getTtsModel() == null ? "" : dto.getTtsModel().trim().toLowerCase();
        int promptLen = dto.getSystemPrompt() == null ? 0 : dto.getSystemPrompt().length();
        return (model.startsWith("smallest") || model.startsWith("lightning")) && promptLen >= 2000
                ? "FULL" : "OFF";
    }

    private String normalizeSpeechCacheMode(String incoming, String stored) {
        if (incoming == null || incoming.isBlank()) {
            return stored == null ? "OFF" : stored;
        }
        String v = incoming.trim().toUpperCase();
        if (v.equals("OFF") || v.equals("FIXED") || v.equals("FULL")) return v;
        log.warn("ai agent: unknown speechCacheMode {} — keeping {}", incoming, stored);
        return stored == null ? "OFF" : stored;
    }

    private AiAgentDTO toDto(AiAgent a) {
        return AiAgentDTO.builder()
                .id(a.getId())
                .instituteId(a.getInstituteId())
                .name(a.getName())
                .enabled(a.getEnabled())
                .direction(a.getDirection())
                .language(a.getLanguage())
                .voice(a.getVoice())
                .openingLine(a.getOpeningLine())
                .systemPrompt(a.getSystemPrompt())
                .extractionQuestions(parseList(a.getExtractionQuestions()))
                .dispositions(parseList(a.getDispositions()))
                .handoffNumbers(parseList(a.getHandoffNumbers()))
                .maxCallMinutes(a.getMaxCallMinutes())
                .pace(a.getPace())
                .temperature(a.getTemperature())
                .voiceModulation(a.getVoiceModulation())
                .ttsModel(a.getTtsModel())
                .speechCacheMode(a.getSpeechCacheMode() == null
                        ? "OFF" : a.getSpeechCacheMode())
                .bookingPageId(a.getBookingPageId())
                .sendRules(readRules(a.getSendRules()))
                .build();
    }

    /**
     * Serialise the rules, stamping an id on any that arrives without one.
     *
     * <p>The id is HALF THE IDEMPOTENCY KEY (callLogId:ruleId), so it must be stable across
     * edits — a UI that regenerated it on every save would make an edited rule re-fire for
     * every lead whose call was later reprocessed. Minted here rather than trusted from the
     * client so a rule can never reach the ledger without one.
     */
    /** A human label for error messages: the admin's name for the rule, else its key. */
    private static String ruleName(AiCallActionRule r) {
        if (r.getLabel() != null && !r.getLabel().isBlank()) return r.getLabel().trim();
        if (r.getArtefact() != null && !r.getArtefact().isBlank()) return r.getArtefact().trim();
        return "untitled";
    }

    /**
     * Why this rule could never run, phrased for the admin, or null when it is fine.
     *
     * <p>Deliberately mirrors AiCallActionService.isUsable plus the per-channel needs that
     * service checks at execution time. Both layers keep their checks: this one exists so a
     * person is told, that one because a rule can also be broken by an edit made elsewhere.
     */
    private static String ruleProblem(AiCallActionRule r) {
        if (r.getActionType() == null || r.getActionType().isBlank()) {
            return "choose what to do (send a message or book a meeting).";
        }
        boolean booking = "BOOK_MEETING".equalsIgnoreCase(r.getActionType());
        AiCallActionRule.When w = r.getWhen();
        boolean promised = w != null && w.getPromised() != null && !w.getPromised().isBlank();
        boolean hasPredicate = w != null && (promised
                || (w.getDisposition() != null && !w.getDisposition().isBlank())
                || (w.getDeclined() != null && !w.getDeclined().isBlank())
                || (w.getCustom() != null && !w.getCustom().isBlank())
                || Boolean.TRUE.equals(w.getMeetingRequested())
                || (w.getExtracted() != null && !w.getExtracted().isEmpty()));
        if (!hasPredicate) {
            return "give it a name, so the AI has a key to refer to it by, and choose when it runs.";
        }
        if (promised && (r.getAskLine() == null || r.getAskLine().isBlank())) {
            return "write what the agent asks on the call - this rule fires when the caller "
                    + "agrees to that question, so without one it can never run.";
        }
        if (booking) {
            if (r.getBookingPageId() == null || r.getBookingPageId().isBlank()) {
                return "choose a booking page.";
            }
            return null;
        }
        String channel = r.getChannel() == null ? "" : r.getChannel().trim().toUpperCase();
        if ("WHATSAPP".equals(channel)) {
            if (r.getTemplate() == null || r.getTemplate().isBlank()) {
                return "choose an approved WhatsApp template - proactive WhatsApp cannot be free text.";
            }
        } else if ("EMAIL".equals(channel)) {
            if (r.getMessageBody() == null || r.getMessageBody().isBlank()) {
                return "write the email message - it is sent exactly as written.";
            }
        } else {
            return "choose a channel (WhatsApp or email).";
        }
        return null;
    }

    private String writeRules(List<AiCallActionRule> rules) {
        List<AiCallActionRule> cleaned = new java.util.ArrayList<>();
        for (AiCallActionRule r : rules) {
            if (r == null) continue;
            if (r.getId() == null || r.getId().isBlank()) {
                r.setId(java.util.UUID.randomUUID().toString());
            }
            if (r.getArtefact() != null) r.setArtefact(r.getArtefact().trim());
            String problem = ruleProblem(r);
            if (problem != null) {
                // Reject rather than store. A rule the engine can never execute used to be
                // accepted here and then dropped silently by AiCallActionService.rulesOf, so
                // the admin saw a saved rule, the agent offered the thing on a live call, and
                // nothing was ever sent. Failing the save is the only point where a person is
                // still looking at the screen.
                throw new VacademyException("Action rule \"" + ruleName(r) + "\": " + problem);
            }
            cleaned.add(r);
        }
        if (cleaned.isEmpty()) return null;
        try {
            return mapper.writeValueAsString(cleaned);
        } catch (Exception e) {
            throw new VacademyException("Could not save the action rules: " + e.getMessage());
        }
    }

    /** Total: a corrupt blob reads as no rules rather than failing the whole agent list. */
    private List<AiCallActionRule> readRules(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return mapper.readValue(json,
                    new com.fasterxml.jackson.core.type.TypeReference<List<AiCallActionRule>>() {});
        } catch (Exception e) {
            log.warn("ai-agent: unreadable send_rules — returning none: {}", e.getMessage());
            return null;
        }
    }

    private String writeJson(List<String> list) {
        if (list == null) return null;
        List<String> cleaned = list.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(String::trim)
                .toList();
        if (cleaned.isEmpty()) return null;
        try {
            return mapper.writeValueAsString(cleaned);
        } catch (Exception e) {
            return null;
        }
    }

    private static String normalizeDirection(String d) {
        if (d == null) return "OUTBOUND";
        String up = d.trim().toUpperCase();
        return switch (up) {
            case "INBOUND", "BOTH" -> up;
            default -> "OUTBOUND";
        };
    }

    /** Null passes through (= "use default"); non-null is clamped into [lo, hi]. */
    private static Double clamp(Double v, double lo, double hi) {
        if (v == null) return null;
        return Math.max(lo, Math.min(hi, v));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }
}
