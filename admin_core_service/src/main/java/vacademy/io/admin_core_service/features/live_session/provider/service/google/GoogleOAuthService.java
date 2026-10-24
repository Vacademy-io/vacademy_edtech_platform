package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * "Connect Google Workspace" — per-tenant authorization-code OAuth against the one
 * shared Google Cloud app. Builds the consent URL, exchanges the code for tokens to
 * create/refresh a {@link GoogleAccount}, and mints fresh access tokens from the stored
 * refresh token.
 *
 * Unlike Zoom (which rotates the refresh token on every refresh), Google refresh tokens are
 * long-lived and are NOT re-issued on refresh — so we persist the refresh token once at
 * connect time and only flip the account to RECONNECT_NEEDED when Google answers
 * {@code invalid_grant} (admin revoked access, account removed, or token expired).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleOAuthService {

    private static final String STATUS_RECONNECT = "RECONNECT_NEEDED";

    private final GoogleAccountStore store;
    private final TokenEncryptionService encryption;
    private final WebClient.Builder webClientBuilder;

    @Value("${google.oauth.client-id:}")
    private String clientId;

    @Value("${google.oauth.client-secret:}")
    private String clientSecret;

    @Value("${google.oauth.redirect.uri:}")
    private String redirectUri;

    @Value("${google.oauth.scopes:openid email https://www.googleapis.com/auth/meetings.space.created https://www.googleapis.com/auth/meetings.space.readonly}")
    private String scopes;

    /**
     * Read access to Drive files Google Meet created — lets the server download a Meet recording
     * into the library. Google classes it as RESTRICTED (unverified apps get a warning screen and a
     * 100-user cap unless a Workspace admin marks Vacademy as Trusted), so it is opt-in per connect
     * rather than part of {@link #scopes}: the regular connect flow stays unaffected.
     */
    public static final String DRIVE_MEET_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.meet.readonly";

    /** Build the Google consent URL the admin's browser is sent to. {@code state} is our CSRF/session id. */
    public String buildAuthorizeUrl(String state) {
        return buildAuthorizeUrl(state, false);
    }

    /**
     * @param driveAccess also request {@link #DRIVE_MEET_READONLY_SCOPE}. With
     *                    include_granted_scopes=true the grant is incremental, so a later plain
     *                    reconnect keeps it.
     */
    public String buildAuthorizeUrl(String state, boolean driveAccess) {
        if (clientId == null || clientId.isBlank()) {
            throw new VacademyException("Google OAuth is not configured (google.oauth.client-id missing)");
        }
        // access_type=offline + prompt=consent guarantees a refresh_token is returned every
        // time (Google omits it on repeat consents otherwise).
        return GoogleMeetEndpoints.OAUTH_AUTHORIZE_URL
                + "?response_type=code"
                + "&client_id=" + enc(clientId)
                + "&redirect_uri=" + enc(redirectUri)
                + "&scope=" + enc(driveAccess ? scopes + " " + DRIVE_MEET_READONLY_SCOPE : scopes)
                + "&access_type=offline"
                + "&include_granted_scopes=true"
                + "&prompt=consent"
                + "&state=" + enc(state);
    }

    /**
     * Exchange the authorization code for tokens, identify the Google user, and create/update
     * the institute's connected GoogleAccount. Returns the saved account.
     */
    public GoogleAccount completeConnection(String code, String instituteId) {
        JsonNode tokens = postToken(
                "grant_type=authorization_code"
                        + "&code=" + enc(code)
                        + "&client_id=" + enc(clientId)
                        + "&client_secret=" + enc(clientSecret)
                        + "&redirect_uri=" + enc(redirectUri));
        if (tokens == null || !tokens.hasNonNull("access_token")) {
            throw new VacademyException("Google token exchange failed: " + describeError(tokens));
        }
        String accessToken = tokens.get("access_token").asText();
        String refreshToken = tokens.hasNonNull("refresh_token") ? tokens.get("refresh_token").asText() : null;
        String grantedScopes = tokens.hasNonNull("scope") ? tokens.get("scope").asText() : scopes;

        JsonNode me = getUserinfo(accessToken);
        if (me == null || !me.hasNonNull("email")) {
            throw new VacademyException("Could not read the connected Google account email "
                    + "(grant the openid/email scope)");
        }
        String email = me.get("email").asText();

        GoogleAccount account = store.findByInstituteAndEmail(instituteId, email)
                .orElseGet(() -> GoogleAccount.builder()
                        .instituteId(instituteId)
                        .organizerEmail(email)
                        .build());
        account.setLabel("Google: " + email);
        account.setOrganizerEmail(email);
        account.setGrantedScopes(grantedScopes);
        account.setStatus("ACTIVE");
        if (refreshToken != null) {
            account.setOauthRefreshTokenEnc(encryption.encrypt(refreshToken));
        } else if (account.getOauthRefreshTokenEnc() == null) {
            // No refresh token returned and none stored — the prior grant must be revoked
            // at myaccount.google.com → Security → Third-party access, then reconnect.
            throw new VacademyException("Google did not return a refresh token. Revoke Vacademy's "
                    + "access at myaccount.google.com (Third-party access) and reconnect.");
        }

        GoogleAccount saved = (account.getId() == null) ? store.create(account) : store.update(account);
        log.info("google.oauth.connected instituteId={} email={}", instituteId, email);
        return saved;
    }

    /**
     * Mint a fresh access token from the stored refresh token. Called by
     * {@link GoogleAccessTokenService} on cache-miss. On {@code invalid_grant} the account is
     * flipped to RECONNECT_NEEDED so the UI can surface a "Reconnect" banner.
     */
    public String refreshAndGet(GoogleAccount account) {
        if (account.getOauthRefreshTokenEnc() == null) {
            throw new VacademyException("Google account '" + account.getLabel() + "' is not connected");
        }
        String refreshToken = encryption.decrypt(account.getOauthRefreshTokenEnc());
        JsonNode tokens = postToken(
                "grant_type=refresh_token"
                        + "&refresh_token=" + enc(refreshToken)
                        + "&client_id=" + enc(clientId)
                        + "&client_secret=" + enc(clientSecret));
        if (tokens != null && tokens.hasNonNull("access_token")) {
            return tokens.get("access_token").asText();
        }
        String error = tokens != null && tokens.hasNonNull("error") ? tokens.get("error").asText() : "unknown";
        if ("invalid_grant".equals(error)) {
            account.setStatus(STATUS_RECONNECT);
            store.update(account);
        }
        log.warn("google.oauth.refresh.fail accountId={} error={}", account.getId(), error);
        throw new VacademyException("Google token refresh failed for '" + account.getLabel()
                + "' (" + error + ") — reconnect may be required");
    }

    /** Best-effort revoke of the stored refresh token at Google (on disconnect). */
    public void revoke(GoogleAccount account) {
        if (account.getOauthRefreshTokenEnc() == null) return;
        try {
            String refreshToken = encryption.decrypt(account.getOauthRefreshTokenEnc());
            webClientBuilder.build().post()
                    .uri(GoogleMeetEndpoints.OAUTH_REVOKE_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .bodyValue("token=" + enc(refreshToken))
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(java.time.Duration.ofSeconds(15))
                    .block();
        } catch (Exception e) {
            log.warn("google.oauth.revoke.fail accountId={} reason={}", account.getId(),
                    e.getClass().getSimpleName());
        }
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    /**
     * POST the grant params as the form BODY. {@code exchangeToMono} captures the JSON body
     * regardless of HTTP status, so callers can read Google's {@code {"error":"invalid_grant"}}
     * on a 400 instead of losing it to an exception.
     */
    private JsonNode postToken(String formBody) {
        try {
            return webClientBuilder.build()
                    .post()
                    .uri(GoogleMeetEndpoints.OAUTH_TOKEN_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .bodyValue(formBody)
                    .exchangeToMono(resp -> resp.bodyToMono(JsonNode.class))
                    .timeout(java.time.Duration.ofSeconds(15))
                    .block();
        } catch (Exception e) {
            throw new VacademyException("Google OAuth token request failed: " + e.getMessage());
        }
    }

    private JsonNode getUserinfo(String accessToken) {
        try {
            return webClientBuilder.build()
                    .get()
                    .uri(GoogleMeetEndpoints.USERINFO_URL)
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(java.time.Duration.ofSeconds(15))
                    .block();
        } catch (WebClientResponseException e) {
            log.warn("google.oauth.userinfo.fail status={} body={}", e.getStatusCode().value(),
                    e.getResponseBodyAsString());
            throw new VacademyException("Could not read the connected Google account — userinfo "
                    + e.getStatusCode().value());
        } catch (Exception e) {
            throw new VacademyException("Could not read the connected Google account: " + e.getMessage());
        }
    }

    private static String describeError(JsonNode tokens) {
        if (tokens == null) return "no response";
        String error = tokens.hasNonNull("error") ? tokens.get("error").asText() : "unknown";
        String desc = tokens.hasNonNull("error_description") ? tokens.get("error_description").asText() : "";
        return desc.isBlank() ? error : (error + " — " + desc);
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }
}
