package vacademy.io.auth_service.feature.panel.phase2.licence;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.EventRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.GrantRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceUsageService.Counts;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceUsageService.Span;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** Monthly seat counts from rows: day buckets in the institute's zone, peaks and active rooms. */
class PanelLicenceUsageCountsTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final YearMonth NOV = YearMonth.of(2026, 11);

    private static Timestamp at(String local) {
        return Timestamp.from(java.time.LocalDateTime.parse(local).atZone(IST).toInstant());
    }

    private static GrantRow grant(int seats, String from, String to, String cancelledAt, String partner) {
        return new GrantRow("g" + seats, "inst", "PAID", seats, at(from), at(to), 0,
                cancelledAt == null ? "ACTIVE" : "CANCELLED", partner, null, null, "s", at(from), null,
                cancelledAt == null ? null : at(cancelledAt));
    }

    private static EventRow event(String room, String action, String when, String partner) {
        return new EventRow("inst", room, action, partner, at(when));
    }

    @Test
    void daysAreLocalAndStopAtNow() {
        Instant now = at("2026-11-03T10:00:00").toInstant();
        List<Span> days = PanelLicenceUsageService.days(NOV, IST, now);
        assertThat(days).hasSize(3);
        assertThat(days.get(0).from()).isEqualTo(at("2026-11-01T00:00:00").toInstant());
        assertThat(days.get(0).to()).isEqualTo(at("2026-11-02T00:00:00").toInstant());
        assertThat(PanelLicenceUsageService.days(NOV, IST, at("2026-12-05T00:00:00").toInstant())).hasSize(30);
        assertThat(PanelLicenceUsageService.zone("Not/AZone")).isEqualTo(IST);
        assertThat(PanelLicenceUsageService.zone("UTC")).isEqualTo(ZoneId.of("UTC"));
    }

    @Test
    void peaksRoomDaysAndActiveRoomsByAttribution() {
        Instant now = at("2026-12-05T00:00:00").toInstant();
        List<Span> days = PanelLicenceUsageService.days(NOV, IST, now);
        List<GrantRow> grants = List.of(
                grant(10, "2026-10-01T00:00:00", "2027-10-01T00:00:00", null, "p1"),
                // 5 more seats for 10 days, then cancelled on the 6th: counted until cancelled.
                grant(5, "2026-11-01T00:00:00", "2026-11-11T00:00:00", "2026-11-06T12:00:00", null));
        List<EventRow> events = List.of(
                event("a", "ASSIGNED", "2026-10-15T09:00:00", "p1"),
                event("b", "ASSIGNED", "2026-11-10T23:59:00", null),
                event("b", "RELEASED", "2026-11-11T00:30:00", null),
                event("c", "ASSIGNED", "2026-11-30T23:00:00", "p2"));

        Counts counts = PanelLicenceUsageService.counts(grants, events, Set.of("a", "b", "x"), days, now);
        assertThat(counts.seatsPeak()).isEqualTo(15);
        // a every day (30), b on the 10th and 11th (2), c on the 30th (1).
        assertThat(counts.roomDays()).isEqualTo(33);
        assertThat(counts.roomsPeak()).isEqualTo(2);
        // Active: held a seat in the month and had a counted session. c had no session; x held no seat.
        assertThat(counts.activeRooms()).isEqualTo(2);
        assertThat(counts.byPartner()).hasSize(1);
        assertThat(counts.byPartner().get(0).partnerId()).isEqualTo("p1");
        assertThat(counts.byPartner().get(0).activeLicensedRooms()).isEqualTo(1);

        assertThat(PanelLicenceUsageService.rowPartner(grants, days.get(0).from(), days.get(29).to()))
                .isEqualTo("p1");
    }

    @Test
    void aRoomStillHoldingItsSeatCountsUpToNow() {
        Instant now = at("2026-11-04T12:00:00").toInstant();
        List<Span> days = PanelLicenceUsageService.days(NOV, IST, now);
        Counts counts = PanelLicenceUsageService.counts(List.of(),
                List.of(event("a", "ASSIGNED", "2026-11-02T08:00:00", null)), Set.of(), days, now);
        assertThat(counts.roomDays()).isEqualTo(3);
        assertThat(counts.activeRooms()).isZero();
        assertThat(counts.seatsPeak()).isZero();
    }

    private static GrantRow utcGrant(String id, int seats, String from, String to, String cancelledAt) {
        return new GrantRow(id, "inst", "PAID", seats, Timestamp.from(Instant.parse(from)),
                Timestamp.from(Instant.parse(to)), 0, cancelledAt == null ? "ACTIVE" : "CANCELLED", null, null, null,
                "s", Timestamp.from(Instant.parse(from)), null,
                cancelledAt == null ? null : Timestamp.from(Instant.parse(cancelledAt)));
    }

    private static int seatsPeak(List<GrantRow> grants, ZoneId zone) {
        Instant now = Instant.parse("2026-12-05T00:00:00Z");
        return PanelLicenceUsageService.counts(grants, List.of(), Set.of(),
                PanelLicenceUsageService.days(NOV, zone, now), now).seatsPeak();
    }

    @Test
    void backToBackGrantsAreNeverAddedTogetherWhateverTheZone() {
        List<GrantRow> handover = List.of(
                utcGrant("a", 10, "2026-10-01T00:00:00Z", "2026-11-15T06:30:00Z", null),
                utcGrant("b", 10, "2026-11-15T06:30:00Z", "2027-11-15T06:30:00Z", null));
        assertThat(seatsPeak(handover, IST)).isEqualTo(10);
        assertThat(seatsPeak(handover, ZoneId.of("UTC"))).isEqualTo(10);
    }

    @Test
    void aCancelledGrantReplacedAtTheSameMomentCountsOnlyTheReplacement() {
        List<GrantRow> regrant = List.of(
                utcGrant("a", 10, "2026-10-01T00:00:00Z", "2027-10-01T00:00:00Z", "2026-11-12T10:00:00Z"),
                utcGrant("b", 12, "2026-11-12T10:00:00Z", "2027-11-12T10:00:00Z", null));
        assertThat(seatsPeak(regrant, IST)).isEqualTo(12);
    }

    @Test
    void grantsThatReallyOverlapAreAdded() {
        List<GrantRow> overlap = List.of(
                utcGrant("a", 10, "2026-10-01T00:00:00Z", "2026-11-15T06:30:00Z", null),
                utcGrant("b", 7, "2026-11-15T06:00:00Z", "2027-11-15T06:30:00Z", null));
        assertThat(seatsPeak(overlap, IST)).isEqualTo(17);
        // A grant that starts after now does not count yet.
        Instant now = Instant.parse("2026-11-10T00:00:00Z");
        assertThat(PanelLicenceUsageService.counts(List.of(utcGrant("f", 9, "2026-11-20T00:00:00Z",
                "2027-01-01T00:00:00Z", null)), List.of(), Set.of(), PanelLicenceUsageService.days(NOV, IST, now), now)
                .seatsPeak()).isZero();
    }
}
