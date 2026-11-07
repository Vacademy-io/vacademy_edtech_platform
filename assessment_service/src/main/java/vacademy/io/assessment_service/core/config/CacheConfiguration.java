package vacademy.io.assessment_service.core.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.TimeUnit;

@Configuration
@EnableCaching
public class CacheConfiguration {

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(
                Caffeine.newBuilder()
                        .expireAfterWrite(5, TimeUnit.MINUTES)
                        .maximumSize(10_000)
                        .recordStats());

        // Register the comparison cache with 15-min TTL
        cacheManager.registerCustomCache("comparisonData",
                Caffeine.newBuilder()
                        .expireAfterWrite(15, TimeUnit.MINUTES)
                        .maximumSize(5_000)
                        .recordStats()
                        .build());

        // Report branding cache — 5 min TTL, small size (one per institute)
        cacheManager.registerCustomCache("reportBranding",
                Caffeine.newBuilder()
                        .expireAfterWrite(5, TimeUnit.MINUTES)
                        .maximumSize(500)
                        .recordStats()
                        .build());

        // Batch enrollment for the "not attempted yet" list, keyed by institute + batch set.
        // This is what keeps that feature off the hot path: the submissions page asks for the
        // Pending count on EVERY mount, so uncached it would be one admin_core round trip per
        // page view. Batch enrollment changes rarely, so 2 minutes collapses every mount, tab
        // switch and page step for a batch set onto a single call while staying fresh enough
        // that a newly enrolled learner shows up quickly. Entries are lists of learners, so
        // the size cap is deliberately small.
        cacheManager.registerCustomCache("batchEnrolledLearners",
                Caffeine.newBuilder()
                        .expireAfterWrite(2, TimeUnit.MINUTES)
                        .maximumSize(200)
                        .recordStats()
                        .build());

        // Batch display names for the CSV exports. Names essentially never change and the
        // map is tiny, so this is cached longer than the enrollment above.
        cacheManager.registerCustomCache("batchNames",
                Caffeine.newBuilder()
                        .expireAfterWrite(30, TimeUnit.MINUTES)
                        .maximumSize(500)
                        .recordStats()
                        .build());

        return cacheManager;
    }
}
