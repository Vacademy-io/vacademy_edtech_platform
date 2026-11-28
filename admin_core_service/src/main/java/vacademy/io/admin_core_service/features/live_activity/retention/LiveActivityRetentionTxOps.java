package vacademy.io.admin_core_service.features.live_activity.retention;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.live_activity.repository.UserLiveEventRepository;

import java.sql.Timestamp;

/**
 * One chunk of the retention delete, in its own transaction.
 *
 * <p>Separate bean for two reasons. A @Modifying query needs a transaction at all, and
 * Spring's proxy-based @Transactional is skipped entirely on a self-invocation, so
 * annotating a private helper on the job itself would silently do nothing.
 *
 * <p>More importantly, REQUIRES_NEW per batch is what makes chunking worth doing. Wrapping
 * the whole loop in one transaction -- as the admin-activity-log retention job does -- holds
 * every row lock it takes until the last batch finishes, which is the opposite of the short
 * locks chunking exists to provide.
 */
@Component
@RequiredArgsConstructor
public class LiveActivityRetentionTxOps {

    private final UserLiveEventRepository repository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int deleteBatch(String category, Timestamp cutoff, int batchSize) {
        return repository.deleteByCategoryOlderThan(category, cutoff, batchSize);
    }
}
