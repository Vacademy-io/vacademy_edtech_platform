package vacademy.io.admin_core_service.features.telephony.core;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallDecision;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallDecision.Action;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;

import java.util.List;

/**
 * Pure decision logic: given a call's outcome + the institute's policy, decide
 * whether to assign a counsellor, stop, or retry. No I/O — fully unit-testable.
 *
 * Two axes:
 *  1. Connectivity — a call that didn't really connect (not "completed", or
 *     shorter than the connect threshold) is a no-connect → retry / exhausted.
 *  2. Disposition — for a connected call, the configured assign/stop lists decide
 *     the action; anything unmapped is treated as neutral → retry / exhausted.
 */
@Component
public class AiCallOutcomeClassifier {

    /** Dispositions that stay retry-worthy even on a CONNECTED call — the lead asked
     *  to be called back, or the bot couldn't reach a conclusion. */
    private static final List<String> RETRY_WORTHY = List.of("Callback", "Incomplete");

    public AiCallDecision classify(String status, Integer durationSec, String disposition,
                                   int priorAttempts, AiCallingSettingsPojo s) {
        return classify(status, durationSec, disposition, priorAttempts, s, null);
    }

    /**
     * {@code agentDispositions} = the outcomes a VACADEMY_AI registry agent declares.
     * A CONNECTED call whose disposition the agent explicitly defined is a REACHED
     * CONCLUSION → terminal, so the AI never re-dials a lead who fully answered with a
     * custom disposition the institute's assign/stop lists don't enumerate (the old
     * "neutral → retry" fallback re-called answered leads, incl. do-not-call outcomes).
     * Null/empty agent list preserves the exact prior behavior (Aavtaar, agentless).
     */
    public AiCallDecision classify(String status, Integer durationSec, String disposition,
                                   int priorAttempts, AiCallingSettingsPojo s,
                                   List<String> agentDispositions) {
        return classify(status, durationSec, disposition, priorAttempts, s, agentDispositions, null);
    }

    /**
     * {@code callerWordCount} = words the caller actually said, as MEASURED by the bot
     * (never a model judgement). Null = not measured, which preserves the exact prior
     * behaviour for every provider and every historical row.
     *
     * <p>It exists to break a bad tie. A call can be a long, rich, obviously qualified
     * conversation and STILL arrive with no usable disposition — because the label was
     * outside the agent's vocabulary, because a guard refused an unevidenced booking,
     * or because {@code isUntrustworthyCall} degraded a RED call to Incomplete. All
     * three funnel into "Incomplete", and Incomplete means RETRY: we re-dial someone
     * who just held a three-minute conversation, and nobody ever reads what they said.
     *
     * <p>The 2026-09-09 audit found exactly this — a 428-second call in which the
     * caller said 433 words, and a 196-second engaged call whose Counselling_Scheduled
     * claim was (correctly) refused for having no agreed time. Both were bound for the
     * re-dialer.
     *
     * <p>So: a connected call where the caller genuinely engaged is never silently
     * retried on a "no conclusion" label. It goes to a human, who has the transcript.
     * Deciding this on a measured word count rather than the disposition is the whole
     * point — the classifier we caught inventing outcomes does not get to vote on
     * whether a lead reaches a person.
     */
    public AiCallDecision classify(String status, Integer durationSec, String disposition,
                                   int priorAttempts, AiCallingSettingsPojo s,
                                   List<String> agentDispositions, Integer callerWordCount) {
        if (s == null || !s.isEnabled()) {
            return new AiCallDecision(Action.NONE, "ai_calling_disabled");
        }

        boolean canRetry = priorAttempts < s.getMaxRetries();

        if (!isConnected(status, durationSec, s.getConnectThresholdSec())) {
            return canRetry ? new AiCallDecision(Action.RETRY, "not_connected") : exhausted(s);
        }

        String d = disposition == null ? "" : disposition.trim();
        if (containsIgnoreCase(s.getAssignOnDispositions(), d)) {
            return new AiCallDecision(Action.ASSIGN, "good:" + d);
        }
        if (containsIgnoreCase(s.getStopOnDispositions(), d)) {
            return new AiCallDecision(Action.STOP, "stop:" + d);
        }
        // Genuinely retry-worthy even when connected (call-back / no conclusion).
        if (containsIgnoreCase(RETRY_WORTHY, d)) {
            // ... UNLESS the caller actually engaged. An explicit Callback is exempt:
            // the lead ASKED to be called again, so re-dialing is the instruction, not
            // a failure to judge. Only the "no conclusion" labels flip to a human.
            if (isEngaged(callerWordCount, s) && !isExplicitCallback(d)) {
                return new AiCallDecision(Action.ASSIGN, "engaged_unjudged:" + d);
            }
            return canRetry ? new AiCallDecision(Action.RETRY, "neutral:" + d) : exhausted(s);
        }
        // Connected call carrying a disposition the AGENT defined = a reached
        // conclusion the institute didn't map to assign/stop. Terminal (never
        // re-dial), but route through the institute's leftover-handling policy
        // instead of a blanket STOP — an agent registry enumerates positive
        // outcomes too (Interested, Wants_Demo), and STOP would silently bury a
        // hot lead as Not-Interested and never hand it to a human.
        if (containsIgnoreCase(agentDispositions, d)) {
            return s.isAssignExhaustedToHuman()
                    ? new AiCallDecision(Action.ASSIGN, "agent_terminal:" + d)
                    : new AiCallDecision(Action.STOP, "agent_terminal:" + d);
        }
        // Truly unmapped (not in settings, not agent-defined) → neutral (unchanged) —
        // with the same engaged-caller exception as above, for the same reason, and
        // the same call-back exemption: an institute's own spelling of "call me back"
        // lands here rather than in RETRY_WORTHY, and it is still an instruction.
        if (isEngaged(callerWordCount, s) && !isExplicitCallback(d)) {
            return new AiCallDecision(Action.ASSIGN, "engaged_unjudged:" + d);
        }
        return canRetry ? new AiCallDecision(Action.RETRY, "neutral:" + d) : exhausted(s);
    }

    /**
     * Null = not measured → never engaged, so every historical row and every provider
     * that does not report a count keeps its exact prior routing. Zero is a real
     * silent pickup and is likewise not engaged.
     */
    private boolean isEngaged(Integer callerWordCount, AiCallingSettingsPojo s) {
        return callerWordCount != null && callerWordCount >= s.getEngagedCallerWords();
    }

    /** "Callback" and any label the institute spells as a call-back request. */
    private boolean isExplicitCallback(String disposition) {
        String n = disposition == null ? "" : disposition.toLowerCase().replace("_", "").replace(" ", "");
        return n.contains("callback");
    }

    private AiCallDecision exhausted(AiCallingSettingsPojo s) {
        return s.isAssignExhaustedToHuman()
                ? new AiCallDecision(Action.ASSIGN, "exhausted")
                : new AiCallDecision(Action.STOP, "exhausted");
    }

    private boolean isConnected(String status, Integer durationSec, int thresholdSec) {
        if (status == null || !status.trim().equalsIgnoreCase("completed")) return false;
        // Some providers (e.g. Aavtaar) don't report a call duration. When it's
        // absent, trust the "completed" status — a report only arrives after a real
        // conversation — instead of failing the connect check on a missing field.
        return durationSec == null || durationSec >= thresholdSec;
    }

    private boolean containsIgnoreCase(List<String> list, String value) {
        if (list == null || value == null || value.isBlank()) return false;
        return list.stream().anyMatch(x -> x != null && x.equalsIgnoreCase(value));
    }
}
