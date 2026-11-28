package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.rules.CoursePageContent.PreviewVideo;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Cases from $courseId/-utils/course-page-content.test.ts, plus the HTML helpers. */
class CoursePageContentTest {

    @Test
    void readsTheModeAndTheFaqsThatHaveBothParts() {
        CoursePageContent.Content c = CoursePageContent.parseCoursePageJson(
                "{\"v\":1,\"mode\":\"SELF_PACED\",\"faqs\":[{\"q\":\" How long? \",\"a\":\"<p>25 min</p>\"},"
                        + "{\"q\":\"\",\"a\":\"orphan\"},{\"q\":\"No answer\"},\"junk\"]}");
        assertEquals("SELF_PACED", c.mode());
        assertEquals(List.of(new CoursePageContent.Faq("How long?", "<p>25 min</p>")), c.faqs());
    }

    @Test
    void isEmptyForAnythingUnreadableAndCapsFaqsAtThirty() {
        for (String raw : new String[]{null, "", "{not json", "[1,2]", "{\"mode\":\"WEEKLY\",\"faqs\":\"x\"}"}) {
            CoursePageContent.Content c = CoursePageContent.parseCoursePageJson(raw);
            assertNull(c.mode(), raw);
            assertEquals(List.of(), c.faqs(), raw);
        }
        StringBuilder sb = new StringBuilder("{\"faqs\":[");
        for (int i = 0; i < 40; i++) sb.append(i == 0 ? "" : ",").append("{\"q\":\"Q").append(i).append("\",\"a\":\"A\"}");
        assertEquals(30, CoursePageContent.parseCoursePageJson(sb.append("]}").toString()).faqs().size());
    }

    @Test
    void findsAPreviewVideoAndNoneInAnImage() {
        assertEquals(new PreviewVideo("youtube", "dQw4w9WgXcQ", null),
                CoursePageContent.previewVideoOf("{\"type\":\"youtube\",\"id\":\"dQw4w9WgXcQ\"}"));
        assertEquals(new PreviewVideo("youtube", "dQw4w9WgXcQ", null),
                CoursePageContent.previewVideoOf("{\"type\":\"youtube\",\"id\":\"https://youtu.be/dQw4w9WgXcQ\"}"));
        assertEquals(new PreviewVideo("youtube", "dQw4w9WgXcQ", null),
                CoursePageContent.previewVideoOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"));
        assertEquals(new PreviewVideo("vimeo", "123456", null), CoursePageContent.previewVideoOf("https://vimeo.com/123456"));
        assertEquals(new PreviewVideo("file", "media-file-1", null),
                CoursePageContent.previewVideoOf("{\"type\":\"video\",\"id\":\"media-file-1\"}"));
        assertEquals(new PreviewVideo("url", null, "https://cdn.example.com/p.mp4"),
                CoursePageContent.previewVideoOf("https://cdn.example.com/p.mp4"));
        assertNull(CoursePageContent.previewVideoOf("{\"type\":\"image\",\"id\":\"8dfb2716\"}"));
        assertNull(CoursePageContent.previewVideoOf("8dfb2716-5df1-4b2c"));
        assertNull(CoursePageContent.previewVideoOf("{broken"));
        assertNull(CoursePageContent.previewVideoOf(null));
    }

    @Test
    void embedsYoutubeWithoutTrackingCookiesAndVimeoByItsPlayer() {
        assertTrue(CoursePageContent.embedUrlOf(new PreviewVideo("youtube", "abcdef", null)).contains("youtube-nocookie.com/embed/abcdef"));
        assertTrue(CoursePageContent.embedUrlOf(new PreviewVideo("vimeo", "12", null)).contains("player.vimeo.com/video/12"));
        assertNull(CoursePageContent.embedUrlOf(new PreviewVideo("file", "x", null)));
    }

    @Test
    void sanitisesAuthoredHtml() {
        String dirty = "<p onclick=\"x()\">Hi <script>alert(1)</script><img src=\"javascript:alert(1)\">"
                + "<img src=\"https://cdn.example.com/a.png\"><a href=\"javascript:x\">l</a></p>";
        String clean = CatalogHtml.sanitize(dirty);
        assertFalse(clean.contains("script"));
        assertFalse(clean.contains("onclick"));
        assertFalse(clean.contains("javascript"));
        assertTrue(clean.contains("https://cdn.example.com/a.png"));
        assertNull(CatalogHtml.sanitize("<p></p>"));
        assertEquals("a & b c", CatalogHtml.plainText("<p>a &amp;&nbsp;b</p><p>c</p>"));
    }

    @Test
    void summariesNeverExceedTheirLimit() {
        String text = "word ".repeat(100).trim();
        String s = CatalogHtml.summary(text, 160);
        assertTrue(s.length() <= 160, s);
        assertTrue(s.endsWith("…"));
        assertEquals("short", CatalogHtml.summary("short", 160));
    }
}
