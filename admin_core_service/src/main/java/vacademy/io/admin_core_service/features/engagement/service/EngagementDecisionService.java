package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.FetchContext;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The per-cohort decision flow: hydrate → consent → shouldWake → LLM → gate → TASK/NO_OP.
 *
 * Cost model: shouldWake() is deterministic and quantized — most wakes cost ZERO tokens.
 * cadenceElapsed is the clause that must never be removed: a digest has no clock, and for a
 * re-engagement engine ELAPSED SILENCE IS THE TRIGGER (a digest-only gate goes quiet exactly
 * when it should fire, then backoff punishes the dormant — the product inverted).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementDecisionService {

    private final DataPointRegistry registry;
    private final ContactResolver contactResolver;
    private final PolicyGate policyGate;
    private final EngagementBrainClient brain;
    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementPromptVersionRepository promptRepository;
    private final EngagementTemplateProposalRepository templateProposalRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${engagement.recent-window-days:14}")
    private int recentWindowDays;

    @Value("${engagement.task.expire-hours:72}")
    private int taskExpireHours;

    @Value("${engagement.sweep.lease-minutes:15}")
    private int leaseMinutes;

    @Value("${engagement.autonomy.first-n:5}")
    private int defaultFirstN;

    @Value("${engagement.schedule.max-hours:168}")
    private int maxScheduleHours;

    private static final int MAX_DRAFT_CHARS = 4000;
    private static final Set<String> VALID_CHANNELS = Set.of("WHATSAPP", "EMAIL", "IN_APP", "AI_CALL");
    private static final Set<String> VALID_ACTION_TYPES = Set.of("SEND_MESSAGE", "SHARE_LINK", "CALL");

    /** Process one engine's claimed cohort. Returns the number of LLM decisions made. */
    public int decideCohort(EngagementEngine engine, List<EngagementMember> members) {
        if (members.isEmpty()) return 0;

        EngagementPromptVersion prompt = promptRepository
                .findTopByEngineIdAndStatusOrderByVersionDesc(engine.getId(), "ACTIVE")
                .orElse(null);
        if (prompt == null) {
            log.warn("Engine {} has no ACTIVE prompt — deferring cohort", engine.getId());
            return 0; // members keep their lease; they come due again after it expires
        }

        List<Subject> subjects = contactResolver.resolve(members);
        Map<String, Subject> subjectByMember = new java.util.HashMap<>();
        subjects.forEach(s -> subjectByMember.put(s.getMemberId(), s));

        FetchContext ctx = FetchContext.builder()
                .instituteId(engine.getInstituteId())
                .engineId(engine.getId())
                .recentWindowDays(recentWindowDays)
                .build();

        DataPointRegistry.CohortBundle bundle;
        try {
            bundle = registry.hydrate(ctx, parseDataPoints(engine), subjects);
        } catch (Exception e) {
            // A failed fetch is NOT "no data": defer the whole cohort (leases expire → retry).
            log.error("Hydration failed for engine {} — deferring {} members: {}",
                    engine.getId(), members.size(), e.getMessage());
            return 0;
        }

        Set<String> optedOut = policyGate.optedOutUserIds(engine.getInstituteId(),
                members.stream().map(EngagementMember::getUserId).filter(java.util.Objects::nonNull).toList());

        // Channel context is per-ENGINE, not per-member — compute once so the prompt prefix (which
        // now carries the enabled channels + approved WhatsApp templates) stays byte-identical across
        // the cohort. WhatsApp is template-only, so the brain can only pick it when a template exists.
        Set<String> enabledChannels = parseEnabledChannels(engine);
        List<EngagementBrainClient.TemplateOption> whatsappTemplates =
                enabledChannels.contains("WHATSAPP") ? loadApprovedTemplates(engine) : List.of();
        Map<String, EngagementBrainClient.TemplateOption> templatesByName = new java.util.HashMap<>();
        whatsappTemplates.forEach(t -> templatesByName.put(t.name(), t));

        boolean dryRun = "DRY_RUN".equalsIgnoreCase(engine.getStatus());
        int decisions = 0;
        for (EngagementMember member : members) {
            try {
                decisions += decideOne(engine, prompt, member, bundle, optedOut, dryRun,
                        enabledChannels, whatsappTemplates, templatesByName) ? 1 : 0;
            } catch (Exception e) {
                // Decision failed AFTER we claimed a lease. Push it out with exponential backoff
                // so an LLM/provider outage doesn't re-hammer every 15 min (the lease alone would
                // retry-storm the sibling batch endpoints all weekend).
                log.error("Decision failed for member {} (engine {}): {}",
                        member.getId(), engine.getId(), e.getMessage());
                backoffAfterFailure(member);
            }
        }
        return decisions;
    }

    private boolean decideOne(EngagementEngine engine, EngagementPromptVersion prompt,
                              EngagementMember member, DataPointRegistry.CohortBundle bundle,
                              Set<String> optedOut, boolean dryRun,
                              Set<String> enabledChannels,
                              List<EngagementBrainClient.TemplateOption> whatsappTemplates,
                              Map<String, EngagementBrainClient.TemplateOption> templatesByName) {
        Instant now = Instant.now();

        // 0. Lease re-check: a serial cohort can outrun its 15-min lease; if another pod has
        // already re-claimed this member (next_action_at moved past our lease), skip it — this
        // is what makes "cohort outruns lease" not-a-double-decide. Cheap read, no lock.
        EngagementMember fresh = memberRepository.findById(member.getId()).orElse(null);
        if (fresh == null || !"ACTIVE".equals(fresh.getStatus())
                || (member.getNextActionAt() != null && fresh.getNextActionAt() != null
                    && fresh.getNextActionAt().isAfter(member.getNextActionAt()))) {
            log.debug("Member {} lease lost/reclaimed — skipping to avoid double decision", member.getId());
            return false;
        }
        member = fresh;
        Instant heldLease = fresh.getNextActionAt(); // as stored, so recordDecision can tell it is still ours

        // 1. Consent — before anything else.
        PolicyGate.Verdict verdict = policyGate.preDecision(member, optedOut);
        if (verdict == PolicyGate.Verdict.SKIP_OPTED_OUT) {
            member.setStatus("OPTED_OUT");
            memberRepository.save(member);
            return false;
        }
        if (verdict == PolicyGate.Verdict.SKIP_CAPPED) {
            reschedule(member, engine, now, true);
            return false;
        }

        // 1b. Holdout cohort (Phase 2): enrolled for lift measurement but NEVER messaged. Skip BEFORE
        // the LLM (zero tokens), reschedule at cadence so they don't re-select every sweep, and stamp
        // last_decided_at so no wake trigger keeps re-firing. Their engagement is compared to the
        // treated cohort out-of-band; nothing is ever sent or tasked for them.
        if (Boolean.TRUE.equals(member.getIsHoldout())) {
            member.setLastDecidedAt(now);
            member.setNextActionAt(now.plus(Duration.ofHours(Math.max(engine.getCadenceHours(), 1))));
            memberRepository.save(member);
            return false;
        }

        // 2. Deterministic wake gate — zero tokens for most members.
        String fingerprint = quantizedFingerprint(bundle.payloadsFor(member.getId()));
        if (!shouldWake(member, engine, fingerprint, bundle, now)) {
            // A gate sleep is not a no-op decision, so it must not stretch the backoff. Counting
            // it (every cadence/4 re-check) doubled the required wait faster than time passed:
            // after one NO_OP at a 72h cadence the next LLM look came ~30 days later.
            member.setWakeFingerprint(fingerprint);
            reschedule(member, engine, now, false);
            return false;
        }

        // 3. The LLM.
        EngagementBrainClient.Decision d = brain.decide(
                engine, prompt.getCompiledText(), bundle.renderFor(member.getId()), now,
                enabledChannels, whatsappTemplates);

        // 4. Persist the outcome — TASK (or SIMULATED for DRY_RUN) or NO_OP.
        // Enforce the channel enablement server-side, not just in the prompt: a model that ignores
        // the "choose only enabled channels" instruction must NOT get a task created on a channel the
        // institute disabled (sendEmail/sendInApp have no enablement guard, so it would dispatch). A
        // null channel is fine (the human picks); a non-null one must be enabled.
        String chosenChannel = validChannel(d.channel());
        boolean channelAllowed = chosenChannel == null || enabledChannels.contains(chosenChannel);
        if (!channelAllowed) {
            log.warn("Engine {}: brain chose disabled channel '{}' — recording NO_OP", engine.getId(), chosenChannel);
        }
        if ("ACT".equalsIgnoreCase(d.decision()) && channelAllowed
                && d.draftBody() != null && !d.draftBody().isBlank()) {
            // Cap the schedule horizon: an unbounded scheduleInHours lets the brain place a send days
            // or weeks out, which (a) drifts far from the context it was decided on and (b) breaks the
            // billing-reconciliation window if it dispatches long after creation.
            int hoursOut = d.scheduleInHours() != null
                    ? Math.min(Math.max(d.scheduleInHours(), 0), maxScheduleHours) : 0;
            Instant proposed = now.plus(Duration.ofHours(hoursOut));
            Instant scheduledFor = policyGate.clampToAllowedWindow(engine, proposed);

            EngagementAction action = new EngagementAction();
            action.setEngineId(engine.getId());
            action.setMemberId(member.getId());
            action.setInstituteId(engine.getInstituteId());
            action.setPromptVersionId(prompt.getId());
            action.setActionType(validActionType(d.actionType()));
            action.setChannel(chosenChannel);
            action.setDraftBody(cap(d.draftBody()));
            action.setRationale(cap(d.rationale()));
            action.setPriority(BigDecimal.valueOf(Math.max(0, Math.min(100, d.priority()))));
            action.setScheduledFor(scheduledFor);
            action.setExpiresAt(scheduledFor.plus(Duration.ofHours(taskExpireHours)));
            // WhatsApp is template-only: attach the brain's chosen approved template + variables so
            // the dispatcher can actually send it. If the pick is invalid (unknown template, missing
            // a variable), leave it unattached — the task still surfaces with the resolved draft for
            // a human to fix; the dispatcher refuses a template-less WhatsApp send, so nothing leaks.
            if ("WHATSAPP".equals(action.getChannel())) {
                attachWhatsAppTemplate(action, d, templatesByName);
            }
            // Phase 2 — AUTONOMOUS vs COPILOT. Auto-send (kind=SEND; the dispatch job fires it when
            // due) only when ALL hold: the channel's `auto` intent is set, the engine isn't killed,
            // it has GRADUATED (>= first_n human-approved sends), the draft is actually sendable
            // (WhatsApp needs an attached approved template), and it's not a dry run. Otherwise it's a
            // copilot TASK exactly as before. A dry run is always SIMULATED (never sends, never caps).
            boolean draftReady = !"WHATSAPP".equals(chosenChannel) || action.getTemplateName() != null;
            boolean autoSend = !dryRun
                    && chosenChannel != null
                    && !"AI_CALL".equals(chosenChannel)   // AI calls are task-only; never auto-send them
                    && channelAutoEnabled(engine, chosenChannel)
                    && !Boolean.TRUE.equals(engine.getAutoSendKilled())
                    && draftReady
                    && graduated(engine, chosenChannel);
            action.setKind(autoSend ? "SEND" : "TASK");
            action.setStatus(dryRun ? "SIMULATED" : "OPEN");
            actionRepository.save(action);

            member.setConsecutiveNoOps((short) 0);
        } else {
            EngagementAction noOp = new EngagementAction();
            noOp.setEngineId(engine.getId());
            noOp.setMemberId(member.getId());
            noOp.setInstituteId(engine.getInstituteId());
            noOp.setPromptVersionId(prompt.getId());
            noOp.setKind("NO_OP");
            noOp.setStatus("DONE");
            noOp.setRationale(cap(d.rationale()));
            actionRepository.save(noOp);

            member.setConsecutiveNoOps((short) Math.min(member.getConsecutiveNoOps() + 1, 10));
        }

        member.setLastDecidedAt(now);
        member.setWakeFingerprint(fingerprint);
        member.setConsecutiveFailures((short) 0); // reached a real decision — clear the failure backoff
        int nextHours = d.nextCheckHours() != null && d.nextCheckHours() > 0
                ? d.nextCheckHours()
                : engine.getCadenceHours();
        // Bounded like the no-op backoff: a model answer of 8760 would park the member for a year.
        long nextCheck = Math.min(Math.max(nextHours, 1), Duration.ofDays(30).toHours());
        member.setNextActionAt(now.plus(Duration.ofHours(nextCheck)));
        // Targeted write, not save(member): a reply window, tier or opt-out that landed while the LLM
        // was thinking must survive (see recordDecision).
        memberRepository.recordDecision(member.getId(), now, fingerprint, member.getConsecutiveNoOps(),
                heldLease, member.getNextActionAt());
        return true;
    }

    /** True iff channels.<ch>.auto is set — the admin's intent to auto-send proactively on that channel. */
    private boolean channelAutoEnabled(EngagementEngine engine, String channel) {
        try {
            JsonNode ch = objectMapper.readTree(engine.getChannels()).path(channel);
            return ch.path("enabled").asBoolean(false) && ch.path("auto").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /** Graduated to autonomy on a channel: >= first_n human-approved sends ON THAT CHANNEL (per-engine override or default). */
    private boolean graduated(EngagementEngine engine, String channel) {
        int threshold = engine.getFirstN() != null ? engine.getFirstN() : defaultFirstN;
        if (threshold <= 0) return true; // 0 = trust immediately (explicit opt-in via override)
        // Per channel: approvals of in-app notes must not unlock autonomous WhatsApp or email.
        return actionRepository.countApprovedSendsForChannel(engine.getId(), channel) >= threshold;
    }

    /** Which channels the engine's config marks enabled; empty config → all (human reviews anyway). */
    private Set<String> parseEnabledChannels(EngagementEngine engine) {
        Set<String> enabled = new java.util.LinkedHashSet<>();
        try {
            JsonNode channels = objectMapper.readTree(engine.getChannels());
            for (String ch : VALID_CHANNELS) {
                if (channels.path(ch).path("enabled").asBoolean(false)) enabled.add(ch);
            }
        } catch (Exception e) {
            log.warn("Engine {} has unparseable channels — allowing none", engine.getId());
        }
        // None enabled means none: treating an empty set as "all" let {"EMAIL":{"enabled":false,
        // "auto":true}} produce autonomous email on a channel the institute switched off.
        return enabled;
    }

    /** The engine's Meta-approved WhatsApp templates the brain may choose from (name + body + vars). */
    private List<EngagementBrainClient.TemplateOption> loadApprovedTemplates(EngagementEngine engine) {
        try {
            return templateProposalRepository.findApproved(engine.getId(), engine.getInstituteId()).stream()
                    .map(p -> new EngagementBrainClient.TemplateOption(
                            p.getName(), p.getProposedBody(), readJsonArray(p.getVariableNames()), p.getLanguage()))
                    .toList();
        } catch (Exception e) {
            log.warn("Engine {} approved-template load failed: {}", engine.getId(), e.getMessage());
            return List.of();
        }
    }

    /**
     * Attach the brain's chosen template to a WhatsApp action, but ONLY if the pick is real and
     * complete: the template must be one of THIS engine's approved templates, and the brain must
     * have supplied a value for EVERY variable the template declares. Otherwise leave it unattached
     * (the dispatcher rejects a template-less WhatsApp send, so an incomplete pick never sends).
     */
    private void attachWhatsAppTemplate(EngagementAction action, EngagementBrainClient.Decision d,
                                        Map<String, EngagementBrainClient.TemplateOption> byName) {
        String tn = d.templateName();
        if (tn == null || tn.isBlank()) {
            log.warn("Engine {}: brain chose WHATSAPP without a template — task left unattached", action.getEngineId());
            return;
        }
        EngagementBrainClient.TemplateOption t = byName.get(tn);
        if (t == null) {
            log.warn("Engine {}: brain chose unapproved WhatsApp template '{}' — unattached", action.getEngineId(), tn);
            return;
        }
        Map<String, String> supplied = d.variables() != null ? d.variables() : Map.of();
        // Serialize ONLY the template's declared variables (drop any extras the model invented),
        // and require every one to be present and non-blank.
        Map<String, String> vars = new java.util.LinkedHashMap<>();
        for (String name : t.variableNames()) {
            String v = supplied.get(name);
            if (v == null || v.isBlank()) {
                log.warn("Engine {}: brain omitted variable '{}' for template '{}' — unattached",
                        action.getEngineId(), name, tn);
                return;
            }
            vars.put(name, v);
        }
        action.setTemplateName(t.name());
        action.setVariablesJson(writeJson(vars));
        // Meta identifies a template by name+language; the template was registered under the engine's
        // language (metaLanguageCode maps hinglish→en). Carry it so the dispatcher sends the right locale.
        action.setTemplateLanguage(metaLanguageCode(t.language()));
        // Overwrite the model's free-text draft with the DETERMINISTIC render of the approved template
        // filled with these variables — this is exactly what Meta will send, so the human reviews the
        // real message and sent_body records the truth (the model's paraphrase could silently diverge).
        String rendered = renderTemplate(t.body(), t.variableNames(), vars);
        if (rendered != null && !rendered.isBlank()) action.setDraftBody(cap(rendered));
    }

    private static final Pattern TEMPLATE_PLACEHOLDER = Pattern.compile("\\{\\{(\\d+)}}");

    /**
     * Substitute {{1}}..{{n}} in a template body with the ordered variable values — the exact render
     * Meta produces (position i ↔ variableNames[i-1]). SINGLE pass, so a variable value that itself
     * contains a placeholder token (e.g. a person's name of "{{2}}") is NOT re-substituted, matching
     * Meta's independent per-position fill and keeping the reviewed preview == the sent message.
     */
    private static String renderTemplate(String body, List<String> variableNames, Map<String, String> vars) {
        if (body == null) return null;
        Matcher m = TEMPLATE_PLACEHOLDER.matcher(body);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            int idx = Integer.parseInt(m.group(1)) - 1;
            String val = (idx >= 0 && idx < variableNames.size())
                    ? vars.getOrDefault(variableNames.get(idx), "") : m.group();
            m.appendReplacement(sb, Matcher.quoteReplacement(val));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** Hinglish is authored under Meta code "en"; en/hi register under themselves. Must match the register-time mapping. */
    private static String metaLanguageCode(String lang) {
        return "hinglish".equals(lang) ? "en" : (lang != null ? lang : "en");
    }

    private String validChannel(String c) {
        return c != null && VALID_CHANNELS.contains(c.toUpperCase()) ? c.toUpperCase() : null;
    }

    private List<String> readJsonArray(String json) {
        try {
            List<String> out = new ArrayList<>();
            JsonNode n = objectMapper.readTree(json == null ? "[]" : json);
            if (n.isArray()) n.forEach(e -> out.add(e.asText()));
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }

    private String writeJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }

    private String validActionType(String t) {
        return t != null && VALID_ACTION_TYPES.contains(t.toUpperCase()) ? t.toUpperCase() : "SEND_MESSAGE";
    }

    private static String cap(String s) {
        if (s == null) return null;
        return s.length() <= MAX_DRAFT_CHARS ? s : s.substring(0, MAX_DRAFT_CHARS);
    }

    /**
     * Failure backoff — stretch next_action_at so an outage doesn't retry-storm. Uses a SEPARATE
     * consecutive_failures counter, never consecutive_no_ops: a transient LLM/provider outage must
     * not inflate the cadence math (which would send a member dormant for weeks after an outage it
     * never actually got a decision from).
     */
    private void backoffAfterFailure(EngagementMember m) {
        try {
            short fails = (short) Math.min(m.getConsecutiveFailures() + 1, 10);
            long hours = Math.min(1L << Math.min(fails, 6), Duration.ofDays(1).toHours()); // 2,4,...,64h cap 24h
            m.setConsecutiveFailures(fails);
            m.setNextActionAt(Instant.now().plus(Duration.ofHours(Math.max(hours, 1))));
            // m is the copy claimed before the LLM call; writing the whole row would undo a reply
            // window or opt-out recorded since.
            memberRepository.recordDecisionFailure(m.getId(), fails, m.getNextActionAt());
        } catch (Exception ignored) {
            // if even the backoff save fails, the lease still expires and the row retries later
        }
    }

    /**
     * Deterministic, zero-token wake decision.
     * Order matters: unanswered reply > changed state > cadence elapsed.
     */
    private boolean shouldWake(EngagementMember m, EngagementEngine engine, String fingerprint,
                               DataPointRegistry.CohortBundle bundle, Instant now) {
        if (m.getLastDecidedAt() == null) return true;                    // first look
        if (hasUnansweredReply(bundle, m)) return true;                   // always
        if (!fingerprint.equals(m.getWakeFingerprint())) return true;     // state moved (banded)
        return cadenceElapsed(m, engine, now);                            // THE CLOCK — never remove
    }

    private boolean hasUnansweredReply(DataPointRegistry.CohortBundle bundle, EngagementMember m) {
        JsonNode ledger = bundle.payloadsFor(m.getId()).get("ledger");
        if (ledger == null) return false;
        for (String ch : List.of("whatsapp", "email")) {
            JsonNode c = ledger.get(ch);
            if (c == null || c.isNull()) continue;
            Instant reply = parseInstant(c.path("lastReplyAt").asText(null));
            Instant sent = parseInstant(c.path("lastSentAt").asText(null));
            if (reply != null && (sent == null || reply.isAfter(sent))
                    && (m.getLastDecidedAt() == null || reply.isAfter(m.getLastDecidedAt()))) {
                return true;
            }
        }
        return false;
    }

    private boolean cadenceElapsed(EngagementMember m, EngagementEngine engine, Instant now) {
        // Backoff stretches the cadence for serial no-ops (base * 2^min(noOps,5), capped at 30d)
        // — but the clock always ticks, so a dormant member still gets re-engaged on schedule.
        long base = Math.max(engine.getCadenceHours(), 1);
        long stretched = base * (1L << Math.min(m.getConsecutiveNoOps(), 5));
        long cappedHours = Math.min(stretched, Duration.ofDays(30).toHours());
        return m.getLastDecidedAt().plus(Duration.ofHours(cappedHours)).isBefore(now);
    }

    private void reschedule(EngagementMember m, EngagementEngine engine, Instant now, boolean capped) {
        long hours = capped
                ? Duration.ofDays(1).toHours()                 // capped: try tomorrow
                : Math.max(engine.getCadenceHours() / 4, 6);   // gate said sleep: re-check fraction of cadence
        m.setNextActionAt(now.plus(Duration.ofHours(hours)));
        memberRepository.save(m);
    }

    /**
     * QUANTIZED fingerprint — bands, never raw values. Raw values (completion %, last-activity
     * timestamps) move every session for exactly the members worth messaging, so a raw digest
     * never skips where it matters: the saving would anti-correlate with the value.
     * NOTE: no prompt version in here — one admin edit must not re-decide every member at once.
     */
    private String quantizedFingerprint(Map<String, JsonNode> payloads) {
        StringBuilder sb = new StringBuilder();
        JsonNode ledger = payloads.get("ledger");
        if (ledger != null) {
            for (String ch : List.of("whatsapp", "email")) {
                JsonNode c = ledger.get(ch);
                if (c == null || c.isNull()) continue;
                sb.append(ch)
                  .append("|sent:").append(daysBand(parseInstant(c.path("lastSentAt").asText(null))))
                  .append("|read:").append(daysBand(parseInstant(c.path("lastReadAt").asText(null))))
                  .append("|reply:").append(daysBand(parseInstant(c.path("lastReplyAt").asText(null))))
                  .append("|fails:").append(countBand(c.path("recentFailures").asLong(0)));
            }
        }
        JsonNode enrollment = payloads.get("enrollment");
        if (enrollment != null) {
            // Sort the per-enrollment bands: the source query has no ORDER BY, so row order is
            // non-deterministic across ticks — hashing in row order would flip the fingerprint
            // (spurious "state moved" → needless wake) even when nothing changed.
            List<String> bands = new ArrayList<>();
            for (JsonNode e : enrollment.path("enrollments")) {
                bands.add(e.path("packageSessionId").asText("") + ":" + pctBand(e.path("completionPct").asText(null)));
            }
            java.util.Collections.sort(bands);
            bands.forEach(b -> sb.append("|c:").append(b));
        }
        JsonNode login = payloads.get("login");
        if (login != null) {
            sb.append("|login:").append(daysBand(parseInstant(login.path("lastLoginAt").asText(null))));
        }
        JsonNode crm = payloads.get("crm_lead");
        if (crm != null) {
            sb.append("|lead:").append(crm.path("status").asText("")).append("/").append(crm.path("tier").asText(""));
        }
        return sha256(sb.toString());
    }

    /** Days-since bucketed 0/1/3/7/14/30+ — the quantization that keeps active users from thrashing the gate. */
    private static String daysBand(Instant t) {
        if (t == null) return "never";
        long d = Duration.between(t, Instant.now()).toDays();
        if (d <= 0) return "0";
        if (d <= 1) return "1";
        if (d <= 3) return "3";
        if (d <= 7) return "7";
        if (d <= 14) return "14";
        return "30+";
    }

    private static String pctBand(String pct) {
        if (pct == null) return "?";
        try {
            double v = Double.parseDouble(pct);
            return String.valueOf(((int) (v / 20)) * 20); // 0/20/40/60/80/100 bands
        } catch (NumberFormatException e) {
            return "?";
        }
    }

    private static String countBand(long n) {
        if (n == 0) return "0";
        if (n <= 2) return "1-2";
        return "3+";
    }

    private static Instant parseInstant(String s) {
        if (s == null || s.isBlank() || "never".equals(s)) return null;
        try { return Instant.parse(s); } catch (Exception e) { return null; }
    }

    private static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(s.getBytes(StandardCharsets.UTF_8))).substring(0, 32);
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private List<String> parseDataPoints(EngagementEngine engine) {
        try {
            return objectMapper.readValue(engine.getDataPoints(),
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            log.warn("Engine {} has unparseable data_points — using always-on only", engine.getId());
            return List.of();
        }
    }

    /** Enrollment jitter: spread first decisions across the cadence so activation is a flat line, not a herd. */
    public static Instant jitteredFirstWake(int cadenceHours, Instant now) {
        long jitterMinutes = ThreadLocalRandom.current().nextLong(
                Math.max(Duration.ofHours(cadenceHours).toMinutes(), 60));
        return now.plus(Duration.ofMinutes(jitterMinutes));
    }
}
