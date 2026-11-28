package vacademy.io.admin_core_service.features.classroom.notify;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.DayOfWeek;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * An institute's CLASSROOM_NOTIFY_SETTING, saved through the generic institute
 * settings endpoint:
 *
 * <pre>
 * { "alerts_email": false, "alerts_whatsapp": false, "whatsapp_weekly": false,
 *   "hour": 9, "timezone": "Asia/Kolkata", "weekly_day": "MONDAY",
 *   "recipient_roles": ["ADMIN"], "recipient_user_ids": [] }
 * </pre>
 *
 * Every field has a working default and a malformed value falls back to it, so a
 * half-written blob never stops the job. The setting holds no phone numbers or
 * addresses: recipients are always resolved from the institute's own users at
 * send time.
 */
public record ClassroomNotifySetting(
        boolean alertsEmail,
        boolean alertsWhatsapp,
        boolean whatsappWeekly,
        int hour,
        ZoneId zone,
        DayOfWeek weeklyDay,
        List<String> recipientRoles,
        List<String> recipientUserIds) {

    public static final String SETTING_KEY = "CLASSROOM_NOTIFY_SETTING";

    static final int DEFAULT_HOUR = 9;
    static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Kolkata");
    static final DayOfWeek DEFAULT_WEEKLY_DAY = DayOfWeek.MONDAY;

    /** Any channel switched on. An institute with none is never looked at. */
    public boolean anyChannelOn() {
        return alertsEmail || alertsWhatsapp || whatsappWeekly;
    }

    public boolean wantsAlerts() {
        return alertsEmail || alertsWhatsapp;
    }

    /** Parse the setting's {@code data} node. Never throws; bad values take defaults. */
    public static ClassroomNotifySetting from(JsonNode data) {
        if (data == null || !data.isObject()) {
            return new ClassroomNotifySetting(false, false, false, DEFAULT_HOUR, DEFAULT_ZONE,
                    DEFAULT_WEEKLY_DAY, List.of("ADMIN"), List.of());
        }
        int hour = data.path("hour").isInt() ? data.path("hour").asInt() : DEFAULT_HOUR;
        if (hour < 0 || hour > 23) hour = DEFAULT_HOUR;

        return new ClassroomNotifySetting(
                data.path("alerts_email").asBoolean(false),
                data.path("alerts_whatsapp").asBoolean(false),
                data.path("whatsapp_weekly").asBoolean(false),
                hour,
                zone(data.path("timezone").asText(null)),
                weekday(data.path("weekly_day").asText(null)),
                strings(data.path("recipient_roles"), List.of("ADMIN"), true),
                strings(data.path("recipient_user_ids"), List.of(), false));
    }

    static ZoneId zone(String raw) {
        if (raw == null || raw.isBlank()) return DEFAULT_ZONE;
        try {
            return ZoneId.of(raw.trim());
        } catch (Exception e) {
            return DEFAULT_ZONE;
        }
    }

    static DayOfWeek weekday(String raw) {
        if (raw == null || raw.isBlank()) return DEFAULT_WEEKLY_DAY;
        try {
            return DayOfWeek.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (Exception e) {
            return DEFAULT_WEEKLY_DAY;
        }
    }

    private static List<String> strings(JsonNode node, List<String> fallback, boolean upper) {
        if (node == null || !node.isArray()) return fallback;
        List<String> out = new ArrayList<>();
        for (JsonNode n : node) {
            if (!n.isTextual()) continue;
            String v = n.asText().trim();
            if (v.isEmpty() || v.length() > 255) continue;
            v = upper ? v.toUpperCase(Locale.ROOT) : v;
            if (!out.contains(v)) out.add(v);
            if (out.size() >= 100) break;
        }
        return out.isEmpty() ? fallback : List.copyOf(out);
    }
}
