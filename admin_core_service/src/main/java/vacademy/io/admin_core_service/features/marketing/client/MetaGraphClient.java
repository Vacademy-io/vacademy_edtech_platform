package vacademy.io.admin_core_service.features.marketing.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Meta Graph API client for the marketing feature (ads insights, Pages, Instagram publishing).
 *
 * <p>URLs: {@code pathAndQuery} is relative to {@code https://graph.facebook.com/{graph-version}/}
 * and must already be URL-encoded (use {@link #enc} for values such as {@code fields=} lists with
 * braces or JSON {@code time_range}); it is sent through {@code URI.create} so WebClient does not
 * encode it a second time. The access token is appended by this client and never logged.
 *
 * <p>Errors: any Graph error (or HTTP status at or above 400) throws {@link MarketingApiException}.
 * Codes 190/102 and subcodes 463/467 are auth errors (reconnect); codes 1, 2, 4, 17, 32, 341, 613,
 * 80000-80014, {@code is_transient=true} and HTTP 5xx/429 are transient.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MetaGraphClient {

    public static final String PLATFORM_LABEL = "Meta";
    private static final String GRAPH_HOST = "https://graph.facebook.com/";
    private static final String DIALOG_HOST = "https://www.facebook.com/";
    private static final long DEFAULT_LONG_LIVED_SECONDS = 60L * 24 * 3600;
    private static final Set<Integer> TRANSIENT_CODES = Set.of(1, 2, 4, 17, 32, 341, 613);

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${marketing.meta.graph-version:v23.0}")
    private String graphVersion;

    @Value("${meta.app.id:}")
    private String appId;

    @Value("${meta.app.secret:}")
    private String appSecret;

    private WebClient webClient;

    /** A Meta user token after the code exchange. expiresAt is null when Meta says it never expires. */
    public record MetaUserToken(String accessToken, Instant expiresAt, String scopes) {
    }

    @PostConstruct
    void init() {
        this.webClient = MarketingHttp.build(webClientBuilder);
    }

    public String graphVersion() {
        return graphVersion;
    }

    public String graphBase() {
        return GRAPH_HOST + graphVersion;
    }

    public boolean isAppConfigured() {
        return appId != null && !appId.isBlank() && appSecret != null && !appSecret.isBlank();
    }

    public static String enc(String value) {
        return MarketingHttp.enc(value);
    }

    // ── Generic Graph calls ──────────────────────────────────────────────────

    /** GET one Graph object/edge page. Does not follow paging. */
    public JsonNode get(String pathAndQuery, String accessToken) {
        return getAbsolute(buildUrl(pathAndQuery, accessToken));
    }

    /**
     * GET an edge and follow {@code paging.next} up to {@code maxPages} pages. Returns the
     * flattened items of every page's {@code data} array (not the page envelopes).
     */
    public List<JsonNode> getAllPages(String pathAndQuery, String accessToken, int maxPages) {
        List<JsonNode> items = new ArrayList<>();
        String next = buildUrl(pathAndQuery, accessToken);
        int fetched = 0;
        int cap = Math.max(1, maxPages);
        while (next != null && fetched < cap) {
            JsonNode page = getAbsolute(next);
            fetched++;
            for (JsonNode item : page.path("data")) {
                items.add(item);
            }
            String nextUrl = page.path("paging").path("next").asText(null);
            next = nextUrl == null || nextUrl.isBlank() ? null : nextUrl;
        }
        if (next != null) {
            log.info("Meta Graph paging stopped after {} pages for {}", cap, pathOnly(pathAndQuery));
        }
        return items;
    }

    /** POST a form to a Graph path; the token goes in the form body (kept out of URLs and logs). */
    public JsonNode postForm(String path, MultiValueMap<String, String> form, String accessToken) {
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        if (form != null) body.addAll(form);
        body.set("access_token", accessToken);
        URI uri = URI.create(graphBase() + "/" + stripSlash(path));
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.post().uri(uri)
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(BodyInserters.fromFormData(body)),
                objectMapper, PLATFORM_LABEL);
        return checked(result);
    }

    // ── OAuth helpers ────────────────────────────────────────────────────────

    /**
     * Facebook Login dialog URL. With a Login-for-Business {@code configId} the configuration owns
     * the permission list; otherwise {@code scopes} is sent.
     */
    public String buildAuthorizeUrl(String state, String redirectUri, String configId, String scopes) {
        String url = DIALOG_HOST + graphVersion + "/dialog/oauth"
                + "?client_id=" + enc(appId)
                + "&redirect_uri=" + enc(redirectUri)
                + "&state=" + enc(state)
                + "&response_type=code";
        if (configId != null && !configId.isBlank()) {
            return url + "&config_id=" + enc(configId) + "&override_default_response_type=true";
        }
        return url + "&scope=" + enc(scopes);
    }

    /**
     * Exchanges an authorization code for a long-lived user token (code, then fb_exchange_token).
     * When the long-lived upgrade fails for a Login-for-Business token (system-user tokens are
     * already long-lived and reject the upgrade) the first token is kept. Expiry and granted scopes
     * come from debug_token; when that fails, from expires_in (default 60 days).
     */
    public MetaUserToken exchangeCodeForUserToken(String code, String redirectUri, boolean configBased) {
        MultiValueMap<String, String> first = new LinkedMultiValueMap<>();
        first.add("client_id", appId);
        first.add("client_secret", appSecret);
        first.add("redirect_uri", redirectUri);
        first.add("code", code);
        JsonNode initial = postTokenEndpoint(first);
        String token = initial.path("access_token").asText(null);
        if (token == null || token.isBlank()) {
            throw new MarketingApiException("token_exchange_failed",
                    "Meta did not return an access token", false, false);
        }
        long expiresIn = initial.path("expires_in").asLong(0);

        try {
            MultiValueMap<String, String> upgrade = new LinkedMultiValueMap<>();
            upgrade.add("grant_type", "fb_exchange_token");
            upgrade.add("client_id", appId);
            upgrade.add("client_secret", appSecret);
            upgrade.add("fb_exchange_token", token);
            JsonNode longLived = postTokenEndpoint(upgrade);
            String longToken = longLived.path("access_token").asText(null);
            if (longToken == null || longToken.isBlank()) {
                throw new MarketingApiException("token_exchange_failed",
                        "Meta did not return a long-lived token", false, false);
            }
            token = longToken;
            expiresIn = longLived.path("expires_in").asLong(DEFAULT_LONG_LIVED_SECONDS);
        } catch (MarketingApiException e) {
            if (!configBased) throw e;
            log.warn("Meta long-lived token upgrade failed for a Login-for-Business grant; "
                    + "keeping the first token (code {})", e.getPlatformCode());
        }

        Instant expiresAt = expiresIn > 0 ? Instant.now().plusSeconds(expiresIn)
                : Instant.now().plusSeconds(DEFAULT_LONG_LIVED_SECONDS);
        String scopes = null;
        try {
            JsonNode data = debugToken(token);
            if (data != null) {
                long exp = data.path("expires_at").asLong(-1);
                if (exp == 0) {
                    expiresAt = null; // Meta: 0 = never expires (system-user tokens)
                } else if (exp > 0) {
                    expiresAt = Instant.ofEpochSecond(exp);
                }
                List<String> granted = new ArrayList<>();
                for (JsonNode s : data.path("scopes")) granted.add(s.asText());
                if (!granted.isEmpty()) scopes = String.join(",", granted);
            }
        } catch (MarketingApiException e) {
            log.warn("Meta debug_token failed after the code exchange (code {}); using expires_in",
                    e.getPlatformCode());
        }
        return new MetaUserToken(token, expiresAt, scopes);
    }

    /** {@code data} of /debug_token for a user token (needs the app secret), or null when not configured. */
    public JsonNode debugToken(String inputToken) {
        if (!isAppConfigured()) return null;
        // App access token "{app-id}|{app-secret}" with the pipe pre-encoded for URI.create.
        String url = graphBase() + "/debug_token?input_token=" + enc(inputToken)
                + "&access_token=" + enc(appId) + "%7C" + enc(appSecret);
        return getAbsolute(url).path("data");
    }

    /**
     * Ids the user granted per asset (Login for Business granular_scopes.target_ids) for any of the
     * given permission names, e.g. pages_show_list (Page ids) or ads_read (ad account ids).
     * Returns an empty list when debug_token is unavailable.
     */
    public List<String> grantedTargetIds(String userToken, Collection<String> scopeNames) {
        Set<String> ids = new LinkedHashSet<>();
        try {
            JsonNode data = debugToken(userToken);
            if (data == null) return List.of();
            for (JsonNode scope : data.path("granular_scopes")) {
                if (!scopeNames.contains(scope.path("scope").asText(""))) continue;
                for (JsonNode target : scope.path("target_ids")) {
                    String id = target.asText(null);
                    if (id != null && !id.isBlank()) ids.add(id);
                }
            }
        } catch (MarketingApiException e) {
            log.warn("Meta debug_token failed while reading granted assets (code {})", e.getPlatformCode());
        }
        return new ArrayList<>(ids);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private JsonNode postTokenEndpoint(MultiValueMap<String, String> form) {
        URI uri = URI.create(graphBase() + "/oauth/access_token");
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.post().uri(uri)
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(BodyInserters.fromFormData(form)),
                objectMapper, PLATFORM_LABEL);
        return checked(result);
    }

    private JsonNode getAbsolute(String url) {
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.get().uri(URI.create(url)), objectMapper, PLATFORM_LABEL);
        return checked(result);
    }

    private JsonNode checked(MarketingHttp.HttpResult result) {
        JsonNode json = result.json();
        if (json != null && json.has("error")) {
            throw toException(json.path("error"), result.status());
        }
        if (!result.ok()) {
            boolean transientError = result.status() >= 500 || result.status() == 429;
            throw new MarketingApiException("HTTP_" + result.status(),
                    "Meta returned HTTP " + result.status(), transientError, result.status() == 401);
        }
        if (json == null) {
            throw new MarketingApiException("EMPTY_RESPONSE", "Meta returned an empty response", true, false);
        }
        return json;
    }

    static MarketingApiException toException(JsonNode error, int httpStatus) {
        int code = error.path("code").asInt(0);
        int subcode = error.path("error_subcode").asInt(0);
        String userMessage = error.path("error_user_msg").asText("");
        String message = !userMessage.isBlank() ? userMessage : error.path("message").asText("");
        if (message.isBlank()) message = "Meta returned an error (code " + code + ")";
        boolean authError = code == 190 || code == 102 || subcode == 463 || subcode == 467;
        boolean transientError = TRANSIENT_CODES.contains(code)
                || (code >= 80000 && code <= 80014)
                || error.path("is_transient").asBoolean(false)
                || httpStatus >= 500;
        String platformCode = subcode > 0 ? code + "/" + subcode : String.valueOf(code);
        return new MarketingApiException(platformCode, message, transientError, authError);
    }

    private String buildUrl(String pathAndQuery, String accessToken) {
        String path = stripSlash(pathAndQuery == null ? "" : pathAndQuery);
        String sep = path.contains("?") ? "&" : "?";
        return graphBase() + "/" + path + sep + "access_token=" + enc(accessToken);
    }

    private static String stripSlash(String path) {
        return path.startsWith("/") ? path.substring(1) : path;
    }

    private static String pathOnly(String pathAndQuery) {
        if (pathAndQuery == null) return "";
        int q = pathAndQuery.indexOf('?');
        return q < 0 ? pathAndQuery : pathAndQuery.substring(0, q);
    }
}
