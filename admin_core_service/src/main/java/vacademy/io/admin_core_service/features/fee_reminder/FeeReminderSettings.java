package vacademy.io.admin_core_service.features.fee_reminder;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/**
 * An institute's payment reminder schedule: institute setting FEE_REMINDER_SETTING, saved from
 * Settings → Payment reminders. Off unless {@code enabled}. Example (Nrithya): 7 days before,
 * on the due date, then every 2 days after with no cutoff, red list at 15 days.
 */
public record FeeReminderSettings(
        boolean enabled,
        List<Integer> daysBefore,
        boolean onDueDate,
        int overdueEveryDays,
        Integer stopAfterDays,
        Integer redListAfterDays,
        boolean includeAutopay,
        int sendHour) {

    public static final String SETTING_KEY = "FEE_REMINDER_SETTING";

    public static FeeReminderSettings off() {
        return new FeeReminderSettings(false, List.of(7), true, 2, null, 15, false, 9);
    }

    /** Reads the setting's {@code data} object; anything missing takes the default. */
    public static FeeReminderSettings from(JsonNode data) {
        if (data == null || data.isMissingNode() || data.isNull()) return off();
        List<Integer> before = new ArrayList<>();
        if (data.path("days_before").isArray()) {
            data.path("days_before").forEach(n -> { if (n.canConvertToInt() && n.asInt() > 0 && n.asInt() <= 60) before.add(n.asInt()); });
        }
        return new FeeReminderSettings(
                data.path("enabled").asBoolean(false),
                before.isEmpty() && !data.has("days_before") ? List.of(7) : before,
                data.path("on_due_date").asBoolean(true),
                clamp(data.path("overdue_every_days").asInt(2), 0, 30),
                data.hasNonNull("stop_after_days") && data.path("stop_after_days").asInt(0) > 0
                        ? data.path("stop_after_days").asInt() : null,
                data.hasNonNull("red_list_after_days") && data.path("red_list_after_days").asInt(0) > 0
                        ? data.path("red_list_after_days").asInt() : null,
                data.path("include_autopay").asBoolean(false),
                clamp(data.path("send_hour").asInt(9), 0, 23));
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /**
     * The reminder step for a membership whose due date is {@code daysToDue} days away (negative =
     * overdue), or null when nothing goes out today.
     */
    public String stepFor(long daysToDue) {
        if (daysToDue > 0) {
            return daysBefore.contains((int) daysToDue) ? "BEFORE_" + daysToDue : null;
        }
        if (daysToDue == 0) return onDueDate ? "DUE" : null;
        long overdue = -daysToDue;
        if (overdueEveryDays <= 0) return null;
        if (stopAfterDays != null && overdue > stopAfterDays) return null;
        return overdue % overdueEveryDays == 0 ? "OVERDUE_" + overdue : null;
    }

    /** Furthest day before the due date anything is sent. */
    public int maxDaysBefore() {
        return daysBefore.stream().mapToInt(Integer::intValue).max().orElse(0);
    }
}
