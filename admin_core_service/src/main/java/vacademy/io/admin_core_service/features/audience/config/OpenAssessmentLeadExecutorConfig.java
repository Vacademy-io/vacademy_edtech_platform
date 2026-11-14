package vacademy.io.admin_core_service.features.audience.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * Own pool for open-assessment lead updates (OpenAssessmentLeadService). Releasing results for
 * a whole test sends one update per registrant at once — thousands — and on the shared
 * workflowTaskExecutor (queue 50, abort on overflow) that burst would make unrelated
 * workflow tasks, like a webinar's form-submission workflow, get rejected. Two threads keep
 * the DB load of a burst flat; the deep queue holds a big release; past it the newest
 * update is dropped and logged rather than anything else being refused.
 */
@Configuration
public class OpenAssessmentLeadExecutorConfig {

    private static final Logger logger = LoggerFactory.getLogger(OpenAssessmentLeadExecutorConfig.class);

    public static final String EXECUTOR = "openAssessmentLeadExecutor";

    @Bean(name = EXECUTOR)
    public Executor openAssessmentLeadExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(20000);
        executor.setThreadNamePrefix("open-test-lead-");
        executor.setRejectedExecutionHandler((task, pool) ->
                logger.warn("Open-assessment lead queue full ({} queued) — update dropped", pool.getQueue().size()));
        executor.initialize();
        return executor;
    }
}
