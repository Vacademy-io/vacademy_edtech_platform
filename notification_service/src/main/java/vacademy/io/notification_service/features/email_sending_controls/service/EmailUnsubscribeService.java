package vacademy.io.notification_service.features.email_sending_controls.service;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.email_sending_controls.entity.EmailUnsubscribe;
import vacademy.io.notification_service.features.email_sending_controls.repository.EmailUnsubscribeRepository;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Recipient opt-outs and the signed links that create them.
 *
 * The unsubscribe URL carries (institute, email, HMAC) so it needs no database
 * row at send time and cannot be forged for someone else's address. The secret
 * is {@code email.unsubscribe.secret}; when unset we fall back to a hash of the
 * SES SMTP password so links keep working across restarts without a new env var.
 */
@Service
@Slf4j
public class EmailUnsubscribeService {

    private final EmailUnsubscribeRepository repository;
    private final String configuredSecret;
    private final String fallbackSecretSource;
    private final String baseUrl;
    private byte[] key;

    private final ConcurrentHashMap<String, long[]> cache = new ConcurrentHashMap<>(); // key -> {isUnsub(0/1), ts}
    private static final long CACHE_TTL_MS = TimeUnit.MINUTES.toMillis(5);

    public EmailUnsubscribeService(EmailUnsubscribeRepository repository,
                                   @Value("${email.unsubscribe.secret:}") String configuredSecret,
                                   @Value("${spring.mail.password:}") String fallbackSecretSource,
                                   @Value("${email.unsubscribe.base.url:https://backend-stage.vacademy.io}") String baseUrl) {
        this.repository = repository;
        this.configuredSecret = configuredSecret;
        this.fallbackSecretSource = fallbackSecretSource;
        // kubectl set env with an unset secret yields "" (not absent), which would bypass the
        // property default — treat blank as "use the public gateway".
        String origin = (baseUrl == null || baseUrl.isBlank()) ? "https://backend-stage.vacademy.io" : baseUrl;
        this.baseUrl = origin.trim().replaceAll("/+$", "");
    }

    @PostConstruct
    void init() throws Exception {
        String material = configuredSecret;
        if (material == null || material.isBlank()) {
            material = fallbackSecretSource;
            if (material == null || material.isBlank()) {
                material = "vacademy-unsubscribe-dev-only";
                log.warn("email.unsubscribe.secret is not set and no mail password to derive from; using a DEV-ONLY key");
            } else {
                log.warn("email.unsubscribe.secret is not set; deriving the unsubscribe HMAC key from spring.mail.password. Set EMAIL_UNSUBSCRIBE_SECRET to decouple them.");
            }
        }
        key = MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
    }

    // ---- lookups -----------------------------------------------------------------------------

    public boolean isUnsubscribed(String email, String instituteId) {
        if (email == null || email.isBlank() || instituteId == null || instituteId.isBlank()) return false;
        String e = norm(email);
        String ck = instituteId + "|" + e;
        long[] hit = cache.get(ck);
        long now = System.currentTimeMillis();
        if (hit != null && now - hit[1] < CACHE_TTL_MS) return hit[0] == 1;
        boolean v = repository.existsByEmailAndInstituteIdAndIsActiveTrue(e, instituteId);
        cache.put(ck, new long[]{v ? 1 : 0, now});
        return v;
    }

    public long countActive(String instituteId) {
        return instituteId == null ? 0 : repository.countByInstituteIdAndIsActiveTrue(instituteId);
    }

    // ---- writes ------------------------------------------------------------------------------

    @Transactional
    public EmailUnsubscribe unsubscribe(String email, String instituteId, String source, String reason) {
        String e = norm(email);
        Optional<EmailUnsubscribe> existing = repository.findByEmailAndInstituteId(e, instituteId);
        EmailUnsubscribe row = existing.orElseGet(() -> {
            EmailUnsubscribe n = new EmailUnsubscribe();
            n.setId(UUID.randomUUID().toString());
            n.setEmail(e);
            n.setInstituteId(instituteId);
            return n;
        });
        row.setIsActive(true);
        row.setSource(source == null ? "LINK" : source);
        row.setReason(reason);
        EmailUnsubscribe saved = repository.save(row);
        cache.put(instituteId + "|" + e, new long[]{1, System.currentTimeMillis()});
        log.info("Unsubscribed {} from institute {} via {}", e, instituteId, source);
        return saved;
    }

    @Transactional
    public boolean resubscribe(String email, String instituteId) {
        String e = norm(email);
        Optional<EmailUnsubscribe> existing = repository.findByEmailAndInstituteId(e, instituteId);
        if (existing.isEmpty()) return false;
        existing.get().setIsActive(false);
        repository.save(existing.get());
        cache.put(instituteId + "|" + e, new long[]{0, System.currentTimeMillis()});
        return true;
    }

    // ---- signed links ------------------------------------------------------------------------

    public String token(String instituteId, String email) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            byte[] sig = mac.doFinal((instituteId + "\n" + norm(email)).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(sig).substring(0, 32);
        } catch (Exception ex) {
            throw new IllegalStateException("Cannot sign unsubscribe token", ex);
        }
    }

    public boolean verify(String instituteId, String email, String token) {
        if (instituteId == null || email == null || token == null) return false;
        return MessageDigest.isEqual(token(instituteId, email).getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8));
    }

    /** Absolute URL for the unsubscribe page/one-click POST for this recipient. */
    public String unsubscribeUrl(String instituteId, String email) {
        return baseUrl + "/notification-service/public/v1/email/unsubscribe?i=" + enc(instituteId)
                + "&e=" + enc(norm(email)) + "&t=" + enc(token(instituteId, email));
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
    private static String norm(String email) { return email.trim().toLowerCase(Locale.ROOT); }
}
