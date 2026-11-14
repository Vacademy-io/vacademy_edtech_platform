package vacademy.io.admin_core_service.features.platform_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Decides, per institute, whether platform-billing surfaces (storefront, Razorpay checkout
 * display, invoices, credit notes, billing emails) may say "Vacademy" (owner decisions D1/D2).
 *
 * <ol>
 *   <li>A super-admin override in {@code ai_storefront_institute.brand_mode_override}
 *       (VACADEMY or NEUTRAL) wins.</li>
 *   <li>Otherwise the institute is {@link BrandMode#NEUTRAL} when it has an
 *       {@code institute_domain_routing} row serving the ADMIN role on a host that is not
 *       Vacademy-owned, or its {@code admin_portal_base_url} points at such a host.</li>
 *   <li>Otherwise {@link BrandMode#VACADEMY}.</li>
 * </ol>
 *
 * "Vacademy-owned" is the same rule the admin dashboard uses ({@code isVacademyOwnedDomain} in
 * {@code frontend-admin-dashboard/src/utils/subdomain.ts}) and {@code PortalUrlReconciler}:
 * the base domain ({@code vacademy.base.domain}, default {@code vacademy.io}) or any subdomain of
 * it, plus localhost for local development.
 *
 * <p>Fail-safe: any lookup error resolves to NEUTRAL, the answer that can never leak the brand.
 * Results are cached for five minutes per institute; {@link #invalidate} drops one entry.
 */
@Slf4j
@Service
public class BrandModeService {

    static final long TTL_MILLIS = 5 * 60_000L;
    static final String ROLE_ADMIN = "ADMIN";

    static final String SELECT_OVERRIDE =
            "SELECT brand_mode_override FROM ai_storefront_institute WHERE institute_id = ?";
    static final String SELECT_ADMIN_BASE_URL =
            "SELECT admin_portal_base_url FROM institutes WHERE id = ?";

    private final InstituteDomainRoutingRepository routingRepository;
    private final JdbcTemplate jdbcTemplate;
    private final String vacademyBaseDomain;

    private record Cached(BrandMode mode, long expiresAt) {}

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public BrandModeService(
            InstituteDomainRoutingRepository routingRepository,
            JdbcTemplate jdbcTemplate,
            @Value("${vacademy.base.domain:vacademy.io}") String vacademyBaseDomain) {
        this.routingRepository = routingRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.vacademyBaseDomain = StringUtils.hasText(vacademyBaseDomain)
                ? vacademyBaseDomain.trim().toLowerCase(Locale.ROOT) : "vacademy.io";
    }

    /** Brand mode for an institute; NEUTRAL for a null id. */
    public BrandMode resolve(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return BrandMode.NEUTRAL;
        }
        long now = System.currentTimeMillis();
        Cached hit = cache.get(instituteId);
        if (hit != null && hit.expiresAt() > now) {
            return hit.mode();
        }
        BrandMode mode = compute(instituteId);
        cache.put(instituteId, new Cached(mode, now + TTL_MILLIS));
        return mode;
    }

    /**
     * Brand mode for a document: the value frozen on the payment when present (V590
     * {@code platform_payment.brand_mode}), else the institute's current mode.
     */
    public BrandMode resolve(String instituteId, String snapshot) {
        BrandMode frozen = BrandMode.parse(snapshot);
        return frozen != null ? frozen : resolve(instituteId);
    }

    public boolean isNeutral(String instituteId) {
        return resolve(instituteId) == BrandMode.NEUTRAL;
    }

    public void invalidate(String instituteId) {
        if (instituteId != null) {
            cache.remove(instituteId);
        }
    }

    public void invalidateAll() {
        cache.clear();
    }

    BrandMode compute(String instituteId) {
        try {
            BrandMode override = readOverride(instituteId);
            if (override != null) {
                return override;
            }
            List<InstituteDomainRouting> rows = routingRepository.findByInstituteId(instituteId);
            if (rows != null) {
                for (InstituteDomainRouting r : rows) {
                    if (!servesAdmin(r)) {
                        continue;
                    }
                    String host = hostOf(r);
                    if (host != null && !isVacademyOwnedHost(host)) {
                        return BrandMode.NEUTRAL;
                    }
                }
            }
            String adminBase = readAdminBaseUrl(instituteId);
            String adminHost = hostOfUrl(adminBase);
            if (adminHost != null && !isVacademyOwnedHost(adminHost)) {
                return BrandMode.NEUTRAL;
            }
            return BrandMode.VACADEMY;
        } catch (Exception e) {
            log.warn("[brand-mode] could not resolve institute {} ({}); using NEUTRAL", instituteId, e.getMessage());
            return BrandMode.NEUTRAL;
        }
    }

    /** {@code null} when there is no override row, the value is blank, or the table is not there yet. */
    private BrandMode readOverride(String instituteId) {
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_OVERRIDE, String.class, instituteId);
            return rows.isEmpty() ? null : BrandMode.parse(rows.get(0));
        } catch (Exception e) {
            log.debug("[brand-mode] no override for {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private String readAdminBaseUrl(String instituteId) {
        List<String> rows = jdbcTemplate.queryForList(SELECT_ADMIN_BASE_URL, String.class, instituteId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** The base domain, any subdomain of it, and localhost / 127.0.0.1. */
    public boolean isVacademyOwnedHost(String host) {
        String h = normalizeHost(host);
        if (h == null) {
            return false;
        }
        if ("localhost".equals(h) || "127.0.0.1".equals(h)) {
            return true;
        }
        return h.equals(vacademyBaseDomain) || h.endsWith("." + vacademyBaseDomain);
    }

    /**
     * The admin host for links in a billing email: the institute's {@code admin_portal_base_url}
     * when it is set. For NEUTRAL institutes a Vacademy-owned host is never returned (the caller
     * leaves the link out instead).
     */
    public String adminLinkBase(String adminPortalBaseUrl, BrandMode mode) {
        String host = hostOfUrl(adminPortalBaseUrl);
        if (host == null) {
            return null;
        }
        if (mode == BrandMode.NEUTRAL && isVacademyOwnedHost(host)) {
            return null;
        }
        String url = adminPortalBaseUrl.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    static boolean servesAdmin(InstituteDomainRouting r) {
        if (r == null || !StringUtils.hasText(r.getRole())) {
            return false;
        }
        for (String token : r.getRole().split(",")) {
            if (ROLE_ADMIN.equalsIgnoreCase(token.trim())) {
                return true;
            }
        }
        return false;
    }

    static String hostOf(InstituteDomainRouting r) {
        if (r == null || !StringUtils.hasText(r.getDomain())) {
            return null;
        }
        String domain = normalizeHost(r.getDomain());
        String sub = r.getSubdomain();
        if (domain == null) {
            return null;
        }
        if (!StringUtils.hasText(sub) || "*".equals(sub.trim())) {
            return domain;
        }
        return sub.trim().toLowerCase(Locale.ROOT) + "." + domain;
    }

    static String hostOfUrl(String url) {
        if (!StringUtils.hasText(url)) {
            return null;
        }
        String u = url.trim();
        if (!u.contains("://")) {
            u = "https://" + u;
        }
        try {
            return normalizeHost(URI.create(u).getHost());
        } catch (Exception e) {
            return null;
        }
    }

    static String normalizeHost(String host) {
        if (!StringUtils.hasText(host)) {
            return null;
        }
        String h = host.trim().toLowerCase(Locale.ROOT);
        while (h.endsWith(".")) {
            h = h.substring(0, h.length() - 1);
        }
        return h.isEmpty() ? null : h;
    }
}
