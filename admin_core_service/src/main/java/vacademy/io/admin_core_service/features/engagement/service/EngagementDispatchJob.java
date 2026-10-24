package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.common.exceptions.VacademyException;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Phase 2 — the autonomous dispatcher. The decision service creates a {@code kind=SEND} action when
 * an engine has graduated to autonomy; THIS job fires it when due. Decoupling decision from dispatch
 * is what lets the brain schedule a send for later (and lets us re-check the kill switch + credits
 * with FRESH state at send time, not stale decision-time state).
 *
 * Order per send (all guards fail SAFE — a doubtful send becomes a copilot task, never a wrong send):
 *   1. re-check engine liveness + kill switch + channel `auto` intent → demote to TASK if revoked
 *   2. affordability (real balance, fail-CLOSED) → demote to TASK if unaffordable/unreachable
 *   3. claimForDispatch CAS (send-once) → dispatchClaimed → SENT/FAILED
 *   4. on SENT: charge one credit (idempotency = action id) and stamp billed
 * A separate reconciliation pass re-charges any SENT send whose deduct HTTP call was lost.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementDispatchJob {

    private static final String ACTOR = "ENGAGEMENT_ENGINE";
    private static final String CREDIT_REQUEST_TYPE = "engagement_message";
    /** ai_use_case_catalog key the usage-limit gate is asked about. */
    static final String USE_CASE = "engagement_message";
    /**
     * A send an AI usage limit refused is moved this far out (or to the limit's reset, if
     * sooner) rather than retried every tick: left due, it would be re-selected each cycle
     * and, the scan being global and oldest-first, crowd out other institutes' sends. The
     * 72 h expiry still applies.
     */
    static final Duration LIMIT_RETRY_DELAY = Duration.ofMinutes(30);

    private final EngagementActionRepository actionRepository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final PolicyGate policyGate;
    private final EngagementDispatcher dispatcher;
    private final CreditClient creditClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${engagement.dispatch.batch:100}")
    private int batch;

    @Value("${engagement.credits.per-message:1.0}")
    private BigDecimal perMessageCredits;

    /** Circuit breaker: if an institute has this many UNBILLED-but-SENT messages (its full standing
     *  backlog, not a recent window), its charge path is failing — stop auto-sending for it (demote to
     *  copilot) until reconciliation actually clears them (credits_billed_at set), not until they age. */
    @Value("${engagement.credits.max-unbilled:25}")
    private int maxUnbilled;

    @Scheduled(fixedDelayString = "${engagement.dispatch.delay-ms:120000}")
    @SchedulerLock(name = "EngagementAutoDispatch", lockAtMostFor = "PT15M", lockAtLeastFor = "PT10S")
    public void dispatch() {
        Instant now = Instant.now();
        List<EngagementAction> due = actionRepository.findDueAutoSends(now, batch);
        int sent = 0;
        for (EngagementAction action : due) {
            try {
                if (dispatchOne(action, now)) sent++;
            } catch (Exception e) {
                log.error("Auto-dispatch failed for action {}: {}", action.getId(), e.getMessage());
            }
        }
        int reconciled = reconcileBilling(now);
        if (sent > 0 || reconciled > 0) {
            log.info("Auto-dispatch: {} sent, {} unbilled sends reconciled", sent, reconciled);
        }
    }

    private boolean dispatchOne(EngagementAction action, Instant now) {
        String instituteId = action.getInstituteId();
        EngagementEngine engine = engineRepository.findById(action.getEngineId()).orElse(null);

        // 1. Autonomy still granted? A mid-flight kill / channel-auto-off / non-live engine demotes
        // this to a human copilot task (never a wrong autonomous send). A paused/archived engine is
        // left OPEN to be re-evaluated on resume or expired by the reaper.
        if (engine == null) {
            return false; // engine vanished; the expiry reaper cleans up the orphan SEND
        }
        if (!"ACTIVE".equals(engine.getStatus())) {
            return false; // paused/archived/dry-run — leave OPEN; reaper expires if it goes stale
        }
        // The person, re-checked at send time and before autonomy: a SEND is scheduled up to
        // a week ahead, so they may have opted out or left the audience since the decision. Withdrawn,
        // not demoted — a copilot task would invite a human to message someone who said no.
        EngagementMember member = memberRepository.findById(action.getMemberId()).orElse(null);
        if (member == null || !"ACTIVE".equals(member.getStatus())) {
            actionRepository.withdrawDueSend(action.getId(),
                    "Not sent: this person is no longer active in the engine (opted out, paused or left the audience).",
                    now);
            return false;
        }
        if (member.getUserId() != null
                && policyGate.optedOutUserIds(instituteId, List.of(member.getUserId())).contains(member.getUserId())) {
            actionRepository.withdrawDueSend(action.getId(), "Not sent: this person opted out after the decision.", now);
            return false;
        }
        if (Boolean.TRUE.equals(engine.getAutoSendKilled())
                || !channelAutoEnabled(engine, action.getChannel())) {
            actionRepository.demoteSendToTask(action.getId(),
                    "Autonomy off for this channel — sent to the inbox for review.", now);
            return false;
        }

        // 1b. The clock: an engine resumed at night must not fire its past-due SENDs in quiet hours.
        Instant allowedAt = policyGate.clampToAllowedWindow(engine, now);
        if (allowedAt.isAfter(now)) {
            actionRepository.rescheduleDueSend(action.getId(), allowedAt, now);
            return false;
        }

        // 2a. Circuit breaker on CHARGE failure. The balance read (plain) and the deduct (internal-
        // token-gated) are different endpoints, so /deduct can fail persistently while /balance still
        // reads > 0 — the affordability gate below can't see that. A pile of recently-SENT-but-UNBILLED
        // messages IS that signal: stop auto-sending for this institute (demote to copilot) so a broken
        // charge path can't silently bleed unbounded unbilled sends. Reconciliation clears the backlog.
        long unbilled = actionRepository.countUnbilledSentForInstitute(instituteId);
        if (unbilled >= maxUnbilled) {
            actionRepository.demoteSendToTask(action.getId(),
                    "Billing is failing for this institute — auto-send paused; sent to the inbox for review.", now);
            return false;
        }

        // 2b. Affordability — fail CLOSED (hasActiveCredits returns false when the balance can't be
        // read), so an unreachable credits service never lets an autonomous send slip through unpriced.
        boolean affordable;
        try {
            affordable = creditClient.hasActiveCredits(instituteId);
        } catch (Exception e) {
            affordable = false;
        }
        if (!affordable) {
            actionRepository.demoteSendToTask(action.getId(),
                    "Out of credits — sent to the inbox so you can top up or send manually.", now);
            return false;
        }

        // 2c. AI usage limits (institute policy in ENFORCE): skip this cycle, try again later.
        // No limits on for the institute = no call at all; any gate failure = allowed.
        AuthorizeResult limit = authorizeSend(instituteId, action);
        if (AuthorizeResult.blocks(limit)) {
            Instant retryAt = now.plus(LIMIT_RETRY_DELAY);
            Instant resetsAt = limit.resetsAt();
            if (resetsAt != null && resetsAt.isAfter(now) && resetsAt.isBefore(retryAt)) {
                retryAt = resetsAt;
            }
            log.info("Auto-send for action {} skipped: AI usage limit reached for institute {}; retry at {}",
                    action.getId(), instituteId, retryAt);
            actionRepository.rescheduleDueSend(action.getId(), retryAt, now);
            return false;
        }

        // 3. Send-once claim, then dispatch.
        // Stamped with the claim time, not the batch start: in a slow batch the batch start is already
        // past the reaper's staleness cut-off, and it flipped rows to FAILED while they were sending.
        if (actionRepository.claimForDispatch(action.getId(), instituteId, Instant.now()) != 1) {
            return false; // another replica grabbed it
        }
        EngagementAction claimed = actionRepository.findById(action.getId()).orElse(action);
        EngagementAction result;
        try {
            result = dispatcher.dispatchClaimed(claimed, null, ACTOR);
        } catch (VacademyException rejected) {
            // Pre-send rejection (no phone/email on file, AI_CALL is task-only, window closed): nothing
            // was sent and the dispatcher reset the row to OPEN. Left alone it would churn every tick for
            // the full 72h expiry — and since findDueAutoSends is global + ordered by scheduled_for, a
            // pile of stuck rejects would starve every institute's legitimate sends. Demote to a visible
            // copilot TASK so a human can fix the contact and send manually. This condition won't
            // self-resolve, so retrying is pointless.
            actionRepository.demoteSendToTask(action.getId(),
                    "Couldn't auto-send: " + rejected.getMessage(), now);
            return false;
        } catch (Exception e) {
            // Unknown outcome — the dispatcher already settled the row to FAILED (visible in the inbox's
            // Failed filter, reopenable), never re-selected by findDueAutoSends (status != OPEN).
            log.warn("Auto-send dispatch for action {} did not complete: {}", action.getId(), e.getMessage());
            return false;
        }

        // 4. Charge only an actually-SENT message (a FAILED send is never charged).
        if ("SENT".equals(result.getStatus())) {
            charge(instituteId, action, now);
            return true;
        }
        return false;
    }

    /** Charge one credit for a sent message; stamp billed on success. Idempotency key = action id. */
    private void charge(String instituteId, EngagementAction action, Instant now) {
        try {
            boolean ok = creditClient.deductPrecomputed(
                    instituteId, CREDIT_REQUEST_TYPE,
                    "Engagement Engine autonomous " + action.getChannel() + " send",
                    perMessageCredits, action.getId(), sendMetering(action));
            if (ok) {
                actionRepository.markBilled(action.getId(), now);
            } else {
                log.warn("Credit charge NOT acked for sent action {} — reconciliation will retry", action.getId());
            }
        } catch (Exception e) {
            // The message already went out; leave credits_billed_at NULL so reconciliation re-charges.
            log.warn("Credit charge threw for sent action {} — reconciliation will retry: {}",
                    action.getId(), e.getMessage());
        }
    }

    /** Re-charge SENT autonomous sends whose deduct call was lost (idempotent via action id). */
    private int reconcileBilling(Instant now) {
        List<EngagementAction> unbilled = actionRepository.findUnbilledSent(batch);
        int fixed = 0;
        for (EngagementAction a : unbilled) {
            try {
                if (creditClient.deductPrecomputed(a.getInstituteId(), CREDIT_REQUEST_TYPE,
                        "Engagement Engine autonomous " + a.getChannel() + " send (reconciled)",
                        perMessageCredits, a.getId(), sendMetering(a))) {
                    actionRepository.markBilled(a.getId(), now);
                    fixed++;
                }
            } catch (Exception e) {
                log.warn("Billing reconciliation retry failed for action {}: {}", a.getId(), e.getMessage());
            }
        }
        return fixed;
    }

    /** The limit gate for one send. Never throws. */
    private AuthorizeResult authorizeSend(String instituteId, EngagementAction action) {
        try {
            return creditClient.authorize(instituteId, USE_CASE, CREDIT_REQUEST_TYPE, sendMetering(action),
                    null, perMessageCredits, false);
        } catch (Exception e) {
            return AuthorizeResult.ALLOW_NONE;
        }
    }

    /** Usage-metering fields for one autonomous send: a system job, with the action in the context. */
    static MeteringFields sendMetering(EngagementAction action) {
        java.util.Map<String, Object> context = new java.util.HashMap<>();
        if (action.getId() != null) context.put("action_id", action.getId());
        if (action.getEngineId() != null) context.put("engine_id", action.getEngineId());
        if (action.getMemberId() != null) context.put("member_id", action.getMemberId());
        if (action.getChannel() != null) context.put("channel", action.getChannel());
        return MeteringFields.system("engagement_message").usageContext(context).build();
    }

    private boolean channelAutoEnabled(EngagementEngine engine, String channel) {
        if (channel == null) return false;
        try {
            // Enabled AND auto: an "auto" flag left on a channel that was later switched off must not send.
            com.fasterxml.jackson.databind.JsonNode ch = objectMapper.readTree(engine.getChannels()).path(channel);
            return ch.path("enabled").asBoolean(false) && ch.path("auto").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }
}
