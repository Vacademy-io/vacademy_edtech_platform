package vacademy.io.auth_service.feature.panel.phase2.release;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncUpdate;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Update offers and the version floor, without a database. */
class PanelReleaseOfferTest {

    static final String HOST = "downloads.example.test";
    static final String SHA = "a".repeat(64);

    private PanelReleaseRepository repository;
    private final AtomicLong clock = new AtomicLong(1_000_000_000L);

    @BeforeEach
    void setUp() {
        repository = mock(PanelReleaseRepository.class);
    }

    static PanelProperties properties(int minAppVersionCode) {
        return new PanelProperties(true, true, 1, 4, false, 9999, 30, 4, minAppVersionCode,
                "https://classroom.vacademy.io", "", "");
    }

    private PanelReleaseService service(boolean enabled, int minApp) {
        PanelPhase2Properties phase2 = enabled ? PanelPhase2Properties.of(Map.of("panel.releases.enabled", "true"))
                : PanelPhase2Properties.allOff();
        return new PanelReleaseService(repository, phase2, properties(minApp),
                PanelReleaseSettings.of(Map.of("panel.releases.allowed-hosts", HOST)), new PanelCompat(),
                clock::get);
    }

    static DeviceRow device(String id, String channel, Integer version, Integer sdk) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        return new DeviceRow(id, "inst", "room-1", "Room 1", "hash", "ACTIVE", "Alpha", "blue", null, now, true,
                "Lab", "Panel", sdk, 66, version, now, "1.1.1.1", "Admin", now, now, "APPROVED", null, null, channel,
                now);
    }

    static ReleaseRow release(String channel, int code, int rollout, boolean required) {
        return release(channel, code, rollout, required, "https://" + HOST + "/classroom-direct-" + code + ".apk", 28);
    }

    static ReleaseRow release(String channel, int code, int rollout, boolean required, String url, int minSdk) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        return new ReleaseRow("rel-" + channel + "-" + code, channel, code, "0." + code + ".0", url, SHA, 1234L,
                minSdk, rollout, required, "LIVE", null, "staff", now, now, now);
    }

    /** A device id whose rollout position is exactly the given value. */
    static String idInBucket(int bucket) {
        for (int i = 0; i < 100_000; i++) {
            String id = "dev-" + i;
            if (PanelReleaseService.bucket(id) == bucket) {
                return id;
            }
        }
        throw new IllegalStateException("no id for bucket " + bucket);
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    @Nested
    class SwitchedOff {
        @Test
        void offersNothingSetsNoFloorAndReadsNothing() {
            PanelReleaseService releases = service(false, 9);
            DeviceRow old = device("dev-1", null, 2, 28);
            assertThat(releases.syncBlock(old)).isNull();
            assertThat(releases.requiredVersionCode(old)).isNull();
            assertThat(code(() -> releases.requireNotBelowFloor(old))).isEqualTo("OK");
            assertThat(releases.liveReleases()).isEmpty();
            verifyNoInteractions(repository);
        }
    }

    @Nested
    class Rollout {
        @Test
        void aDevicesPositionIsSha256OfItsIdModulo100() throws Exception {
            for (String id : List.of("dev-1", "0f2b6a3e-0000-4000-8000-000000000001", "x")) {
                byte[] d = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
                int value = java.nio.ByteBuffer.wrap(d, 0, 4).getInt();
                assertThat(PanelReleaseService.bucket(id)).isEqualTo(Math.floorMod(value, 100))
                        .isEqualTo(PanelReleaseService.bucket(id));
            }
        }

        @Test
        void zeroPercentOffersNobodyAndHundredOffersEverybody() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 0, false)));
            PanelReleaseService none = service(true, 1);
            for (int i = 0; i < 200; i++) {
                assertThat(none.syncBlock(device("dev-" + i, "DIRECT", 3, 28))).isNull();
            }
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, false)));
            PanelReleaseService all = service(true, 1);
            for (int i = 0; i < 200; i++) {
                assertThat(all.syncBlock(device("dev-" + i, "DIRECT", 3, 28))).isNotNull();
            }
        }

        @Test
        void theSameDeviceGetsTheSameAnswerAndRaisingThePercentOnlyAddsDevices() {
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < 1000; i++) {
                ids.add("panel-" + i);
            }
            List<String> previous = List.of();
            for (int percent : new int[] { 5, 25, 50, 100 }) {
                when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, percent, false)));
                PanelReleaseService releases = service(true, 1);
                List<String> offered = ids.stream()
                        .filter(id -> releases.syncBlock(device(id, "DIRECT", 3, 28)) != null).toList();
                List<String> again = ids.stream()
                        .filter(id -> releases.syncBlock(device(id, "DIRECT", 3, 28)) != null).toList();
                assertThat(again).isEqualTo(offered);
                assertThat(offered).containsAll(previous);
                assertThat(offered.size()).isBetween(percent * 10 - 60, percent * 10 + 60);
                previous = offered;
            }
            assertThat(previous).hasSize(1000);
        }

        @Test
        void theBoundaryIsStrictlyBelowThePercent() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 30, false)));
            PanelReleaseService releases = service(true, 1);
            assertThat(releases.syncBlock(device(idInBucket(29), "DIRECT", 3, 28))).isNotNull();
            assertThat(releases.syncBlock(device(idInBucket(30), "DIRECT", 3, 28))).isNull();
        }
    }

    @Nested
    class Channels {
        @Test
        void onlyDirectPanelsAreOfferedAndAPanelWithNoChannelCountsAsDirect() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, false)));
            PanelReleaseService releases = service(true, 1);
            assertThat(releases.syncBlock(device("dev-1", "DIRECT", 3, 28))).isNotNull();
            assertThat(releases.syncBlock(device("dev-1", null, 2, 28))).isNotNull();
            assertThat(releases.syncBlock(device("dev-1", "PLAY", 3, 34))).isNull();
            assertThat(releases.syncBlock(device("dev-1", "DEV", 3, 28))).isNull();
        }

        @Test
        void playRowsAreNeverOffered() {
            when(repository.listLive()).thenReturn(List.of(release("PLAY", 9, 100, false, null, 24)));
            PanelReleaseService releases = service(true, 1);
            assertThat(releases.syncBlock(device("dev-1", "DIRECT", 3, 28))).isNull();
            assertThat(releases.syncBlock(device("dev-1", "PLAY", 3, 34))).isNull();
        }

        @Test
        void theOfferIsTheHighestBuildThePanelCanRun() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, false),
                    release("DIRECT", 6, 100, false, "https://" + HOST + "/c6.apk", 30),
                    release("DIRECT", 5, 100, false), release("DIRECT", 3, 100, false)));
            PanelReleaseService releases = service(true, 1);
            SyncUpdate on28 = releases.syncBlock(device("dev-1", "DIRECT", 3, 28));
            assertThat(on28.versionCode()).isEqualTo(5);
            assertThat(on28.sha256()).isEqualTo(SHA);
            assertThat(on28.sizeBytes()).isEqualTo(1234L);
            assertThat(on28.required()).isFalse();
            assertThat(releases.syncBlock(device("dev-1", "DIRECT", 3, 30)).versionCode()).isEqualTo(6);
            assertThat(releases.syncBlock(device("dev-1", "DIRECT", 6, 30))).isNull();
            assertThat(releases.syncBlock(device("dev-1", "DIRECT", null, 30))).isNull();
            assertThat(releases.syncBlock(device("dev-1", "DIRECT", 3, null))).isNull();
        }

        @Test
        void aLinkOffTheAllowedHostsOrNotHttpsIsNeverOffered() {
            when(repository.listLive()).thenReturn(List.of(
                    release("DIRECT", 4, 100, false, "https://elsewhere.example.test/a.apk", 24),
                    release("DIRECT", 5, 100, false, "http://" + HOST + "/a.apk", 24),
                    release("DIRECT", 6, 100, false, "https://user@" + HOST + "/a.apk", 24),
                    release("DIRECT", 7, 100, false, "https://" + HOST + ":8443/a.apk", 24)));
            assertThat(service(true, 1).syncBlock(device("dev-1", "DIRECT", 3, 28))).isNull();
        }
    }

    @Nested
    class Floor {
        @Test
        void theFloorIsTheLargerOfThePropertyAndTheHighestRequiredLiveBuildOfTheChannel() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 5, 100, true),
                    release("DIRECT", 7, 100, false), release("PLAY", 9, 100, true, null, 24)));
            PanelReleaseService releases = service(true, 1);
            assertThat(releases.requiredVersionCode(device("d", "DIRECT", 3, 28))).isEqualTo(5);
            assertThat(releases.requiredVersionCode(device("d", null, 3, 28))).isEqualTo(5);
            assertThat(releases.requiredVersionCode(device("d", "PLAY", 3, 34))).isEqualTo(9);
            assertThat(releases.requiredVersionCode(device("d", "DEV", 3, 28))).isEqualTo(1);
            assertThat(service(true, 8).requiredVersionCode(device("d", "DIRECT", 3, 28))).isEqualTo(8);
        }

        @Test
        void belowTheFloorAPhase2PanelReadsUpdateRequiredAndAnOlderOneReadsPanelDisabled() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 5, 100, true)));
            PanelReleaseService releases = service(true, 1);
            assertThat(code(() -> releases.requireNotBelowFloor(device("d", "DIRECT", 4, 28))))
                    .isEqualTo("UPDATE_REQUIRED");
            assertThat(code(() -> releases.requireNotBelowFloor(device("d", null, 2, 28))))
                    .isEqualTo("PANEL_DISABLED");
            assertThat(code(() -> releases.requireNotBelowFloor(device("d", "DIRECT", 5, 28)))).isEqualTo("OK");
            assertThat(code(() -> releases.requireNotBelowFloor(device("d", "PLAY", 4, 34)))).isEqualTo("OK");
            assertThat(code(() -> releases.requireNotBelowFloor(device("d", "DIRECT", null, 28)))).isEqualTo("OK");
        }

        @Test
        void aRequiredBuildIsOfferedOutsideItsRolloutAndMarkedRequired() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 5, 0, true)));
            SyncUpdate update = service(true, 1).syncBlock(device(idInBucket(99), "DIRECT", 4, 28));
            assertThat(update.versionCode()).isEqualTo(5);
            assertThat(update.required()).isTrue();
        }

        @Test
        void belowAPropertyFloorTheSmallestBuildThatLiftsThePanelIsOfferedWhateverItsRollout() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 6, 0, false),
                    release("DIRECT", 7, 0, false), release("DIRECT", 4, 100, false)));
            SyncUpdate update = service(true, 6).syncBlock(device(idInBucket(50), "DIRECT", 3, 28));
            assertThat(update.versionCode()).isEqualTo(6);
            assertThat(update.required()).isTrue();
        }
    }

    /** The floor is per channel: panels the build cannot reach stay below it with no offer. */
    @Nested
    class FloorWithoutAnOffer {
        private void assertHeldBelowWithNoOffer(PanelReleaseService releases, DeviceRow device) {
            assertThat(releases.requiredVersionCode(device)).isEqualTo(4);
            assertThat(releases.syncBlock(device)).isNull();
            assertThat(code(() -> releases.requireNotBelowFloor(device))).isEqualTo("UPDATE_REQUIRED");
        }

        @Test
        void aRequiredBuildAboveThePanelsSdk() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, true,
                    "https://" + HOST + "/classroom-direct-4.apk", 26)));
            assertHeldBelowWithNoOffer(service(true, 1), device("d", "DIRECT", 3, 24));
        }

        @Test
        void aRequiredBuildWhoseHostIsNoLongerAllowed() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, true,
                    "https://moved.example.test/classroom-direct-4.apk", 24)));
            assertHeldBelowWithNoOffer(service(true, 1), device("d", "DIRECT", 3, 28));
        }

        @Test
        void aPanelThatNeverReportedItsSdk() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, true)));
            assertHeldBelowWithNoOffer(service(true, 1), device("d", "DIRECT", 3, null));
        }
    }

    @Nested
    class Cache {
        @Test
        void theLiveListIsReadOncePerPeriodAndAgainAfterIt() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 4, 100, false)));
            PanelReleaseService releases = service(true, 1);
            for (int i = 0; i < 50; i++) {
                releases.syncBlock(device("dev-" + i, "DIRECT", 3, 28));
                releases.requiredVersionCode(device("dev-" + i, "DIRECT", 3, 28));
            }
            verify(repository, times(1)).listLive();
            clock.addAndGet(TimeUnit.SECONDS.toNanos(61));
            releases.syncBlock(device("dev-1", "DIRECT", 3, 28));
            verify(repository, times(2)).listLive();
            releases.invalidate();
            releases.syncBlock(device("dev-1", "DIRECT", 3, 28));
            verify(repository, times(3)).listLive();
        }

        @Test
        void aFailedReadKeepsTheLastListSoSyncAndSignInStillWork() {
            when(repository.listLive()).thenReturn(List.of(release("DIRECT", 5, 100, true)));
            PanelReleaseService releases = service(true, 1);
            assertThat(releases.requiredVersionCode(device("d", "DIRECT", 3, 28))).isEqualTo(5);
            when(repository.listLive()).thenThrow(new QueryTimeoutException("slow"));
            clock.addAndGet(TimeUnit.SECONDS.toNanos(61));
            assertThat(releases.requiredVersionCode(device("d", "DIRECT", 3, 28))).isEqualTo(5);

            PanelReleaseService cold = service(true, 1);
            assertThat(cold.requiredVersionCode(device("d", "DIRECT", 3, 28))).isEqualTo(1);
            assertThat(cold.syncBlock(device("d", "DIRECT", 3, 28))).isNull();
        }
    }
}
