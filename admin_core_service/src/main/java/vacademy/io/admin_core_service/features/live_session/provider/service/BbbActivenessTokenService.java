package vacademy.io.admin_core_service.features.live_session.provider.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Signs and verifies the per-learner token handed to the BBB "vacademy-activeness"
 * plugin (opt-in camera attention score, bbb_config.activeness_score).
 *
 * The token travels in the BBB join URL as userdata-vacademy_activeness; the plugin
 * echoes it back in its report to /meeting/bbb-activeness, which has no JWT. The token
 * is what ties a report to exactly one (schedule, learner) pair, so a learner cannot
 * post a score for anyone else or for another class.
 *
 * Format: {@code v1.<b64url(scheduleId:userId:expEpochSeconds)>.<b64url(HMAC_SHA256(secret, "v1." + payloadB64))>}
 * (base64url, no padding). Valid for 24h — long enough for any class plus a late
 * final beacon, short enough that a leaked URL goes stale.
 *
 * Secret: bbb.activeness.token-secret, falling back to the internal service token.
 * When neither is set the feature is OFF: mint returns null and nothing verifies.
 *
 * Kill switch: bbb.plugins.activeness.enabled=false turns the feature off everywhere
 * at once — no plugin at meeting create, no token at join, nothing stored from
 * meetings already running.
 */
@Service
@Slf4j
public class BbbActivenessTokenService {

    static final String VERSION = "v1";
    static final long TTL_SECONDS = 24 * 60 * 60L;
    private static final String HMAC_ALGO = "HmacSHA256";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64_DEC = Base64.getUrlDecoder();

    private final String secret;
    private final Clock clock;
    private final boolean enabled;
    private final AtomicBoolean warnedBlank = new AtomicBoolean(false);

    /** Verified token contents. */
    public record Claims(String scheduleId, String userId) {
    }

    @Autowired
    public BbbActivenessTokenService(
            @Value("${bbb.activeness.token-secret:${internal.service.token:${ai.service.internal.token:}}}") String secret,
            @Value("${bbb.plugins.activeness.enabled:true}") boolean enabled) {
        this(secret, Clock.systemUTC(), enabled);
    }

    BbbActivenessTokenService(String secret, Clock clock) {
        this(secret, clock, true);
    }

    BbbActivenessTokenService(String secret, Clock clock, boolean enabled) {
        this.secret = secret;
        this.clock = clock;
        this.enabled = enabled;
    }

    /** True when the feature is switched on and a signing secret is configured. */
    public boolean isConfigured() {
        if (!enabled) {
            return false;
        }
        boolean ok = secret != null && !secret.isBlank();
        if (!ok && warnedBlank.compareAndSet(false, true)) {
            log.warn("[BBB] Activeness score disabled: no bbb.activeness.token-secret / internal.service.token configured");
        }
        return ok;
    }

    /** Mints a token for this learner in this class; null when the feature is off or ids are missing. */
    public String mint(String scheduleId, String userId) {
        if (!isConfigured() || isBlank(scheduleId) || isBlank(userId)) {
            return null;
        }
        long exp = clock.instant().getEpochSecond() + TTL_SECONDS;
        String payloadB64 = B64.encodeToString(
                (scheduleId + ":" + userId + ":" + exp).getBytes(StandardCharsets.UTF_8));
        String signed = VERSION + "." + payloadB64;
        byte[] sig = hmac(signed);
        return sig == null ? null : signed + "." + B64.encodeToString(sig);
    }

    /**
     * Verifies signature, version and expiry. Never throws: anything malformed,
     * tampered or expired is simply empty.
     */
    public Optional<Claims> verify(String token) {
        try {
            if (!isConfigured() || isBlank(token) || token.length() > 1024) {
                return Optional.empty();
            }
            String[] parts = token.split("\\.", -1);
            if (parts.length != 3 || !VERSION.equals(parts[0]) || parts[1].isEmpty() || parts[2].isEmpty()) {
                return Optional.empty();
            }
            byte[] expected = hmac(VERSION + "." + parts[1]);
            byte[] given = B64_DEC.decode(parts[2]);
            if (expected == null || !MessageDigest.isEqual(expected, given)) {
                return Optional.empty();
            }
            // Signature is good, so the payload is ours — but still parse defensively.
            String payload = new String(B64_DEC.decode(parts[1]), StandardCharsets.UTF_8);
            // scheduleId and userId are UUIDs today; split from the right so a ':' in
            // either can only ever break the parse, never shift a field.
            int lastColon = payload.lastIndexOf(':');
            int midColon = lastColon > 0 ? payload.lastIndexOf(':', lastColon - 1) : -1;
            if (midColon <= 0) {
                return Optional.empty();
            }
            String scheduleId = payload.substring(0, midColon);
            String userId = payload.substring(midColon + 1, lastColon);
            long exp = Long.parseLong(payload.substring(lastColon + 1));
            if (isBlank(scheduleId) || isBlank(userId) || clock.instant().getEpochSecond() > exp) {
                return Optional.empty();
            }
            return Optional.of(new Claims(scheduleId, userId));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private byte[] hmac(String data) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGO);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_ALGO));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            log.warn("[BBB] Activeness token HMAC failed: {}", e.getMessage());
            return null;
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
