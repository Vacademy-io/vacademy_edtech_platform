package vacademy.io.auth_service.feature.selfsignup.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.notification.service.ProductWelcomeEmailBody;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * The links a product's welcome mail lists (its video tutorials), from the product settings in
 * admin-core ({@code welcome_links}). Read here rather than through the shared product config so no
 * common release is needed. Cached for a minute; any failure means no list, never a failed mail.
 */
@Slf4j
@Component
public class ProductWelcomeLinksClient {

    private static final long TTL_MILLIS = 60_000L;
    private static final Pattern KEY = Pattern.compile("^[a-z0-9_-]{1,32}$");
    private static final int MAX_LINKS = 12;

    private record Cached(List<ProductWelcomeEmailBody.Link> links, long expiresAt) {
    }

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();

    @Autowired
    private InternalClientUtils internalClientUtils;

    // Defaults, so this client adds nothing auth-service needs to start; unset = no links.
    @Value("${spring.application.name:}")
    private String clientName;

    @Value("${admin.core.service.base_url:}")
    private String adminCoreBaseUrl;

    public List<ProductWelcomeEmailBody.Link> get(String product) {
        if (product == null) {
            return List.of();
        }
        String key = product.trim().toLowerCase(Locale.ROOT);
        if (!KEY.matcher(key).matches()) {
            return List.of();
        }
        if (adminCoreBaseUrl == null || adminCoreBaseUrl.isBlank() || internalClientUtils == null) {
            return List.of();
        }
        long now = System.currentTimeMillis();
        Cached cached = cache.get(key);
        if (cached != null && cached.expiresAt() > now) {
            return cached.links();
        }
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(),
                    adminCoreBaseUrl, "/admin-core-service/internal/product-config/v1/" + key, null);
            List<ProductWelcomeEmailBody.Link> links = parse(response.getBody());
            cache.put(key, new Cached(links, now + TTL_MILLIS));
            return links;
        } catch (Exception e) {
            log.warn("Could not read the welcome links of product {}: {}", key, e.getMessage());
            return cached != null ? cached.links() : List.of();
        }
    }

    /** Only complete https links are kept; anything else in the settings is skipped. */
    List<ProductWelcomeEmailBody.Link> parse(String body) throws Exception {
        if (body == null || body.isBlank()) {
            return List.of();
        }
        JsonNode links = mapper.readTree(body).path("welcome_links");
        if (!links.isArray()) {
            return List.of();
        }
        List<ProductWelcomeEmailBody.Link> out = new ArrayList<>();
        for (JsonNode link : links) {
            String title = link.path("title").asText("").trim();
            String url = link.path("url").asText("").trim();
            String subtitle = link.path("subtitle").isTextual() ? link.path("subtitle").asText().trim() : null;
            if (!title.isEmpty() && url.startsWith("https://") && out.size() < MAX_LINKS) {
                out.add(new ProductWelcomeEmailBody.Link(title, url, subtitle == null || subtitle.isEmpty() ? null : subtitle));
            }
        }
        return List.copyOf(out);
    }
}
