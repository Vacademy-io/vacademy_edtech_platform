package vacademy.io.auth_service.feature.institute_oauth.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.institute_oauth.entity.InstituteOAuthClient;
import vacademy.io.auth_service.feature.institute_oauth.repository.InstituteOAuthClientRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.util.Date;
import java.util.Optional;
import java.util.Set;

/**
 * Which OAuth client an institute's logins start with.
 *
 * <p>{@link #findActiveClient} sits on the login path (once when the login starts, once on the
 * callback), so it is cached — misses included, because almost every institute has no row — and it
 * is fail-open: any lookup or decrypt failure answers "no client", which keeps the platform client
 * exactly as before. Edits evict the local entry; other pods pick them up within {@link #CACHE_TTL}.
 */
@Service
public class InstituteOAuthClientService {

    private static final Logger log = LoggerFactory.getLogger(InstituteOAuthClientService.class);

    public static final String PROVIDER_GOOGLE = "google";
    private static final Set<String> SUPPORTED_PROVIDERS = Set.of(PROVIDER_GOOGLE);
    private static final String GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
    static final Duration CACHE_TTL = Duration.ofMinutes(5);

    public record ActiveClient(String clientId, String clientSecret) {
        @Override
        public String toString() {
            return "ActiveClient[clientId=" + clientId + "]";
        }
    }

    private final InstituteOAuthClientRepository repository;
    private final OAuthClientSecretCipher cipher;
    private final Cache<String, Optional<ActiveClient>> cache = Caffeine.newBuilder()
            .expireAfterWrite(CACHE_TTL)
            .maximumSize(10_000)
            .build();

    public InstituteOAuthClientService(InstituteOAuthClientRepository repository, OAuthClientSecretCipher cipher) {
        this.repository = repository;
        this.cipher = cipher;
    }

    public static boolean isSupportedProvider(String provider) {
        return provider != null && SUPPORTED_PROVIDERS.contains(provider);
    }

    public Optional<ActiveClient> findActiveClient(String instituteId, String provider) {
        if (instituteId == null || instituteId.isBlank() || !isSupportedProvider(provider) || !cipher.isConfigured()) {
            return Optional.empty();
        }
        String key = cacheKey(instituteId, provider);
        Optional<ActiveClient> cached = cache.getIfPresent(key);
        if (cached != null) {
            return cached;
        }
        Optional<ActiveClient> loaded;
        try {
            loaded = repository.findByInstituteIdAndProvider(instituteId, provider)
                    .filter(InstituteOAuthClient::isEnabled)
                    .flatMap(row -> {
                        String secret = cipher.decryptOrNull(row.getClientSecretEncrypted());
                        if (secret == null) {
                            log.error("Institute {} has a {} OAuth client whose secret does not decrypt; "
                                    + "using the platform client.", instituteId, provider);
                            return Optional.empty();
                        }
                        return Optional.of(new ActiveClient(row.getClientId(), secret));
                    });
        } catch (Exception e) {
            // Not cached: a DB blip should not pin the institute to the platform client for minutes.
            log.warn("Institute OAuth client lookup failed for institute {} ({}); using the platform client.",
                    instituteId, e.getMessage());
            return Optional.empty();
        }
        cache.put(key, loaded);
        return loaded;
    }

    public Optional<InstituteOAuthClient> find(String instituteId, String provider) {
        requireSupportedProvider(provider);
        return repository.findByInstituteIdAndProvider(instituteId, provider);
    }

    /**
     * Creates or updates an institute's client. {@code clientSecret} may be omitted on update to
     * keep the stored one (e.g. to only toggle {@code enabled}); it is required on create.
     */
    @Transactional
    public InstituteOAuthClient save(String instituteId, String provider, String clientId, String clientSecret,
                                     Boolean enabled, String actorUserId) {
        requireSupportedProvider(provider);
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required");
        }
        if (!cipher.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "OAUTH_TOKEN_ENCRYPTION_KEY is not configured on auth-service; cannot store OAuth client secrets");
        }
        String trimmedClientId = clientId == null ? null : clientId.trim();
        if (trimmedClientId == null || trimmedClientId.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "client_id is required");
        }
        if (PROVIDER_GOOGLE.equals(provider) && !trimmedClientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "A Google client_id ends with " + GOOGLE_CLIENT_ID_SUFFIX);
        }
        String trimmedSecret = clientSecret == null ? null : clientSecret.trim();

        InstituteOAuthClient row = repository.findByInstituteIdAndProvider(instituteId, provider).orElse(null);
        if (row == null) {
            if (trimmedSecret == null || trimmedSecret.isEmpty()) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "client_secret is required");
            }
            row = InstituteOAuthClient.builder()
                    .instituteId(instituteId)
                    .provider(provider)
                    .build();
        }
        row.setClientId(trimmedClientId);
        if (trimmedSecret != null && !trimmedSecret.isEmpty()) {
            row.setClientSecretEncrypted(cipher.encrypt(trimmedSecret));
        }
        row.setEnabled(enabled == null || enabled);
        row.setUpdatedBy(actorUserId);
        row.setUpdatedAt(new Date());
        InstituteOAuthClient saved = repository.save(row);
        cache.invalidate(cacheKey(instituteId, provider));
        log.info("Institute {} {} OAuth client saved by {} (clientId={}, enabled={})",
                instituteId, provider, actorUserId, trimmedClientId, saved.isEnabled());
        return saved;
    }

    @Transactional
    public boolean delete(String instituteId, String provider, String actorUserId) {
        requireSupportedProvider(provider);
        Optional<InstituteOAuthClient> row = repository.findByInstituteIdAndProvider(instituteId, provider);
        row.ifPresent(repository::delete);
        cache.invalidate(cacheKey(instituteId, provider));
        row.ifPresent(r -> log.info("Institute {} {} OAuth client deleted by {} (clientId={})",
                instituteId, provider, actorUserId, r.getClientId()));
        return row.isPresent();
    }

    private static void requireSupportedProvider(String provider) {
        if (!isSupportedProvider(provider)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Unsupported OAuth provider '" + provider + "'; supported: " + SUPPORTED_PROVIDERS);
        }
    }

    private static String cacheKey(String instituteId, String provider) {
        return provider + ":" + instituteId;
    }
}
