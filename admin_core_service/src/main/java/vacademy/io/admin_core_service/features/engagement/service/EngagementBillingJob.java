package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The Engagement Engine's credit charges that are not tied to the moment of a send.
 * <ol>
 *   <li><b>AI decisions.</b> Every brain call (what to do next for a person, or a reply draft)
 *       stores its token counts and model on the action it produced. This charges them through
 *       ai_service's token-metered deduct (request type {@value #DECISION_REQUEST_TYPE}), priced
 *       like every other LLM feature. A no-op decision is charged too: the model was asked.</li>
 *   <li><b>Refunds.</b> A message charged when it was sent and later refused by the provider
 *       (EngagementDeliveryCheckJob moves it to FAILED, e.g. Meta 131049) gets its credit back.</li>
 * </ol>
 * Message charges themselves stay in EngagementDispatchJob (inline for autonomous sends, and its
 * reconciliation pass for approved sends and AI replies). Both charges here are idempotent on the
 * action id, so a retry after a lost response charges or refunds once.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementBillingJob {

    static final String DECISION_REQUEST_TYPE = "engagement_decision";
    static final String DECISION_USE_CASE = "engagement_decision";
    static final String DECISION_KEY_PREFIX = "engagement-llm:";

    private final EngagementActionRepository actionRepository;
    private final CreditClient creditClient;

    @Value("${engagement.billing.batch:200}")
    private int batch;

    @Value("${engagement.billing.decisions.enabled:true}")
    private boolean chargeDecisions;

    @Value("${engagement.credits.per-message:1.0}")
    private BigDecimal perMessageCredits;

    @Scheduled(fixedDelayString = "${engagement.billing.delay-ms:120000}",
            initialDelayString = "${engagement.billing.initial-delay-ms:60000}")
    @SchedulerLock(name = "EngagementBilling", lockAtMostFor = "PT10M", lockAtLeastFor = "PT10S")
    public void run() {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        int charged = 0;
        int refunded = 0;
        try {
            if (chargeDecisions) charged = chargeDecisions(now);
        } catch (Exception e) {
            log.error("Engagement billing: charging AI decisions failed: {}", e.getMessage());
        }
        try {
            refunded = refundRefusedSends(now);
        } catch (Exception e) {
            log.error("Engagement billing: refunds failed: {}", e.getMessage());
        }
        if (charged > 0 || refunded > 0) {
            log.info("Engagement billing: {} AI decisions charged, {} refused sends refunded", charged, refunded);
        }
    }

    int chargeDecisions(Instant now) {
        List<EngagementAction> rows = actionRepository.findUnbilledDecisions(batch);
        int done = 0;
        for (EngagementAction a : rows) {
            try {
                // allow_negative: the tokens were already spent at the provider. The sweep stops
                // asking the model once the balance is gone (EngagementSweepJob), so the wallet
                // can only dip by the decisions already in flight.
                boolean ok = creditClient.deductAttributedTokenUsage(
                        a.getInstituteId(),
                        DECISION_REQUEST_TYPE,
                        a.getLlmModel(),
                        a.getLlmTokensIn() != null ? a.getLlmTokensIn() : 0,
                        a.getLlmTokensOut() != null ? a.getLlmTokensOut() : 0,
                        null,
                        null,
                        MeteringFields.ROLE_CLASS_SYSTEM,
                        null,
                        decisionDescription(a),
                        null,
                        DECISION_KEY_PREFIX + a.getId(),
                        true,
                        decisionMetering(a));
                if (ok) {
                    actionRepository.markLlmBilled(a.getId(), now);
                    done++;
                }
            } catch (Exception e) {
                log.warn("Engagement billing: AI decision charge failed for action {}: {}", a.getId(), e.getMessage());
            }
        }
        return done;
    }

    int refundRefusedSends(Instant now) {
        List<EngagementAction> rows = actionRepository.findChargedFailed(batch);
        int done = 0;
        for (EngagementAction a : rows) {
            if (actionRepository.claimRefund(a.getId(), now) != 1) continue; // someone else has it
            boolean ok;
            try {
                ok = creditClient.refundUsage(a.getInstituteId(), a.getId(), perMessageCredits, refundDescription(a));
            } catch (Exception e) {
                ok = false;
            }
            if (ok) {
                done++;
            } else {
                // Not reached or refused: give the claim back so the next run tries again.
                actionRepository.releaseRefund(a.getId());
            }
        }
        return done;
    }

    static String decisionDescription(EngagementAction a) {
        if ("REPLY".equals(a.getKind())) return "Engagement Engine AI reply decision";
        if ("NO_OP".equals(a.getKind())) return "Engagement Engine AI decision (waited)";
        return "Engagement Engine AI decision";
    }

    static String refundDescription(EngagementAction a) {
        String channel = a.getChannel() != null ? a.getChannel() : "message";
        return "Refund: Engagement Engine " + channel + " message was not delivered";
    }

    /** Usage-metering fields for one AI decision: a system job, with the action in the context. */
    static MeteringFields decisionMetering(EngagementAction a) {
        Map<String, Object> context = new HashMap<>();
        if (a.getId() != null) context.put("action_id", a.getId());
        if (a.getEngineId() != null) context.put("engine_id", a.getEngineId());
        if (a.getMemberId() != null) context.put("member_id", a.getMemberId());
        if (a.getKind() != null) context.put("kind", a.getKind());
        return MeteringFields.system(DECISION_USE_CASE).usageContext(context).build();
    }
}
