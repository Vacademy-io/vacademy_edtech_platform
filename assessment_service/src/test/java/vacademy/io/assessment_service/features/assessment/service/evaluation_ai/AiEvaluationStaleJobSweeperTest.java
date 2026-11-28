package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The sweeper writes through guarded single-row updates keyed on the status it
 * read: a callback that completed the copy in between must win (gate G6).
 */
class AiEvaluationStaleJobSweeperTest {

    private AiEvaluationProcessRepository repository;
    private AiEvaluationStaleJobSweeper sweeper;

    @BeforeEach
    void setUp() {
        repository = mock(AiEvaluationProcessRepository.class);
        sweeper = new AiEvaluationStaleJobSweeper(repository);
        ReflectionTestUtils.setField(sweeper, "staleTimeoutMinutes", 20L);
        ReflectionTestUtils.setField(sweeper, "maxRequeues", 2);
    }

    private static AiEvaluationProcess process(String id, String status, Integer retries) {
        AiEvaluationProcess p = new AiEvaluationProcess();
        p.setId(id);
        p.setStatus(status);
        p.setRetryCount(retries);
        return p;
    }

    @Test
    void aSilentRowIsRequeuedUnderTheStatusItWasReadIn() {
        when(repository.findSilentDispatched(eq(AiEvaluationQueuePoller.IN_FLIGHT), any()))
                .thenReturn(List.of(process("p1", "DISPATCHED", null), process("p2", "EVALUATING", 1)));

        sweeper.sweepStaleProcesses();

        verify(repository).sweepRequeue(eq("p1"), eq("DISPATCHED"), any(), eq(1), anyString(), any());
        verify(repository).sweepRequeue(eq("p2"), eq("EVALUATING"), any(), eq(2), anyString(), any());
        verify(repository, never()).saveAll(anyList());
    }

    @Test
    void aRowOutOfRequeuesIsFailedUnderTheSameGuard() {
        when(repository.findSilentDispatched(anyList(), any())).thenReturn(List.of(process("p1", "PROCESSING", 2)));

        sweeper.sweepStaleProcesses();

        verify(repository).sweepFail(eq("p1"), eq("PROCESSING"), any(), anyString(), any());
        verify(repository, never()).sweepRequeue(any(), any(), any(), anyInt(), any(), any());
    }

    @Test
    void theSweeperWatchesDispatchedRows() {
        when(repository.findSilentDispatched(anyList(), any())).thenReturn(List.of());

        sweeper.sweepStaleProcesses();

        verify(repository).findSilentDispatched(org.mockito.ArgumentMatchers.argThat(
                (List<String> l) -> l.contains("DISPATCHED") && !l.contains("PENDING")), any());
    }
}
