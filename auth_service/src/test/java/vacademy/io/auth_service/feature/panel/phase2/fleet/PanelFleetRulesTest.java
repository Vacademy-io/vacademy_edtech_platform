package vacademy.io.auth_service.feature.panel.phase2.fleet;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetAlert;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate.InstituteLicenceView;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.fleet.PanelFleetRepository.FleetDevice;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseService;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseSettings;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Duration;
import java.util.EnumSet;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/** The alert rules and thresholds, without a database. */
class PanelFleetRulesTest {

    /** Monday 2026-11-09 10:00 in Asia/Kolkata. */
    static final Instant NOW = Instant.parse("2026-11-09T04:30:00Z");
    static final String HOST = "downloads.example.test";

    private static Timestamp ago(Duration duration) {
        return Timestamp.from(NOW.minus(duration));
    }

    private static Timestamp hoursAgo(long hours) {
        return ago(Duration.ofHours(hours));
    }

    private static Timestamp daysAgo(long days) {
        return ago(Duration.ofDays(days));
    }

    /** An ACTIVE, APPROVED direct panel confirmed 30 days ago, seen a minute ago, used yesterday. */
    static FleetDevice healthy(String id) {
        return new FleetDevice(id, "room-" + id, "Room " + id, null, "ACTIVE", "APPROVED", "DIRECT", 5, 66, 28,
                ago(Duration.ofMinutes(1)), daysAgo(30), daysAgo(30), "s-" + id, daysAgo(1), Timestamp.from(NOW));
    }

    static FleetDevice with(FleetDevice d, String status, String approval, String channel, Integer version,
            Integer webview, Timestamp lastSeen, Timestamp claimed, Timestamp confirmed, String lastSessionId,
            Timestamp lastSessionAt) {
        return new FleetDevice(d.id(), d.roomId(), d.roomName(), d.roomLicensedAt(), status, approval, channel,
                version, webview, d.sdkInt(), lastSeen, claimed, confirmed, lastSessionId, lastSessionAt, d.dbNow());
    }

    private static FleetDevice seen(FleetDevice d, Timestamp lastSeen) {
        return with(d, d.status(), d.approvalState(), d.appChannel(), d.appVersionCode(), d.webviewMajor(), lastSeen,
                d.claimedAt(), d.confirmedAt(), d.lastSessionId(), d.lastSessionAt());
    }

    private static PanelFleetService fleet(Map<String, String> props, List<ReleaseRow> live) {
        Map<String, String> values = new HashMap<>(props);
        values.putIfAbsent("panel.fleet.enabled", "true");
        PanelPhase2Properties phase2 = PanelPhase2Properties.of(values);
        PanelReleaseRepository repo = mock(PanelReleaseRepository.class);
        org.mockito.Mockito.when(repo.listLive()).thenReturn(live);
        PanelReleaseService releases = new PanelReleaseService(repo, phase2,
                new PanelProperties(true, true, 1, 4, false, 9999, 30, 4, 1, "https://classroom.vacademy.io", "", ""),
                PanelReleaseSettings.of(Map.of("panel.releases.allowed-hosts", HOST)), new PanelCompat());
        return new PanelFleetService(mock(PanelFleetRepository.class), phase2, PanelFleetSettings.of(Map.of()),
                releases, mock(PanelLicenceGate.class), mock(InstituteOAuthClientAccessGuard.class),
                mock(PanelTx.class));
    }

    private static List<FleetAlert> alerts(Map<String, String> props, List<FleetDevice> devices,
            InstituteLicenceView seats, List<ReleaseRow> live) {
        PanelFleetService fleet = fleet(props, live);
        return fleet.evaluate(devices, NOW, seats, live);
    }

    private static List<FleetAlert> alerts(FleetDevice... devices) {
        return alerts(Map.of(), List.of(devices), null, List.of());
    }

    private static List<String> kinds(List<FleetAlert> alerts) {
        return alerts.stream().map(FleetAlert::kind).toList();
    }

    static ReleaseRow release(String channel, int code, int rollout, boolean required, Timestamp publishedAt) {
        return new ReleaseRow("r-" + code, channel, code, "0." + code + ".0",
                "PLAY".equals(channel) ? null : "https://" + HOST + "/c-" + code + ".apk", "a".repeat(64), 10L, 24,
                rollout, required, "LIVE", null, "staff", publishedAt, publishedAt, Timestamp.from(NOW));
    }

    @Test
    void aHealthyPanelRaisesNothing() {
        assertThat(alerts(healthy("a"))).isEmpty();
    }

    @Test
    void offlineAfterTheThresholdWarnsThenTurnsBad() {
        assertThat(alerts(seen(healthy("a"), hoursAgo(47)))).isEmpty();
        List<FleetAlert> warn = alerts(seen(healthy("a"), hoursAgo(49)));
        assertThat(kinds(warn)).containsExactly("OFFLINE");
        assertThat(warn.get(0).severity()).isEqualTo("warn");
        assertThat(warn.get(0).incidentKey()).isEqualTo(String.valueOf(NOW.minus(Duration.ofHours(49))
                .getEpochSecond()));
        assertThat(warn.get(0).since()).isEqualTo(NOW.minus(Duration.ofHours(49)).toString());
        assertThat(warn.get(0).detail()).containsEntry("app_version_code", 5);
        assertThat(alerts(seen(healthy("a"), daysAgo(8))).get(0).severity()).isEqualTo("bad");
        assertThat(alerts(Map.of("panel.alerts.offline-hours", "72"), List.of(seen(healthy("a"), hoursAgo(49))),
                null, List.of())).isEmpty();
    }

    @Test
    void aPanelNeverSeenCountsFromItsConfirmation() {
        FleetDevice never = seen(healthy("a"), null);
        assertThat(kinds(alerts(never))).containsExactly("OFFLINE");
        FleetDevice fresh = with(never, "ACTIVE", "APPROVED", "DIRECT", 5, 66, null, hoursAgo(2), hoursAgo(1), null,
                null);
        assertThat(alerts(fresh)).isEmpty();
    }

    @Test
    void aClaimedPanelThatNeverConfirmedIsReportedAfterADay() {
        FleetDevice claimed = with(healthy("a"), "CLAIMED", "APPROVED", null, 3, 66, null, hoursAgo(23), null, null,
                null);
        assertThat(alerts(claimed)).isEmpty();
        claimed = with(claimed, "CLAIMED", "APPROVED", null, 3, 66, null, hoursAgo(25), null, null, null);
        assertThat(kinds(alerts(claimed))).containsExactly("NOT_CONFIRMED");
    }

    @Test
    void aPendingPanelAwaitsApprovalAndIsNotCalledOfflineOrUnused() {
        FleetDevice pending = with(healthy("a"), "ACTIVE", "PENDING", "DIRECT", 5, 66, daysAgo(3), daysAgo(20),
                daysAgo(20), null, null);
        List<FleetAlert> alerts = alerts(pending);
        assertThat(kinds(alerts)).containsExactly("AWAITING_APPROVAL");
        assertThat(alerts.get(0).incidentKey()).isEqualTo("a");
        FleetDevice rejected = with(pending, "ACTIVE", "REJECTED", "DIRECT", 5, 66, daysAgo(3), daysAgo(20),
                daysAgo(20), null, null);
        assertThat(alerts(rejected)).isEmpty();
    }

    @Test
    void updateRequiredTellsWaitingToUpdateFromUnableToUpdate() {
        Map<String, String> on = Map.of("panel.releases.enabled", "true");
        List<ReleaseRow> required = List.of(release("DIRECT", 6, 100, true, daysAgo(1)));
        FleetDevice a = healthy("a");
        FleetDevice noSdk = new FleetDevice(a.id(), a.roomId(), a.roomName(), a.roomLicensedAt(), a.status(),
                a.approvalState(), a.appChannel(), a.appVersionCode(), a.webviewMajor(), null, a.lastSeenAt(),
                a.claimedAt(), a.confirmedAt(), a.lastSessionId(), a.lastSessionAt(), a.dbNow());
        FleetDevice phase1 = with(healthy("b"), "ACTIVE", "APPROVED", null, 2, 66, ago(Duration.ofMinutes(1)),
                daysAgo(30), daysAgo(30), "s-b", daysAgo(1));

        assertThat(alerts(on, List.of(a), null, required).get(0).detail()).containsEntry("no_update_offer", false);
        assertThat(alerts(on, List.of(noSdk), null, required).get(0).detail()).containsEntry("no_update_offer", true);
        assertThat(alerts(on, List.of(phase1), null, required).get(0).detail()).containsEntry("no_update_offer", true);
        ReleaseRow movedHost = new ReleaseRow("r-6", "DIRECT", 6, "0.6.0", "https://moved.example.test/c-6.apk",
                "a".repeat(64), 10L, 24, 100, true, "LIVE", null, "staff", daysAgo(1), daysAgo(1), Timestamp.from(NOW));
        assertThat(alerts(on, List.of(a), null, List.of(movedHost)).get(0).detail())
                .containsEntry("no_update_offer", true);
    }

    @Test
    void releaseAlertsNeedReleasesOnAndFollowTheFloorAndTheOutdatedDays() {
        Map<String, String> on = Map.of("panel.releases.enabled", "true");
        List<ReleaseRow> required = List.of(release("DIRECT", 6, 100, true, daysAgo(1)));
        List<FleetAlert> below = alerts(on, List.of(healthy("a")), null, required);
        assertThat(kinds(below)).containsExactly("UPDATE_REQUIRED");
        assertThat(below.get(0).severity()).isEqualTo("bad");
        assertThat(below.get(0).incidentKey()).isEqualTo("6");
        assertThat(alerts(Map.of(), List.of(healthy("a")), null, required)).isEmpty();

        assertThat(alerts(on, List.of(healthy("a")), null, List.of(release("DIRECT", 6, 100, false, daysAgo(13)))))
                .isEmpty();
        List<FleetAlert> outdated = alerts(on, List.of(healthy("a")), null,
                List.of(release("DIRECT", 6, 100, false, daysAgo(15)), release("DIRECT", 7, 100, false, daysAgo(2))));
        assertThat(kinds(outdated)).containsExactly("APP_OUTDATED");
        assertThat(outdated.get(0).severity()).isEqualTo("info");
        assertThat(outdated.get(0).incidentKey()).isEqualTo("6");
        assertThat(alerts(on, List.of(healthy("a")), null, List.of(release("DIRECT", 6, 0, false, daysAgo(15)))))
                .as("a direct build this panel is not offered yet")
                .isEmpty();
        FleetDevice play = with(healthy("p"), "ACTIVE", "APPROVED", "PLAY", 5, 120, ago(Duration.ofMinutes(1)),
                daysAgo(30), daysAgo(30), "s", daysAgo(1));
        assertThat(kinds(alerts(on, List.of(play), null, List.of(release("PLAY", 6, 0, false, daysAgo(15))))))
                .containsExactly("APP_OUTDATED");
        assertThat(alerts(on, List.of(play), null, List.of(release("DIRECT", 6, 100, false, daysAgo(15)))))
                .isEmpty();
    }

    @Test
    void webviewCheckIsOffAtZeroAndWarnsOnlyOnPlay() {
        FleetDevice old = healthy("a");
        assertThat(alerts(old)).isEmpty();
        Map<String, String> warnBelow = Map.of("panel.alerts.webview-warn-major", "90");
        List<FleetAlert> direct = alerts(warnBelow, List.of(old), null, List.of());
        assertThat(kinds(direct)).containsExactly("WEBVIEW_OLD");
        assertThat(direct.get(0).severity()).isEqualTo("info");
        FleetDevice play = with(old, "ACTIVE", "APPROVED", "PLAY", 5, 80, old.lastSeenAt(), old.claimedAt(),
                old.confirmedAt(), old.lastSessionId(), old.lastSessionAt());
        assertThat(alerts(warnBelow, List.of(play), null, List.of()).get(0).severity()).isEqualTo("warn");
    }

    @Test
    void unusedCountsSchoolDaysOnly() {
        ZoneId zone = ZoneId.of("Asia/Kolkata");
        // Monday: seven school days back skips both Sundays and lands on Saturday 31 October.
        assertThat(PanelFleetService.unusedWindowStart(NOW, zone,
                EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.SATURDAY), 7))
                .isEqualTo(Instant.parse("2026-10-30T18:30:00Z"));

        FleetDevice lastUsedOct31 = with(healthy("a"), "ACTIVE", "APPROVED", "DIRECT", 5, 66,
                ago(Duration.ofMinutes(1)), daysAgo(60), daysAgo(60), "s-old", Timestamp.from(
                        Instant.parse("2026-10-31T05:00:00Z")));
        assertThat(alerts(lastUsedOct31)).isEmpty();
        FleetDevice lastUsedOct30 = with(lastUsedOct31, "ACTIVE", "APPROVED", "DIRECT", 5, 66,
                ago(Duration.ofMinutes(1)), daysAgo(60), daysAgo(60), "s-older",
                Timestamp.from(Instant.parse("2026-10-30T05:00:00Z")));
        List<FleetAlert> unused = alerts(lastUsedOct30);
        assertThat(kinds(unused)).containsExactly("UNUSED");
        assertThat(unused.get(0).incidentKey()).isEqualTo("s-older");
        FleetDevice neverUsed = with(lastUsedOct30, "ACTIVE", "APPROVED", "DIRECT", 5, 66, ago(Duration.ofMinutes(1)),
                daysAgo(60), daysAgo(60), null, null);
        assertThat(alerts(neverUsed).get(0).incidentKey()).isEqualTo("none");
    }

    @Test
    void unusedIsNotRaisedForANewPanelOrOneThatIsOffline() {
        FleetDevice installedLastWeek = with(healthy("a"), "ACTIVE", "APPROVED", "DIRECT", 5, 66,
                ago(Duration.ofMinutes(1)), daysAgo(5), daysAgo(5), null, null);
        assertThat(alerts(installedLastWeek)).isEmpty();
        FleetDevice offline = with(healthy("a"), "ACTIVE", "APPROVED", "DIRECT", 5, 66, daysAgo(3), daysAgo(60),
                daysAgo(60), null, null);
        assertThat(kinds(alerts(offline))).containsExactly("OFFLINE");
        assertThat(alerts(Map.of("panel.alerts.unused-days", "30"), List.of(with(healthy("a"), "ACTIVE", "APPROVED",
                "DIRECT", 5, 66, ago(Duration.ofMinutes(1)), daysAgo(60), daysAgo(60), "s", daysAgo(20))), null,
                List.of())).isEmpty();
    }

    @Test
    void licenceAlertsComeOnlyFromAManagedSeatPicture() {
        Instant soon = NOW.plus(Duration.ofDays(10));
        InstituteLicenceView live = new InstituteLicenceView("LIVE", "ACTIVE", 1, 2, soon, null, "g-1",
                Map.of("room-a", "OVER_LIMIT", "room-b", "LICENSED"));
        List<FleetAlert> alerts = alerts(Map.of(), List.of(healthy("a"), healthy("b")), live, List.of());
        assertThat(kinds(alerts)).containsExactlyInAnyOrder("LICENCE_ROOM", "LICENCE_ENDING");
        FleetAlert room = alerts.stream().filter(a -> a.kind().equals("LICENCE_ROOM")).findFirst().orElseThrow();
        assertThat(room.deviceId()).isEqualTo("a");
        assertThat(room.incidentKey()).isEqualTo("OVER_LIMIT:none");
        FleetAlert ending = alerts.stream().filter(a -> a.kind().equals("LICENCE_ENDING")).findFirst().orElseThrow();
        assertThat(ending.deviceId()).isNull();
        assertThat(ending.incidentKey()).isEqualTo("g-1");

        InstituteLicenceView off = new InstituteLicenceView("OFF", "ACTIVE", 1, 2, NOW.plus(Duration.ofDays(30)),
                null, "g-1", Map.of("room-a", "OVER_LIMIT"));
        assertThat(alerts(Map.of(), List.of(healthy("a")), off, List.of())).isEmpty();
        InstituteLicenceView grace = new InstituteLicenceView("SHADOW", "GRACE", 1, 1, NOW.minus(Duration.ofDays(1)),
                NOW.plus(Duration.ofDays(5)), "g-2", Map.of());
        assertThat(alerts(Map.of(), List.of(), grace, List.of()).get(0).incidentKey()).isEqualTo("GRACE:g-2");
        assertThat(alerts(Map.of(), List.of(healthy("a")), null, List.of())).isEmpty();
    }

    @Test
    void licenceEndingFollowsTheEarlierGrantWhileALaterOneCoversAndItsGrace() {
        // Grant A (ends in 10 days) holds seats rooms use; grant B covers until day 200.
        InstituteLicenceView staggered = new InstituteLicenceView("LIVE", "ACTIVE", 20, 20,
                NOW.plus(Duration.ofDays(200)), null, "grant-a", Map.of(), 0, NOW.plus(Duration.ofDays(10)), null);
        List<FleetAlert> ending = alerts(Map.of(), List.of(), staggered, List.of());
        assertThat(ending).singleElement().satisfies(alert -> {
            assertThat(alert.kind()).isEqualTo("LICENCE_ENDING");
            assertThat(alert.incidentKey()).isEqualTo("grant-a");
            assertThat(alert.detail()).containsEntry("ends_at", NOW.plus(Duration.ofDays(10)).toString());
        });

        // A has ended; its grace days keep 10 rooms on top of B's seats.
        InstituteLicenceView inGrace = new InstituteLicenceView("LIVE", "ACTIVE", 10, 20,
                NOW.plus(Duration.ofDays(200)), NOW.plus(Duration.ofDays(13)), "grant-b", Map.of(), 10,
                NOW.plus(Duration.ofDays(200)), "grant-a");
        assertThat(alerts(Map.of(), List.of(), inGrace, List.of())).singleElement().satisfies(alert -> {
            assertThat(alert.kind()).isEqualTo("LICENCE_ENDING");
            assertThat(alert.incidentKey()).isEqualTo("GRACE:grant-a");
            assertThat(alert.detail()).containsEntry("grace_seats", 10);
        });
    }

    @Test
    void worstFirstAndCountsByKind() {
        Map<String, String> on = Map.of("panel.releases.enabled", "true", "panel.alerts.webview-warn-major", "90");
        List<FleetAlert> alerts = alerts(on, List.of(seen(healthy("a"), daysAgo(9)), healthy("b")), null,
                List.of(release("DIRECT", 6, 100, true, daysAgo(1))));
        assertThat(alerts.get(0).severity()).isEqualTo("bad");
        assertThat(alerts.get(alerts.size() - 1).severity()).isEqualTo("info");
        var response = PanelFleetService.respond(NOW, alerts);
        assertThat(response.counts()).containsEntry("UPDATE_REQUIRED", 2).containsEntry("OFFLINE", 1)
                .containsEntry("WEBVIEW_OLD", 2);
        assertThat(response.generatedAt()).isEqualTo(NOW.toString());
    }

    @Test
    void switchedOffTheEndpointsAnswerFeatureOffBeforeAnyRead() {
        PanelFleetRepository repository = mock(PanelFleetRepository.class);
        InstituteOAuthClientAccessGuard guard = mock(InstituteOAuthClientAccessGuard.class);
        PanelLicenceGate licence = mock(PanelLicenceGate.class);
        PanelTx tx = mock(PanelTx.class);
        PanelFleetService fleet = new PanelFleetService(repository, PanelPhase2Properties.allOff(),
                PanelFleetSettings.of(Map.of()), mock(PanelReleaseService.class), licence, guard, tx);
        String code;
        try {
            fleet.forAdmin(mock(CustomUserDetails.class), "inst");
            code = "OK";
        } catch (PanelApiException e) {
            code = e.getCode();
        }
        assertThat(code).isEqualTo("FEATURE_OFF");
        try {
            fleet.forService("inst");
            code = "OK";
        } catch (PanelApiException e) {
            code = e.getCode();
        }
        assertThat(code).isEqualTo("FEATURE_OFF");
        verifyNoInteractions(repository, guard, licence, tx);
    }
}
