package vacademy.io.admin_core_service.features.packages.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.config.CacheConfiguration;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackagePopularityProjection;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;

import java.lang.reflect.Method;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CatalogPopularityServiceTest {

    private final PackageRepository repository = mock(PackageRepository.class);
    private final RecordingTransactionManager transactionManager = new RecordingTransactionManager();
    private final CatalogPopularityService service = new CatalogPopularityService(repository, transactionManager);

    private static PackagePopularityProjection row(String packageId, Long learners) {
        return new PackagePopularityProjection() {
            @Override
            public String getPackageId() {
                return packageId;
            }

            @Override
            public Long getLearnerCount() {
                return learners;
            }
        };
    }

    private static List<String> idsInRankOrder(CatalogPopularityDTO dto) {
        return dto.getRanks().stream().map(CatalogPopularityDTO.PackageRank::getPackageId).toList();
    }

    // ---------------------------------------------------------------- ranking

    @Test
    @DisplayName("Rank 1 is the course with the most learners; ranks are consecutive from 1")
    void mostLearnersRanksFirst() {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1")).thenReturn(List.of(
                row("pkg-small", 2L), row("pkg-big", 120L), row("pkg-mid", 15L)));

        CatalogPopularityDTO dto = service.getPopularity("inst-1");

        assertThat(dto.getInstituteId()).isEqualTo("inst-1");
        assertThat(dto.isUnavailable()).isFalse();
        assertThat(idsInRankOrder(dto)).containsExactly("pkg-big", "pkg-mid", "pkg-small");
        assertThat(dto.getRanks()).extracting(CatalogPopularityDTO.PackageRank::getRank).containsExactly(1, 2, 3);
        verify(repository, times(1)).countActiveLearnersPerCatalogPackage("inst-1");
    }

    @Test
    @DisplayName("Equal counts are ordered by package id, whatever order the rows arrive in")
    void tiesAreBrokenDeterministically() {
        List<PackagePopularityProjection> rows = new ArrayList<>(List.of(
                row("pkg-c", 7L), row("pkg-a", 7L), row("pkg-top", 9L), row("pkg-b", 7L), row("pkg-last", 1L)));

        List<String> first = null;
        for (int shuffle = 0; shuffle < 20; shuffle++) {
            Collections.shuffle(rows, new java.util.Random(shuffle));
            List<String> ranked = CatalogPopularityService.rank(rows).stream()
                    .map(CatalogPopularityDTO.PackageRank::getPackageId).toList();
            if (first == null) {
                first = ranked;
            }
            assertThat(ranked).isEqualTo(first);
        }
        assertThat(first).containsExactly("pkg-top", "pkg-a", "pkg-b", "pkg-c", "pkg-last");
        // ties do NOT share a rank: ranks stay unique so "top N" is always exactly N courses
        assertThat(CatalogPopularityService.rank(rows))
                .extracting(CatalogPopularityDTO.PackageRank::getRank).containsExactly(1, 2, 3, 4, 5);
    }

    @Test
    @DisplayName("Courses without learners, without an id, or with a null count get no rank")
    void unrankableRowsAreOmitted() {
        List<PackagePopularityProjection> rows = Arrays.asList(
                row("pkg-zero", 0L),
                row("pkg-null-count", null),
                row(null, 50L),
                row("  ", 40L),
                null,
                row("pkg-real", 3L));

        assertThat(CatalogPopularityService.rank(rows))
                .extracting(CatalogPopularityDTO.PackageRank::getPackageId).containsExactly("pkg-real");
        assertThat(CatalogPopularityService.rank(rows))
                .extracting(CatalogPopularityDTO.PackageRank::getRank).containsExactly(1);
    }

    @Test
    @DisplayName("An institute with no enrolments (or no rows at all) gets an empty list, not an error")
    void noRowsMeansNoRanks() {
        when(repository.countActiveLearnersPerCatalogPackage("inst-empty")).thenReturn(List.of());

        CatalogPopularityDTO dto = service.getPopularity("inst-empty");

        assertThat(dto.getRanks()).isEmpty();
        // a real (if empty) answer: cached the full 10 minutes, not the failure stand-in
        assertThat(dto.isUnavailable()).isFalse();
        assertThat(CatalogPopularityService.rank(null)).isEmpty();
    }

    @Test
    @DisplayName("A duplicated course id keeps the larger count instead of adding two distinct counts")
    void duplicateRowsAreMergedNotSummed() {
        List<PackagePopularityProjection> rows = List.of(
                row("pkg-dup", 4L), row("pkg-other", 6L), row("pkg-dup", 5L));

        // summing would give pkg-dup 9 and rank it first; max keeps it at 5, behind pkg-other
        assertThat(CatalogPopularityService.rank(rows))
                .extracting(CatalogPopularityDTO.PackageRank::getPackageId).containsExactly("pkg-other", "pkg-dup");
    }

    @Test
    @DisplayName("The JSON carries institute_id and package_id/rank only -- never a learner count")
    void wireShapeHasRanksButNoCounts() throws Exception {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1")).thenReturn(List.of(
                row("pkg-a", 4321L), row("pkg-b", 987L)));

        ObjectMapper mapper = new ObjectMapper();
        String json = mapper.writeValueAsString(service.getPopularity("inst-1"));
        JsonNode body = mapper.readTree(json);

        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("institute_id", "ranks");
        assertThat(body.get("institute_id").asText()).isEqualTo("inst-1");
        assertThat(body.get("ranks")).hasSize(2);
        for (JsonNode rank : body.get("ranks")) {
            assertThat(rank.fieldNames()).toIterable().containsExactlyInAnyOrder("package_id", "rank");
        }
        assertThat(body.get("ranks").get(0).get("package_id").asText()).isEqualTo("pkg-a");
        assertThat(body.get("ranks").get(0).get("rank").asInt()).isEqualTo(1);
        assertThat(json).doesNotContain("4321").doesNotContain("987");
    }

    @Test
    @DisplayName("The cached value is immutable (Caffeine hands the same instance to every caller)")
    void resultIsImmutable() {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1")).thenReturn(List.of(row("pkg-a", 1L)));

        CatalogPopularityDTO dto = service.getPopularity("inst-1");

        assertThatThrownBy(() -> dto.getRanks().add(new CatalogPopularityDTO.PackageRank("pkg-x", 9)))
                .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> dto.getRanks().clear()).isInstanceOf(UnsupportedOperationException.class);

        List<CatalogPopularityDTO.PackageRank> source = new ArrayList<>();
        source.add(new CatalogPopularityDTO.PackageRank("pkg-a", 1));
        CatalogPopularityDTO copy = new CatalogPopularityDTO("inst-1", source);
        source.add(new CatalogPopularityDTO.PackageRank("pkg-b", 2));
        assertThat(copy.getRanks()).hasSize(1);
    }

    // ------------------------------------------------- cache + replica wiring

    @Test
    @DisplayName("Cached per institute with sync=true; the cached method itself opens no transaction")
    void cacheAnnotationAndNoTransactionAroundTheCatch() throws Exception {
        Method method = CatalogPopularityService.class.getMethod("getPopularity", String.class);

        Cacheable cacheable = AnnotatedElementUtils.findMergedAnnotation(method, Cacheable.class);
        assertThat(cacheable).isNotNull();
        assertThat(cacheable.cacheNames()).containsExactly(CatalogPopularityService.CACHE_NAME);
        assertThat(CatalogPopularityService.CACHE_NAME).isEqualTo("catalogPopularityRanks");
        assertThat(cacheable.key()).isEqualTo("#instituteId");
        assertThat(cacheable.sync()).isTrue();

        // The failure catch must sit OUTSIDE the query's transaction (the query gets its own, via
        // the template): a transaction around the catch is exactly what turns a swallowed failure
        // into "marked rollback-only" for whoever opened it.
        assertThat(AnnotatedElementUtils.findMergedAnnotation(method, Transactional.class)).isNull();
        assertThat(AnnotatedElementUtils.findMergedAnnotation(CatalogPopularityService.class, Transactional.class))
                .isNull();
        assertThat(method.getAnnotation(jakarta.transaction.Transactional.class)).isNull();
        assertThat(CatalogPopularityService.class.getAnnotation(jakarta.transaction.Transactional.class)).isNull();
    }

    @Test
    @DisplayName("The query runs inside its own new read-only transaction (the replica route), then commits")
    void queryRunsInItsOwnReadOnlyTransaction() {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1")).thenAnswer(invocation -> {
            // exactly what ReplicationRoutingDataSource reads to pick the replica
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly()).isTrue();
            return List.of(row("pkg-a", 2L));
        });

        CatalogPopularityDTO dto = service.getPopularity("inst-1");

        assertThat(idsInRankOrder(dto)).containsExactly("pkg-a");
        assertThat(transactionManager.begun).singleElement().satisfies(definition -> {
            assertThat(definition.isReadOnly()).isTrue();
            assertThat(definition.getPropagationBehavior())
                    .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        });
        assertThat(transactionManager.commits).hasValue(1);
        assertThat(transactionManager.rollbacks).hasValue(0);
        assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly()).isFalse();
    }

    // ------------------------------------------------------------- failures

    static Stream<Arguments> loadFailures() {
        return Stream.of(
                Arguments.of("statement timeout", new QueryTimeoutException("canceling statement due to user request")),
                Arguments.of("no replica connection",
                        new DataAccessResourceFailureException("Unable to acquire JDBC Connection")),
                Arguments.of("anything else", new IllegalStateException("unexpected")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("loadFailures")
    @DisplayName("A failed load answers 'no ranks' (the unavailable stand-in) instead of throwing")
    void failedLoadAnswersNoRanksInsteadOfThrowing(String what, RuntimeException failure) {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1")).thenThrow(failure);

        CatalogPopularityDTO dto = service.getPopularity("inst-1");

        assertThat(dto.getInstituteId()).isEqualTo("inst-1");
        assertThat(dto.getRanks()).isEmpty();
        assertThat(dto.isUnavailable()).isTrue();
        // only the query's own transaction is rolled back
        assertThat(transactionManager.rollbacks).hasValue(1);
        assertThat(transactionManager.commits).hasValue(0);
    }

    @Test
    @DisplayName("Failing to even open the read transaction also answers 'no ranks', without querying")
    void failureToOpenTheTransactionAnswersNoRanks() {
        transactionManager.failBegin = new CannotCreateTransactionException("Could not open JPA EntityManager");

        CatalogPopularityDTO dto = service.getPopularity("inst-1");

        assertThat(dto.isUnavailable()).isTrue();
        assertThat(dto.getRanks()).isEmpty();
        verify(repository, never()).countActiveLearnersPerCatalogPackage(anyString());
    }

    @Test
    @DisplayName("On the wire the stand-in is plain 'no ranks': no flag, no extra field")
    void unavailableStandInSerialisesAsPlainNoRanks() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode body = mapper.readTree(mapper.writeValueAsString(CatalogPopularityDTO.unavailable("inst-1")));

        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("institute_id", "ranks");
        assertThat(body.get("institute_id").asText()).isEqualTo("inst-1");
        assertThat(body.get("ranks").isArray()).isTrue();
        assertThat(body.get("ranks")).isEmpty();
    }

    // ------------------------------------------------------ cache lifetimes

    @Test
    @DisplayName("Ranks (even an empty list) live 10 minutes; only the failure stand-in is short-lived")
    void cacheLifetimes() {
        CatalogPopularityDTO ranked = new CatalogPopularityDTO("inst-1",
                List.of(new CatalogPopularityDTO.PackageRank("pkg-a", 1)));

        assertThat(CatalogPopularityService.RANKS_TTL).isEqualTo(Duration.ofMinutes(10));
        assertThat(CatalogPopularityService.timeToLive(ranked)).isEqualTo(CatalogPopularityService.RANKS_TTL);
        assertThat(CatalogPopularityService.timeToLive(CatalogPopularityDTO.empty("inst-1")))
                .isEqualTo(CatalogPopularityService.RANKS_TTL);
        assertThat(CatalogPopularityService.timeToLive(CatalogPopularityDTO.unavailable("inst-1")))
                .isEqualTo(CatalogPopularityService.FAILURE_TTL);
        // short enough that ranks come back soon after the replica does, long enough that a burst
        // of requests (or the queue behind a failing load) does not re-run the query
        assertThat(CatalogPopularityService.FAILURE_TTL).isBetween(Duration.ofSeconds(30), Duration.ofSeconds(60));
        assertThat(CatalogPopularityService.timeToLive("anything else")).isEqualTo(CatalogPopularityService.RANKS_TTL);
    }

    @Test
    @DisplayName("With the cache's expiry: the stand-in is gone after a minute, ranks stay 10 minutes")
    void standInExpiresAfterAMinuteWhileRanksStayTenMinutes() {
        AtomicLong nanos = new AtomicLong();
        Cache<Object, Object> cache = Caffeine.newBuilder()
                .expireAfter(CatalogPopularityService.cacheExpiry())
                .ticker(nanos::get)
                .executor(Runnable::run)
                .build();
        CatalogPopularityDTO ranked = new CatalogPopularityDTO("ranked",
                List.of(new CatalogPopularityDTO.PackageRank("pkg-a", 1)));

        cache.put("failed", CatalogPopularityDTO.unavailable("failed"));
        cache.put("ranked", ranked);

        nanos.addAndGet(CatalogPopularityService.FAILURE_TTL.minusSeconds(1).toNanos());
        assertThat(cache.getIfPresent("failed")).as("stand-in just before its minute is up").isNotNull();
        nanos.addAndGet(Duration.ofSeconds(2).toNanos());
        assertThat(cache.getIfPresent("failed")).as("stand-in after its minute: the next request retries").isNull();
        assertThat(cache.getIfPresent("ranked")).as("ranks still cached (reads do not extend them)").isSameAs(ranked);

        nanos.addAndGet(CatalogPopularityService.RANKS_TTL.minus(CatalogPopularityService.FAILURE_TTL).toNanos());
        assertThat(cache.getIfPresent("ranked")).as("ranks after 10 minutes from their write").isNull();

        // real ranks written over a stand-in get the full 10 minutes from that write
        cache.put("recovering", CatalogPopularityDTO.unavailable("recovering"));
        nanos.addAndGet(Duration.ofSeconds(30).toNanos());
        cache.put("recovering", ranked);
        nanos.addAndGet(CatalogPopularityService.FAILURE_TTL.toNanos());
        assertThat(cache.getIfPresent("recovering")).isSameAs(ranked);
        nanos.addAndGet(CatalogPopularityService.RANKS_TTL.toNanos());
        assertThat(cache.getIfPresent("recovering")).isNull();
    }

    // ------------------------------------------ through the real cache manager

    private AnnotationConfigApplicationContext cachingContext() {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(CacheConfiguration.class);
        context.registerBean(PackageRepository.class, () -> repository);
        context.registerBean(PlatformTransactionManager.class, () -> transactionManager);
        context.registerBean(CatalogPopularityService.class);
        context.refresh();
        return context;
    }

    @Test
    @DisplayName("Through the real cache manager: one query per institute, then served from the cache")
    void realCacheServesRepeatsWithoutQuerying() {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1")).thenReturn(List.of(row("pkg-a", 3L)));
        when(repository.countActiveLearnersPerCatalogPackage("inst-2")).thenReturn(List.of(row("pkg-b", 8L)));

        try (AnnotationConfigApplicationContext context = cachingContext()) {
            CatalogPopularityService proxied = context.getBean(CatalogPopularityService.class);

            CatalogPopularityDTO first = proxied.getPopularity("inst-1");
            CatalogPopularityDTO again = proxied.getPopularity("inst-1");
            CatalogPopularityDTO other = proxied.getPopularity("inst-2");

            assertThat(again).isSameAs(first);
            assertThat(idsInRankOrder(other)).containsExactly("pkg-b");
            verify(repository, times(1)).countActiveLearnersPerCatalogPackage("inst-1");
            verify(repository, times(1)).countActiveLearnersPerCatalogPackage("inst-2");
            verify(repository, never()).countActiveLearnersPerCatalogPackage("inst-3");
        }
    }

    @Test
    @DisplayName("sync=true: concurrent misses for one institute run the query once, the rest wait for it")
    void concurrentMissesRunOneQuery() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        when(repository.countActiveLearnersPerCatalogPackage("inst-hot")).thenAnswer(invocation -> {
            release.await(5, TimeUnit.SECONDS); // hold the first load while the others pile up
            return List.of(row("pkg-a", 3L));
        });

        try (AnnotationConfigApplicationContext context = cachingContext()) {
            CatalogPopularityService proxied = context.getBean(CatalogPopularityService.class);

            List<Future<CatalogPopularityDTO>> calls = callConcurrently(proxied, "inst-hot", 8, release);

            verify(repository, times(1)).countActiveLearnersPerCatalogPackage("inst-hot");
            for (Future<CatalogPopularityDTO> call : calls) {
                assertThat(idsInRankOrder(call.get())).containsExactly("pkg-a");
            }
        }
    }

    @Test
    @DisplayName("Requests queued behind a FAILING load share its 'no ranks' answer instead of re-running it")
    void requestsQueuedBehindAFailingLoadDoNotRerunIt() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger queries = new AtomicInteger();
        when(repository.countActiveLearnersPerCatalogPackage("inst-hot")).thenAnswer(invocation -> {
            queries.incrementAndGet();
            release.await(5, TimeUnit.SECONDS); // a slow failure: the others queue up behind it
            throw new QueryTimeoutException("canceling statement due to user request");
        });

        try (AnnotationConfigApplicationContext context = cachingContext()) {
            CatalogPopularityService proxied = context.getBean(CatalogPopularityService.class);

            List<Future<CatalogPopularityDTO>> calls = callConcurrently(proxied, "inst-hot", 8, release);

            // Before the fix nothing was cached on failure, so each queued request ran the query
            // again in turn (8 queries, each up to the 10 s timeout). Now: one query, one answer.
            assertThat(queries).as("queries run for 8 concurrent requests").hasValue(1);
            List<CatalogPopularityDTO> results = new ArrayList<>();
            for (Future<CatalogPopularityDTO> call : calls) {
                results.add(call.get()); // no request saw an exception
            }
            assertThat(results).allSatisfy(result -> {
                assertThat(result.isUnavailable()).isTrue();
                assertThat(result.getRanks()).isEmpty();
                assertThat(result).isSameAs(results.get(0));
            });
        }
    }

    @Test
    @DisplayName("A failed load is cached for a minute (no query per request); after that the next request retries")
    void failedLoadIsCachedBrieflyThenRetried() {
        when(repository.countActiveLearnersPerCatalogPackage("inst-1"))
                .thenThrow(new QueryTimeoutException("canceling statement due to user request"))
                .thenReturn(List.of(row("pkg-a", 3L)));

        try (AnnotationConfigApplicationContext context = cachingContext()) {
            CatalogPopularityService proxied = context.getBean(CatalogPopularityService.class);
            org.springframework.cache.Cache springCache =
                    context.getBean(CacheManager.class).getCache(CatalogPopularityService.CACHE_NAME);
            @SuppressWarnings("unchecked")
            Cache<Object, Object> nativeCache = (Cache<Object, Object>) springCache.getNativeCache();

            CatalogPopularityDTO failed = proxied.getPopularity("inst-1");
            assertThat(failed.isUnavailable()).isTrue();
            assertThat(proxied.getPopularity("inst-1")).isSameAs(failed);
            assertThat(proxied.getPopularity("inst-1")).isSameAs(failed);
            verify(repository, times(1)).countActiveLearnersPerCatalogPackage("inst-1");
            // the registered cache really gives the stand-in the short lifetime
            assertThat(remainingLifetime(nativeCache, "inst-1"))
                    .isBetween(CatalogPopularityService.FAILURE_TTL.minusSeconds(5), CatalogPopularityService.FAILURE_TTL);

            springCache.evict("inst-1"); // what the minute's expiry does

            CatalogPopularityDTO recovered = proxied.getPopularity("inst-1");
            assertThat(recovered.isUnavailable()).isFalse();
            assertThat(idsInRankOrder(recovered)).containsExactly("pkg-a");
            assertThat(proxied.getPopularity("inst-1")).isSameAs(recovered);
            verify(repository, times(2)).countActiveLearnersPerCatalogPackage("inst-1");
            assertThat(remainingLifetime(nativeCache, "inst-1"))
                    .isBetween(CatalogPopularityService.RANKS_TTL.minusSeconds(5), CatalogPopularityService.RANKS_TTL);
        }
    }

    private static Duration remainingLifetime(Cache<Object, Object> nativeCache, Object key) {
        return nativeCache.policy().expireVariably().orElseThrow().getExpiresAfter(key).orElseThrow();
    }

    /**
     * Starts {@code callers} concurrent getPopularity calls, lets them queue behind the held load,
     * releases it and waits until every call has finished. Each call's outcome (value or
     * exception) stays in its Future, so a test can count queries before reading results.
     */
    private static List<Future<CatalogPopularityDTO>> callConcurrently(
            CatalogPopularityService proxied, String instituteId, int callers, CountDownLatch release) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        try {
            CountDownLatch started = new CountDownLatch(callers);
            List<Future<CatalogPopularityDTO>> futures = new ArrayList<>();
            for (int i = 0; i < callers; i++) {
                futures.add(pool.submit(() -> {
                    started.countDown();
                    return proxied.getPopularity(instituteId);
                }));
            }
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            Thread.sleep(200); // let every caller reach the cache before the load finishes
            release.countDown();
            for (Future<CatalogPopularityDTO> future : futures) {
                try {
                    future.get(20, TimeUnit.SECONDS);
                } catch (ExecutionException failedCall) {
                    // kept in the Future; the test decides whether that is a failure
                }
            }
            return futures;
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * Real Spring transaction bookkeeping (synchronization, the read-only flag the routing data
     * source reads, commit/rollback) without any resource behind it.
     */
    static final class RecordingTransactionManager extends AbstractPlatformTransactionManager {

        final List<TransactionDefinition> begun = new CopyOnWriteArrayList<>();
        final AtomicInteger commits = new AtomicInteger();
        final AtomicInteger rollbacks = new AtomicInteger();
        volatile RuntimeException failBegin;

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {
            if (failBegin != null) {
                throw failBegin;
            }
            begun.add(definition);
        }

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            commits.incrementAndGet();
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            rollbacks.incrementAndGet();
        }
    }
}
