package vacademy.io.assessment_service.features.open_evaluation.auth;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.auth.apikey.ApiKeyVerifierUnavailableException;
import vacademy.io.common.core.internal_api_wrapper.HmacUtils;
import vacademy.io.common.tracing.RequestIds;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;

/**
 * Calls admin_core's internal key verify endpoint (contract C2):
 * {@code POST /admin-core-service/internal/api-keys/v1/verify {"key_hash": "<hex>"}} with the
 * service's HMAC headers.
 *
 * <p>Its own RestTemplate with tight timeouts (500 ms connect, 1.5 s read, spec 6.4): this
 * call sits in front of every cache miss of the partner API, and the shared
 * {@code InternalClientUtils} client waits 10 s / 30 s.
 *
 * <p>Outcomes: 200 → the key; 404 (unknown, revoked, expired) or 400 (malformed hash) →
 * empty; anything else (timeout, refused, 5xx, our HMAC rejected) →
 * {@link ApiKeyVerifierUnavailableException}, never "unknown".
 *
 * <p>It also looks up the institute's display name for {@code GET /me} on the same
 * short-timeout client, so a slow admin_core costs /me at most ~2 s, never the shared
 * client's 40 s.
 */
@Slf4j
@Component
public class AdminCoreApiKeyClient {

    static final String VERIFY_ROUTE = "/admin-core-service/internal/api-keys/v1/verify";
    static final String INSTITUTE_ROUTE = "/admin-core-service/internal/institute/v1/";

    private final HmacUtils hmacUtils;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    /** Names found, 5 min; a failed or empty lookup is not cached, so it is retried. */
    private final Cache<String, String> instituteNames = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofMinutes(5))
            .build();

    @Value("${admin.core.service.baseurl:http://localhost:8072}")
    private String adminCoreBaseUrl;

    @Value("${spring.application.name:assessment_service}")
    private String clientName;

    @Autowired
    public AdminCoreApiKeyClient(HmacUtils hmacUtils,
            @Value("${assessment.open-api.verify.connect-timeout-ms:500}") int connectTimeoutMs,
            @Value("${assessment.open-api.verify.read-timeout-ms:1500}") int readTimeoutMs) {
        this(hmacUtils, restTemplate(connectTimeoutMs, readTimeoutMs));
    }

    AdminCoreApiKeyClient(HmacUtils hmacUtils, RestTemplate restTemplate) {
        this.hmacUtils = hmacUtils;
        this.restTemplate = restTemplate;
    }

    private static RestTemplate restTemplate(int connectTimeoutMs, int readTimeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeoutMs);
        factory.setReadTimeout(readTimeoutMs);
        return new RestTemplate(factory);
    }

    public Optional<ApiKeyVerifyResponse> verify(String keyHash) {
        String secret;
        try {
            secret = hmacUtils.retrieveSecretKeyFromDatabase(clientName);
        } catch (RuntimeException e) {
            throw new ApiKeyVerifierUnavailableException("internal client secret lookup failed", e);
        }
        if (secret == null) {
            throw new ApiKeyVerifierUnavailableException("no internal client secret for " + clientName);
        }
        HttpHeaders headers = new HttpHeaders();
        headers.set("clientName", clientName);
        headers.set("Signature", secret);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        String requestId = RequestIds.current();
        if (requestId != null && !requestId.isEmpty()) {
            headers.set(RequestIds.HEADER, requestId);
        }

        ResponseEntity<String> response;
        try {
            response = restTemplate.exchange(adminCoreBaseUrl + VERIFY_ROUTE, HttpMethod.POST,
                    new HttpEntity<>(Map.of("key_hash", keyHash), headers), String.class);
        } catch (HttpStatusCodeException e) {
            return onErrorStatus(e.getStatusCode());
        } catch (ResourceAccessException e) {
            throw new ApiKeyVerifierUnavailableException("admin_core unreachable: " + e.getMessage(), e);
        } catch (RestClientException e) {
            throw new ApiKeyVerifierUnavailableException("admin_core verify failed: " + e.getMessage(), e);
        }

        if (!response.getStatusCode().is2xxSuccessful()) {
            return onErrorStatus(response.getStatusCode());
        }
        String body = response.getBody();
        if (body == null || body.isBlank()) {
            throw new ApiKeyVerifierUnavailableException("admin_core verify returned an empty body");
        }
        try {
            ApiKeyVerifyResponse parsed = objectMapper.readValue(body, ApiKeyVerifyResponse.class);
            if (parsed.getKeyId() == null || parsed.getInstituteId() == null) {
                throw new ApiKeyVerifierUnavailableException("admin_core verify body lacks key_id/institute_id");
            }
            return Optional.of(parsed);
        } catch (ApiKeyVerifierUnavailableException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiKeyVerifierUnavailableException("admin_core verify body unreadable", e);
        }
    }

    /**
     * The institute's display name; null when it has none or admin_core cannot answer within
     * the short timeouts. Never throws: the name is optional in {@code GET /me}.
     */
    public String instituteName(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            return null;
        }
        String cached = instituteNames.getIfPresent(instituteId);
        if (cached != null) {
            return cached;
        }
        try {
            String secret = hmacUtils.retrieveSecretKeyFromDatabase(clientName);
            if (secret == null) {
                return null;
            }
            HttpHeaders headers = new HttpHeaders();
            headers.set("clientName", clientName);
            headers.set("Signature", secret);
            headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
            String requestId = RequestIds.current();
            if (requestId != null && !requestId.isEmpty()) {
                headers.set(RequestIds.HEADER, requestId);
            }
            ResponseEntity<String> response = restTemplate.exchange(
                    adminCoreBaseUrl + INSTITUTE_ROUTE + "{id}", HttpMethod.GET,
                    new HttpEntity<>(headers), String.class, instituteId);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return null;
            }
            JsonNode node = objectMapper.readTree(response.getBody());
            String name = firstText(node, "institute_name", "instituteName");
            if (name != null) {
                instituteNames.put(instituteId, name);
            }
            return name;
        } catch (Exception e) {
            log.debug("Institute name lookup failed for {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private static String firstText(JsonNode node, String... fields) {
        if (node == null) {
            return null;
        }
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value != null && value.isTextual() && !value.asText().isBlank()) {
                return value.asText();
            }
        }
        return null;
    }

    private static Optional<ApiKeyVerifyResponse> onErrorStatus(HttpStatusCode status) {
        int code = status.value();
        if (code == 404 || code == 400) {
            return Optional.empty();
        }
        // 401/403 = our HMAC was refused (misconfiguration), 429/5xx = outage: neither means
        // the key is unknown, so the filter answers 503 and nothing negative is cached.
        throw new ApiKeyVerifierUnavailableException("admin_core verify answered HTTP " + code);
    }
}
