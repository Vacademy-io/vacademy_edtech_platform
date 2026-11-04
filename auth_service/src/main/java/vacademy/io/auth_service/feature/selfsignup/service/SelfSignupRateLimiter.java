package vacademy.io.auth_service.feature.selfsignup.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Limits these public endpoints: every sign-up costs free AI credits and every OTP costs a mail.
 * Counted per pod, so the real ceiling is the limit times the pod count: enough to stop a script.
 */
@Component
public class SelfSignupRateLimiter {

    private static final long TEN_MINUTES = 10 * 60 * 1000L;
    private static final long ONE_DAY = 24 * 60 * 60 * 1000L;
    private static final int MAX_TRACKED_KEYS = 50_000;

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    /** The first send plus 3 resends per address; 30 mails per network. */
    public void checkOtp(String email, String ip) {
        check("otp-email:" + email, 4, TEN_MINUTES, "Too many codes sent to this email. Try again in a few minutes.");
        check("otp-ip:" + ip, 30, TEN_MINUTES, "Too many attempts from this network. Try again in a few minutes.");
    }

    /** Wrong guesses at one address's code. */
    public void checkVerify(String email) {
        check("verify:" + email, 10, TEN_MINUTES, "Too many wrong codes. Request a new one in a few minutes.");
    }

    /** New workspaces from one network in a day. */
    public void checkSignup(String ip) {
        check("signup-ip:" + ip, 5, ONE_DAY, "Too many sign-ups from this network today. Please contact support.");
    }

    private void check(String key, int limit, long windowMillis, String message) {
        long now = System.currentTimeMillis();
        if (hits.size() > MAX_TRACKED_KEYS) {
            hits.values().removeIf(deque -> {
                synchronized (deque) {
                    return deque.isEmpty() || now - deque.peekLast() > ONE_DAY;
                }
            });
        }
        Deque<Long> deque = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (deque) {
            while (!deque.isEmpty() && now - deque.peekFirst() > windowMillis) {
                deque.pollFirst();
            }
            if (deque.size() >= limit) {
                throw new VacademyException(HttpStatus.TOO_MANY_REQUESTS, message);
            }
            deque.addLast(now);
        }
    }
}
