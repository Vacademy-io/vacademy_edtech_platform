package vacademy.io.admin_core_service.features.marketing.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Small dedicated pool for ad-spend syncs started outside the scheduled job (initial backfill
 * right after an ad account is connected, "Sync now" from the dashboard). Two threads: a backfill
 * makes a few dozen slow platform calls, and nothing else in the app should wait behind it.
 * When the queue is full the task is dropped (the 6-hourly job picks the account up anyway).
 */
@Configuration
public class MarketingAsyncConfig {

    public static final String MARKETING_SYNC_EXECUTOR = "marketingSyncExecutor";

    @Bean(name = MARKETING_SYNC_EXECUTOR)
    public Executor marketingSyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("mkt-sync-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
