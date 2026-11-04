package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The teacher's pen on an AI checked copy: ink colour, darkness, handwriting face and size.
 * Saved by the institute as {@code ASSESSMENT_SETTING.aiCopyCheck.penStyle}, or chosen
 * by a teacher when re-drawing one copy; sent to ai_service as {@code pen_style}
 * (see ai_service services/copy_check/pen_style.py, which accepts the same values).
 *
 * <p>{@link #clean} keeps only values ai_service understands and returns null when the
 * result is the usual pen (red, Dawning of a New Day, medium), so a request without a choice stays
 * exactly what it was.
 */
public final class CopyPenStyle {

    public static final Set<String> INKS = Set.of("RED", "BLUE", "GREEN", "BLACK", "PURPLE");
    public static final String DEFAULT_FONT = "DAWNING_OF_A_NEW_DAY";
    public static final Set<String> FONTS = Set.of(DEFAULT_FONT, "COVERED_BY_YOUR_GRACE", "OVER_THE_RAINBOW", "CAVEAT",
            "CEDARVILLE_CURSIVE",
            "KALAM", "PATRICK_HAND", "ARCHITECTS_DAUGHTER");
    private static final int NEUTRAL_DARKNESS = 50;
    public static final Set<String> SIZES = Set.of("SMALL", "MEDIUM", "LARGE");
    private static final Pattern HEX = Pattern.compile("^#?[0-9a-fA-F]{6}$");

    private CopyPenStyle() {
    }

    public static Map<String, Object> clean(Object raw) {
        if (!(raw instanceof Map<?, ?> map)) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        String ink = text(map.get("ink"));
        if (ink != null) {
            String up = ink.toUpperCase(Locale.ROOT);
            if (INKS.contains(up) && !"RED".equals(up)) {
                out.put("ink", up);
            } else if (HEX.matcher(ink).matches()) {
                out.put("ink", ink.startsWith("#") ? ink : "#" + ink);
            }
        }
        String font = upper(map.get("font"));
        if (font != null && FONTS.contains(font) && !DEFAULT_FONT.equals(font)) {
            out.put("font", font);
        }
        String size = upper(map.get("size"));
        if (size != null && SIZES.contains(size) && !"MEDIUM".equals(size)) {
            out.put("size", size);
        }
        if (map.get("darkness") instanceof Number n) {
            int darkness = (int) Math.max(0, Math.min(100, Math.round(n.doubleValue())));
            if (darkness != NEUTRAL_DARKNESS) {
                out.put("darkness", darkness);
            }
        }
        return out.isEmpty() ? null : out;
    }

    private static String text(Object v) {
        if (v == null) return null;
        String s = v.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private static String upper(Object v) {
        String s = text(v);
        return s == null ? null : s.toUpperCase(Locale.ROOT);
    }
}
