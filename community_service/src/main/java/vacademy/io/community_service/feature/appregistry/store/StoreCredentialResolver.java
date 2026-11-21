package vacademy.io.community_service.feature.appregistry.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Resolves the right store-API client for a given (institute, platform, provider), in priority
 * order:
 *
 * <ol>
 *   <li>An institute-specific {@code store_credential} row — an institute with its own developer
 *       account (Shiksha Nation has its own Apple Developer account, distinct from the team most
 *       other brands share) overrides the shared default here.</li>
 *   <li>The shared default row ({@code institute_id IS NULL}) in the same table.</li>
 *   <li>For App Store Connect only: the original env-var credential from {@code vacademy-secrets},
 *       kept as a last-resort fallback so nothing regresses if the table is ever empty. Google
 *       Play and Microsoft Partner Center never had an env-var credential to begin with — they
 *       only ever exist in {@code store_credential}, so there is no fallback tier for them.</li>
 * </ol>
 *
 * <p>Built clients are cached by credential id — signing a fresh token on every single request
 * would work, but there is no reason to pay for it when the credential hasn't changed. A row's id
 * never changes meaning (rotate a credential by creating a new row, matching how the app registry
 * itself treats ids), so the cache never needs eviction beyond a process restart.
 */
@Component
@Slf4j
public class StoreCredentialResolver {

    private static final String PROVIDER_APP_STORE_CONNECT = "APP_STORE_CONNECT";
    private static final String PROVIDER_GOOGLE_PLAY = "GOOGLE_PLAY";
    private static final String PROVIDER_PARTNER_CENTER = "PARTNER_CENTER";

    private final StoreCredentialRepository repository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ConcurrentHashMap<String, Object> cache = new ConcurrentHashMap<>();

    private final AppStoreConnectClient envDefaultAppStoreConnectClient;

    public StoreCredentialResolver(
            StoreCredentialRepository repository,
            @Value("${APP_STORE_CONNECT_ISSUER_ID:}") String envIssuerId,
            @Value("${APP_STORE_CONNECT_KEY_ID:}") String envKeyId,
            @Value("${APP_STORE_CONNECT_P8:}") String envP8) {
        this.repository = repository;
        this.envDefaultAppStoreConnectClient = AppStoreConnectClient.of(envIssuerId, envKeyId, envP8);
    }

    /**
     * @param platform IOS or MACOS — kept distinct (rather than one Apple-wide lookup) because the
     *                 schema allows an institute to register separate credentials per platform,
     *                 even though in practice one Apple Developer account almost always covers
     *                 both.
     * @return a client for this institute's App Store Connect credential, or null if none is
     *         configured at all (own row, shared row, and env fallback all absent).
     */
    public AppStoreConnectClient resolveAppStoreConnect(String instituteId, String platform) {
        AppStoreConnectClient fromTable = resolve(instituteId, platform, PROVIDER_APP_STORE_CONNECT,
                json -> AppStoreConnectClient.of(
                        json.path("issuerId").asText(null),
                        json.path("keyId").asText(null),
                        json.path("p8").asText(null)));
        if (fromTable != null) {
            return fromTable;
        }
        if (envDefaultAppStoreConnectClient == null) {
            log.info("[StoreCredentialResolver] No App Store Connect credential in store_credential "
                    + "and no env-var fallback configured for institute={} platform={}.", instituteId, platform);
        }
        return envDefaultAppStoreConnectClient;
    }

    /**
     * @return a Google Play client for this institute, or null if no {@code store_credential} row
     *         (institute-specific or shared) exists — there is no env-var fallback for this
     *         provider.
     */
    public GooglePlayClient resolveGooglePlay(String instituteId) {
        return resolve(instituteId, "ANDROID", PROVIDER_GOOGLE_PLAY,
                json -> GooglePlayClient.of(json.path("serviceAccountJson").asText(null)));
    }

    /**
     * @return a Microsoft Partner Center client for this institute, or null if no
     *         {@code store_credential} row exists — there is no env-var fallback for this
     *         provider.
     */
    public MicrosoftPartnerCenterClient resolvePartnerCenter(String instituteId) {
        return resolve(instituteId, "WINDOWS", PROVIDER_PARTNER_CENTER,
                json -> MicrosoftPartnerCenterClient.of(
                        json.path("tenantId").asText(null),
                        json.path("clientId").asText(null),
                        json.path("clientSecret").asText(null)));
    }

    /* ------------------------------------------------------------------ internals */

    private <T> T resolve(String instituteId, String platform, String provider, Function<JsonNode, T> build) {
        if (instituteId != null) {
            Optional<StoreCredential> specific = repository.findFirstByInstituteIdAndPlatformAndProvider(
                    instituteId, platform, provider);
            if (specific.isPresent()) {
                return buildAndCache(specific.get(), build);
            }
        }
        Optional<StoreCredential> shared = repository.findFirstByInstituteIdIsNullAndPlatformAndProvider(
                platform, provider);
        return shared.map(c -> buildAndCache(c, build)).orElse(null);
    }

    @SuppressWarnings("unchecked")
    private <T> T buildAndCache(StoreCredential credential, Function<JsonNode, T> build) {
        return (T) cache.computeIfAbsent(credential.getId(), id -> {
            try {
                JsonNode json = objectMapper.readTree(credential.getCredentialJson());
                T client = build.apply(json);
                if (client == null) {
                    log.warn("[StoreCredentialResolver] store_credential {} ({}) did not parse into a usable "
                            + "client — check its credential_json shape for provider={}.",
                            credential.getId(), credential.getLabel(), credential.getProvider());
                }
                return client;
            } catch (Exception e) {
                log.warn("[StoreCredentialResolver] Could not read credential_json for store_credential {}: {}",
                        credential.getId(), e.getMessage());
                return null;
            }
        });
    }
}
