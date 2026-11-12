package vacademy.io.auth_service.feature.selfsignup.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * How a product's self sign-up differs from Evalezy's, read from the product row in admin-core
 * (signup_rules) over HMAC. Kept in auth_service rather than the common ProductConfigDTO so a new
 * rule never needs a common library release. Cached for a minute, like ProductConfigClient.
 */
@Slf4j
@Component
public class SelfSignupRulesClient {

    private static final long TTL_MILLIS = 60_000L;

    @Data
    @NoArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Rules {
        private Boolean phoneVerificationRequired;
        private Boolean hideTeachers;
        private List<String> instituteTypes;

        public boolean requiresPhone() {
            return Boolean.TRUE.equals(phoneVerificationRequired);
        }

        public boolean hidesTeachers() {
            return Boolean.TRUE.equals(hideTeachers);
        }
    }

    private record Cached(Rules rules, long expiresAt) {
    }

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${admin.core.service.base_url}")
    private String adminCoreBaseUrl;

    /**
     * The product's rules. Callers have already resolved the product (requireProduct), so the key
     * is a known product. A failed read FAILS CLOSED for products whose rules were seen before
     * (the last answer is kept), and otherwise refuses the sign-up rather than silently skipping
     * the phone check that guards the free trial.
     */
    public Rules rules(String productKey) {
        String key = productKey.toLowerCase(Locale.ROOT);
        long now = System.currentTimeMillis();
        Cached cached = cache.get(key);
        if (cached != null && cached.expiresAt() > now) {
            return cached.rules();
        }
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(),
                    adminCoreBaseUrl, "/admin-core-service/internal/product-config/v1/" + key + "/signup-rules", null);
            String body = response.getBody();
            Rules rules = body == null || body.isBlank() ? new Rules() : mapper.readValue(body, Rules.class);
            cache.put(key, new Cached(rules, now + TTL_MILLIS));
            return rules;
        } catch (org.springframework.web.client.HttpStatusCodeException e) {
            if (e.getStatusCode().value() == 404) {
                // An admin-core that predates sign-up rules: every product signs up the default
                // way, which is exactly what it did before. (Telleo's sign-up is closed until
                // both services are out.)
                Rules none = new Rules();
                cache.put(key, new Cached(none, now + TTL_MILLIS));
                return none;
            }
            log.warn("[self-signup] could not read sign-up rules for {}: {}", key, e.getMessage());
            if (cached != null) {
                return cached.rules();
            }
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Sign-up is briefly unavailable. Please try again in a minute.");
        } catch (Exception e) {
            log.warn("[self-signup] could not read sign-up rules for {}: {}", key, e.getMessage());
            if (cached != null) {
                return cached.rules();
            }
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Sign-up is briefly unavailable. Please try again in a minute.");
        }
    }

    /** One free trial per phone. Fails closed: an unreadable answer stops the sign-up. */
    public boolean isTrialPhoneAvailable(String productKey, String phone) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(),
                    adminCoreBaseUrl, "/admin-core-service/internal/product-config/v1/"
                            + productKey.toLowerCase(Locale.ROOT) + "/trial-phone-available?phone="
                            + URLEncoder.encode(phone, StandardCharsets.UTF_8), null);
            Map<?, ?> body = mapper.readValue(response.getBody(), Map.class);
            return Boolean.TRUE.equals(body.get("available"));
        } catch (Exception e) {
            log.warn("[self-signup] could not check the trial phone for {}: {}", productKey, e.getMessage());
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Sign-up is briefly unavailable. Please try again in a minute.");
        }
    }
}
