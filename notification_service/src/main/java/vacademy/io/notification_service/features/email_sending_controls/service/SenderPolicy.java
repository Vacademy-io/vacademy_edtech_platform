package vacademy.io.notification_service.features.email_sending_controls.service;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.notification_service.constants.NotificationConstants;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Set;

/**
 * The sending rules an institute has put on one sender (EMAIL_SETTING.data.<type>).
 * Everything is optional; a node without these fields behaves exactly as before.
 *
 * @param maxPerDay       the cap that applies TODAY — already has the warm-up ramp applied,
 *                        so callers never do the arithmetic themselves. 0 = unlimited.
 * @param pausedToday     sending is closed for today (weekend skip). Distinct from maxPerDay=0,
 *                        which means "no limit".
 * @param zone            day boundary for the cap (default UTC)
 * @param sendAfterHour   local hour the next day's window opens (default 0)
 * @param postalAddress   CAN-SPAM footer address (may be null)
 * @param listUnsubscribe add unsubscribe headers/footer even for non-promotional types
 * @param skipWeekends    no sending on Saturday/Sunday in the sender's zone
 * @param ramp            the warm-up schedule, or null when the cap is a flat number
 */
public record SenderPolicy(int maxPerDay, boolean pausedToday, ZoneId zone, int sendAfterHour,
                           String postalAddress, boolean listUnsubscribe, boolean skipWeekends,
                           RampPlan ramp) {

    public static final SenderPolicy NONE =
            new SenderPolicy(0, false, ZoneId.of("UTC"), 0, null, false, false, null);

    /**
     * A warm-up schedule: start small and widen on a fixed cadence until the ceiling.
     * Mailbox providers judge a new domain on how its volume grows, so the ramp is
     * expressed in days-since-start rather than in messages sent — skipping a day must
     * not buy extra volume later.
     *
     * @param startPerDay cap on day 0
     * @param step        added at each increase
     * @param everyDays   days between increases
     * @param ceiling     the cap never exceeds this
     * @param startedOn   day 0, in the sender's zone
     */
    public record RampPlan(int startPerDay, int step, int everyDays, int ceiling, LocalDate startedOn) {

        /** The cap this schedule allows on a given day. */
        public int capOn(LocalDate day) {
            if (startedOn == null || day.isBefore(startedOn)) return Math.max(0, startPerDay);
            long elapsed = ChronoUnit.DAYS.between(startedOn, day);
            long stages = everyDays > 0 ? elapsed / everyDays : 0;
            long cap = (long) startPerDay + stages * step;
            return (int) Math.max(0, Math.min(cap, ceiling > 0 ? ceiling : cap));
        }

        /** The next day the cap goes up, or null once the ceiling is reached. */
        public LocalDate nextIncreaseAfter(LocalDate day) {
            if (startedOn == null || everyDays <= 0 || step <= 0) return null;
            if (ceiling > 0 && capOn(day) >= ceiling) return null;
            long elapsed = Math.max(0, ChronoUnit.DAYS.between(startedOn, day));
            long stages = elapsed / everyDays;
            return startedOn.plusDays((stages + 1) * everyDays);
        }
    }

    public static SenderPolicy from(JsonNode node) {
        if (node == null || node.isMissingNode() || !node.isObject()) return NONE;

        ZoneId zone = ZoneId.of("UTC");
        String tz = node.path(NotificationConstants.TIMEZONE).asText("");
        if (!tz.isBlank()) {
            try { zone = ZoneId.of(tz.trim()); } catch (Exception ignored) { /* keep UTC on a bad value */ }
        }
        int hour = node.path(NotificationConstants.SEND_AFTER_HOUR).asInt(0);
        if (hour < 0 || hour > 23) hour = 0;
        String addr = node.path(NotificationConstants.POSTAL_ADDRESS).asText("");
        boolean lu = node.path(NotificationConstants.LIST_UNSUBSCRIBE).asBoolean(false);
        boolean skipWeekends = node.path(NotificationConstants.SKIP_WEEKENDS).asBoolean(false);

        LocalDate today = LocalDate.now(zone);
        RampPlan ramp = readRamp(node, today);
        int max = ramp != null
                ? ramp.capOn(today)
                : Math.max(0, node.path(NotificationConstants.MAX_PER_DAY).asInt(0));

        boolean paused = skipWeekends
                && (today.getDayOfWeek() == DayOfWeek.SATURDAY || today.getDayOfWeek() == DayOfWeek.SUNDAY);

        return new SenderPolicy(max, paused, zone, hour, addr.isBlank() ? null : addr.trim(), lu, skipWeekends, ramp);
    }

    private static RampPlan readRamp(JsonNode node, LocalDate today) {
        if (!node.path(NotificationConstants.RAMP_ENABLED).asBoolean(false)) return null;
        int start = Math.max(0, node.path(NotificationConstants.RAMP_START_PER_DAY).asInt(20));
        int step = Math.max(0, node.path(NotificationConstants.RAMP_STEP).asInt(20));
        int every = Math.max(1, node.path(NotificationConstants.RAMP_EVERY_DAYS).asInt(7));
        int ceiling = Math.max(0, node.path(NotificationConstants.RAMP_CEILING).asInt(0));
        LocalDate startedOn = today;
        String stored = node.path(NotificationConstants.RAMP_STARTED_ON).asText("");
        if (!stored.isBlank()) {
            try { startedOn = LocalDate.parse(stored.trim()); } catch (Exception ignored) { /* today */ }
        }
        return new RampPlan(start, step, every, ceiling, startedOn);
    }

    /** True when a limit applies today — either a cap or a weekend pause. */
    public boolean capped() { return pausedToday || maxPerDay > 0; }

    /** Calendar day the cap is counted against, right now, in the sender's zone. */
    public LocalDate today() { return LocalDate.now(zone); }

    /** When the next sending window opens, as server-local time. Skips the weekend when asked. */
    public LocalDateTime nextWindow() {
        LocalDate day = LocalDate.now(zone).plusDays(1);
        if (skipWeekends) {
            while (day.getDayOfWeek() == DayOfWeek.SATURDAY || day.getDayOfWeek() == DayOfWeek.SUNDAY) {
                day = day.plusDays(1);
            }
        }
        ZonedDateTime next = day.atStartOfDay(zone).plusHours(sendAfterHour);
        return next.withZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
    }

    /**
     * Commercial mail must carry an unsubscribe path. Two codes mean "commercial" in this
     * codebase and they come from different screens: the campaign dialog sends
     * PROMOTIONAL_EMAIL, while Settings saves a marketing sender as MARKETING_EMAIL.
     * Both are covered, and any other type can opt in with list_unsubscribe.
     */
    private static final Set<String> COMMERCIAL_TYPES =
            Set.of(NotificationConstants.PROMOTIONAL_EMAIL, NotificationConstants.MARKETING_EMAIL);

    /** Whether unsubscribe headers + footer apply to a send of this type. */
    public boolean unsubscribeApplies(String emailType) {
        return listUnsubscribe
                || (emailType != null && COMMERCIAL_TYPES.contains(emailType.trim().toUpperCase(Locale.ROOT)));
    }

    /** Stable counter key for one sender identity. */
    public static String senderKey(String instituteId, String emailType, String fromEmail) {
        return ((instituteId == null ? "-" : instituteId) + "|" + (emailType == null ? "UTILITY_EMAIL" : emailType)
                + "|" + (fromEmail == null ? "-" : fromEmail)).toLowerCase(Locale.ROOT);
    }
}
