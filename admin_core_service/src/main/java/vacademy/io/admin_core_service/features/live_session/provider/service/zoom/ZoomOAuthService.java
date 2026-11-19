package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * "Connect with Zoom" — authorization-code OAuth against the platform's General app
 * (Meeting SDK enabled). Builds the consent URL, exchanges the code for tokens to create an
 * {@code OAUTH}-type {@link ZoomAccount}, and rotates the refresh token when access tokens
 * expire.
 *
 * Meetings + ZAK for OAUTH accounts are created on the authorizing user ({@code userId=me});
 * for a user-managed app the connecting admin is the host. SDK signatures come from the
 * platform app ({@code zoom.sdk.*}) via {@link ZoomSdkSignatureService}'s fallback, so OAUTH
 * accounts carry no per-account SDK credentials.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZoomOAuthService {

    private final ZoomAccountStore store;
    private final TokenEncryptionService encryption;
    private final WebClient.Builder webClientBuilder;

    // The General app's own credentials — shared by OAuth (this service) and SDK signing
    // (ZoomSdkSignatureService falls back to the same zoom.app.* values).
    @Value("${zoom.app.client-id:}")
    private String clientId;

    @Value("${zoom.app.client-secret:}")
    private String clientSecret;

    @Value("${zoom.oauth.redirect.uri:}")
    private String redirectUri;

    /** Build the Zoom consent URL the admin's browser is sent to. {@code state} is our CSRF/session id. */
    public String buildAuthorizeUrl(String state) {
        if (clientId == null || clientId.isBlank()) {
            throw new VacademyException("Zoom OAuth is not configured (zoom.oauth.client-id missing)");
        }
        return ZoomEndpoints.OAUTH_AUTHORIZE_URL
                + "?response_type=code"
                + "&client_id=" + enc(clientId)
                + "&redirect_uri=" + enc(redirectUri)
                + "&state=" + enc(state);
    }

    /**
     * Exchange the authorization code for tokens, identify the Zoom user, and create/update an
     * OAUTH-type ZoomAccount for the institute. Returns the saved account.
     */
    public ZoomAccount completeConnection(String code, String instituteId) {
        JsonNode tokens = postToken(
                "grant_type=authorization_code"
                        + "&code=" + enc(code)
                        + "&redirect_uri=" + enc(redirectUri));
        if (tokens == null || !tokens.hasNonNull("access_token") || !tokens.hasNonNull("refresh_token")) {
            throw new VacademyException("Zoom token exchange failed");
        }
        String accessToken = tokens.get("access_token").asText();
        String refreshToken = tokens.get("refresh_token").asText();

        JsonNode me = getMe(accessToken);
        if (me == null || !me.hasNonNull("account_id")) {
            throw new VacademyException("Could not read the connected Zoom user profile");
        }
        String zoomAccountId = me.get("account_id").asText();
        String zoomUserId = me.hasNonNull("id") ? me.get("id").asText() : null;
        String email = me.hasNonNull("email") ? me.get("email").asText() : "Zoom user";

        ZoomAccount account = store.findByInstituteAndZoomAccountId(instituteId, zoomAccountId)
                .orElseGet(() -> ZoomAccount.builder()
                        .instituteId(instituteId)
                        .zoomAccountId(zoomAccountId)
                        .build());
        account.setLabel("Zoom: " + email);
        account.setAuthType("OAUTH");
        account.setZoomUserId(zoomUserId);
        account.setOauthRefreshTokenEnc(encryption.encrypt(refreshToken));
        account.setStatus("ACTIVE");

        ZoomAccount saved = (account.getId() == null) ? store.create(account) : store.update(account);
        log.info("zoom.oauth.connected instituteId={} zoomAccountId={} userId={}",
                instituteId, zoomAccountId, zoomUserId);
        return saved;
    }

    /**
     * Mint a fresh access token from the stored refresh token, persisting the rotated refresh
     * token. Called by {@link ZoomAccessTokenService} on cache-miss for OAUTH accounts.
     */
    public String refreshAndGet(ZoomAccount account) {
        if (account.getOauthRefreshTokenEnc() == null) {
            throw new VacademyException("Zoom account '" + account.getLabel() + "' is not connected via OAuth");
        }
        String refreshToken = encryption.decrypt(account.getOauthRefreshTokenEnc());
        JsonNode tokens = postToken("grant_type=refresh_token&refresh_token=" + enc(refreshToken));
        if (tokens == null || !tokens.hasNonNull("access_token")) {
            throw new VacademyException("Zoom refresh failed for account '" + account.getLabel()
                    + "' — reconnect may be required");
        }
        // Zoom rotates the refresh token on every refresh — persist the latest or the next
        // refresh fails.
        if (tokens.hasNonNull("refresh_token")) {
            account.setOauthRefreshTokenEnc(encryption.encrypt(tokens.get("refresh_token").asText()));
            store.update(account);
        }
        return tokens.get("access_token").asText();
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    /**
     * Send the grant params as the form BODY (standard OAuth token request). Do NOT put them in
     * the URI query string — WebClient's .uri(String) re-encodes it, double-encoding the
     * already-encoded redirect_uri (https%3A%2F%2F → https%253A%252F%252F) and Zoom 400s.
     */
    private JsonNode postToken(String formBody) {
        String basic = Base64.getEncoder().encodeToString(
                (clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
        try {
            return webClientBuilder.build()
                    .post()
                    .uri(ZoomEndpoints.OAUTH_TOKEN_URL)
                    .header("Authorization", "Basic " + basic)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .bodyValue(formBody)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .doOnError(e -> VendorCallLog.failed(ZoomEndpoints.OAUTH_TOKEN_URL, "token request", null, e))
                    .block();
        } catch (Exception e) {
            throw new VacademyException("Zoom OAuth token request failed: " + e.getMessage());
        }
    }

    private JsonNode getMe(String accessToken) {
        try {
            return webClientBuilder.build()
                    .get()
                    .uri(ZoomEndpoints.API_BASE_URL + "/users/me")
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .doOnError(e -> VendorCallLog.failed(ZoomEndpoints.API_BASE_URL, "fetch users/me", null, e))
                    .block();
        } catch (WebClientResponseException e) {
            // Surface Zoom's body so the actual cause shows up — e.g. a 400 with
            // {"code":4711,"message":"...does not contain scopes:[user:read]"} means the app
            // is missing the user:read scope (re-consent after granting it).
            String body = e.getResponseBodyAsString();
            log.warn("zoom.oauth.me.fail status={} body={}", e.getStatusCode().value(), body);
            throw new VacademyException("Could not read the connected Zoom user profile — /users/me "
                    + e.getStatusCode().value() + ": " + body);
        } catch (Exception e) {
            log.warn("zoom.oauth.me.fail reason={}", e.getMessage());
            throw new VacademyException("Could not read the connected Zoom user profile: " + e.getMessage());
        }
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }
}
