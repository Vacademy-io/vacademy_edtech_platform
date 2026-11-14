package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageMath.Event;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageMath.TimedEvent;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** The usage arithmetic, pure: no Spring, no database. */
class PanelUsageMathTest {

    private static final long MIN = 60_000L;
    private static final long HOUR = 60 * MIN;
    private static final long T0 = Instant.parse("2026-11-03T04:00:00Z").toEpochMilli();
    private static final long FAR = Long.MAX_VALUE / 4;

    private static long end(Long ended, Long seen, Long activeUntil, Long expires, long now) {
        return PanelUsageMath.effectiveEnd(T0, ended, seen, activeUntil, expires, now);
    }

    @Test
    void signOutEndsAtEndedAtWhenThePanelWasSeenUntilThen() {
        long ended = T0 + 40 * MIN;
        assertThat(end(ended, ended - 20_000, null, T0 + 4 * HOUR, T0 + 5 * HOUR)).isEqualTo(ended);
    }

    @Test
    void abandonedSessionIsBoundedByPanelSeenPlusNinetySeconds() {
        // Ended much later by whoever looked next (EXPIRED, DEAD_MAN, SUPERSEDED), seen last at 25 min.
        long seen = T0 + 25 * MIN;
        assertThat(end(T0 + 3 * HOUR, seen, null, T0 + 4 * HOUR, T0 + 5 * HOUR)).isEqualTo(seen + 90_000);
    }

    @Test
    void stillOpenSessionRunsToNowButNotPastLastSeen() {
        long now = T0 + 30 * MIN;
        assertThat(end(null, now - 10_000, null, T0 + 4 * HOUR, now)).isEqualTo(now);
        assertThat(end(null, T0 + 5 * MIN, null, T0 + 4 * HOUR, now)).isEqualTo(T0 + 5 * MIN + 90_000);
    }

    @Test
    void idleSignOutStopsAtActiveUntil() {
        long ended = T0 + 2 * HOUR;
        long activeUntil = ended - 31 * MIN;
        assertThat(end(ended, ended - 30_000, activeUntil, T0 + 4 * HOUR, T0 + 5 * HOUR)).isEqualTo(activeUntil);
    }

    @Test
    void sessionNeverRunsPastItsCap() {
        long expires = T0 + 4 * HOUR;
        assertThat(end(null, T0 + 5 * HOUR, null, expires, T0 + 6 * HOUR)).isEqualTo(expires);
    }

    @Test
    void endIsNeverBeforeStart() {
        assertThat(end(T0 - MIN, T0 - 5 * MIN, T0 - 2 * MIN, null, T0 + HOUR)).isEqualTo(T0);
    }

    @Test
    void eachEndReasonUsesTheSameRule() {
        // The rule does not read end_reason: IDLE differs only through active_until.
        for (String reason : List.of("SIGN_OUT", "IDLE", "CLASS_END", "ADMIN", "PHONE", "REPLACED", "SUPERSEDED",
                "UNBOUND", "EXPIRED", "ACCESS_REMOVED", "DEAD_MAN")) {
            Long activeUntil = "IDLE".equals(reason) ? T0 + 10 * MIN : null;
            long expected = activeUntil != null ? activeUntil : T0 + 20 * MIN;
            assertThat(end(T0 + 20 * MIN, T0 + 20 * MIN, activeUntil, T0 + 4 * HOUR, T0 + 9 * HOUR))
                    .as(reason).isEqualTo(expected);
        }
    }

    @Test
    void windowClipsTheEnd() {
        long windowEnd = T0 + 30 * MIN;
        assertThat(PanelUsageMath.clippedEnd(T0, T0 + HOUR, T0 + HOUR, null, T0 + 4 * HOUR, T0 + 2 * HOUR,
                windowEnd)).isEqualTo(windowEnd);
        assertThat(PanelUsageMath.clippedEnd(T0, T0 + 10 * MIN, T0 + 10 * MIN, null, null, T0 + 2 * HOUR,
                windowEnd)).isEqualTo(T0 + 10 * MIN);
    }

    @Test
    void windowIsLocalMidnightToLocalMidnightInclusive() {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        long[] w = PanelUsageMath.window(LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-07"), ist);
        assertThat(Instant.ofEpochMilli(w[0])).isEqualTo(Instant.parse("2026-10-31T18:30:00Z"));
        assertThat(Instant.ofEpochMilli(w[1])).isEqualTo(Instant.parse("2026-11-07T18:30:00Z"));
    }

    @Test
    void bucketingAtTheIstMidnightEdge() {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        long justBefore = Instant.parse("2026-11-03T18:29:59Z").toEpochMilli();
        long midnight = Instant.parse("2026-11-03T18:30:00Z").toEpochMilli();
        assertThat(PanelUsageMath.localDate(justBefore, ist)).isEqualTo(LocalDate.parse("2026-11-03"));
        assertThat(PanelUsageMath.localDate(midnight, ist)).isEqualTo(LocalDate.parse("2026-11-04"));
        assertThat(PanelUsageMath.localDate(midnight, ZoneId.of("UTC"))).isEqualTo(LocalDate.parse("2026-11-03"));
    }

    @Test
    void unknownOrMissingZoneFallsBackToKolkata() {
        assertThat(PanelUsageMath.zoneOf(null).getId()).isEqualTo("Asia/Kolkata");
        assertThat(PanelUsageMath.zoneOf("Mars/Olympus").getId()).isEqualTo("Asia/Kolkata");
        assertThat(PanelUsageMath.zoneOf("").getId()).isEqualTo("Asia/Kolkata");
        assertThat(PanelUsageMath.zoneOf("Europe/Paris").getId()).isEqualTo("Europe/Paris");
    }

    @Test
    void contentLastsUntilTheNextEventAndHomeClosesButIsNotListed() {
        List<Event> events = List.of(new Event(1, "LESSON", "a", T0), new Event(2, "HOME", null, T0 + 10 * MIN),
                new Event(3, "DECK", "b", T0 + 15 * MIN), new Event(4, "WHITEBOARD", null, T0 + 40 * MIN));
        List<TimedEvent> timed = PanelUsageMath.durations(events, T0 + 50 * MIN);
        assertThat(timed).extracting(t -> t.event().kind()).containsExactly("LESSON", "DECK", "WHITEBOARD");
        assertThat(timed).extracting(TimedEvent::durationMs).containsExactly(10 * MIN, 25 * MIN, 10 * MIN);
    }

    @Test
    void contentIsCappedAtFourHoursAndAtTheSessionEnd() {
        List<TimedEvent> long1 = PanelUsageMath.durations(List.of(new Event(1, "DECK", "x", T0)), T0 + 6 * HOUR);
        assertThat(long1.get(0).durationMs()).isEqualTo(4 * HOUR);
        List<TimedEvent> cut = PanelUsageMath.durations(
                List.of(new Event(1, "DECK", "x", T0), new Event(2, "LESSON", "y", T0 + 2 * HOUR)), T0 + HOUR);
        assertThat(cut).extracting(TimedEvent::durationMs).containsExactly(HOUR, 0L);
    }

    @Test
    void outOfOrderTimesNeverGiveNegativeDurations() {
        List<TimedEvent> timed = PanelUsageMath.durations(
                List.of(new Event(1, "DECK", "x", T0 + 10 * MIN), new Event(2, "LESSON", "y", T0)), FAR);
        assertThat(timed.get(0).durationMs()).isZero();
    }

    @Test
    void roundingAndCoverage() {
        assertThat(PanelUsageMath.hours(90 * MIN)).isEqualTo(1.5);
        assertThat(PanelUsageMath.hours(0)).isEqualTo(0.0);
        assertThat(PanelUsageMath.minutes(89_999)).isEqualTo(1);
        assertThat(PanelUsageMath.minutes(29_999)).isZero();
        assertThat(PanelUsageMath.coveragePct(0, 0)).isNull();
        assertThat(PanelUsageMath.coveragePct(2, 3)).isEqualTo(67);
    }
}
