package vacademy.io.admin_core_service.features.marketing.client;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.service.GoogleOAuthTokenService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Ads API (REST) client: listAccessibleCustomers and GAQL searchStream.
 *
 * <p>Every call sends the {@code developer-token} header ({@code marketing.google.ads.developer-token});
 * {@code login-customer-id} is sent only when a manager id is given. Errors are parsed from
 * {@code error.details[].errors[].errorCode} into {@link MarketingApiException} (see
 * {@link GoogleApiClient#toException}). A missing developer token answers 503
 * "Google Ads developer token is not configured".
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class GoogleAdsApiClient {

    public static final String DEVELOPER_TOKEN_MISSING = "Google Ads developer token is not configured";

    private final GoogleApiClient googleApiClient;
    private final GoogleOAuthTokenService googleOAuthTokenService;

    @Value("${marketing.google.ads.developer-token:}")
    private String developerToken;

    @Value("${marketing.google.ads.api-version:v26}")
    private String apiVersion;

    public boolean isConfigured() {
        return developerToken != null && !developerToken.isBlank();
    }

    public String apiBase() {
        return "https://googleads.googleapis.com/" + apiVersion;
    }

    /** Customer ids (digits) the token owner can reach directly. */
    public List<String> listAccessibleCustomers(String accessToken) {
        requireConfigured();
        JsonNode response = googleApiClient.get(apiBase() + "/customers:listAccessibleCustomers",
                accessToken, headers(null));
        List<String> ids = new ArrayList<>();
        for (JsonNode resourceName : response.path("resourceNames")) {
            String id = digits(resourceName.asText("").replace("customers/", ""));
            if (!id.isEmpty() && !ids.contains(id)) ids.add(id);
        }
        return ids;
    }

    /**
     * Runs a GAQL query through {@code googleAds:searchStream} and returns every row of every
     * streamed batch (the concatenated {@code results} arrays).
     */
    public List<JsonNode> search(String customerId, String loginCustomerId, String query, String accessToken) {
        requireConfigured();
        String url = apiBase() + "/customers/" + digits(customerId) + "/googleAds:searchStream";
        JsonNode response = googleApiClient.postJson(url, Map.of("query", query), accessToken,
                headers(loginCustomerId));
        List<JsonNode> rows = new ArrayList<>();
        if (response.isArray()) {
            for (JsonNode batch : response) {
                if (batch.has("error")) {
                    throw GoogleApiClient.toException(batch.path("error"), 200);
                }
                for (JsonNode row : batch.path("results")) rows.add(row);
            }
        } else {
            for (JsonNode row : response.path("results")) rows.add(row);
        }
        return rows;
    }

    /**
     * Same as {@link #search(String, String, String, String)} but mints the access token from the
     * connection. On an authentication error the cached token is evicted and the call is retried
     * once with a fresh token; a second failure propagates (the grant really is unusable).
     */
    public List<JsonNode> search(String customerId, String loginCustomerId, String query,
                                 MarketingConnection connection) {
        String token = googleOAuthTokenService.getAccessToken(connection);
        try {
            return search(customerId, loginCustomerId, query, token);
        } catch (MarketingApiException e) {
            if (!e.isAuthError() || "USER_PERMISSION_DENIED".equals(e.getPlatformCode())) throw e;
            log.info("Google Ads auth error {} for connection {}; retrying with a fresh token",
                    e.getPlatformCode(), connection.getId());
            googleOAuthTokenService.evict(connection.getId());
            return search(customerId, loginCustomerId, query, googleOAuthTokenService.getAccessToken(connection));
        }
    }

    /** Strips dashes and anything else that is not a digit ("123-456-7890" to "1234567890"). */
    public static String digits(String id) {
        return id == null ? "" : id.replaceAll("[^0-9]", "");
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, DEVELOPER_TOKEN_MISSING);
        }
    }

    private Map<String, String> headers(String loginCustomerId) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("developer-token", developerToken);
        String login = digits(loginCustomerId);
        if (!login.isEmpty()) headers.put("login-customer-id", login);
        return headers;
    }
}
