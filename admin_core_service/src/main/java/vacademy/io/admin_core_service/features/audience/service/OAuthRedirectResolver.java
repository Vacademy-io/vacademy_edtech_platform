package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * Resolves the frontend base URL that a Meta OAuth callback should redirect the
 * browser back to.
 *
 * Why this exists: clients on white-label custom domains (e.g.
 * https://crm.someclient.com) start OAuth from their own domain. The callback used
 * to always redirect to a single hardcoded host (dash.vacademy.io); landing there
 * loses the client's per-origin session (JWT lives in that origin's storage), so
 * the returned session_key was useless and the connect flow could never complete.
 *
 * We now send the browser back to the SAME origin it came from — but because the
 * callback endpoint is public (Meta calls it with no JWT), we must validate the
 * origin against a trusted allowlist to avoid turning it into an open redirect:
 *   1. any host registered for THIS institute in institute_domain_routing, and
 *   2. any host under a configured trusted suffix (default ".vacademy.io"), and
 *   3. the host of the configured default callback URL.
 * Anything else falls back to the configured default — so the worst case is the
 * pre-existing behaviour (redirect to dash.vacademy.io), never an open redirect.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OAuthRedirectResolver {

    private final InstituteDomainRoutingRepository domainRoutingRepository;

    @Value("${meta.oauth.frontend.callback.url:}")
    private String defaultCallbackUrl;

    /** Comma-separated host suffixes always allowed (e.g. ".vacademy.io"). */
    @Value("${meta.oauth.allowed.frontend.origin.suffixes:.vacademy.io}")
    private String allowedSuffixesCsv;

    /**
     * Normalize a raw origin/URL to "scheme://host[:port]" (lowercase host), or
     * null if it isn't a usable http(s) origin. Accepts a bare origin
     * ("https://crm.x.com") or a full URL and keeps only the origin part.
     */
    public String normalizeOrigin(String rawOrigin) {
        if (rawOrigin == null || rawOrigin.isBlank()) return null;
        try {
            URI uri = URI.create(rawOrigin.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return null;
            scheme = scheme.toLowerCase();
            if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
            String origin = scheme + "://" + host.toLowerCase();
            if (uri.getPort() != -1) origin += ":" + uri.getPort();
            return origin;
        } catch (Exception e) {
            log.warn("Unparseable OAuth frontend origin '{}': {}", rawOrigin, e.getMessage());
            return null;
        }
    }

    /**
     * Returns the base URL (scheme+host+path+query, NO session_key) the callback
     * should redirect to. Uses {@code requestedOrigin} when it is allowlisted for
     * {@code instituteId}, else the configured default callback URL.
     */
    public String resolveRedirectBase(String instituteId, String requestedOrigin) {
        String origin = normalizeOrigin(requestedOrigin);
        if (origin == null) {
            return defaultCallbackUrl;
        }
        if (!isOriginAllowed(instituteId, origin)) {
            log.warn("Meta OAuth return origin '{}' not allowlisted for institute {} — "
                    + "falling back to default callback URL", origin, instituteId);
            return defaultCallbackUrl;
        }
        // Preserve the exact landing path+query from the configured default
        // (e.g. "/settings?selectedTab=integrations") but swap in the client's origin.
        String pathAndQuery = pathAndQueryOf(defaultCallbackUrl);
        return origin + pathAndQuery;
    }

    /**
     * True when {@code origin} (normalized first) is on the same allowlist
     * {@link #resolveRedirectBase} uses for {@code instituteId}. Lets other OAuth
     * callbacks (e.g. marketing) send the browser back to a white-label origin
     * without reusing the Meta default landing path.
     */
    public boolean isAllowedOrigin(String instituteId, String origin) {
        String normalized = normalizeOrigin(origin);
        return normalized != null && isOriginAllowed(instituteId, normalized);
    }

    private boolean isOriginAllowed(String instituteId, String origin) {
        String host = hostOf(origin);
        if (host == null) return false;

        // 1. Trusted suffixes (e.g. ".vacademy.io") — covers dash/stage/all subdomains.
        for (String suffix : allowedSuffixesCsv.split(",")) {
            String s = suffix.trim().toLowerCase();
            if (!s.isEmpty() && (host.equals(stripLeadingDot(s)) || host.endsWith(s))) {
                return true;
            }
        }

        // 2. Host of the configured default callback URL.
        String defaultHost = hostOf(defaultCallbackUrl);
        if (defaultHost != null && defaultHost.equals(host)) return true;

        // 3. Any host registered for this institute (white-label custom domains).
        if (instituteId != null && !instituteId.isBlank()) {
            try {
                for (String registered : registeredHostsFor(instituteId)) {
                    if (registered.equals(host)) return true;
                }
            } catch (Exception e) {
                log.warn("Failed to load registered hosts for institute {}: {}",
                        instituteId, e.getMessage());
            }
        }
        return false;
    }

    /** Hosts registered for an institute: "sub.domain" (or "domain" when subdomain='*'). */
    private List<String> registeredHostsFor(String instituteId) {
        List<String> hosts = new ArrayList<>();
        for (InstituteDomainRouting r : domainRoutingRepository.findByInstituteId(instituteId)) {
            String domain = r.getDomain() == null ? null : r.getDomain().trim().toLowerCase();
            String subdomain = r.getSubdomain() == null ? null : r.getSubdomain().trim().toLowerCase();
            if (domain == null || domain.isEmpty()) continue;
            if (subdomain == null || subdomain.isEmpty() || "*".equals(subdomain)) {
                hosts.add(domain);
            } else {
                hosts.add(subdomain + "." + domain);
            }
        }
        return hosts;
    }

    private String hostOf(String url) {
        if (url == null || url.isBlank()) return null;
        try {
            String host = URI.create(url.trim()).getHost();
            return host == null ? null : host.toLowerCase();
        } catch (Exception e) {
            return null;
        }
    }

    private String pathAndQueryOf(String url) {
        if (url == null || url.isBlank()) return "/settings?selectedTab=integrations";
        try {
            URI uri = URI.create(url.trim());
            String path = uri.getRawPath();
            if (path == null || path.isEmpty()) path = "/settings";
            String query = uri.getRawQuery();
            return query == null ? path : path + "?" + query;
        } catch (Exception e) {
            return "/settings?selectedTab=integrations";
        }
    }

    private String stripLeadingDot(String s) {
        return s.startsWith(".") ? s.substring(1) : s;
    }
}
