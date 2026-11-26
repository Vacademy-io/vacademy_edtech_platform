package vacademy.io.admin_core_service.features.journey_status.service;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * An institute's journey statuses: institute setting {@code JOURNEY_STATUS_SETTING.data}, saved
 * from Settings → Journey status. Off unless {@code enabled}. Every rule works on a status's
 * {@code kind}, never its name, so a school can rename "Temporary Break" without breaking anything.
 *
 * <pre>
 * { "enabled": true,
 *   "statuses": [ { "key": "learning", "label": "Learning", "color": "#16a34a", "kind": "ACTIVE" }, ... ],
 *   "default_status": "learning",          // a learner-in-batch with no row has this status
 *   "status_on_pause": "temporary_break",  // set when a pause starts (Breaks and holds)
 *   "status_on_resume": "learning",        // set when the pause ends, if the learner is still on a break status
 *   "auto_risk": { "enabled": true, "status": "at_risk", "missed_classes": 3,
 *                  "fee_overdue_days": 15, "auto_return": true } }
 * </pre>
 */
public record JourneyStatusConfig(
        boolean enabled,
        List<Status> statuses,
        String defaultStatus,
        String statusOnPause,
        String statusOnResume,
        AutoRisk autoRisk) {

    public static final String SETTING_KEY = "JOURNEY_STATUS_SETTING";
    public static final Set<String> KINDS = Set.of("ACTIVE", "BREAK", "RISK", "STOPPED", "REENTRY");
    /** Most severe first: which of a learner's batches the list badge shows. */
    public static final List<String> SEVERITY = List.of("STOPPED", "RISK", "BREAK", "REENTRY", "ACTIVE");

    public record Status(String key, String label, String color, String kind) {}

    /** missedClasses / feeOverdueDays of 0 switch that rule off. */
    public record AutoRisk(boolean enabled, String status, int missedClasses, int feeOverdueDays, boolean autoReturn) {}

    /** Nrithya's seven statuses, offered to every institute that switches the feature on. */
    public static List<Status> defaultStatuses() {
        return List.of(
                new Status("learning", "Learning", "#16a34a", "ACTIVE"),
                new Status("break_plan", "Break Plan", "#0ea5e9", "BREAK"),
                new Status("temporary_break", "Temporary Break", "#f59e0b", "BREAK"),
                new Status("at_risk", "At Risk", "#dc2626", "RISK"),
                new Status("suspended", "Suspended", "#6b7280", "STOPPED"),
                new Status("journey_pause", "Journey Pause", "#8b5cf6", "BREAK"),
                new Status("re_entry", "Re-entry", "#14b8a6", "REENTRY"));
    }

    public static JourneyStatusConfig off() {
        return from(null);
    }

    /** Reads the setting's {@code data} object; anything missing or invalid takes the default. */
    public static JourneyStatusConfig from(JsonNode data) {
        boolean missing = data == null || data.isMissingNode() || data.isNull();
        List<Status> statuses = new ArrayList<>();
        Set<String> keys = new LinkedHashSet<>();
        if (!missing && data.path("statuses").isArray()) {
            for (JsonNode s : data.path("statuses")) {
                String key = normaliseKey(s.path("key").asText(""));
                String label = s.path("label").asText("").trim();
                String kind = s.path("kind").asText("").trim().toUpperCase(Locale.ROOT);
                if (key.isEmpty() || label.isEmpty() || !KINDS.contains(kind) || !keys.add(key)) continue;
                String color = s.path("color").asText("").trim();
                statuses.add(new Status(key, label.length() > 60 ? label.substring(0, 60) : label,
                        color.matches("#[0-9a-fA-F]{3,8}") ? color : "#6b7280", kind));
            }
        }
        if (statuses.isEmpty()) {
            statuses = new ArrayList<>(defaultStatuses());
            statuses.forEach(s -> keys.add(s.key()));
        }
        String firstActive = firstOfKind(statuses, "ACTIVE");
        String defaultStatus = pick(missing ? null : data.path("default_status").asText(null), keys,
                firstActive != null ? firstActive : statuses.get(0).key());
        String onPause = pick(missing ? null : data.path("status_on_pause").asText(null), keys,
                keys.contains("temporary_break") ? "temporary_break" : firstOfKind(statuses, "BREAK"));
        String onResume = pick(missing ? null : data.path("status_on_resume").asText(null), keys, defaultStatus);

        JsonNode r = missing ? null : data.path("auto_risk");
        boolean rMissing = r == null || r.isMissingNode() || r.isNull();
        AutoRisk risk = new AutoRisk(
                !rMissing && r.path("enabled").asBoolean(false),
                pick(rMissing ? null : r.path("status").asText(null), keys,
                        keys.contains("at_risk") ? "at_risk" : firstOfKind(statuses, "RISK")),
                rMissing || !r.has("missed_classes") ? 3 : clamp(r.path("missed_classes").asInt(3), 0, 20),
                rMissing || !r.has("fee_overdue_days") ? 15 : clamp(r.path("fee_overdue_days").asInt(15), 0, 365),
                rMissing || r.path("auto_return").asBoolean(true));
        return new JourneyStatusConfig(!missing && data.path("enabled").asBoolean(false), List.copyOf(statuses),
                defaultStatus, onPause, onResume, risk);
    }

    public Status status(String key) {
        if (key == null) return null;
        for (Status s : statuses) if (s.key().equals(key)) return s;
        return null;
    }

    /** The kind of a status key; an unknown key (removed from the list) counts as the default's kind. */
    public String kindOf(String key) {
        Status s = status(key == null ? defaultStatus : key);
        if (s == null) s = status(defaultStatus);
        return s == null ? "ACTIVE" : s.kind();
    }

    public String labelOf(String key) {
        Status s = status(key);
        return s == null ? key : s.label();
    }

    /** A status key from its key or its label ("Temporary Break", "temporary-break"), or null. */
    public String resolve(String keyOrLabel) {
        if (keyOrLabel == null || keyOrLabel.isBlank()) return null;
        String k = normaliseKey(keyOrLabel);
        for (Status s : statuses) {
            if (s.key().equals(k) || normaliseKey(s.label()).equals(k)) return s.key();
        }
        return null;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", enabled);
        List<Map<String, Object>> list = new ArrayList<>();
        for (Status s : statuses) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("key", s.key());
            x.put("label", s.label());
            x.put("color", s.color());
            x.put("kind", s.kind());
            list.add(x);
        }
        m.put("statuses", list);
        m.put("default_status", defaultStatus);
        m.put("status_on_pause", statusOnPause);
        m.put("status_on_resume", statusOnResume);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("enabled", autoRisk.enabled());
        r.put("status", autoRisk.status());
        r.put("missed_classes", autoRisk.missedClasses());
        r.put("fee_overdue_days", autoRisk.feeOverdueDays());
        r.put("auto_return", autoRisk.autoReturn());
        m.put("auto_risk", r);
        return m;
    }

    /** "Temporary Break" / "temporary-break" → "temporary_break". */
    public static String normaliseKey(String s) {
        if (s == null) return "";
        String k = s.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        return k.length() > 64 ? k.substring(0, 64) : k;
    }

    private static String firstOfKind(List<Status> statuses, String kind) {
        for (Status s : statuses) if (s.kind().equals(kind)) return s.key();
        return null;
    }

    private static String pick(String wanted, Set<String> keys, String fallback) {
        if (wanted != null) {
            String k = normaliseKey(wanted);
            if (keys.contains(k)) return k;
        }
        return fallback;
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
