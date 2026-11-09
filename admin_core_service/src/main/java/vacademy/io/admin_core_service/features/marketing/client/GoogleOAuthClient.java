package vacademy.io.admin_core_service.features.marketing.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.net.URI;

/**
 * Google OAuth 2.0 endpoints for the marketing connections (Google Ads and Business Profile).
 * Uses the {@code marketing.google.oauth.*} client, which defaults to the Workspace client
 * ({@code google.oauth.client-id/secret}). Tokens are never logged.
 */
@Component
@RequiredArgsConstructor
public class GoogleOAuthClient {

    private static final String AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${marketing.google.oauth.client-id:}")
    private String clientId;

    @Value("${marketing.google.oauth.client-secret:}")
    private String clientSecret;

    @Value("${marketing.google.oauth.redirect-uri:}")
    private String redirectUri;

    private WebClient webClient;

    @PostConstruct
    void init() {
        this.webClient = MarketingHttp.build(webClientBuilder);
    }

    public boolean isConfigured() {
        return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
    }

    /** Consent URL: offline access + forced consent so Google always returns a refresh token. */
    public String buildAuthorizeUrl(String state, String scopes) {
        return AUTHORIZE_URL
                + "?client_id=" + MarketingHttp.enc(clientId)
                + "&redirect_uri=" + MarketingHttp.enc(redirectUri)
                + "&response_type=code"
                + "&access_type=offline"
                + "&prompt=consent"
                + "&include_granted_scopes=true"
                + "&state=" + MarketingHttp.enc(state)
                + "&scope=" + MarketingHttp.enc(scopes);
    }

    /**
     * Exchanges an authorization code. Returns the token JSON (access_token, refresh_token,
     * expires_in, scope). Throws when Google answers with an error or without an access token.
     */
    public JsonNode exchangeCode(String code) {
        JsonNode tokens = postToken("grant_type=authorization_code"
                + "&code=" + MarketingHttp.enc(code)
                + "&client_id=" + MarketingHttp.enc(clientId)
                + "&client_secret=" + MarketingHttp.enc(clientSecret)
                + "&redirect_uri=" + MarketingHttp.enc(redirectUri));
        if (tokens == null || !tokens.hasNonNull("access_token")) {
            throw new MarketingApiException("token_exchange_failed",
                    "Google token exchange failed: " + describeError(tokens), false, false);
        }
        return tokens;
    }

    /**
     * Refresh-token grant. Returns Google's JSON whatever the HTTP status, so the caller can tell
     * {@code {"error":"invalid_grant"}} apart from a transient failure. Never null.
     */
    public JsonNode refresh(String refreshToken) {
        JsonNode tokens = postToken("grant_type=refresh_token"
                + "&refresh_token=" + MarketingHttp.enc(refreshToken)
                + "&client_id=" + MarketingHttp.enc(clientId)
                + "&client_secret=" + MarketingHttp.enc(clientSecret));
        return tokens == null ? objectMapper.createObjectNode() : tokens;
    }

    /** OpenID userinfo of the token owner (sub, email). */
    public JsonNode userinfo(String accessToken) {
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.get().uri(URI.create(USERINFO_URL))
                        .headers(h -> h.setBearerAuth(accessToken)),
                objectMapper, GoogleApiClient.PLATFORM_LABEL);
        if (!result.ok() || result.json() == null) {
            throw new MarketingApiException("userinfo_failed",
                    "Could not read the connected Google account (HTTP " + result.status() + ")",
                    result.status() >= 500, false);
        }
        return result.json();
    }

    public static String describeError(JsonNode tokens) {
        if (tokens == null) return "no response";
        String error = tokens.hasNonNull("error") ? tokens.get("error").asText() : "unknown";
        String desc = tokens.hasNonNull("error_description") ? tokens.get("error_description").asText() : "";
        return desc.isBlank() ? error : error + " - " + desc;
    }

    /** Form POST to the token endpoint; returns the JSON body regardless of HTTP status. */
    private JsonNode postToken(String formBody) {
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.post().uri(URI.create(TOKEN_URL))
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .bodyValue(formBody),
                objectMapper, GoogleApiClient.PLATFORM_LABEL);
        if (result.json() == null && result.status() >= 500) {
            throw new MarketingApiException("HTTP_" + result.status(),
                    "Google sign-in is unavailable (HTTP " + result.status() + "). Please try again shortly.",
                    true, false);
        }
        return result.json();
    }
}
