package vacademy.io.admin_core_service.features.workflow.engine.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.util.UriComponentsBuilder;
import vacademy.io.admin_core_service.features.workflow.dto.HttpRequestNodeConfigDTO;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils; // Assuming this path

import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Component
@RequiredArgsConstructor
public class InternalHttpRequestStrategy implements HttpRequestStrategy {

    private final HttpHelperUtils httpHelperUtils;
    private final InternalClientUtils internalClientUtils; // Assuming this is injected

    /** INTERNAL requests are signed as this service, whatever client name the node names. */
    @Value("${spring.application.name:admin_core_service}")
    private String ownClientName;

    // The only targets an INTERNAL request may go to: this service's own configured service URLs
    // and our own public API origins.
    @Value("${auth.server.baseurl:}")
    private String authServerBaseUrl;
    @Value("${notification.server.baseurl:}")
    private String notificationServerBaseUrl;
    @Value("${assessment.server.baseurl:}")
    private String assessmentServerBaseUrl;
    @Value("${media.server.baseurl:}")
    private String mediaServerBaseUrl;
    @Value("${community.server.baseurl:}")
    private String communityServerBaseUrl;
    @Value("${ai.service.url:}")
    private String aiServiceUrl;
    /**
     * Our own public API origins (comma separated). Saved INTERNAL nodes reach auth_service through
     * the public host, e.g. https://backend-stage.vacademy.io/auth-service/internal/...
     */
    @Value("${workflow.http.internal-allowed-origins:https://backend-stage.vacademy.io,https://api.vacademy.ai}")
    private String extraAllowedOrigins;

    @Override
    public boolean canHandle(String requestType) {
        return "INTERNAL".equalsIgnoreCase(requestType);
    }

    @Override
    public Map<String, Object> execute(Map<String, Object> context, HttpRequestNodeConfigDTO.RequestConfig cfg) {
        Map<String, Object> result = new HashMap<>();

        try {
            String clientName = Optional.ofNullable(cfg.getAuthentication())
                    .map(HttpRequestNodeConfigDTO.AuthenticationConfig::getClientName)
                    .orElse(null);

            clientName = httpHelperUtils.evaluateSpel(clientName, context, String.class, clientName);

            if (clientName == null || clientName.isBlank()) {
                log.error("INTERNAL request type requires 'authentication.clientName'.");
                result.put("error", "INTERNAL request missing clientName");
                return result;
            }

            String evaluatedUrl = httpHelperUtils.evaluateSpel(cfg.getUrl(), context, String.class, cfg.getUrl());
            String method = cfg.getMethod().toUpperCase();

            UriComponentsBuilder uriBuilder = UriComponentsBuilder.fromHttpUrl(evaluatedUrl);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            if (cfg.getHeaders() != null && cfg.getHeaders().isObject()) {
                cfg.getHeaders().fields().forEachRemaining(entry -> {
                    String val = httpHelperUtils.evaluateSpel(entry.getValue().asText(), context, String.class, "");
                    headers.add(entry.getKey(), val);
                });
            }

            if (cfg.getQueryParams() != null && cfg.getQueryParams().isObject()) {
                cfg.getQueryParams().fields().forEachRemaining(entry -> {
                    String val = httpHelperUtils.evaluateSpel(entry.getValue().asText(), context, String.class, "");
                    uriBuilder.queryParam(entry.getKey(), val);
                });
            }

            // The internal client utils builds the URL from base + route, but our DTO has a full URL.
            // We'll just pass the final URL as the "baseUrl" and an empty string as the "route".
            String finalUrl = uriBuilder.build().toUriString();

            Object workflowId = context != null ? context.get("workflowId") : null;
            if (!isOwnServiceUrl(finalUrl)) {
                log.warn("Workflow INTERNAL request refused: target is not one of this service's configured "
                        + "service URLs (host={}, workflowId={})", hostOf(finalUrl), workflowId);
                result.put("error", "INTERNAL request target is not an allowed service URL");
                return result;
            }
            if (!ownClientName.equals(clientName)) {
                log.warn("Workflow INTERNAL request: node's clientName ignored, signing as this service (workflowId={})",
                        workflowId);
            }
            clientName = ownClientName;

            Object requestBody = null;
            if (cfg.getBody() != null && !"GET".equals(method) && !"DELETE".equals(method)) {
                requestBody = httpHelperUtils.evaluateBodyExpressions(cfg.getBody(), context);
            }

            log.info("Executing INTERNAL HTTP {} → {} for client: {}", method, finalUrl, clientName);
            if (requestBody != null) log.debug("Request body: {}", requestBody);

            // Using the makeHmacRequest that accepts additional headers
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    method,
                    finalUrl, // Pass final URL as baseUrl
                    "",       // Pass empty string as route
                    requestBody,
                    headers
            );

            result.putAll(httpHelperUtils.processResponse(response));

        } catch (HttpClientErrorException e) {
            log.error("HTTP Client Error (INTERNAL): {} {} - {}", cfg.getMethod(), cfg.getUrl(), e.getStatusCode(), e);
            result.putAll(httpHelperUtils.processHttpClientError(e));
        } catch (Exception e) {
            log.error("Error executing InternalHttpRequestStrategy: {}", e.getMessage(), e);
            result.put("error", "InternalHttpRequestStrategy failed: " + e.getMessage());
        }
        return result;
    }

    /** Scheme, host and port of {@code url} equal one of this service's configured service base URLs. */
    boolean isOwnServiceUrl(String url) {
        String origin = origin(url);
        if (origin == null) {
            return false;
        }
        for (String base : ownServiceBaseUrls()) {
            if (origin.equals(origin(base))) {
                return true;
            }
        }
        return false;
    }

    private List<String> ownServiceBaseUrls() {
        List<String> out = new ArrayList<>();
        for (String base : new String[] {authServerBaseUrl, notificationServerBaseUrl, assessmentServerBaseUrl,
                mediaServerBaseUrl, communityServerBaseUrl, aiServiceUrl}) {
            if (base != null && !base.isBlank()) {
                out.add(base.trim());
            }
        }
        if (extraAllowedOrigins != null) {
            for (String origin : extraAllowedOrigins.split(",")) {
                if (!origin.isBlank()) {
                    out.add(origin.trim());
                }
            }
        }
        return out;
    }

    /** "scheme://host:port" with the default port filled in, or null when not an http(s) URL. */
    static String origin(String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        try {
            URI uri = URI.create(url.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || uri.getRawUserInfo() != null) {
                return null;
            }
            scheme = scheme.toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            if (port == -1) {
                if (scheme.equals("http")) {
                    port = 80;
                } else if (scheme.equals("https")) {
                    port = 443;
                } else {
                    return null;
                }
            }
            return scheme + "://" + host.toLowerCase(Locale.ROOT) + ":" + port;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String hostOf(String url) {
        try {
            return URI.create(url.trim()).getHost();
        } catch (Exception e) {
            return null;
        }
    }
}