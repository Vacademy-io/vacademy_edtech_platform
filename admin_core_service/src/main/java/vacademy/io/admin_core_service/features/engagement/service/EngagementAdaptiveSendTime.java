package vacademy.io.admin_core_service.features.engagement.service;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.OptionalInt;
import java.util.Set;
import java.util.function.IntPredicate;

/**
 * Someone who got three messages at the same time of day and answered none of them is probably
 * not looking at their phone then. The engine moves the next message to another time of day and
 * keeps that time until three more go unanswered, or the person writes back.
 *
 * The rules only: which sends count as a rut, and which hour to try next. Reading the history,
 * remembering the choice and the quiet-hour limits live in {@link EngagementDecisionService}.
 */
final class EngagementAdaptiveSendTime {

    /** Sends at the same hour, on different days, with no reply, before the time changes. */
    static final int STREAK = 3;

    /**
     * Hours to try instead, in order: roughly half a day away first (a morning slot becomes an
     * afternoon or evening one), then closer. The first one inside the allowed hours wins.
     */
    private static final int[] OFFSETS = {5, 4, 6, -5, 3, 7, -4, -6, 8, -3};

    private EngagementAdaptiveSendTime() {}

    /**
     * The local hour the last {@link #STREAK} sends all went out in, when they went out on
     * different days and the person has not written back since the oldest of them.
     *
     * @param sentNewestFirst when the engine's sends to this person went out, newest first
     * @param lastReplyAt     the person's latest reply on any channel; null when they never wrote
     */
    static OptionalInt stuckHour(List<Instant> sentNewestFirst, Instant lastReplyAt, ZoneId zone) {
        if (sentNewestFirst == null || sentNewestFirst.size() < STREAK) return OptionalInt.empty();
        List<Instant> last = sentNewestFirst.subList(0, STREAK);
        Instant oldest = last.get(STREAK - 1);
        if (lastReplyAt != null && lastReplyAt.isAfter(oldest)) return OptionalInt.empty();
        int hour = last.get(0).atZone(zone).getHour();
        Set<Object> days = new HashSet<>();
        for (Instant sent : last) {
            ZonedDateTime local = sent.atZone(zone);
            if (local.getHour() != hour) return OptionalInt.empty();
            days.add(local.toLocalDate());
        }
        return days.size() == STREAK ? OptionalInt.of(hour) : OptionalInt.empty();
    }

    /** The hour to move to from {@code stuckHour}; empty when no other hour is allowed. */
    static OptionalInt nextHour(int stuckHour, IntPredicate allowed) {
        for (int offset : OFFSETS) {
            int hour = Math.floorMod(stuckHour + offset, 24);
            if (allowed.test(hour)) return OptionalInt.of(hour);
        }
        return OptionalInt.empty();
    }

    /**
     * {@code time} moved to {@code hour} on its own local day (the minute stays, so people added
     * together do not all go out on the minute); on the next day when that is before {@code notBefore}.
     */
    static Instant atHour(Instant time, int hour, ZoneId zone, Instant notBefore) {
        ZonedDateTime moved = time.atZone(zone).withHour(hour).withSecond(0).withNano(0);
        if (moved.toInstant().isBefore(notBefore)) moved = moved.plusDays(1);
        return moved.toInstant();
    }
}
