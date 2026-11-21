package vacademy.io.notification_service.util;

import java.util.Locale;
import java.util.Map;

/**
 * Turns {@code institutes.institute_theme_code} into a colour an email can paint with.
 *
 * <p>The column holds either a hex value (sometimes without the '#') or a preset code —
 * "primary" (the default orange), "blue", "amber", … — which is meaningless to CSS. Pasted raw
 * into the OTP mail, "primary" left the OTP box with no background, so its white code was
 * invisible on white. Preset hexes are the {@code primary-500} values of the admin dashboard's
 * {@code constants/themes/theme.json}; same table as admin_core's ThemeColorResolver.
 */
public final class ThemeColorResolver {

    /**
     * What the admin and learner apps paint when the code is blank or not a known preset
     * ({@code theme-provider.tsx} falls back to the "primary" preset), so a mail matches the
     * institute's own portal.
     */
    public static final String APP_DEFAULT = "#ED7424";

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
     * An upper-case "#RRGGBB" colour, or null when the code is blank or unrecognised (caller
     * picks a default). Short "#RGB" is expanded and an "#RRGGBBAA" alpha is dropped, so the
     * result can always be mixed and contrast-checked.
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

    /** {@link #resolve(String)}, or the apps' default orange when the code says nothing usable. */
    public static String resolveOrDefault(String themeCode) {
        String resolved = resolve(themeCode);
        return resolved != null ? resolved : APP_DEFAULT;
    }
}
