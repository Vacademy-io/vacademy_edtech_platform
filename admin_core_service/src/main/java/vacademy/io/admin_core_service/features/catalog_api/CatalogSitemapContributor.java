package vacademy.io.admin_core_service.features.catalog_api;

import java.util.List;
import java.util.Map;

/**
 * More entries for {@code GET /sitemap} than the course cards: each bean adds its own rows
 * (shape {@code {url, type, id, lastmod}}) for an institute. A contributor returns an empty list
 * when it has nothing for the institute and must not throw.
 */
public interface CatalogSitemapContributor {

    List<Map<String, Object>> sitemapEntries(String instituteId);
}
