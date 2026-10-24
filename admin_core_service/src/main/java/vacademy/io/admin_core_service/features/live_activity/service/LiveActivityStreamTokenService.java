package vacademy.io.admin_core_service.features.live_activity.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_activity.config.LiveActivityProperties;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Mints and verifies the short-lived credential the SSE stream is opened with.
 *
 * <p><b>Why a token at all.</b> The browser's {@code EventSource} cannot set an
 * Authorization header, so the stream endpoint has to live on a permitAll path. The
 * per-call telephony stream gets away with that because a call-log UUID is itself an
 * unguessable capability; an {@code instituteId} is not, so this replaces the missing header
 * with a signed, expiring, caller-bound token minted from an authenticated request.
 *
 * <p><b>What the token carries.</b> institute, user, expiry, and the categories that
 * caller's role may see. Baking the category set in means the public stream endpoint needs
 * no settings lookup on the hot path, and the bus can filter every event against it.
 *
 * <p><b>Deliberate limitation: the token is not single-use.</b> Enforcing that needs state
 * shared across replicas, which would mean a DB round trip on every stream open for very
 * little gain. Instead it expires in 60 seconds and is bound to one institute and one user,
 * so a leaked token buys an attacker a minute of a stream they would need that user's
 * session to have obtained in the first place.
 */
@Service
public class LiveActivityStreamTokenService {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityStreamTokenService.class);

    private static final String HMAC_ALGO = "HmacSHA256";
    private static final String FIELD_SEPARATOR = "|";
    private static final String CATEGORY_SEPARATOR = ",";

    /**
     * Domain separator. The fallback secret is the application's JWT signing key, which is
     * the one value already shared identically by every replica -- a token minted on one pod
     * has to verify on another. It is run through HMAC with this label rather than used
     * directly so that a stream token can never be confused for, or repurposed as, an
     * authentication token. Prefer setting LIVE_ACTIVITY_TOKEN_SECRET in any real
     * deployment.
     */
    private static final String KEY_DERIVATION_LABEL = "live-activity-stream-token-v1";

    private final byte[] key;
    private final LiveActivityProperties properties;

    public LiveActivityStreamTokenService(
            LiveActivityProperties properties,
            @Value("${live-activity.token-secret:}") String configuredSecret) {
        this.properties = properties;
        String base = (configuredSecret == null || configuredSecret.isBlank())
                ? vacademy.io.common.auth.service.JwtService.secretKey
                : configuredSecret;
        this.key = deriveKey(base);
    }

    public String mint(String instituteId, String userId, Set<String> allowedCategories) {
        long expiresAt = System.currentTimeMillis()
                + (properties.getSse().getTokenTtlSeconds() * 1000L);
        String payload = String.join(FIELD_SEPARATOR,
                instituteId,
                userId,
                Long.toString(expiresAt),
                String.join(CATEGORY_SEPARATOR, allowedCategories));
        String encoded = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        return encoded + "." + sign(encoded);
    }

    public long expiryOf(String instituteId, String userId, Set<String> allowedCategories) {
        return System.currentTimeMillis() + (properties.getSse().getTokenTtlSeconds() * 1000L);
    }

    /**
     * @return the verified claims, or {@code null} for anything that is malformed, tampered
     *         with, or expired. Callers must treat null as a 401 and must not fall back to
     *         trusting a query-param institute id.
     */
    public Claims verify(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        int dot = token.lastIndexOf('.');
        if (dot <= 0 || dot == token.length() - 1) {
            return null;
        }
        String encoded = token.substring(0, dot);
        String signature = token.substring(dot + 1);

        // Constant-time compare: a fast-exit equals() on a signature is a timing oracle.
        if (!MessageDigest.isEqual(
                sign(encoded).getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8))) {
            return null;
        }

        try {
            String payload = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            String[] parts = payload.split("\\" + FIELD_SEPARATOR, -1);
            if (parts.length < 4) {
                return null;
            }
            long expiresAt = Long.parseLong(parts[2]);
            if (System.currentTimeMillis() > expiresAt) {
                return null;
            }
            Set<String> categories = new LinkedHashSet<>();
            if (!parts[3].isBlank()) {
                categories.addAll(List.of(parts[3].split(CATEGORY_SEPARATOR)));
            }
            return new Claims(parts[0], parts[1], expiresAt, categories);
        } catch (Exception e) {
            log.debug("live activity stream token rejected: {}", e.getMessage());
            return null;
        }
    }

    private String sign(String encoded) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGO);
            mac.init(new SecretKeySpec(key, HMAC_ALGO));
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(encoded.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to sign live activity stream token", e);
        }
    }

    private static byte[] deriveKey(String base) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGO);
            mac.init(new SecretKeySpec(base.getBytes(StandardCharsets.UTF_8), HMAC_ALGO));
            return mac.doFinal(KEY_DERIVATION_LABEL.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to derive live activity token key", e);
        }
    }

    /** Verified token contents. */
    public record Claims(String instituteId,
                         String userId,
                         long expiresAtEpochMillis,
                         Set<String> allowedCategories) {
    }
}
