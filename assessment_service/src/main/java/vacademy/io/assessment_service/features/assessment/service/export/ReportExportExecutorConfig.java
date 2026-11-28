package vacademy.io.assessment_service.features.assessment.service.export;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * Declares the named, bounded executor for the bulk report export worker,
 * plus the explicit process-wide default for unqualified {@code @Async}.
 *
 * <p>History of the {@code taskExecutor} bean below: before this feature,
 * {@code taskScheduler} was the ONLY {@code TaskExecutor}-typed bean, so
 * Spring silently used it as the default for every unqualified
 * {@code @Async}. Adding {@code reportExportExecutor} made resolution
 * ambiguous, and Spring fell back to {@code SimpleAsyncTaskExecutor}
 * (unbounded thread-per-call) with a startup warning. Rather than leave the
 * platform default to that fallback, we pin it explicitly: a modest bounded
 * pool serving the release flow and other
 * unqualified {@code @Async} methods. Runtime-verified 2026-08-03.
 *
 * <p>Core 1 / max 1 on the export executor is deliberate, not a
 * placeholder: the Hikari pool is sized at 5 connections (plan C1), so
 * exactly one export worker process-wide is the concurrency budget this
 * feature gets. A queued job reports status {@code PENDING}, which the UI
 * must render distinctly from {@code IN_PROGRESS} (plan R4).
 */
@Configuration
public class ReportExportExecutorConfig {

    /**
     * Explicit default for unqualified @Async — see class comment.
     *
     * <p>Sized against the live-exam recalculation load: every learner sync
     * enqueues a marks recalc here, so at 200-1000 concurrent test-takers the
     * enqueue rate is roughly syncs-per-minute/60 per second. core MUST equal
     * max here: ThreadPoolExecutor only grows past core once the queue is FULL,
     * so with queue 100 a "max" above core would never be reached in time.
     * 8 threads with the (now 20-connection) Hikari pool keeps drain rate above
     * arrival rate; the CallerRunsPolicy below is the overload valve — past 100
     * queued, work degrades visibly onto Tomcat threads instead of being dropped.
     */
    @Bean("taskExecutor")
    public ThreadPoolTaskExecutor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("default-async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }

    /**
     * Small dedicated pool for fire-and-forget workflow trigger HTTP calls
     * ({@code WorkflowTriggerClient}). Kept OFF the default pool deliberately:
     * during a live exam that queue is full of marks recalcs, and a trigger
     * stuck behind them — or run inline via that pool's CallerRunsPolicy —
     * would block a learner request thread for up to connect+read timeout.
     * Triggers are best-effort, so under overload the oldest is dropped
     * rather than blocking anyone.
     */
    @Bean("workflowTriggerExecutor")
    public ThreadPoolTaskExecutor workflowTriggerExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("workflow-trigger-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardOldestPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }

    /**
     * Dedicated pool for post-submit LLM-analytics enrichment
     * ({@code AssessmentLLMAnalyticsService}). Found at the 1000-VU load test
     * (2026-08-27): the method was named Async but ran synchronously on the
     * Tomcat thread — per submit it built the enriched payload, ran the
     * comparison/rank query and called admin-core over HTTP, which serialized
     * the whole request pool during the submit wave (p95 submit 60s, plain
     * syncs starved to 16s). Analytics is documented fire-and-forget, so under
     * overload dropping the oldest job is correct; the deep queue means drops
     * only start past ~1000 pending submits' worth of work.
     */
    @Bean("assessmentAnalyticsExecutor")
    public ThreadPoolTaskExecutor assessmentAnalyticsExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(3);
        executor.setMaxPoolSize(3);
        executor.setQueueCapacity(1000);
        executor.setThreadNamePrefix("assessment-analytics-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardOldestPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }

    @Bean("reportExportExecutor")
    public ThreadPoolTaskExecutor reportExportExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("report-export-");
        // CallerRunsPolicy over AbortPolicy deliberately: at 50 queued jobs
        // something is already very wrong, but AbortPolicy would lose the job
        // silently while its row still says PENDING. Running it on the caller
        // (Tomcat) thread is a visible, if ugly, degradation — see
        // ARCHITECTURE.md §11, error taxonomy row "Executor queue full".
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
