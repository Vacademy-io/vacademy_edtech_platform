package vacademy.io.admin_core_service.features.workflow.engine.http;

import vacademy.io.admin_core_service.core.external.ExternalCallLog;
import vacademy.io.admin_core_service.core.external.OutboundUrlGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import vacademy.io.admin_core_service.features.workflow.dto.HttpRequestNodeConfigDTO;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class ExternalHttpRequestStrategy implements HttpRequestStrategy {

    private final HttpHelperUtils httpHelperUtils;
    private final ObjectMapper objectMapper;

    /** Same limit HttpURLConnection applies when it follows redirects itself (http.maxRedirects). */
    static final int MAX_REDIRECTS = 20;

    /**
     * When true, a target that is not a public address (loopback, private, link-local/metadata,
     * cluster-internal names) is refused. When false (default) the request is sent as before and
     * the would-be refusal is logged.
     */
    @Value("${workflow.http.block-private-targets:false}")
    private boolean blockPrivateTargets;

    private static RestTemplate createRestTemplateWithTimeout() {
        // Redirects are followed in execute() so that every hop's target is checked; the
        // connection itself never follows one.
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(HttpURLConnection connection, String httpMethod) throws IOException {
                super.prepareConnection(connection, httpMethod);
                connection.setInstanceFollowRedirects(false);
            }
        };
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(30_000);
        return ExternalCallLog.attach(new RestTemplate(factory));
    }

    private final RestTemplate restTemplate = createRestTemplateWithTimeout();

    @Override
    public boolean canHandle(String requestType) {
        return "EXTERNAL".equalsIgnoreCase(requestType);
    }

    @Override
    public Map<String, Object> execute(Map<String, Object> context, HttpRequestNodeConfigDTO.RequestConfig cfg) {
        Map<String, Object> result = new HashMap<>();
        try {
            String evaluatedUrl = httpHelperUtils.evaluateSpel(cfg.getUrl(), context, String.class, cfg.getUrl());
            HttpMethod method = HttpMethod.valueOf(cfg.getMethod().toUpperCase());
            UriComponentsBuilder uriBuilder = UriComponentsBuilder.fromHttpUrl(evaluatedUrl);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            if (cfg.getHeaders() != null && cfg.getHeaders().isObject()) {
                cfg.getHeaders().fields().forEachRemaining(entry -> {
                    String val = httpHelperUtils.evaluateSpel(entry.getValue().asText(), context, String.class, "");
                    headers.add(entry.getKey(), val);
                });
            }

            if (cfg.getAuthentication() != null && StringUtils.hasText(cfg.getAuthentication().getType())) {
                var auth = cfg.getAuthentication();
                switch (auth.getType().toUpperCase()) {
                    case "BASIC":
                        String username = httpHelperUtils.evaluateSpel(auth.getUsername(), context, String.class, "");
                        String password = httpHelperUtils.evaluateSpel(auth.getPassword(), context, String.class, "");
                        headers.setBasicAuth(username, password);
                        break;
                    case "BEARER":
                        String token = httpHelperUtils.evaluateSpel(auth.getToken(), context, String.class, "");
                        headers.setBearerAuth(token);
                        break;
                    default:
                        log.warn("Unsupported external auth type: {}", auth.getType());
                }
            }

            // Query values are bound as URI variables so they are strictly percent-encoded on
            // expansion. Appending them raw let a value containing '#', '&' or '+' corrupt the
            // request: a Moodle password with '#' turned everything after it (firstname,
            // lastname, email) into a URL fragment, so core_user_create_users failed with
            // "Missing required key ... firstname" and the learner got no account or email.
            Map<String, Object> queryVars = new HashMap<>();
            if (cfg.getQueryParams() != null && cfg.getQueryParams().isObject()) {
                cfg.getQueryParams().fields().forEachRemaining(entry -> {
                    String val = httpHelperUtils.evaluateSpel(entry.getValue().asText(), context, String.class, "");
                    if (val == null) {
                        uriBuilder.queryParam(entry.getKey());
                        return;
                    }
                    String var = "qp" + queryVars.size();
                    uriBuilder.queryParam(entry.getKey(), "{" + var + "}");
                    queryVars.put(var, val);
                });
            }

            Object requestBody = null;
            if (cfg.getBody() != null && method != HttpMethod.GET) {
                requestBody = httpHelperUtils.evaluateBodyExpressions(cfg.getBody(), context);
            }

            // Passed to RestTemplate as a URI, not a String, so it is not encoded a second time.
            URI finalUri = uriBuilder.encode().buildAndExpand(queryVars).toUri();
            String finalUrl = finalUri.toString();
            HttpEntity<?> entity = new HttpEntity<>(requestBody, headers);

            logCurl(method, finalUrl, entity);

            log.info("Executing EXTERNAL HTTP {} → {}", method, finalUrl);
            if (requestBody != null) log.debug("Request body: {}", requestBody);

            Object workflowId = context != null ? context.get("workflowId") : null;
            if (!targetAllowed(finalUri, workflowId)) {
                result.put("error", "ExternalHttpRequestStrategy failed: target address is not allowed");
                return result;
            }
            ResponseEntity<String> response = restTemplate.exchange(finalUri, method, entity, String.class);
            // Same redirects the connection used to follow on its own (GET only, same scheme),
            // with each new target checked like the first.
            URI current = finalUri;
            int hops = 0;
            while (method == HttpMethod.GET && isFollowedRedirect(response.getStatusCode().value())) {
                URI next = redirectTarget(current, response.getHeaders().getFirst(HttpHeaders.LOCATION));
                if (next == null || !current.getScheme().equalsIgnoreCase(next.getScheme())) {
                    break;
                }
                if (++hops > MAX_REDIRECTS) {
                    throw new IllegalStateException("Server redirected too many times (" + MAX_REDIRECTS + ")");
                }
                if (!targetAllowed(next, workflowId)) {
                    result.put("error", "ExternalHttpRequestStrategy failed: redirect target address is not allowed");
                    return result;
                }
                current = next;
                response = restTemplate.exchange(current, method, entity, String.class);
            }
            result.putAll(httpHelperUtils.processResponse(response));

        } catch (HttpClientErrorException e) {
            log.error("HTTP Client Error: {} {} - {}", cfg.getMethod(), cfg.getUrl(), e.getStatusCode(), e);
            result.putAll(httpHelperUtils.processHttpClientError(e));
        } catch (Exception e) {
            log.error("Error executing ExternalHttpRequestStrategy: {}", e.getMessage(), e);
            result.put("error", "ExternalHttpRequestStrategy failed: " + e.getMessage());
        }
        return result;
    }

    /** False only when the target is refused (blocking enabled); otherwise logs what would be refused. */
    boolean targetAllowed(URI target, Object workflowId) {
        String reason = OutboundUrlGuard.blockReason(target);
        if (reason == null) {
            return true;
        }
        String host = target != null ? target.getHost() : null;
        if (blockPrivateTargets) {
            log.warn("Workflow HTTP request refused: {} (host={}, workflowId={})", reason, host, workflowId);
            return false;
        }
        log.warn("Workflow HTTP request would be refused: {} (host={}, workflowId={}); sent because "
                + "workflow.http.block-private-targets=false", reason, host, workflowId);
        return true;
    }

    /** The statuses HttpURLConnection followed for GET (300, 301, 302, 303, 307). */
    static boolean isFollowedRedirect(int status) {
        return status >= 300 && status <= 307 && status != 304 && status != 305 && status != 306;
    }

    static URI redirectTarget(URI current, String location) {
        if (location == null || location.isBlank()) {
            return null;
        }
        try {
            return current.resolve(location.trim());
        } catch (IllegalArgumentException e) {
            try {
                return new URL(current.toURL(), location.trim()).toURI();
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    private static final java.util.Set<String> SECRET_HEADERS = java.util.Set.of(
            "authorization", "proxy-authorization", "cookie", "set-cookie");

    private void logCurl(HttpMethod method, String finalUrl, HttpEntity<?> entity) {
        try {
            StringBuilder curlBuilder = new StringBuilder("curl --location");
            curlBuilder.append(" -X ").append(method.name());
            curlBuilder.append(" '").append(finalUrl).append("'");

            entity.getHeaders().forEach((key, values) -> {
                if (!key.equalsIgnoreCase(HttpHeaders.CONTENT_LENGTH)) {
                    values.forEach(value -> {
                        if (SECRET_HEADERS.contains(key.toLowerCase(java.util.Locale.ROOT))) {
                            value = "<redacted>";
                        }
                        String escapedValue = value.replace("'", "'\\''");
                        curlBuilder.append(" -H '").append(key).append(": ").append(escapedValue).append("'");
                    });
                }
            });

            if (entity.getBody() != null) {
                String bodyJson = objectMapper.writeValueAsString(entity.getBody());
                bodyJson = bodyJson.replace("'", "'\\''");
                curlBuilder.append(" -d '").append(bodyJson).append("'");
            }

            log.info("Equivalent cURL: {}", curlBuilder.toString());

        } catch (Exception e) {
            log.warn("Failed to generate cURL command for logging: {}", e.getMessage());
        }
    }
}