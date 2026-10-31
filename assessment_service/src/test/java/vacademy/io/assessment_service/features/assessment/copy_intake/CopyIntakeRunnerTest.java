package vacademy.io.assessment_service.features.assessment.copy_intake;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeBatchRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeRunner;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Candidate;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The runner's job is to keep a 200-copy batch OFF the threads the rest of
 * the service depends on: the sweep (scheduler thread) must return at once,
 * a batch must not be queued twice, and every copy must go through the
 * shared reader pool.
 */
class CopyIntakeRunnerTest {

    private CopyIntakeService service;
    private AiCopyIntakeBatchRepository batches;
    private ThreadPoolTaskExecutor batchPool;
    private ThreadPoolTaskExecutor readPool;
    private CopyIntakeRunner runner;

    @BeforeEach
    void setUp() {
        service = mock(CopyIntakeService.class);
        batches = mock(AiCopyIntakeBatchRepository.class);
        batchPool = pool(1, 10);
        readPool = pool(2, 100);
        runner = new CopyIntakeRunner(service, batches, batchPool, readPool);
    }

    @AfterEach
    void tearDown() {
        batchPool.shutdown();
        readPool.shutdown();
    }

    private static ThreadPoolTaskExecutor pool(int threads, int queue) {
        ThreadPoolTaskExecutor p = new ThreadPoolTaskExecutor();
        p.setCorePoolSize(threads);
        p.setMaxPoolSize(threads);
        p.setQueueCapacity(queue);
        p.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        p.initialize();
        return p;
    }

    private AiCopyIntakeBatch running(String id) {
        AiCopyIntakeBatch b = AiCopyIntakeBatch.builder().id(id).assessmentId("a-1").instituteId("i-1")
                .status(AiCopyIntakeBatch.RUNNING).build();
        when(batches.findById(id)).thenReturn(Optional.of(b));
        return b;
    }

    private static AiCopyIntakeItem pending(String id) {
        return AiCopyIntakeItem.builder().id(id).batchId("batch-1").status(AiCopyIntakeItem.PENDING).build();
    }

    @Test
    void everyPendingCopyIsReadOnTheSharedPoolThenTheBatchIsSettled() throws Exception {
        running("batch-1");
        when(service.pendingItems("batch-1")).thenReturn(List.of(pending("i1"), pending("i2"), pending("i3")));
        List<Candidate> students = List.of(Candidate.builder().userId("u").name("Aman").build());
        when(service.candidatesFor("a-1", "i-1")).thenReturn(students);
        AtomicInteger reads = new AtomicInteger();
        doAnswer(inv -> {
            reads.incrementAndGet();
            return null;
        }).when(service).identifyAndPlace(anyString(), anyList());

        runner.run("batch-1");

        verify(service, timeout(5000)).finalizeIfDone("batch-1");
        assertThat(reads.get()).isEqualTo(3);
        verify(service, times(1)).candidatesFor("a-1", "i-1");     // once per pass, not per copy
        verify(service).syncQueuedItems("batch-1");
    }

    @Test
    void aBatchAlreadyQueuedHereIsNotQueuedAgain() throws Exception {
        running("batch-1");
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch started = new CountDownLatch(1);
        when(service.pendingItems("batch-1")).thenAnswer(inv -> {
            started.countDown();
            release.await(5, TimeUnit.SECONDS);
            return List.of();
        });

        runner.run("batch-1");
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        runner.run("batch-1");           // while the first pass is still running
        runner.sweep();                  // and the sweep offers it too
        release.countDown();

        verify(service, timeout(5000).times(1)).finalizeIfDone("batch-1");
        Thread.sleep(200);
        verify(service, times(1)).pendingItems("batch-1");
    }

    @Test
    void theSweepOnlyQueuesWorkAndReturnsAtOnce() throws Exception {
        AiCopyIntakeBatch batch = running("batch-1");
        when(batches.findByStatus(AiCopyIntakeBatch.RUNNING)).thenReturn(List.of(batch));
        CountDownLatch release = new CountDownLatch(1);
        when(service.pendingItems("batch-1")).thenAnswer(inv -> {
            release.await(5, TimeUnit.SECONDS);
            return List.of();
        });

        long t0 = System.nanoTime();
        runner.sweep();
        long millis = (System.nanoTime() - t0) / 1_000_000;
        release.countDown();

        assertThat(millis).isLessThan(500);
        verify(service, timeout(5000)).finalizeIfDone("batch-1");
    }

    @Test
    void anUnavailableStudentListLeavesTheCopiesForTheNextPass() {
        running("batch-1");
        when(service.pendingItems("batch-1")).thenReturn(List.of(pending("i1")));
        when(service.candidatesFor("a-1", "i-1")).thenThrow(new RuntimeException("admin-core 503"));

        runner.run("batch-1");

        verify(service, timeout(5000)).noteBatchError(eq("batch-1"), any());
        verify(service, timeout(1000).times(0)).identifyAndPlace(anyString(), anyList());
        verify(service, times(0)).finalizeIfDone("batch-1");
    }
}
