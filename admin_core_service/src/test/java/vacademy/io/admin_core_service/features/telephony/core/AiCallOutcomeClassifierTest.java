package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallDecision;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallDecision.Action;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pure unit tests for the AI-call outcome decision (assign vs stop vs retry).
 * No Spring context — the classifier has no I/O.
 */
class AiCallOutcomeClassifierTest {

    private final AiCallOutcomeClassifier classifier = new AiCallOutcomeClassifier();

    private AiCallingSettingsPojo enabled() {
        AiCallingSettingsPojo s = new AiCallingSettingsPojo();
        s.setEnabled(true);
        s.setConnectThresholdSec(20);
        s.setMaxRetries(3);
        s.setAssignOnDispositions(List.of("Interested", "Likely_Interested"));
        s.setStopOnDispositions(List.of("Not_Interested"));
        s.setAssignExhaustedToHuman(true);
        return s;
    }

    @Test
    void disabled_returnsNone() {
        AiCallingSettingsPojo s = enabled();
        s.setEnabled(false);
        assertEquals(Action.NONE, classifier.classify("completed", 120, "Interested", 0, s).action());
    }

    @Test
    void nullSettings_returnsNone() {
        assertEquals(Action.NONE, classifier.classify("completed", 120, "Interested", 0, null).action());
    }

    @Test
    void connectedGoodDisposition_assigns() {
        AiCallDecision d = classifier.classify("completed", 120, "Interested", 0, enabled());
        assertEquals(Action.ASSIGN, d.action());
        assertFalse(d.isExhausted());
    }

    @Test
    void goodDisposition_isCaseInsensitive() {
        assertEquals(Action.ASSIGN, classifier.classify("completed", 120, "likely_interested", 0, enabled()).action());
    }

    @Test
    void connectedStopDisposition_stops() {
        assertEquals(Action.STOP, classifier.classify("completed", 120, "Not_Interested", 0, enabled()).action());
    }

    @Test
    void connectedNeutral_retriesWhenAttemptsLeft() {
        assertEquals(Action.RETRY, classifier.classify("completed", 120, "Incomplete", 0, enabled()).action());
    }

    @Test
    void connectedNeutral_exhausted_assignsToHumanWhenConfigured() {
        AiCallDecision d = classifier.classify("completed", 120, "Incomplete", 3, enabled());
        assertEquals(Action.ASSIGN, d.action());
        assertTrue(d.isExhausted());
    }

    @Test
    void connectedNeutral_exhausted_stopsWhenNotAssigning() {
        AiCallingSettingsPojo s = enabled();
        s.setAssignExhaustedToHuman(false);
        AiCallDecision d = classifier.classify("completed", 120, "Incomplete", 3, s);
        assertEquals(Action.STOP, d.action());
        assertTrue(d.isExhausted());
    }

    @Test
    void notCompleted_isNotConnected_retries() {
        AiCallDecision d = classifier.classify("no-answer", null, null, 0, enabled());
        assertEquals(Action.RETRY, d.action());
        assertEquals("not_connected", d.reason());
    }

    @Test
    void shortCompletedCall_belowThreshold_isNotConnected() {
        AiCallDecision d = classifier.classify("completed", 5, "Incomplete", 0, enabled());
        assertEquals(Action.RETRY, d.action());
        assertEquals("not_connected", d.reason());
    }

    @Test
    void notConnected_exhausted_assignsToHuman() {
        AiCallDecision d = classifier.classify("failed", null, null, 3, enabled());
        assertEquals(Action.ASSIGN, d.action());
        assertTrue(d.isExhausted());
    }

    // ── engaged but unjudged (V503) ───────────────────────────────────────────
    // 2026-09-09 audit, institute 3716991c: a 428s call with 433 caller words landed
    // on an Incomplete-family label and a 196s engaged call had its unevidenced
    // Counselling_Scheduled refused — both were bound for the re-dialer. A caller who
    // held a real conversation must reach a human, whatever the label says.

    @Test
    void engagedCaller_onIncomplete_goesToHumanNotRetry() {
        AiCallDecision d = classifier.classify("completed", 196, "Incomplete", 0, enabled(), null, 66);
        assertEquals(Action.ASSIGN, d.action());
        assertEquals("engaged_unjudged:Incomplete", d.reason());
        assertFalse(d.isExhausted(), "must stamp QUALIFIED, not NO_ANSWER");
    }

    @Test
    void engagedCaller_onUnmappedLabel_goesToHumanNotRetry() {
        // Label the institute never mapped and the agent never declared.
        AiCallDecision d = classifier.classify("completed", 428, "Cut_Off", 0, enabled(), null, 433);
        assertEquals(Action.ASSIGN, d.action());
        assertEquals("engaged_unjudged:Cut_Off", d.reason());
    }

    @Test
    void engagedCaller_explicitCallback_stillRetries() {
        // The lead ASKED to be called back. Re-dialing is the instruction, not a
        // failure to judge — engagement must not override it.
        AiCallDecision d = classifier.classify("completed", 90, "Callback", 0, enabled(), null, 120);
        assertEquals(Action.RETRY, d.action());
        assertEquals("neutral:Callback", d.reason());
        // ...and an institute's own spelling of call-back is treated the same.
        AiCallDecision d2 = classifier.classify("completed", 90, "call_back_requested", 0, enabled(), null, 120);
        assertEquals(Action.RETRY, d2.action());
    }

    @Test
    void belowThreshold_orUnmeasured_keepsPriorRouting() {
        // Null = not measured (every historical row, every provider that does not
        // report it). Must be indistinguishable from the pre-V503 behaviour.
        assertEquals(Action.RETRY, classifier.classify("completed", 120, "Incomplete", 0, enabled(), null, null).action());
        // Zero = a real silent pickup, likewise not engaged.
        assertEquals(Action.RETRY, classifier.classify("completed", 120, "Incomplete", 0, enabled(), null, 0).action());
        // Just under the line: a voicemail greeting runs ~25-35 words.
        assertEquals(Action.RETRY, classifier.classify("completed", 120, "Incomplete", 0, enabled(), null, 39).action());
        // On the line.
        assertEquals(Action.ASSIGN, classifier.classify("completed", 120, "Incomplete", 0, enabled(), null, 40).action());
    }

    @Test
    void engagement_neverOverridesAnExplicitStopOrAssign() {
        // The institute's own lists still win — engagement only breaks the "no
        // conclusion" tie, it does not promote a refusal or demote a good outcome.
        assertEquals(Action.STOP, classifier.classify("completed", 200, "Not_Interested", 0, enabled(), null, 300).action());
        AiCallDecision d = classifier.classify("completed", 200, "Interested", 0, enabled(), null, 300);
        assertEquals(Action.ASSIGN, d.action());
        assertEquals("good:Interested", d.reason());
    }

    @Test
    void engagement_doesNotRescueAnUnconnectedCall() {
        // A word count without a connect is nonsense data; the connect gate stays first.
        assertEquals("not_connected",
                classifier.classify("completed", 5, "Incomplete", 0, enabled(), null, 500).reason());
    }

    @Test
    void engagedThreshold_isConfigurable() {
        AiCallingSettingsPojo s = enabled();
        s.setEngagedCallerWords(100);
        assertEquals(Action.RETRY, classifier.classify("completed", 120, "Incomplete", 0, s, null, 66).action());
        assertEquals(Action.ASSIGN, classifier.classify("completed", 120, "Incomplete", 0, s, null, 100).action());
    }
}
