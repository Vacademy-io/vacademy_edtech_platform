package vacademy.io.admin_core_service.features.marketing.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Shared HTTP plumbing for the marketing clients: one WebClient shape (10s connect, 30s response,
 * 32 MB buffer for large insight / searchStream payloads) and one blocking exchange that always
 * returns the status and the parsed body, so callers can read the platform error JSON on a 4xx.
 *
 * <p>Network failures become a transient {@link MarketingApiException}: {@code CONNECT_ERROR} when
 * the connection could not even be opened (the request was never sent), else {@code NETWORK_ERROR}
 * (a timeout or dropped response: the platform may have acted on it). Their message names only
 * the exception class: the reactor message contains the request URL, which can carry a token.
 */
public final class MarketingHttp {

    private static final int MAX_IN_MEMORY_BYTES = 32 * 1024 * 1024;
    private static final int SNIPPET_LENGTH = 300;

    private MarketingHttp() {
    }

    /** Status + parsed JSON (null when the body is empty or not JSON) + a short body snippet. */
    public record HttpResult(int status, JsonNode json, String snippet) {
        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }

    public static WebClient build(WebClient.Builder builder) {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 10000)
                .responseTimeout(Duration.ofSeconds(30));
        return builder.clone()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(c -> c.defaultCodecs().maxInMemorySize(MAX_IN_MEMORY_BYTES))
                .build();
    }

    public static HttpResult exchange(WebClient.RequestHeadersSpec<?> spec, ObjectMapper objectMapper,
                                      String platformLabel) {
        return exchange(spec, objectMapper, platformLabel, Duration.ofSeconds(45));
    }

    /** As {@link #exchange(WebClient.RequestHeadersSpec, ObjectMapper, String)} with a longer overall wait. */
    public static HttpResult exchange(WebClient.RequestHeadersSpec<?> spec, ObjectMapper objectMapper,
                                      String platformLabel, Duration blockTimeout) {
        HttpResult result;
        try {
            result = spec.exchangeToMono(resp -> resp.bodyToMono(String.class)
                            .defaultIfEmpty("")
                            .map(body -> new HttpResult(resp.statusCode().value(),
                                    parse(objectMapper, body), snippet(body))))
                    .block(blockTimeout);
        } catch (Exception e) {
            if (isConnectFailure(e)) {
                throw new MarketingApiException(MarketingApiException.CONNECT_ERROR,
                        platformLabel + " could not be reached (" + e.getClass().getSimpleName()
                                + "). Please try again shortly.", true, false);
            }
            throw new MarketingApiException("NETWORK_ERROR",
                    platformLabel + " could not be reached (" + e.getClass().getSimpleName()
                            + "). Please try again shortly.", true, false);
        }
        if (result == null) {
            throw new MarketingApiException("NETWORK_ERROR",
                    platformLabel + " returned no response. Please try again shortly.", true, false);
        }
        return result;
    }

    /** True when the cause chain shows the connection was never established. */
    static boolean isConnectFailure(Throwable e) {
        int depth = 0;
        for (Throwable t = e; t != null && depth < 10; t = t.getCause(), depth++) {
            // io.netty.channel.ConnectTimeoutException extends java.net.ConnectException.
            if (t instanceof java.net.ConnectException
                    || t instanceof java.net.UnknownHostException
                    || t instanceof java.nio.channels.UnresolvedAddressException) {
                return true;
            }
            if (t.getCause() == t) break;
        }
        return false;
    }

    public static String enc(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private static JsonNode parse(ObjectMapper objectMapper, String body) {
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(body);
            return node == null || node.isMissingNode() ? null : node;
        } catch (Exception e) {
            return null;
        }
    }

    private static String snippet(String body) {
        if (body == null) return "";
        String trimmed = body.strip();
        return trimmed.length() <= SNIPPET_LENGTH ? trimmed : trimmed.substring(0, SNIPPET_LENGTH);
    }
}
