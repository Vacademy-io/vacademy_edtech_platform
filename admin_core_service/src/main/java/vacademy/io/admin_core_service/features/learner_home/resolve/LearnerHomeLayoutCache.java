package vacademy.io.admin_core_service.features.learner_home.resolve;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeLayout;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeBlockRepository;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeLayoutRepository;
import vacademy.io.admin_core_service.features.learner_home.service.BlockMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Per-pod cache of each institute's PUBLISHED layout. "No layout" is cached too, so an institute
 * that never published costs no query. Publish, unpublish and restore evict locally; other pods
 * catch up within the TTL.
 */
@Slf4j
@Component
public class LearnerHomeLayoutCache {

    public static final Duration TTL = Duration.ofSeconds(60);

    private final LearnerHomeLayoutRepository layoutRepository;
    private final LearnerHomeBlockRepository blockRepository;
    private final LearnerHomeJdbc jdbc;
    private final TransactionTemplate tx;
    private final Cache<String, Optional<PublishedLayout>> cache = Caffeine.newBuilder()
            .maximumSize(20_000)
            .expireAfterWrite(TTL)
            .build();

    public LearnerHomeLayoutCache(LearnerHomeLayoutRepository layoutRepository,
                                  LearnerHomeBlockRepository blockRepository, LearnerHomeJdbc jdbc,
                                  PlatformTransactionManager transactionManager) {
        this.layoutRepository = layoutRepository;
        this.blockRepository = blockRepository;
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public Optional<PublishedLayout> get(String instituteId) {
        return cache.get(instituteId, this::load);
    }

    /** Evicts now and again after the surrounding transaction completes. */
    public void evict(String instituteId) {
        cache.invalidate(instituteId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    cache.invalidate(instituteId);
                }
            });
        }
    }

    /**
     * Read in a read-write transaction on purpose: repository reads outside one are routed to the
     * replica, and a reload right after publish must not cache a lagging copy for a minute.
     */
    Optional<PublishedLayout> load(String instituteId) {
        return tx.execute(status -> loadOnPrimary(instituteId));
    }

    private Optional<PublishedLayout> loadOnPrimary(String instituteId) {
        Optional<LearnerHomeLayout> layout =
                layoutRepository.findFirstByInstituteIdAndStatus(instituteId, LearnerHomeLayout.PUBLISHED);
        if (layout.isEmpty()) {
            return Optional.empty();
        }
        List<Issue> issues = new ArrayList<>();
        List<Block> blocks = BlockMapper.fromEntities(
                blockRepository.findByLayoutIdOrderByPositionAsc(layout.get().getId()), issues);
        if (!issues.isEmpty()) {
            log.warn("[learner-home] institute {} published v{} has {} unreadable parts: {}", instituteId,
                    layout.get().getVersion(), issues.size(), issues.get(0));
        }
        Map<String, Block> byKey = new LinkedHashMap<>();
        blocks.forEach(b -> byKey.put(b.blockKey(), b));
        Set<String> eventKeys = new HashSet<>(byKey.keySet());
        try {
            eventKeys.addAll(jdbc.recentPublishedKeys(instituteId));
        } catch (RuntimeException e) {
            log.warn("[learner-home] previous-version keys unavailable for {}: {}", instituteId, e.getMessage());
        }
        return Optional.of(new PublishedLayout(layout.get().getId(), layout.get().getVersion(),
                BlockMapper.settings(layout.get()), List.copyOf(blocks), Collections.unmodifiableMap(byKey),
                Collections.unmodifiableSet(eventKeys)));
    }
}
