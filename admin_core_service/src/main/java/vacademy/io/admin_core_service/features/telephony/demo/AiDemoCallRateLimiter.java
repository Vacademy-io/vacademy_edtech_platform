package vacademy.io.admin_core_service.features.telephony.demo;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Abuse cap for the anonymous demo endpoint. In memory per pod (N replicas = N x the
 * limit), which turns unbounded into bounded. The per-IP limit is deliberately loose:
 * at an exhibition many visitors share one venue Wi-Fi or carrier NAT address. The
 * per-phone limit does the real work, because a request is only useful from that phone.
 */
@Component
public class AiDemoCallRateLimiter {

    static final int PHONE_PER_10_MIN = 5;
    static final int IP_PER_MINUTE = 30;
    static final int IP_PER_HOUR = 300;
    static final int INSTITUTE_PER_HOUR = 2_000;
    private static final int MAX_KEYS = 50_000;

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    private static final class Window {
        Instant start;
        int count;
        Window(Instant start) { this.start = start; }
    }

    public boolean tryAcquire(String instituteId, String phone, String ip) {
        return tryAcquire(instituteId, phone, ip, Instant.now());
    }

    synchronized boolean tryAcquire(String instituteId, String phone, String ip, Instant now) {
        if (windows.size() > MAX_KEYS) windows.clear();
        boolean ok = peek("p:" + instituteId + ":" + phone, Duration.ofMinutes(10), PHONE_PER_10_MIN, now)
                && (ip == null || ip.isBlank()
                    || (peek("im:" + ip, Duration.ofMinutes(1), IP_PER_MINUTE, now)
                        && peek("ih:" + ip, Duration.ofHours(1), IP_PER_HOUR, now)))
                && peek("inst:" + instituteId, Duration.ofHours(1), INSTITUTE_PER_HOUR, now);
        if (!ok) return false;
        hit("p:" + instituteId + ":" + phone, Duration.ofMinutes(10), now);
        if (ip != null && !ip.isBlank()) {
            hit("im:" + ip, Duration.ofMinutes(1), now);
            hit("ih:" + ip, Duration.ofHours(1), now);
        }
        hit("inst:" + instituteId, Duration.ofHours(1), now);
        return true;
    }

    private boolean peek(String key, Duration span, int limit, Instant now) {
        Window w = windows.get(key);
        return w == null || w.start.plus(span).isBefore(now) || w.count < limit;
    }

    private void hit(String key, Duration span, Instant now) {
        Window w = windows.compute(key, (k, cur) ->
                cur == null || cur.start.plus(span).isBefore(now) ? new Window(now) : cur);
        w.count++;
    }
}
