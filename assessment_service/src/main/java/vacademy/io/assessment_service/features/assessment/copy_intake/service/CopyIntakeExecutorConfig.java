package vacademy.io.assessment_service.features.assessment.copy_intake.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * Thread budget for the bulk copy intake, kept OFF the shared pools on purpose.
 *
 * <p>The default {@code @Async} pool (8 threads) is sized for live-exam marks
 * recalculation - see ReportExportExecutorConfig - and a 200-copy batch would
 * sit on one of those threads for ten minutes. The {@code @Scheduled} thread
 * is a single one shared with the evaluation poller; work that takes minutes
 * must never run on it. So: a small pool that orchestrates batches, and a
 * fixed pool that reads copy headers, shared by every batch so the AI service
 * never sees more than {@code identify-parallelism} header reads at once no
 * matter how many uploads are running.
 */
@Slf4j
@Configuration
public class CopyIntakeExecutorConfig {

    /** Batches processed at once; each one just coordinates its copies. */
    @Bean("copyIntakeBatchExecutor")
    public ThreadPoolTaskExecutor copyIntakeBatchExecutor(
            @Value("${assessment.copy-intake.batch-parallelism:2}") int batchParallelism) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(batchParallelism);
        executor.setMaxPoolSize(batchParallelism);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("copy-intake-batch-");
        // A pass the queue cannot take is not lost: the runner hears the
        // rejection, forgets the batch, and the sweep offers it again two
        // minutes later. Never CallerRuns here - the caller may be the
        // scheduler thread - and never Discard, which would swallow the
        // rejection the runner relies on.
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }

    /** Header reads in flight across ALL batches: one vision call each, ~5 s. */
    @Bean("copyIntakeIdentifyExecutor")
    public ThreadPoolTaskExecutor copyIntakeIdentifyExecutor(
            @Value("${assessment.copy-intake.identify-parallelism:2}") int identifyParallelism) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(identifyParallelism);
        executor.setMaxPoolSize(identifyParallelism);
        // Two full batches' worth; a copy that cannot be queued stays PENDING
        // and is picked up by the next pass.
        executor.setQueueCapacity(1000);
        executor.setThreadNamePrefix("copy-intake-read-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
