package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The opt-in AI auto-reply (design D9). For an inbound WhatsApp reply on an autoReply-enabled engine
 * within the 24h window, the reply brain decides ANSWER vs ESCALATE and drafts either way:
 *   - ANSWER   → a kind=REPLY action, auto-claimed + dispatched (free-form session send).
 *   - ESCALATE → a kind=REPLY OPEN task in the inbox (uncertainty / anger / money), for a human.
 *
 * Safety layers on the ONLY autonomous send in the system (each independent of the others):
 *   1. At-most-once per MESSAGE: claimReplyWamidForPhone stamps the wamid on EVERY member matching
 *      the subject in one atomic UPDATE, so the answer count for a message is exactly one even when
 *      candidate ordering flips between sweeps.
 *   2. Lease claim: the member's scheduler lease is taken before the (seconds-long) LLM call, so the
 *      concurrent normal sweep can't double-handle the same reply in that window.
 *   3. Deterministic tripwire: money/anger/legal keywords in the inbound OR drafted text force
 *      ESCALATE regardless of the model's verdict — classifier safety never rests on the LLM alone.
 *   4. Output guard: a drafted reply carrying a link not present in the engine's brief escalates
 *      (an injected/hallucinated URL must never auto-send).
 *   5. Truncation guard: a reply that looks truncated (legacy 100-char previews) escalates — never
 *      auto-answer a message we can only partially read.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementReplyResponder {

    private static final String ACTOR = "ENGAGEMENT_ENGINE";
    private static final int MAX_DRAFT_CHARS = 4000;

    /**
     * Deterministic escalate-now tripwire (design D9: money/anger/legal never auto-answer). Word-ish
     * boundaries; matched case-insensitively against BOTH the inbound reply and the drafted answer.
     * en + common Hinglish transliterations. Deliberately conservative — a false trip just means a
     * human answers, which is the safe direction.
     */
    private static final Pattern ESCALATE_TRIPWIRE = Pattern.compile(
            "(?i)(?:^|[^\\p{L}])(refunds?|fees?|payments?|pay(?:ing|s)?|paid|pricing|prices?|discounts?|"
            + "invoices?|bills?|billing|charges?|charged|money|rupees?|rs\\.?|emi|install?ments?|"
            + "cancel(?:s|led|ling|lation)?|complain(?:s|ts?|ed|ing)?|"
            + "angry|furious|frustrated|worst|scam|fraud|cheat(?:ed|s)?|legal|lawyer|court|consumer|sue|"
            + "paisa|paise|wapas)(?:$|[^\\p{L}])|₹");

    /**
     * An unmistakable request to stop (design §10: opt-out must never be auto-answered). The whole
     * message is a STOP-style keyword, or it carries an explicit phrase anywhere. en + Hinglish.
     * Kept narrow on purpose: this opts the person out of every engine, so "I had to stop studying"
     * must not match — that case is caught by STOP_MENTION and goes to a human instead.
     */
    static final Pattern OPT_OUT = Pattern.compile(
            "(?i)^\\W*(stop|stop all|unsubscribe|opt[ -]?out|band karo|mat bhejo|cancel)\\W*$"
            + "|(?:^|[^\\p{L}])(?:unsubscribe|opt[ -]?out"
            + "|stop (?:messaging|sending|texting|contacting|calling|these|this)"
            + "|(?:don'?t|dont|do not|never) (?:message|msg|text|contact|call|disturb) me"
            + "|remove (?:me|my number)"
            + "|(?:message|messages|msg|msgs|sms) (?:mat|band|na) (?:karo|kijiye|bhejo|bhejiye)"
            + "|mat bhejo|band karo|band kar do)(?:$|[^\\p{L}])");

    /** Mentions stopping or disinterest without an explicit opt-out: a human reads it, never the bot. */
    static final Pattern STOP_MENTION = Pattern.compile(
            "(?i)(?:^|[^\\p{L}])(stop|stopped|not interested|no interest|leave me|spam)(?:$|[^\\p{L}])");

    /**
     * Links in a drafted auto-answer: schemed URLs, www.-prefixed, AND bare domain/path tokens
     * (LLMs commonly emit "vacademy.io/join" without a scheme). Labels must be >=2 chars so "i.e"
     * / "e.g" don't trip. A false trip merely escalates — the safe direction.
     */
    private static final Pattern URL_IN_REPLY = Pattern.compile(
            "(?i)(?:https?://|www\\.)\\S+|\\b[a-z0-9-]{2,}(?:\\.[a-z0-9-]{2,})+(?:/\\S*)?");

    private final EngagementMemberRepository memberRepository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementPromptVersionRepository promptRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementReplyBrain replyBrain;
    private final EngagementDispatcher dispatcher;

    @Value("${engagement.task.expire-hours:72}")
    private int taskExpireHours;

    @Value("${engagement.sweep.lease-minutes:15}")
    private int leaseMinutes;

    /** Handle one inbound reply. Returns true if it produced a reply action (answered or escalated). */
    public boolean handleReply(String instituteId, String phone, String replyText, String wamid) {
        if (wamid == null || wamid.isBlank()) return false; // no stable id → can't dedup → skip
        String phone10 = last10(phone);
        if (phone10 == null || replyText == null || replyText.isBlank()) return false;

        Instant now = Instant.now();
        List<EngagementMemberRepository.AutoReplyCandidate> candidates =
                memberRepository.findAutoReplyCandidates(instituteId, phone10, now);
        if (candidates.isEmpty()) return false;

        // THE at-most-once gate on this MESSAGE: an (institute, wamid) set insert — exactly one
        // caller across sweeps/replicas/interleavings ever wins. The per-member stamp below is a
        // single slot and can be re-claimed when the member set changes between overlapping sweeps;
        // the set cannot.
        if (memberRepository.claimHandledReply(instituteId, wamid, now) == 0) return false;
        // Secondary marker on all matching members (observability + legacy dedup path).
        memberRepository.claimReplyWamidForPhone(instituteId, phone10, wamid, now);

        // Answer with ONE engine — the most recently engaged (query orders by last_decided_at DESC).
        EngagementMemberRepository.AutoReplyCandidate cand = candidates.get(0);
        try {
            return respond(instituteId, phone10, replyText, cand, now);
        } catch (RuntimeException e) {
            // The wamid is already claimed, so no later sweep re-reads this message. Surface it through
            // the unanswered-reply wake (a human task within minutes) rather than losing it.
            memberRepository.markReplyUnhandled(cand.getMemberId(), now.plus(Duration.ofMinutes(leaseMinutes)), now);
            throw e;
        }
    }

    private boolean respond(String instituteId, String phone10, String replyText,
                            EngagementMemberRepository.AutoReplyCandidate cand, Instant now) {
        EngagementEngine engine = engineRepository.findById(cand.getEngineId()).orElse(null);
        if (engine == null) {
            // We consumed the wamid but can't answer: nudge the member due so the normal sweep
            // surfaces the reply to a human soon — never let it sit dark until cadence elapses.
            memberRepository.markReplyUnhandled(cand.getMemberId(), now.plus(Duration.ofMinutes(leaseMinutes)), now);
            return false;
        }
        EngagementPromptVersion prompt = promptRepository
                .findTopByEngineIdAndStatusOrderByVersionDesc(engine.getId(), "ACTIVE").orElse(null);

        // They asked us to stop: no AI answer, and no engine of this institute messages them again.
        // Before this, "please stop messaging me" could be auto-answered and the member stayed ACTIVE,
        // so the proactive templates kept coming (the WABA-quality risk in design §10).
        if (OPT_OUT.matcher(replyText).find()) {
            int stopped = memberRepository.optOutByPhone(instituteId, phone10, now);
            EngagementAction note = new EngagementAction();
            note.setEngineId(engine.getId());
            note.setMemberId(cand.getMemberId());
            note.setInstituteId(instituteId);
            note.setPromptVersionId(prompt != null ? prompt.getId() : null);
            note.setKind("REPLY");
            note.setActionType("SEND_MESSAGE");
            note.setChannel("WHATSAPP");
            note.setStatus("OPEN");
            note.setRationale(cap("Asked to stop messages — opted out of " + stopped
                    + " engine membership(s) for this number. No auto-reply was sent. Their message: " + replyText));
            note.setPriority(BigDecimal.valueOf(85));
            note.setScheduledFor(now);
            note.setExpiresAt(now.plus(Duration.ofHours(taskExpireHours)));
            actionRepository.save(note);
            log.info("Opt-out reply for member {}: {} membership(s) opted out", cand.getMemberId(), stopped);
            return true;
        }
        // Hold the member for the LLM window. The hold fails only if a proactive decision holds them
        // right now; answering as well would send two messages at once (the old lease claim was
        // ignored when it failed), so a human answers this one instead.
        if (memberRepository.holdForReply(cand.getMemberId(), now, now.plus(Duration.ofMinutes(leaseMinutes))) == 0) {
            createEscalationTask(engine, cand, prompt, null, now, "concurrent-decision",
                    "A proactive message for this person was being decided at the same moment. Answer this "
                    + "reply manually so they do not get two messages. Their message: " + replyText);
            return true;
        }

        String compiled = prompt != null && prompt.getCompiledText() != null
                ? prompt.getCompiledText() : (engine.getObjective() != null ? engine.getObjective() : engine.getName());

        EngagementReplyBrain.ReplyDecision decision;
        try {
            decision = replyBrain.decide(engine, compiled, replyText);
        } catch (Exception e) {
            // Brain failure must not swallow the reply: leave it as an escalated task so a human sees it.
            log.warn("Reply brain failed for engine {} — escalating to a human task: {}", engine.getId(), e.getMessage());
            decision = new EngagementReplyBrain.ReplyDecision("ESCALATE", null,
                    "Auto-reply unavailable — please answer manually.", "other");
        }

        // Deterministic server-side backstops — they override an ANSWER verdict, never trust it alone.
        if (decision.isAnswer()) {
            String override = escalationOverride(replyText, decision.reply(), compiled);
            if (override != null) {
                log.info("Auto-reply overridden to ESCALATE for member {}: {}", cand.getMemberId(), override);
                decision = new EngagementReplyBrain.ReplyDecision("ESCALATE", decision.reply(), override, "tripwire");
            }
        }

        EngagementAction action = new EngagementAction();
        action.setEngineId(engine.getId());
        action.setMemberId(cand.getMemberId());
        action.setInstituteId(instituteId);
        action.setPromptVersionId(prompt != null ? prompt.getId() : null);
        action.setKind("REPLY");
        action.setActionType("SEND_MESSAGE");
        action.setChannel("WHATSAPP");
        action.setStatus("OPEN");
        action.setDraftBody(cap(decision.reply()));
        action.setRationale(cap(decision.isAnswer() ? decision.reason()
                : "Escalated (" + (decision.escalationType() != null ? decision.escalationType() : "review") + "): "
                        + decision.reason()));
        // Escalations rank above auto-answers in the human inbox — money/anger/uncertainty need eyes.
        action.setPriority(BigDecimal.valueOf(decision.isAnswer() ? 60 : 85));
        action.setScheduledFor(now);
        action.setExpiresAt(now.plus(Duration.ofHours(taskExpireHours)));
        action = actionRepository.save(action);

        boolean settled = false; // true = answered (SENT) or a human-visible task exists for this reply
        if (decision.isAnswer()) {
            // NOTE (intentional, product decision 2026-07-18): auto-replies are NOT credit-gated or
            // charged — unlike the proactive dispatch path (EngagementDispatchJob.dispatchOne, which
            // runs the affordability gate + per-message deduct + circuit breaker). These are free-form
            // WhatsApp SESSION replies (free on Meta's side, inside the user-opened 24h window), and
            // gating them would ghost a paying customer's own question when the institute's AI credits
            // run dry. The kill switch (auto_send_killed, honored via findAutoReplyCandidates) is the
            // emergency stop for this path. Do NOT "fix" this asymmetry by wiring a CreditClient here
            // without a deliberate pricing decision — the divergence is by design.
            // Auto-send: claim (OPEN→DISPATCHING) then dispatch the free-form reply.
            if (actionRepository.claimForDispatch(action.getId(), instituteId, now) == 1) {
                EngagementAction claimed = actionRepository.findById(action.getId()).orElse(action);
                try {
                    EngagementAction result = dispatcher.dispatchClaimed(claimed, null, ACTOR);
                    if ("SENT".equals(result.getStatus())) {
                        settled = true;
                    } else if ("FAILED".equals(result.getStatus())) {
                        // Unknown-outcome failure. Never auto-retry (the send may have landed) — but
                        // never leave it invisible either: create a DETERMINISTIC escalation task so
                        // a human always sees this reply, regardless of the sweep or the LLM's mood.
                        createEscalationTask(engine, cand, prompt, decision.reply(), now, "send-failure",
                                "Auto-answer failed to send (attempt logged as FAILED, correlation "
                                + action.getId() + "). Check the ledger before re-sending, then reply manually.");
                        settled = true;
                    }
                } catch (VacademyException rejected) {
                    // SendRejected (window closed / too long / no phone): the action was returned to
                    // OPEN — already a visible inbox task a human can fix and send. That IS the
                    // resolution for this reply.
                    log.info("Auto-reply rejected pre-send for member {} — task left OPEN: {}",
                            cand.getMemberId(), rejected.getMessage());
                    settled = true;
                } catch (Exception e) {
                    log.warn("Auto-reply send failed for member {}: {}", cand.getMemberId(), e.getMessage());
                }
            }
            // claimForDispatch == 0: someone else grabbed the just-created task — leave unsettled;
            // the nudge below keeps the reply alive if they don't finish.
        } else {
            settled = true; // the escalated OPEN task IS the resolution — a human answers via /send
        }

        if (settled) {
            // Stamp the member as freshly decided so the normal sweep doesn't ALSO wake it on this
            // same reply and create a duplicate reply-response task.
            long cadence = engine.getCadenceHours() != null ? Math.max(engine.getCadenceHours(), 1) : 72;
            memberRepository.markReplyHandled(cand.getMemberId(), now, now.plus(Duration.ofHours(cadence)));
        } else {
            // Unsettled: pull the member due soon WITHOUT advancing last_decided_at. Crucial when the
            // member wasn't due (follow-up reply inside an open window → no promote, no lease): the
            // unanswered-reply wake then surfaces a HUMAN task in ~minutes, not at cadence (days).
            memberRepository.markReplyUnhandled(cand.getMemberId(), now.plus(Duration.ofMinutes(leaseMinutes)), now);
        }
        return true;
    }

    /** A deterministic, human-visible escalation task for a reply the auto-send could not settle. */
    private void createEscalationTask(EngagementEngine engine,
                                      EngagementMemberRepository.AutoReplyCandidate cand,
                                      EngagementPromptVersion prompt, String suggestedReply,
                                      Instant now, String label, String reason) {
        EngagementAction task = new EngagementAction();
        task.setEngineId(engine.getId());
        task.setMemberId(cand.getMemberId());
        task.setInstituteId(engine.getInstituteId());
        task.setPromptVersionId(prompt != null ? prompt.getId() : null);
        task.setKind("REPLY");
        task.setActionType("SEND_MESSAGE");
        task.setChannel("WHATSAPP");
        task.setStatus("OPEN");
        task.setDraftBody(cap(suggestedReply));
        task.setRationale(cap("Escalated (" + label + "): " + reason));
        task.setPriority(BigDecimal.valueOf(85));
        task.setScheduledFor(now);
        task.setExpiresAt(now.plus(Duration.ofHours(taskExpireHours)));
        actionRepository.save(task);
    }

    /** Non-null reason = force ESCALATE despite an ANSWER verdict. Deterministic, no LLM involved. */
    private String escalationOverride(String inbound, String draftedReply, String brief) {
        // Legacy truncated previews (100 chars + "..."): never auto-answer a partially-read message.
        if (inbound.length() >= 100 && inbound.endsWith("...")) {
            return "Reply text appears truncated — a human should read the full message.";
        }
        if (STOP_MENTION.matcher(inbound).find()) {
            return "Reply may be asking to stop or saying they are not interested — human review required.";
        }
        if (ESCALATE_TRIPWIRE.matcher(inbound).find()) {
            return "Reply mentions money/anger/legal terms — human review required.";
        }
        if (draftedReply != null && ESCALATE_TRIPWIRE.matcher(draftedReply).find()) {
            return "Drafted answer touches money/anger/legal terms — human review required.";
        }
        if (draftedReply != null) {
            // Any link in the auto-send must literally appear in the engine's brief — an invented or
            // injected URL never goes out autonomously.
            Matcher m = URL_IN_REPLY.matcher(draftedReply);
            String briefLower = brief != null ? brief.toLowerCase(Locale.ROOT) : "";
            while (m.find()) {
                // Strip trailing punctuation AND WhatsApp/markdown formatting chars (*_~'">) so a
                // brief link the model wrapped in bold ("*https://…*") doesn't false-trip.
                String url = m.group().replaceAll("[)\\].,;:!?*_~'\">]+$", "");
                if (!briefLower.contains(url.toLowerCase(Locale.ROOT))) {
                    return "Drafted answer contains a link not present in the engine's brief.";
                }
            }
        }
        return null;
    }

    private static String last10(String phone) {
        if (phone == null) return null;
        String d = phone.replaceAll("[^0-9]", "");
        if (d.isEmpty()) return null;
        return d.length() <= 10 ? d : d.substring(d.length() - 10);
    }

    private static String cap(String s) {
        if (s == null) return null;
        return s.length() <= MAX_DRAFT_CHARS ? s : s.substring(0, MAX_DRAFT_CHARS);
    }
}
