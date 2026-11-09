package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.entity.OAuthConnectState;
import vacademy.io.admin_core_service.features.audience.repository.OAuthConnectStateRepository;
import vacademy.io.admin_core_service.features.audience.service.OAuthRedirectResolver;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.GoogleAdsApiClient;
import vacademy.io.admin_core_service.features.marketing.client.GoogleOAuthClient;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.client.MarketingHttp;
import vacademy.io.admin_core_service.features.marketing.client.MetaGraphClient;
import vacademy.io.admin_core_service.features.marketing.dto.OauthInitiateResponse;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.MarketingConnectionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.regex.Pattern;

/**
 * OAuth for marketing connections (Meta Ads, Meta Pages/Instagram, Google Ads, Google Business
 * Profile).
 *
 * <p>Flow: {@link #initiate} stores an oauth_connect_state row (vendor MKT_&lt;provider&gt;, 10 min)
 * whose id is both the OAuth {@code state} and the session key. The public callback exchanges the
 * code server-side, upserts marketing_connection (tokens encrypted, oauth_state_id = state), marks
 * the state AUTHORIZED for 30 minutes and 302s the browser to the dashboard with
 * {@code mkt_session} / {@code mkt_provider} (or {@code mkt_error}). The account picker then reads
 * the options through the session key. Tokens never reach the browser.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MarketingOAuthService {

    private static final Pattern ERROR_CODE = Pattern.compile("^[a-z0-9_]{1,40}$");

    private static final String META_ADS_SCOPES = "ads_read,business_management";
    private static final String META_SOCIAL_SCOPES = "pages_show_list,pages_read_engagement,pages_manage_posts,"
            + "instagram_basic,instagram_content_publish,business_management";
    private static final String GOOGLE_ADS_SCOPES = "https://www.googleapis.com/auth/adwords openid email";
    private static final String GOOGLE_BUSINESS_SCOPES = "https://www.googleapis.com/auth/business.manage openid email";

    private final OAuthConnectStateRepository stateRepository;
    private final OAuthRedirectResolver redirectResolver;
    private final MarketingConnectionRepository connectionRepository;
    private final MarketingConnectionService connectionService;
    private final GoogleOAuthTokenService googleOAuthTokenService;
    private final MetaGraphClient metaGraphClient;
    private final GoogleOAuthClient googleOAuthClient;
    private final GoogleAdsApiClient googleAdsApiClient;

    @Value("${marketing.meta.oauth.redirect-uri:}")
    private String metaRedirectUri;

    @Value("${marketing.meta.ads.config-id:}")
    private String metaAdsConfigId;

    @Value("${marketing.meta.social.config-id:}")
    private String metaSocialConfigId;

    @Value("${marketing.oauth.frontend-base-url:https://dash.vacademy.io}")
    private String frontendBaseUrl;

    /** A state that finished the callback, with the connection it produced. */
    public record AuthorizedSession(OAuthConnectState state, String provider, MarketingConnection connection) {
    }

    // ── Initiate ─────────────────────────────────────────────────────────────

    public OauthInitiateResponse initiate(String instituteId, String provider, String requestedOrigin, String userId) {
        if (provider == null || !MarketingConstants.PROVIDERS.contains(provider)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "provider must be one of META_ADS, META_SOCIAL, GOOGLE_ADS, GOOGLE_BUSINESS");
        }
        if (MarketingConstants.isMetaProvider(provider) && !metaGraphClient.isAppConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, "Meta app is not configured");
        }
        if (MarketingConstants.isGoogleProvider(provider) && !googleOAuthClient.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, "Google sign-in is not configured");
        }
        if (MarketingConstants.PROVIDER_GOOGLE_ADS.equals(provider) && !googleAdsApiClient.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, GoogleAdsApiClient.DEVELOPER_TOKEN_MISSING);
        }

        OAuthConnectState state = stateRepository.save(OAuthConnectState.builder()
                .instituteId(instituteId)
                .vendor(MarketingConstants.vendorFor(provider))
                .initiatedBy(userId)
                .frontendOrigin(redirectResolver.normalizeOrigin(requestedOrigin))
                .expiresAt(LocalDateTime.now().plusMinutes(10))
                .sessionStatus(MarketingConstants.SESSION_PENDING)
                .build());

        String oauthUrl = switch (provider) {
            case MarketingConstants.PROVIDER_META_ADS ->
                    metaGraphClient.buildAuthorizeUrl(state.getId(), metaRedirectUri, metaAdsConfigId, META_ADS_SCOPES);
            case MarketingConstants.PROVIDER_META_SOCIAL ->
                    metaGraphClient.buildAuthorizeUrl(state.getId(), metaRedirectUri, metaSocialConfigId, META_SOCIAL_SCOPES);
            case MarketingConstants.PROVIDER_GOOGLE_ADS ->
                    googleOAuthClient.buildAuthorizeUrl(state.getId(), GOOGLE_ADS_SCOPES);
            default -> googleOAuthClient.buildAuthorizeUrl(state.getId(), GOOGLE_BUSINESS_SCOPES);
        };
        log.info("Marketing OAuth initiated: institute={} provider={} state={}", instituteId, provider, state.getId());
        return OauthInitiateResponse.builder().oauthUrl(oauthUrl).sessionKey(state.getId()).build();
    }

    // ── Callbacks ────────────────────────────────────────────────────────────

    /** Handles the Meta redirect; returns the dashboard URL to 302 to. Never throws. */
    public String handleMetaCallback(String code, String stateId, String error) {
        return handleCallback("META_", code, stateId, error);
    }

    /** Handles the Google redirect; returns the dashboard URL to 302 to. Never throws. */
    public String handleGoogleCallback(String code, String stateId, String error) {
        return handleCallback("GOOGLE_", code, stateId, error);
    }

    private String handleCallback(String providerFamily, String code, String stateId, String error) {
        OAuthConnectState anyState = null;
        try {
            if (stateId != null && !stateId.isBlank()) {
                anyState = stateRepository.findById(stateId).orElse(null);
            }
        } catch (Exception e) {
            log.warn("Marketing OAuth callback could not load state: {}", e.getClass().getSimpleName());
        }
        String provider = anyState == null ? null : MarketingConstants.providerFromVendor(anyState.getVendor());
        String base = frontendBase(anyState);

        if (provider == null || !provider.startsWith(providerFamily)) {
            log.warn("Marketing OAuth {} callback with unknown or foreign state", providerFamily);
            return errorRedirect(base, provider, "invalid_state");
        }
        if (error != null && !error.isBlank()) {
            log.info("Marketing OAuth {} returned error={} for state={}", provider, error, stateId);
            markExpired(anyState);
            return errorRedirect(base, provider, sanitizeErrorCode(error));
        }
        OAuthConnectState state = stateRepository.findValidById(stateId, LocalDateTime.now())
                .filter(s -> MarketingConstants.SESSION_PENDING.equals(s.getSessionStatus()))
                .orElse(null);
        if (state == null) {
            return errorRedirect(base, provider, "invalid_state");
        }
        if (code == null || code.isBlank()) {
            markExpired(state);
            return errorRedirect(base, provider, "missing_code");
        }

        try {
            MarketingConnection connection = MarketingConstants.isMetaProvider(provider)
                    ? completeMeta(state, provider, code)
                    : completeGoogle(state, provider, code);
            state.setSessionStatus(MarketingConstants.SESSION_AUTHORIZED);
            state.setExpiresAt(LocalDateTime.now().plusMinutes(30));
            stateRepository.save(state);
            log.info("Marketing OAuth authorized: institute={} provider={} connection={}",
                    state.getInstituteId(), provider, connection.getId());
            return base + MarketingConstants.frontendPathFor(provider)
                    + "?mkt_session=" + MarketingHttp.enc(state.getId())
                    + "&mkt_provider=" + MarketingHttp.enc(provider);
        } catch (MarketingApiException e) {
            log.warn("Marketing OAuth {} callback failed for state={}: code={}", provider, stateId, e.getPlatformCode());
            markExpired(state);
            String errorCode = e.getPlatformCode() != null && ERROR_CODE.matcher(e.getPlatformCode()).matches()
                    ? e.getPlatformCode() : "connect_failed";
            return errorRedirect(base, provider, errorCode);
        } catch (Exception e) {
            log.error("Marketing OAuth {} callback crashed for state={}", provider, stateId, e);
            markExpired(state);
            return errorRedirect(base, provider, "server_error");
        }
    }

    private MarketingConnection completeMeta(OAuthConnectState state, String provider, String code) {
        String configId = MarketingConstants.PROVIDER_META_ADS.equals(provider) ? metaAdsConfigId : metaSocialConfigId;
        boolean configBased = configId != null && !configId.isBlank();
        MetaGraphClient.MetaUserToken token = metaGraphClient.exchangeCodeForUserToken(code, metaRedirectUri, configBased);
        JsonNode me = metaGraphClient.get("me?fields=id,name", token.accessToken());
        String userId = me.path("id").asText(null);
        if (userId == null || userId.isBlank()) {
            throw new MarketingApiException("userinfo_failed", "Could not read the Meta user", false, false);
        }
        return connectionService.upsertFromOAuth(state.getInstituteId(), provider,
                new MarketingConnectionService.OAuthGrant(userId, me.path("name").asText(null),
                        token.accessToken(), null, token.expiresAt(), token.scopes()),
                state.getId(), state.getInitiatedBy());
    }

    private MarketingConnection completeGoogle(OAuthConnectState state, String provider, String code) {
        JsonNode tokens = googleOAuthClient.exchangeCode(code);
        String refreshToken = tokens.path("refresh_token").asText(null);
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new MarketingApiException("no_refresh_token",
                    "Google did not return a refresh token", false, false);
        }
        String accessToken = tokens.path("access_token").asText();
        JsonNode userinfo = googleOAuthClient.userinfo(accessToken);
        String sub = userinfo.path("sub").asText(null);
        if (sub == null || sub.isBlank()) {
            throw new MarketingApiException("userinfo_failed", "Could not read the Google account", false, false);
        }
        String scopes = tokens.path("scope").asText(null);
        MarketingConnection connection = connectionService.upsertFromOAuth(state.getInstituteId(), provider,
                new MarketingConnectionService.OAuthGrant(sub, userinfo.path("email").asText(null),
                        null, refreshToken, null, scopes),
                state.getId(), state.getInitiatedBy());
        googleOAuthTokenService.evict(connection.getId());
        googleOAuthTokenService.prime(connection.getId(), accessToken);
        return connection;
    }

    // ── Session lookup for the account picker ────────────────────────────────

    /**
     * The AUTHORIZED, unexpired state of {@code instituteId} and the connection it produced, or a
     * 404 "Session not found or expired".
     */
    public AuthorizedSession requireAuthorizedSession(String sessionKey, String instituteId) {
        OAuthConnectState state = sessionKey == null ? null
                : stateRepository.findValidById(sessionKey, LocalDateTime.now()).orElse(null);
        String provider = state == null ? null : MarketingConstants.providerFromVendor(state.getVendor());
        if (state == null || provider == null
                || !instituteId.equals(state.getInstituteId())
                || !MarketingConstants.SESSION_AUTHORIZED.equals(state.getSessionStatus())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Session not found or expired. Please connect again.");
        }
        MarketingConnection connection = connectionRepository.findByOauthStateId(state.getId())
                .filter(c -> instituteId.equals(c.getInstituteId()))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Session not found or expired. Please connect again."));
        return new AuthorizedSession(state, provider, connection);
    }

    public void markConsumed(OAuthConnectState state) {
        state.setSessionStatus(MarketingConstants.SESSION_CONSUMED);
        stateRepository.save(state);
    }

    // ── Redirect helpers ─────────────────────────────────────────────────────

    /** Origin the flow started from when it is allowlisted for the institute, else the configured base. */
    private String frontendBase(OAuthConnectState state) {
        if (state != null) {
            String origin = redirectResolver.normalizeOrigin(state.getFrontendOrigin());
            if (origin != null && redirectResolver.isAllowedOrigin(state.getInstituteId(), origin)) {
                return origin;
            }
        }
        String base = frontendBaseUrl == null || frontendBaseUrl.isBlank() ? "https://dash.vacademy.io" : frontendBaseUrl.trim();
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    private String errorRedirect(String base, String provider, String errorCode) {
        String url = base + MarketingConstants.frontendPathFor(provider) + "?mkt_error=" + MarketingHttp.enc(errorCode);
        return provider == null ? url : url + "&mkt_provider=" + MarketingHttp.enc(provider);
    }

    private void markExpired(OAuthConnectState state) {
        if (state == null) return;
        try {
            state.setSessionStatus(MarketingConstants.SESSION_EXPIRED);
            stateRepository.save(state);
        } catch (Exception e) {
            log.warn("Could not expire marketing OAuth state {}: {}", state.getId(), e.getClass().getSimpleName());
        }
    }

    private static String sanitizeErrorCode(String error) {
        String lowered = error.trim().toLowerCase();
        return ERROR_CODE.matcher(lowered).matches() ? lowered : "access_denied";
    }
}
