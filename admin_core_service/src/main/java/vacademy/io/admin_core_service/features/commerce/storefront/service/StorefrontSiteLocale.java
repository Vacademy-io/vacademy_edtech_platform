package vacademy.io.admin_core_service.features.commerce.storefront.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CourseCatalogueResponse;
import vacademy.io.admin_core_service.features.course_catalogue.service.CourseCatalogueService;

import java.time.Duration;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The base language of an institute's site: {@code globalSettings.i18n.defaultLocale} of the
 * site the Catalogue API serves ({@link CatalogSiteResolver}). The site owns the clean URL of
 * every page in that language, so the shop must use the same one: its paths, canonical
 * addresses and alternates are built from it. Empty when the institute has no site, the site
 * names no language, or the read fails; the shop setting is then the fallback.
 */
@Slf4j
@Component
public class StorefrontSiteLocale {

    private static final Pattern LOCALE = Pattern.compile("^[a-z]{2,3}(-[a-z0-9]{2,8})?$");
    private static final String NONE = "";

    private final CatalogSiteResolver siteResolver;
    private final CourseCatalogueService courseCatalogueService;
    private final ObjectMapper objectMapper;
    private final Cache<String, String> cache = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(60)).maximumSize(5_000).build();

    public StorefrontSiteLocale(CatalogSiteResolver siteResolver, CourseCatalogueService courseCatalogueService,
                                ObjectMapper objectMapper) {
        this.siteResolver = siteResolver;
        this.courseCatalogueService = courseCatalogueService;
        this.objectMapper = objectMapper;
    }

    /** The site's base language in lower case, or null. */
    public String baseLocale(String instituteId) {
        String found = cache.get(instituteId, this::read);
        return found == null || found.isEmpty() ? null : found;
    }

    private String read(String instituteId) {
        try {
            String tag = siteResolver.resolve(instituteId).siteTag();
            if (tag == null || tag.isBlank()) {
                return NONE;
            }
            CourseCatalogueResponse site = courseCatalogueService.getCatalogueByInstituteAndTag(instituteId, tag);
            String json = site == null ? null : site.getCatalogueJson();
            if (json == null || json.isBlank()) {
                return NONE;
            }
            String locale = parse(objectMapper.readTree(json));
            return locale == null ? NONE : locale;
        } catch (Exception e) {
            log.warn("storefront: could not read the base language of the site of institute {}: {}", instituteId,
                    e.getMessage());
            return NONE;
        }
    }

    /** {@code globalSettings.i18n.defaultLocale} of a site's catalogue JSON, or null. */
    static String parse(JsonNode site) {
        JsonNode node = site == null ? null : site.path("globalSettings").path("i18n").path("defaultLocale");
        if (node == null || !node.isTextual()) {
            return null;
        }
        String locale = node.asText().trim().toLowerCase(Locale.ROOT).replace('_', '-');
        return LOCALE.matcher(locale).matches() ? locale : null;
    }
}
