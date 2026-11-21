package vacademy.io.admin_core_service.features.marketing.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.net.URI;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/**
 * Bearer-token JSON client for Google REST APIs (Google Ads, Business Profile account management,
 * business information, My Business v4 local posts).
 *
 * <p>{@code url} is absolute and must already be URL-encoded; it is sent through URI.create.
 * Any HTTP status at or above 400 (or an {@code error} element) throws {@link MarketingApiException}
 * with the platform message verbatim. Classification:
 * <ul>
 *   <li>transient: HTTP 5xx/429, status RESOURCE_EXHAUSTED / INTERNAL / UNAVAILABLE /
 *       DEADLINE_EXCEEDED, Google Ads quotaError / internalError;</li>
 *   <li>auth (reconnect): HTTP 401, status UNAUTHENTICATED, Google Ads authenticationError,
 *       authorizationError USER_PERMISSION_DENIED, reason ACCESS_TOKEN_SCOPE_INSUFFICIENT.</li>
 * </ul>
 * Developer-token and project approval errors (DEVELOPER_TOKEN_NOT_APPROVED, SERVICE_DISABLED, ...)
 * are neither: reconnecting does not fix them.
 */
@Component
@RequiredArgsConstructor
public class GoogleApiClient {

    public static final String PLATFORM_LABEL = "Google";
    private static final Set<String> TRANSIENT_STATUSES =
            Set.of("RESOURCE_EXHAUSTED", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED");

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    private WebClient webClient;

    @PostConstruct
    void init() {
        this.webClient = MarketingHttp.build(webClientBuilder);
    }

    public JsonNode get(String url, String accessToken) {
        return get(url, accessToken, Map.of());
    }

    public JsonNode get(String url, String accessToken, Map<String, String> headers) {
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.get().uri(URI.create(url))
                        .headers(h -> {
                            h.setBearerAuth(accessToken);
                            headers.forEach(h::set);
                        }),
                objectMapper, PLATFORM_LABEL);
        return checked(result);
    }

    public JsonNode postJson(String url, Object body, String accessToken) {
        return postJson(url, body, accessToken, Map.of());
    }

    public JsonNode postJson(String url, Object body, String accessToken, Map<String, String> headers) {
        MarketingHttp.HttpResult result = MarketingHttp.exchange(
                webClient.post().uri(URI.create(url))
                        .headers(h -> {
                            h.setBearerAuth(accessToken);
                            headers.forEach(h::set);
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(body == null ? Map.of() : body),
                objectMapper, PLATFORM_LABEL);
        return checked(result);
    }

    private JsonNode checked(MarketingHttp.HttpResult result) {
        JsonNode json = result.json();
        JsonNode error = findError(json);
        if (error != null || !result.ok()) {
            throw toException(error, result.status());
        }
        if (json == null) {
            // 200 with an empty body (e.g. a delete) is a valid answer.
            return objectMapper.createObjectNode();
        }
        return json;
    }

    /** The {@code error} object of a Google error body (plain object or streamed array), or null. */
    public static JsonNode findError(JsonNode json) {
        if (json == null) return null;
        if (json.isArray()) {
            for (JsonNode element : json) {
                if (element.has("error") && element.path("error").isObject()) return element.path("error");
            }
            return null;
        }
        return json.has("error") && json.path("error").isObject() ? json.path("error") : null;
    }

    /** Builds the exception for a Google error object (null when the body carried none). */
    public static MarketingApiException toException(JsonNode error, int httpStatus) {
        if (error == null) {
            boolean transientError = httpStatus >= 500 || httpStatus == 429;
            return new MarketingApiException("HTTP_" + httpStatus,
                    "Google returned HTTP " + httpStatus, transientError, httpStatus == 401);
        }
        int code = error.path("code").asInt(httpStatus);
        String status = error.path("status").asText("");
        String message = error.path("message").asText("");

        String adsKey = null;
        String adsCode = null;
        String adsMessage = null;
        String reason = null;
        for (JsonNode detail : error.path("details")) {
            if (reason == null && detail.hasNonNull("reason")) {
                reason = detail.path("reason").asText();
            }
            if (adsCode == null) {
                for (JsonNode adsError : detail.path("errors")) {
                    JsonNode errorCode = adsError.path("errorCode");
                    Iterator<Map.Entry<String, JsonNode>> fields = errorCode.fields();
                    if (fields.hasNext()) {
                        Map.Entry<String, JsonNode> first = fields.next();
                        adsKey = first.getKey();
                        adsCode = first.getValue().asText();
                        adsMessage = adsError.path("message").asText(null);
                        break;
                    }
                }
            }
        }

        String platformCode = adsCode != null ? adsCode
                : reason != null ? reason
                : !status.isBlank() ? status : "HTTP_" + code;
        String text = adsMessage != null && !adsMessage.isBlank() ? adsMessage
                : !message.isBlank() ? message : "Google returned HTTP " + code;

        boolean authError = code == 401
                || "UNAUTHENTICATED".equals(status)
                || "authenticationError".equals(adsKey)
                || "USER_PERMISSION_DENIED".equals(adsCode)
                || "ACCESS_TOKEN_SCOPE_INSUFFICIENT".equals(reason);
        boolean transientError = code >= 500 || code == 429
                || TRANSIENT_STATUSES.contains(status)
                || "quotaError".equals(adsKey)
                || "internalError".equals(adsKey);
        return new MarketingApiException(platformCode, text, transientError, authError);
    }
}
