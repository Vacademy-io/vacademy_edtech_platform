package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentService;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsMutator;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.TtsModelPricingAnnotator;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallActionRule;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.*;

/**
 * AI agent management through the public API (Telleo API v1.3): read an agent's full
 * configuration (calls:read); create, edit, switch on / off and delete agents, list the
 * voices, and choose the institute's default agent (agents:manage).
 *
 * <p>Every write goes through {@link AiAgentService}, so the campaigns-registry bridge, the
 * speech-cache warm, the action-rule checks and the "turning an agent off cancels its
 * waiting calls" rule all apply exactly as for the dashboard. What the API adds is strict
 * input checking: where the dashboard path quietly repairs a value (an unknown voice falls
 * back to the engine default, pace is clamped), the API refuses it and says what is valid.
 *
 * <p>PATCH is a true partial update: the stored agent is loaded, only the fields present in
 * the request are replaced, and the merged agent is saved. Fields that are absent keep their
 * stored value — including the TTS engine, the speech-cache tier and the send rules, which
 * AiAgentService keeps when they are not sent.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AgentApiService {

    static final String OP_CREATE = "agent.create";
    static final int MAX_NAME = 128;
    static final int MAX_OPENING_LINE = 2000;
    static final int MAX_SYSTEM_PROMPT = 60_000;
    static final int MAX_LIST = 50;
    static final int MAX_QUESTION = 500;
    static final int MAX_DISPOSITION = 64;
    static final int MAX_HANDOFF = 10;
    static final int MIN_CALL_MINUTES = 1;
    static final int MAX_CALL_MINUTES = 30;

    /**
     * Agent languages the voice bot understands (bot.py _STT_LANGS and the codemix names), plus
     * the bare codes. A BCP-47 tag of one of these codes ("hi-IN", "ta-IN") is accepted too.
     */
    static final List<String> LANGUAGES = List.of("hinglish", "hindi", "english", "punjabi", "marathi", "gujarati",
            "bengali", "tamil", "telugu", "kannada", "malayalam", "odia");
    static final Set<String> LANGUAGE_ALIASES = Set.of("oriya", "hindi-english", "hi-en");
    static final Set<String> LANGUAGE_CODES = Set.of("hi", "en", "pa", "mr", "gu", "bn", "ta", "te", "kn", "ml", "od", "or");

    /** What each engine speaks well (guidance for GET /v1/voices; only Deepgram's is enforced). */
    static final Map<String, List<String>> ENGINE_LANGUAGES = Map.of(
            TtsVoiceCatalog.MODEL_GOOGLE, List.of("hindi", "hinglish", "english"),
            TtsVoiceCatalog.MODEL_EDGE, List.of("hindi", "hinglish", "english"),
            TtsVoiceCatalog.MODEL_SMALLEST, List.of("hindi", "hinglish", "english"),
            TtsVoiceCatalog.MODEL_SMALLEST_PRO, List.of("hindi", "hinglish", "english"),
            TtsVoiceCatalog.MODEL_DEEPGRAM, List.of("english"),
            TtsVoiceCatalog.MODEL_RUMIK, List.of("hindi", "hinglish", "english"),
            TtsVoiceCatalog.MODEL_NAVANA, List.of("hindi", "hinglish", "english", "bengali", "gujarati", "kannada",
                    "malayalam", "marathi", "odia", "tamil", "telugu"),
            TtsVoiceCatalog.MODEL_SARVAM, List.of("hindi", "hinglish", "english", "bengali", "gujarati", "kannada",
                    "malayalam", "marathi", "odia", "punjabi", "tamil", "telugu"),
            TtsVoiceCatalog.MODEL_SARVAM_V4, List.of("hindi", "hinglish", "english", "bengali", "gujarati", "kannada",
                    "malayalam", "marathi", "odia", "punjabi", "tamil", "telugu"));

    /** send_rules travel snake_case on this API; the stored rules are camelCase. */
    static final ObjectMapper RULES = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .setSerializationInclusion(JsonInclude.Include.NON_NULL)
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    private static final ObjectMapper CANONICAL = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private final AiAgentRepository agents;
    private final AiAgentService agentService;
    private final AiCallingSettingsService settingsService;
    private final AiCallingSettingsMutator settingsMutator;
    private final AiCallQueueItemRepository queue;
    private final NamedParameterJdbcTemplate jdbc;
    private final ApiIdempotencyStore idempotency;
    private final InstituteApiAuditWriter audit;
    private final TtsModelPricingAnnotator pricing;

    // ── Read ─────────────────────────────────────────────────────────────────────

    /** Fields only a key with agents:manage sees: the script, staff phone numbers, internal rules. */
    static final List<String> MANAGE_ONLY_FIELDS = List.of("system_prompt", "handoff_numbers", "send_rules",
            "booking_page_id");

    /**
     * GET /v1/agents/{id}: the whole configuration for an agents:manage key; for a calls:read
     * key (every existing key) a summary without {@link #MANAGE_ONLY_FIELDS} — the script and
     * the handoff numbers (staff mobiles) were never readable through the API before v1.3.
     */
    public Map<String, Object> getAgent(AiCallingApiAuth.Principal p, String id) {
        Map<String, Object> m = view(requireAgent(p.instituteId(), id), defaultAgentId(p.instituteId()));
        if (!p.has(vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService.SCOPE_AGENTS_MANAGE)) {
            MANAGE_ONLY_FIELDS.forEach(m::remove);
            m.put("configuration", "summary");
        }
        return m;
    }

    Map<String, Object> view(AiAgent a, String defaultAgentId) {
        AiAgentDTO d = agentService.dtoOf(a);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("object", "agent");
        m.put("name", a.getName());
        m.put("enabled", Boolean.TRUE.equals(a.getEnabled()));
        m.put("direction", lower(a.getDirection()));
        m.put("is_default", a.getId().equals(defaultAgentId));
        m.put("language", a.getLanguage());
        m.put("tts_model", a.getTtsModel());
        m.put("voice", a.getVoice());
        m.put("opening_line", a.getOpeningLine());
        m.put("system_prompt", a.getSystemPrompt());
        m.put("extraction_questions", d.getExtractionQuestions());
        m.put("dispositions", d.getDispositions());
        m.put("handoff_numbers", d.getHandoffNumbers());
        m.put("max_call_minutes", a.getMaxCallMinutes());
        m.put("pace", a.getPace());
        m.put("temperature", a.getTemperature());
        m.put("voice_modulation", a.getVoiceModulation());
        m.put("speech_cache_mode", lower(a.getSpeechCacheMode() == null ? "OFF" : a.getSpeechCacheMode()));
        m.put("booking_page_id", a.getBookingPageId());
        m.put("send_rules", rulesOut(d.getSendRules()));
        Set<String> used = AiCallingApiService.placeholders(a.getOpeningLine(), a.getSystemPrompt());
        m.put("uses_contact_name", used.contains("name") || used.contains("lead_name"));
        List<String> vars = new ArrayList<>();
        for (String u : used) if (!AiCallingApiService.BUILT_IN_PLACEHOLDERS.contains(u)) vars.add(u);
        m.put("variables", vars);
        m.put("created_at", iso(a.getCreatedAt()));
        m.put("updated_at", iso(a.getUpdatedAt()));
        m.put("configuration", "full");
        return m;
    }

    private static List<Object> rulesOut(List<AiCallActionRule> rules) {
        if (rules == null) return List.of();
        return RULES.convertValue(rules, new TypeReference<List<Object>>() {
        });
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    public ApiIdempotencyStore.Outcome createAgent(AiCallingApiAuth.Principal p, JsonNode body, String idemKey) {
        if (body == null || !body.isObject()) {
            throw AiCallingApiException.invalid("Send a JSON body with name, system_prompt and opening_line.");
        }
        Fields f = Fields.parse(body);
        Object canonical = CANONICAL.convertValue(body, Object.class);
        return idempotency.run(p.instituteId(), p.keyId(), OP_CREATE, idemKey, canonical,
                () -> doCreate(p, f),
                id -> getAgent(p, id));
    }

    ApiIdempotencyStore.Created doCreate(AiCallingApiAuth.Principal p, Fields f) {
        String instituteId = p.instituteId();
        List<Map<String, String>> errors = new ArrayList<>();
        for (String required : List.of("name", "system_prompt", "opening_line")) {
            if (!f.has(required) || f.text(required) == null) errors.add(err(required, required + " is required."));
        }
        if (!errors.isEmpty()) throw AiCallingApiException.invalid(errors.get(0).get("message"), Map.of("errors", errors));
        AiAgentDTO dto = new AiAgentDTO();
        dto.setInstituteId(instituteId);
        dto.setEnabled(Boolean.TRUE);
        dto.setDirection("OUTBOUND");
        apply(instituteId, f, dto, null);
        requireNameFree(instituteId, dto.getName(), null);
        AiAgentService.SaveResult r = save(dto, p);
        AiAgent saved = requireAgent(instituteId, r.agent().getId());
        safeAudit(p, saved.getId(), "AGENT_CREATE", "AI agent created through the API",
                Map.of("name", saved.getName()));
        return new ApiIdempotencyStore.Created(saved.getId(), view(saved, defaultAgentId(instituteId)), true);
    }

    // ── Update ───────────────────────────────────────────────────────────────────

    /** PATCH /v1/agents/{id}: only the fields in the body change. */
    public Map<String, Object> patchAgent(AiCallingApiAuth.Principal p, String id, JsonNode body) {
        return patchAgent(p, id, body, null);
    }

    /**
     * As {@link #patchAgent(AiCallingApiAuth.Principal, String, JsonNode)}, with optimistic
     * concurrency: {@code ifMatch} (the If-Match header) or the body's {@code expected_updated_at}
     * is the agent's {@code updated_at} as last read. When given and the agent changed since,
     * 409 version_conflict and nothing is saved. Optional: without it the last write wins, as
     * before.
     */
    public Map<String, Object> patchAgent(AiCallingApiAuth.Principal p, String id, JsonNode body, String ifMatch) {
        if (body == null || !body.isObject() || body.isEmpty()) {
            throw AiCallingApiException.invalid("Send a JSON body with the fields to change.");
        }
        String instituteId = p.instituteId();
        AiAgent stored = requireAgent(instituteId, id);
        java.time.Instant expected = expectedVersion(ifMatch, body);
        if (body.has("expected_updated_at")) {
            body = ((com.fasterxml.jackson.databind.node.ObjectNode) body.deepCopy()).without("expected_updated_at");
            if (body.isEmpty()) throw AiCallingApiException.invalid("Send a JSON body with the fields to change.");
        }
        Fields f = Fields.parse(body);
        AiAgentDTO dto = agentService.dtoOf(stored);
        // Absent = keep: AiAgentService keeps the stored engine, cache tier and rules on null.
        dto.setTtsModel(null);
        dto.setSpeechCacheMode(null);
        dto.setSendRules(null);
        apply(instituteId, f, dto, stored);
        if (f.has("name")) requireNameFree(instituteId, dto.getName(), stored.getId());
        if (expected != null) claimVersion(stored, expected);
        AiAgentService.SaveResult r = save(dto, p);
        AiAgent saved = requireAgent(instituteId, stored.getId());
        safeAudit(p, saved.getId(), "AGENT_UPDATE", "AI agent updated through the API",
                Map.of("fields", f.present()));
        Map<String, Object> out = view(saved, defaultAgentId(instituteId));
        if (r.cancelledCalls() > 0 || f.has("enabled")) out.put("waiting_calls_canceled", r.cancelledCalls());
        return out;
    }

    /** POST /v1/agents/{id}/enable | /disable. Disabling cancels the calls still waiting for it. */
    public Map<String, Object> setEnabled(AiCallingApiAuth.Principal p, String id, boolean enabled) {
        String instituteId = p.instituteId();
        AiAgent stored = requireAgent(instituteId, id);
        int cancelled = 0;
        if (Boolean.TRUE.equals(stored.getEnabled()) != enabled) {
            AiAgentDTO dto = agentService.dtoOf(stored);
            dto.setTtsModel(null);
            dto.setSpeechCacheMode(null);
            dto.setSendRules(null);
            dto.setEnabled(enabled);
            cancelled = save(dto, p).cancelledCalls();
            safeAudit(p, stored.getId(), enabled ? "AGENT_ENABLE" : "AGENT_DISABLE",
                    "AI agent turned " + (enabled ? "on" : "off") + " through the API", Map.of("waiting_calls_canceled", cancelled));
        } else if (!enabled) {
            // Already off: sweep anything that slipped into the queue since (idempotent).
            cancelled = agentService.cancelWaitingCalls(stored, "The AI agent was turned off, so this call was not placed.");
        }
        AiAgent now = requireAgent(instituteId, id);
        Map<String, Object> out = view(now, defaultAgentId(instituteId));
        out.put("waiting_calls_canceled", cancelled);
        List<Map<String, String>> warnings = new ArrayList<>();
        if (!enabled) {
            Usage u = usage(instituteId, now);
            if (u.isDefault()) {
                warnings.add(CounsellorApiService.warning("default_agent_disabled", "This agent is the account's default "
                        + "agent. Calls that use the default are canceled until another default is chosen "
                        + "(PUT /v1/settings/default-agent)."));
            }
            if (!u.ivrSteps().isEmpty()) {
                warnings.add(CounsellorApiService.warning("inbound_agent_disabled", "Inbound callers routed to this agent "
                        + "now hear \"our assistant is unavailable\". Move the number to another agent (PUT /v1/numbers/{id}/agent)."));
            }
        }
        out.put("warnings", warnings);
        return out;
    }

    /** The version the client last read, from If-Match (quotes and W/ ignored) or expected_updated_at. */
    static java.time.Instant expectedVersion(String ifMatch, JsonNode body) {
        String raw = null;
        if (ifMatch != null && !ifMatch.isBlank()) {
            raw = ifMatch.trim();
            if (raw.startsWith("W/")) raw = raw.substring(2);
            raw = raw.replace("\"", "").trim();
        } else if (body != null && body.hasNonNull("expected_updated_at")) {
            raw = body.get("expected_updated_at").asText().trim();
        }
        if (raw == null || raw.isEmpty()) return null;
        try {
            return java.time.Instant.parse(raw);
        } catch (java.time.format.DateTimeParseException e) {
            throw AiCallingApiException.invalid("If-Match / expected_updated_at must be the agent's updated_at, "
                    + "e.g. 2026-10-19T10:15:00.123456Z.");
        }
    }

    /**
     * Atomically checks and bumps the version: a conditional UPDATE of updated_at, so two
     * PATCHes that read the same version cannot both pass. Runs after validation, so a refused
     * request never moves the version.
     */
    private void claimVersion(AiAgent stored, java.time.Instant expected) {
        int n = agents.claimVersion(stored.getId(), Timestamp.from(expected));
        if (n != 1) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("expected_updated_at", expected.toString());
            d.put("current_updated_at", iso(stored.getUpdatedAt()));
            throw new AiCallingApiException(HttpStatus.CONFLICT, "version_conflict",
                    "The agent changed since you read it. GET it again, re-apply your change and retry.", d);
        }
    }

    // ── Delete ───────────────────────────────────────────────────────────────────

    /** DELETE /v1/agents/{id}: 409 agent_in_use with where it is used, else deleted. */
    public Map<String, Object> deleteAgent(AiCallingApiAuth.Principal p, String id) {
        String instituteId = p.instituteId();
        AiAgent agent = requireAgent(instituteId, id);
        Usage u = usage(instituteId, agent);
        if (u.inUse()) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_in_use",
                    "This agent is still in use. Point these at another agent (or remove them), then delete it.",
                    Map.of("used_by", u.describe()));
        }
        try {
            agentService.delete(agent.getId(), instituteId, actor(p));
        } catch (VacademyException e) {
            throw new AiCallingApiException(HttpStatus.NOT_FOUND, "agent_not_found", "No agent " + id + " in this account.");
        }
        safeAudit(p, agent.getId(), "AGENT_DELETE", "AI agent deleted through the API", Map.of("name", agent.getName()));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", agent.getId());
        out.put("object", "agent");
        out.put("deleted", true);
        return out;
    }

    /** Where an agent is still referenced. */
    record Usage(boolean isDefault, List<Map<String, Object>> ivrSteps, List<Map<String, Object>> workflows,
                 long waitingCalls) {

        boolean inUse() {
            return isDefault || !ivrSteps.isEmpty() || !workflows.isEmpty() || waitingCalls > 0;
        }

        List<Map<String, Object>> describe() {
            List<Map<String, Object>> out = new ArrayList<>();
            if (isDefault) out.add(Map.of("type", "default_agent"));
            for (Map<String, Object> s : ivrSteps) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("type", "ivr_step");
                m.putAll(s);
                out.add(m);
            }
            for (Map<String, Object> w : workflows) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("type", "workflow");
                m.putAll(w);
                out.add(m);
            }
            if (waitingCalls > 0) out.add(Map.of("type", "waiting_calls", "count", waitingCalls));
            return out;
        }
    }

    Usage usage(String instituteId, AiAgent agent) {
        boolean isDefault = isDefault(instituteId, agent);
        List<Map<String, Object>> ivr = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList("""
                SELECT m.id AS menu_id, m.name AS menu_name, m.enabled AS menu_enabled,
                       n.id AS step_id, n.label AS step_label
                  FROM ivr_node n JOIN ivr_menu m ON m.id = n.menu_id
                 WHERE m.institute_id = :i AND n.node_type = 'AI_AGENT' AND n.ai_agent_id = :a
                 ORDER BY m.name, n.id
                """, new MapSqlParameterSource().addValue("i", instituteId).addValue("a", agent.getId()))) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("menu_id", r.get("menu_id"));
            m.put("menu_name", r.get("menu_name"));
            m.put("menu_enabled", r.get("menu_enabled"));
            m.put("step_id", r.get("step_id"));
            m.put("step_label", r.get("step_label"));
            ivr.add(m);
        }
        List<Map<String, Object>> workflows = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList("""
                SELECT w.id AS workflow_id, w.name AS workflow_name, w.status AS workflow_status,
                       nt.id AS node_id, nt.node_name AS node_name, nt.config_json AS config_json,
                       wm.override_config AS override_config
                  FROM workflow w
                  JOIN workflow_node_mapping wm ON wm.workflow_id = w.id
                  JOIN node_template nt ON nt.id = wm.node_template_id
                 WHERE w.institute_id = :i AND w.status IN ('ACTIVE', 'DRAFT')
                   AND UPPER(nt.node_type) = 'CALL_AI' AND nt.status = 'ACTIVE'
                 ORDER BY w.name, nt.id
                """, new MapSqlParameterSource().addValue("i", instituteId))) {
            if (!referencesAgent((String) r.get("config_json"), agent)
                    && !referencesAgent((String) r.get("override_config"), agent)) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("workflow_id", r.get("workflow_id"));
            m.put("workflow_name", r.get("workflow_name"));
            m.put("workflow_status", lower((String) r.get("workflow_status")));
            m.put("node_id", r.get("node_id"));
            m.put("node_name", r.get("node_name"));
            workflows.add(m);
        }
        long waiting = queue.countWaitingForAgent(instituteId, agent.getId(), agent.getName());
        return new Usage(isDefault, ivr, workflows, waiting);
    }

    /** A CALL_AI node config names the agent by id (campaignId) or by name (campaignName). */
    static boolean referencesAgent(String configJson, AiAgent agent) {
        if (configJson == null || configJson.isBlank()) return false;
        try {
            JsonNode c = CANONICAL.readTree(configJson);
            if (c == null || !c.isObject()) return false;
            JsonNode id = c.get("campaignId");
            if (id != null && !id.isNull() && agent.getId().equals(id.asText().trim())) return true;
            JsonNode name = c.get("campaignName");
            return name != null && !name.isNull() && agent.getName().equalsIgnoreCase(name.asText().trim());
        } catch (Exception e) {
            return false;
        }
    }

    // ── Default agent ────────────────────────────────────────────────────────────

    /** GET /v1/settings/default-agent. */
    public Map<String, Object> getDefaultAgent(AiCallingApiAuth.Principal p) {
        String instituteId = p.instituteId();
        AiCallingSettingsPojo s = settingsService.get(instituteId);
        AiAgent agent = resolveDefault(instituteId, s.getDefaultCampaignId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "default_agent");
        out.put("agent_id", agent == null ? null : agent.getId());
        out.put("agent", agent == null ? null : summary(agent));
        out.put("ai_calling_provider", s.getProvider());
        return out;
    }

    /** PUT /v1/settings/default-agent: an enabled, outbound-capable agent of the account. */
    public Map<String, Object> setDefaultAgent(AiCallingApiAuth.Principal p, String agentId) {
        String instituteId = p.instituteId();
        if (agentId == null || agentId.isBlank()) {
            throw AiCallingApiException.invalid("agent_id is required. List your agents with GET /v1/agents.",
                    Map.of("errors", List.of(err("agent_id", "agent_id is required."))));
        }
        AiAgent agent = requireAgent(instituteId, agentId);
        if (!Boolean.TRUE.equals(agent.getEnabled())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_disabled",
                    "Agent " + agent.getId() + " is turned off. Turn it on first (POST /v1/agents/" + agent.getId() + "/enable).");
        }
        if ("INBOUND".equalsIgnoreCase(agent.getDirection())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_inbound_only",
                    "Agent " + agent.getId() + " only answers incoming calls, so it cannot place the account's calls.");
        }
        AiCallingSettingsPojo s = settingsService.get(instituteId);
        String provider = s.getProvider();
        if (provider != null && !provider.isBlank() && !ProviderType.VACADEMY_AI.equalsIgnoreCase(provider)) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "ai_provider_not_supported",
                    "This account's AI calling provider is " + provider + ", whose default campaign is not a Telleo agent. "
                            + "Change the provider in Settings → AI Calling first.");
        }
        String previous = s.getDefaultCampaignId();
        settingsMutator.update(instituteId, data -> data.put("defaultCampaignId", agent.getId()),
                InstituteSettingWriter.Actor.tenant(actor(p)));
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("defaultCampaignId", previous);
        try {
            audit.recordApi(instituteId, p.keyId(), "AI_CALLING_SETTING", "defaultCampaignId", "DEFAULT_AGENT_SET",
                    "Default AI agent set through the API", Map.of("agent_id", agent.getId()), before);
        } catch (RuntimeException e) {
            log.warn("agent-api: audit write failed: {}", e.getMessage());
        }
        Map<String, Object> out = getDefaultAgent(p);
        List<Map<String, String>> warnings = new ArrayList<>();
        if (provider == null || provider.isBlank()) {
            warnings.add(CounsellorApiService.warning("provider_not_set", "This account has no AI calling provider "
                    + "selected in Settings → AI Calling. API calls are unaffected; workflow and bulk calls use the "
                    + "default agent only once the provider is Vacademy AI."));
        }
        out.put("warnings", warnings);
        return out;
    }

    private AiAgent resolveDefault(String instituteId, String configured) {
        if (configured == null || configured.isBlank()) return null;
        String c = configured.trim();
        Optional<AiAgent> byId = agents.findByIdAndInstituteId(c, instituteId);
        if (byId.isPresent()) return byId.get();
        // The settings field is free text and is sometimes an agent NAME (resolveCampaignId).
        for (Object[] r : agents.findIdNameEnabledByInstituteId(instituteId)) {
            if (r != null && r[1] != null && c.equalsIgnoreCase(String.valueOf(r[1]).trim())) {
                return agents.findByIdAndInstituteId(String.valueOf(r[0]), instituteId).orElse(null);
            }
        }
        return null;
    }

    String defaultAgentId(String instituteId) {
        try {
            AiAgent a = resolveDefault(instituteId, settingsService.get(instituteId).getDefaultCampaignId());
            return a == null ? null : a.getId();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private boolean isDefault(String instituteId, AiAgent agent) {
        String d;
        try {
            d = settingsService.get(instituteId).getDefaultCampaignId();
        } catch (RuntimeException e) {
            return false;
        }
        if (d == null || d.isBlank()) return false;
        return agent.getId().equals(d.trim()) || agent.getName().equalsIgnoreCase(d.trim());
    }

    static Map<String, Object> summary(AiAgent a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("object", "agent");
        m.put("name", a.getName());
        m.put("enabled", Boolean.TRUE.equals(a.getEnabled()));
        m.put("direction", lower(a.getDirection()));
        return m;
    }

    // ── Voices ───────────────────────────────────────────────────────────────────

    /** GET /v1/voices: every engine, its voices, the languages it speaks and what a minute costs. */
    public Map<String, Object> voices() {
        List<Map<String, Object>> models = pricing.annotate(TtsVoiceCatalog.models());
        List<Map<String, Object>> data = new ArrayList<>();
        for (Map<String, Object> m : models) {
            String id = String.valueOf(m.get("id"));
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("id", id);
            e.put("object", "tts_model");
            e.put("label", m.get("label"));
            e.put("note", m.get("note"));
            e.put("default_voice", m.get("defaultVoice"));
            e.put("languages", ENGINE_LANGUAGES.getOrDefault(id, List.of()));
            if (m.get("totalCreditsPerMin") != null) {
                Map<String, Object> price = new LinkedHashMap<>();
                price.put("credits_per_minute", m.get("totalCreditsPerMin"));
                price.put("ai_credits_per_minute", m.get("aiCreditsPerMin"));
                price.put("telephony_credits_per_minute", m.get("telephonyCreditsPerMin"));
                e.put("pricing", price);
            } else {
                e.put("pricing", null);
            }
            List<Map<String, Object>> voices = new ArrayList<>();
            Object raw = m.get("voices");
            if (raw instanceof List<?> list) {
                for (Object o : list) {
                    if (!(o instanceof Map<?, ?> v)) continue;
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("id", v.get("id"));
                    out.put("gender", v.get("gender"));
                    out.put("label", v.get("label") != null ? v.get("label") : v.get("id"));
                    voices.add(out);
                }
            }
            e.put("voices", voices);
            data.add(e);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("languages", LANGUAGES);
        out.put("has_more", false);
        return out;
    }

    // ── Field handling ───────────────────────────────────────────────────────────

    /** The request body with presence: PATCH must tell "absent" from "null". */
    record Fields(JsonNode body) {

        static Fields parse(JsonNode body) {
            return new Fields(body);
        }

        private static final Map<String, String> ALIASES = Map.ofEntries(
                Map.entry("system_prompt", "systemPrompt"), Map.entry("opening_line", "openingLine"),
                Map.entry("tts_model", "ttsModel"), Map.entry("extraction_questions", "extractionQuestions"),
                Map.entry("handoff_numbers", "handoffNumbers"), Map.entry("max_call_minutes", "maxCallMinutes"),
                Map.entry("voice_modulation", "voiceModulation"), Map.entry("speech_cache_mode", "speechCacheMode"),
                Map.entry("booking_page_id", "bookingPageId"), Map.entry("send_rules", "sendRules"));

        JsonNode get(String field) {
            JsonNode v = body.get(field);
            if (v == null && ALIASES.containsKey(field)) v = body.get(ALIASES.get(field));
            return v;
        }

        boolean has(String field) {
            return body.has(field) || (ALIASES.containsKey(field) && body.has(ALIASES.get(field)));
        }

        String text(String field) {
            JsonNode v = get(field);
            if (v == null || v.isNull()) return null;
            if (!v.isTextual()) throw AiCallingApiException.invalid(field + " must be a string.",
                    Map.of("errors", List.of(err(field, field + " must be a string."))));
            String s = v.asText().trim();
            return s.isEmpty() ? null : s;
        }

        List<String> present() {
            List<String> out = new ArrayList<>();
            body.fieldNames().forEachRemaining(out::add);
            return out;
        }
    }

    /**
     * Copies the fields present in {@code f} onto {@code dto}, validating each. {@code stored}
     * is the current agent on PATCH (null on create): the engine and voice are checked
     * against what the agent will have after the change.
     */
    void apply(String instituteId, Fields f, AiAgentDTO dto, AiAgent stored) {
        List<Map<String, String>> errors = new ArrayList<>();
        if (f.has("name")) {
            String name = f.text("name");
            if (name == null) errors.add(err("name", "name cannot be empty."));
            else if (name.length() > MAX_NAME) errors.add(err("name", "name is at most " + MAX_NAME + " characters."));
            else dto.setName(name);
        }
        if (f.has("enabled")) {
            JsonNode v = f.get("enabled");
            if (v == null || !v.isBoolean()) errors.add(err("enabled", "enabled must be true or false."));
            else dto.setEnabled(v.asBoolean());
        }
        if (f.has("direction")) {
            String d = f.text("direction");
            String up = d == null ? "" : d.toUpperCase(Locale.ROOT);
            if (!Set.of("OUTBOUND", "INBOUND", "BOTH").contains(up)) {
                errors.add(err("direction", "direction must be outbound, inbound or both."));
            } else {
                dto.setDirection(up);
            }
        }
        if (f.has("opening_line")) {
            String s = f.text("opening_line");
            if (s == null) errors.add(err("opening_line", "opening_line cannot be empty."));
            else if (s.length() > MAX_OPENING_LINE) errors.add(err("opening_line", "opening_line is at most " + MAX_OPENING_LINE + " characters."));
            else dto.setOpeningLine(s);
        }
        if (f.has("system_prompt")) {
            String s = f.text("system_prompt");
            if (s == null) errors.add(err("system_prompt", "system_prompt cannot be empty."));
            else if (s.length() > MAX_SYSTEM_PROMPT) errors.add(err("system_prompt", "system_prompt is at most " + MAX_SYSTEM_PROMPT + " characters."));
            else dto.setSystemPrompt(s);
        }
        if (f.has("extraction_questions")) {
            dto.setExtractionQuestions(stringList(f, "extraction_questions", MAX_LIST, MAX_QUESTION, errors));
        }
        if (f.has("dispositions")) {
            dto.setDispositions(stringList(f, "dispositions", MAX_LIST, MAX_DISPOSITION, errors));
        }
        if (f.has("handoff_numbers")) {
            List<String> raw = stringList(f, "handoff_numbers", MAX_HANDOFF, 32, errors);
            List<String> numbers = new ArrayList<>();
            if (raw != null) {
                for (String n : raw) {
                    String e164 = AiCallingApiService.normalisePhone(n);
                    if (e164 == null) errors.add(err("handoff_numbers", "Every handoff number must be E.164, e.g. +919876543210."));
                    else numbers.add(e164);
                }
            }
            dto.setHandoffNumbers(numbers);
        }
        if (f.has("max_call_minutes")) {
            JsonNode v = f.get("max_call_minutes");
            if (v == null || v.isNull()) dto.setMaxCallMinutes(null);
            else if (!v.isIntegralNumber() || v.asInt() < MIN_CALL_MINUTES || v.asInt() > MAX_CALL_MINUTES) {
                errors.add(err("max_call_minutes", "max_call_minutes is a whole number from " + MIN_CALL_MINUTES + " to "
                        + MAX_CALL_MINUTES + ", or null for the default (10)."));
            } else {
                dto.setMaxCallMinutes(v.asInt());
            }
        }
        if (f.has("pace")) dto.setPace(range(f, "pace", 0.5, 2.0, errors));
        if (f.has("temperature")) dto.setTemperature(range(f, "temperature", 0.01, 2.0, errors));
        if (f.has("voice_modulation")) dto.setVoiceModulation(range(f, "voice_modulation", 1.0, 2.5, errors));
        if (f.has("speech_cache_mode")) {
            String want = f.text("speech_cache_mode");
            String current = stored == null || stored.getSpeechCacheMode() == null ? "OFF" : stored.getSpeechCacheMode();
            if (stored == null || want == null || !current.equalsIgnoreCase(want)) {
                errors.add(err("speech_cache_mode", "speech_cache_mode is read-only: support sets it per agent."));
            }
        }
        if (!errors.isEmpty()) throw AiCallingApiException.invalid(errors.get(0).get("message"), Map.of("errors", errors));

        if (f.has("language")) {
            String lang = f.text("language");
            dto.setLanguage(lang == null ? null : normaliseLanguage(lang));
        }
        if (f.has("booking_page_id")) {
            String page = f.text("booking_page_id");
            if (page != null) requireBookingPage(instituteId, page, "booking_page_id");
            dto.setBookingPageId(page);
        }
        if (f.has("send_rules")) {
            dto.setSendRules(rulesIn(instituteId, f.get("send_rules")));
        }
        applyEngineAndVoice(f, dto, stored);
    }

    /**
     * The engine and voice the agent will have, checked together: an unknown engine or a voice
     * not in that engine's palette is 422 with the valid options (the dashboard path would
     * silently switch to the engine's default voice). Deepgram speaks English only.
     */
    void applyEngineAndVoice(Fields f, AiAgentDTO dto, AiAgent stored) {
        boolean engineSent = f.has("tts_model");
        boolean voiceSent = f.has("voice");
        String engine;
        if (engineSent) {
            String raw = f.text("tts_model");
            engine = raw == null ? null : TtsVoiceCatalog.normalizeModel(raw);
            if (engine == null) {
                throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "unsupported_tts_model",
                        "tts_model must be one of the engines listed by GET /v1/voices.",
                        Map.of("valid_tts_models", engineIds()));
            }
            dto.setTtsModel(engine);
        } else if (stored != null && stored.getTtsModel() != null && TtsVoiceCatalog.normalizeModel(stored.getTtsModel()) != null) {
            engine = TtsVoiceCatalog.normalizeModel(stored.getTtsModel());
        } else if (stored != null) {
            engine = TtsVoiceCatalog.MODEL_SARVAM; // unreadable stored engine: AiAgentService treats it as Sarvam
        } else {
            engine = TtsVoiceCatalog.NEW_AGENT_DEFAULT;
            dto.setTtsModel(engine);
        }
        if (engineSent || voiceSent || stored == null) {
            String voice = voiceSent ? f.text("voice") : (stored == null ? null : stored.getVoice());
            if (voice == null && stored == null) {
                voice = TtsVoiceCatalog.defaultVoice(engine);
            }
            if (voice == null || !TtsVoiceCatalog.isVoiceOf(engine, voice)) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("tts_model", engine);
                d.put("valid_voices", TtsVoiceCatalog.forModel(engine).stream().map(v -> v.get("id")).toList());
                throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_voice",
                        voice == null ? "voice is required for the " + engine + " engine."
                                : "Voice " + voice + " is not a " + engine + " voice. Pick one of valid_voices (GET /v1/voices).",
                        d);
            }
            dto.setVoice(TtsVoiceCatalog.canonicalVoice(engine, voice));
        }
        if (TtsVoiceCatalog.MODEL_DEEPGRAM.equals(engine)) {
            String lang = dto.getLanguage() == null ? "" : dto.getLanguage().toLowerCase(Locale.ROOT);
            if (!lang.isEmpty() && !lang.startsWith("en")) {
                throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "voice_language_mismatch",
                        "The deepgram engine speaks English only, and this agent's language is " + dto.getLanguage()
                                + ". Pick another engine, or set language to english.",
                        Map.of("tts_model", engine, "language", dto.getLanguage()));
            }
        }
    }

    static String normaliseLanguage(String raw) {
        String l = raw.trim().toLowerCase(Locale.ROOT);
        if (LANGUAGES.contains(l) || LANGUAGE_ALIASES.contains(l) || LANGUAGE_CODES.contains(l)) return l;
        String[] parts = l.split("-");
        if (parts.length == 2 && LANGUAGE_CODES.contains(parts[0]) && parts[1].matches("[a-z]{2}")) {
            return parts[0] + "-" + parts[1].toUpperCase(Locale.ROOT);
        }
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("valid_languages", LANGUAGES);
        throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "unsupported_language",
                "language " + raw + " is not supported. Use one of valid_languages (or a tag such as hi-IN).", d);
    }

    private List<AiCallActionRule> rulesIn(String instituteId, JsonNode raw) {
        if (raw == null || raw.isNull()) return List.of();
        if (!raw.isArray()) {
            throw AiCallingApiException.invalid("send_rules must be an array of rule objects.",
                    Map.of("errors", List.of(err("send_rules", "send_rules must be an array."))));
        }
        List<AiCallActionRule> rules;
        try {
            rules = RULES.convertValue(raw, new TypeReference<List<AiCallActionRule>>() {
            });
        } catch (IllegalArgumentException e) {
            throw AiCallingApiException.invalid("send_rules is not a valid list of rules (check the field names and types).",
                    Map.of("errors", List.of(err("send_rules", "Not a valid list of rules."))));
        }
        for (AiCallActionRule r : rules) {
            if (r != null && r.getBookingPageId() != null && !r.getBookingPageId().isBlank()) {
                requireBookingPage(instituteId, r.getBookingPageId().trim(), "send_rules.booking_page_id");
            }
        }
        return rules;
    }

    private void requireBookingPage(String instituteId, String pageId, String field) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM booking_page WHERE id = :id AND institute_id = :i",
                new MapSqlParameterSource().addValue("id", pageId).addValue("i", instituteId), Long.class);
        if (n == null || n == 0) {
            throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "booking_page_not_found",
                    "No booking page " + pageId + " in this account (" + field + ").", Map.of("field", field));
        }
    }

    private static List<String> stringList(Fields f, String field, int maxItems, int maxLen,
                                           List<Map<String, String>> errors) {
        JsonNode v = f.get(field);
        if (v == null || v.isNull()) return List.of();
        if (!v.isArray()) {
            errors.add(err(field, field + " must be an array of strings."));
            return null;
        }
        if (v.size() > maxItems) {
            errors.add(err(field, field + " has at most " + maxItems + " items."));
            return null;
        }
        List<String> out = new ArrayList<>();
        for (JsonNode e : v) {
            if (!e.isTextual()) {
                errors.add(err(field, field + " must be an array of strings."));
                return null;
            }
            String s = e.asText().trim();
            if (s.isEmpty()) continue;
            if (s.length() > maxLen) {
                errors.add(err(field, "Each item of " + field + " is at most " + maxLen + " characters."));
                return null;
            }
            out.add(s);
        }
        return out;
    }

    private static Double range(Fields f, String field, double lo, double hi, List<Map<String, String>> errors) {
        JsonNode v = f.get(field);
        if (v == null || v.isNull()) return null;
        if (!v.isNumber() || v.asDouble() < lo || v.asDouble() > hi) {
            errors.add(err(field, field + " is a number from " + lo + " to " + hi + ", or null for the default."));
            return null;
        }
        return v.asDouble();
    }

    private void requireNameFree(String instituteId, String name, String selfId) {
        if (name == null) return;
        for (Object[] r : agents.findIdNameEnabledByInstituteId(instituteId)) {
            if (r == null || r[1] == null) continue;
            if (selfId != null && selfId.equals(String.valueOf(r[0]))) continue;
            if (name.equalsIgnoreCase(String.valueOf(r[1]).trim())) {
                throw nameTaken(name);
            }
        }
    }

    private static AiCallingApiException nameTaken(String name) {
        return new AiCallingApiException(HttpStatus.CONFLICT, "agent_name_taken",
                "An agent named " + name + " already exists in this account (names are unique, ignoring case).");
    }

    private AiAgentService.SaveResult save(AiAgentDTO dto, AiCallingApiAuth.Principal p) {
        try {
            return agentService.saveWithResult(dto, actor(p));
        } catch (DataIntegrityViolationException e) {
            throw nameTaken(dto.getName());
        } catch (VacademyException e) {
            throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_agent",
                    e.getMessage() == null ? "The agent could not be saved." : e.getMessage());
        }
    }

    AiAgent requireAgent(String instituteId, String id) {
        if (id == null || id.isBlank()) throw AiCallingApiException.invalid("An agent id is required.");
        return agents.findByIdAndInstituteId(id.trim(), instituteId)
                .orElseThrow(() -> new AiCallingApiException(HttpStatus.NOT_FOUND, "agent_not_found",
                        "No agent " + id + " in this account. List your agents with GET /v1/agents."));
    }

    private void safeAudit(AiCallingApiAuth.Principal p, String agentId, String action, String description,
                           Map<String, Object> payload) {
        try {
            audit.recordApi(p.instituteId(), p.keyId(), "AI_AGENT", agentId, action, description, payload, null);
        } catch (RuntimeException e) {
            log.warn("agent-api: audit write failed for {}: {}", agentId, e.getMessage());
        }
    }

    static String actor(AiCallingApiAuth.Principal p) {
        return "api:" + p.keyId();
    }

    private static List<String> engineIds() {
        return TtsVoiceCatalog.models().stream().map(m -> String.valueOf(m.get("id"))).toList();
    }

    static String lower(String s) {
        return s == null ? null : s.toLowerCase(Locale.ROOT);
    }

    static String iso(Timestamp ts) {
        return ts == null ? null : ts.toInstant().toString();
    }

    private static Map<String, String> err(String field, String message) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("message", message);
        return m;
    }
}
