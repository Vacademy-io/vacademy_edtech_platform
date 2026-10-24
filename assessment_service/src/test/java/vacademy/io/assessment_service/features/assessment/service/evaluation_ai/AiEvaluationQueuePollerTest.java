package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationLaneCaps;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationQueueClaimer;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue.AiEvaluationQueueClaimer.ClaimedJob;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The queue drainer. A row must never take the tick down, every claimed row is
 * dispatched under this instance's claim token (the guard the dispatcher checks),
 * each lane drains on its own tick, and a dispatch the executor refuses goes
 * straight back to the queue.
 */
class AiEvaluationQueuePollerTest {

    private AiEvaluationProcessRepository repository;
    private AiEvaluationAsyncService worker;
    private AiEvaluationQueueClaimer claimer;
    private AiEvaluationLaneCaps caps;
    private AiEvaluationQueuePoller poller;

    @BeforeEach
    void setUp() {
        repository = mock(AiEvaluationProcessRepository.class);
        worker = mock(AiEvaluationAsyncService.class);
        claimer = mock(AiEvaluationQueueClaimer.class);
        caps = new AiEvaluationLaneCaps(3, -1, -1, 12, 6, -1);
        poller = new AiEvaluationQueuePoller(repository, worker, claimer, caps);
        ReflectionTestUtils.setField(poller, "pollerEnabled", true);
        ReflectionTestUtils.setField(poller, "claimStaleMinutes", 15L);
    }

    @Test
    void everyClaimedRowIsDispatchedUnderThisInstancesClaim() {
        when(claimer.claim(eq(AiEvaluationLane.COPY), eq(caps), anyString(), any(), any())).thenReturn(List.of(
                new ClaimedJob("p1", "a1", "m"), new ClaimedJob("p2", "a2", null)));

        poller.drainQueue();

        String me = poller.instanceId();
        verify(worker).evaluateAttemptAsync("p1", "a1", "m", me);
        verify(worker).evaluateAttemptAsync("p2", "a2", null, me);
    }

    @Test
    void theTypedTickClaimsOnlyTheTypedLane() {
        when(claimer.claim(any(), any(), anyString(), any(), any())).thenReturn(List.of());

        poller.drainTypedQueue();

        verify(claimer).claim(eq(AiEvaluationLane.TYPED), eq(caps), anyString(), any(), any());
        verify(claimer, never()).claim(eq(AiEvaluationLane.COPY), any(), anyString(), any(), any());
    }

    @Test
    void aRowWithoutAnAttemptDoesNotStopTheOthers() {
        when(claimer.claim(eq(AiEvaluationLane.COPY), any(), anyString(), any(), any())).thenReturn(List.of(
                new ClaimedJob("broken", null, "m"), new ClaimedJob("ok", "attempt-ok", "m")));

        poller.drainQueue();

        verify(worker).evaluateAttemptAsync(eq("ok"), eq("attempt-ok"), eq("m"), anyString());
        verify(worker, never()).evaluateAttemptAsync(eq("broken"), any(), any(), any());
    }

    @Test
    void aDispatchTheExecutorRefusesIsHandedBackToTheQueue() {
        when(claimer.claim(eq(AiEvaluationLane.COPY), any(), anyString(), any(), any())).thenReturn(List.of(
                new ClaimedJob("full", "a1", "m"), new ClaimedJob("next", "a2", "m")));
        doThrow(new TaskRejectedException("queue full")).when(worker)
                .evaluateAttemptAsync(eq("full"), any(), any(), any());

        poller.drainQueue();

        verify(repository).handBackClaim(eq("full"), eq(poller.instanceId()), any());
        verify(worker).evaluateAttemptAsync(eq("next"), eq("a2"), eq("m"), anyString());
    }

    @Test
    void aFailingClaimDoesNotEscapeTheTick() {
        when(claimer.claim(any(), any(), anyString(), any(), any())).thenThrow(new IllegalStateException("db down"));

        poller.drainQueue();

        verify(worker, never()).evaluateAttemptAsync(any(), any(), any(), any());
    }

    @Test
    void aDisabledPollerDoesNothing() {
        ReflectionTestUtils.setField(poller, "pollerEnabled", false);
        poller.drainQueue();
        poller.drainTypedQueue();
        verify(claimer, never()).claim(any(), any(), anyString(), any(), any());
    }
}
