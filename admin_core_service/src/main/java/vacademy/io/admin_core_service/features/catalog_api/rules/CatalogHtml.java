package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;

/**
 * Authored rich text for third-party pages: sanitised HTML (jsoup {@link Safelist#relaxed()},
 * whose {@code img src} only allows http/https — relative, data: and javascript: sources are
 * dropped) and a plain-text version with whitespace collapsed.
 */
public final class CatalogHtml {

    private CatalogHtml() {
    }

    private static final Safelist SAFELIST = Safelist.relaxed();
    private static final Document.OutputSettings OUTPUT = new Document.OutputSettings().prettyPrint(false);

    /** Sanitised HTML, or null when there is no visible text and no image (an untouched editor's "&lt;p&gt;&lt;/p&gt;"). */
    public static String sanitize(String html) {
        if (html == null || html.isBlank()) return null;
        String clean = Jsoup.clean(html, "", SAFELIST, OUTPUT).trim();
        if (clean.isEmpty()) return null;
        if (plainText(clean) == null && !clean.contains("<img")) return null;
        return clean;
    }

    /** Plain text of authored HTML (tags dropped, entities decoded, whitespace collapsed); null when empty. */
    public static String plainText(String html) {
        if (html == null || html.isBlank()) return null;
        String text = Jsoup.parse(html).text().replace(' ', ' ').replaceAll("\\s+", " ").trim();
        return text.isEmpty() ? null : text;
    }

    /**
     * A one-glance summary, cut at a word: port of {@code summaryOf} in
     * {@code $courseId/-utils/course-page-context.ts} (trailing punctuation dropped, "…" added).
     * Unlike the TS (which may return max + 1 characters) the result never exceeds {@code max},
     * because the API documents these as hard limits.
     */
    public static String summary(String plain, int max) {
        if (plain == null) return null;
        String text = plain.trim();
        if (text.length() <= max) return text.isEmpty() ? null : text;
        int room = max - 1;
        String cut = text.substring(0, room);
        int at = cut.lastIndexOf(' ');
        String head = at > room * 0.6 ? cut.substring(0, at) : cut;
        return head.replaceAll("[\\s,;:.–—-]+$", "") + "…";
    }
}
