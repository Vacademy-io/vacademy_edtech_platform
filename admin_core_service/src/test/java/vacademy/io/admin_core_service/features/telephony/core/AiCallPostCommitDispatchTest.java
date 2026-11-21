package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The auto-book + send-rule task registered for afterCommit() must never run on the committing
 * thread: the committed transaction is still bound there, so its writes join a finished
 * transaction (booking: "no transaction is in progress"; actions: logged, never written).
 */
class AiCallPostCommitDispatchTest {

    private static AiCallOutcomeProcessor processor(Executor executor) {
        AiCallOutcomeProcessor p = mock(AiCallOutcomeProcessor.class, CALLS_REAL_METHODS);
        ReflectionTestUtils.setField(p, "postCallExecutor", executor);
        return p;
    }

    @Test
    @DisplayName("the post-call task goes to the post-call pool, not inline")
    void usesThePool() {
        Executor executor = mock(Executor.class);
        Runnable task = mock(Runnable.class);
        processor(executor).runOffThread(task, "r1");
        verify(executor).execute(task);
        verify(task, never()).run();
    }

    @Test
    @DisplayName("no pool, or a full one: still another thread, never the committing one")
    void neverInline() throws Exception {
        Executor full = mock(Executor.class);
        doThrow(new RejectedExecutionException("full")).when(full).execute(any());
        for (Executor e : new Executor[]{null, full}) {
            CountDownLatch done = new CountDownLatch(1);
            AtomicReference<Thread> ranOn = new AtomicReference<>();
            processor(e).runOffThread(() -> {
                ranOn.set(Thread.currentThread());
                done.countDown();
            }, "r2");
            assertTrue(done.await(5, TimeUnit.SECONDS), "task ran");
            assertNotSame(Thread.currentThread(), ranOn.get());
        }
    }
}
