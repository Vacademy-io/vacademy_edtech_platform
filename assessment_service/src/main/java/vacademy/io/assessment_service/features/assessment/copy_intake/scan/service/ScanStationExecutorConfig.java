package vacademy.io.assessment_service.features.assessment.copy_intake.scan.service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * The scan station's own two threads. Each ai_service call holds a thread for
 * up to five minutes, so it must not sit on the {@code @Async} pool, the single
 * scheduler thread, or the copy-intake pools that read copy headers for every
 * bulk upload. A task the queue cannot take is rejected (never run on the
 * caller, which may be the scheduler), and the sweep offers it again.
 */
@Configuration
public class ScanStationExecutorConfig {

    @Bean("scanStationExecutor")
    public ThreadPoolTaskExecutor scanStationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("scan-station-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
