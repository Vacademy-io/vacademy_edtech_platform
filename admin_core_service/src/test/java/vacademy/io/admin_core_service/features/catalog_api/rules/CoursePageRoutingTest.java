package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;

import static org.junit.jupiter.api.Assertions.*;

/** Cases from frontend-learner-dashboard-app/src/routes/$tagName/-utils/course-page-routing.test.ts. */
class CoursePageRoutingTest {

    static final String COURSE = "d955bc54-fed5-48d0-806b-441faad75840";
    static final String SESSION = "4e2bdf13-7561-44b0-9fd9-1d3ceefd8bad";

    private static JsonNode gs(String coursePagesJson) {
        try {
            return CatalogTestData.MAPPER.readTree("{\"coursePages\":" + coursePagesJson + "}");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static JsonNode on(String coursesJson) {
        return gs("{\"enabled\":true,\"courses\":" + coursesJson + "}");
    }

    private static CoursePageRouting.View view(JsonNode gs, String course, String session) {
        return CoursePageRouting.resolveCourseView(gs, course, session);
    }

    @Test
    void keepsTheDetailsPageWhenNotConfiguredOrOff() {
        assertEquals("DETAILS", view(CatalogTestData.MAPPER.createObjectNode(), COURSE, null).mode());
        assertEquals("DETAILS", view(null, COURSE, null).mode());
        assertEquals("DETAILS", view(gs("{\"enabled\":false,\"courses\":{\"" + COURSE + "\":{\"mode\":\"PAGE\",\"route\":\"toddler\"}}}"),
                COURSE, null).mode());
        assertEquals("DETAILS", view(on("{\"" + COURSE + "\":{\"mode\":\"PAGE\",\"route\":\"toddler\"}}"), "another", null).mode());
    }

    @Test
    void resolvesEachMode() {
        assertEquals(new CoursePageRouting.View("PAGE", "toddler"),
                view(on("{\"" + COURSE + "\":{\"mode\":\"PAGE\",\"route\":\"toddler\"}}"), COURSE, null));
        assertEquals("OUTLINE", view(on("{\"" + COURSE + "\":{\"mode\":\"OUTLINE\"}}"), COURSE, null).mode());
        assertEquals("TILES", view(on("{\"" + COURSE + "\":{\"mode\":\"TILES\"}}"), COURSE, null).mode());
        assertEquals("DETAILS", view(on("{\"" + COURSE + "\":{\"mode\":\"DETAILS\"}}"), COURSE, null).mode());
    }

    @Test
    void fallsBackWhenPageHasNoUsableOrAnIdShapedRoute() {
        for (String route : new String[]{"null", "\"\"", "\"   \"", "\"/\"", "\"" + SESSION + "\"", "\"12345\"",
                "\"" + COURSE + "\""}) {
            assertEquals("DETAILS", view(on("{\"" + COURSE + "\":{\"mode\":\"PAGE\",\"route\":" + route + "}}"), COURSE, null).mode(),
                    route);
        }
    }

    @Test
    void matchesThePackageSessionWhenTheCourseHasNoEntryButPrefersTheCourse() {
        assertEquals("OUTLINE", view(on("{\"" + SESSION + "\":{\"mode\":\"OUTLINE\"}}"), COURSE, SESSION).mode());
        assertEquals(new CoursePageRouting.View("PAGE", "by-course"), view(on("{\"" + COURSE
                + "\":{\"mode\":\"PAGE\",\"route\":\"by-course\"},\"" + SESSION + "\":{\"mode\":\"OUTLINE\"}}"), COURSE, SESSION));
    }

    @Test
    void normalisesPastedRoutes() {
        String[][] cases = {{"/toddler", "toddler"}, {"toddler/", "toddler"}, {"  toddler  ", "toddler"},
                {"https://7cs.vacademy.io/new-landing-page/toddler", "toddler"},
                {"https://7cs.vacademy.io/new-landing-page/toddler/", "toddler"}};
        for (String[] c : cases) {
            assertEquals(c[1], CoursePageRouting.resolveCoursePageRoute(
                    on("{\"" + COURSE + "\":{\"mode\":\"PAGE\",\"route\":\"" + c[0] + "\"}}"), COURSE, null), c[0]);
        }
    }

    @Test
    void survivesMalformedConfigAndReadsTheLegacyMap() {
        assertEquals("DETAILS", view(gs("{\"enabled\":true}"), COURSE, null).mode());
        assertEquals("DETAILS", view(on("\"nope\""), COURSE, null).mode());
        assertEquals("DETAILS", view(on("{}"), null, null).mode());
        assertEquals("DETAILS", view(on("{\"" + COURSE + "\":{}}"), COURSE, null).mode());
        assertEquals(new CoursePageRouting.View("PAGE", "toddler"),
                view(gs("{\"enabled\":true,\"map\":{\"" + COURSE + "\":\"toddler\"}}"), COURSE, null));
        assertEquals("OUTLINE", view(gs("{\"enabled\":true,\"courses\":{\"" + COURSE
                + "\":{\"mode\":\"OUTLINE\"}},\"map\":{\"" + COURSE + "\":\"toddler\"}}"), COURSE, null).mode());
        assertNull(CoursePageRouting.resolveCoursePageRoute(on("{\"" + COURSE + "\":{\"mode\":\"OUTLINE\"}}"), COURSE, null));
    }
}
