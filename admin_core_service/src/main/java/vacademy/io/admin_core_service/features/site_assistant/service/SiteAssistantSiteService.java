package vacademy.io.admin_core_service.features.site_assistant.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.catalog_api.website.InstituteWebsiteService;
import vacademy.io.admin_core_service.features.catalog_api.website.WebsiteHosts;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingResolveResponse;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.service.DomainRoutingService;

import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Where a Site Assistant visitor is (SPEC 3.2): which institute and catalogue site a hosted-site
 * host serves, and whether an embed's origin is one of the institute's verified websites. Both
 * answers come from the server's own data, never from the browser.
 */
@Service
@RequiredArgsConstructor
public class SiteAssistantSiteService {

    private static final Pattern TAG = Pattern.compile("^[A-Za-z0-9_\\-]{1,255}$");

    private final DomainRoutingService domainRoutingService;
    private final CatalogSiteResolver catalogSiteResolver;
    private final InstituteWebsiteService websiteService;

    public record ResolvedSite(String instituteId, String siteTag) {
    }

    /** Host and subdomain the way the learner site splits them (functions/_middleware.ts parseDomainParts). */
    record DomainParts(String domain, String subdomain) {
    }

    /**
     * The institute and site behind a hosted-site host, resolved exactly as the hosted site does:
     * the host split into subdomain + domain ({@code learning.brahmvarchas.org} → learning +
     * brahmvarchas.org; a two-label host is an apex, stored with the wildcard subdomain), the
     * public domain-routing resolve (which also matches a wildcard row), then the row's site:
     * {@code root_catalogue_tag} ‖ the first segment of {@code redirect} when that catalogue exists
     * ({@link CatalogSiteResolver#rowSiteTag}). When {@code requestedTag} names a live catalogue of
     * that institute it wins: the hosted site serves every catalogue at /{tag} on the same host.
     * Empty when the host is not routed or no site can be named.
     */
    public Optional<ResolvedSite> resolveSite(String rawHost, String requestedTag) {
        String host = hostOf(rawHost);
        if (host == null || WebsiteHosts.isLocalDevHost(host) || host.startsWith("[")) return Optional.empty();
        DomainParts parts = split(host);
        Optional<DomainRoutingResolveResponse> routing = domainRoutingService.resolve(parts.domain(),
                parts.subdomain().isEmpty() ? "*" : parts.subdomain());
        if (routing.isEmpty() || !StringUtils.hasText(routing.get().getInstituteId())) return Optional.empty();
        String instituteId = routing.get().getInstituteId();

        if (StringUtils.hasText(requestedTag)) {
            String tag = requestedTag.trim();
            if (TAG.matcher(tag).matches() && catalogSiteResolver.catalogueExists(instituteId, tag)) {
                return Optional.of(new ResolvedSite(instituteId, tag));
            }
        }
        InstituteDomainRouting row = InstituteDomainRouting.builder()
                .instituteId(instituteId)
                .rootCatalogueTag(routing.get().getRootCatalogueTag())
                .redirect(routing.get().getRedirect())
                .build();
        String tag = catalogSiteResolver.rowSiteTag(instituteId, row);
        return tag == null ? Optional.empty() : Optional.of(new ResolvedSite(instituteId, tag));
    }

    /**
     * True when the host is localhost / 127.0.0.1 / [::1] (local development, as the Catalogue
     * API allows) or equals or is a subdomain of one of the institute's VERIFIED websites, on label
     * boundaries ({@code x.com} covers {@code www.x.com}, never {@code evilx.com}).
     */
    public boolean originAllowed(String instituteId, String rawHost) {
        String host = hostOf(rawHost);
        if (host == null || !StringUtils.hasText(instituteId)) return false;
        if (WebsiteHosts.isLocalDevHost(host)) return true;
        return WebsiteHosts.coveredByAny(websiteService.verifiedHosts(instituteId.trim()), host);
    }

    /**
     * A bare host ({@code www.x.com}, {@code x.com:3000}) or an origin/URL
     * ({@code https://www.x.com/path}), normalised like the Origin lock does; null when unusable.
     */
    static String hostOf(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String s = raw.trim();
        return WebsiteHosts.originHost(s.contains("://") ? s : "https://" + s);
    }

    static DomainParts split(String host) {
        String[] labels = host.split("\\.");
        if (labels.length >= 3) {
            return new DomainParts(host.substring(labels[0].length() + 1), labels[0]);
        }
        return new DomainParts(host, "");
    }
}
