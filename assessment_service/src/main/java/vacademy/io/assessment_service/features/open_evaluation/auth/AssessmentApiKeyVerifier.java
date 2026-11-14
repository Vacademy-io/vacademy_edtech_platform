package vacademy.io.assessment_service.features.open_evaluation.auth;

import com.github.benmanes.caffeine.cache.CacheLoader;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import com.github.benmanes.caffeine.cache.LoadingCache;
import com.github.benmanes.caffeine.cache.Ticker;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiInstituteFlags;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.apikey.ApiKeyVerifier;
import vacademy.io.common.auth.apikey.ApiKeyVerifierUnavailableException;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.concurrent.ForkJoinPool;

/**
 * assessment_service's {@link ApiKeyVerifier}: admin_core's verify endpoint behind a
 * Caffeine {@link LoadingCache} keyed by the key hash (spec 6.4).
 *
 * <ul>
 *   <li>Known key: cached 10 min, refreshed in the background after 60 s, so a revocation
 *       reaches each pod within about a minute of the next use.</li>
 *   <li>Unknown key: cached 30 s (negative entry), so a flood of bad keys costs one
 *       admin_core call per key per 30 s.</li>
 *   <li>admin_core down: a failed refresh keeps the cached principal (Caffeine keeps the
 *       old value when a reload throws) until the 10 min expiry; a key with nothing cached
 *       gets {@link ApiKeyVerifierUnavailableException} (503 {@code auth_unavailable}),
 *       never "unknown" (401). Failures are not cached.</li>
 *   <li>At most 10,000 entries.</li>
 * </ul>
 * The principal is returned whatever its status or expiry; {@code ApiKeyAuthFilter}
 * re-checks both on every request.
 */
@Slf4j
@Component
public class AssessmentApiKeyVerifier implements ApiKeyVerifier {

    static final Duration REFRESH_AFTER = Duration.ofSeconds(60);
    static final Duration KNOWN_TTL = Duration.ofMinutes(10);
    static final Duration UNKNOWN_TTL = Duration.ofSeconds(30);
    static final long MAX_ENTRIES = 10_000;

    private final AdminCoreApiKeyClient client;
    private final ApiInstituteFlags instituteFlags;
    private final LoadingCache<String, Lookup> cache;

    @Autowired
    public AssessmentApiKeyVerifier(AdminCoreApiKeyClient client, ApiInstituteFlags instituteFlags) {
        this(client, instituteFlags, Ticker.systemTicker(), ForkJoinPool.commonPool());
    }

    AssessmentApiKeyVerifier(AdminCoreApiKeyClient client, ApiInstituteFlags instituteFlags, Ticker ticker,
            Executor refreshExecutor) {
        this.client = client;
        this.instituteFlags = instituteFlags;
        this.cache = Caffeine.newBuilder()
                .maximumSize(MAX_ENTRIES)
                .refreshAfterWrite(REFRESH_AFTER)
                .expireAfter(new LookupExpiry())
                .ticker(ticker)
                .executor(refreshExecutor)
                .build(new Loader());
    }

    @Override
    public Optional<ApiKeyPrincipal> verify(String keyHash) throws ApiKeyVerifierUnavailableException {
        if (keyHash == null || keyHash.isBlank()) {
            return Optional.empty();
        }
        Lookup lookup;
        try {
            lookup = cache.get(keyHash);
        } catch (ApiKeyVerifierUnavailableException e) {
            throw e;
        } catch (CompletionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof ApiKeyVerifierUnavailableException unavailable) {
                throw unavailable;
            }
            throw new ApiKeyVerifierUnavailableException("key verification failed", cause != null ? cause : e);
        } catch (RuntimeException e) {
            throw new ApiKeyVerifierUnavailableException("key verification failed", e);
        }
        return lookup == null ? Optional.empty() : Optional.ofNullable(lookup.principal());
    }

    /** Drops a cached entry (e.g. after a key is revoked in this process's view). */
    public void invalidate(String keyHash) {
        if (keyHash != null) {
            cache.invalidate(keyHash);
        }
    }

    long estimatedSize() {
        cache.cleanUp();
        return cache.estimatedSize();
    }

    /** Cached answer for a hash: a principal, or "unknown" (principal null). */
    record Lookup(ApiKeyPrincipal principal) {
        static final Lookup UNKNOWN = new Lookup(null);

        boolean known() {
            return principal != null;
        }
    }

    private final class Loader implements CacheLoader<String, Lookup> {
        @Override
        public Lookup load(String keyHash) {
            Optional<ApiKeyVerifyResponse> response = client.verify(keyHash);
            if (response.isEmpty()) {
                return Lookup.UNKNOWN;
            }
            ApiKeyPrincipal principal = response.get().toPrincipal();
            try {
                instituteFlags.record(principal);
            } catch (RuntimeException e) {
                log.debug("Could not record institute API flags: {}", e.getMessage());
            }
            return new Lookup(principal);
        }

        /**
         * Background refresh. Throwing here (admin_core down) makes Caffeine keep the old
         * value, which is exactly "keep serving cached valid keys".
         */
        @Override
        public Lookup reload(String keyHash, Lookup oldValue) {
            try {
                return load(keyHash);
            } catch (ApiKeyVerifierUnavailableException e) {
                log.warn("API key refresh failed; serving the cached entry until it expires: {}", e.getMessage());
                throw e;
            }
        }
    }

    /** 10 min for known keys, 30 s for unknown ones; a refresh resets the clock by its result. */
    private static final class LookupExpiry implements Expiry<String, Lookup> {
        private static long ttlNanos(Lookup value) {
            return (value != null && value.known() ? KNOWN_TTL : UNKNOWN_TTL).toNanos();
        }

        @Override
        public long expireAfterCreate(String key, Lookup value, long currentTime) {
            return ttlNanos(value);
        }

        @Override
        public long expireAfterUpdate(String key, Lookup value, long currentTime, long currentDuration) {
            return ttlNanos(value);
        }

        @Override
        public long expireAfterRead(String key, Lookup value, long currentTime, long currentDuration) {
            return currentDuration;
        }
    }
}
