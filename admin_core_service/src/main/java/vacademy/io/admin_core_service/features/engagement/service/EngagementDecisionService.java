package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
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
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateCatalog;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.OptionalInt;
import java.util.Set;
import java.util.function.IntPredicate;
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

    /** B5 coordination with the rest of the CRM; field-injected so it stays optional in unit tests. */
    @Autowired(required = false)
    private EngagementCoordinationService coordination;

    /** B6 CRM actions (allow-list, validation, inbox tasks); optional in unit tests. */
    @Autowired(required = false)
    private EngagementCrmActionService crmActions;

    /** B6 template-only email: the templates track's catalog (A3); optional in unit tests. */
    @Autowired(required = false)
    private EngagementEmailTemplateCatalog emailCatalog;

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
    private static final int MAX_SUBJECT_CHARS = 150;
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
        // The opt-out list above is keyed by user_id, so a lead without one had no live consent
        // check: an opt-out in the CRM was only seen by the nightly reconcile (F2 / L3).
        Map<String, PolicyGate.LeadBlock> blockedLeads = policyGate.blockedLeads(engine.getInstituteId(),
                members.stream().map(EngagementMember::getAudienceResponseId).filter(java.util.Objects::nonNull).toList());

        // Channel context is per-ENGINE, not per-member — compute once so the prompt prefix (which
        // now carries the enabled channels + approved WhatsApp templates) stays byte-identical across
        // the cohort. WhatsApp is template-only, so the brain can only pick it when a template exists.
        Set<String> enabledChannels = parseEnabledChannels(engine);
        List<EngagementBrainClient.TemplateOption> whatsappTemplates =
                enabledChannels.contains("WHATSAPP") ? loadApprovedTemplates(engine) : List.of();
        Map<String, EngagementBrainClient.TemplateOption> templatesByName = new java.util.HashMap<>();
        whatsappTemplates.forEach(t -> templatesByName.put(t.name(), t));

        boolean dryRun = "DRY_RUN".equalsIgnoreCase(engine.getStatus());
        EngagementBrainClient.ActionMenu menu = crmActions != null ? crmActions.menu(engine)
                : EngagementBrainClient.ActionMenu.NONE;
        Map<String, EngagementCoordinationService.Verdict> coordinated = coordination != null
                ? coordination.forCohort(engine.getInstituteId(), members, bundle, Instant.now())
                : Map.of();
        int decisions = 0;
        for (EngagementMember member : members) {
            try {
                decisions += decideOne(engine, prompt, member, bundle, optedOut, blockedLeads, dryRun,
                        enabledChannels, whatsappTemplates, templatesByName,
                        EngagementCoordinationService.of(coordinated, member.getId()), menu,
                        subjectByMember.get(member.getId())) ? 1 : 0;
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
                              Set<String> optedOut, Map<String, PolicyGate.LeadBlock> blockedLeads,
                              boolean dryRun,
                              Set<String> enabledChannels,
                              List<EngagementBrainClient.TemplateOption> whatsappTemplates,
                              Map<String, EngagementBrainClient.TemplateOption> templatesByName,
                              EngagementCoordinationService.Verdict coordinated,
                              EngagementBrainClient.ActionMenu menu, Subject subject) {
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

        // 1. Consent — before anything else. The lead row first: an opted-out lead is OPTED_OUT
        // (it survives the reconcile), a lead the admin removed is EXITED (the reconcile revives
        // it if the row comes back).
        // A lead the CRM marked Converted leaves as EXITED, unless this engine also targets learners.
        PolicyGate.LeadBlock leadBlock = PolicyGate.effectiveLeadBlock(
                member.getAudienceResponseId() != null && blockedLeads != null
                        ? blockedLeads.get(member.getAudienceResponseId()) : null,
                engine, member);
        if (leadBlock != null) {
            member.setStatus(leadBlock == PolicyGate.LeadBlock.OPTED_OUT ? "OPTED_OUT" : "EXITED");
            memberRepository.save(member);
            return false;
        }
        PolicyGate.Verdict verdict = policyGate.preDecision(member, optedOut);
        if (verdict == PolicyGate.Verdict.SKIP_OPTED_OUT) {
            member.setStatus("OPTED_OUT");
            memberRepository.save(member);
            return false;
        }
        if (verdict == PolicyGate.Verdict.SKIP_CAPPED) {
            rescheduleCapped(member, now);
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

        // 1c. Sequence finished: an engine with channels.maxTouches stops at that many sent messages
        // per person. Checked before the LLM, so a finished member costs nothing; re-checked monthly
        // in case the limit is raised.
        Integer maxTouches = maxTouches(engine);
        if (maxTouches != null && actionRepository.countByMemberIdAndStatus(member.getId(), "SENT") >= maxTouches) {
            memberRepository.recordDecision(member.getId(), now, member.getWakeFingerprint(),
                    member.getConsecutiveNoOps(), heldLease, now.plus(Duration.ofDays(30)));
            return false;
        }

        // 1d. One contact limit across all systems (B5 / S1): the person already heard enough this
        // week from the engine, workflows, announcements, the chatbot and AI calls together. No LLM;
        // look again tomorrow, like the engine's own cap.
        if (coordinated.contactLimitReached()) {
            log.debug("Member {}: {} touches from all systems this window — not deciding", member.getId(),
                    coordinated.touches());
            rescheduleCapped(member, now);
            return false;
        }

        // 1e. HARD RULE: with the AI call channel on, the first thing done for a person is an AI call,
        // decided here and not left to the model. A person with no phone, a wrong number or no call
        // left this week falls through to the usual decision (another channel).
        if (crmActions != null && !hasUnansweredReply(bundle, member)
                && actionRepository.countTouches(member.getId()) == 0) {
            String phone = subject != null ? subject.getPhone() : null;
            EngagementAction call = crmActions.proposeFirstTouchCall(engine, member, phone, coordinated.hold(), dryRun);
            if (call != null) {
                member.setConsecutiveNoOps((short) 0);
                memberRepository.recordDecision(member.getId(), now,
                        quantizedFingerprint(bundle.payloadsFor(member.getId())), (short) 0, heldLease,
                        now.plus(Duration.ofHours(Math.max(engine.getCadenceHours(), 1))));
                return true;
            }
        }

        // 2. Deterministic wake gate — zero tokens for most members.
        Map<String, JsonNode> payloads = bundle.payloadsFor(member.getId());
        String fingerprint = quantizedFingerprint(payloads);
        if (legacyFingerprint(payloads).equals(member.getWakeFingerprint())) {
            // Stored before the CRM bands were added: the same state, not a change. Without this the
            // new formula would send every member to the LLM at its next look, all at once.
            member.setWakeFingerprint(fingerprint);
        }
        if (!shouldWake(member, engine, fingerprint, bundle, now)) {
            // A gate sleep is not a no-op decision, so it must not stretch the backoff. Counting
            // it (every cadence/4 re-check) doubled the required wait faster than time passed:
            // after one NO_OP at a 72h cadence the next LLM look came ~30 days later.
            memberRepository.recordGateSleep(member.getId(), fingerprint, now,
                    now.plus(Duration.ofHours(Math.max(engine.getCadenceHours() / 4, 6))));
            return false;
        }

        // 3. The LLM.
        Map<String, String> blocks = withCoordination(coordinated, withWhyNow(member, bundle.renderFor(member.getId())));
        // An engine that only messages keeps exactly today's call (and prompt).
        EngagementBrainClient.Decision d = menu == null || menu.isEmpty()
                ? brain.decide(engine, prompt.getCompiledText(), blocks, now, enabledChannels, whatsappTemplates)
                : brain.decide(engine, prompt.getCompiledText(), blocks, now, enabledChannels, whatsappTemplates, menu);

        // 3b. B6: a CRM action (follow-up, note, escalation, status, AI call) becomes an inbox task
        // a person approves, after the server checks it (allow-list, the action's own rules). WAIT is
        // a NO_OP. A proposal that fails the check is recorded as a NO_OP with the reason.
        String crmType = d.actionType() != null ? d.actionType().trim().toUpperCase() : null;
        Map<String, String> params = d.actionParams();
        // AI_CALL is not a message channel: a model that answers "call them" with channel AI_CALL and
        // a draft would only get a text task nobody can dial. Treat it as the call action it means.
        if ("ACT".equalsIgnoreCase(d.decision()) && !EngagementActionTypes.isCrmAction(crmType)
                && "AI_CALL".equalsIgnoreCase(d.channel()) && crmActions != null
                && crmActions.allowedActions(engine).contains(EngagementActionTypes.SCHEDULE_AI_CALL)) {
            crmType = EngagementActionTypes.SCHEDULE_AI_CALL;
            Map<String, String> callParams = new java.util.LinkedHashMap<>();
            callParams.put("dueInHours", String.valueOf(d.scheduleInHours() != null ? Math.max(d.scheduleInHours(), 0) : 0));
            if (d.rationale() != null && !d.rationale().isBlank()) callParams.put("note", cap(d.rationale()));
            params = callParams;
        }
        if ("ACT".equalsIgnoreCase(d.decision()) && EngagementActionTypes.isCrmAction(crmType)) {
            String phone = subject != null ? subject.getPhone() : null;
            String rejected = crmActions == null ? "CRM actions are not available"
                    : crmActions.validateProposal(engine, member, phone, crmType, params);
            EngagementAction action = new EngagementAction();
            action.setEngineId(engine.getId());
            action.setMemberId(member.getId());
            action.setInstituteId(engine.getInstituteId());
            action.setPromptVersionId(prompt.getId());
            if (rejected == null) {
                action.setKind("TASK");
                action.setActionType(crmType);
                action.setStatus(dryRun ? "SIMULATED" : "OPEN");
                action.setDraftBody(cap(crmActions.describe(engine, member, phone, crmType, params)));
                action.setVariablesJson(crmActions.taskVariables(params));
                action.setRationale(cap(d.rationale()));
                double priority = EngagementActionTypes.ESCALATE.equals(crmType) ? Math.max(d.priority(), 80) : d.priority();
                action.setPriority(BigDecimal.valueOf(Math.max(0, Math.min(100, priority))));
                action.setScheduledFor(now);
                action.setExpiresAt(now.plus(Duration.ofHours(taskExpireHours)));
                member.setConsecutiveNoOps((short) 0);
            } else {
                log.info("Engine {}: {} proposed for member {} not drafted: {}", engine.getId(), crmType,
                        member.getId(), rejected);
                action.setKind("NO_OP");
                action.setStatus("DONE");
                action.setRationale(cap("Proposed " + crmType + ", not drafted: " + rejected + " " + nullToEmpty(d.rationale())));
                member.setConsecutiveNoOps((short) Math.min(member.getConsecutiveNoOps() + 1, 10));
            }
            EngagementLlmUsage.applyTo(d.usage(), action);
            actionRepository.save(action);
            if (rejected == null && !dryRun) {
                // B7: an action type the admin set to run on its own, graduated (S7), with no kill
                // switch (S6), hold or credit problem, runs now; otherwise it stays this inbox task.
                crmActions.tryAutonomous(action, engine, member, phone, coordinated.hold(),
                        humanTouchedSinceLastDecision(member), false);
            }
            return recordAndFinish(member, engine, d, fingerprint, heldLease, now);
        }

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
            PolicyGate.SendTiming timing = sendTiming(engine, member, bundle);
            Instant planned = policyGate.scheduleSend(engine, proposed, timing);
            // Someone who has not answered three messages at the same time of day gets the next one at
            // another time (answers to a message they sent are not planned outreach and keep their time).
            AdaptedTime adapted = timing == PolicyGate.SendTiming.REPLY ? null
                    : adaptSendTime(engine, member, bundle, proposed, planned, now);
            Instant scheduledFor = adapted != null ? adapted.time() : planned;

            EngagementAction action = new EngagementAction();
            action.setEngineId(engine.getId());
            action.setMemberId(member.getId());
            action.setInstituteId(engine.getInstituteId());
            action.setPromptVersionId(prompt.getId());
            action.setActionType(validActionType(d.actionType()));
            action.setChannel(chosenChannel);
            action.setDraftBody(cap(d.draftBody()));
            action.setRationale(cap(adapted != null && adapted.note() != null
                    ? (nullToEmpty(d.rationale()) + " " + adapted.note()).trim() : d.rationale()));
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
            boolean emailTemplateOnly = "EMAIL".equals(action.getChannel()) && menu != null && menu.emailTemplates() != null;
            if (emailTemplateOnly) {
                attachEmailTemplate(action, d, engine);
            } else if ("EMAIL".equals(action.getChannel()) && d.subject() != null && !d.subject().isBlank()) {
                action.setVariablesJson(writeJson(Map.of(EngagementDispatcher.VAR_SUBJECT,
                        oneLine(d.subject(), MAX_SUBJECT_CHARS))));
            }
            // Phase 2 — AUTONOMOUS vs COPILOT. Auto-send (kind=SEND; the dispatch job fires it when
            // due) only when ALL hold: the channel's `auto` intent is set, the engine isn't killed,
            // it has GRADUATED (>= first_n human-approved sends), the draft is actually sendable
            // (WhatsApp needs an attached approved template), and it's not a dry run. Otherwise it's a
            // copilot TASK exactly as before. A dry run is always SIMULATED (never sends, never caps).
            boolean draftReady = (!"WHATSAPP".equals(chosenChannel) || action.getTemplateName() != null)
                    && (!emailTemplateOnly || action.getTemplateName() != null);
            boolean autoSend = !dryRun
                    && !everReplied(bundle, member)
                    && !humanTouchedSinceLastDecision(member)
                    && coordinated.hold() == null      // B5: counsellor active, follow-up today, do-not-automate
                    && chosenChannel != null
                    && channelAutoEnabled(engine, chosenChannel)
                    && !Boolean.TRUE.equals(engine.getAutoSendKilled())
                    && draftReady
                    && graduated(engine, chosenChannel);
            action.setKind(autoSend ? "SEND" : "TASK");
            action.setStatus(dryRun ? "SIMULATED" : "OPEN");
            EngagementLlmUsage.applyTo(d.usage(), action);
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
            // Deciding to wait costs tokens too; the daily report shows it.
            EngagementLlmUsage.applyTo(d.usage(), noOp);
            actionRepository.save(noOp);

            member.setConsecutiveNoOps((short) Math.min(member.getConsecutiveNoOps() + 1, 10));
        }

        return recordAndFinish(member, engine, d, fingerprint, heldLease, now);
    }

    /** The decision is made: stamp it and schedule the next look (shared by messages and CRM actions). */
    private boolean recordAndFinish(EngagementMember member, EngagementEngine engine, EngagementBrainClient.Decision d,
                                    String fingerprint, Instant heldLease, Instant now) {
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

    /**
     * True when the person has ever written back on WhatsApp or email (the ledger's lastReplyAt).
     * Once someone replies, a human owns the conversation: the engine still drafts, but as a task.
     */
    private boolean everReplied(DataPointRegistry.CohortBundle bundle, EngagementMember m) {
        JsonNode ledger = bundle.payloadsFor(m.getId()).get("ledger");
        if (ledger == null) return false;
        for (String ch : List.of("whatsapp", "email")) {
            JsonNode c = ledger.get(ch);
            if (c != null && !c.isNull() && parseInstant(c.path("lastReplyAt").asText(null)) != null) return true;
        }
        return false;
    }

    /**
     * A counsellor wrote a note, closed a follow-up or called the lead since the engine last decided:
     * this decision drafts for the inbox and never auto-sends, so the family does not hear from the
     * engine minutes after they spoke to a person.
     */
    static boolean humanTouchedSinceLastDecision(EngagementMember m) {
        return m.getHumanTouchAt() != null
                && (m.getLastDecidedAt() == null || m.getHumanTouchAt().isAfter(m.getLastDecidedAt()));
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    /**
     * B6 template-only email: attach the approved template the brain chose, rendered with its
     * variables, so the inbox shows exactly what will be sent. Left unattached (a task a person must
     * fix, never an auto-send) when the template is unknown, a variable is missing or it no longer
     * fits the brief.
     */
    private void attachEmailTemplate(EngagementAction action, EngagementBrainClient.Decision d, EngagementEngine engine) {
        String name = d.templateName();
        if (name == null || name.isBlank() || emailCatalog == null) {
            action.setErrorMessage("Template-only email: no approved template chosen.");
            return;
        }
        Map<String, String> vars = d.variables() != null ? d.variables() : Map.of();
        var rendered = emailCatalog.render(engine.getId(), engine.getInstituteId(), name, vars).orElse(null);
        if (rendered == null) {
            action.setErrorMessage("Template-only email: '" + oneLine(name, 80) + "' is not an approved template.");
            return;
        }
        if (!rendered.sendable()) {
            action.setErrorMessage("Template-only email not sendable: missing " + rendered.missingVariables()
                    + (rendered.problems() != null && !rendered.problems().isEmpty() ? "; " + rendered.problems() : ""));
            return;
        }
        Map<String, String> stored = new java.util.LinkedHashMap<>(vars);
        stored.put(EngagementDispatcher.VAR_EMAIL_TEMPLATE, rendered.templateId());
        stored.put(EngagementDispatcher.VAR_SUBJECT, oneLine(rendered.subject() != null ? rendered.subject() : "", MAX_SUBJECT_CHARS));
        action.setTemplateName(rendered.templateName());
        action.setVariablesJson(writeJson(stored));
        action.setDraftBody(cap(rendered.text()));
    }

    /** channels.maxTouches: the most messages one person gets from this engine; null = no limit. */
    private Integer maxTouches(EngagementEngine engine) {
        try {
            JsonNode n = objectMapper.readTree(engine.getChannels()).path("maxTouches");
            return n.canConvertToInt() && n.asInt() > 0 ? n.asInt() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String oneLine(String s, int max) {
        String t = s.replaceAll("[\\r\\n]+", " ").trim();
        return t.length() <= max ? t : t.substring(0, max);
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
        String tn = d.templateName() != null ? d.templateName().trim() : null;
        EngagementBrainClient.TemplateOption t = tn == null || tn.isEmpty() ? null : byName.get(tn);
        if (t == null && tn != null && !tn.isEmpty()) {
            // The model sometimes changes the case or spacing of an exact name: still its pick.
            for (Map.Entry<String, EngagementBrainClient.TemplateOption> e : byName.entrySet()) {
                if (e.getKey().trim().equalsIgnoreCase(tn)) { t = e.getValue(); break; }
            }
        }
        // With one approved template there is nothing to choose between: a missing name is not a pick.
        if (t == null && (tn == null || tn.isEmpty()) && byName.size() == 1) t = byName.values().iterator().next();
        if (t == null) {
            unattached(action, tn == null || tn.isEmpty()
                    ? "the AI did not choose an approved template"
                    : "the AI chose '" + tn + "', which is not an approved template");
            return;
        }
        Map<String, String> supplied = d.variables() != null ? d.variables() : Map.of();
        // Serialize ONLY the template's declared variables (drop any extras the model invented),
        // and require every one to be present and non-blank. The model may key a value by a
        // different case or by its position ("1", "2"): both name the same variable.
        Map<String, String> vars = new java.util.LinkedHashMap<>();
        List<String> names = t.variableNames();
        for (int i = 0; i < names.size(); i++) {
            String name = names.get(i);
            String v = supplied.get(name);
            if (v == null || v.isBlank()) {
                for (Map.Entry<String, String> e : supplied.entrySet()) {
                    String k = e.getKey() == null ? "" : e.getKey().replaceAll("[{}\\s]", "");
                    if (k.equalsIgnoreCase(name) || k.equals(String.valueOf(i + 1))) { v = e.getValue(); break; }
                }
            }
            if (v == null || v.isBlank()) {
                unattached(action, "the AI left out the value for '" + name + "' in template '" + t.name() + "'");
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

    /**
     * A WhatsApp task the model could not turn into a sendable template stays in the inbox for a
     * person; saying why replaces a silent log line nobody sees.
     */
    private void unattached(EngagementAction action, String why) {
        log.warn("Engine {}: WhatsApp task left without a template: {}", action.getEngineId(), why);
        action.setErrorMessage(cap("Can't be sent as is: " + why + "."));
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
        if (wokenSinceLastDecision(m)) return true;                       // CRM activity asked for a look
        if (hasUnansweredReply(bundle, m)) return true;                   // always
        if (!fingerprint.equals(m.getWakeFingerprint())) return true;     // state moved (banded)
        return cadenceElapsed(m, engine, now);                            // THE CLOCK — never remove
    }

    /**
     * When CRM activity woke this member, say so first, so the model answers what just happened
     * (a re-enquiry is someone who came back) rather than treating it as a routine check.
     */
    static Map<String, String> withWhyNow(EngagementMember m, Map<String, String> blocks) {
        if (!wokenSinceLastDecision(m) || m.getWakeReason() == null) return blocks;
        Map<String, String> out = new java.util.LinkedHashMap<>();
        out.put("why_now", "WHY NOW: " + whyNow(m.getWakeReason()) + " (at " + m.getWokenAt() + ")."
                + (humanTouchedSinceLastDecision(m)
                        ? " A counsellor was in touch since your last look: draft for them, do not repeat what they said."
                        : ""));
        out.putAll(blocks);
        return out;
    }

    private static String whyNow(String reason) {
        return switch (reason) {
            case EngagementWakeService.NOTE -> "a counsellor added a note on this lead";
            case EngagementWakeService.HUMAN_CALL -> "a counsellor called this lead";
            case EngagementWakeService.AI_CALL -> "an AI call with this lead just ended";
            case EngagementWakeService.CALL_ANALYZED -> "the analysis of a call with this lead is in";
            case EngagementWakeService.FOLLOWUP -> "a counsellor scheduled or closed a follow-up";
            case EngagementWakeService.FOLLOWUP_OVERDUE -> "a follow-up promised to this lead is overdue";
            case EngagementWakeService.STATUS -> "the lead's status changed";
            case EngagementWakeService.OWNER_CHANGED -> "the lead's counsellor changed";
            case EngagementWakeService.RE_ENQUIRY -> "this person came back and enquired again";
            case EngagementWakeService.LIST_CHANGED -> "the lead moved between lead lists";
            case EngagementWakeService.PAYMENT -> "a payment was received from this lead";
            default -> "CRM activity on this lead";
        };
    }

    /** B5: when the decision may only draft, say why, so the draft is written for the counsellor. */
    static Map<String, String> withCoordination(EngagementCoordinationService.Verdict v, Map<String, String> blocks) {
        String why = EngagementCoordinationService.explain(v.hold());
        if (why == null) return blocks;
        Map<String, String> out = new java.util.LinkedHashMap<>();
        out.put("coordination", "HOLD: " + why + ". Anything you propose goes to the counsellor's inbox as a"
                + " draft, not to the lead; prefer helping the counsellor over a new message.");
        out.putAll(blocks);
        return out;
    }

    /** A note, call outcome, status change... (B4) landed after the last decision began. */
    static boolean wokenSinceLastDecision(EngagementMember m) {
        return m.getWokenAt() != null
                && (m.getLastDecidedAt() == null || m.getWokenAt().isAfter(m.getLastDecidedAt()));
    }

    /**
     * How this decision's send is timed: an answer to someone who wrote in goes as soon as quiet
     * hours allow; a new person's first touch goes right away (unless the engine waits for its send
     * window); everything else is planned outreach and waits for the engine's send window.
     */
    private PolicyGate.SendTiming sendTiming(EngagementEngine engine, EngagementMember m,
                                             DataPointRegistry.CohortBundle bundle) {
        if (hasUnansweredReply(bundle, m)) return PolicyGate.SendTiming.REPLY;
        if (m.getLastDecidedAt() == null
                && EngagementSendSchedule.of(engine.getQuietHours(), objectMapper).firstTouchImmediate()) {
            return PolicyGate.SendTiming.ANYTIME;
        }
        return PolicyGate.SendTiming.PLANNED;
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

    /** A planned send moved to another time of day; note explains it when the time just changed. */
    private record AdaptedTime(Instant time, String note) {}

    /**
     * Adapts this person's send time (see {@link EngagementAdaptiveSendTime}): the time of day the
     * engine remembered for them, or a new one when the last three sends went unanswered at the same
     * hour. null keeps {@code planned}. The remembered time is dropped when the person writes back or
     * the admin changes the engine's send time, so the engine's own schedule applies again.
     */
    private AdaptedTime adaptSendTime(EngagementEngine engine, EngagementMember member,
                                      DataPointRegistry.CohortBundle bundle, Instant proposed,
                                      Instant planned, Instant now) {
        EngagementSendSchedule schedule = EngagementSendSchedule.of(engine.getQuietHours(), objectMapper);
        ZoneId zone = schedule.zone();
        Instant lastReply = latestReply(bundle, member);

        Integer rememberedHour = null;
        JsonNode pref = sendPreference(member);
        if (pref != null) {
            Instant since = parseInstant(pref.path("since").asText(null));
            Integer engineHour = pref.hasNonNull("engineHour") ? pref.get("engineHour").asInt() : null;
            boolean answered = lastReply != null && since != null && lastReply.isAfter(since);
            if (pref.path("hour").canConvertToInt() && !answered && Objects.equals(engineHour, schedule.sendHour())) {
                rememberedHour = pref.get("hour").asInt();
            } else {
                forgetSendPreference(member, now);
            }
        }

        List<Instant> sent = actionRepository.recentSendTimes(member.getId(),
                PageRequest.of(0, EngagementAdaptiveSendTime.STREAK));
        OptionalInt stuck = EngagementAdaptiveSendTime.stuckHour(sent, lastReply, zone);
        if (stuck.isPresent() && (rememberedHour == null || rememberedHour == stuck.getAsInt())) {
            int from = stuck.getAsInt();
            IntPredicate allowed = h -> {
                Instant at = EngagementAdaptiveSendTime.atHour(planned, h, zone, proposed);
                return policyGate.clampToAllowedWindow(engine, at).equals(at);
            };
            OptionalInt to = EngagementAdaptiveSendTime.nextHour(from, allowed);
            if (to.isPresent()) {
                rememberSendPreference(member, to.getAsInt(), schedule.sendHour(), now);
                String note = "Send time changed: %d messages at %02d:00 got no reply, so this one goes at %02d:00."
                        .formatted(EngagementAdaptiveSendTime.STREAK, from, to.getAsInt());
                return new AdaptedTime(policyGate.scheduleSend(engine,
                        EngagementAdaptiveSendTime.atHour(planned, to.getAsInt(), zone, proposed),
                        PolicyGate.SendTiming.ANYTIME), note);
            }
        }
        if (rememberedHour != null && planned.atZone(zone).getHour() != rememberedHour) {
            return new AdaptedTime(policyGate.scheduleSend(engine,
                    EngagementAdaptiveSendTime.atHour(planned, rememberedHour, zone, proposed),
                    PolicyGate.SendTiming.ANYTIME), null);
        }
        return null;
    }

    /** The person's latest reply on WhatsApp or email (the ledger), or null when they never wrote. */
    private Instant latestReply(DataPointRegistry.CohortBundle bundle, EngagementMember m) {
        JsonNode ledger = bundle.payloadsFor(m.getId()).get("ledger");
        if (ledger == null) return null;
        Instant latest = null;
        for (String ch : List.of("whatsapp", "email")) {
            JsonNode c = ledger.get(ch);
            if (c == null || c.isNull()) continue;
            Instant reply = parseInstant(c.path("lastReplyAt").asText(null));
            if (reply != null && (latest == null || reply.isAfter(latest))) latest = reply;
        }
        return latest;
    }

    private ObjectNode memoryOf(EngagementMember m) {
        try {
            JsonNode n = m.getMemoryJson() == null ? null : objectMapper.readTree(m.getMemoryJson());
            if (n != null && n.isObject()) return (ObjectNode) n;
        } catch (Exception ignored) {
            // unreadable memory: start from an empty one, never fail a decision over it
        }
        return objectMapper.createObjectNode();
    }

    private JsonNode sendPreference(EngagementMember m) {
        JsonNode pref = memoryOf(m).get("sendPref");
        return pref != null && pref.isObject() ? pref : null;
    }

    private void rememberSendPreference(EngagementMember m, int hour, Integer engineHour, Instant now) {
        ObjectNode pref = objectMapper.createObjectNode();
        pref.put("hour", hour);
        if (engineHour != null) pref.put("engineHour", engineHour);
        pref.put("since", now.toString());
        memberRepository.setSendPreference(m.getId(), pref.toString(), now);
        ObjectNode memory = memoryOf(m);
        memory.set("sendPref", pref);
        m.setMemoryJson(memory.toString()); // a later save of this member must not put the old memory back
    }

    private void forgetSendPreference(EngagementMember m, Instant now) {
        memberRepository.clearSendPreference(m.getId(), now);
        ObjectNode memory = memoryOf(m);
        memory.remove("sendPref");
        m.setMemoryJson(memory.toString());
    }

    private boolean cadenceElapsed(EngagementMember m, EngagementEngine engine, Instant now) {
        // Backoff stretches the cadence for serial no-ops (base * 2^min(noOps,5), capped at 30d)
        // — but the clock always ticks, so a dormant member still gets re-engaged on schedule.
        long base = Math.max(engine.getCadenceHours(), 1);
        long stretched = base * (1L << Math.min(m.getConsecutiveNoOps(), 5));
        long cappedHours = Math.min(stretched, Duration.ofDays(30).toHours());
        return m.getLastDecidedAt().plus(Duration.ofHours(cappedHours)).isBefore(now);
    }

    /** Contact cap reached: try tomorrow. (A gate sleep goes through recordGateSleep instead.) */
    private void rescheduleCapped(EngagementMember m, Instant now) {
        m.setNextActionAt(now.plus(Duration.ofDays(1)));
        memberRepository.save(m);
    }

    /**
     * QUANTIZED fingerprint — bands, never raw values. Raw values (completion %, last-activity
     * timestamps) move every session for exactly the members worth messaging, so a raw digest
     * never skips where it matters: the saving would anti-correlate with the value.
     * NOTE: no prompt version in here — one admin edit must not re-decide every member at once.
     */
    String quantizedFingerprint(Map<String, JsonNode> payloads) {
        StringBuilder sb = legacyFingerprintText(payloads);
        crmBands(payloads, sb);
        return sha256(sb.toString());
    }

    /** The fingerprint as computed before the CRM bands, so a stored one can be recognised. */
    String legacyFingerprint(Map<String, JsonNode> payloads) {
        return sha256(legacyFingerprintText(payloads).toString());
    }

    /**
     * B4 safety net for a missed wake: what a person last did on the lead. These are event times,
     * not "time since", so they only change when something new happens: the newest staff timeline
     * entry, the open follow-ups (count, any overdue) and the last closed one, the newest call and
     * whether its analysis is in. Only present when the engine reads those data points.
     */
    static void crmBands(Map<String, JsonNode> payloads, StringBuilder sb) {
        JsonNode timeline = payloads.get("crm_timeline");
        if (timeline != null) {
            String newestStaff = "";
            for (JsonNode e : timeline.path("events")) {
                String at = e.path("at").asText("");
                if ("STAFF".equals(e.path("by").asText()) && at.compareTo(newestStaff) > 0) newestStaff = at;
            }
            sb.append("|staff:").append(newestStaff);
        }
        JsonNode followups = payloads.get("crm_followups");
        if (followups != null) {
            int open = 0;
            boolean overdue = false;
            for (JsonNode o : followups.path("open")) {
                open++;
                overdue |= o.path("overdue").asBoolean(false);
            }
            sb.append("|fu:").append(countBand(open)).append(overdue ? "/late" : "")
              .append("/closed:").append(followups.path("lastClosed").path("closedAt").asText(""));
        }
        JsonNode calls = payloads.get("ai_calls");
        if (calls != null) {
            String newestAt = "";
            String analysis = "";
            for (JsonNode c : calls.path("calls")) {
                String at = c.path("at").asText("");
                if (at.compareTo(newestAt) > 0) {
                    newestAt = at;
                    analysis = c.path("analysis").asText("");
                }
            }
            sb.append("|call:").append(newestAt).append("/").append(analysis);
        }
    }

    private StringBuilder legacyFingerprintText(Map<String, JsonNode> payloads) {
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
        return sb;
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

    /**
     * An engine that places AI calls must see how its calls went, or a call nobody picked up is
     * invisible and the next decision repeats it or waits. The calls data point is added to whatever
     * the admin chose; the ledger (messages) is always on.
     */
    private List<String> withCallHistory(EngagementEngine engine, List<String> chosen) {
        if (crmActions == null || !crmActions.aiCallChannelOn(engine) || chosen.contains("ai_calls")) return chosen;
        List<String> out = new ArrayList<>(chosen);
        out.add("ai_calls");
        return out;
    }

    private List<String> parseDataPoints(EngagementEngine engine) {
        try {
            List<String> chosen = objectMapper.readValue(engine.getDataPoints(),
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            return withCallHistory(engine, chosen);
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
