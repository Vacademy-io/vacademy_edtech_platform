package vacademy.io.admin_core_service.features.student_analysis.service.aggregation;

import java.util.Locale;
import java.util.Map;

/**
 * Turns {@code institutes.institute_theme_code} into a colour the report can paint with.
 *
 * <p>The column holds either a hex value (sometimes without the '#') or a preset code —
 * "primary" (the default orange), "blue", "amber", … — which is meaningless to CSS and SVG: an
 * accent of "primary" made the score line invisible and the chart marks black. Preset hexes are
 * the {@code primary-500} values of the admin dashboard's {@code constants/themes/theme.json}.
 */
public final class ThemeColorResolver {

    private static final Map<String, String> PRESETS = Map.ofEntries(
            Map.entry("primary", "#ED7424"), Map.entry("blue", "#1E88E5"), Map.entry("green", "#43A047"),
            Map.entry("purple", "#8E24AA"), Map.entry("red", "#E53935"), Map.entry("pink", "#D81B60"),
            Map.entry("indigo", "#3949AB"), Map.entry("amber", "#FFB300"), Map.entry("cyan", "#00ACC1"),
            Map.entry("teal", "#00897B"), Map.entry("lime", "#7CB342"), Map.entry("violet", "#5E35B1"),
            Map.entry("maroon", "#9B2242"), Map.entry("navy", "#1A237E"), Map.entry("brown", "#6D4C41"),
            Map.entry("slate", "#546E7A"), Map.entry("charcoal", "#424242"), Map.entry("holistic", "#622335"),
            Map.entry("neutral", "#6B7280"));

    private ThemeColorResolver() {
    }

    /** A "#RRGGBB"-style colour, or null when the code is blank or unrecognised (caller picks a default). */
    public static String resolve(String themeCode) {
        if (themeCode == null) return null;
        String c = themeCode.trim();
        if (c.isEmpty()) return null;
        if (c.matches("#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")) return c;
        if (c.matches("[0-9a-fA-F]{6}|[0-9a-fA-F]{3}")) return "#" + c;
        return PRESETS.get(c.toLowerCase(Locale.ROOT));
    }
}
