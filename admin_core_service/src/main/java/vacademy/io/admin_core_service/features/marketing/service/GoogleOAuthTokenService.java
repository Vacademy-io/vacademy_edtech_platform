package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.GoogleOAuthClient;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;

import java.time.Duration;
import java.util.Set;

/**
 * Mints Google access tokens for marketing connections (Google Ads, Business Profile) from the
 * stored refresh token, cached 50 minutes per connection id (Google tokens live 60).
 * On {@code invalid_grant} the connection becomes RECONNECT_NEEDED and an auth error is thrown.
 * Tokens are never logged.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleOAuthTokenService {

    /** OAuth errors that a retry will not fix (bad client config) but that are not the grant's fault. */
    private static final Set<String> PERMANENT_CLIENT_ERRORS = Set.of("invalid_client", "unauthorized_client",
            "invalid_request", "unsupported_grant_type");

    private final GoogleOAuthClient googleOAuthClient;
    private final MarketingConnectionService connectionService;

    private final Cache<String, String> tokenCache = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(50))
            .maximumSize(2000)
            .build();

    public String getAccessToken(MarketingConnection connection) {
        if (connection == null) {
            throw new MarketingApiException("NO_CONNECTION", "Google is not connected. Connect Google again.", false, true);
        }
        String cached = tokenCache.getIfPresent(connection.getId());
        if (cached != null) return cached;

        if (!MarketingConstants.STATUS_ACTIVE.equals(connection.getStatus())) {
            throw new MarketingApiException(connection.getStatus(),
                    "Google access needs to be renewed. Reconnect Google.", false, true);
        }
        String refreshToken = connectionService.googleRefreshToken(connection);
        if (refreshToken == null) {
            throw new MarketingApiException("NO_TOKEN", "Google access is missing. Reconnect Google.", false, true);
        }

        JsonNode response = googleOAuthClient.refresh(refreshToken);
        String accessToken = response.path("access_token").asText(null);
        if (accessToken != null && !accessToken.isBlank()) {
            tokenCache.put(connection.getId(), accessToken);
            return accessToken;
        }

        String error = response.path("error").asText("unknown");
        String description = GoogleOAuthClient.describeError(response);
        if ("invalid_grant".equals(error)) {
            String detail = "Google access was revoked or has expired. Reconnect Google.";
            connectionService.markReconnect(connection.getId(), detail);
            connection.setStatus(MarketingConstants.STATUS_RECONNECT_NEEDED);
            connection.setStatusDetail(detail);
            throw new MarketingApiException("invalid_grant", detail, false, true);
        }
        log.warn("Google token refresh failed for marketing connection {}: {}", connection.getId(), error);
        boolean transientError = !PERMANENT_CLIENT_ERRORS.contains(error);
        throw new MarketingApiException(error, "Google token refresh failed: " + description, transientError, false);
    }

    /** Seeds the cache with the access token returned by the code exchange (saves one refresh). */
    public void prime(String connectionId, String accessToken) {
        if (connectionId != null && accessToken != null && !accessToken.isBlank()) {
            tokenCache.put(connectionId, accessToken);
        }
    }

    /** Drops the cached token (after a 401 from a Google API). */
    public void evict(String connectionId) {
        if (connectionId != null) tokenCache.invalidate(connectionId);
    }
}
