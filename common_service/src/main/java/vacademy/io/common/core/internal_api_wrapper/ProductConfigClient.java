package vacademy.io.common.core.internal_api_wrapper;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Reads a product's settings from admin-core, cached for a minute so a change made in the portal
 * reaches every service soon and mail sending adds no load. Callers treat an empty answer as "no
 * such product": a lookup failure keeps the last answer, or else degrades to that.
 */
@Slf4j
@Component
public class ProductConfigClient {

    private static final long TTL_MILLIS = 60_000L;
    private static final long FAILURE_TTL_MILLIS = 10_000L;
    private static final Pattern KEY = Pattern.compile("^[a-z0-9_-]{1,32}$");

    private record Cached(Optional<ProductConfigDTO> value, long expiresAt) {
    }

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name:}")
    private String clientName;

    @Value("${admin.core.service.baseurl:}")
    private String adminCoreBaseUrl;

    public Optional<ProductConfigDTO> get(String product) {
        if (product == null) {
            return Optional.empty();
        }
        String key = product.trim().toLowerCase(Locale.ROOT);
        // Callers pass this on from requests: never let it shape the path or grow the cache.
        if (!KEY.matcher(key).matches()) {
            return Optional.empty();
        }
        long now = System.currentTimeMillis();
        Cached cached = cache.get(key);
        if (cached != null && cached.expiresAt() > now) {
            return cached.value();
        }
        try {
            Optional<ProductConfigDTO> fresh = fetch(key);
            // Only real products are kept: unknown keys come from outside and could grow this map.
            if (fresh.isPresent()) {
                cache.put(key, new Cached(fresh, now + TTL_MILLIS));
            } else {
                cache.remove(key);
            }
            return fresh;
        } catch (Exception e) {
            log.warn("Could not read product {}: {}", key, e.getMessage());
            Optional<ProductConfigDTO> stale = cached != null ? cached.value() : Optional.empty();
            if (stale.isPresent()) {
                cache.put(key, new Cached(stale, now + FAILURE_TTL_MILLIS));
            }
            return stale;
        }
    }

    private Optional<ProductConfigDTO> fetch(String key) throws Exception {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(),
                    adminCoreBaseUrl, "/admin-core-service/internal/product-config/v1/" + key, null);
            String body = response.getBody();
            if (body == null || body.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(mapper.readValue(body, ProductConfigDTO.class));
        } catch (HttpStatusCodeException e) {
            HttpStatusCode status = e.getStatusCode();
            if (status.value() == 404) {
                return Optional.empty();
            }
            throw e;
        }
    }
}
