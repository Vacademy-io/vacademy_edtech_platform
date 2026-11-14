package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * Threads that send AI evaluations to ai_service, kept OFF the shared default
 * {@code @Async} pool (AI_EVALUATION_PUBLIC_API.md 11.2).
 *
 * <p>That pool (8 threads, ReportExportExecutorConfig) also runs the live-exam marks
 * recalculation on every learner sync; a burst of dispatches - each one an HTTP call
 * of up to ~30 s with retries - sat in front of those recalcs. Dispatch is now short
 * (payload build in one transaction, the HTTP call outside it, a one-row update
 * after), so a small pool keeps up with the lane caps.
 *
 * <p>AbortPolicy, never CallerRuns: the caller is the scheduler thread (the poller) or
 * an after-commit hook on a request thread. A rejected dispatch is handed back to the
 * queue by its caller and the next tick retries it.
 */
@Configuration
public class AiEvaluationDispatchExecutorConfig {

    public static final String EXECUTOR = "aiEvaluationDispatchExecutor";

    @Bean(EXECUTOR)
    public ThreadPoolTaskExecutor aiEvaluationDispatchExecutor(
            @Value("${assessment.ai-evaluation.dispatch-threads:4}") int threads,
            @Value("${assessment.ai-evaluation.dispatch-queue:100}") int queue) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(threads);
        executor.setMaxPoolSize(threads);
        executor.setQueueCapacity(queue);
        executor.setThreadNamePrefix("ai-eval-dispatch-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
