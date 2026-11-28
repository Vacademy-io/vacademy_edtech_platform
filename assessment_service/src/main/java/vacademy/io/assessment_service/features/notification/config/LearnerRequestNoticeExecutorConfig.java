package vacademy.io.assessment_service.features.notification.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * Small dedicated pool for the role-wise staff notices about learner requests
 * ({@code LearnerRequestStaffNotifier}). Kept OFF the default {@code taskExecutor}: that pool
 * carries the marks recalculation of every learner sync during a live exam, and its
 * CallerRunsPolicy would run a notice (several internal HTTP calls) on the learner's request
 * thread once it is full. Notices are best-effort, so under overload the oldest is dropped
 * rather than blocking anyone.
 */
@Configuration
public class LearnerRequestNoticeExecutorConfig {

    @Bean("learnerRequestNoticeExecutor")
    public ThreadPoolTaskExecutor learnerRequestNoticeExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("learner-request-notice-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardOldestPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
