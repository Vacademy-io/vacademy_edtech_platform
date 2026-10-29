package vacademy.io.admin_core_service.features.engagement.actions;

import java.util.Map;

/** Reading the brain's action fields: model-written text is capped and never trusted as anything but text. */
final class ActionText {

    static final int MAX_NOTE = 1000;

    private ActionText() {}

    static String text(Map<String, String> params, String key) {
        String v = params != null ? params.get(key) : null;
        if (v == null) return null;
        String t = v.replace('\u0000', ' ').strip();
        if (t.isEmpty()) return null;
        return t.length() <= MAX_NOTE ? t : t.substring(0, MAX_NOTE);
    }

    /** Whole hours from now, clamped to [min, max]; the default when absent or unreadable. */
    static int hours(Map<String, String> params, String key, int dflt, int min, int max) {
        String v = params != null ? params.get(key) : null;
        int h = dflt;
        if (v != null) {
            try {
                h = (int) Math.round(Double.parseDouble(v.trim()));
            } catch (NumberFormatException ignored) {
                h = dflt;
            }
        }
        return Math.max(min, Math.min(max, h));
    }
}
