package vacademy.io.admin_core_service.features.catalog_api.rules;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The {@code q} search of {@code GET /courses}: word search, so a visitor's own words find a course
 * whatever their order ("april 2026 current affairs" finds "Weekly Current Affairs 2026 | April
 * 2026 Week 4"). A course matches when the whole query is a substring (the old rule, kept), or
 * when every query word is found among the course's words (title, tags, instructors, description).
 *
 * <p>Words: lower case; runs of letters, combining marks (Devanagari matras) and digits; an
 * apostrophe inside a word is dropped ("Ma'am" = "maam") but splits a year ("May'24" = "may 24");
 * month names shorten to three letters; "2024" = "24"; a trailing plural "s" is dropped. A query word of 3+ letters also
 * matches the start of a course word ("geo" finds "geography"), and a course word of 5+ letters the
 * start of a query word ("vocab" for "vocabulary"); numbers match whole.
 * Filler words ("pdf", "ebook", "course", "for", "the"…) are not required.
 */
public final class CatalogSearch {

    private static final Map<String, String> MONTHS = Map.ofEntries(
            Map.entry("january", "jan"), Map.entry("february", "feb"), Map.entry("march", "mar"),
            Map.entry("april", "apr"), Map.entry("june", "jun"), Map.entry("july", "jul"),
            Map.entry("august", "aug"), Map.entry("september", "sep"), Map.entry("sept", "sep"),
            Map.entry("october", "oct"), Map.entry("november", "nov"), Map.entry("december", "dec"));
    private static final Set<String> FILLER = Set.of(
            "a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "by", "or", "at", "from", "is", "are",
            "be", "all", "any", "some", "me", "my", "i", "we", "you", "your", "our",
            "pdf", "pdfs", "ebook", "ebooks", "book", "books", "e", "course", "courses", "note", "notes");
    /** An apostrophe between two letters ("ma'am", "math's"), never before a digit ("may'24"). */
    /** The shortest course word that may stand for a longer query word. */
    private static final int MIN_SHORT_FORM = 5;
    private static final Pattern INNER_APOSTROPHE = Pattern.compile("(?<=\\p{L})['\u2019](?=\\p{L})");

    private CatalogSearch() {
    }

    /** The searchable words of a text, in order (duplicates kept). */
    public static List<String> words(String text) {
        List<String> out = new ArrayList<>();
        if (text == null || text.isEmpty()) return out;
        String s = Normalizer.normalize(text.toLowerCase(Locale.ROOT), Normalizer.Form.NFC);
        s = INNER_APOSTROPHE.matcher(s).replaceAll("");
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isLetterOrDigit(cp) || isMark(cp)) {
                cur.appendCodePoint(cp);
            } else if (!cur.isEmpty()) {
                out.add(normalizeWord(cur.toString()));
                cur.setLength(0);
            }
        }
        if (!cur.isEmpty()) out.add(normalizeWord(cur.toString()));
        return out;
    }

    /** The words a course must contain: no filler, no one-letter words, unique, in order. */
    public static List<String> queryWords(String q) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String w : words(q)) {
            if (FILLER.contains(w) || (w.length() < 2 && !isDigits(w))) continue;
            out.add(w);
        }
        return new ArrayList<>(out);
    }

    /** Every query word is among the course words (or starts one, for 3+ letters). */
    public static boolean matchesAll(List<String> queryWords, Set<String> courseWords) {
        if (queryWords.isEmpty()) return false;
        for (String w : queryWords) if (!hit(w, courseWords)) return false;
        return true;
    }

    /** How many of the query words the text has, 0..1 (0 for no query words). */
    public static double share(List<String> queryWords, Collection<String> textWords) {
        if (queryWords.isEmpty()) return 0;
        Set<String> set = textWords instanceof Set<String> ws ? ws : new LinkedHashSet<>(textWords);
        int hits = 0;
        for (String w : queryWords) if (hit(w, set)) hits++;
        return (double) hits / queryWords.size();
    }

    /**
     * The relevance of a title to the query, for {@code sort=relevance}: the whole query in the
     * title counts most, then the share of query words in the title.
     */
    public static double titleScore(String title, String qLower, List<String> queryWords) {
        if (title == null) return 0;
        double score = 0;
        if (qLower != null && !qLower.isBlank() && title.toLowerCase(Locale.ROOT).contains(qLower)) score += 4;
        return score + 2 * share(queryWords, words(title));
    }

    static boolean hit(String queryWord, Set<String> courseWords) {
        if (courseWords.contains(queryWord)) return true;
        if (isDigits(queryWord) || queryWord.length() < 3) return false;
        for (String w : courseWords) {
            if (w.startsWith(queryWord)) return true;
            // A short form in the course for the visitor's long word ("vocab" for "vocabulary").
            if (w.length() >= MIN_SHORT_FORM && queryWord.startsWith(w) && !isDigits(w)) return true;
        }
        return false;
    }

    private static String normalizeWord(String w) {
        String m = MONTHS.get(w);
        if (m != null) return m;
        if (w.length() == 4 && w.startsWith("20") && isDigits(w)) return w.substring(2);
        if (w.length() >= 4 && w.endsWith("s") && !w.endsWith("ss") && isAsciiLetters(w)) {
            return w.substring(0, w.length() - 1);
        }
        return w;
    }

    private static boolean isMark(int cp) {
        int t = Character.getType(cp);
        return t == Character.NON_SPACING_MARK || t == Character.COMBINING_SPACING_MARK
                || t == Character.ENCLOSING_MARK;
    }

    private static boolean isDigits(String w) {
        if (w.isEmpty()) return false;
        for (int i = 0; i < w.length(); i++) if (!Character.isDigit(w.charAt(i))) return false;
        return true;
    }

    private static boolean isAsciiLetters(String w) {
        for (int i = 0; i < w.length(); i++) {
            char c = w.charAt(i);
            if (c > 127 || !Character.isLetter(c)) return false;
        }
        return true;
    }
}
