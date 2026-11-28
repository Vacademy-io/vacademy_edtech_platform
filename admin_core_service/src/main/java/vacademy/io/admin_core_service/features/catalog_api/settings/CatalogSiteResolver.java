package vacademy.io.admin_core_service.features.catalog_api.settings;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.course_catalogue.enums.CatalogueStatusEnum;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.domain_routing.service.LearnerPortalUrlResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Which catalogue site drives an institute's public catalogue API, and where its course pages
 * live on the hosted learner site.
 *
 * <p><b>Site tag</b>: {@code institute_catalog_api_settings.site_tag} ‖ the LEARNER routing row's
 * {@code root_catalogue_tag} ‖ the first segment of its {@code redirect} when a catalogue with
 * that tag exists ‖ the institute's default catalogue ‖ null. The routing row comes before the
 * default catalogue because it is what the learner domain actually serves: the learner app never
 * reads {@code is_default}, and the admin's Manage Pages creates catalogues with it false.
 *
 * <p><b>Course base URL</b>: {@code settings.course_base_url} ‖ {@code https://<subdomain>.<domain>}
 * of the best LEARNER routing row (one whose root/redirect names the site tag, then not an
 * {@code admin*} host, then {@code is_primary}, then a concrete subdomain over {@code *}) +
 * {@code ""} when the row's root catalogue IS the site, else {@code /<site tag>} ‖
 * {@link LearnerPortalUrlResolver} (institutes.learner_portal_base_url → default portal) +
 * {@code /<site tag>}. Brahm Varchas: learning.brahmvarchas.org, redirect /store, no root tag →
 * {@code https://learning.brahmvarchas.org/store}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CatalogSiteResolver {

    public static final String SOURCE_SETTINGS = "settings";
    public static final String SOURCE_DOMAIN_ROUTING = "domain_routing";
    public static final String SOURCE_DEFAULT_CATALOGUE = "default_catalogue";
    public static final String SOURCE_LEARNER_PORTAL = "learner_portal";

    private static final String LEARNER = "LEARNER";
    private static final List<String> LIVE_STATUSES =
            List.of(CatalogueStatusEnum.ACTIVE.name(), CatalogueStatusEnum.DRAFT.name());

    private final InstituteCatalogApiSettingsRepository settingsRepository;
    private final InstituteDomainRoutingRepository domainRoutingRepository;
    private final CatalogueInstituteMappingRepository catalogueMappingRepository;
    private final InstituteRepository instituteRepository;
    private final LearnerPortalUrlResolver learnerPortalUrlResolver;

    /**
     * siteTagSource: settings | domain_routing | default_catalogue | null;
     * source (of the URL): settings | domain_routing | learner_portal.
     */
    public record Resolution(String siteTag, String siteTagSource, String courseBaseUrl, String source) {
    }

    public Resolution resolve(String instituteId) {
        InstituteCatalogApiSettings settings = settingsRepository.findById(instituteId).orElse(null);
        List<InstituteDomainRouting> rows;
        try {
            rows = domainRoutingRepository.findByInstituteId(instituteId);
        } catch (Exception e) {
            log.warn("catalog-api: domain routing read failed for {}: {}", instituteId, e.getMessage());
            rows = List.of();
        }
        return resolve(settings, rows,
                tag -> catalogueExists(instituteId, tag),
                () -> defaultCatalogueTag(instituteId),
                () -> {
                    Institute institute = instituteRepository.findById(instituteId).orElse(null);
                    return learnerPortalUrlResolver.resolveBaseUrl(instituteId, institute);
                });
    }

    public boolean catalogueExists(String instituteId, String tag) {
        if (tag == null || tag.isBlank()) return false;
        try {
            return catalogueMappingRepository.findByInstituteIdAndTagName(instituteId, tag, LIVE_STATUSES).isPresent();
        } catch (Exception e) {
            log.warn("catalog-api: catalogue lookup failed for {} / {}: {}", instituteId, tag, e.getMessage());
            return false;
        }
    }

    private String defaultCatalogueTag(String instituteId) {
        try {
            return catalogueMappingRepository
                    .findDefaultCatalogueForInstituteId(instituteId, List.of(CatalogueStatusEnum.ACTIVE.name()))
                    .map(m -> m.getCourseCatalogue() == null ? null : m.getCourseCatalogue().getTagName())
                    .orElse(null);
        } catch (Exception e) {
            log.warn("catalog-api: default catalogue lookup failed for {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    /** The resolution rules, free of repositories (unit-tested with prod-shaped rows). */
    static Resolution resolve(InstituteCatalogApiSettings settings,
                              List<InstituteDomainRouting> routingRows,
                              Predicate<String> catalogueExists,
                              Supplier<String> defaultCatalogueTag,
                              Supplier<String> learnerPortalBase) {
        List<InstituteDomainRouting> learnerRows = new ArrayList<>();
        if (routingRows != null) {
            for (InstituteDomainRouting r : routingRows) {
                if (r != null && LEARNER.equalsIgnoreCase(r.getRole()) && hostOf(r) != null) learnerRows.add(r);
            }
        }

        // ── site tag ──
        String siteTag = null;
        String tagSource = null;
        if (settings != null && notBlank(settings.getSiteTag())) {
            siteTag = settings.getSiteTag().trim();
            tagSource = SOURCE_SETTINGS;
        }
        if (siteTag == null) {
            List<InstituteDomainRouting> ranked = rank(learnerRows, null);
            for (InstituteDomainRouting r : ranked) {
                String tag = rowSiteTag(r, catalogueExists);
                if (tag != null) {
                    siteTag = tag;
                    tagSource = SOURCE_DOMAIN_ROUTING;
                    break;
                }
            }
        }
        if (siteTag == null) {
            String def = defaultCatalogueTag.get();
            if (notBlank(def)) {
                siteTag = def.trim();
                tagSource = SOURCE_DEFAULT_CATALOGUE;
            }
        }

        // ── course base URL ──
        if (settings != null && notBlank(settings.getCourseBaseUrl())) {
            return new Resolution(siteTag, tagSource, stripTrailingSlash(settings.getCourseBaseUrl().trim()),
                    SOURCE_SETTINGS);
        }
        List<InstituteDomainRouting> ranked = rank(learnerRows, siteTag);
        if (!ranked.isEmpty()) {
            InstituteDomainRouting row = ranked.get(0);
            String origin = "https://" + hostOf(row);
            boolean rootIsSite = siteTag != null && notBlank(row.getRootCatalogueTag())
                    && row.getRootCatalogueTag().trim().equalsIgnoreCase(siteTag);
            String path = rootIsSite || siteTag == null ? "" : "/" + siteTag;
            return new Resolution(siteTag, tagSource, origin + path, SOURCE_DOMAIN_ROUTING);
        }
        String base = learnerPortalBase.get();
        if (!notBlank(base)) return new Resolution(siteTag, tagSource, null, null);
        return new Resolution(siteTag, tagSource,
                stripTrailingSlash(base.trim()) + (siteTag == null ? "" : "/" + siteTag), SOURCE_LEARNER_PORTAL);
    }

    /**
     * The catalogue one routing row serves on its host: its {@code root_catalogue_tag} ‖ the first
     * segment of its {@code redirect} when a live catalogue with that tag exists ‖ null. The per-row
     * rule of the site tag above; also how the Site Assistant maps a visitor's host to a site.
     */
    public String rowSiteTag(String instituteId, InstituteDomainRouting row) {
        return rowSiteTag(row, tag -> catalogueExists(instituteId, tag));
    }

    static String rowSiteTag(InstituteDomainRouting row, Predicate<String> catalogueExists) {
        if (row == null) return null;
        if (notBlank(row.getRootCatalogueTag())) return row.getRootCatalogueTag().trim();
        String fromRedirect = redirectTag(row.getRedirect());
        return fromRedirect != null && catalogueExists.test(fromRedirect) ? fromRedirect : null;
    }

    /**
     * Best row first: names the site tag, not an admin host (prod has admin-* portals filed as
     * LEARNER rows), primary, concrete subdomain; then table order.
     */
    private static List<InstituteDomainRouting> rank(List<InstituteDomainRouting> rows, String siteTag) {
        List<InstituteDomainRouting> out = new ArrayList<>(rows);
        Comparator<InstituteDomainRouting> c = Comparator
                .comparing((InstituteDomainRouting r) -> !namesTag(r, siteTag))
                .thenComparing(r -> r.getSubdomain() != null
                        && r.getSubdomain().trim().toLowerCase(Locale.ROOT).startsWith("admin"))
                .thenComparing(r -> !r.isPrimary())
                .thenComparing(r -> isWildcard(r.getSubdomain()));
        out.sort(c); // stable: ties keep table order
        return out;
    }

    private static boolean namesTag(InstituteDomainRouting r, String tag) {
        if (tag == null) return false;
        if (notBlank(r.getRootCatalogueTag()) && r.getRootCatalogueTag().trim().equalsIgnoreCase(tag)) return true;
        String fromRedirect = redirectTag(r.getRedirect());
        return fromRedirect != null && fromRedirect.equalsIgnoreCase(tag);
    }

    /** "/store" → "store"; "/store/x?y" → "store"; blank or "/" → null. */
    static String redirectTag(String redirect) {
        if (!notBlank(redirect)) return null;
        String r = redirect.trim();
        if (r.matches("(?i)^https?://.*")) {
            int slash = r.indexOf('/', r.indexOf("://") + 3);
            r = slash < 0 ? "" : r.substring(slash);
        }
        r = r.replaceAll("^/+", "");
        int end = r.length();
        for (char ch : new char[]{'/', '?', '#'}) {
            int i = r.indexOf(ch);
            if (i >= 0 && i < end) end = i;
        }
        String seg = r.substring(0, end).trim();
        return seg.isEmpty() ? null : seg;
    }

    private static boolean isWildcard(String subdomain) {
        return subdomain == null || subdomain.isBlank() || "*".equals(subdomain.trim());
    }

    /** The row's host, or null when it is not a reachable public host (localhost, a bare label…). */
    static String hostOf(InstituteDomainRouting r) {
        if (r.getDomain() == null || r.getDomain().isBlank()) return null;
        String domain = r.getDomain().trim().replaceAll("^https?://", "").replaceAll("/+$", "").toLowerCase(Locale.ROOT);
        String host = isWildcard(r.getSubdomain()) ? domain : r.getSubdomain().trim().toLowerCase(Locale.ROOT) + "." + domain;
        String bare = host.contains(":") ? host.substring(0, host.indexOf(':')) : host;
        if (bare.equals("localhost") || bare.endsWith(".localhost") || bare.startsWith("127.")
                || bare.equals("0.0.0.0") || !bare.contains(".")) {
            return null;
        }
        return host;
    }

    private static String stripTrailingSlash(String url) {
        String u = url;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
