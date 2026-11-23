package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

/**
 * The {@code order_access_token}: a signed, expiring
 * reference to one order, for the thank-you page and the order page a notification links to.
 * Order numbers are short and guessable, so they are never a secret; this token is. It is not a
 * login: it opens one order of one institute, read-only, and (while the order is unpaid) lets
 * its holder ask for the payment step again.
 *
 * <p>Form: {@code v1.<base64url(instituteId|orderId|expiryEpochSeconds)>.<base64url(HMAC-SHA256)>}.
 * The key is derived from {@code commerce.order-token.secret}; with no secret configured no
 * token is issued or accepted and checkout refuses to start.
 */
@Slf4j
@Component
public class CommerceOrderAccessTokens {

    static final Duration LIFETIME = Duration.ofDays(30);
    private static final String VERSION = "v1";
    private static final String PURPOSE = "commerce-order-access-token:";

    /** What a valid token names. */
    public record Access(String instituteId, String orderId, Instant expiresAt) {
    }

    private final byte[] key;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public CommerceOrderAccessTokens(
            @Value("${commerce.order-token.secret:}") String secret) {
        this(secret, Clock.systemUTC());
    }

    CommerceOrderAccessTokens(String secret, Clock clock) {
        this.clock = clock;
        if (secret == null || secret.isBlank()) {
            this.key = null;
            log.warn("commerce.order-token.secret is not set: the shop checkout is switched off");
        } else {
            this.key = sha256((PURPOSE + secret.trim()).getBytes(StandardCharsets.UTF_8));
        }
    }

    public boolean isConfigured() {
        return key != null;
    }

    public String issue(String instituteId, String orderId) {
        return issue(instituteId, orderId, clock.instant().plus(LIFETIME));
    }

    String issue(String instituteId, String orderId, Instant expiresAt) {
        requireKey();
        if (instituteId == null || orderId == null || instituteId.contains("|") || orderId.contains("|")) {
            throw new IllegalArgumentException("an order access token needs an institute and an order");
        }
        String payload = instituteId + "|" + orderId + "|" + expiresAt.getEpochSecond();
        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
        return VERSION + "." + encode(body) + "." + encode(sign(body));
    }

    /**
     * A token that ends at {@code expiresAt} (never later than the usual lifetime): the short token
     * an order link is exchanged for.
     */
    public String issueUntil(String instituteId, String orderId, Instant expiresAt) {
        Instant longest = clock.instant().plus(LIFETIME);
        return issue(instituteId, orderId, expiresAt == null || expiresAt.isAfter(longest) ? longest : expiresAt);
    }

    public Instant expiryOfNewToken() {
        return clock.instant().plus(LIFETIME);
    }

    /** The order a token opens, or null for a token that is malformed, forged or expired. */
    public Access verify(String token) {
        if (key == null || token == null || token.length() > 512) {
            return null;
        }
        String[] parts = token.trim().split("\\.");
        if (parts.length != 3 || !VERSION.equals(parts[0])) {
            return null;
        }
        byte[] body;
        byte[] signature;
        try {
            body = Base64.getUrlDecoder().decode(parts[1]);
            signature = Base64.getUrlDecoder().decode(parts[2]);
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (!MessageDigest.isEqual(sign(body), signature)) {
            return null;
        }
        String[] fields = new String(body, StandardCharsets.UTF_8).split("\\|");
        if (fields.length != 3) {
            return null;
        }
        Instant expiresAt;
        try {
            expiresAt = Instant.ofEpochSecond(Long.parseLong(fields[2]));
        } catch (NumberFormatException e) {
            return null;
        }
        if (!expiresAt.isAfter(clock.instant())) {
            return null;
        }
        return new Access(fields[0], fields[1], expiresAt);
    }

    private void requireKey() {
        if (key == null) {
            throw new IllegalStateException("commerce.order-token.secret is not set");
        }
    }

    private byte[] sign(byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(body);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    private static byte[] sha256(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    private static String encode(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
}
