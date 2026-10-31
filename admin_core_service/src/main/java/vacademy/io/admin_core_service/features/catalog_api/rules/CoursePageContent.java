package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * What the course page shows beyond the course's own fields: the course mode and FAQs
 * ({@code course_page_json}) and the preview video ({@code course_media_id}).
 *
 * <p>Port of {@code parseCoursePageJson}, {@code previewVideoOf} and {@code embedUrlOf} in
 * {@code frontend-learner-dashboard-app/src/routes/$tagName/$courseId/-utils/course-page-content.ts}.
 * Anything malformed reads as "nothing to show", never as an error.
 */
public final class CoursePageContent {

    private CoursePageContent() {
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_FAQS = 30;

    public record Faq(String q, String a) {
    }

    /** mode is SELF_PACED, LIVE or null. */
    public record Content(String mode, List<Faq> faqs) {
        static final Content EMPTY = new Content(null, List.of());
    }

    public static Content parseCoursePageJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) return Content.EMPTY;
        JsonNode data;
        try {
            data = MAPPER.readTree(raw);
        } catch (Exception e) {
            return Content.EMPTY;
        }
        if (!isObject(data)) return Content.EMPTY;
        String m = data.path("mode").isTextual() ? data.get("mode").asText() : null;
        String mode = "SELF_PACED".equals(m) || "LIVE".equals(m) ? m : null;
        List<Faq> faqs = new ArrayList<>();
        JsonNode list = data.get("faqs");
        if (list != null && list.isArray()) {
            for (JsonNode item : list) {
                if (!isObject(item)) continue;
                String q = text(item.get("q"));
                String a = text(item.get("a"));
                if (!q.isEmpty() && !a.isEmpty()) faqs.add(new Faq(q, a));
                if (faqs.size() >= MAX_FAQS) break;
            }
        }
        return new Content(mode, List.copyOf(faqs));
    }

    /** kind is youtube | vimeo | file (a media-service id) | url; {@code id} for the first three, {@code url} for url. */
    public record PreviewVideo(String kind, String id, String url) {
    }

    private static final Pattern YOUTUBE_ID = Pattern.compile(
            "(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\\.be/)([A-Za-z0-9_-]{6,})");
    private static final Pattern VIMEO_ID = Pattern.compile("(?:vimeo\\.com/(?:video/)?|player\\.vimeo\\.com/video/)(\\d+)");
    private static final Pattern VIDEO_FILE = Pattern.compile("\\.(mp4|webm|ogg|mov|m3u8)(\\?|#|$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern HTTP = Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE);

    private static PreviewVideo fromUrl(String url) {
        Matcher yt = YOUTUBE_ID.matcher(url);
        if (yt.find()) return new PreviewVideo("youtube", yt.group(1), null);
        Matcher vm = VIMEO_ID.matcher(url);
        if (vm.find()) return new PreviewVideo("vimeo", vm.group(1), null);
        if (HTTP.matcher(url).find() && VIDEO_FILE.matcher(url).find()) return new PreviewVideo("url", null, url);
        return null;
    }

    /** The course's preview video, or null when its media is an image (or none). */
    public static PreviewVideo previewVideoOf(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        if (value.startsWith("{")) {
            JsonNode parsed;
            try {
                parsed = MAPPER.readTree(value);
            } catch (Exception e) {
                return null;
            }
            if (!isObject(parsed)) return null;
            String type = text(parsed.get("type")).toLowerCase(Locale.ROOT);
            String id = text(parsed.get("id"));
            if (id.isEmpty()) id = text(parsed.get("url"));
            if (id.isEmpty()) return null;
            if ("youtube".equals(type)) {
                PreviewVideo fromLink = fromUrl(id);
                if (fromLink != null && "youtube".equals(fromLink.kind())) return fromLink;
                return id.matches("^[A-Za-z0-9_-]{6,}$") ? new PreviewVideo("youtube", id, null) : null;
            }
            if ("vimeo".equals(type)) {
                PreviewVideo fromLink = fromUrl(id);
                if (fromLink != null && "vimeo".equals(fromLink.kind())) return fromLink;
                return id.matches("^\\d+$") ? new PreviewVideo("vimeo", id, null) : null;
            }
            if ("video".equals(type)) {
                if (HTTP.matcher(id).find()) {
                    PreviewVideo fromLink = fromUrl(id);
                    return fromLink != null ? fromLink : new PreviewVideo("url", null, id);
                }
                return new PreviewVideo("file", id, null);
            }
            return null;
        }
        return fromUrl(value);
    }

    /** The embeddable address of a YouTube / Vimeo preview, else null. */
    public static String embedUrlOf(PreviewVideo video) {
        if ("youtube".equals(video.kind())) return "https://www.youtube-nocookie.com/embed/" + video.id() + "?autoplay=1&rel=0";
        if ("vimeo".equals(video.kind())) return "https://player.vimeo.com/video/" + video.id() + "?autoplay=1";
        return null;
    }
}
