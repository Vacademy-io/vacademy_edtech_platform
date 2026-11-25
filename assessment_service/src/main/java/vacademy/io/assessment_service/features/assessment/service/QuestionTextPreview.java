package vacademy.io.assessment_service.features.assessment.service;

import org.jsoup.Jsoup;

/** The start of a question's text without markup, for inbox rows and staff notices. */
public final class QuestionTextPreview {

    /** Characters kept. */
    public static final int CHARS = 280;

    private QuestionTextPreview() {
    }

    /** Plain text of the HTML, cut to {@link #CHARS}; null when there is no text (e.g. image only). */
    public static String of(String html) {
        if (html == null || html.isBlank()) {
            return null;
        }
        String text = Jsoup.parse(html).text().trim();
        if (text.isEmpty()) {
            return null;
        }
        return text.length() <= CHARS ? text : text.substring(0, CHARS).trim() + "…";
    }
}
