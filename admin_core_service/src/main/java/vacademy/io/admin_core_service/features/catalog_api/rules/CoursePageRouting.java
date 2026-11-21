package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * What a course opens on the hosted site: the standard details page, or (mode PAGE) a page
 * authored in the catalogue editor at {@code /<tag>/<route>}.
 *
 * <p>Port of {@code frontend-learner-dashboard-app/src/routes/$tagName/-utils/course-page-routing.ts}
 * ({@code resolveCourseView}, {@code resolveCoursePageRoute}). Keys are matched course id (package
 * id) first, then package session id; anything unconfigured, malformed or self-referential falls
 * back to the details page.
 */
public final class CoursePageRouting {

    private CoursePageRouting() {
    }

    private static final Pattern ID_SHAPED = Pattern.compile(
            "^(\\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", Pattern.CASE_INSENSITIVE);
    private static final Pattern HTTP = Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE);

    public record View(String mode, String route) {
        static final View DETAILS = new View("DETAILS", null);
    }

    static String normalizeRoute(JsonNode raw) {
        if (raw == null || !raw.isTextual()) return null;
        String route = raw.asText().trim();
        if (route.isEmpty()) return null;
        if (HTTP.matcher(route).find()) {
            try {
                String path = new URI(route).getPath();
                List<String> segments = new ArrayList<>();
                if (path != null) for (String s : path.split("/")) if (!s.isEmpty()) segments.add(s);
                route = segments.isEmpty() ? "" : segments.get(segments.size() - 1);
            } catch (Exception e) {
                return null;
            }
        }
        route = route.replaceAll("^/+", "").replaceAll("/+$", "");
        if (route.isEmpty()) return null;
        if (ID_SHAPED.matcher(route).matches()) return null;
        return route;
    }

    public static View resolveCourseView(JsonNode globalSettings, String courseId, String packageSessionId) {
        JsonNode settings = field(globalSettings, "coursePages");
        // `!settings?.enabled`: any truthy value switches it on.
        if (!isObject(settings) || !truthy(settings.get("enabled"))) return View.DETAILS;
        JsonNode byCourse = settings.get("courses");
        JsonNode legacy = settings.get("map");
        for (String key : new String[]{courseId, packageSessionId}) {
            if (key == null || key.isEmpty()) continue;
            JsonNode setting = isObject(byCourse) ? byCourse.get(key) : null;
            JsonNode legacyRoute = isObject(legacy) ? legacy.get(key) : null;
            JsonNode settingMode = setting == null ? null : setting.get("mode");
            JsonNode settingRoute = setting == null ? null : setting.get("route");
            String mode;
            if (settingMode != null && !settingMode.isNull() && !settingMode.isMissingNode()) {
                if (!truthy(settingMode)) continue; // `if (!mode) continue`
                mode = settingMode.isTextual() ? settingMode.asText() : String.valueOf(settingMode);
            } else if (truthy(settingRoute) || truthy(legacyRoute)) {
                mode = "PAGE";
            } else {
                continue;
            }
            if ("OUTLINE".equals(mode)) return new View("OUTLINE", null);
            if ("TILES".equals(mode)) return new View("TILES", null);
            if ("DETAILS".equals(mode)) return View.DETAILS;
            JsonNode routeSource = settingRoute != null && !settingRoute.isNull() && !settingRoute.isMissingNode()
                    ? settingRoute : legacyRoute;
            String route = normalizeRoute(routeSource);
            if (route != null && !route.equals(courseId) && !route.equals(packageSessionId)) {
                return new View("PAGE", route);
            }
            return View.DETAILS;
        }
        return View.DETAILS;
    }

    /** The page route, or null to stay on the details route. */
    public static String resolveCoursePageRoute(JsonNode globalSettings, String courseId, String packageSessionId) {
        View view = resolveCourseView(globalSettings, courseId, packageSessionId);
        return "PAGE".equals(view.mode()) ? view.route() : null;
    }

    private static boolean truthy(JsonNode n) {
        if (n == null || n.isNull() || n.isMissingNode()) return false;
        if (n.isBoolean()) return n.booleanValue();
        if (n.isTextual()) return !n.asText().isEmpty();
        if (n.isNumber()) return n.doubleValue() != 0;
        return true;
    }
}
