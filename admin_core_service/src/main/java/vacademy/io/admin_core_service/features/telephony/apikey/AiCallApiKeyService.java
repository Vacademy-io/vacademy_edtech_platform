package vacademy.io.admin_core_service.features.telephony.apikey;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.apikey.entity.AiCallApiKey;
import vacademy.io.admin_core_service.features.telephony.apikey.repository.AiCallApiKeyRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issues and verifies API keys for the external AI-Calling API.
 *
 * Key shape: {@code vak_live_<48 hex chars>} — a recognizable prefix so a
 * leaked
 * key can be spotted in logs/scanners, and 192 bits of SecureRandom entropy.
 *
 * Keys are retained for authorized operator sharing. {@link #verify} uses the
 * unique database index on the complete key instead of loading every active key
 * into application memory.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiCallApiKeyService {

    /**
     * Identifiable head of every issued key — recognizable in logs/leak scanners.
     */
    public static final String KEY_PREFIX = "vak_live_";
    /** 24 random bytes = 48 hex chars ≈ 192 bits of entropy. */
    private static final int RANDOM_BYTES = 24;
    private static final int MAX_KEYS_PER_INSTITUTE = 50;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final AiCallApiKeyRepository repository;

    // ── Issuing (admin, JWT-authenticated) ───────────────────────────────────

    /**
     * Issues a new key for the institute. Returns the PLAINTEXT once — the only
     * time it is ever visible; persist it in the client's secret manager now,
     * because this service cannot show it again.
     */
    @Transactional
    public IssuedKey issue(String instituteId, String keyName, String createdBy) {
        if (instituteId == null || instituteId.isBlank())
            throw new VacademyException("instituteId is required.");
        long active = repository.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                .filter(AiCallApiKey::isActive)
                .count();
        if (active >= MAX_KEYS_PER_INSTITUTE) {
            throw new VacademyException("Too many active API keys for this institute — revoke some first.");
        }

        byte[] rnd = new byte[RANDOM_BYTES];
        RANDOM.nextBytes(rnd);
        String secretPart = HexFormat.of().formatHex(rnd);
        String plaintext = KEY_PREFIX + secretPart;

        AiCallApiKey entity = AiCallApiKey.builder()
                .instituteId(instituteId)
                .keyName(keyName)
                .keyPrefix(truncate(plaintext, 16))
                .apiKey(plaintext)
                .status(AiCallApiKey.STATUS_ACTIVE)
                .createdBy(createdBy)
                .build();
        repository.save(entity);
        log.info("api-key: issued key id={} prefix={} for institute {} by {}",
                entity.getId(), entity.getKeyPrefix(), instituteId, createdBy);
        return new IssuedKey(entity, plaintext);
    }

    /** Public read-back DTO: hash and plaintext absent by construction. */
    public List<AiCallApiKey> list(String instituteId) {
        return repository.findByInstituteIdOrderByCreatedAtDesc(instituteId);
    }

    @Transactional
    public boolean revoke(String instituteId, String keyId) {
        int n = repository.revoke(keyId, instituteId, Instant.now());
        if (n > 0)
            log.info("api-key: revoked key id={} for institute {}", keyId, instituteId);
        return n > 0;
    }

    // ── Verification (public API) ────────────────────────────────────────────

    /**
     * Resolves a presented key to its institute. Throws 401 on unknown/revoked.
     * Returns the entity so the public controller can stamp last-used and scope
     * every query by {@link AiCallApiKey#getInstituteId()}.
     */
    @Transactional
    public AiCallApiKey verify(String presentedKey) {
        if (presentedKey == null || presentedKey.isBlank())
            throw unauthorized("API key required");
        AiCallApiKey key = repository
                .findByApiKeyAndStatus(presentedKey.trim(), AiCallApiKey.STATUS_ACTIVE)
                .orElseThrow(() -> unauthorized("Invalid API key"));
        if (!key.isActive())
            throw unauthorized("API key has been revoked");
        // Best-effort stamp (own tx — a failure here must not fail the call).
        try {
            repository.touchLastUsed(key.getId(), Instant.now());
        } catch (Exception e) {
            log.debug("api-key: last-used stamp failed for {}: {}", key.getId(), e.getMessage());
        }
        return key;
    }

    /**
     * ResponseStatusException (not VacademyException, which the global handler maps
     * to 510): a public API client needs an honest 401 it can branch on.
     */
    private static ResponseStatusException unauthorized(String msg) {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, msg);
    }

    private static String truncate(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n);
    }

    /** Plaintext + the stored row, returned together exactly once at issue. */
    public record IssuedKey(AiCallApiKey entity, String plaintext) {
    }
}
