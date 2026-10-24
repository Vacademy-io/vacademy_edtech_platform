package vacademy.io.admin_core_service.features.catalog_api.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Media-service file ids → permanent public URLs, in batches. URLs are permanent (CDN keys), so a
 * resolved id is remembered for 24 h; an id that cannot be resolved is remembered as missing for
 * 10 minutes, so one broken image never turns every list request into per-id calls. Values that
 * already are http(s) URLs pass through untouched.
 *
 * <p>Media-service is never allowed to hold a request: every call runs on a small pool of its own
 * with a hard deadline ({@value #BATCH_TIMEOUT_MS} ms a batch, {@value #FALLBACK_BUDGET_MS} ms for
 * the per-id fallback, at most {@value #FALLBACK_MAX_IDS} ids). A timeout or a full pool marks
 * media-service as down for {@value #DOWN_FOR_MS} ms, during which only cached URLs are served (the
 * rest of the response is unaffected; images come back on a later load).
 */
@Slf4j
@Component
public class CatalogMediaResolver {

    private static final int BATCH = 50;
    private static final String MISSING = "";
    static final long BATCH_TIMEOUT_MS = 5_000L;
    static final long FALLBACK_BUDGET_MS = 3_000L;
    static final int FALLBACK_MAX_IDS = 10;
    static final long DOWN_FOR_MS = 60_000L;

    private final MediaService mediaService;
    private final Cache<String, String> resolved = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofHours(24)).maximumSize(100_000).build();
    private final Cache<String, String> missing = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(10)).maximumSize(20_000).build();
    private final ExecutorService pool = new ThreadPoolExecutor(2, 4, 60, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(8), r -> {
                Thread t = new Thread(r, "catalog-media");
                t.setDaemon(true);
                return t;
            });
    private final AtomicLong downUntil = new AtomicLong();

    public CatalogMediaResolver(MediaService mediaService) {
        this.mediaService = mediaService;
    }

    public static boolean isHttp(String v) {
        if (v == null) return false;
        String s = v.trim().toLowerCase(Locale.ROOT);
        return s.startsWith("http://") || s.startsWith("https://");
    }

    /** id (or URL) → URL for every value that resolves; others are absent from the map. */
    public Map<String, String> resolve(Collection<String> idsOrUrls) {
        Map<String, String> out = new HashMap<>();
        List<String> todo = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String raw : idsOrUrls) {
            if (raw == null || raw.isBlank() || !seen.add(raw)) continue;
            if (isHttp(raw)) {
                out.put(raw, raw.trim());
                continue;
            }
            String hit = resolved.getIfPresent(raw);
            if (hit != null) {
                out.put(raw, hit);
            } else if (missing.getIfPresent(raw) == null) {
                todo.add(raw);
            }
        }
        for (int i = 0; i < todo.size() && !isDown(); i += BATCH) {
            List<String> chunk = todo.subList(i, Math.min(todo.size(), i + BATCH));
            Map<String, Boolean> answered = new HashMap<>();
            Map<String, String> got = fetchBatch(chunk, answered);
            for (String id : chunk) {
                String url = got.get(id);
                if (url != null && !url.isBlank()) {
                    resolved.put(id, url);
                    out.put(id, url);
                } else if (answered.containsKey(id)) {
                    missing.put(id, MISSING); // media-service said no; unanswered ids retry next load
                }
            }
        }
        return out;
    }

    public String resolveOne(String idOrUrl) {
        if (idOrUrl == null || idOrUrl.isBlank()) return null;
        return resolve(List.of(idOrUrl)).get(idOrUrl);
    }

    /**
     * One batch. {@code answered} receives every id media-service actually answered for (found or
     * not); ids left out of it timed out or were never tried and must not be remembered as missing.
     */
    private Map<String, String> fetchBatch(List<String> ids, Map<String, Boolean> answered) {
        try {
            Map<String, String> got = timed(() -> mediaService.getPublicUrlsWithoutExpiry(ids), BATCH_TIMEOUT_MS);
            ids.forEach(id -> answered.put(id, Boolean.TRUE));
            return got == null ? Map.of() : got;
        } catch (MediaUnavailable down) {
            return Map.of();
        } catch (Exception batchError) {
            // One unknown id fails the whole batch upstream: resolve one by one, skipping failures,
            // within a fixed budget.
            log.info("catalog-api: media batch of {} failed ({}); resolving per id", ids.size(),
                    batchError.getMessage());
            Map<String, String> out = new HashMap<>();
            long deadline = System.currentTimeMillis() + FALLBACK_BUDGET_MS;
            for (String id : ids.subList(0, Math.min(ids.size(), FALLBACK_MAX_IDS))) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0 || isDown()) break;
                try {
                    String url = timed(() -> mediaService.getFilePublicUrlByIdWithoutExpiry(id), left);
                    answered.put(id, Boolean.TRUE);
                    if (isHttp(url)) out.put(id, url.trim());
                } catch (MediaUnavailable down) {
                    break;
                } catch (Exception e) {
                    answered.put(id, Boolean.TRUE);
                    log.debug("catalog-api: media id {} not resolvable: {}", id, e.getMessage());
                }
            }
            return out;
        }
    }

    boolean isDown() {
        return System.currentTimeMillis() < downUntil.get();
    }

    /** Runs a media-service call on the pool with a deadline; a timeout or a full pool = down. */
    private <T> T timed(Callable<T> call, long timeoutMs) throws Exception {
        Future<T> f;
        try {
            f = pool.submit(call);
        } catch (RejectedExecutionException full) {
            markDown("pool full");
            throw new MediaUnavailable();
        }
        try {
            return f.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException slow) {
            f.cancel(true);
            markDown("no answer in " + timeoutMs + " ms");
            throw new MediaUnavailable();
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            throw cause instanceof Exception ex ? ex : new RuntimeException(cause);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MediaUnavailable();
        }
    }

    private void markDown(String why) {
        downUntil.set(System.currentTimeMillis() + DOWN_FOR_MS);
        log.warn("catalog-api: media-service {}; serving cached image URLs only for {} s", why, DOWN_FOR_MS / 1000);
    }

    private static final class MediaUnavailable extends Exception {
        MediaUnavailable() {
            super(null, null, false, false);
        }
    }
}
