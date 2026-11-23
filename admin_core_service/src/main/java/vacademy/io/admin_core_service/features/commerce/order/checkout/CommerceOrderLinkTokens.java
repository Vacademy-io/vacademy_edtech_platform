package vacademy.io.admin_core_service.features.commerce.order.checkout;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * The link token a buyer's message carries:
 * {@code l1.<b64url(orderId|expiryEpochSeconds|linkEpoch|triggerTag)>.<b64url(first 16 bytes of HMAC-SHA256)>}
 * with the MAC over {@code "l1|" + instituteId + "|" + payload}. The institute is inside the MAC,
 * not the payload, so a token of one shop never verifies with another shop's key.
 *
 * <p>It opens nothing by itself: the order page exchanges it once for a short order access token.
 * It expires, and every link of one order is revoked by raising the order's {@code link_epoch}.
 * Its key is derived from {@code commerce.order-link.secret} (falling back to the order-token
 * secret) under its own purpose label, so no other commerce token verifies as a link and back.
 * A token is never logged and never put into an exception message.
 */
@Slf4j
@Component
public class CommerceOrderLinkTokens {

    static final String VERSION = "l1";
    private static final String PURPOSE = "commerce-order-link:";
    static final int MAX_LENGTH = 200;
    private static final Pattern SHAPE = Pattern.compile("^[A-Za-z0-9._-]{1,200}$");

    /** The outcome of reading a token. */
    public enum Status { VALID, INVALID, EXPIRED }

    /** What a token says; {@code orderId} and the rest only when its MAC is good. */
    public record Read(Status status, String orderId, Instant expiresAt, int linkEpoch, String triggerTag) {
        static Read invalid() {
            return new Read(Status.INVALID, null, null, -1, null);
        }
    }

    private final byte[] key;
    private final Clock clock;

    @Autowired
    public CommerceOrderLinkTokens(@Value("${commerce.order-link.secret:}") String secret) {
        this(secret, Clock.systemUTC());
    }

    CommerceOrderLinkTokens(String secret, Clock clock) {
        this.clock = clock;
        this.key = secret == null || secret.isBlank() ? null
                : sha256((PURPOSE + secret.trim()).getBytes(StandardCharsets.UTF_8));
        if (key == null) {
            log.warn("commerce.order-link.secret is not set: buyer messages carry no order link");
        }
    }

    public boolean isConfigured() {
        return key != null;
    }

    /** A token for the order that ends {@code life} from now. */
    public String issue(String instituteId, String orderId, int linkEpoch, String triggerTag, Duration life) {
        return issue(instituteId, orderId, linkEpoch, triggerTag, clock.instant().plus(life));
    }

    String issue(String instituteId, String orderId, int linkEpoch, String triggerTag, Instant expiresAt) {
        if (key == null) {
            throw new IllegalStateException("commerce.order-link.secret is not set");
        }
        if (instituteId == null || orderId == null || orderId.contains("|") || linkEpoch < 0) {
            throw new IllegalArgumentException("a link token needs an institute, an order and an epoch");
        }
        String tag = triggerTag == null || !triggerTag.matches("[A-Z]{2}") ? "XX" : triggerTag;
        byte[] payload = (orderId + "|" + expiresAt.getEpochSecond() + "|" + linkEpoch + "|" + tag)
                .getBytes(StandardCharsets.UTF_8);
        return VERSION + "." + encode(payload) + "." + encode(mac(instituteId, payload));
    }

    /**
     * Reads a token presented with the key of {@code instituteId}. INVALID for anything malformed,
     * a MAC that does not match (another shop's token included) or no key; EXPIRED only after
     * the MAC matched.
     */
    public Read verify(String instituteId, String token) {
        if (key == null || instituteId == null || token == null || token.length() > MAX_LENGTH
                || !SHAPE.matcher(token).matches()) {
            return Read.invalid();
        }
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3 || !VERSION.equals(parts[0])) {
            return Read.invalid();
        }
        byte[] payload;
        byte[] signature;
        try {
            payload = Base64.getUrlDecoder().decode(parts[1]);
            signature = Base64.getUrlDecoder().decode(parts[2]);
        } catch (IllegalArgumentException e) {
            return Read.invalid();
        }
        if (!MessageDigest.isEqual(mac(instituteId, payload), signature)) {
            return Read.invalid();
        }
        String[] fields = new String(payload, StandardCharsets.UTF_8).split("\\|", -1);
        if (fields.length != 4 || fields[0].isEmpty()) {
            return Read.invalid();
        }
        Instant expiresAt;
        int epoch;
        try {
            expiresAt = Instant.ofEpochSecond(Long.parseLong(fields[1]));
            epoch = Integer.parseInt(fields[2]);
        } catch (NumberFormatException e) {
            return Read.invalid();
        }
        Status status = expiresAt.isAfter(clock.instant()) ? Status.VALID : Status.EXPIRED;
        return new Read(status, fields[0], expiresAt, epoch, fields[3]);
    }

    private byte[] mac(String instituteId, byte[] payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            mac.update((VERSION + "|" + instituteId + "|").getBytes(StandardCharsets.UTF_8));
            return Arrays.copyOf(mac.doFinal(payload), 16);
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
