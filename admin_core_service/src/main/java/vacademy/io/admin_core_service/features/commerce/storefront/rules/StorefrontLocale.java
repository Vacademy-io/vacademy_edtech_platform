package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * Which language a shopper gets: the requested locale, then the
 * site's base locale, then any. The fallback is per field, so a missing translation never
 * blanks a field: a Hindi page of a product with only an English description shows the Hindi
 * name and the English description.
 */
public final class StorefrontLocale {

    private static final Pattern SHAPE = Pattern.compile("^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$");

    private StorefrontLocale() {
    }

    /** {@code hi}, {@code en-in}; null for a blank or malformed value. */
    public static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim().replace('_', '-').toLowerCase(Locale.ROOT);
        return SHAPE.matcher(value).matches() ? value : null;
    }

    /**
     * The order in which locales are tried: requested, its language alone ({@code en} for
     * {@code en-in}), the base locale, its language alone. Never empty when a base is given.
     */
    public static List<String> chain(String requested, String base) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String raw : new String[]{requested, base}) {
            String locale = normalize(raw);
            if (locale == null) {
                continue;
            }
            out.add(locale);
            int dash = locale.indexOf('-');
            if (dash > 0) {
                out.add(locale.substring(0, dash));
            }
        }
        return new ArrayList<>(out);
    }

    /** The locale the response is in: the first of the chain, or {@code en} when there is none. */
    public static String effective(List<String> chain) {
        return chain.isEmpty() ? "en" : chain.get(0);
    }

    /** First non-blank text of an i18n map along the chain, then any (lowest locale code first). */
    public static String text(Map<String, String> i18n, List<String> chain) {
        if (i18n == null || i18n.isEmpty()) {
            return null;
        }
        for (String locale : chain) {
            String value = clean(i18n.get(locale));
            if (value != null) {
                return value;
            }
        }
        for (String locale : new TreeSet<>(i18n.keySet())) {
            String value = clean(i18n.get(locale));
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    /**
     * One field of a per-locale row (a product translation) with the same fallback. Returns the
     * first value {@code present} accepts, or null when no locale has one.
     */
    public static <T, V> V field(Map<String, T> byLocale, List<String> chain, Function<T, V> getter,
                                 Function<V, Boolean> present) {
        if (byLocale == null || byLocale.isEmpty()) {
            return null;
        }
        for (String locale : chain) {
            T row = byLocale.get(locale);
            V value = row == null ? null : getter.apply(row);
            if (value != null && Boolean.TRUE.equals(present.apply(value))) {
                return value;
            }
        }
        for (String locale : new TreeSet<>(byLocale.keySet())) {
            V value = getter.apply(byLocale.get(locale));
            if (value != null && Boolean.TRUE.equals(present.apply(value))) {
                return value;
            }
        }
        return null;
    }

    /** A text field of a per-locale row; blank counts as missing. */
    public static <T> String textField(Map<String, T> byLocale, List<String> chain, Function<T, String> getter) {
        return field(byLocale, chain, row -> clean(getter.apply(row)), value -> true);
    }

    /**
     * The locale whose row serves the name, which is the locale the page is reported in; the
     * requested locale when no row exists at all.
     */
    public static <T> String served(Map<String, T> byLocale, List<String> chain) {
        if (byLocale != null) {
            for (String locale : chain) {
                if (byLocale.containsKey(locale)) {
                    return locale;
                }
            }
            if (!byLocale.isEmpty()) {
                return new TreeSet<>(byLocale.keySet()).first();
            }
        }
        return effective(chain);
    }

    private static String clean(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
