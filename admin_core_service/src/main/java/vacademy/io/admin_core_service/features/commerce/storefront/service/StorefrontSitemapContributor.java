package vacademy.io.admin_core_service.features.commerce.storefront.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.CatalogSitemapContributor;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;

import java.util.List;
import java.util.Map;

/**
 * Adds the product pages ({@code /p/<slug>}) and collection pages ({@code /c/<slug>}) of an
 * institute's shop to the Catalogue API sitemap. An institute without the commerce catalogue
 * feature, or without a hosted site address, adds nothing, so its sitemap is what it was.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StorefrontSitemapContributor implements CatalogSitemapContributor {

    private final StorefrontFeatureGate featureGate;
    private final StorefrontCatalogService catalogService;
    private final CatalogSiteResolver siteResolver;

    @Override
    public List<Map<String, Object>> sitemapEntries(String instituteId) {
        try {
            if (!featureGate.has(instituteId, CommerceFeature.CATALOGUE)) {
                return List.of();
            }
            String baseUrl = siteResolver.resolve(instituteId).courseBaseUrl();
            if (baseUrl == null || baseUrl.isBlank()) {
                return List.of();
            }
            return catalogService.sitemapEntries(instituteId, baseUrl.trim());
        } catch (RuntimeException e) {
            // The course sitemap must not fail because of the shop.
            log.warn("storefront: sitemap entries failed for institute {}: {}", instituteId, e.getMessage());
            return List.of();
        }
    }
}
