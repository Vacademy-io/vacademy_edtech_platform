package vacademy.io.admin_core_service.features.workflow.engine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallNodeDispatcher;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionStateRepository;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * A retry must be spent on a CALL, not on an enqueue.
 *
 * <p>The node enqueues and then sleeps on a timer, but the dial is asynchronous: the
 * queue can be paused, out of credits, outside calling hours or simply deep. Counting
 * those as attempts is how a lead gets stamped Not Reachable while its call is still
 * queued — observed on Shiksha Nation, where the workflow gave up on 452 leads at once
 * and 155 of them were dialled afterwards, three with good outcomes nobody acted on.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CallAiNodeHandlerAttemptIntegrityTest {

    @Mock AiCallNodeDispatcher aiCallDispatcher;
    @Mock AiCallQueueService aiCallQueueService;
    @Mock AiCallingSettingsService settingsService;
    @Mock UserLeadProfileRepository userLeadProfileRepository;
    @Mock WorkflowExecutionStateRepository executionStateRepository;
    @Mock WorkflowExecutionRepository executionRepository;
    @Mock SpelEvaluator spelEvaluator;
    @Mock TelephonyCallLogRepository callLogRepo;

    @InjectMocks CallAiNodeHandler handler;

    private Map<String, Object> ctx(int attempts) {
        Map<String, Object> c = new HashMap<>();
        c.put("instituteId", "inst-1");
        c.put("userId", "user-1");
        c.put("responseId", "resp-1");
        c.put("executionId", "exec-1");
        c.put("aiCallAttempts", attempts);
        return c;
    }

    private AiCallingSettingsPojo settings() {
        AiCallingSettingsPojo s = new AiCallingSettingsPojo();
        s.setEnabled(true);
        s.setMaxRetries(3);
        s.setRecheckMinutes(30);
        return s;
    }

    @Test
    @DisplayName("a call still waiting in the queue defers the node WITHOUT spending an attempt")
    void waitingCallDoesNotSpendAnAttempt() {
        when(settingsService.get(anyString())).thenReturn(settings());
        when(aiCallQueueService.hasCallWaiting(anyString(), any(), anyString())).thenReturn(true);
        when(executionRepository.findById(anyString())).thenReturn(Optional.empty());

        Map<String, Object> context = ctx(2);
        Map<String, Object> out = handler.handle(context, "{}", Map.of(), 0);

        assertEquals(Boolean.TRUE, out.get("aiCallAwaitingDial"));
        assertEquals(Boolean.TRUE, out.get("__workflow_paused"));
        // the counter is untouched — this is the whole point
        assertEquals(2, context.get("aiCallAttempts"));
        // and crucially it did NOT dial again, nor give up
        verifyNoInteractions(aiCallDispatcher);
        assertNull(out.get("aiCallStopReason"));
    }

    @Test
    @DisplayName("on the LAST attempt a waiting call still defers rather than declaring the lead unreachable")
    void waitingCallOnTheLastAttemptDoesNotGiveUp() {
        when(settingsService.get(anyString())).thenReturn(settings());
        when(aiCallQueueService.hasCallWaiting(anyString(), any(), anyString())).thenReturn(true);
        when(executionRepository.findById(anyString())).thenReturn(Optional.empty());

        // attempts == maxRetries: the old code would have STOPped here with "exhausted"
        // and stamped the lead Not Reachable while its call was still queued.
        Map<String, Object> out = handler.handle(ctx(3), "{}", Map.of(), 0);

        assertEquals(Boolean.TRUE, out.get("aiCallAwaitingDial"));
        assertNotEquals("exhausted", out.get("aiCallStopReason"));
        verifyNoInteractions(aiCallDispatcher);
    }

    @Test
    @DisplayName("nothing waiting: the node plans normally, so the guard cannot stall a healthy queue")
    void noWaitingCallFallsThroughToNormalPlanning() {
        AiCallingSettingsPojo disabled = settings();
        disabled.setEnabled(false);          // cheapest way to stop plan() before dialling
        when(settingsService.get(anyString())).thenReturn(disabled);
        when(aiCallQueueService.hasCallWaiting(anyString(), any(), anyString())).thenReturn(false);

        Map<String, Object> out = handler.handle(ctx(0), "{}", Map.of(), 0);

        assertNull(out.get("aiCallAwaitingDial"));
        assertEquals("ai_calling_disabled", out.get("aiCallStopReason"));
    }
}
