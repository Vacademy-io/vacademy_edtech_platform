package vacademy.io.admin_core_service.features.telephony.core;

import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * The institute's calling shifts, evaluated in its own timezone.
 *
 * <p>Lifted verbatim out of {@code CallAiNodeHandler}, which had these as private
 * helpers because it was the only thing that needed them: dialling used to be
 * immediate, so only the timed retry re-dialer could ever land outside a shift.
 * The AI call queue changes that — an item can wait hours for a slot — so the
 * drainer has to make the same judgement, and there must be exactly one
 * implementation of "is 21:04 inside 09:00–21:00" in the codebase.
 *
 * <p>{@code CallAiNodeHandler} now delegates here; its behaviour is unchanged.
 */
public final class CallingWindowUtil {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private CallingWindowUtil() {}

    /** Inside any [start,end] shift (institute tz); handles windows wrapping midnight. */
    public static boolean withinAnyShift(Instant now, List<AiCallingSettingsPojo.Shift> shifts, ZoneId tz) {
        if (shifts == null || shifts.isEmpty()) return true;
        LocalTime t = LocalTime.ofInstant(now, tz);
        for (AiCallingSettingsPojo.Shift sh : shifts) {
            LocalTime start = parseTime(sh.getStart());
            LocalTime end = parseTime(sh.getEnd());
            if (start == null || end == null) continue;
            if (start.equals(end)) return true; // 24h
            boolean within = start.isBefore(end)
                    ? (!t.isBefore(start) && !t.isAfter(end))
                    : (!t.isBefore(start) || !t.isAfter(end));
            if (within) return true;
        }
        return false;
    }

    /**
     * Earliest upcoming shift-open instant in the institute tz: the smallest shift
     * start that is still ahead of {@code now} today; if none remain today, the
     * smallest shift start tomorrow. Returns null if no usable shift starts (caller
     * falls back to its own recheck time).
     */
    public static Instant nextShiftOpen(Instant now, List<AiCallingSettingsPojo.Shift> shifts, ZoneId tz) {
        if (shifts == null || shifts.isEmpty()) return null;
        LocalDate today = LocalDate.now(tz);
        LocalTime nowT = LocalTime.ofInstant(now, tz);

        LocalTime earliestToday = null;   // smallest start still ahead today
        LocalTime earliestOverall = null; // smallest start of the day (for tomorrow)
        for (AiCallingSettingsPojo.Shift sh : shifts) {
            LocalTime start = parseTime(sh.getStart());
            if (start == null) continue;
            if (earliestOverall == null || start.isBefore(earliestOverall)) earliestOverall = start;
            if (start.isAfter(nowT) && (earliestToday == null || start.isBefore(earliestToday))) {
                earliestToday = start;
            }
        }
        if (earliestToday != null) return today.atTime(earliestToday).atZone(tz).toInstant();
        if (earliestOverall != null) return today.plusDays(1).atTime(earliestOverall).atZone(tz).toInstant();
        return null;
    }

    public static LocalTime parseTime(String hhmm) {
        if (hhmm == null || hhmm.isBlank()) return null;
        try {
            return LocalTime.parse(hhmm.trim());
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    public static ZoneId resolveZone(String tz) {
        if (tz == null || tz.isBlank()) return IST;
        try {
            return ZoneId.of(tz.trim());
        } catch (Exception e) {
            return IST;
        }
    }
}
