package vacademy.io.admin_core_service.features.audience.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Pool that runs the rows of a lead bulk import (AudienceService.bulkSubmitLead) a few at a
 * time instead of strictly one after another.
 *
 * One pool per pod, shared by every import, so the extra load stays bounded however many
 * admins (or scripts) import at once: at most {@code lead.bulk-import.parallelism} leads are
 * being created by imports at any moment. Kept small on purpose: each lead holds a DB
 * connection while it saves (the pod's Hikari pool is 8) and admin-core pods run close to
 * their memory limit.
 *
 * A full queue (or a pool shutting down) rejects the task, and bulkSubmitLead then runs those
 * rows on the request thread itself, so nothing is ever dropped or left waiting.
 * {@code lead.bulk-import.parallelism=1} turns parallelism off: bulkSubmitLead then processes
 * rows sequentially on the request thread, exactly as before.
 */
@Configuration
public class LeadBulkImportExecutorConfig {

    public static final String EXECUTOR = "leadBulkImportExecutor";

    @Bean(name = EXECUTOR)
    public Executor leadBulkImportExecutor(@Value("${lead.bulk-import.parallelism:3}") int parallelism) {
        int threads = Math.max(1, parallelism);
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(threads);
        executor.setMaxPoolSize(threads);
        executor.setQueueCapacity(10000);
        executor.setThreadNamePrefix("lead-bulk-import-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.initialize();
        return executor;
    }
}
