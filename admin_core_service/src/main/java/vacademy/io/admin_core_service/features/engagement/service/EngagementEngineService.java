package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
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

    /** Field-injected so the constructor (used directly by tests) stays as it was. */
    @Autowired(required = false)
    private EngagementEngineDeletionDao deletionDao;

    /** Field-injected for the same reason; absent in unit tests, where no channel is checked. */
    @Autowired(required = false)
    private EngagementChannelReadiness channelReadiness;

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
        engine.setQuietHours(validQuietHoursJson(req.getQuietHours()));
        if (channelReadiness != null) channelReadiness.requireReady(instituteId, engine.getChannels(), null);
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

        record Target(String userId, String audienceResponseId, String phone10) {}
        List<Target> raw = new ArrayList<>();
        java.util.Set<String> userSelectorIds = new java.util.LinkedHashSet<>();
        // A lead the CRM marked Converted is not enrolled where it would only be reached as a lead
        // (PolicyGate.effectiveLeadBlock), so it leaves as EXITED instead of being revived nightly.
        boolean targetsLearners = PolicyGate.targetsLearners(engine);
        try {
            JsonNode selectors = objectMapper.readTree(engine.getAudience());
            for (JsonNode sel : selectors) {
                String type = sel.path("type").asText("");
                String id = sel.path("id").asText("");
                switch (type) {
                    case "PACKAGE_SESSION" -> dao.userIdsByPackageSession(id, instituteId)
                            .forEach(uid -> raw.add(new Target(uid, null, null)));
                    case "AUDIENCE" -> dao.leadsByAudience(id, instituteId).forEach(row -> {
                        String userId = (String) row[1];
                        // Converted or Lost / Not interested (L2): the lead's pipeline is over.
                        boolean closed = row.length > 3 && ("CONVERTED".equals(row[3]) || "LOST".equals(row[3]));
                        if (closed && (userId == null || !targetsLearners)) return;
                        raw.add(new Target(userId, (String) row[0], row.length > 2 ? (String) row[2] : null));
                    });
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
            userSelectorIds.stream().filter(valid::contains).forEach(uid -> raw.add(new Target(uid, null, null)));
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
        // A lead without an account is keyed by its phone, so two rows of one person (a re-enquiry,
        // a second form) are one member; leadsByAudience lists oldest first, so the row kept is stable.
        // Someone an engine of this institute already holds as opted out is not enrolled again.
        OptOutMemory optedOut = OptOutMemory.of(dao.optedOutSubjects(instituteId));
        java.util.Map<String, Target> canonical = new java.util.LinkedHashMap<>();
        for (Target t : raw) {
            if (optedOut.covers(t.userId(), t.audienceResponseId(), t.phone10())) continue;
            String key = t.userId() != null ? "u:" + t.userId()
                    : t.phone10() != null ? "p:" + t.phone10() : "l:" + t.audienceResponseId();
            Target existing = canonical.get(key);
            if (existing == null) {
                canonical.put(key, t);
            } else if (existing.audienceResponseId() == null && t.audienceResponseId() != null) {
                // richer occurrence (has a lead row) wins — keep both ids
                canonical.put(key, new Target(existing.userId() != null ? existing.userId() : t.userId(),
                        t.audienceResponseId(), t.phone10()));
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
                    EngagementSendSchedule.of(engine.getQuietHours(), objectMapper)
                            .enrolWake(engine.getCadenceHours(), Instant.now()),
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
        // Looked up once, and only when some engine targets this list.
        boolean looked = false;
        String phone10 = null;
        for (EngagementEngine engine : engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId)) {
            if (!"ACTIVE".equals(engine.getStatus()) && !"DRY_RUN".equals(engine.getStatus())) continue;
            if (engine.isSystemManaged() || !targetsAudience(engine, audienceId)) continue;
            if (!looked) {
                looked = true;
                phone10 = dao.leadPhone10(responseId);
                // Someone an engine already holds as opted out (same lead, account or phone) is not enrolled.
                if (OptOutMemory.of(dao.optedOutSubjects(instituteId)).covers(userId, responseId, phone10)) {
                    log.info("Intake lead {} not enrolled: this person opted out of the institute's engines", responseId);
                    return 0;
                }
            }
            // The same person already in this engine through another lead row: one member, not two.
            if (dao.liveMembersForSamePerson(engine.getId(), responseId, userId, phone10) > 0) continue;
            int holdoutPct = engine.getHoldoutPct() != null ? Math.max(0, Math.min(100, engine.getHoldoutPct())) : 0;
            // An engine that waits for its send window for a first touch looks at the lead then.
            EngagementSendSchedule schedule = EngagementSendSchedule.of(engine.getQuietHours(), objectMapper);
            Instant firstLook = schedule.firstTouchImmediate()
                    ? Instant.now().plus(java.time.Duration.ofMinutes(
                            java.util.concurrent.ThreadLocalRandom.current().nextLong(1, INTAKE_FIRST_LOOK_MAX_MINUTES + 1)))
                    : schedule.firstWake(engine.getCadenceHours(), Instant.now());
            memberRepository.enrollOrStamp(UUID.randomUUID().toString(), engine.getId(), instituteId,
                    userId, responseId, firstLook, "intake:" + UUID.randomUUID(), holdoutPct);
            joined++;
        }
        return joined;
    }

    /**
     * Who this institute's engines hold as opted out, from {@link EngagementReadDao#optedOutSubjects}:
     * a person is covered by their account, their lead row or their phone.
     */
    record OptOutMemory(java.util.Set<String> userIds, java.util.Set<String> responseIds, java.util.Set<String> phones) {
        static OptOutMemory of(List<Object[]> rows) {
            java.util.Set<String> users = new java.util.HashSet<>();
            java.util.Set<String> responses = new java.util.HashSet<>();
            java.util.Set<String> phones = new java.util.HashSet<>();
            if (rows != null) {
                for (Object[] r : rows) {
                    if (r.length > 0 && r[0] != null) users.add((String) r[0]);
                    if (r.length > 1 && r[1] != null) responses.add((String) r[1]);
                    if (r.length > 2 && r[2] != null) phones.add((String) r[2]);
                }
            }
            return new OptOutMemory(users, responses, phones);
        }

        boolean covers(String userId, String responseId, String phone10) {
            return (userId != null && userIds.contains(userId))
                    || (responseId != null && responseIds.contains(responseId))
                    || (phone10 != null && phones.contains(phone10));
        }
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

    /**
     * Where an engine may go from each status. Mirrors NEXT_STATUSES in the admin dashboard
     * (engagement-engines/-constants). ARCHIVED is terminal: re-activating an archived engine would
     * message its old audience again. TEMPLATES_PENDING is entered by the template service, not here.
     */
    static final java.util.Map<String, List<String>> NEXT_STATUSES = java.util.Map.of(
            "DRAFT", List.of("DRY_RUN", "ACTIVE", "ARCHIVED"),
            "TEMPLATES_PENDING", List.of("DRY_RUN", "ACTIVE", "ARCHIVED"),
            "DRY_RUN", List.of("ACTIVE", "PAUSED", "ARCHIVED"),
            "ACTIVE", List.of("PAUSED"),
            "PAUSED", List.of("ACTIVE", "ARCHIVED"));

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
        String fromStatus = engine.getStatus();
        if (toStatus.equals(fromStatus)) return engine; // a repeated click changes nothing
        if (!NEXT_STATUSES.getOrDefault(fromStatus, List.of()).contains(toStatus)) {
            throw new VacademyException("An engine can't move from " + fromStatus + " to " + toStatus
                    + ("ARCHIVED".equals(fromStatus) ? ". Archived engines are closed; create a new engine instead." : "."));
        }
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
    /**
     * Edit an engine's settings. Null fields keep their value. The brief is not edited here — it
     * grows by amendments (editPrompt). A changed audience is re-resolved right away when the
     * engine already has members, so people who left stop being decided on.
     */
    @Transactional
    public EngagementEngine update(String engineId, String instituteId, CreateEngineRequest req, String editedBy) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        requireAdminManaged(engine);
        if ("ARCHIVED".equals(engine.getStatus())) {
            throw new VacademyException("An archived engine can't be edited; create a new engine instead");
        }
        if (req.getName() != null) {
            if (req.getName().isBlank()) throw new VacademyException("Engine name is required");
            engine.setName(req.getName().trim());
        }
        if (req.getObjective() != null) engine.setObjective(req.getObjective().isBlank() ? null : req.getObjective().trim());
        if (req.getLanguage() != null) engine.setLanguage(validLanguage(req.getLanguage()));
        if (req.getDataPoints() != null) engine.setDataPoints(writeJson(req.getDataPoints()));
        if (req.getChannels() != null) {
            String channels = validObjectJson(req.getChannels(), "channels", "{}");
            if (channelReadiness != null) channelReadiness.requireReady(instituteId, channels, engine.getChannels());
            engine.setChannels(channels);
        }
        if (req.getQuietHours() != null) engine.setQuietHours(validQuietHoursJson(req.getQuietHours()));
        if (req.getCadenceHours() != null) {
            if (req.getCadenceHours() <= 0) throw new VacademyException("cadenceHours must be at least 1");
            engine.setCadenceHours(req.getCadenceHours());
        }
        if (req.getHoldoutPct() != null) engine.setHoldoutPct(Math.max(0, Math.min(100, req.getHoldoutPct())));
        if (req.getFirstN() != null) engine.setFirstN(req.getFirstN() < 0 ? null : req.getFirstN());
        boolean audienceChanged = false;
        if (req.getAudience() != null) {
            String audience = validAudienceJson(req.getAudience());
            audienceChanged = !sameJson(audience, engine.getAudience());
            engine.setAudience(audience);
        }
        engine = engineRepository.save(engine);
        if (audienceChanged && memberRepository.countByEngineIdAndStatus(engine.getId(), "ACTIVE") > 0) {
            enrollAndReconcile(engine.getId(), instituteId);
        }
        log.info("Engine {} edited by {}", engineId, editedBy);
        return engine;
    }

    /**
     * Archive from any state. Stopping is always safe, so unlike the status allow-list (where ACTIVE
     * only goes to PAUSED) archiving a live engine is allowed here; its due sends are no longer
     * picked up (the dispatcher only sends for ACTIVE engines) and expire.
     */
    @Transactional
    public EngagementEngine archive(String engineId, String instituteId) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        requireAdminManaged(engine);
        if ("ARCHIVED".equals(engine.getStatus())) return engine;
        engine.setStatus("ARCHIVED");
        return engineRepository.save(engine);
    }

    /**
     * Delete permanently — only an engine that never reached anyone: no message sent or attempted and
     * no WhatsApp template sent to Meta. Anything else must stay archived so its record remains.
     */
    @Transactional
    public void deletePermanently(String engineId, String instituteId) {
        EngagementEngine engine = requireEngine(engineId, instituteId);
        requireAdminManaged(engine);
        if (deletionDao == null) throw new VacademyException("Deleting engines is not available");
        if ("ACTIVE".equals(engine.getStatus()) || "DRY_RUN".equals(engine.getStatus())) {
            throw new VacademyException("Pause or archive the engine before deleting it");
        }
        if (deletionDao.countReachedPeople(engineId) > 0) {
            throw new VacademyException("This engine has already messaged people, so it can't be deleted; archive it instead");
        }
        if (deletionDao.countTemplatesAtMeta(engineId) > 0) {
            throw new VacademyException("This engine has WhatsApp templates at Meta, so it can't be deleted; archive it instead");
        }
        deletionDao.deleteEngineRows(engineId, instituteId);
    }

    private boolean sameJson(String a, String b) {
        try {
            return objectMapper.readTree(a == null ? "null" : a).equals(objectMapper.readTree(b == null ? "null" : b));
        } catch (Exception e) {
            return false;
        }
    }

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

    /**
     * Quiet hours plus the send schedule stored with them (see {@link EngagementSendSchedule}):
     * a send time must be a real time outside the engine's own quiet hours, and days must name at
     * least one day.
     */
    private String validQuietHoursJson(String raw) {
        String json = validObjectJson(raw, "quietHours", "{}");
        JsonNode qh;
        try {
            qh = objectMapper.readTree(json);
        } catch (Exception e) {
            return json; // validObjectJson already refused unparseable JSON
        }
        if (qh.hasNonNull("sendHour")) {
            int h = qh.get("sendHour").asInt(-1);
            int m = qh.path("sendMinute").asInt(0);
            if (!qh.get("sendHour").canConvertToInt() || h < 0 || h > 23 || m < 0 || m > 59) {
                throw new VacademyException("Pick a valid send time for the engine");
            }
            if (qh.hasNonNull("startHour") && qh.hasNonNull("endHour")) {
                int qs = qh.get("startHour").asInt(), qe = qh.get("endHour").asInt();
                int minute = h * 60 + m;
                boolean quiet = qs != qe && (qs > qe
                        ? minute >= qs * 60 || minute < qe * 60
                        : minute >= qs * 60 && minute < qe * 60);
                if (quiet) {
                    throw new VacademyException(String.format(
                            "The send time %02d:%02d is inside the quiet hours (%02d:00 to %02d:00). Pick a time outside them.",
                            h, m, qs, qe));
                }
            }
        }
        JsonNode days = qh.get("days");
        if (days != null && !days.isNull()) {
            if (!days.isArray() || days.isEmpty()) {
                throw new VacademyException("Pick at least one day for the engine to send on");
            }
            for (JsonNode d : days) {
                if (!d.canConvertToInt() || d.asInt() < 1 || d.asInt() > 7) {
                    throw new VacademyException("days must be ISO days of the week, 1 (Monday) to 7 (Sunday)");
                }
            }
        }
        String firstTouch = qh.path("firstTouch").asText("IMMEDIATE");
        if (!"IMMEDIATE".equalsIgnoreCase(firstTouch) && !"SCHEDULED".equalsIgnoreCase(firstTouch)) {
            throw new VacademyException("firstTouch must be IMMEDIATE or SCHEDULED");
        }
        return json;
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
