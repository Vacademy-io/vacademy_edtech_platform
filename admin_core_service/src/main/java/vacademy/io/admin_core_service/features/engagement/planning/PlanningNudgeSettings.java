package vacademy.io.admin_core_service.features.engagement.planning;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The weekly planning email's settings: ENGAGEMENT_SETTING.data.planningNudge.
 *
 * <p>Off unless an admin turns it on. Defaults: Friday 16:00 institute time, one reminder
 * 24 hours later, Monday–Friday plans of 2 tasks a day, and the AI draft waits for the
 * teacher's review (autoPublish false).
 *
 * @param sendDay         ISO day of week the email goes out, 1 = Monday … 7 = Sunday.
 * @param sendHour        institute-local hour, 0–23.
 * @param reminderHours   hours after the first email before one reminder; 0 = none.
 * @param autoPublish     publish the AI draft straight away instead of saving it as a draft.
 * @param runDays         MON_FRI | MON_SAT | ALL — which days of the week the plan runs.
 * @param tasksPerDay     tasks the AI drafts for each day, 1–5.
 * @param packageSessionIds batches to cover; empty = every batch that has a teacher.
 */
public record PlanningNudgeSettings(boolean enabled, int sendDay, int sendHour, int reminderHours,
                                    boolean autoPublish, String runDays, int tasksPerDay,
                                    Set<String> packageSessionIds) {

    public static final String KEY = "planningNudge";

    public static PlanningNudgeSettings defaults() {
        return new PlanningNudgeSettings(false, 5, 16, 24, false, "MON_FRI", 2, Set.of());
    }

    /** Parses the setting map; anything missing or malformed takes its default. */
    public static PlanningNudgeSettings from(Map<?, ?> engagementSetting) {
        PlanningNudgeSettings d = defaults();
        if (engagementSetting == null || !(engagementSetting.get(KEY) instanceof Map<?, ?> m)) return d;
        String runDays = m.get("runDays") instanceof String s && List.of("MON_FRI", "MON_SAT", "ALL").contains(s)
                ? s : d.runDays();
        Set<String> batches = new LinkedHashSet<>();
        if (m.get("packageSessionIds") instanceof Collection<?> c) {
            for (Object o : c) if (o instanceof String s && !s.isBlank()) batches.add(s.strip());
        }
        return new PlanningNudgeSettings(
                Boolean.TRUE.equals(m.get("enabled")),
                intOf(m.get("sendDay"), d.sendDay(), 1, 7),
                intOf(m.get("sendHour"), d.sendHour(), 0, 23),
                intOf(m.get("reminderHours"), d.reminderHours(), 0, 96),
                Boolean.TRUE.equals(m.get("autoPublish")),
                runDays,
                intOf(m.get("tasksPerDay"), d.tasksPerDay(), 1, 5),
                Set.copyOf(batches));
    }

    /** Whether the plan runs on this date. */
    public boolean runsOn(LocalDate date) {
        DayOfWeek dow = date.getDayOfWeek();
        return switch (runDays) {
            case "ALL" -> true;
            case "MON_SAT" -> dow != DayOfWeek.SUNDAY;
            default -> dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY;
        };
    }

    /**
     * The run dates of the week starting {@code weekStart} that are still ahead: on or
     * after {@code earliest}. Empty when the week is over.
     */
    public List<LocalDate> remainingDates(LocalDate weekStart, LocalDate earliest) {
        List<LocalDate> out = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            LocalDate d = weekStart.plusDays(i);
            if (!d.isBefore(earliest) && runsOn(d)) out.add(d);
        }
        return out;
    }

    /**
     * The Monday of the week an email sent on {@code today} asks about: today when today is
     * Monday (a Monday-morning email plans the week ahead of it), else the coming Monday.
     */
    public static LocalDate weekToPlan(LocalDate today) {
        int dow = today.getDayOfWeek().getValue();
        return dow == 1 ? today : today.plusDays(8 - dow);
    }

    private static int intOf(Object raw, int fallback, int min, int max) {
        if (raw == null) return fallback;
        try {
            int v = raw instanceof Number n ? n.intValue() : Integer.parseInt(raw.toString().strip());
            return Math.max(min, Math.min(max, v));
        } catch (Exception e) {
            return fallback;
        }
    }
}
