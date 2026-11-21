package vacademy.io.auth_service.feature.panel.phase2.usage;

import vacademy.io.auth_service.feature.panel.service.PanelTimers;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * The arithmetic of the usage report, pure and in one place. Every time here is epoch milliseconds
 * read from the database clock.
 *
 * <p>Definitions:
 * <ul>
 * <li><b>Counted session</b>: a panel_session the panel actually picked up (panel_seen_at is set).
 * Sign-ins approved on a phone but never redeemed by the panel are not counted.</li>
 * <li><b>Effective end</b>: the earliest of ended_at (or now while it is still open), panel_seen_at
 * plus {@link PanelTimers#PANEL_ONLINE_MS}, active_until and expires_at. A session nobody closed is
 * only ended the next time something looks at it, so ended_at alone can be hours late; a signed-in
 * panel rewrites panel_seen_at every 30 s while it syncs, so a panel that lost power stops counting
 * within 90 s. active_until trims the idle tail of an IDLE sign-out.</li>
 * <li><b>Panel time</b>: effective end minus created_at, clipped to the report window, never negative.</li>
 * <li><b>Bucketing</b>: a session belongs to the local date of its start in the report's zone.
 * Sessions are capped in length, so a session that runs past midnight is not split.</li>
 * <li><b>Content time</b>: an event lasts until the next event of the same session (in sequence
 * order), or until the session's effective end, and at most {@link #MAX_EVENT_MS}. HOME events only
 * close the event before them and are not listed.</li>
 * <li><b>Coverage</b>: the share of counted sessions with at least one recorded event. Older app
 * builds record none, so missing content reads as "not recorded", never as zero use.</li>
 * </ul>
 *
 * <p>The content query in {@link PanelUsageRepository} applies the same rules in SQL; the database
 * integration test checks that the two agree.
 */
public final class PanelUsageMath {

    /** The zone used when the request names none, or one Java does not know. */
    public static final String DEFAULT_ZONE = "Asia/Kolkata";

    /** The longest stretch a single content event can count for. */
    public static final long MAX_EVENT_MS = 4L * 60 * 60 * 1000;

    public static final String HOME = "HOME";

    private PanelUsageMath() {
    }

    /** The zone of a request: a valid IANA id, otherwise {@link #DEFAULT_ZONE}. */
    public static ZoneId zoneOf(String tz) {
        if (tz == null || tz.isBlank() || tz.length() > 64) {
            return ZoneId.of(DEFAULT_ZONE);
        }
        try {
            return ZoneId.of(tz.trim());
        } catch (DateTimeException e) {
            return ZoneId.of(DEFAULT_ZONE);
        }
    }

    /** [start, end) of the inclusive local dates from..to in zone, as epoch milliseconds. */
    public static long[] window(LocalDate from, LocalDate to, ZoneId zone) {
        long start = from.atStartOfDay(zone).toInstant().toEpochMilli();
        long end = to.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        return new long[] { start, end };
    }

    /** The local date a session started on, in zone. */
    public static LocalDate localDate(long epochMs, ZoneId zone) {
        return Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate();
    }

    /**
     * The effective end of a session, before window clipping. Nullable arguments are columns that
     * may be null; nowMs is the database clock.
     */
    public static long effectiveEnd(long createdMs, Long endedMs, Long panelSeenMs, Long activeUntilMs,
            Long expiresMs, long nowMs) {
        long end = endedMs == null ? nowMs : Math.min(endedMs, nowMs);
        if (panelSeenMs != null) {
            end = Math.min(end, panelSeenMs + PanelTimers.PANEL_ONLINE_MS);
        }
        if (activeUntilMs != null) {
            end = Math.min(end, activeUntilMs);
        }
        if (expiresMs != null) {
            end = Math.min(end, expiresMs);
        }
        return Math.max(createdMs, end);
    }

    /** The effective end clipped to the end of the report window. */
    public static long clippedEnd(long createdMs, Long endedMs, Long panelSeenMs, Long activeUntilMs,
            Long expiresMs, long nowMs, long windowEndMs) {
        return Math.max(createdMs,
                Math.min(effectiveEnd(createdMs, endedMs, panelSeenMs, activeUntilMs, expiresMs, nowMs), windowEndMs));
    }

    /** Hours with one decimal, for the wire. */
    public static double hours(long ms) {
        return Math.round(ms / 360_000.0) / 10.0;
    }

    /** Whole minutes, rounded half up. */
    public static int minutes(long ms) {
        return (int) Math.round(ms / 60_000.0);
    }

    /** One event of a session, in sequence order. */
    public record Event(int seq, String kind, String title, long startedMs) {
    }

    /** An event with its duration. */
    public record TimedEvent(Event event, long durationMs) {
    }

    /**
     * The duration of each event of one session. events must be in sequence order. The result keeps
     * that order and leaves HOME events out.
     */
    public static List<TimedEvent> durations(List<Event> events, long sessionEndMs) {
        List<TimedEvent> timed = new ArrayList<>();
        for (int i = 0; i < events.size(); i++) {
            Event event = events.get(i);
            if (HOME.equals(event.kind())) {
                continue;
            }
            long until = i + 1 < events.size() ? events.get(i + 1).startedMs() : sessionEndMs;
            until = Math.min(until, sessionEndMs);
            until = Math.min(until, event.startedMs() + MAX_EVENT_MS);
            timed.add(new TimedEvent(event, Math.max(0, until - event.startedMs())));
        }
        return timed;
    }

    /** Percent of sessions with any event, rounded; null when there were no sessions. */
    public static Integer coveragePct(int sessionsWithEvents, int sessions) {
        if (sessions <= 0) {
            return null;
        }
        return (int) Math.round(100.0 * sessionsWithEvents / sessions);
    }
}
