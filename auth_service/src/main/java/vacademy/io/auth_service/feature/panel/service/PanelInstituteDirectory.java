package vacademy.io.auth_service.feature.panel.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Institute name, theme and QR host, fetched from admin_core and kept on the panel's row.
 *
 * <p>The open-in-view session holds a request's database connection from its first repository call
 * until the response is written, so a request thread must not wait on HTTP after touching the
 * database. Every fetch therefore runs on one dedicated worker thread, which has no such session.
 * The claim endpoint waits for it at most 3 s and does so before any repository call; the challenge
 * endpoint never waits.
 *
 * <p>The admin_core DTO also carries the institute's {@code setting} blob. It is dropped here: never
 * stored, cached or logged, and failures log only the exception type because a parse error can quote
 * the body.
 */
@Component
public class PanelInstituteDirectory {

    private static final Logger log = LoggerFactory.getLogger(PanelInstituteDirectory.class);

    private static final long CLAIM_WAIT_MS = 3000;
    private static final Duration CACHE_TTL = Duration.ofMinutes(5);
    private static final int CACHE_SIZE = 5000;
    private static final int QUEUE_SIZE = 16;
    private static final int MAX_BASE_URL_LENGTH = 255;
    private static final int MAX_NAME_LENGTH = 255;
    private static final int MAX_THEME_LENGTH = 64;

    public record Snapshot(String instituteName, String themeCode, String approveBaseUrl) {
    }

    private final InstituteInternalService instituteService;
    private final PanelProperties properties;
    private final PanelRepository repository;
    private final Cache<String, Snapshot> cache = Caffeine.newBuilder()
            .maximumSize(CACHE_SIZE)
            .expireAfterWrite(CACHE_TTL)
            .build();
    private final Map<String, CompletableFuture<Optional<Snapshot>>> inFlight = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor worker;

    public PanelInstituteDirectory(InstituteInternalService instituteService, PanelProperties properties,
            PanelRepository repository) {
        this.instituteService = instituteService;
        this.properties = properties;
        this.repository = repository;
        this.worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(QUEUE_SIZE),
                runnable -> {
                    Thread thread = new Thread(runnable, "panel-institute-directory");
                    thread.setDaemon(true);
                    return thread;
                });
    }

    /** Waits up to 3 s. Empty means no snapshot right now; the caller answers TRY_AGAIN. */
    public Optional<Snapshot> get(String instituteId) {
        Snapshot cached = cache.getIfPresent(instituteId);
        if (cached != null) {
            return Optional.of(cached);
        }
        try {
            return fetchShared(instituteId).get(CLAIM_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException | ExecutionException e) {
            return Optional.empty();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        }
    }

    /** Fire and forget from /challenge. A failure or a full queue keeps the old values on the row. */
    public void refreshDeviceAsync(String deviceId, String instituteId) {
        try {
            worker.execute(() -> {
                try {
                    Optional<Snapshot> snapshot = Optional.ofNullable(cache.getIfPresent(instituteId));
                    if (snapshot.isEmpty()) {
                        snapshot = fetch(instituteId);
                    }
                    snapshot.ifPresent(s -> repository.updateBranding(deviceId, s));
                } catch (RuntimeException e) {
                    log.warn("Panel branding refresh failed: {}", e.getClass().getSimpleName());
                }
            });
        } catch (RejectedExecutionException e) {
            log.debug("Panel directory queue full; branding refresh skipped");
        }
    }

    /** Callers waiting on one institute share one fetch, so a slow admin_core costs one queue slot. */
    private CompletableFuture<Optional<Snapshot>> fetchShared(String instituteId) {
        CompletableFuture<Optional<Snapshot>> mine = new CompletableFuture<>();
        CompletableFuture<Optional<Snapshot>> existing = inFlight.putIfAbsent(instituteId, mine);
        if (existing != null) {
            return existing;
        }
        try {
            worker.execute(() -> {
                try {
                    mine.complete(fetch(instituteId));
                } catch (RuntimeException e) {
                    log.warn("Panel institute lookup failed: {}", e.getClass().getSimpleName());
                    mine.complete(Optional.empty());
                } finally {
                    inFlight.remove(instituteId, mine);
                }
            });
        } catch (RejectedExecutionException e) {
            inFlight.remove(instituteId, mine);
            mine.complete(Optional.empty());
        }
        return mine;
    }

    private Optional<Snapshot> fetch(String instituteId) {
        InstituteInfoDTO info = instituteService.getInstituteByInstituteId(instituteId);
        if (info == null || info.getInstituteName() == null || info.getInstituteName().isBlank()) {
            return Optional.empty();
        }
        Snapshot snapshot = new Snapshot(limit(info.getInstituteName(), MAX_NAME_LENGTH),
                limit(info.getInstituteThemeCode(), MAX_THEME_LENGTH),
                normaliseApproveBase(info.getAdminPortalUrl(), properties.getApproveDefaultBaseUrl()));
        cache.put(instituteId, snapshot);
        return Optional.of(snapshot);
    }

    private static String limit(String value, int max) {
        return value != null && value.length() > max ? value.substring(0, max) : value;
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }

    /**
     * Where a panel's QR points, always scheme and host. An institute's own https host is kept. Blank,
     * http, IP literals, localhost and anything under vacademy.io use the default: a QR on our admin
     * host would open the installed Admin app through its App Link and lose the fragment.
     */
    public static String normaliseApproveBase(String raw, String fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String value = raw.trim();
        if (!value.contains("://")) {
            value = "https://" + value;
        }
        URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException e) {
            return fallback;
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
            return fallback;
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        while (host.endsWith(".")) {
            host = host.substring(0, host.length() - 1);
        }
        if (host.equals("localhost") || host.endsWith(".localhost") || !host.contains(".")
                || host.equals("vacademy.io") || host.endsWith(".vacademy.io") || isIpLiteral(host)) {
            return fallback;
        }
        String base = "https://" + host;
        return base.length() > MAX_BASE_URL_LENGTH ? fallback : base;
    }

    private static boolean isIpLiteral(String host) {
        if (host.startsWith("[") || host.contains(":")) {
            return true;
        }
        // A real public name ends in an alphabetic TLD (or xn--...). This also catches 0x7f.0.0.1.
        String tld = host.substring(host.lastIndexOf('.') + 1);
        return tld.isEmpty() || !Character.isLetter(tld.charAt(0));
    }
}
