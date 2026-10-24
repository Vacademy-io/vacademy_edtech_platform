package vacademy.io.admin_core_service.config;

import com.github.benmanes.caffeine.cache.Policy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.support.SimpleCacheManager;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.service.CatalogPopularityService;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A {@code @Cacheable} naming a cache the SimpleCacheManager does not list throws at call time,
 * so the public popularity endpoint would 500 on every request. Pin the registration, its size
 * bound and its per-entry lifetimes (ranks 10 minutes, the stand-in for a failed load 60 seconds).
 */
class CacheConfigurationCatalogPopularityTest {

    @Test
    @DisplayName("catalogPopularityRanks is registered, size-bounded, ranks live 10 min and a failed load 60 s")
    void popularityCacheIsRegisteredWithPerEntryLifetimes() {
        CacheManager manager = new CacheConfiguration().cacheManager();
        ((SimpleCacheManager) manager).afterPropertiesSet();

        Cache cache = manager.getCache(CatalogPopularityService.CACHE_NAME);
        assertThat(cache).as("cache registered under the name the service uses").isNotNull();

        @SuppressWarnings("unchecked")
        com.github.benmanes.caffeine.cache.Cache<Object, Object> nativeCache =
                (com.github.benmanes.caffeine.cache.Cache<Object, Object>) cache.getNativeCache();
        assertThat(nativeCache.policy().eviction().orElseThrow().getMaximum()).isEqualTo(1000);
        assertThat(nativeCache.policy().expireAfterWrite()).as("lifetime is set per entry, not one fixed TTL").isEmpty();
        Policy.VarExpiration<Object, Object> lifetimes = nativeCache.policy().expireVariably().orElseThrow();

        cache.put("inst-ranked", new CatalogPopularityDTO("inst-ranked",
                List.of(new CatalogPopularityDTO.PackageRank("pkg-a", 1))));
        cache.put("inst-empty", CatalogPopularityDTO.empty("inst-empty"));
        cache.put("inst-failed", CatalogPopularityDTO.unavailable("inst-failed"));

        Duration tenMinutes = Duration.ofMinutes(10);
        assertThat(lifetimes.getExpiresAfter("inst-ranked").orElseThrow())
                .isBetween(tenMinutes.minusSeconds(5), tenMinutes);
        assertThat(lifetimes.getExpiresAfter("inst-empty").orElseThrow())
                .isBetween(tenMinutes.minusSeconds(5), tenMinutes);
        assertThat(lifetimes.getExpiresAfter("inst-failed").orElseThrow())
                .isBetween(Duration.ofSeconds(55), Duration.ofSeconds(60));
    }

    @Test
    @DisplayName("Adding the new cache kept every existing cache registered")
    void existingCachesAreStillRegistered() {
        CacheManager manager = new CacheConfiguration().cacheManager();
        ((SimpleCacheManager) manager).afterPropertiesSet();

        assertThat(manager.getCacheNames()).contains(
                "studyLibraryInit", "openInstituteDetails", "learnerModulesStructure",
                "learnerPackageSlidesStructure", "guardianChildren", "parentPortalSettings",
                "lmsConnectionHealth", "catalogPopularityRanks");
    }
}
