package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.dto.CreateEngineRequest;
import vacademy.io.admin_core_service.features.engagement.dto.PromptEditRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Engine lifecycle: create (brief → prompt v1) → enroll audience (jittered, idempotent)
 * → activate. Prompt edits append deltas — base_text is immutable (design §8).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementEngineService {

    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementPromptVersionRepository promptRepository;
    private final EngagementTemplateProposalRepository templateProposalRepository;
    private final EngagementReadDao dao;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional
    public EngagementEngine create(CreateEngineRequest req, String instituteId, String createdBy) {
        if (req.getName() == null || req.getName().isBlank()) {
            throw new VacademyException("Engine name is required");
        }
        if (req.getBrief() == null || req.getBrief().isBlank()) {
            throw new VacademyException("The engine brief (prompt) is required");
        }

        EngagementEngine engine = new EngagementEngine();
        engine.setInstituteId(instituteId);
        engine.setName(req.getName());
        engine.setObjective(req.getObjective());
        engine.setStatus("DRAFT");
        engine.setLanguage(validLanguage(req.getLanguage()));
        engine.setDataPoints(writeJson(req.getDataPoints() != null ? req.getDataPoints() : List.of()));
        // Validate the raw JSON strings up front so a malformed payload fails with a clear message
        // here, not as an opaque jsonb INSERT error (or a silently-broken audience at sweep time).
        engine.setChannels(validObjectJson(req.getChannels(), "channels", "{}"));
        engine.setAudience(validAudienceJson(req.getAudience()));
        engine.setQuietHours(validObjectJson(req.getQuietHours(), "quietHours", "{}"));
        if (req.getCadenceHours() != null && req.getCadenceHours() > 0) {
            engine.setCadenceHours(req.getCadenceHours());
        }
        if (req.getHoldoutPct() != null) {
            engine.setHoldoutPct(Math.max(0, Math.min(100, req.getHoldoutPct())));
        }
        if (req.getFirstN() != null && req.getFirstN() >= 0) {
            engine.setFirstN(req.getFirstN());
        }
        engine.setCreatedBy(createdBy);
        engine = engineRepository.save(engine);

        EngagementPromptVersion v1 = new EngagementPromptVersion();
        v1.setEngineId(engine.getId());
        v1.setInstituteId(instituteId);
        v1.setVersion(1);
        v1.setBaseText(req.getBrief());
        v1.setCompiledText(req.getBrief());
        v1.setSource("ADMIN");
        v1.setStatus("ACTIVE");
        v1.setCreatedBy(createdBy);
        promptRepository.save(v1);

        return engine;
    }

    /**
     * The prompt that grows: append the delta, deterministically recompile
     * (base + all deltas in order), supersede the old version. Never re-summarize.
     */
    @Transactional
    public EngagementPromptVersion editPrompt(String engineId, String instituteId,
                                              PromptEditRequest req, String editedBy) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        requireAdminManaged(engine);
        if (req.getDeltaText() == null || req.getDeltaText().isBlank()) {
            throw new VacademyException("deltaText is required");
        }

        List<EngagementPromptVersion> history = promptRepository.findByEngineIdOrderByVersionDesc(engine.getId());
        if (history.isEmpty()) throw new VacademyException("Engine has no prompt to edit");
        EngagementPromptVersion latest = history.get(0);

        // Deterministic recompile: immutable base + every prior delta + the new one.
        StringBuilder compiled = new StringBuilder(findBase(history));
        List<String> deltas = new ArrayList<>();
        for (int i = history.size() - 1; i >= 0; i--) {           // oldest → newest
            String d = history.get(i).getDeltaText();
            if (d != null && !d.isBlank()) deltas.add(d);
        }
        deltas.add(req.getDeltaText());
        int i = 1;
        for (String d : deltas) {
            compiled.append("\n\nAMENDMENT ").append(i++).append(" (later amendments override earlier ones):\n").append(d);
        }

        EngagementPromptVersion next = new EngagementPromptVersion();
        next.setEngineId(engine.getId());
        next.setInstituteId(instituteId);
        next.setVersion(latest.getVersion() + 1);
        next.setBaseText(findBase(history));
        next.setDeltaText(req.getDeltaText());
        next.setCompiledText(compiled.toString());
        next.setSource("ADMIN");
        next.setStatus("ACTIVE");
        next.setCreatedBy(editedBy);

        latest.setStatus("SUPERSEDED");
        promptRepository.save(latest);
        return promptRepository.save(next);
        // Deliberately NO member re-wake here: the new prompt applies at each member's next
        // natural wake. Re-deciding everyone on every edit is the cost-control-disarms-itself trap.
    }

    /**
     * Resolve the audience selectors and enroll (idempotent via ux_em_subject; jittered so
     * activation is a flat line, not a thundering herd). Also EXITs members who left the
     * audience. Selectors supported in 1a: PACKAGE_SESSION, AUDIENCE, USER — the three the
     * founder named (batch, campaign/audience list, specific users).
     */
    @Transactional
    public EnrollmentResult enrollAndReconcile(String engineId, String instituteId) {
        EngagementEngine engine = requireEngine(engineId, instituteId);

        record Target(String userId, String audienceResponseId) {}
        List<Target> raw = new ArrayList<>();
        java.util.Set<String> userSelectorIds = new java.util.LinkedHashSet<>();
        try {
            JsonNode selectors = objectMapper.readTree(engine.getAudience());
            for (JsonNode sel : selectors) {
                String type = sel.path("type").asText("");
                String id = sel.path("id").asText("");
                switch (type) {
                    case "PACKAGE_SESSION" -> dao.userIdsByPackageSession(id, instituteId)
                            .forEach(uid -> raw.add(new Target(uid, null)));
                    case "AUDIENCE" -> dao.leadsByAudience(id, instituteId)
                            .forEach(row -> raw.add(new Target((String) row[1], (String) row[0])));
                    case "USER" -> userSelectorIds.add(id);   // validated below against the institute
                    default -> log.warn("Engine {}: unsupported audience selector type '{}' — skipped (ROLE/TAG/CUSTOM_FIELD_FILTER arrive in a later phase)",
                            engineId, type);
                }
            }
        } catch (Exception e) {
            throw new VacademyException("Unparseable audience selectors: " + e.getMessage());
        }

        // USER selectors must belong to THIS institute (else an admin could name another
        // institute's user id and exfiltrate their PII through the engine's data-point reads).
        if (!userSelectorIds.isEmpty()) {
            java.util.Set<String> valid = dao.validInstituteUserIds(userSelectorIds, instituteId);
            userSelectorIds.stream().filter(valid::contains).forEach(uid -> raw.add(new Target(uid, null)));
            userSelectorIds.stream().filter(uid -> !valid.contains(uid))
                    .forEach(uid -> log.warn("Engine {}: USER selector {} is not a member of institute {} — dropped",
                            engineId, uid, instituteId));
        }

        // Dedup: the same person can arrive via PACKAGE_SESSION as (userId,null) AND via AUDIENCE
        // as (userId, respId) — distinct ux_em_subject keys → double enrollment → double messages.
        // Collapse by userId (stable across reconciles), but PRESERVE the audience_response_id when
        // any occurrence carries one: a converted lead in an AUDIENCE keeps its respId, so the CRM
        // data points (lead status/tier/counsellor, form answers) can still hydrate. Dropping it
        // would blind exactly the lead-nurture use case an AUDIENCE engine exists for.
        java.util.Map<String, Target> canonical = new java.util.LinkedHashMap<>();
        for (Target t : raw) {
            String key = t.userId() != null ? "u:" + t.userId() : "l:" + t.audienceResponseId();
            Target existing = canonical.get(key);
            if (existing == null) {
                canonical.put(key, t);
            } else if (existing.audienceResponseId() == null && t.audienceResponseId() != null) {
                // richer occurrence (has a lead row) wins — keep both ids
                canonical.put(key, new Target(existing.userId() != null ? existing.userId() : t.userId(),
                        t.audienceResponseId()));
            }
        }

        // enrollOrStamp reports rows-affected=1 for both insert and update, so count real inserts
        // by the change in ACTIVE membership across the run (accurate; avoids a fragile RETURNING).
        long activeBefore = memberRepository.countByEngineIdAndStatus(engine.getId(), "ACTIVE");

        String runId = UUID.randomUUID().toString();
        Instant runStartedAt = Instant.now();
        int holdoutPct = engine.getHoldoutPct() != null ? Math.max(0, Math.min(100, engine.getHoldoutPct())) : 0;
        for (Target t : canonical.values()) {
            memberRepository.enrollOrStamp(
                    UUID.randomUUID().toString(), engine.getId(), instituteId,
                    t.userId(), t.audienceResponseId(),
                    EngagementDecisionService.jitteredFirstWake(engine.getCadenceHours(), Instant.now()),
                    runId, holdoutPct);
        }
        // Exit anyone not stamped by this run — unconditional, so an emptied audience exits all.
        int exited = memberRepository.exitNotStampedBy(engine.getId(), runId, runStartedAt);

        long activeAfter = memberRepository.countByEngineIdAndStatus(engine.getId(), "ACTIVE");
        int netNew = (int) Math.max(0, (activeAfter + exited) - activeBefore); // inserts + resurrections

        log.info("Engine {}: audience {} (deduped from {}), ~{} newly active, {} exited",
                engineId, canonical.size(), raw.size(), netNew, exited);
        return new EnrollmentResult(canonical.size(), netNew, exited);
    }

    public record EnrollmentResult(int audienceSize, int newlyEnrolled, int exited) {}

    /** First look for a lead enrolled at intake: a few minutes out, not jittered across the cadence. */
    static final int INTAKE_FIRST_LOOK_MAX_MINUTES = 15;

    /**
     * Enrols a lead that just landed in a list into every ACTIVE or DRY_RUN engine targeting that
     * list, first look within minutes. Without this a new lead waits for the 02:30 UTC reconcile
     * and then a first look jittered across the whole cadence: 1 to 4 days for a 72 h engine.
     * Same key as the reconcile, (user_id, audience_response_id), so the nightly run stamps the
     * row instead of adding a second one. Returns how many engines it joined.
     */
    @Transactional
    public int enrollNewLead(String instituteId, String audienceId, String responseId, String userId) {
        int joined = 0;
        for (EngagementEngine engine : engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId)) {
            if (!"ACTIVE".equals(engine.getStatus()) && !"DRY_RUN".equals(engine.getStatus())) continue;
            if (engine.isSystemManaged() || !targetsAudience(engine, audienceId)) continue;
            int holdoutPct = engine.getHoldoutPct() != null ? Math.max(0, Math.min(100, engine.getHoldoutPct())) : 0;
            Instant firstLook = Instant.now().plus(java.time.Duration.ofMinutes(
                    java.util.concurrent.ThreadLocalRandom.current().nextLong(1, INTAKE_FIRST_LOOK_MAX_MINUTES + 1)));
            memberRepository.enrollOrStamp(UUID.randomUUID().toString(), engine.getId(), instituteId,
                    userId, responseId, firstLook, "intake:" + UUID.randomUUID(), holdoutPct);
            joined++;
        }
        return joined;
    }

    /** True when the engine's audience has an AUDIENCE selector for this list. */
    boolean targetsAudience(EngagementEngine engine, String audienceId) {
        try {
            for (JsonNode sel : objectMapper.readTree(engine.getAudience())) {
                if ("AUDIENCE".equals(sel.path("type").asText()) && audienceId.equals(sel.path("id").asText())) {
                    return true;
                }
            }
        } catch (Exception e) {
            log.warn("Engine {}: unreadable audience — not enrolling intake leads", engine.getId());
        }
        return false;
    }

    @Transactional
    public EngagementEngine transition(String engineId, String instituteId, String toStatus) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        if (engine.isSystemManaged()) {
            // It must stay ACTIVE: the dispatch job only sends for ACTIVE engines. Setting it back
            // to ACTIVE is the one change allowed, without the audience and template gates — its
            // members are PAUSED by design and it sends only templates an admin put on a rule.
            if (!"ACTIVE".equals(toStatus)) requireAdminManaged(engine);
            engine.setStatus("ACTIVE");
            return engineRepository.save(engine);
        }
        List<String> allowed = List.of("DRAFT", "TEMPLATES_PENDING", "DRY_RUN", "ACTIVE", "PAUSED", "ARCHIVED");
        if (!allowed.contains(toStatus)) throw new VacademyException("Unknown status: " + toStatus);
        boolean goingLive = "ACTIVE".equals(toStatus) || "DRY_RUN".equals(toStatus);
        if (goingLive && memberRepository.countByEngineIdAndStatus(engineId, "ACTIVE") == 0) {
            throw new VacademyException("Enroll an audience before activating the engine");
        }
        // D8 activation gate: a WhatsApp engine cannot go live until at least one template is
        // Meta-approved (proactive WhatsApp is template-only). This gate fires only on the
        // transition INTO live — an already-ACTIVE engine is never re-paused for a new template.
        if (goingLive && whatsAppEnabled(engine)
                && templateProposalRepository.countByEngineIdAndStatusIn(
                        engineId, List.of("META_APPROVED", "META_RECATEGORISED")) == 0) {
            throw new VacademyException("This engine sends on WhatsApp — it needs at least one "
                    + "Meta-approved template before it can go live. Check template status.");
        }
        engine.setStatus(toStatus);
        if (goingLive && engine.getNextDueAt() == null) {
            engine.setNextDueAt(Instant.now());
        }
        return engineRepository.save(engine);
    }

    private boolean whatsAppEnabled(EngagementEngine engine) {
        try {
            return objectMapper.readTree(engine.getChannels()).path("WHATSAPP").path("enabled").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * The Phase 2 kill switch: stop (or resume) AUTONOMOUS sending without pausing the engine. When
     * killed, the engine keeps deciding and drafting, but every proactive decision drops to a human
     * copilot task instead of auto-sending — an emergency brake distinct from PAUSED.
     */
    @Transactional
    public EngagementEngine setAutonomyKilled(String engineId, String instituteId, boolean killed) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        requireAdminManaged(engine);
        engine.setAutoSendKilled(killed);
        return engineRepository.save(engine);
    }

    /** Refuses an admin change to an engine the platform runs (see EngagementEngine#isSystemManaged). */
    public void requireAdminManaged(EngagementEngine engine) {
        if (engine.isSystemManaged()) {
            throw new VacademyException("\"" + engine.getName() + "\" is run by AI calling and can't be "
                    + "changed here. To stop what an AI agent sends after its calls, turn the rule off on that agent.");
        }
    }

    public EngagementEngine requireEngine(String engineId, String instituteId) {
        EngagementEngine engine = engineRepository.findById(engineId)
                .orElseThrow(() -> new VacademyException("Engine not found"));
        if (!engine.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Engine does not belong to this institute");
        }
        return engine;
    }

    private static String findBase(List<EngagementPromptVersion> historyDesc) {
        return historyDesc.get(historyDesc.size() - 1).getBaseText(); // version 1 holds the immutable base
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new VacademyException("Invalid JSON payload: " + e.getMessage());
        }
    }

    private static String validLanguage(String lang) {
        String l = lang != null ? lang : "en";
        if (!List.of("en", "hi", "hinglish").contains(l)) {
            throw new VacademyException("language must be one of en|hi|hinglish");
        }
        return l;
    }

    private String validObjectJson(String raw, String field, String fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            JsonNode n = objectMapper.readTree(raw);
            if (!n.isObject()) throw new VacademyException(field + " must be a JSON object");
            return raw;
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            throw new VacademyException(field + " is not valid JSON: " + e.getMessage());
        }
    }

    private String validAudienceJson(String raw) {
        if (raw == null || raw.isBlank()) return "[]";
        try {
            JsonNode arr = objectMapper.readTree(raw);
            if (!arr.isArray()) throw new VacademyException("audience must be a JSON array of selectors");
            for (JsonNode sel : arr) {
                String type = sel.path("type").asText("");
                if (!List.of("PACKAGE_SESSION", "AUDIENCE", "USER").contains(type)) {
                    throw new VacademyException("audience selector type must be PACKAGE_SESSION|AUDIENCE|USER, got '" + type + "'");
                }
                if (sel.path("id").asText("").isBlank()) {
                    throw new VacademyException("each audience selector needs an id");
                }
            }
            return raw;
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            throw new VacademyException("audience is not valid JSON: " + e.getMessage());
        }
    }
}
