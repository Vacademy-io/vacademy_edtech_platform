package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobRepository;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CommerceImportJobRunnerTest {

    private CommerceImportJobRepository jobRepository;
    private CommerceImportJobProcessor processor;
    private CommerceImportJobRunner runner;

    @BeforeEach
    void setUp() {
        jobRepository = mock(CommerceImportJobRepository.class);
        processor = mock(CommerceImportJobProcessor.class);
        runner = new CommerceImportJobRunner(jobRepository, processor);
    }

    @AfterEach
    void tearDown() {
        runner.shutdown();
    }

    @Test
    void aDispatchedJobRunsOnlyWhenThisWorkerWinsTheClaim() {
        when(jobRepository.claimQueued(eq("job-won"), any())).thenReturn(1);
        when(jobRepository.claimQueued(eq("job-lost"), any())).thenReturn(0);

        runner.dispatch("job-won");
        runner.dispatch("job-lost");

        verify(processor, timeout(2000)).run("job-won");
        verify(jobRepository, timeout(2000)).claimQueued(eq("job-lost"), any());
        verify(processor, never()).run("job-lost");
    }

    @Test
    void theSweepResumesAStoppedJobAndGivesUpOnOneThatKeepsStopping() {
        CommerceImportJob stopped = job("job-stopped", 1);
        CommerceImportJob poison = job("job-poison", CommerceImportJobRunner.MAX_ATTEMPTS);
        CommerceImportJob takenElsewhere = job("job-elsewhere", 2);
        when(jobRepository.findTop20ByStatusInAndHeartbeatAtBeforeOrderByHeartbeatAtAsc(any(), any()))
                .thenReturn(List.of(poison, stopped, takenElsewhere));
        when(jobRepository.claimStale(eq("job-stopped"), any(), any())).thenReturn(1);
        when(jobRepository.claimStale(eq("job-elsewhere"), any(), any())).thenReturn(0);
        when(jobRepository.abandon(eq("job-poison"), anyString(), any(), any())).thenReturn(1);

        assertEquals(1, runner.sweepOnce());

        verify(jobRepository).abandon(eq("job-poison"), anyString(), any(), any());
        verify(jobRepository, never()).claimStale(eq("job-poison"), any(), any());
        verify(processor, timeout(2000)).run("job-stopped");
        verify(processor, never()).run("job-elsewhere");
        verify(processor, never()).run("job-poison");
    }

    @Test
    void aFailingSweepDoesNotThrow() {
        when(jobRepository.findTop20ByStatusInAndHeartbeatAtBeforeOrderByHeartbeatAtAsc(any(), any()))
                .thenThrow(new IllegalStateException("database is away"));
        runner.sweep();
    }

    private static CommerceImportJob job(String id, int attempt) {
        CommerceImportJob job = new CommerceImportJob();
        job.setId(id);
        job.setInstituteId("inst-1");
        job.setStatus(CommerceImportJob.RUNNING);
        job.setAttempt(attempt);
        job.setNextGroupIndex(3);
        return job;
    }
}
