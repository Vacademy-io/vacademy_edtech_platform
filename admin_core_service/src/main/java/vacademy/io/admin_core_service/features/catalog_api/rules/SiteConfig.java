package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Language;

import java.util.*;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * The parts of a site's catalogue_json the API reads, validated once: formats, course languages
 * and grouping, payment visibility, the Courses section (streams, editorial descriptions) and the
 * Learning Paths library.
 *
 * <p>Grouping follows {@code resolveCatalogDiscovery} in {@code catalog/catalog-config.ts}:
 * {@code groupLanguageVersions === true} on the Courses section AND
 * {@code globalSettings.courseLanguages.enabled}; a site without a Courses section groups when
 * course languages are on. Version groups: {@code resolveVersionGroups} (lists of 2+ distinct
 * ids, at most 500). Descriptions: {@code render.card.descriptions} of an editorial card section
 * ({@code resolveCardDesign} in {@code catalog-card-view.ts}). Discovery: the same section's sort,
 * filter, badge and quick-filter props ({@link CatalogDiscovery}).
 */
public record SiteConfig(
        String tag,
        JsonNode globalSettings,
        JsonNode pages,
        CourseFormats.Resolved formats,
        List<Language> languages,
        boolean courseLanguagesOn,
        boolean grouping,
        List<List<String>> versionGroups,
        boolean paymentEnabled,
        SiteSections.CatalogSection catalog,
        CatalogStreams.StreamsConfig streams,
        Map<String, String> descriptions,
        String pathLibraryId,
        CatalogDiscovery discovery) {

    public static SiteConfig empty(String tag) {
        return of(tag, JsonNodeFactory.instance.objectNode());
    }

    public static SiteConfig parse(String tag, String catalogueJson, ObjectMapper mapper) {
        JsonNode root;
        try {
            root = catalogueJson == null || catalogueJson.isBlank() ? null : mapper.readTree(catalogueJson);
        } catch (Exception e) {
            root = null;
        }
        return of(tag, isObject(root) ? root : JsonNodeFactory.instance.objectNode());
    }

    public static SiteConfig of(String tag, JsonNode root) {
        JsonNode gs = isObject(root.get("globalSettings")) ? root.get("globalSettings")
                : JsonNodeFactory.instance.objectNode();
        JsonNode pages = root.get("pages") != null && root.get("pages").isArray() ? root.get("pages")
                : JsonNodeFactory.instance.arrayNode();
        JsonNode languageSettings = gs.get("courseLanguages");
        boolean courseLanguagesOn = isObject(languageSettings) && isTrue(languageSettings.get("enabled"));
        List<Language> languages = CourseLanguages.normalise(languageSettings);
        SiteSections.CatalogSection catalog = SiteSections.findCatalogSection(pages);
        boolean grouping = catalog == null
                ? courseLanguagesOn
                : courseLanguagesOn && isTrue(catalog.props().get("groupLanguageVersions"));
        JsonNode payment = gs.get("payment");
        boolean paymentEnabled = !(isObject(payment) && payment.path("enabled").isBoolean()
                && !payment.get("enabled").booleanValue());
        CatalogStreams.StreamsConfig streams = catalog == null ? null
                : CatalogStreams.resolveStreams(catalog.props().get("streams"));
        CourseFormats.Resolved formats = CourseFormats.resolve(gs);
        return new SiteConfig(tag, gs, pages, formats, languages, courseLanguagesOn, grouping,
                resolveVersionGroups(field(languageSettings, "versionGroups")), paymentEnabled, catalog, streams,
                descriptions(catalog), SiteSections.findPathLibraryId(pages),
                CatalogDiscovery.resolve(catalog == null ? null : catalog.props(), courseLanguagesOn, languages,
                        streams, formats));
    }

    static List<List<String>> resolveVersionGroups(JsonNode raw) {
        if (raw == null || !raw.isArray()) return List.of();
        List<List<String>> out = new ArrayList<>();
        int n = 0;
        for (JsonNode group : raw) {
            if (n++ >= 500) break;
            if (!group.isArray()) continue;
            LinkedHashSet<String> ids = new LinkedHashSet<>();
            for (JsonNode id : group) {
                String v = text(id);
                if (!v.isEmpty()) ids.add(v);
            }
            if (ids.size() >= 2) out.add(List.copyOf(ids));
        }
        return List.copyOf(out);
    }

    private static Map<String, String> descriptions(SiteSections.CatalogSection catalog) {
        if (catalog == null) return Map.of();
        JsonNode render = catalog.props().get("render");
        if (!isObject(render) || !"editorial".equals(render.path("cardStyle").asText(null))) return Map.of();
        JsonNode raw = field(field(render, "card"), "descriptions");
        if (!isObject(raw)) return Map.of();
        Map<String, String> out = new HashMap<>();
        Iterator<Map.Entry<String, JsonNode>> it = raw.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String key = e.getKey().trim();
            String value = text(e.getValue());
            if (!key.isEmpty() && !value.isEmpty()) out.put(key, value);
        }
        return Collections.unmodifiableMap(out);
    }

    /** The section's stream label mode (title | subtitle | both); "title" without streams. */
    public String labelMode() {
        return streams == null ? "title" : streams.labelMode();
    }
}
