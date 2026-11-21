package vacademy.io.common.auth.service;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.repository.ClientAuthenticationRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Checks the clientName + Signature pair of an internal call.
 *
 * <p>The pair is valid when the signature equals the client's row in client_secret_key. While an
 * internal secret is being changed, INTERNAL_CLIENT_SECRET_ACCEPT (comma-separated) can list extra
 * values that are also accepted for any client that has a row, so senders and receivers can move to
 * the new value one at a time. Unset or blank, only the stored row counts, as before.
 */
@Service
public class ClientAuthenticationService {

    private static final Logger log = LoggerFactory.getLogger(ClientAuthenticationService.class);
    private static final long LOG_INTERVAL_MS = 60_000L;

    enum Match { STORED, ACCEPT_LIST, NONE }

    @Autowired
    ClientAuthenticationRepository clientAuthenticationRepository;

    private volatile List<byte[]> acceptList = Collections.emptyList();

    /** Per client and accept-list entry: when it was last logged and how many matches since. */
    private final Map<String, long[]> lastLogged = new ConcurrentHashMap<>();
    private final Map<String, AtomicLong> matchesSinceLog = new ConcurrentHashMap<>();

    @Value("${INTERNAL_CLIENT_SECRET_ACCEPT:}")
    void setAcceptList(String raw) {
        this.acceptList = parseAcceptList(raw);
    }

    public boolean validateClient(String clientName, String clientToken) {
        if (clientName == null || clientToken == null) {
            return false;
        }
        List<String> stored = clientAuthenticationRepository.findSecretKeys(clientName);
        Match match = match(stored, clientToken, acceptList);
        if (match == Match.ACCEPT_LIST) {
            logAcceptListMatch(clientName, acceptListIndex(clientToken, acceptList));
        }
        return match != Match.NONE;
    }

    static List<byte[]> parseAcceptList(String raw) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptyList();
        }
        List<byte[]> values = new ArrayList<>();
        for (String part : raw.split(",")) {
            String value = part.trim();
            if (!value.isEmpty()) {
                values.add(value.getBytes(StandardCharsets.UTF_8));
            }
        }
        return Collections.unmodifiableList(values);
    }

    /**
     * STORED when the token equals the client's stored secret; ACCEPT_LIST when the client has a
     * row and the token equals one of the extra accepted values; otherwise NONE. A client without a
     * row never matches. Comparisons are constant-time.
     */
    static Match match(List<String> storedSecrets, String token, List<byte[]> acceptList) {
        if (token == null || storedSecrets == null || storedSecrets.isEmpty()) {
            return Match.NONE;
        }
        byte[] presented = token.getBytes(StandardCharsets.UTF_8);
        String stored = storedSecrets.get(0);
        if (stored != null && MessageDigest.isEqual(stored.getBytes(StandardCharsets.UTF_8), presented)) {
            return Match.STORED;
        }
        return acceptListIndex(token, acceptList) >= 0 ? Match.ACCEPT_LIST : Match.NONE;
    }

    /** 0-based position of the token in the accept list, or -1. Checks every entry. */
    static int acceptListIndex(String token, List<byte[]> acceptList) {
        if (token == null || acceptList == null) {
            return -1;
        }
        byte[] presented = token.getBytes(StandardCharsets.UTF_8);
        int found = -1;
        for (int i = 0; i < acceptList.size(); i++) {
            if (MessageDigest.isEqual(acceptList.get(i), presented) && found < 0) {
                found = i;
            }
        }
        return found;
    }

    /** At most one line per client and entry per minute; names the entry by position, never its value. */
    private void logAcceptListMatch(String clientName, int index) {
        String key = clientName + "#" + index;
        long count = matchesSinceLog.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();
        long now = System.currentTimeMillis();
        long[] last = lastLogged.computeIfAbsent(key, k -> new long[]{0L});
        synchronized (last) {
            if (now - last[0] < LOG_INTERVAL_MS) {
                return;
            }
            last[0] = now;
        }
        matchesSinceLog.get(key).addAndGet(-count);
        log.info("Internal call from client {} accepted by INTERNAL_CLIENT_SECRET_ACCEPT entry {} "
                        + "({} such call(s) since the last line), path {}",
                clientName, index + 1, count, currentPath());
    }

    private static String currentPath() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            HttpServletRequest request = servletAttributes.getRequest();
            return request.getRequestURI();
        }
        return "-";
    }
}
