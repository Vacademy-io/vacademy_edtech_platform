package vacademy.io.admin_core_service.features.learner_tracking.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A bulk AI check's analysis is made only by the caller that takes the row - never twice,
 * never a made or in-flight row, and never for a learner nobody named.
 */
class CopyCheckAnalysisServiceTest {

    private ActivityLogRepository logs;
    private ActivityLogProcessorService processor;
    private CopyCheckAnalysisService service;

    @BeforeEach
    void setUp() {
        logs = mock(ActivityLogRepository.class);
        processor = mock(ActivityLogProcessorService.class);
        service = new CopyCheckAnalysisService(logs, processor);
    }

    @AfterEach
    void tearDown() {
        service.destroy();
    }

    private ActivityLog row(String id, String status) {
        ActivityLog row = new ActivityLog();
        row.setId(id);
        row.setUserId("u1");
        row.setSourceType("llm_assessment");
        row.setStatus(status);
        row.setRawJson("{}");
        return row;
    }

    private void newest(String userId, String id, String status) {
        when(logs.findNewestLiveAssessmentLog(userId, "as1")).thenReturn(List.<Object[]>of(new Object[]{id, status}));
    }

    @Test
    void theCallerThatTakesTheRowMakesTheAnalysis() {
        newest("u1", "r1", "on_demand");
        when(logs.claimAssessmentLog(eq("r1"), anyList())).thenReturn(1);
        when(logs.findById("r1")).thenReturn(Optional.of(row("r1", "processing")), Optional.of(row("r1", "processed")));

        Optional<ActivityLog> out = service.processNow("u1", "as1");

        verify(processor, times(1)).processActivityLog(any());
        assertThat(out).get().extracting(ActivityLog::getStatus).isEqualTo("processed");
    }

    @Test
    void aCallerThatLosesTheRowMakesNothing() {
        newest("u1", "r1", "raw");
        when(logs.claimAssessmentLog(eq("r1"), anyList())).thenReturn(0); // the scheduler took it
        when(logs.findById("r1")).thenReturn(Optional.of(row("r1", "processing")));

        Optional<ActivityLog> out = service.processNow("u1", "as1");

        verify(processor, never()).processActivityLog(any());
        assertThat(out).get().extracting(ActivityLog::getStatus).isEqualTo("processing");
    }

    @Test
    void aMadeOrInFlightRowIsNeverTaken() {
        newest("u1", "r1", "processed");
        when(logs.findById("r1")).thenReturn(Optional.of(row("r1", "processed")));
        service.processNow("u1", "as1");

        newest("u1", "r2", "processing");
        when(logs.findById("r2")).thenReturn(Optional.of(row("r2", "processing")));
        service.processNow("u1", "as1");

        verify(logs, never()).claimAssessmentLog(any(), anyList());
        verify(processor, never()).processActivityLog(any());
    }

    @Test
    void aLearnerWithoutARowIsNotFound() {
        when(logs.findNewestLiveAssessmentLog("u1", "as1")).thenReturn(List.of());

        assertThat(service.processNow("u1", "as1")).isEmpty();
    }

    @Test
    void onlyTheNamedLearnersAreQueued() {
        newest("u1", "r1", "on_demand");
        newest("u2", "r2", "processed");
        newest("u3", "r3", "failed");
        when(logs.claimAssessmentLog(eq("r1"), anyList())).thenReturn(1);
        when(logs.claimAssessmentLog(eq("r3"), anyList())).thenReturn(1);
        when(logs.findById("r1")).thenReturn(Optional.of(row("r1", "processing")));
        when(logs.findById("r3")).thenReturn(Optional.of(row("r3", "processing")));

        assertThat(service.processAsync("as1", List.of("u1", "u2", "u3"))).isEqualTo(2);

        verify(processor, timeout(2000).times(2)).processActivityLog(any());
        verify(logs, never()).findNewestLiveAssessmentLog(eq("u4"), any());
    }

    @Test
    void stateIsEachLearnersNewestStatus() {
        when(logs.findNewestAssessmentLogStatusPerUser("as1")).thenReturn(List.of(
                new Object[]{"u1", "on_demand"}, new Object[]{"u2", "processed"}));

        Map<String, String> state = service.newestStatusByUser("as1");

        assertThat(state).containsExactly(Map.entry("u1", "on_demand"), Map.entry("u2", "processed"));
    }
}
