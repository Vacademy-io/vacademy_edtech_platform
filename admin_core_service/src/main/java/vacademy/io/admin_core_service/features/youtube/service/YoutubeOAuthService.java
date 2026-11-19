package vacademy.io.admin_core_service.features.youtube.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.youtube.dto.YoutubeConnectionStatusDTO;
import vacademy.io.admin_core_service.features.youtube.entity.InstituteYoutubeCredentials;
import vacademy.io.admin_core_service.features.youtube.repository.InstituteYoutubeCredentialsRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.Map;

/**
 * Handles the per-institute YouTube OAuth flow:
 *
 *   1. {@link #buildAuthorizationUrl} — returns the Google consent URL the
 *      browser should navigate to.
 *   2. {@link #exchangeCodeAndStore} — called from the OAuth callback, swaps
 *      the auth code for a refresh token and stores it encrypted.
 *   3. {@link #getValidAccessToken} — called by the upload worker each time
 *      it needs an access token. Refreshes silently.
 *
 * One Google Cloud OAuth client (Vacademy's) services every institute. The
 * refresh token granted by each institute admin is tied to *their* channel,
 * so uploads land on the institute's channel, not Vacademy's.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class YoutubeOAuthService {

    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

    /** youtube.upload is the *sensitive* scope that drives the Google audit.
     *  youtube.readonly is added so we can call channels.list?mine=true to
     *  resolve the channel the admin just connected. */
    public static final String SCOPES =
            "https://www.googleapis.com/auth/youtube.upload "
                    + "https://www.googleapis.com/auth/youtube.readonly";

    private final InstituteYoutubeCredentialsRepository credentialsRepository;
    private final TokenEncryptionService tokenEncryptionService;
    private final RestTemplate restTemplate;

    @Value("${youtube.oauth.client-id:}")
    private String clientId;

    @Value("${youtube.oauth.client-secret:}")
    private String clientSecret;

    @Value("${youtube.oauth.redirect-uri:}")
    private String redirectUri;

    /** Short-lived store for the random state token issued at /initiate.
     *  Cleared on callback to make every state single-use (CSRF defence). */
    private Cache<String, StatePayload> stateCache;

    @PostConstruct
    void initCache() {
        this.stateCache = Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofMinutes(10))
                .maximumSize(10_000)
                .build();
    }

    public boolean isConfigured() {
        return clientId != null && !clientId.isBlank()
                && clientSecret != null && !clientSecret.isBlank()
                && redirectUri != null && !redirectUri.isBlank();
    }

    /**
     * Step 1 — generate the Google consent URL. Caller redirects the browser
     * here. We stash the (institute, user, frontendOrigin) tuple against a
     * random state token so the callback can recover context without trusting
     * the URL.
     *
     * frontendOrigin captures which white-labeled domain the admin came from
     * (admin.shikshanation.com, dash.vacademy.io, …) so we can redirect them
     * back to that same domain after Google's callback — not to the backend
     * host where the callback was served.
     */
    public String buildAuthorizationUrl(String instituteId, String userId, String frontendOrigin) {
        if (!isConfigured()) {
            throw new VacademyException(
                    "YouTube OAuth is not configured. Set youtube.oauth.client-id, client-secret, and redirect-uri.");
        }
        String state = randomState();
        stateCache.put(state, new StatePayload(instituteId, userId, frontendOrigin));

        return UriComponentsBuilder.fromHttpUrl(AUTH_URL)
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", redirectUri)
                .queryParam("response_type", "code")
                .queryParam("scope", SCOPES)
                // offline + prompt=consent forces Google to return a refresh
                // token even if the admin previously consented. Without these,
                // re-connects only get access tokens that expire in 1h.
                .queryParam("access_type", "offline")
                .queryParam("prompt", "consent")
                .queryParam("include_granted_scopes", "true")
                .queryParam("state", state)
                .build()
                .toUriString();
    }

    /**
     * Step 2 — handle the OAuth callback. Exchanges the code for tokens,
     * fetches the connected channel info, and stores the refresh token
     * encrypted. Returns the resolved institute_id + originating frontend
     * origin so the controller can redirect the browser back to whichever
     * white-labeled domain the admin started from.
     */
    public ExchangeResult exchangeCodeAndStore(String code, String state) {
        StatePayload payload = stateCache.getIfPresent(state);
        if (payload == null) {
            throw new VacademyException("Invalid or expired OAuth state. Restart the connect flow.");
        }
        stateCache.invalidate(state);

        Map<String, Object> tokenResponse = exchangeAuthorizationCode(code);
        String accessToken = (String) tokenResponse.get("access_token");
        String refreshToken = (String) tokenResponse.get("refresh_token");
        String grantedScopes = (String) tokenResponse.get("scope");

        if (refreshToken == null || refreshToken.isBlank()) {
            // Happens if the admin's Google account previously connected and
            // we lost the token — prompt=consent should prevent this, but
            // surface a clear error if Google still skips it.
            throw new VacademyException(
                    "Google did not return a refresh token. Disconnect the app from your Google account "
                            + "settings (https://myaccount.google.com/permissions) and try again.");
        }

        ChannelInfo channel = fetchChannelInfo(accessToken);

        InstituteYoutubeCredentials creds = credentialsRepository.findById(payload.instituteId)
                .orElseGet(() -> InstituteYoutubeCredentials.builder()
                        .instituteId(payload.instituteId)
                        .build());

        creds.setRefreshTokenEncrypted(tokenEncryptionService.encrypt(refreshToken));
        creds.setChannelId(channel.id);
        creds.setChannelTitle(channel.title);
        creds.setChannelThumbnailUrl(channel.thumbnailUrl);
        creds.setScopes(grantedScopes);
        creds.setConnectedByUserId(payload.userId);
        creds.setStatus("ACTIVE");
        creds.setLastValidatedAt(new Date());
        creds.setLastError(null);
        credentialsRepository.save(creds);

        log.info("[YouTube OAuth] Connected institute={} channel={} ({})",
                payload.instituteId, channel.title, channel.id);
        return new ExchangeResult(payload.instituteId, payload.frontendOrigin);
    }

    /**
     * Mint a fresh access token for the institute. Called by the upload worker
     * right before each upload. On invalid_grant (revoked refresh token) we
     * flip credentials to INVALID so the admin sees a "Reconnect" prompt.
     */
    public String getValidAccessToken(String instituteId) {
        InstituteYoutubeCredentials creds = credentialsRepository
                .findByInstituteIdAndStatus(instituteId, "ACTIVE")
                .orElseThrow(() -> new VacademyException(
                        "YouTube is not connected for institute " + instituteId));

        String refreshToken = tokenEncryptionService.decrypt(creds.getRefreshTokenEncrypted());

        try {
            Map<String, Object> response = refreshAccessToken(refreshToken);
            return (String) response.get("access_token");
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("invalid_grant")) {
                creds.setStatus("INVALID");
                creds.setLastError("Refresh token rejected by Google (invalid_grant). Admin must reconnect.");
                credentialsRepository.save(creds);
            }
            throw new VacademyException("Failed to refresh YouTube access token: " + msg);
        }
    }

    public YoutubeConnectionStatusDTO getStatus(String instituteId) {
        return credentialsRepository.findById(instituteId)
                .map(c -> YoutubeConnectionStatusDTO.builder()
                        .status(c.getStatus())
                        .channelId(c.getChannelId())
                        .channelTitle(c.getChannelTitle())
                        .channelThumbnailUrl(c.getChannelThumbnailUrl())
                        .connectedByUserId(c.getConnectedByUserId())
                        .connectedAt(c.getCreatedAt())
                        .lastValidatedAt(c.getLastValidatedAt())
                        .lastError(c.getLastError())
                        .build())
                .orElseGet(() -> YoutubeConnectionStatusDTO.builder()
                        .status("NOT_CONNECTED")
                        .build());
    }

    public void disconnect(String instituteId) {
        credentialsRepository.findById(instituteId).ifPresent(c -> {
            // Best-effort revoke on Google's side. Even if this fails we still
            // delete locally — admin wanted to disconnect.
            try {
                String refreshToken = tokenEncryptionService.decrypt(c.getRefreshTokenEncrypted());
                MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
                form.add("token", refreshToken);
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
                try {
                    restTemplate.exchange("https://oauth2.googleapis.com/revoke",
                            HttpMethod.POST,
                            new HttpEntity<>(form, headers),
                            String.class);
                } catch (RestClientException e) {
                    VendorCallLog.failed("https://oauth2.googleapis.com/revoke", "revoke token", form, e);
                    throw e;
                }
            } catch (Exception e) {
                log.warn("[YouTube OAuth] Revoke failed for institute={}: {}",
                        instituteId, e.getMessage());
            }
            credentialsRepository.delete(c);
        });
    }

    // -----------------------------------------------------------------------
    // HTTP helpers
    // -----------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private Map<String, Object> exchangeAuthorizationCode(String code) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("code", code);
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("redirect_uri", redirectUri);
        form.add("grant_type", "authorization_code");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        try {
            return restTemplate.exchange(TOKEN_URL, HttpMethod.POST,
                    new HttpEntity<>(form, headers), Map.class).getBody();
        } catch (RestClientException e) {
            VendorCallLog.failed(TOKEN_URL, "exchange authorization code", null, e);
            throw e;
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> refreshAccessToken(String refreshToken) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("refresh_token", refreshToken);
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("grant_type", "refresh_token");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        try {
            return restTemplate.exchange(TOKEN_URL, HttpMethod.POST,
                    new HttpEntity<>(form, headers), Map.class).getBody();
        } catch (RestClientException e) {
            VendorCallLog.failed(TOKEN_URL, "refresh access token", form, e);
            throw e;
        }
    }

    @SuppressWarnings("unchecked")
    private ChannelInfo fetchChannelInfo(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        String url = UriComponentsBuilder.fromHttpUrl(CHANNELS_URL)
                .queryParam("part", "snippet")
                .queryParam("mine", "true")
                .build()
                .toUriString();

        Map<String, Object> body;
        try {
            body = restTemplate.exchange(url, HttpMethod.GET,
                    new HttpEntity<>(headers), Map.class).getBody();
        } catch (RestClientException e) {
            VendorCallLog.failed(url, "fetch channel info", null, e);
            throw e;
        }

        if (body == null) return new ChannelInfo(null, null, null);
        java.util.List<Map<String, Object>> items = (java.util.List<Map<String, Object>>) body.get("items");
        if (items == null || items.isEmpty()) return new ChannelInfo(null, null, null);
        Map<String, Object> first = items.get(0);
        Map<String, Object> snippet = (Map<String, Object>) first.get("snippet");
        String id = (String) first.get("id");
        String title = snippet == null ? null : (String) snippet.get("title");
        String thumb = null;
        if (snippet != null) {
            Map<String, Object> thumbs = (Map<String, Object>) snippet.get("thumbnails");
            if (thumbs != null) {
                Map<String, Object> def = (Map<String, Object>) thumbs.get("default");
                if (def != null) thumb = (String) def.get("url");
            }
        }
        return new ChannelInfo(id, title, thumb);
    }

    private String randomState() {
        byte[] buf = new byte[32];
        new SecureRandom().nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    private record StatePayload(String instituteId, String userId, String frontendOrigin) {}
    private record ChannelInfo(String id, String title, String thumbnailUrl) {}
    public record ExchangeResult(String instituteId, String frontendOrigin) {}
}
