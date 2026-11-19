package vacademy.io.auth_service.core.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;

/**
 * Which URLs a social login may return to. Allowed: https on a platform domain, on the admin
 * portal's host, or on a host in institute_domain_routing (the same lookup portals use for their
 * branding). Loopback may use http for local runs.
 *
 * <p>A host admin-core cannot answer for is refused unless it was known a moment ago, so a brief
 * admin-core outage does not stop logins on portals already seen.
 */
@Component
public class OAuthReturnUrlPolicy {

    private static final Logger log = LoggerFactory.getLogger(OAuthReturnUrlPolicy.class);

    private static final String RESOLVE_PATH = "/admin-core-service/public/domain-routing/v1/resolve";
    private static final String ANY_SUBDOMAIN = "*";
    private static final long KNOWN_TTL_MS = 10 * 60 * 1000L;
    private static final long UNKNOWN_TTL_MS = 60 * 1000L;
    private static final int MAX_CACHE_ENTRIES = 5_000;

    private record CachedHost(boolean known, long expiresAt) {
    }

    private final Map<String, CachedHost> cache = new ConcurrentHashMap<>();
    private final RestTemplate restTemplate = shortTimeoutRestTemplate();
    private final String adminCoreBaseUrl;
    private final String adminPortalHost;
    private final List<String> platformDomains;

    @Autowired
    public OAuthReturnUrlPolicy(
            @Value("${admin.core.service.base_url:}") String adminCoreBaseUrl,
            @Value("${teacher.portal.client.url:https://dash.vacademy.io}") String adminPortalUrl,
            @Value("${auth.oauth.platform-return-domains:vacademy.io,vimotion.ai}") String platformDomains) {
        this.adminCoreBaseUrl = adminCoreBaseUrl;
        this.adminPortalHost = hostOf(adminPortalUrl);
        this.platformDomains = Arrays.stream(platformDomains.split(","))
                .map(d -> d.trim().toLowerCase(Locale.ROOT))
                .filter(StringUtils::hasText)
                .toList();
    }

    private static RestTemplate shortTimeoutRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(2000);
        return new RestTemplate(factory);
    }

    /** @param alsoAllowed hosts the caller trusts for this login, such as a product's return hosts */
    public boolean isAllowed(String url, Predicate<String> alsoAllowed) {
        URI uri = parse(url);
        if (uri == null) {
            log.warn("Refused a login return URL that is not a plain web address");
            return false;
        }
        String host = normalize(uri.getHost());
        if (isLoopback(host)) {
            return true;
        }
        boolean allowed = "https".equalsIgnoreCase(uri.getScheme())
                && (host.equals(adminPortalHost)
                        || platformDomains.stream().anyMatch(d -> host.equals(d) || host.endsWith("." + d))
                        || alsoAllowed.test(host)
                        || isRoutedHost(host));
        if (!allowed) {
            log.warn("Refused the login return host {} ({})", host, uri.getScheme());
        }
        return allowed;
    }

    /** Null for anything that is not a plain http(s) URL with a host and no embedded credentials. */
    private static URI parse(String url) {
        if (!StringUtils.hasText(url)) {
            return null;
        }
        try {
            URI uri = URI.create(url.trim());
            String scheme = uri.getScheme();
            boolean web = "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);
            return web && StringUtils.hasText(uri.getHost()) && uri.getRawUserInfo() == null ? uri : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String hostOf(String url) {
        URI uri = parse(url);
        return uri == null ? null : normalize(uri.getHost());
    }

    private static String normalize(String host) {
        String h = host.trim().toLowerCase(Locale.ROOT);
        while (h.endsWith(".")) {
            h = h.substring(0, h.length() - 1);
        }
        return h;
    }

    private static boolean isLoopback(String host) {
        return "localhost".equals(host) || "127.0.0.1".equals(host);
    }

    private boolean isRoutedHost(String host) {
        long now = System.currentTimeMillis();
        CachedHost cached = cache.get(host);
        if (cached != null && cached.expiresAt() > now) {
            return cached.known();
        }
        try {
            boolean known = lookup(host);
            if (cache.size() >= MAX_CACHE_ENTRIES) {
                cache.clear();
            }
            cache.put(host, new CachedHost(known, now + (known ? KNOWN_TTL_MS : UNKNOWN_TTL_MS)));
            return known;
        } catch (Exception e) {
            log.warn("Could not check the login return host {}: {}", host, e.getMessage());
            return cached != null && cached.known();
        }
    }

    /** First label as the subdomain, and for a bare domain its wildcard row, as the portals resolve it. */
    private boolean lookup(String host) {
        int firstDot = host.indexOf('.');
        if (firstDot < 0) {
            return false;
        }
        String rest = host.substring(firstDot + 1);
        if (rest.contains(".") && rowExists(rest, host.substring(0, firstDot))) {
            return true;
        }
        return rowExists(host, ANY_SUBDOMAIN);
    }

    /** Throws when admin-core gives no clear answer, so that is never read as "unknown host". */
    boolean rowExists(String domain, String subdomain) {
        if (!StringUtils.hasText(adminCoreBaseUrl)) {
            throw new IllegalStateException("admin.core.service.base_url is not set");
        }
        URI uri = UriComponentsBuilder.fromUriString(adminCoreBaseUrl + RESOLVE_PATH)
                .queryParam("domain", domain)
                .queryParam("subdomain", subdomain)
                .encode()
                .build()
                .toUri();
        try {
            return restTemplate.getForEntity(uri, String.class).getStatusCode().is2xxSuccessful();
        } catch (HttpClientErrorException.NotFound e) {
            return false;
        }
    }
}
