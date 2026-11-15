package vacademy.io.admin_core_service.features.commerce.otp;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceRateLimitRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.Date;
import java.util.HexFormat;
import java.util.UUID;

/**
 * The shared limiter of the public commerce endpoints, over the table
 * {@code commerce_rate_limit} of V679. Fixed windows, counted in the database, so the limit is
 * one for all pods.
 *
 * <p>A hit is one atomic upsert in a transaction of its own: it counts even when the request
 * that made it fails or rolls back, and it never joins a caller's transaction. A scope names
 * one limit and one window length; the same scope must always be used with the same window.
 */
@Slf4j
@Component
public class CommerceRateLimiter {

    /** Subject for a limit that is not per phone or per address, for example per institute. */
    public static final String ALL = "*";

    private final CommerceRateLimitRepository repository;
    private final TransactionTemplate ownTransaction;

    public CommerceRateLimiter(CommerceRateLimitRepository repository, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Counts one hit and says whether it is within the limit.
     *
     * @param scope   at most 32 characters, for example {@code otp-send-phone}
     * @param subject an address, or anything else; a phone number must be passed through
     *                {@link #hash} first. Longer than 128 characters is hashed.
     * @return true when this hit is the {@code limit}-th or earlier of its window
     */
    public boolean allow(String instituteId, String scope, String subject, Duration window, int limit) {
        return allow(instituteId, scope, subject, window, limit, System.currentTimeMillis());
    }

    boolean allow(String instituteId, String scope, String subject, Duration window, int limit, long nowMillis) {
        long length = Math.max(1000L, window.toMillis());
        Date windowStart = new Date(nowMillis - (nowMillis % length));
        String key = subject == null || subject.isBlank() ? ALL : subject.trim();
        String subjectKey = key.length() > 128 ? hash(key) : key;
        Integer hits = ownTransaction.execute(status -> repository.hit(UUID.randomUUID().toString(), instituteId,
                scope, subjectKey, windowStart));
        return hits != null && hits <= limit;
    }

    /** Seconds until the window that holds {@code nowMillis} ends; at least 1. */
    public static int secondsToNextWindow(Duration window, long nowMillis) {
        long length = Math.max(1000L, window.toMillis());
        long left = length - (nowMillis % length);
        return (int) Math.max(1L, (left + 999L) / 1000L);
    }

    /** SHA-256 in hex: the form a phone number takes in a limiter row or a challenge row. */
    public static String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
