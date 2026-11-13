package vacademy.io.assessment_service.features.assessment.service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * Own pool for the open-assessment lead calls ({@link OpenAssessmentLeadClient}). Kept off
 * workflowTriggerExecutor (2 threads, queue 200, drop-oldest): a results release sends one
 * call per registrant, and sharing that queue would push the ASSESSMENT_RESULT_RELEASED
 * workflow triggers out of it. One thread is enough — admin_core queues the work itself and
 * answers at once. Best-effort like the triggers: past the queue the oldest call is dropped
 * rather than blocking a learner request.
 */
@Configuration
public class OpenAssessmentLeadExecutorConfig {

    public static final String EXECUTOR = "openAssessmentLeadExecutor";

    @Bean(EXECUTOR)
    public ThreadPoolTaskExecutor openAssessmentLeadExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(20000);
        executor.setThreadNamePrefix("open-test-lead-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardOldestPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
