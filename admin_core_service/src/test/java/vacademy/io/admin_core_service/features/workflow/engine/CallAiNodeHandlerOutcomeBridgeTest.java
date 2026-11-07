package vacademy.io.admin_core_service.features.workflow.engine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallNodeDispatcher;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionStateRepository;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * The webhook→resume bridge injects {@code callOutcome} into the paused context and the
 * engine re-enters CALL_AI; the nodes AFTER it (the template's
 * {@code #ctx['callOutcome'] == 'ASSIGN'} CONDITION) read that same live map. These tests
 * pin the contract: a terminal resume routes out WITHOUT consuming the outcome, and a
 * loop-back after the outcome was already consumed drops the stale keys instead of
 * short-circuiting again.
 */
@ExtendWith(MockitoExtension.class)
class CallAiNodeHandlerOutcomeBridgeTest {

    @Mock AiCallNodeDispatcher aiCallDispatcher;
    @Mock vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService aiCallQueueService;
    @Mock AiCallingSettingsService settingsService;
    @Mock UserLeadProfileRepository userLeadProfileRepository;
    @Mock WorkflowExecutionStateRepository executionStateRepository;
    @Mock WorkflowExecutionRepository executionRepository;
    @Mock SpelEvaluator spelEvaluator;
    @Mock TelephonyCallLogRepository callLogRepo;

    @InjectMocks CallAiNodeHandler handler;

    private Map<String, Object> resumedContext(String outcome) {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("instituteId", "inst-1");
        ctx.put("userId", "user-1");
        ctx.put("responseId", "resp-1");
        ctx.put("executionId", "exec-1");
        ctx.put("aiCallAttempts", 1);
        ctx.put("callOutcome", outcome);
        ctx.put("callDisposition", "Interested");
        ctx.put("callConnected", true);
        ctx.put("callAnswers", Map.of("Child's Class", "10"));
        return ctx;
    }

    @Test
    @DisplayName("terminal resume: routes out and leaves callOutcome readable for the next node")
    void terminalResumeKeepsOutcomeForDownstreamCondition() {
        Map<String, Object> ctx = resumedContext("ASSIGN");

        Map<String, Object> out = handler.handle(ctx, "{}", Map.of(), 0);

        assertEquals(Boolean.TRUE, out.get("aiCallDone"));
        assertEquals("disposition_terminal", out.get("aiCallStopReason"));
        assertEquals("ASSIGN", ctx.get("callOutcome"), "downstream CONDITION must still see the outcome");
        assertEquals("Interested", ctx.get("callDisposition"));
        assertEquals(Boolean.TRUE, ctx.get("callConnected"));
        assertNotNull(ctx.get("callAnswers"));
        verifyNoInteractions(aiCallDispatcher, settingsService);
    }

    @Test
    @DisplayName("loop-back after a consumed outcome: stale keys dropped, node plans a fresh dial")
    void loopBackAfterConsumedOutcomeDoesNotShortCircuit() {
        Map<String, Object> ctx = resumedContext("ASSIGN");
        ctx.put("aiCallDone", true);            // the earlier short-circuit already merged this
        AiCallingSettingsPojo disabled = new AiCallingSettingsPojo();
        disabled.setEnabled(false);             // cheapest way to stop plan() before dialing
        when(settingsService.get(anyString())).thenReturn(disabled);

        Map<String, Object> out = handler.handle(ctx, "{}", Map.of(), 0);

        assertFalse(ctx.containsKey("callOutcome"), "stale outcome must not leak into the next call");
        assertFalse(ctx.containsKey("callDisposition"));
        assertFalse(ctx.containsKey("callConnected"));
        assertFalse(ctx.containsKey("callAnswers"));
        assertEquals("ai_calling_disabled", out.get("aiCallStopReason"), "went through plan(), not the short-circuit");
        verify(settingsService).get("inst-1");
    }

    @Test
    @DisplayName("first entry: no outcome present, aiCallDone reset so the next terminal resume is honoured")
    void firstEntryResetsConsumedMarker() {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("instituteId", "inst-1");
        ctx.put("userId", "user-1");
        ctx.put("responseId", "resp-1");
        ctx.put("aiCallDone", true);            // e.g. a second CALL_AI node after the first completed
        AiCallingSettingsPojo disabled = new AiCallingSettingsPojo();
        disabled.setEnabled(false);
        when(settingsService.get(anyString())).thenReturn(disabled);

        handler.handle(ctx, "{}", Map.of(), 0);

        assertEquals(Boolean.FALSE, ctx.get("aiCallDone"));
    }
}
