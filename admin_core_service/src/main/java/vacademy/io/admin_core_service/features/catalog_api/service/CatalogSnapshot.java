package vacademy.io.admin_core_service.features.catalog_api.service;

import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogRow;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.FolderNode;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.Stream;
import vacademy.io.admin_core_service.features.catalog_api.rules.SiteConfig;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;

import java.util.List;
import java.util.Map;

/**
 * Everything the read endpoints need for one institute, loaded together and cached for 60 s: the
 * same course rows, site config and stream library the hosted site reads, plus the resolved media
 * URLs. One load per institute per minute, whatever the request mix.
 *
 * @param streamsSource "folder_library" | "tags" | null
 * @param streamRoots   the stream library's public tree (empty unless streams come from a folder library)
 * @param media         media id → public URL, for every image id the rows carry
 */
public record CatalogSnapshot(
        String instituteId,
        String instituteName,
        String instituteLogoFileId,
        String instituteWebsiteUrl,
        CatalogSiteResolver.Resolution resolution,
        SiteConfig site,
        List<CatalogRow> rows,
        String streamsSource,
        List<Stream> streams,
        List<FolderNode> streamRoots,
        Map<String, String> media) {

    public String mediaUrl(String idOrUrl) {
        if (idOrUrl == null || idOrUrl.isBlank()) return null;
        if (CatalogMediaResolver.isHttp(idOrUrl)) return idOrUrl.trim();
        return media.get(idOrUrl);
    }

    public String courseBaseUrl() {
        return resolution == null ? null : resolution.courseBaseUrl();
    }
}
