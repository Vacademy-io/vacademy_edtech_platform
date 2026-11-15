package vacademy.io.admin_core_service.features.commerce.customer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/**
 * The shopper session of a shop: proof, for seven days, that the bearer read an OTP sent to a
 * phone in this shop. It lets the buyer open their own orders and addresses ({@code /me/*})
 * without a new WhatsApp code every visit, and stands in for an OTP on a prepaid checkout.
 *
 * <p>Form: {@code s1.<b64url(json{i,c,h,e,x,n})>.<b64url(HMAC-SHA256(key, "s1." + payload))>}:
 * institute, customer, the first 16 hex of the institute-salted phone hash, the session epoch
 * of the customer at issue, the expiry (epoch seconds) and 8 random bytes. The key is
 * SHA-256({@code "commerce-shopper-session:"} + secret), so no order token, phone token or
 * any other token of the platform verifies as a session, nor a session as one of them.
 *
 * <p>Every use reads the customer row once from the primary: it must exist in the institute
 * of the API key, not be anonymised, still have the phone the session was issued for and the
 * same epoch. Raising the epoch ({@link #endAll}) ends every session of that phone in that
 * shop. Any failure is "no session"; nothing here throws for a bad token.
 *
 * <p>It is not a login: it is never an auth_service token, never sent as Authorization, names
 * no user and no role, and only the shop's own {@code /open/commerce/v1} routes read it. No
 * token, key or secret is ever logged.
 */
@Slf4j
@Component
public class CommerceShopperSessions {

    public static final Duration LIFETIME = Duration.ofDays(7);
    public static final String HEADER = "X-Commerce-Session";
    static final int MAX_TOKEN_LENGTH = 512;
    private static final String VERSION = "s1";
    private static final String PURPOSE = "commerce-shopper-session:";
    private static final int HASH_PREFIX = 16;

    /** A new session: the token and when it ends. */
    public record Issued(String token, Instant expiresAt, String phone) {
    }

    /** What a valid session proves. {@code phone} is in the spelling of {@link CommercePhones}. */
    public record Session(String instituteId, String customerId, String phone, Instant expiresAt) {
    }

    private final CommerceCustomerRepository customers;
    private final TransactionTemplate primary;
    private final Clock clock;
    private final byte[] key;
    private final SecureRandom random = new SecureRandom();
    private final ObjectMapper json = new ObjectMapper();

    /**
     * @param secret         {@code commerce.shopper-session.secret}
     * @param fallbackSecret {@code commerce.order-token.secret}, used when the first is empty
     */
    @Autowired
    public CommerceShopperSessions(CommerceCustomerRepository customers, PlatformTransactionManager transactionManager,
                                   @Value("${commerce.shopper-session.secret:}") String secret,
                                   @Value("${commerce.order-token.secret:}") String fallbackSecret) {
        this(customers, new TransactionTemplate(transactionManager), Clock.systemUTC(),
                secret == null || secret.isBlank() ? fallbackSecret : secret);
    }

    CommerceShopperSessions(CommerceCustomerRepository customers, TransactionTemplate primary, Clock clock,
                            String secret) {
        this.customers = customers;
        this.primary = primary;
        this.clock = clock;
        this.key = secret == null || secret.isBlank() ? null
                : sha256((PURPOSE + secret.trim()).getBytes(StandardCharsets.UTF_8));
    }

    /** False when no secret is set: no session is issued and none is accepted. */
    public boolean isConfigured() {
        return key != null;
    }

    /**
     * A session for the phone an OTP just proved. The customer row of (institute, phone) is made
     * when the shop has not seen the phone (phone only: no name, account or e-mail), in a short
     * transaction of its own. Null when no secret is set.
     */
    public Issued issueForPhone(String instituteId, String phone) {
        if (key == null || instituteId == null || phone == null) {
            return null;
        }
        CommerceCustomerRepository.SessionRow row = primary.execute(status -> {
            customers.insertIfAbsent(UUID.randomUUID().toString(), instituteId, phone);
            return customers.findSessionRowByPhone(instituteId, phone).orElse(null);
        });
        if (row == null || row.getAnonymisedAt() != null) {
            return null;
        }
        return sign(instituteId, row.getId(), row.getPhone(), epoch(row));
    }

    /**
     * The session a token proves for this institute, or null for a token that is missing,
     * malformed, forged, expired, of another institute, of a customer that changed or was
     * anonymised, or issued before the last {@link #endAll}.
     */
    public Session verify(String instituteId, String token) {
        if (key == null || instituteId == null || token == null || token.isBlank()
                || token.length() > MAX_TOKEN_LENGTH) {
            return null;
        }
        Parsed parsed = parse(token.trim());
        if (parsed == null || !instituteId.equals(parsed.instituteId)
                || parsed.expiresAtSeconds <= clock.instant().getEpochSecond()) {
            return null;
        }
        CommerceCustomerRepository.SessionRow row;
        try {
            row = primary.execute(status -> customers.findSessionRow(parsed.customerId, instituteId).orElse(null));
        } catch (RuntimeException e) {
            log.warn("Shopper session could not be checked: {}", e.getClass().getSimpleName());
            return null;
        }
        if (row == null || row.getAnonymisedAt() != null || row.getPhone() == null
                || epoch(row) != parsed.epoch
                || !MessageDigest.isEqual(hashPrefix(instituteId, row.getPhone()).getBytes(StandardCharsets.US_ASCII),
                parsed.phoneHashPrefix.getBytes(StandardCharsets.US_ASCII))) {
            return null;
        }
        return new Session(instituteId, row.getId(), row.getPhone(), Instant.ofEpochSecond(parsed.expiresAtSeconds));
    }

    /** Ends every session of the customer (sign out everywhere). One atomic increment. */
    public void endAll(String instituteId, String customerId) {
        primary.executeWithoutResult(status -> customers.bumpSessionEpoch(customerId, instituteId));
    }

    // ------------------------------------------------------------------ token

    Issued sign(String instituteId, String customerId, String phone, long epoch) {
        Instant expiresAt = clock.instant().plus(LIFETIME);
        byte[] nonce = new byte[8];
        random.nextBytes(nonce);
        ObjectNode payload = json.createObjectNode();
        payload.put("i", instituteId);
        payload.put("c", customerId);
        payload.put("h", hashPrefix(instituteId, phone));
        payload.put("e", epoch);
        payload.put("x", expiresAt.getEpochSecond());
        payload.put("n", encode(nonce));
        String signedPart = VERSION + "." + encode(payload.toString().getBytes(StandardCharsets.UTF_8));
        String token = signedPart + "." + encode(hmac(signedPart));
        return new Issued(token, expiresAt, phone);
    }

    private record Parsed(String instituteId, String customerId, String phoneHashPrefix, long epoch,
                          long expiresAtSeconds) {
    }

    private Parsed parse(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3 || !VERSION.equals(parts[0])) {
            return null;
        }
        try {
            byte[] signature = Base64.getUrlDecoder().decode(parts[2]);
            if (!MessageDigest.isEqual(hmac(parts[0] + "." + parts[1]), signature)) {
                return null;
            }
            JsonNode payload = json.readTree(Base64.getUrlDecoder().decode(parts[1]));
            String instituteId = payload.path("i").asText("");
            String customerId = payload.path("c").asText("");
            String hash = payload.path("h").asText("");
            if (instituteId.isEmpty() || customerId.isEmpty() || customerId.length() > 64 || hash.length() != HASH_PREFIX
                    || !payload.path("e").canConvertToLong() || !payload.path("x").canConvertToLong()) {
                return null;
            }
            return new Parsed(instituteId, customerId, hash, payload.path("e").asLong(), payload.path("x").asLong());
        } catch (Exception e) {
            return null;
        }
    }

    private static long epoch(CommerceCustomerRepository.SessionRow row) {
        return row.getSessionEpoch() == null ? 0L : row.getSessionEpoch();
    }

    private static String hashPrefix(String instituteId, String phone) {
        return CommerceOtpService.phoneHash(instituteId, phone).substring(0, HASH_PREFIX);
    }

    private byte[] hmac(String text) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(text.getBytes(StandardCharsets.UTF_8));
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
