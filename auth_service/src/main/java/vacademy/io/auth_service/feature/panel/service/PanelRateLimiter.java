package vacademy.io.auth_service.feature.panel.service;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-pod backstop, in the same shape as admin_core's PublicLeadRateLimiter. With N replicas the
 * real ceiling is N times the limit, so token entropy and TTL carry the weight.
 *
 * <p>Each kind of limit has its own map with its own size bound, so a flood of keys of one kind
 * never resets the counts of another. A kind whose map is full of live windows refuses keys it has
 * not seen until windows expire, rather than forgetting the ones it holds.
 */
@Component
public class PanelRateLimiter {

    public static final int PAIR_START_PER_IP = 30;
    public static final int CHALLENGE_INFO_PER_IP = 60;
    public static final int PAIR_PREVIEW_PER_USER = 10;
    public static final int CLAIM_PER_USER = 10;
    public static final int DESCRIBE_PER_USER = 10;
    public static final int APPROVE_CODE_PER_USER = 10;
    public static final int LOGIN_PASSWORD_PER_KEY = 5;
    public static final int LOGIN_PASSWORD_PER_DEVICE = 20;
    public static final int SESSION_STARTS_PER_USER_PER_HOUR = 20;

    public static final int MAX_KEYS_PER_KIND = 10_000;
    public static final long MINUTE_MS = 60_000L;
    public static final long HOUR_MS = 60 * MINUTE_MS;
    private static final int MAX_FORWARDED_LENGTH = 64;

    private final Map<String, Map<String, Window>> kinds = new ConcurrentHashMap<>();
    private final List<PanelIps.Cidr> trustedProxies;

    public PanelRateLimiter(PanelProperties properties) {
        this.trustedProxies = properties.getTrustedProxies();
    }

    private static final class Window {
        private long startedAt;
        private int count;

        private Window(long startedAt) {
            this.startedAt = startedAt;
        }
    }

    /** @throws PanelApiException 429 RATE_LIMITED with retry_after_ms once the limit is passed. */
    public void check(String kind, String key, int limit) {
        check(kind, key, limit, MINUTE_MS);
    }

    public void check(String kind, String key, int limit, long windowMs) {
        long now = System.currentTimeMillis();
        Map<String, Window> windows = kinds.computeIfAbsent(kind, k -> new ConcurrentHashMap<>());
        Window window = windows.get(key);
        if (window == null) {
            if (windows.size() >= MAX_KEYS_PER_KIND) {
                windows.entrySet().removeIf(e -> now - e.getValue().startedAt >= windowMs);
                if (windows.size() >= MAX_KEYS_PER_KIND) {
                    throw limited(windowMs);
                }
            }
            window = windows.computeIfAbsent(key, k -> new Window(now));
        }
        long retryAfter;
        synchronized (window) {
            if (now - window.startedAt >= windowMs) {
                window.startedAt = now;
                window.count = 0;
            }
            window.count++;
            if (window.count <= limit) {
                return;
            }
            retryAfter = windowMs - (now - window.startedAt);
        }
        throw limited(retryAfter);
    }

    /** As {@link #check}, keyed by client address: an IPv6 address counts as its /64. */
    public void checkIp(String kind, String ip, int limit) {
        check(kind, PanelIps.limitKey(ip), limit);
    }

    public int trackedKeys(String kind) {
        Map<String, Window> windows = kinds.get(kind);
        return windows == null ? 0 : windows.size();
    }

    private static PanelApiException limited(long retryAfter) {
        return new PanelApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many requests")
                .with("retry_after_ms", Math.max(1, retryAfter));
    }

    /**
     * CF-Connecting-IP when present, else the first X-Forwarded-For entry, else the socket. The two
     * headers are read only when panel.trusted-proxies is empty or names the socket peer.
     */
    public String clientIp(HttpServletRequest request) {
        String ip = null;
        if (trustsForwardedHeaders(request.getRemoteAddr())) {
            ip = request.getHeader("CF-Connecting-IP");
            if (ip == null || ip.isBlank()) {
                String forwarded = request.getHeader("X-Forwarded-For");
                if (forwarded != null && !forwarded.isBlank()) {
                    ip = forwarded.split(",")[0];
                }
            }
        }
        if (ip == null || ip.isBlank()) {
            ip = request.getRemoteAddr();
        }
        ip = ip == null ? "" : ip.trim();
        return ip.length() > MAX_FORWARDED_LENGTH ? ip.substring(0, MAX_FORWARDED_LENGTH) : ip;
    }

    private boolean trustsForwardedHeaders(String peer) {
        if (trustedProxies.isEmpty()) {
            return true;
        }
        byte[] address = PanelIps.address(peer);
        return trustedProxies.stream().anyMatch(cidr -> cidr.contains(address));
    }
}
