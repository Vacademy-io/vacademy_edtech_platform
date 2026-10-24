package vacademy.io.notification_service.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Async configuration for announcement delivery
 * Enables background processing of large email batches without blocking HTTP requests
 */
@Configuration
@EnableAsync
@Slf4j
public class AsyncConfig {
    
    /**
     * Executor for announcement delivery tasks
     * Configured for handling large email batches (up to 100K+ recipients)
     * 
     * Pool size:
     * - Core: 5 threads (always active for consistent throughput)
     * - Max: 10 threads (scales up for concurrent announcements)
     * - Queue: 50 (allows some buffering without memory issues)
     * 
     * Rejection policy: CallerRunsPolicy
     * - If queue is full, caller thread processes the task (provides backpressure)
     */
    @Bean(name = "announcementDeliveryExecutor")
    public Executor announcementDeliveryExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        
        // Core pool size - threads that are always active
        executor.setCorePoolSize(5);
        
        // Maximum pool size - scales up when queue is full
        executor.setMaxPoolSize(10);
        
        // Queue capacity - number of tasks that can wait
        executor.setQueueCapacity(50);
        
        // Thread naming pattern for easy identification in logs
        executor.setThreadNamePrefix("announcement-delivery-");
        
        // When queue is full, caller runs the task (provides backpressure)
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        
        // Allow core threads to timeout when idle (saves resources)
        executor.setAllowCoreThreadTimeOut(true);
        executor.setKeepAliveSeconds(60);
        
        // Wait for tasks to complete on shutdown (graceful shutdown)
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(60);
        
        executor.initialize();
        
        log.info("Initialized announcement delivery executor: corePoolSize={}, maxPoolSize={}, queueCapacity={}",
                executor.getCorePoolSize(), executor.getMaxPoolSize(), executor.getQueueCapacity());

        return executor;
    }

    /**
     * Dedicated executor for best-effort chat offline-push fan-out, kept SEPARATE from the announcement
     * delivery / SSE fan-out pool so FCM I/O can never starve live message delivery. On overflow it
     * DISCARDs (push is best-effort; the message is already persisted + delivered over SSE) rather than
     * running on the caller thread, so the committing/publishing path is never blocked behind FCM.
     */
    /**
     * Community-channel push fan-out (up to hundreds of recipients per message) on its own small pool, so a
     * busy community can never queue up or — via DiscardPolicy — drop DM and batch pushes on chatPushExecutor.
     */
    @Bean(name = "chatCommunityPushExecutor")
    public Executor chatCommunityPushExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("chat-community-push-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardPolicy());
        executor.setAllowCoreThreadTimeOut(true);
        executor.setKeepAliveSeconds(60);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    @Bean(name = "chatPushExecutor")
    public Executor chatPushExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("chat-push-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardPolicy());
        executor.setAllowCoreThreadTimeOut(true);
        executor.setKeepAliveSeconds(60);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        log.info("Initialized chat push executor: corePoolSize={}, maxPoolSize={}, queueCapacity={}",
                executor.getCorePoolSize(), executor.getMaxPoolSize(), executor.getQueueCapacity());
        return executor;
    }
}

