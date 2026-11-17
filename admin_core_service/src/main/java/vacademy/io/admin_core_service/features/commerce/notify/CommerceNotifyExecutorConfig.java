package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * The bounded executor that sends a buyer's messages right after the order change commits. A full
 * queue drops the task (the notification job picks the rows up within a minute).
 */
@Configuration
public class CommerceNotifyExecutorConfig {

    @Bean(name = "commerceNotifyExecutor")
    public ThreadPoolTaskExecutor commerceNotifyExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("commerce-notify-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(20);
        executor.initialize();
        return executor;
    }
}
