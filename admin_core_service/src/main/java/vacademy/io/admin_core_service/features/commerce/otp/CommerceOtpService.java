package vacademy.io.admin_core_service.features.commerce.otp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;
import java.util.Optional;

/**
 * Phone OTP for the shop (the {@code /otp/*} routes). The code is made
 * here ({@link SecureRandom}), only its HMAC is kept on the challenge row, and it is compared
 * here. The platform is used for one thing: to deliver the message. The shared OTP store of the
 * platform is not used: a shop code is checked only here, with a try limit, single use, and the
 * institute and purpose bound to it.
 *
 * <ul>
 *   <li><b>Send limits</b>, counted in the database for all pods: one code a minute and
 *       {@value #SENDS_PER_PHONE_10_MIN} in ten minutes and {@value #SENDS_PER_PHONE_DAY} a day
 *       per phone; {@value #SENDS_PER_IP_10_MIN} in ten minutes per network address (the address
 *       the request really came from, never one the caller names);
 *       {@value #SENDS_PER_INSTITUTE_HOUR} an hour per institute (every send is a paid
 *       WhatsApp message).</li>
 *   <li><b>Wrong-guess limit:</b> {@value #MAX_ATTEMPTS} tries per code, then the code is
 *       locked and a new one is needed; and {@value #VERIFIES_PER_IP_10_MIN} tries in ten
 *       minutes per network address.</li>
 *   <li><b>Expiry and single use:</b> a code can be tried for nine minutes and is accepted
 *       once.</li>
 *   <li><b>Institute and purpose:</b> a code asked for one purpose in one shop verifies
 *       nothing else.</li>
 * </ul>
 *
 * <p>A correct code gives a <b>verified-phone token</b>: {@code v1.<payload>.<signature>},
 * where the payload names the challenge, the institute, the phone, the purpose and the expiry
 * ({@value #TOKEN_MINUTES} minutes), and the signature is an HMAC-SHA256 with a random key
 * kept on the challenge row. It is not a login: it carries no user, no role and no session,
 * it is not a platform JWT, no platform endpoint accepts it, and it proves one thing, that
 * the bearer read a code sent to that phone a few minutes ago. Because the key lives on the
 * row, a token can be spent ({@link #consumeToken}) and needs no server-wide secret.
 *
 * <p>No remote call is made inside a database transaction; the service refuses to run in one.
 * The phone number is never logged and is stored only as a hash.
 */
@Slf4j
@Service
public class CommerceOtpService {

    static final int SENDS_PER_PHONE_10_MIN = 3;
    static final int SENDS_PER_PHONE_DAY = 8;
    static final int SENDS_PER_IP_10_MIN = 10;
    /**
     * A server-side caller (it names its shopper in a header) sends for many shoppers from one
     * address. Its allowance is larger, and still well under the allowance of the institute, so
     * one machine cannot use up the codes of the shoppers in a browser.
     */
    static final int SENDS_PER_SERVER_10_MIN = 30;
    static final int CODE_DIGITS = 6;
    static final int SENDS_PER_INSTITUTE_HOUR = 300;
    static final int VERIFIES_PER_IP_10_MIN = 30;
    static final int MAX_ATTEMPTS = 5;
    static final int TOKEN_MINUTES = 15;

    static final Duration RESEND_GAP = Duration.ofMinutes(1);
    static final Duration TEN_MINUTES = Duration.ofMinutes(10);
    static final Duration HOUR = Duration.ofHours(1);
    static final Duration DAY = Duration.ofDays(1);
    static final Duration CODE_LIFE = Duration.ofMinutes(9);
    static final Duration TOKEN_LIFE = Duration.ofMinutes(TOKEN_MINUTES);

    static final String SCOPE_SEND_GAP = "otp-send-gap";
    static final String SCOPE_SEND_PHONE = "otp-send-phone";
    static final String SCOPE_SEND_PHONE_DAY = "otp-send-phone-day";
    static final String SCOPE_SEND_IP = "otp-send-ip";
    static final String SCOPE_SEND_NAMED = "otp-send-named";
    static final String SCOPE_SEND_INSTITUTE = "otp-send-institute";
    static final String SCOPE_VERIFY_IP = "otp-verify-ip";

    private static final String TOKEN_VERSION = "v1";
    private static final int MAX_TOKEN_LENGTH = 1024;

    /** What a request for a code answers. Nothing here says whether the phone is known. */
    public record OtpSent(int expiresInSeconds, int resendAfterSeconds) {
    }

    /** What a valid verified-phone token proves. */
    public record VerifiedPhone(String instituteId, String phone, CommerceOtpPurpose purpose, Date expiresAt,
                                String challengeId) {
    }

    private final CommerceOtpTransport transport;
    private final CommerceOtpChallengeRepository challenges;
    private final CommerceRateLimiter limiter;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final ObjectMapper json = new ObjectMapper();
    /** Keys the HMAC of a code. Empty: no code can be sent or checked. */
    private final byte[] codeKey;

    @Autowired
    public CommerceOtpService(CommerceOtpTransport transport, CommerceOtpChallengeRepository challenges,
                              CommerceRateLimiter limiter,
                              @Value("${commerce.otp.secret:${commerce.order-token.secret:}}") String secret) {
        this(transport, challenges, limiter, Clock.systemUTC(), secret);
    }

    CommerceOtpService(CommerceOtpTransport transport, CommerceOtpChallengeRepository challenges,
                       CommerceRateLimiter limiter, Clock clock, String secret) {
        this.transport = transport;
        this.challenges = challenges;
        this.limiter = limiter;
        this.clock = clock;
        this.codeKey = secret == null ? new byte[0] : secret.trim().getBytes(StandardCharsets.UTF_8);
    }

    // ── Request ──────────────────────────────────────────────────────────────

    /** As {@link #requestOtp(String, String, String, String)} for a caller with no network address. */
    public OtpSent requestOtp(String instituteId, String phone, String purpose) {
        return requestOtp(instituteId, phone, purpose, null, null);
    }

    /** As {@link #requestOtp(String, String, String, String, String)} for a browser call. */
    public OtpSent requestOtp(String instituteId, String phone, String purpose, String networkIp) {
        return requestOtp(instituteId, phone, purpose, networkIp, null);
    }

    /**
     * Sends a code to {@code phone}.
     *
     * @param networkIp the address the request came from (the edge's header or the socket); the
     *                  caller cannot choose it, and the per-address limit is counted on it
     * @param namedIp   the shopper a server-side caller names (X-Client-IP), or null. It is only
     *                  a second, stricter bucket: it can never widen the limit of the address
     * @throws CommerceOtpException {@code OTP_INVALID_REQUEST}, {@code OTP_RATE_LIMITED} or
     *                              {@code OTP_UNAVAILABLE}
     */
    public OtpSent requestOtp(String instituteId, String phone, String purpose, String networkIp, String namedIp) {
        requireNoTransaction();
        if (codeKey.length == 0) {
            log.error("COMMERCE_ALERT commerce OTP has no secret (commerce.otp.secret / "
                    + "commerce.order-token.secret); no code is sent");
            throw new CommerceOtpException(CommerceOtpException.UNAVAILABLE, "Codes cannot be sent right now.");
        }
        String normalised = normalisedPhone(instituteId, phone);
        CommerceOtpPurpose otpPurpose = purposeOf(purpose);
        String phoneHash = phoneHash(instituteId, normalised);
        long now = clock.millis();

        // The cheapest refusal first; each test counts, so a flood on one phone or from one
        // address cannot use up the allowance of the institute.
        limit(instituteId, SCOPE_SEND_GAP, phoneHash, RESEND_GAP, 1, now,
                "A code was sent a moment ago. Wait a minute before asking for another.");
        limit(instituteId, SCOPE_SEND_PHONE, phoneHash, TEN_MINUTES, SENDS_PER_PHONE_10_MIN, now,
                "Too many codes were asked for this number. Try again later.");
        limit(instituteId, SCOPE_SEND_PHONE_DAY, phoneHash, DAY, SENDS_PER_PHONE_DAY, now,
                "Too many codes were asked for this number today.");
        boolean named = StringUtils.hasText(namedIp);
        if (StringUtils.hasText(networkIp)) {
            limit(instituteId, SCOPE_SEND_IP, networkIp.trim(), TEN_MINUTES,
                    named ? SENDS_PER_SERVER_10_MIN : SENDS_PER_IP_10_MIN, now,
                    "Too many codes were asked for from this network. Try again later.");
        }
        if (named) {
            limit(instituteId, SCOPE_SEND_NAMED, namedIp.trim(), TEN_MINUTES, SENDS_PER_IP_10_MIN, now,
                    "Too many codes were asked for from this network. Try again later.");
        }
        try {
            limit(instituteId, SCOPE_SEND_INSTITUTE, CommerceRateLimiter.ALL, HOUR, SENDS_PER_INSTITUTE_HOUR, now,
                    "Codes cannot be sent right now. Try again later.");
        } catch (CommerceOtpException e) {
            if (CommerceOtpException.RATE_LIMITED.equals(e.getCode())) {
                // Every send is a paid message and, while the cap is full, no buyer gets a code.
                log.error("COMMERCE_ALERT otp_institute_cap_reached institute={} cap_per_hour={}", instituteId,
                        SENDS_PER_INSTITUTE_HOUR);
            }
            throw e;
        }

        String code = newCode();
        transport.send(instituteId, normalised, code);

        // Only the newest code of a phone and purpose can be tried.
        Date sentAt = new Date(clock.millis());
        challenges.supersede(instituteId, phoneHash, otpPurpose.name(), sentAt);
        CommerceOtpChallenge challenge = new CommerceOtpChallenge();
        challenge.setInstituteId(instituteId);
        challenge.setPhoneHash(phoneHash);
        challenge.setPurpose(otpPurpose.name());
        challenge.setStatus(CommerceOtpChallenge.SENT);
        challenge.setAttempts(0);
        challenge.setCodeHash(codeHash(instituteId, phoneHash, otpPurpose, code));
        challenge.setExpiresAt(new Date(sentAt.getTime() + CODE_LIFE.toMillis()));
        challenges.save(challenge);
        log.info("Commerce OTP sent for institute {} purpose {}", instituteId, otpPurpose);
        return new OtpSent((int) CODE_LIFE.toSeconds(), (int) RESEND_GAP.toSeconds());
    }

    // ── Verify ───────────────────────────────────────────────────────────────

    /** As {@link #verifyOtp(String, String, String, String, String)} without a network address. */
    public String verifyOtp(String instituteId, String phone, String code, String purpose) {
        return verifyOtp(instituteId, phone, code, purpose, null);
    }

    /**
     * Checks a code and returns the verified-phone token.
     *
     * @param networkIp the address the request came from; the per-address limit is counted on it
     * @throws CommerceOtpException {@code OTP_INVALID} for a wrong, used or expired code (one
     *                              answer for all), {@code OTP_LOCKED} after too many wrong
     *                              guesses, {@code OTP_RATE_LIMITED}, {@code OTP_UNAVAILABLE}
     */
    public String verifyOtp(String instituteId, String phone, String code, String purpose, String networkIp) {
        requireNoTransaction();
        String clientIp = networkIp;
        String normalised = normalisedPhone(instituteId, phone);
        CommerceOtpPurpose otpPurpose = purposeOf(purpose);
        String digits = code == null ? "" : code.trim();
        if (!digits.matches("[0-9]{4,8}")) {
            throw new CommerceOtpException(CommerceOtpException.INVALID_CODE, "The code is not correct.");
        }
        long now = clock.millis();
        if (StringUtils.hasText(clientIp)) {
            limit(instituteId, SCOPE_VERIFY_IP, clientIp.trim(), TEN_MINUTES, VERIFIES_PER_IP_10_MIN, now,
                    "Too many tries from this network. Try again later.");
        }
        String phoneHash = phoneHash(instituteId, normalised);
        Optional<CommerceOtpChallenge> found = challenges
                .findFirstByInstituteIdAndPhoneHashAndPurposeAndStatusOrderByCreatedAtDesc(instituteId, phoneHash,
                        otpPurpose.name(), CommerceOtpChallenge.SENT);
        if (found.isEmpty() || found.get().getExpiresAt() == null
                || found.get().getExpiresAt().getTime() <= now) {
            throw new CommerceOtpException(CommerceOtpException.INVALID_CODE, "The code is not correct.");
        }
        CommerceOtpChallenge challenge = found.get();

        // The try is counted before the code is checked, so parallel guesses cannot pass the limit.
        if (challenges.countAttempt(challenge.getId(), MAX_ATTEMPTS, new Date(now)) == 0) {
            challenges.lock(challenge.getId(), new Date(now));
            throw new CommerceOtpException(CommerceOtpException.LOCKED,
                    "Too many wrong tries. Ask for a new code.");
        }
        // Compared here, in constant time, with the HMAC on the row: the row carries the
        // institute, the phone and the purpose, so a code proves nothing anywhere else.
        String stored = challenge.getCodeHash();
        boolean correct = codeKey.length > 0 && StringUtils.hasText(stored)
                && MessageDigest.isEqual(stored.getBytes(StandardCharsets.US_ASCII),
                codeHash(instituteId, phoneHash, otpPurpose, digits).getBytes(StandardCharsets.US_ASCII));
        if (!correct) {
            throw new CommerceOtpException(CommerceOtpException.INVALID_CODE, "The code is not correct.");
        }

        byte[] key = new byte[32];
        random.nextBytes(key);
        String tokenKey = Base64.getUrlEncoder().withoutPadding().encodeToString(key);
        Date verifiedAt = new Date(clock.millis());
        Date tokenExpiresAt = new Date(verifiedAt.getTime() + TOKEN_LIFE.toMillis());
        if (challenges.markVerified(challenge.getId(), tokenKey, tokenExpiresAt, verifiedAt) == 0) {
            // Another request used this code first.
            throw new CommerceOtpException(CommerceOtpException.INVALID_CODE, "The code is not correct.");
        }
        log.info("Commerce OTP verified for institute {} purpose {}", instituteId, otpPurpose);
        return sign(challenge.getId(), instituteId, normalised, otpPurpose, tokenExpiresAt, key);
    }

    // ── Token ────────────────────────────────────────────────────────────────

    /**
     * The phone a verified-phone token proves, in the spelling of {@link CommercePhones}.
     * A caller that acts on the phone should also compare the institute and the purpose:
     * {@link #readToken(String)} gives all three, and {@link #verifyToken(String, String, String)}
     * compares them.
     *
     * @throws CommerceOtpException {@code OTP_TOKEN_INVALID}
     */
    public String verifyToken(String token) {
        return readToken(token).phone();
    }

    /** The phone of a token that was issued for this institute and this purpose. */
    public String verifyToken(String instituteId, String token, String purpose) {
        VerifiedPhone verified = readToken(token);
        if (!verified.instituteId().equals(instituteId) || verified.purpose() != CommerceOtpPurpose.of(purpose)) {
            throw invalidToken();
        }
        return verified.phone();
    }

    /** Everything a valid token proves. One read of the challenge row; no remote call. */
    public VerifiedPhone readToken(String token) {
        Parsed parsed = parse(token);
        CommerceOtpChallenge challenge = challenges.findById(parsed.challengeId).orElseThrow(this::invalidToken);
        long now = clock.millis();
        if (!CommerceOtpChallenge.VERIFIED.equals(challenge.getStatus())
                || !StringUtils.hasText(challenge.getTokenKey())
                || challenge.getTokenExpiresAt() == null || challenge.getTokenExpiresAt().getTime() <= now
                || parsed.expiresAtMillis <= now) {
            throw invalidToken();
        }
        byte[] key;
        try {
            key = Base64.getUrlDecoder().decode(challenge.getTokenKey());
        } catch (IllegalArgumentException e) {
            throw invalidToken();
        }
        if (!MessageDigest.isEqual(hmac(key, parsed.signedPart), parsed.signature)) {
            throw invalidToken();
        }
        // The signed payload must also agree with the row it names.
        if (!challenge.getInstituteId().equals(parsed.instituteId)
                || !challenge.getPurpose().equals(parsed.purpose.name())
                || !challenge.getPhoneHash().equals(phoneHash(parsed.instituteId, parsed.phone))) {
            throw invalidToken();
        }
        return new VerifiedPhone(parsed.instituteId, parsed.phone, parsed.purpose, new Date(parsed.expiresAtMillis),
                challenge.getId());
    }

    /**
     * Spends a token: it is valid now and can never be used again. For an action a phone may
     * be verified for once, such as placing one COD order (WP-31). Only one of two parallel
     * calls wins.
     *
     * @throws CommerceOtpException {@code OTP_TOKEN_INVALID}
     */
    public VerifiedPhone consumeToken(String token) {
        VerifiedPhone verified = readToken(token);
        if (challenges.consume(verified.challengeId(), new Date(clock.millis())) == 0) {
            throw invalidToken();
        }
        return verified;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void limit(String instituteId, String scope, String subject, Duration window, int limit, long now,
                       String message) {
        boolean allowed;
        try {
            allowed = limiter.allow(instituteId, scope, subject, window, limit);
        } catch (RuntimeException e) {
            // A limiter that cannot count must not turn into unlimited paid messages.
            log.error("COMMERCE_ALERT commerce rate limiter failed for scope {}: {}", scope, e.getMessage());
            throw new CommerceOtpException(CommerceOtpException.UNAVAILABLE, "Codes cannot be sent right now.");
        }
        if (!allowed) {
            throw new CommerceOtpException(CommerceOtpException.RATE_LIMITED, message,
                    CommerceRateLimiter.secondsToNextWindow(window, now));
        }
    }

    private static String normalisedPhone(String instituteId, String phone) {
        if (!StringUtils.hasText(instituteId)) {
            throw new CommerceOtpException(CommerceOtpException.INVALID_REQUEST, "The shop is not known.");
        }
        String normalised = phone == null || phone.length() > 32 ? null : CommercePhones.normalise(phone);
        if (normalised == null) {
            throw new CommerceOtpException(CommerceOtpException.INVALID_REQUEST, "Enter a valid phone number.");
        }
        return normalised;
    }

    private static CommerceOtpPurpose purposeOf(String purpose) {
        CommerceOtpPurpose otpPurpose = CommerceOtpPurpose.of(purpose);
        if (otpPurpose == null) {
            throw new CommerceOtpException(CommerceOtpException.INVALID_REQUEST, "The purpose is not known.");
        }
        return otpPurpose;
    }

    private String newCode() {
        int bound = 1;
        for (int i = 0; i < CODE_DIGITS; i++) {
            bound *= 10;
        }
        return String.format("%0" + CODE_DIGITS + "d", random.nextInt(bound));
    }

    /** HMAC-SHA256 of the code with the server key, bound to the institute, phone and purpose. */
    private String codeHash(String instituteId, String phoneHash, CommerceOtpPurpose purpose, String code) {
        return HexFormat.of().formatHex(hmac(codeKey, instituteId + "|" + phoneHash + "|" + purpose.name() + "|" + code));
    }

    /** The hash is salted with the institute, so one phone has unrelated hashes in two shops. */
    static String phoneHash(String instituteId, String normalisedPhone) {
        return CommerceRateLimiter.hash(instituteId + "|" + normalisedPhone);
    }

    private static void requireNoTransaction() {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("The OTP service calls another service and must not run in a transaction");
        }
    }

    private String sign(String challengeId, String instituteId, String phone, CommerceOtpPurpose purpose,
                        Date expiresAt, byte[] key) {
        ObjectNode payload = json.createObjectNode();
        payload.put("c", challengeId);
        payload.put("i", instituteId);
        payload.put("p", phone);
        payload.put("u", purpose.name());
        payload.put("e", expiresAt.getTime());
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String signedPart = TOKEN_VERSION + "."
                + encoder.encodeToString(payload.toString().getBytes(StandardCharsets.UTF_8));
        return signedPart + "." + encoder.encodeToString(hmac(key, signedPart));
    }

    private record Parsed(String challengeId, String instituteId, String phone, CommerceOtpPurpose purpose,
                          long expiresAtMillis, String signedPart, byte[] signature) {
    }

    private Parsed parse(String token) {
        if (token == null || token.length() > MAX_TOKEN_LENGTH) {
            throw invalidToken();
        }
        String[] parts = token.trim().split("\\.");
        if (parts.length != 3 || !TOKEN_VERSION.equals(parts[0])) {
            throw invalidToken();
        }
        try {
            JsonNode payload = json.readTree(Base64.getUrlDecoder().decode(parts[1]));
            String challengeId = payload.path("c").asText("");
            String instituteId = payload.path("i").asText("");
            String phone = payload.path("p").asText("");
            CommerceOtpPurpose purpose = CommerceOtpPurpose.of(payload.path("u").asText(""));
            long expiresAt = payload.path("e").asLong(0L);
            if (challengeId.isEmpty() || challengeId.length() > 64 || instituteId.isEmpty() || phone.isEmpty()
                    || purpose == null || expiresAt <= 0) {
                throw invalidToken();
            }
            return new Parsed(challengeId, instituteId, phone, purpose, expiresAt, parts[0] + "." + parts[1],
                    Base64.getUrlDecoder().decode(parts[2]));
        } catch (CommerceOtpException e) {
            throw e;
        } catch (Exception e) {
            throw invalidToken();
        }
    }

    private static byte[] hmac(byte[] key, String text) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(text.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    private CommerceOtpException invalidToken() {
        return new CommerceOtpException(CommerceOtpException.INVALID_TOKEN, "The phone verification is not valid.");
    }
}
