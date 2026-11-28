package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Product search: a query is matched against the search text of
 * every locale of a product, so "saree" finds the English name and "साड़ी" the Hindi one of the
 * same product. Both sides are compared in Unicode NFC and lower case; every word of the query
 * must be present.
 */
public final class StorefrontSearch {

    public static final int MAX_QUERY_LENGTH = 100;
    private static final int MAX_WORDS = 8;

    private StorefrontSearch() {
    }

    /** NFC, lower case, whitespace collapsed; null when nothing is left. */
    public static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String text = Normalizer.normalize(raw, Normalizer.Form.NFC).toLowerCase(Locale.ROOT)
                .replaceAll("[\\s\\u00A0]+", " ").trim();
        if (text.length() > MAX_QUERY_LENGTH) {
            text = text.substring(0, MAX_QUERY_LENGTH).trim();
        }
        return text.isEmpty() ? null : text;
    }

    /** The words of a query, at most {@value #MAX_WORDS}; empty for a blank query. */
    public static List<String> words(String rawQuery) {
        String q = normalize(rawQuery);
        List<String> out = new ArrayList<>();
        if (q == null) {
            return out;
        }
        for (String word : q.split(" ")) {
            if (!word.isEmpty() && out.size() < MAX_WORDS) {
                out.add(word);
            }
        }
        return out;
    }

    /** True when {@code searchText} (already normalised) holds every word. No words = no filter. */
    public static boolean matches(String searchText, List<String> words) {
        if (words.isEmpty()) {
            return true;
        }
        if (searchText == null) {
            return false;
        }
        for (String word : words) {
            if (!searchText.contains(word)) {
                return false;
            }
        }
        return true;
    }

    /**
     * How well a name answers the query, for ordering results: 3 the name starts with the
     * query, 2 it contains it whole, 1 it contains every word, 0 the match is elsewhere (SKU,
     * attribute label).
     */
    public static int nameScore(String name, String rawQuery) {
        String n = normalize(name);
        String q = normalize(rawQuery);
        if (n == null || q == null) {
            return 0;
        }
        if (n.startsWith(q)) {
            return 3;
        }
        if (n.contains(q)) {
            return 2;
        }
        return matches(n, words(q)) ? 1 : 0;
    }
}
