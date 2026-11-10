package vacademy.io.auth_service.feature.panel.phase2;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath.Grant;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath.Result;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceMath.Room;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Institute and room seat states, pure: every enforcement against every institute state. */
class PanelLicenceStateTest {

    private static final Instant NOW = Instant.parse("2026-11-09T06:00:00Z");

    private static Instant days(long n) {
        return NOW.plus(Duration.ofDays(n));
    }

    private static Grant grant(String id, String kind, int seats, long fromDays, long toDays, int grace) {
        return new Grant(id, kind, seats, days(fromDays), days(toDays), grace, "ACTIVE");
    }

    private static Grant cancelled(Grant g) {
        return new Grant(g.id(), g.kind(), g.seats(), g.startsAt(), g.endsAt(), g.graceDays(), "CANCELLED");
    }

    private static final List<Room> ROOMS = List.of(new Room("r1", days(-30)), new Room("r2", days(-20)),
            new Room("r3", null));

    private static Result compute(String enforcement, List<Grant> grants) {
        return PanelLicenceMath.compute(enforcement, grants, ROOMS, NOW);
    }

    @Test
    void offIsUnmanagedWhateverTheGrantsButStillCountsSeats() {
        Result off = compute("OFF", List.of(grant("g", "PAID", 5, -1, 10, 0)));
        assertThat(off.state()).isEqualTo("UNMANAGED");
        assertThat(off.coverage()).isEqualTo("ACTIVE");
        assertThat(off.seats()).isEqualTo(5);
        assertThat(off.seatsUsed()).isEqualTo(2);
        assertThat(off.freeSeats()).isEqualTo(3);
        assertThat(compute(null, List.of()).state()).isEqualTo("UNMANAGED");
    }

    @Test
    void everyInstituteStateUnderShadowAndLive() {
        for (String mode : List.of("SHADOW", "LIVE")) {
            assertThat(compute(mode, List.of()).state()).isEqualTo("NONE");
            assertThat(compute(mode, List.of(grant("p", "PAID", 2, -1, 10, 0))).state()).isEqualTo("ACTIVE");
            assertThat(compute(mode, List.of(grant("c", "COMPLIMENTARY", 2, -1, 10, 0))).state()).isEqualTo("ACTIVE");
            assertThat(compute(mode, List.of(grant("t", "TRIAL", 2, -1, 10, 0))).state()).isEqualTo("TRIAL");
            assertThat(compute(mode, List.of(grant("t", "TRIAL", 1, -1, 10, 0), grant("p", "PAID", 1, -1, 10, 0)))
                    .state()).isEqualTo("ACTIVE");
            assertThat(compute(mode, List.of(grant("g", "PAID", 2, -30, -2, 5))).state()).isEqualTo("GRACE");
            assertThat(compute(mode, List.of(grant("e", "PAID", 2, -30, -6, 5))).state()).isEqualTo("EXPIRED");
            assertThat(compute(mode, List.of(cancelled(grant("x", "PAID", 2, -1, 10, 0)))).state()).isEqualTo("EXPIRED");
            assertThat(compute(mode, List.of(grant("f", "PAID", 2, 3, 10, 0))).state()).isEqualTo("NONE");
            assertThat(compute(mode, List.of(grant("e", "PAID", 2, -30, -6, 0), grant("f", "PAID", 2, 3, 10, 0)))
                    .state()).isEqualTo("EXPIRED");
            assertThat(compute(mode, List.of()).enforcement()).isEqualTo(mode);
        }
    }

    @Test
    void roomStatesFollowRankSeatsAndCoverage() {
        Result active = compute("LIVE", List.of(grant("p", "PAID", 2, -1, 10, 0)));
        assertThat(active.roomStates()).containsEntry("r1", "LICENSED").containsEntry("r2", "LICENSED")
                .containsEntry("r3", "UNLICENSED");

        Result grace = compute("LIVE", List.of(grant("g", "PAID", 2, -30, -1, 7)));
        assertThat(grace.roomStates()).containsEntry("r1", "GRACE").containsEntry("r2", "GRACE")
                .containsEntry("r3", "UNLICENSED");
        assertThat(grace.graceEndsAt()).isEqualTo(days(6));
        assertThat(grace.endsAt()).isNull();

        Result expired = compute("LIVE", List.of(grant("e", "PAID", 2, -30, -10, 0)));
        assertThat(expired.roomStates()).containsOnlyKeys("r1", "r2", "r3").allSatisfy((room, state) ->
                assertThat(state).isEqualTo("EXPIRED"));
        assertThat(compute("LIVE", List.of()).roomStates().get("r1")).isEqualTo("EXPIRED");
    }

    @Test
    void shrinkingGrantsPutTheNewestRoomsOverTheLimitWithoutTouchingRows() {
        Result shrunk = compute("LIVE", List.of(grant("p", "PAID", 1, -1, 10, 0)));
        assertThat(shrunk.roomStates()).containsEntry("r1", "LICENSED").containsEntry("r2", "OVER_LIMIT");
        assertThat(shrunk.seatsUsed()).isEqualTo(2);
        assertThat(shrunk.freeSeats()).isZero();

        // Same licensed_at: the id breaks the tie, so every pod ranks alike.
        List<Room> tie = List.of(new Room("b", days(-1)), new Room("a", days(-1)));
        Result ranked = PanelLicenceMath.compute("LIVE", List.of(grant("p", "PAID", 1, -1, 10, 0)), tie, NOW);
        assertThat(ranked.roomStates()).containsEntry("a", "LICENSED").containsEntry("b", "OVER_LIMIT");
    }

    @Test
    void seatsSumCoveringGrantsAndGraceSeatsOnlyKeepRoomsTheCoveringSeatsLeaveOut() {
        Result both = compute("LIVE", List.of(grant("a", "PAID", 2, -1, 10, 0), grant("b", "TRIAL", 3, -1, 4, 0),
                grant("old", "PAID", 9, -30, -1, 30)));
        assertThat(both.seats()).isEqualTo(5);
        assertThat(both.endsAt()).isEqualTo(days(10));
        // b ends first, but the 2 rooms still fit in a's 2 seats, so a's end is the one that matters.
        assertThat(both.endingGrantId()).isEqualTo("a");
        assertThat(both.firstEndsAt()).isEqualTo(days(10));
        // Covering seats hold both rooms, so the old grant's grace changes nothing.
        assertThat(both.graceSeats()).isZero();
        assertThat(both.graceEndsAt()).isNull();

        Result graceOnly = compute("LIVE", List.of(grant("old", "PAID", 9, -30, -1, 30)));
        assertThat(graceOnly.seats()).isEqualTo(9);
        assertThat(graceOnly.graceSeats()).isZero();
        assertThat(graceOnly.graceGrantId()).isEqualTo("old");
        assertThat(graceOnly.endingGrantId()).isNull();
    }

    private static List<Room> licensedRooms(int count) {
        List<Room> rooms = new java.util.ArrayList<>();
        for (int i = 1; i <= count; i++) {
            rooms.add(new Room(String.format("room-%02d", i), days(-100).plusSeconds(i)));
        }
        return rooms;
    }

    /** Grant A (10 seats, 14 grace days) ends at T1 = day 0 while grant B (10 seats) covers until day 200. */
    @Test
    void anEndingGrantKeepsItsRoomsInGraceWhileAnotherGrantCovers() {
        List<Grant> grants = List.of(grant("A", "PAID", 10, -200, 0, 14), grant("B", "PAID", 10, -200, 200, 0));
        List<Room> rooms = licensedRooms(20);

        Result before = PanelLicenceMath.compute("LIVE", grants, rooms, days(-5));
        assertThat(before.roomStates().values()).containsOnly("LICENSED");
        assertThat(before.endingGrantId()).isEqualTo("A");
        assertThat(before.firstEndsAt()).isEqualTo(days(0));
        assertThat(before.freeSeats()).isZero();

        Result inGrace = PanelLicenceMath.compute("LIVE", grants, rooms, days(1));
        assertThat(inGrace.coverage()).isEqualTo("ACTIVE");
        for (int i = 1; i <= 20; i++) {
            assertThat(inGrace.roomStates().get(String.format("room-%02d", i)))
                    .isEqualTo(i <= 10 ? "LICENSED" : "GRACE");
        }
        assertThat(inGrace.seats()).isEqualTo(10);
        assertThat(inGrace.graceSeats()).isEqualTo(10);
        assertThat(inGrace.freeSeats()).isZero();
        assertThat(inGrace.graceEndsAt()).isEqualTo(days(14));
        assertThat(inGrace.graceGrantId()).isEqualTo("A");

        Result after = PanelLicenceMath.compute("LIVE", grants, rooms, days(15));
        for (int i = 1; i <= 20; i++) {
            assertThat(after.roomStates().get(String.format("room-%02d", i)))
                    .isEqualTo(i <= 10 ? "LICENSED" : "OVER_LIMIT");
        }
        assertThat(after.graceSeats()).isZero();
        assertThat(after.graceEndsAt()).isNull();
    }

    /** A renewal C of the same size starting where A ends: nobody is in grace and no seat frees up. */
    @Test
    void aRenewalOfTheSameSizePutsNoRoomInGraceAndFreesNoSeat() {
        List<Grant> grants = List.of(grant("A", "PAID", 10, -200, 0, 14), grant("C", "PAID", 10, 0, 365, 14));
        List<Room> rooms = licensedRooms(10);
        Result renewed = PanelLicenceMath.compute("LIVE", grants, rooms, days(1));
        assertThat(renewed.roomStates().values()).containsOnly("LICENSED");
        assertThat(renewed.seats()).isEqualTo(10);
        assertThat(renewed.graceSeats()).isZero();
        assertThat(renewed.freeSeats()).isZero();
        assertThat(renewed.graceEndsAt()).isNull();
    }

    @Test
    void aGrantThatHasNotStartedIsNoneWithItsStartDateNotExpired() {
        Result future = compute("LIVE", List.of(grant("f", "PAID", 5, 3, 30, 0)));
        assertThat(future.coverage()).isEqualTo("NONE");
        assertThat(future.nextStartsAt()).isEqualTo(days(3));
        assertThat(future.roomStates().values()).doesNotContain("LICENSED", "GRACE");
        assertThat(future.freeSeats()).isZero();

        // A cancelled grant that never started counts as never started too.
        Result cancelledFuture = compute("LIVE", List.of(cancelled(grant("x", "PAID", 5, 3, 30, 0))));
        assertThat(cancelledFuture.coverage()).isEqualTo("NONE");
        assertThat(cancelledFuture.nextStartsAt()).isNull();

        Result endedAndFuture = compute("LIVE", List.of(grant("e", "PAID", 2, -30, -10, 0),
                grant("f", "PAID", 5, 3, 30, 0)));
        assertThat(endedAndFuture.coverage()).isEqualTo("EXPIRED");
        assertThat(endedAndFuture.nextStartsAt()).isEqualTo(days(3));
    }

    @Test
    void onlyLicensedAndGraceRoomsMayStart() {
        assertThat(Result.mayStart("LICENSED")).isTrue();
        assertThat(Result.mayStart("GRACE")).isTrue();
        for (String state : new String[] { "OVER_LIMIT", "UNLICENSED", "EXPIRED", "UNMANAGED", null }) {
            assertThat(Result.mayStart(state)).isFalse();
        }
    }
}
