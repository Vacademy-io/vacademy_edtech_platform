package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.EnumSet;
import java.util.Set;

/**
 * When an engine's planned messages go out. Stored next to the quiet hours in the engine's
 * quiet_hours JSON, so no column is needed:
 * <pre>{startHour, endHour, timezone, sendHour, sendMinute, days:[1..7], firstTouch}</pre>
 * <ul>
 *   <li>sendHour/sendMinute: the start of a one-hour send window ("every 2 days at 11:00" sends
 *       between 11:00 and 12:00). Unset = no fixed time; messages go whenever the engine decides,
 *       outside quiet hours, as before.</li>
 *   <li>days: ISO days of week (1 = Monday). Unset or empty = every day.</li>
 *   <li>firstTouch: IMMEDIATE (default) reaches a person who just joined right away, inside the
 *       allowed hours and days; SCHEDULED waits for the next send window.</li>
 * </ul>
 */
public record EngagementSendSchedule(ZoneId zone, Integer sendHour, int sendMinute,
                                     Set<DayOfWeek> days, boolean firstTouchImmediate,
                                     boolean firstTouchChosen) {

    /** Same default as the institute quiet-hours floor (PolicyGate). */
    public static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Kolkata");

    /** Length of the send window that starts at sendHour:sendMinute. */
    public static final Duration WINDOW = Duration.ofHours(1);

    public static final EngagementSendSchedule NONE =
            new EngagementSendSchedule(DEFAULT_ZONE, null, 0, EnumSet.allOf(DayOfWeek.class), true, false);

    public static EngagementSendSchedule of(String quietHoursJson, ObjectMapper objectMapper) {
        if (quietHoursJson == null || quietHoursJson.isBlank()) return NONE;
        try {
            return of(objectMapper.readTree(quietHoursJson));
        } catch (Exception e) {
            return NONE;
        }
    }

    public static EngagementSendSchedule of(JsonNode qh) {
        if (qh == null || !qh.isObject()) return NONE;
        ZoneId zone = DEFAULT_ZONE;
        if (qh.hasNonNull("timezone")) {
            try {
                zone = ZoneId.of(qh.get("timezone").asText());
            } catch (Exception ignored) {
                // unknown zone id → the floor's zone
            }
        }
        Integer hour = null;
        if (qh.hasNonNull("sendHour") && qh.get("sendHour").canConvertToInt()) {
            int h = qh.get("sendHour").asInt();
            if (h >= 0 && h < 24) hour = h;
        }
        int minute = qh.path("sendMinute").asInt(0);
        if (minute < 0 || minute > 59) minute = 0;
        Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
        JsonNode d = qh.get("days");
        if (d != null && d.isArray()) {
            for (JsonNode n : d) {
                int iso = n.asInt(0);
                if (iso >= 1 && iso <= 7) days.add(DayOfWeek.of(iso));
            }
        }
        if (days.isEmpty()) days = EnumSet.allOf(DayOfWeek.class);
        boolean immediate = !"SCHEDULED".equalsIgnoreCase(qh.path("firstTouch").asText("IMMEDIATE"));
        return new EngagementSendSchedule(zone, hour, minute, days, immediate, qh.hasNonNull("firstTouch"));
    }

    public boolean hasSendTime() {
        return sendHour != null;
    }

    public boolean allowsDay(Instant t) {
        return days.contains(t.atZone(zone).getDayOfWeek());
    }

    /**
     * The first moment at or after {@code from} inside a send window on an allowed day: {@code from}
     * itself when it already is, else the start of the next window. Without a send time, the first
     * moment on an allowed day.
     */
    public Instant nextSendTime(Instant from) {
        ZonedDateTime local = from.atZone(zone);
        if (!hasSendTime()) {
            return allowsDay(from) ? from : startOfNextAllowedDay(from);
        }
        for (int i = 0; i <= 8; i++) {
            ZonedDateTime day = local.toLocalDate().plusDays(i).atStartOfDay(zone);
            if (!days.contains(day.getDayOfWeek())) continue;
            ZonedDateTime start = day.withHour(sendHour).withMinute(sendMinute);
            ZonedDateTime end = start.plus(WINDOW);
            if (local.isBefore(start)) return start.toInstant();
            if (local.isBefore(end)) return from;
        }
        return from; // unreachable: at least one day is always allowed
    }

    /** Midnight (in the schedule's zone) of the first allowed day after {@code t}'s day. */
    public Instant startOfNextAllowedDay(Instant t) {
        ZonedDateTime day = t.atZone(zone).toLocalDate().atStartOfDay(zone);
        for (int i = 1; i <= 7; i++) {
            ZonedDateTime next = day.plusDays(i);
            if (days.contains(next.getDayOfWeek())) return next.toInstant();
        }
        return day.plusDays(1).toInstant();
    }

    /** Spread of first looks for people added together to an engine that reaches them right away. */
    public static final Duration ENROL_NOW_SPREAD = Duration.ofHours(1);

    /**
     * First look for someone added by an enrolment run ("Add people now", nightly reconcile).
     * An engine whose admin chose "reach them right away" looks within the hour (spread, so a big
     * list is not one burst); otherwise {@link #firstWake}. Engines saved before the choice
     * existed keep the old spread across the cadence.
     */
    public Instant enrolWake(int cadenceHours, Instant now) {
        if (firstTouchChosen && firstTouchImmediate) {
            return now.plus(Duration.ofMinutes(
                    java.util.concurrent.ThreadLocalRandom.current().nextLong(1, ENROL_NOW_SPREAD.toMinutes() + 1)));
        }
        return firstWake(cadenceHours, now);
    }

    /**
     * First look for people enrolled together (activation, nightly reconcile). With a send time:
     * spread inside the next send window, so the messages land in it. Without: spread across the
     * cadence, as before, so activation is a flat line, not a herd.
     */
    public Instant firstWake(int cadenceHours, Instant now) {
        if (!hasSendTime()) {
            return nextSendTime(EngagementDecisionService.jitteredFirstWake(cadenceHours, now));
        }
        Instant start = nextSendTime(now);
        long spreadMinutes = Math.max(1, WINDOW.toMinutes() - 15);
        Instant wake = start.plus(Duration.ofMinutes(
                java.util.concurrent.ThreadLocalRandom.current().nextLong(spreadMinutes)));
        // `now` already inside the window leaves less than a full window: never spread past its end.
        return nextSendTime(wake).equals(wake) ? wake : start;
    }
}
