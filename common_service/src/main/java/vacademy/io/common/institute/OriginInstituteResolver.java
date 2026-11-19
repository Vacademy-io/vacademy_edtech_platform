package vacademy.io.common.institute;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.http.client.SimpleClientHttpRequestFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Last-resort resolution of "which institute is this request for?" from the browser's
 * {@code Origin} (or {@code Referer}) host, for endpoints where the caller was SUPPOSED to
 * pass an institute id and didn't.
 *
 * <p><b>Why this exists.</b> Every white-labelled email — OTP above all — picks its sender
 * address and its branding from the institute id the caller supplies. When that id arrives
 * null the send silently degrades to the platform default: a Shiksha Nation admin asking for
 * a login OTP on {@code admin.shikshanation.com} received a Vacademy-branded mail from
 * {@code support@vacademy.io}, because the admin login form posted only
 * {@code {email, client_name}}. The frontends have been fixed, but "a new caller forgets the
 * field" is a bug class, not a one-off, and the cost of it is a white-label leak in the most
 * visible mail the platform sends. The host the request came from already identifies the
 * institute — {@code institute_domain_routing} maps {@code admin.shikshanation.com} to it —
 * so we can recover from the omission instead of shipping the wrong branding.
 *
 * <p><b>This is a fallback, never the primary path.</b> Callers must still pass the institute
 * id explicitly: it is the only thing that works for native apps, server-to-server calls, and
 * any request without an Origin.
 *
 * <p><b>Fail-open by construction.</b> This sits on the login path, so it must never be able
 * to fail a request. Every failure mode — no Origin, unparseable host, admin-core down or slow,
 * unmapped domain, unconfigured base URL — returns {@code null}, which reproduces exactly the
 * behaviour that existed before this class. Its own {@link RestTemplate} carries deliberately
 * short timeouts rather than reusing the shared 30s-read one, so a degraded admin-core costs a
 * bounded delay and not a hung OTP request; results (including misses) are cached so a steady
 * login load does not amplify into admin-core traffic.
 */
@Component
public class OriginInstituteResolver {

    private static final Logger log = LoggerFactory.getLogger(OriginInstituteResolver.class);

    private static final String RESOLVE_PATH = "/admin-core-service/public/domain-routing/v1/resolve";
    private static final long CACHE_TTL_MS = 10 * 60 * 1000L;
    private static final int MAX_CACHE_ENTRIES = 5_000;
    /** Cached stand-in for "this host maps to no institute" — {@link ConcurrentHashMap} forbids null values. */
    private static final String NO_MATCH = "";

    /**
     * Accepts either spelling of the admin-core base URL property: auth_service declares
     * {@code admin.core.service.base_url}, notification_service {@code admin.core.service.baseurl}.
     * Defaulting to empty (feature off) matters more than it looks — the property is absent from
     * some profiles, and a bean that cannot start would take the whole service down to add a
     * fallback whose entire purpose is to be optional.
     */
    @Value("${admin.core.service.baseurl:${admin.core.service.base_url:${ADMIN_CORE_SERVICE_BASE_URL:}}}")
    private String adminCoreBaseUrl;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private final RestTemplate restTemplate = shortTimeoutRestTemplate();

    private static RestTemplate shortTimeoutRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(2000);
        return new RestTemplate(factory);
    }

    private record CacheEntry(String instituteId, long expiresAt) {
        boolean isFresh(long now) {
            return now < expiresAt;
        }
    }

    /**
     * Resolve the institute for the request currently being served, or null.
     *
     * <p>Reads the request from {@link RequestContextHolder} rather than taking it as a parameter
     * so callers deep in a manager can use it without threading {@code HttpServletRequest} through
     * controller and service signatures that have no other use for it.
     */
    public String resolveInstituteId() {
        try {
            var attributes = RequestContextHolder.getRequestAttributes();
            if (!(attributes instanceof ServletRequestAttributes servletAttributes)) {
                return null;
            }
            return resolveInstituteId(servletAttributes.getRequest());
        } catch (Exception e) {
            log.debug("Origin-based institute resolution skipped: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Pick which of a user's institutes a message should be sent as.
     *
     * <p>Credential, welcome and invitation mails resolve their institute from the recipient's
     * roles, and the long-standing shortcut for that was {@code roles.iterator().next()} — an
     * arbitrary element of an unordered set. For the ~1.2% of users who belong to more than one
     * institute that can mail a learner their password from a DIFFERENT client's address, which is
     * a worse outcome than the platform default: it puts one institute's branding on another's
     * correspondence.
     *
     * <p>When the user has exactly one institute (the overwhelming majority) this returns it
     * without any lookup, so the common path costs nothing. With several, the institute whose
     * portal the request actually came from wins; failing that we keep the historical first-element
     * behaviour rather than sending nothing.
     *
     * @param candidateInstituteIds the institutes the user belongs to; nulls and blanks ignored
     * @return the chosen institute id, or null when there are no candidates
     */
    public String chooseInstituteIdFor(Collection<String> candidateInstituteIds) {
        if (candidateInstituteIds == null || candidateInstituteIds.isEmpty()) {
            return null;
        }
        List<String> candidates = candidateInstituteIds.stream()
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (candidates.isEmpty()) {
            return null;
        }
        if (candidates.size() == 1) {
            return candidates.get(0);
        }
        String fromHost = resolveInstituteId();
        if (StringUtils.hasText(fromHost) && candidates.contains(fromHost)) {
            return fromHost;
        }
        // Ambiguous and the host did not disambiguate — a wrong-but-plausible sender still beats
        // failing the send, which is what returning null would cause upstream.
        log.info("User belongs to {} institutes and the request host resolved none of them; "
                + "falling back to {}", candidates.size(), candidates.get(0));
        return candidates.get(0);
    }

    /** Resolve the institute for an explicit request, or null. */
    public String resolveInstituteId(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String host = extractHost(request.getHeader("Origin"));
        if (host == null) {
            // Origin is absent on same-origin and non-CORS requests; Referer carries the same host.
            host = extractHost(request.getHeader("Referer"));
        }
        return resolveInstituteIdFromHost(host);
    }

    /**
     * Resolve a bare hostname (e.g. {@code admin.shikshanation.com}) to an institute id, or null.
     */
    public String resolveInstituteIdFromHost(String host) {
        if (!StringUtils.hasText(host) || !StringUtils.hasText(adminCoreBaseUrl)) {
            return null;
        }
        String normalizedHost = host.trim().toLowerCase();

        CacheEntry cached = cache.get(normalizedHost);
        long now = System.currentTimeMillis();
        if (cached != null && cached.isFresh(now)) {
            return NO_MATCH.equals(cached.instituteId()) ? null : cached.instituteId();
        }

        String instituteId = lookup(normalizedHost);
        put(normalizedHost, instituteId == null ? NO_MATCH : instituteId, now);
        return instituteId;
    }

    private String lookup(String host) {
        String[] domainAndSubdomain = splitHost(host);
        if (domainAndSubdomain == null) {
            return null;
        }
        try {
            String url = adminCoreBaseUrl + RESOLVE_PATH
                    + "?domain=" + domainAndSubdomain[0]
                    + "&subdomain=" + domainAndSubdomain[1];
            ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
            if (response.getBody() == null || response.getBody().isBlank()) {
                return null;
            }
            JsonNode node = objectMapper.readTree(response.getBody());
            String instituteId = node.path("instituteId").asText(null);
            if (!StringUtils.hasText(instituteId)) {
                return null;
            }
            log.info("Resolved institute {} from request host {} (caller omitted the institute id)",
                    instituteId, host);
            return instituteId;
        } catch (Exception e) {
            // Includes the 404 that admin-core returns for an unmapped host — an expected outcome,
            // not an error, so this stays at debug and the caller simply keeps the platform default.
            log.debug("No institute resolved for host {}: {}", host, e.getMessage());
            return null;
        }
    }

    private void put(String host, String instituteId, long now) {
        // Unbounded growth would turn a stream of junk Origins into a memory leak. The map is a
        // cache, so dropping all of it is always safe — cheaper than tracking an eviction order
        // for something that holds a handful of hosts in practice.
        if (cache.size() >= MAX_CACHE_ENTRIES) {
            cache.clear();
        }
        cache.put(host, new CacheEntry(instituteId, now + CACHE_TTL_MS));
    }

    /**
     * Split a hostname into the {@code {domain, subdomain}} pair that
     * {@code institute_domain_routing} is keyed by: the first label is the subdomain and the
     * remainder is the domain, so {@code admin.shikshanation.com} becomes
     * {@code {shikshanation.com, admin}} and {@code shiksha-nation.vacademy.io} becomes
     * {@code {vacademy.io, shiksha-nation}}. Mirrors {@code getSubdomain()} in the frontends,
     * including its {@code www} skip. Returns null when there is no subdomain to speak of, since
     * a bare apex maps to no portal row.
     */
    static String[] splitHost(String host) {
        String[] parts = host.split("\\.");
        if (parts.length < 3) {
            return null;
        }
        int subdomainIndex = "www".equals(parts[0]) ? 1 : 0;
        if (parts.length - subdomainIndex < 3) {
            return null;
        }
        String subdomain = parts[subdomainIndex];
        String domain = String.join(".", java.util.Arrays.copyOfRange(parts, subdomainIndex + 1, parts.length));
        if (!StringUtils.hasText(subdomain) || !StringUtils.hasText(domain)) {
            return null;
        }
        return new String[] { domain, subdomain };
    }

    /** Pull the bare hostname out of an Origin/Referer header value. */
    private static String extractHost(String headerValue) {
        if (!StringUtils.hasText(headerValue)) {
            return null;
        }
        try {
            String host = URI.create(headerValue.trim()).getHost();
            return StringUtils.hasText(host) ? host : null;
        } catch (Exception e) {
            return null;
        }
    }
}
