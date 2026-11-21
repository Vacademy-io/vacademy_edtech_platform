package vacademy.io.community_service.feature.session.manager;

import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Presenter keys for sessions created through /engage/admin/v2/create.
 *
 * <p>
 * A session is either keyed or not. Only keyed sessions are checked. Sessions from
 * /engage/admin/create have no entry here and are handled as they always have been.
 *
 * <p>
 * Only a hash is held, in memory, next to the in-memory session it belongs to. A restart
 * loses both together. The raw key exists only in the v2/create response.
 *
 * <p>
 * Lifetime follows the session rather than the finish call. Presenters still read results
 * and send the session summary after finishing, and {@link LiveSessionService} keeps a
 * finished session until its hourly sweep, so {@link #retire} starts a grace period that
 * outlasts that sweep. A session never finished is swept 24 hours after creation, and
 * {@link #UNFINISHED_TTL} outlasts that too.
 */
@Service
public class PresenterKeyService {

    static final Duration UNFINISHED_TTL = Duration.ofHours(26);
    static final Duration FINISHED_GRACE = Duration.ofMinutes(90);

    private static final int KEY_BYTES = 32;

    private final SecureRandom random = new SecureRandom();
    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final Clock clock;

    public PresenterKeyService() {
        this(Clock.systemUTC());
    }

    PresenterKeyService(Clock clock) {
        this.clock = clock;
    }

    /** Creates the session's key and returns it. The raw value is not kept. */
    public String issue(String sessionId) {
        Instant now = clock.instant();
        entries.values().removeIf(entry -> entry.isExpired(now));

        byte[] raw = new byte[KEY_BYTES];
        random.nextBytes(raw);
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        entries.put(sessionId, new Entry(hash(key), now.plus(UNFINISHED_TTL)));
        return key;
    }

    public boolean hasKey(String sessionId) {
        return liveEntry(sessionId) != null;
    }

    /**
     * True when the session has no key, or when the presented key hashes to the session's key. Takes
     * the hash from {@link #hash}, never the key, because the shared logging aspect prints the
     * arguments of *Service methods.
     */
    public boolean allows(String sessionId, byte[] presentedKeyHash) {
        Entry entry = liveEntry(sessionId);
        if (entry == null) {
            return true;
        }
        return presentedKeyHash != null && MessageDigest.isEqual(entry.keyHash(), presentedKeyHash);
    }

    /** Called when the session finishes. A repeat call never extends the remaining time. */
    public void retire(String sessionId) {
        if (sessionId == null) {
            return;
        }
        Instant latest = clock.instant().plus(FINISHED_GRACE);
        entries.computeIfPresent(sessionId, (id, entry) -> entry.expiresAt().isAfter(latest)
                ? new Entry(entry.keyHash(), latest)
                : entry);
    }

    private Entry liveEntry(String sessionId) {
        if (sessionId == null) {
            return null;
        }
        Entry entry = entries.get(sessionId);
        if (entry != null && entry.isExpired(clock.instant())) {
            entries.remove(sessionId, entry);
            return null;
        }
        return entry;
    }

    /** SHA-256 of a presented key, or null for none. Static, so it is never proxied or logged. */
    public static byte[] hash(String key) {
        if (key == null) {
            return null;
        }
        try {
            return MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    private record Entry(byte[] keyHash, Instant expiresAt) {
        boolean isExpired(Instant now) {
            return !now.isBefore(expiresAt);
        }
    }
}
