package vacademy.io.assessment_service.features.assessment.service;

import java.util.Locale;
import java.util.Map;

/**
 * Turns {@code institutes.institute_theme_code} into a "#RRGGBB" colour that reports and emails
 * can paint with.
 *
 * <p>The column holds either a preset code ("primary" for the default orange, "blue", "amber", and
 * so on) or a hex value, sometimes without the '#'. A preset code means nothing to CSS, and every
 * report builder only accepts hex, so a raw "blue" made the PDFs fall back to their default colour
 * instead of the institute's theme. The preset hexes are the {@code primary-500} values of the
 * admin and learner apps' {@code constants/themes/theme.json}. notification_service and
 * admin_core use the same table, each in its own ThemeColorResolver.
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

    /**
     * An upper-case "#RRGGBB" colour, or null when the code is blank or not recognised, so the
     * caller picks its own default. Short "#RGB" is expanded and an "#RRGGBBAA" alpha is dropped.
     */
    public static String resolve(String themeCode) {
        if (themeCode == null) return null;
        String c = themeCode.trim();
        if (c.isEmpty()) return null;
        String preset = PRESETS.get(c.toLowerCase(Locale.ROOT));
        if (preset != null) return preset;
        String hex = c.startsWith("#") ? c.substring(1) : c;
        if (!hex.matches("[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}")) return null;
        if (hex.length() == 3) {
            hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        }
        return "#" + hex.substring(0, 6).toUpperCase(Locale.ROOT);
    }
}
