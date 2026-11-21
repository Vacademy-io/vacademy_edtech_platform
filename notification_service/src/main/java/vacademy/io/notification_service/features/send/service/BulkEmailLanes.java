package vacademy.io.notification_service.features.send.service;

import com.google.common.util.concurrent.RateLimiter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Lanes for paced bulk email batches: one queue per institute and source, and one rate limiter per
 * institute shared by all of its queues.
 *
 * <p>A workflow fans out into hundreds of small batches and a student blast is one huge batch. Both
 * count against the same per-minute budget here, so splitting a send does not make it faster, and
 * the number of running threads stays bounded however many batches are queued. Queues are per source
 * so a workflow's hundreds of batches do not make a lead campaign wait behind them.
 *
 * <p>Limits apply per pod. With more than one replica the effective rate is multiplied.
 */
@Component
public class BulkEmailLanes {

    private final double permitsPerSecond;
    private final int workersPerSource;
    private final Map<String, ThreadPoolExecutor> queues = new ConcurrentHashMap<>();
    private final Map<String, RateLimiter> limiters = new ConcurrentHashMap<>();
    private final Set<String> pendingBatchIds = ConcurrentHashMap.newKeySet();

    public BulkEmailLanes(
            @Value("${notification.bulk-email.per-minute:500}") int perMinute,
            @Value("${notification.bulk-email.batches-per-source:3}") int workersPerSource) {
        this.permitsPerSecond = Math.max(1, perMinute) / 60.0;
        this.workersPerSource = Math.max(1, workersPerSource);
    }

    /** Queues a batch. Returns false if this pod already holds that batch. */
    public boolean submit(String instituteId, String source, String batchId, Runnable task) {
        if (!pendingBatchIds.add(batchId)) {
            return false;
        }
        queue(instituteId, source).execute(() -> {
            try {
                task.run();
            } finally {
                pendingBatchIds.remove(batchId);
            }
        });
        return true;
    }

    /** True while this pod has the batch queued or running. */
    public boolean isPending(String batchId) {
        return pendingBatchIds.contains(batchId);
    }

    /** Blocks until the institute's budget allows this many more emails. */
    public void acquire(String instituteId, int emails) {
        if (emails > 0) {
            limiters.computeIfAbsent(key(instituteId), k -> RateLimiter.create(permitsPerSecond)).acquire(emails);
        }
    }

    private static String key(String value) {
        return value == null ? "" : value;
    }

    private ThreadPoolExecutor queue(String instituteId, String source) {
        return queues.computeIfAbsent(key(instituteId) + "|" + key(source), key -> {
            ThreadPoolExecutor executor = new ThreadPoolExecutor(
                    workersPerSource, workersPerSource, 60, TimeUnit.SECONDS, new LinkedBlockingQueue<>(),
                    runnable -> {
                        Thread thread = new Thread(runnable, "bulk-email-lane");
                        thread.setDaemon(true);
                        return thread;
                    });
            executor.allowCoreThreadTimeOut(true);
            return executor;
        });
    }
}
