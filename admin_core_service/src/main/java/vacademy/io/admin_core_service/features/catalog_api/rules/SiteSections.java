package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * Where a site keeps its Courses section and its Learning Paths library.
 *
 * <p>Port of {@code findCatalogSection} and {@code findPathLibraryId} in
 * {@code frontend-learner-dashboard-app/src/routes/$tagName/$courseId/-utils/course-page-context.ts}.
 */
public final class SiteSections {

    private SiteSections() {
    }

    private static final Set<String> HOME_ROUTES = Set.of("", "home", "homepage");

    /** The site's Courses section: its page route and title, and the section's props. */
    public record CatalogSection(String route, String title, JsonNode props) {
    }

    /**
     * An enabled course catalogue, preferring one on a page of its own over the home page's, and
     * one with streams over one without (then page order). Only a page's first catalogue counts.
     */
    public static CatalogSection findCatalogSection(JsonNode pages) {
        if (pages == null || !pages.isArray()) return null;
        record Scored(CatalogSection section, double score) {
        }
        List<Scored> found = new ArrayList<>();
        int order = 0;
        for (JsonNode page : pages) {
            JsonNode components = page == null ? null : page.get("components");
            if (components != null && components.isArray()) {
                for (JsonNode c : components) {
                    if (!"courseCatalog".equals(c.path("type").asText(null))) continue;
                    if (c.path("enabled").isBoolean() && !c.get("enabled").booleanValue()) continue;
                    JsonNode props = isObject(c.get("props")) ? c.get("props") : JsonNodeFactory.instance.objectNode();
                    String route = page.path("route").isTextual() ? page.get("route").asText().trim() : "";
                    boolean streamsOn = isObject(props.get("streams")) && isTrue(props.get("streams").get("enabled"));
                    double score = (HOME_ROUTES.contains(lower(route)) ? 2 : 0) + (streamsOn ? 0 : 1) + order / 1000.0;
                    String title = page.path("title").isTextual() ? page.get("title").asText().trim() : "";
                    found.add(new Scored(new CatalogSection(route, title, props), score));
                    break;
                }
            }
            order++;
        }
        return found.stream().min(Comparator.comparingDouble(Scored::score)).map(Scored::section).orElse(null);
    }

    /** The library the site's Learning Paths come from (its first enabled learningPath section with one), or null. */
    public static String findPathLibraryId(JsonNode pages) {
        if (pages == null || !pages.isArray()) return null;
        for (JsonNode page : pages) {
            JsonNode components = page == null ? null : page.get("components");
            if (components == null || !components.isArray()) continue;
            for (JsonNode c : components) {
                if (!"learningPath".equals(c.path("type").asText(null))) continue;
                if (c.path("enabled").isBoolean() && !c.get("enabled").booleanValue()) continue;
                JsonNode props = c.get("props");
                String id = isObject(props) && props.path("libraryId").isTextual() ? props.get("libraryId").asText().trim() : "";
                if (!id.isEmpty()) return id;
            }
        }
        return null;
    }
}
