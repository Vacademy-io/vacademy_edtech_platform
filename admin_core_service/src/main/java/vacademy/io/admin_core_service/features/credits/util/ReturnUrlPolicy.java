package vacademy.io.admin_core_service.features.credits.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.common.institute.entity.Institute;

import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * Allow-list for the browser return URL of a platform payment (F8): Razorpay redirects the
 * buyer to it after the hosted payment ({@code callback_url}), so it must not be an arbitrary
 * host supplied by the client.
 *
 * <p>Allowed: an {@code https} URL (plain {@code http} only for localhost) whose host is
 * <ul>
 *   <li>Vacademy-owned ({@link BrandModeService#isVacademyOwnedHost}: the base domain, any
 *       subdomain of it, localhost), or</li>
 *   <li>one of THIS institute's {@code institute_domain_routing} hosts (a {@code *} subdomain
 *       row allows the domain and any subdomain of it), or</li>
 *   <li>the host of this institute's own {@code admin_portal_base_url} /
 *       {@code learner_portal_base_url} / {@code teacher_portal_base_url}.</li>
 * </ul>
 * Anything else (another institute's domain, an unknown host, credentials in the URL,
 * javascript: and other schemes) is refused; a fragment is dropped; the caller then creates the link without a
 * callback, so the buyer still pays and lands on Razorpay's own confirmation page.
 */
@Slf4j
@Component
public class ReturnUrlPolicy {

    private final InstituteDomainRoutingRepository routingRepository;
    private final InstituteRepository instituteRepository;
    private final BrandModeService brandModeService;

    public ReturnUrlPolicy(InstituteDomainRoutingRepository routingRepository,
            InstituteRepository instituteRepository,
            BrandModeService brandModeService) {
        this.routingRepository = routingRepository;
        this.instituteRepository = instituteRepository;
        this.brandModeService = brandModeService;
    }

    /**
     * @return the URL (without any fragment) when allowed, else null (logged)
     */
    public String sanitize(String instituteId, String returnUrl) {
        if (!StringUtils.hasText(returnUrl)) {
            return null;
        }
        String url = returnUrl.trim();
        URI uri;
        try {
            uri = URI.create(url);
        } catch (Exception e) {
            log.warn("[return-url] unparseable return URL refused for institute {}", instituteId);
            return null;
        }
        String scheme = uri.getScheme() == null ? null : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = normalize(uri.getHost());
        if (host == null || uri.getRawUserInfo() != null) {
            log.warn("[return-url] malformed return URL refused for institute {}", instituteId);
            return null;
        }
        boolean local = "localhost".equals(host) || "127.0.0.1".equals(host);
        if (!"https".equals(scheme) && !("http".equals(scheme) && local)) {
            log.warn("[return-url] non-https return URL refused for institute {} (host {})", instituteId, host);
            return null;
        }
        if (isAllowedHost(instituteId, host)) {
            // Drop a fragment: the caller appends query parameters, which must not land after '#'.
            int hash = url.indexOf('#');
            return hash >= 0 ? url.substring(0, hash) : url;
        }
        log.warn("[return-url] host {} is not allowed for institute {}; link created without a callback",
                host, instituteId);
        return null;
    }

    boolean isAllowedHost(String instituteId, String host) {
        if (brandModeService.isVacademyOwnedHost(host)) {
            return true;
        }
        if (!StringUtils.hasText(instituteId)) {
            return false;
        }
        try {
            List<InstituteDomainRouting> rows = routingRepository.findByInstituteId(instituteId);
            if (rows != null) {
                for (InstituteDomainRouting r : rows) {
                    if (matchesRouting(r, host)) {
                        return true;
                    }
                }
            }
            Institute inst = instituteRepository.findById(instituteId).orElse(null);
            if (inst != null) {
                for (String base : new String[] {inst.getAdminPortalBaseUrl(), inst.getLearnerPortalBaseUrl(),
                        inst.getTeacherPortalBaseUrl()}) {
                    if (host.equals(hostOfUrl(base))) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[return-url] could not read domains for institute {}: {}", instituteId, e.getMessage());
        }
        return false;
    }

    static boolean matchesRouting(InstituteDomainRouting r, String host) {
        if (r == null) return false;
        String domain = normalize(r.getDomain());
        if (domain == null) return false;
        String sub = r.getSubdomain() == null ? "" : r.getSubdomain().trim().toLowerCase(Locale.ROOT);
        if ("*".equals(sub)) {
            return host.equals(domain) || host.endsWith("." + domain);
        }
        if (sub.isEmpty() || "@".equals(sub)) {
            return host.equals(domain);
        }
        return host.equals(sub + "." + domain);
    }

    static String hostOfUrl(String url) {
        if (!StringUtils.hasText(url)) return null;
        String u = url.trim();
        if (!u.contains("://")) u = "https://" + u;
        try {
            return normalize(URI.create(u).getHost());
        } catch (Exception e) {
            return null;
        }
    }

    static String normalize(String host) {
        if (!StringUtils.hasText(host)) return null;
        String h = host.trim().toLowerCase(Locale.ROOT);
        while (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        return h.isEmpty() ? null : h;
    }
}
