package vacademy.io.auth_service.feature.login_link.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.apikey.ApiKeyVerifier;
import vacademy.io.common.auth.apikey.ApiKeyVerifierUnavailableException;
import vacademy.io.common.core.internal_api_wrapper.HmacUtils;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * auth_service's {@link ApiKeyVerifier} for the login-links key ({@code vak_login_…}): admin_core's
 * {@code POST /admin-core-service/internal/api-keys/v1/verify} behind a small cache, the same
 * contract assessment_service uses for evaluation keys.
 *
 * <ul>
 *   <li>Known key: cached 60 s, so a revoke takes effect within a minute.</li>
 *   <li>Unknown key: cached 30 s, so a flood of bad keys costs one admin_core call per key.</li>
 *   <li>admin_core unreachable: {@link ApiKeyVerifierUnavailableException} (the filter answers
 *       503), never "unknown". Failures are not cached.</li>
 * </ul>
 */
@Slf4j
@Component
public class AdminCoreLoginLinksKeyVerifier implements ApiKeyVerifier {

    static final String VERIFY_ROUTE = "/admin-core-service/internal/api-keys/v1/verify";

    private final HmacUtils hmacUtils;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Cache<String, Optional<ApiKeyPrincipal>> known = Caffeine.newBuilder()
            .maximumSize(10_000).expireAfterWrite(Duration.ofSeconds(60)).build();
    private final Cache<String, Boolean> unknown = Caffeine.newBuilder()
            .maximumSize(10_000).expireAfterWrite(Duration.ofSeconds(30)).build();

    @Value("${admin.core.service.base_url}")
    private String adminCoreBaseUrl;

    @Value("${spring.application.name:auth_service}")
    private String clientName;

    @Autowired
    public AdminCoreLoginLinksKeyVerifier(HmacUtils hmacUtils) {
        this.hmacUtils = hmacUtils;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(1000);
        factory.setReadTimeout(3000);
        this.restTemplate = new RestTemplate(factory);
    }

    @Override
    public Optional<ApiKeyPrincipal> verify(String keyHash) throws ApiKeyVerifierUnavailableException {
        if (keyHash == null || keyHash.isBlank()) {
            return Optional.empty();
        }
        Optional<ApiKeyPrincipal> cached = known.getIfPresent(keyHash);
        if (cached != null) {
            return cached;
        }
        if (unknown.getIfPresent(keyHash) != null) {
            return Optional.empty();
        }
        Optional<ApiKeyPrincipal> fresh = fetch(keyHash);
        if (fresh.isPresent()) {
            known.put(keyHash, fresh);
        } else {
            unknown.put(keyHash, Boolean.TRUE);
        }
        return fresh;
    }

    private Optional<ApiKeyPrincipal> fetch(String keyHash) {
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
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));

        ResponseEntity<String> response;
        try {
            response = restTemplate.exchange(adminCoreBaseUrl + VERIFY_ROUTE, HttpMethod.POST,
                    new HttpEntity<>(Map.of("key_hash", keyHash), headers), String.class);
        } catch (HttpStatusCodeException e) {
            int code = e.getStatusCode().value();
            if (code == 404 || code == 400) {
                return Optional.empty();
            }
            throw new ApiKeyVerifierUnavailableException("admin_core verify answered HTTP " + code);
        } catch (RestClientException e) {
            throw new ApiKeyVerifierUnavailableException("admin_core verify failed: " + e.getMessage(), e);
        }
        try {
            JsonNode body = objectMapper.readTree(response.getBody());
            String keyId = text(body, "key_id");
            String instituteId = text(body, "institute_id");
            if (keyId == null || instituteId == null) {
                throw new ApiKeyVerifierUnavailableException("admin_core verify body lacks key_id/institute_id");
            }
            return Optional.of(ApiKeyPrincipal.builder()
                    .keyId(keyId)
                    .instituteId(instituteId)
                    .name(text(body, "name"))
                    .products(strings(body.get("products")))
                    .scopes(strings(body.get("scopes")))
                    .status(text(body, "status"))
                    .expiresAt(parseInstant(text(body, "expires_at")))
                    .accessEnabled(body.path("access_enabled").asBoolean(false))
                    .build());
        } catch (ApiKeyVerifierUnavailableException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiKeyVerifierUnavailableException("admin_core verify body unreadable", e);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        if (array != null && array.isArray()) {
            array.forEach(v -> {
                if (v.isTextual()) {
                    out.add(v.asText());
                }
            });
        }
        return out;
    }

    /** Unparseable = already expired, so a garbled expiry can never make a key immortal. */
    private static Instant parseInstant(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return Instant.parse(raw);
        } catch (DateTimeParseException e) {
            return Instant.EPOCH;
        }
    }
}
