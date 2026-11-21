package vacademy.io.admin_core_service.features.hr_attendance.util;

import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;

import java.time.DayOfWeek;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Shared date/time helpers for the HR attendance and leave features.
 *
 * The JVM stays in UTC (platform rule); every "today"/"now" day-bucketing
 * decision must instead use the institute's configured timezone, falling back
 * to Asia/Kolkata when the config or timezone is missing or invalid.
 */
public final class HrTimeUtil {

    public static final String DEFAULT_TIMEZONE = "Asia/Kolkata";

    public static final List<String> DEFAULT_WEEKEND_DAYS = List.of("SATURDAY", "SUNDAY");

    private HrTimeUtil() {
    }

    /**
     * Resolves the institute's ZoneId from its attendance config. Falls back to
     * Asia/Kolkata when the config is absent, the timezone is blank, or the
     * value is not a valid zone id.
     */
    public static ZoneId resolveZone(AttendanceConfig config) {
        if (config != null && config.getTimezone() != null && !config.getTimezone().isBlank()) {
            try {
                return ZoneId.of(config.getTimezone().trim());
            } catch (Exception e) {
                // Invalid timezone value stored — fall through to the default.
            }
        }
        return ZoneId.of(DEFAULT_TIMEZONE);
    }

    /**
     * Resolves the institute's weekend days. A missing config or null list
     * defaults to Saturday/Sunday; an explicitly configured empty list means
     * "no weekend days". Malformed day names are skipped.
     */
    public static Set<DayOfWeek> resolveWeekendDays(AttendanceConfig config) {
        List<String> names = (config != null && config.getWeekendDays() != null)
                ? config.getWeekendDays()
                : DEFAULT_WEEKEND_DAYS;
        Set<DayOfWeek> weekendDays = new HashSet<>();
        for (String name : names) {
            if (name == null) {
                continue;
            }
            try {
                weekendDays.add(DayOfWeek.valueOf(name.trim().toUpperCase()));
            } catch (IllegalArgumentException e) {
                // Skip malformed entries
            }
        }
        return weekendDays;
    }
}
