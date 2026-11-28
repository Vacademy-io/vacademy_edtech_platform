package vacademy.io.auth_service.feature.panel.phase2.licence;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Room seats, computed on read from the grants and the rooms. Pure: no database, no clock of its
 * own (the caller passes the database's now), so every rule here is unit tested.
 *
 * <p><b>Institute state</b>, over grants with status ACTIVE:
 * <ul>
 * <li>ACTIVE: a PAID or COMPLIMENTARY grant covers now (starts_at &lt;= now &lt; ends_at).</li>
 * <li>TRIAL: only TRIAL grants cover now.</li>
 * <li>GRACE: nothing covers now, but a grant ended less than its grace_days ago.</li>
 * <li>EXPIRED: a grant has already started (any status) and none covers now or is in grace.</li>
 * <li>NONE: no grant has started yet: the institute never had one, or its first grant starts later
 * ({@code nextStartsAt}).</li>
 * </ul>
 * With enforcement OFF the reported state is UNMANAGED, which is phase 1: nothing is shown and
 * nothing refused. Seats are counted the same way under every enforcement, so an admin can hand out
 * seats before enforcement is switched on.
 *
 * <p><b>Seats</b> = the sum over covering grants, or over grace grants while in GRACE. Seats are what
 * an admin may hand out ({@link Result#freeSeats()}).
 *
 * <p><b>Grace seats</b>: while some grant covers, the seats of grants that ended less than their
 * grace_days ago are kept on top of the covering seats, but only for rooms that already hold a seat:
 * they never make a seat free to assign. A renewal of the same size starting where the old grant
 * ended already covers every room, so its grace seats change nothing.
 *
 * <p><b>Room state</b>, for ACTIVE rooms: licensed rooms are ranked by (licensed_at, id). A rank
 * within the seat count is LICENSED (GRACE while the institute is in grace); within the seat count
 * plus the grace seats GRACE; beyond that OVER_LIMIT, which happens when grants shrink. Rows are never
 * changed automatically: the admin chooses what to release. A room without a seat is UNLICENSED.
 * Every room reads EXPIRED while the institute is EXPIRED or NONE.
 */
public final class PanelLicenceMath {

    public static final String OFF = "OFF";
    public static final String SHADOW = "SHADOW";
    public static final String LIVE = "LIVE";

    public static final String UNMANAGED = "UNMANAGED";
    public static final String ACTIVE = "ACTIVE";
    public static final String TRIAL = "TRIAL";
    public static final String GRACE = "GRACE";
    public static final String EXPIRED = "EXPIRED";
    public static final String NONE = "NONE";

    public static final String LICENSED = "LICENSED";
    public static final String OVER_LIMIT = "OVER_LIMIT";
    public static final String UNLICENSED = "UNLICENSED";

    private PanelLicenceMath() {
    }

    /** A grant row. status is ACTIVE or CANCELLED; only ACTIVE grants give seats. */
    public record Grant(String id, String kind, int seats, Instant startsAt, Instant endsAt, int graceDays,
            String status) {
        boolean live() {
            return "ACTIVE".equals(status);
        }

        boolean covers(Instant now) {
            return live() && !startsAt.isAfter(now) && endsAt.isAfter(now);
        }

        Instant graceEndsAt() {
            return endsAt.plus(Duration.ofDays(graceDays));
        }

        boolean inGrace(Instant now) {
            return live() && !endsAt.isAfter(now) && graceEndsAt().isAfter(now);
        }
    }

    /** An ACTIVE room; licensedAt is null when it holds no seat. */
    public record Room(String id, Instant licensedAt) {
    }

    /**
     * state follows the enforcement (UNMANAGED when OFF); coverage is the same computation without
     * it (ACTIVE, TRIAL, GRACE, EXPIRED or NONE). roomStates holds every room passed in, by the
     * coverage rules, whatever the enforcement: callers decide whether to show them.
     *
     * <ul>
     * <li>seats: covering seats, or grace seats while in GRACE. graceSeats: seats of grants in grace
     * that keep rooms beyond the covering seats working (0 when nothing covers, or when the covering
     * seats already hold every licensed room).</li>
     * <li>endsAt: the latest end among covering grants. graceEndsAt: the latest grace end among
     * grants in grace, while in GRACE or while graceSeats &gt; 0. graceGrantId: the grant with that
     * grace end.</li>
     * <li>endingGrantId / firstEndsAt: the earliest-ending covering grant whose end takes a seat a
     * room holds (seatsUsed &gt; seats - its seats), or that ends the coverage altogether.</li>
     * <li>nextStartsAt: the earliest start of a live grant that has not started yet.</li>
     * </ul>
     */
    public record Result(String enforcement, String state, String coverage, int seats, int seatsUsed,
            Instant endsAt, Instant graceEndsAt, String endingGrantId, Map<String, String> roomStates,
            int graceSeats, Instant firstEndsAt, String graceGrantId, Instant nextStartsAt) {

        /** Seats nobody holds yet. Never negative. Grace seats never count. */
        public int freeSeats() {
            return Math.max(0, seats - seatsUsed);
        }

        /** A room in this state may start a session when enforcement is LIVE. */
        public static boolean mayStart(String roomState) {
            return LICENSED.equals(roomState) || GRACE.equals(roomState);
        }
    }

    public static Result compute(String enforcement, List<Grant> grants, List<Room> rooms, Instant now) {
        String mode = enforcement == null ? OFF : enforcement;
        List<Grant> covering = new ArrayList<>();
        List<Grant> grace = new ArrayList<>();
        for (Grant grant : grants) {
            if (grant.covers(now)) {
                covering.add(grant);
            } else if (grant.inGrace(now)) {
                grace.add(grant);
            }
        }

        String coverage;
        if (covering.stream().anyMatch(g -> !"TRIAL".equals(g.kind()))) {
            coverage = ACTIVE;
        } else if (!covering.isEmpty()) {
            coverage = TRIAL;
        } else if (!grace.isEmpty()) {
            coverage = GRACE;
        } else if (grants.stream().anyMatch(g -> !g.startsAt().isAfter(now))) {
            coverage = EXPIRED;
        } else {
            coverage = NONE;
        }

        int coveringSeats = 0;
        Instant endsAt = null;
        for (Grant grant : covering) {
            coveringSeats += grant.seats();
            endsAt = endsAt == null || grant.endsAt().isAfter(endsAt) ? grant.endsAt() : endsAt;
        }
        int graceTotal = 0;
        Instant graceEndsAt = null;
        String graceGrantId = null;
        for (Grant grant : grace) {
            graceTotal += grant.seats();
            if (graceEndsAt == null || grant.graceEndsAt().isAfter(graceEndsAt)) {
                graceEndsAt = grant.graceEndsAt();
                graceGrantId = grant.id();
            }
        }
        List<Room> licensed = rooms.stream()
                .filter(room -> room.licensedAt() != null)
                .sorted(Comparator.comparing(Room::licensedAt).thenComparing(Room::id))
                .toList();
        int seatsUsed = licensed.size();

        int seats = covering.isEmpty() ? graceTotal : coveringSeats;
        // Grace seats on top of covering seats count only for rooms the covering seats leave out.
        int graceSeats = covering.isEmpty() ? 0 : Math.min(graceTotal, Math.max(0, seatsUsed - coveringSeats));
        if (!covering.isEmpty() && graceSeats == 0) {
            graceEndsAt = null;
            graceGrantId = null;
        }

        String endingGrantId = null;
        Instant firstEndsAt = null;
        for (Grant grant : covering) {
            boolean matters = seatsUsed > coveringSeats - grant.seats() || grant.endsAt().equals(endsAt);
            if (matters && (firstEndsAt == null || grant.endsAt().isBefore(firstEndsAt))) {
                firstEndsAt = grant.endsAt();
                endingGrantId = grant.id();
            }
        }
        Instant nextStartsAt = null;
        for (Grant grant : grants) {
            if (grant.live() && grant.startsAt().isAfter(now)
                    && (nextStartsAt == null || grant.startsAt().isBefore(nextStartsAt))) {
                nextStartsAt = grant.startsAt();
            }
        }

        Map<String, Integer> rank = new LinkedHashMap<>();
        for (int i = 0; i < licensed.size(); i++) {
            rank.put(licensed.get(i).id(), i + 1);
        }
        boolean lapsed = EXPIRED.equals(coverage) || NONE.equals(coverage);
        Map<String, String> roomStates = new LinkedHashMap<>();
        for (Room room : rooms) {
            String state;
            if (lapsed) {
                state = EXPIRED;
            } else if (room.licensedAt() == null) {
                state = UNLICENSED;
            } else if (rank.get(room.id()) <= seats) {
                state = GRACE.equals(coverage) ? GRACE : LICENSED;
            } else if (rank.get(room.id()) <= seats + graceSeats) {
                state = GRACE;
            } else {
                state = OVER_LIMIT;
            }
            roomStates.put(room.id(), state);
        }

        String state = OFF.equals(mode) ? UNMANAGED : coverage;
        return new Result(mode, state, coverage, seats, seatsUsed, endsAt, graceEndsAt, endingGrantId, roomStates,
                graceSeats, firstEndsAt, graceGrantId, nextStartsAt);
    }
}
