package vacademy.io.admin_core_service.features.packages.service;

import com.github.benmanes.caffeine.cache.Expiry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackagePopularityProjection;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Institute-wide popularity RANKS of catalogue courses, for the public site's "Popular" sort and
 * its Bestseller / Popular badges. Served by {@code GET /open/packages/v1/popularity}.
 *
 * <p>Popularity = distinct learners actively enrolled across the course's ACTIVE and HIDDEN
 * batches (see {@link PackageRepository#countActiveLearnersPerCatalogPackage} for exactly who
 * counts). Only ranks leave this class -- never the counts.
 *
 * <p>Load safety, because this sits behind a public, unauthenticated URL:
 * <ul>
 *   <li>{@code @Cacheable(sync = true)} on the {@code catalogPopularityRanks} cache (registered in
 *       {@code CacheConfiguration}): one load per institute per pod at a time; concurrent misses
 *       for one institute wait for that load and then share its result. The browser/CDN cache on
 *       the endpoint (max-age=600) sits in front.</li>
 *   <li>A load never throws. sync = true caches results, not exceptions: if the load threw, every
 *       request queued behind it would run the query again, one after another, each costing up to
 *       the 10 s statement timeout or the read pool's connection timeout. So a failure is answered
 *       with {@link CatalogPopularityDTO#unavailable} (no ranks): the queued requests get it as
 *       soon as the failing load returns, and it stays cached for {@link #FAILURE_TTL} -- not the
 *       {@link #RANKS_TTL} of real ranks -- so the next attempt comes a minute later, once per
 *       institute per pod. The per-entry lifetime is {@link #cacheExpiry()}.</li>
 *   <li>The query runs in its own read-only transaction (always a new one), so
 *       {@code ReplicationRoutingDataSource} sends it to the read replica, never the primary, and
 *       a failure rolls back only that transaction. A swallowed exception inside a transaction it
 *       had joined would mark the caller's transaction rollback-only.</li>
 *   <li>The query itself is scoped to one institute, uses the partial enrolment indexes and has a
 *       10 s statement timeout.</li>
 * </ul>
 *
 * <p>Must stay a separate bean from its callers: {@code @Cacheable} only intercepts calls that
 * cross the Spring proxy. Replica lag is fine for ranks; do not reuse this read path for anything
 * that must read its own writes.
 */
@Slf4j
@Service
public class CatalogPopularityService {

    /** Registered in CacheConfiguration; a @Cacheable naming an unregistered cache throws at call time. */
    public static final String CACHE_NAME = "catalogPopularityRanks";

    /** How long loaded ranks stay cached per institute; also the endpoint's browser max-age. */
    public static final Duration RANKS_TTL = Duration.ofMinutes(10);

    /**
     * How long the no-ranks stand-in for a FAILED load stays cached before the next request for
     * that institute tries again. Until then requests are answered from memory, so a failing (or
     * slow to fail) query runs once per institute per pod per minute instead of once per request.
     */
    public static final Duration FAILURE_TTL = Duration.ofSeconds(60);

    /** A cache miss slower than this is logged at WARN so a degrading plan is noticed. */
    private static final long SLOW_QUERY_MS = 1_000;

    private final PackageRepository packageRepository;
    private final TransactionTemplate readOnlyTransaction;

    public CatalogPopularityService(PackageRepository packageRepository,
                                    PlatformTransactionManager transactionManager) {
        this.packageRepository = packageRepository;
        this.readOnlyTransaction = new TransactionTemplate(transactionManager);
        // Read-only: ReplicationRoutingDataSource picks the replica for read-only transactions.
        this.readOnlyTransaction.setReadOnly(true);
        // Always a new transaction: joining a caller's read-write one would skip the replica, and
        // rolling back after a failure would then poison the caller's transaction.
        this.readOnlyTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Ranks for one institute, cached per institute. Never throws for a failed load; answers
     * {@link CatalogPopularityDTO#unavailable} instead (see the class comment).
     *
     * @param instituteId the institute whose public catalogue is ranked; must not be null (it is
     *                    the cache key -- the controller rejects blank ids before calling)
     */
    @Cacheable(value = CACHE_NAME, key = "#instituteId", sync = true)
    public CatalogPopularityDTO getPopularity(String instituteId) {
        long startedAt = System.nanoTime();
        try {
            List<CatalogPopularityDTO.PackageRank> ranks = rank(readOnlyTransaction.execute(
                    status -> packageRepository.countActiveLearnersPerCatalogPackage(instituteId)));
            long tookMs = elapsedMs(startedAt);
            if (tookMs > SLOW_QUERY_MS) {
                log.warn("Catalogue popularity ranks for institute={} took {} ms ({} ranked courses)",
                        instituteId, tookMs, ranks.size());
            } else {
                log.debug("Catalogue popularity ranks for institute={} took {} ms ({} ranked courses)",
                        instituteId, tookMs, ranks.size());
            }
            return new CatalogPopularityDTO(instituteId, ranks);
        } catch (RuntimeException e) {
            log.warn("Catalogue popularity ranks for institute={} failed after {} ms; answering no ranks"
                            + " for the next {} s instead of retrying per request",
                    instituteId, elapsedMs(startedAt), FAILURE_TTL.toSeconds(), e);
            return CatalogPopularityDTO.unavailable(instituteId);
        }
    }

    /**
     * Per-entry lifetime of the {@code catalogPopularityRanks} cache, wired in by
     * CacheConfiguration: {@link #RANKS_TTL} for loaded ranks, {@link #FAILURE_TTL} for the
     * stand-in of a failed load. Counted from when the entry was written; reads never extend it.
     */
    public static Expiry<Object, Object> cacheExpiry() {
        return new CacheEntryLifetime();
    }

    /** How long one cached value may live (see {@link #cacheExpiry()}). */
    static Duration timeToLive(Object cachedValue) {
        return cachedValue instanceof CatalogPopularityDTO popularity && popularity.isUnavailable()
                ? FAILURE_TTL
                : RANKS_TTL;
    }

    /**
     * Learner counts to ranks: most learners first; equal counts are ordered by package id
     * (ascending), so the same data always yields the same ranks on every pod and every refresh.
     * Ranks are unique and consecutive from 1. Rows without an id or without a positive count are
     * dropped -- a course nobody is enrolled in has no rank.
     */
    static List<CatalogPopularityDTO.PackageRank> rank(List<PackagePopularityProjection> rows) {
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        // The query groups by course, so ids are unique; merge defensively all the same, keeping
        // the larger count (adding two DISTINCT counts could count one learner twice).
        Map<String, Long> learnersByPackage = new HashMap<>();
        for (PackagePopularityProjection row : rows) {
            if (row == null) {
                continue;
            }
            String packageId = row.getPackageId();
            Long learners = row.getLearnerCount();
            if (packageId == null || packageId.isBlank() || learners == null || learners <= 0) {
                continue;
            }
            learnersByPackage.merge(packageId, learners, Math::max);
        }

        List<Map.Entry<String, Long>> ordered = new ArrayList<>(learnersByPackage.entrySet());
        ordered.sort(Map.Entry.<String, Long>comparingByValue(Comparator.reverseOrder())
                .thenComparing(Map.Entry.<String, Long>comparingByKey()));

        List<CatalogPopularityDTO.PackageRank> ranks = new ArrayList<>(ordered.size());
        for (int i = 0; i < ordered.size(); i++) {
            ranks.add(new CatalogPopularityDTO.PackageRank(ordered.get(i).getKey(), i + 1));
        }
        return List.copyOf(ranks);
    }

    private static long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }

    /** Caffeine variable expiry backed by {@link #timeToLive(Object)}. */
    private static final class CacheEntryLifetime implements Expiry<Object, Object> {

        @Override
        public long expireAfterCreate(Object key, Object value, long currentTime) {
            return timeToLive(value).toNanos();
        }

        @Override
        public long expireAfterUpdate(Object key, Object value, long currentTime, long currentDuration) {
            // A put over an existing entry (e.g. real ranks replacing a stand-in) gets the new
            // value's full lifetime.
            return timeToLive(value).toNanos();
        }

        @Override
        public long expireAfterRead(Object key, Object value, long currentTime, long currentDuration) {
            return currentDuration;
        }
    }
}
