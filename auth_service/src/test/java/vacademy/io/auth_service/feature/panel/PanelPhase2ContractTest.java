package vacademy.io.auth_service.feature.panel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.AuthenticationManager;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.phase2.DefaultPanelApprovalGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelActivityIngest;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelLicenceGate;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Errors;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.PanelReleaseOffer;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository.ReleaseRow;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseService;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseSettings;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.auth_service.feature.panel.service.PanelAccessPolicy;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelDevices;
import vacademy.io.auth_service.feature.panel.service.PanelMaintenance;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelSessionService;
import vacademy.io.auth_service.feature.panel.service.PanelTokenService;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The phase 2 contract laid down before any feature: wire shapes, the seams and where they are
 * called, the version compatibility rule and the switches. No database.
 */
class PanelPhase2ContractTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static PanelProperties properties() {
        return new PanelProperties(true, true, 1, 4, false, 9999, 30, 4, 1, "https://classroom.vacademy.io", "", "");
    }

    private static DeviceRow device(Integer appVersionCode, String approvalState) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        return new DeviceRow("dev-1", "inst", "room-1", "Room 1", PanelSecrets.sha256Hex("secret"), "ACTIVE", "Alpha",
                "blue", null, now, true, "Lab", "Panel", 28, 66, appVersionCode, now, "1.1.1.1", "Admin", now, now,
                approvalState, null, null, null, now);
    }

    private static SessionRow activeSession() {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        Timestamp later = new Timestamp(System.currentTimeMillis() + 3_600_000L);
        return new SessionRow("s-1", "dev-1", "inst", "u-1", "QR", PanelSecrets.sha256Hex("token"), "ACTIVE", later,
                now, now, null, 0, 0, null, null, now, null, null, null, now);
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    @SuppressWarnings("unchecked")
    private static PanelTx inlineTx() {
        PanelTx tx = mock(PanelTx.class);
        when(tx.run(any())).thenAnswer(call -> ((Supplier<Object>) call.getArgument(0)).get());
        return tx;
    }

    // ------------------------------------------------------------ compat ---

    @Nested
    class Compat {
        @Test
        void oldOrUnknownAppsReadPanelDisabledAndPhase2AppsTheRealCode() {
            for (String phase2Code : List.of(PanelPhase2Errors.LICENCE_REQUIRED, PanelPhase2Errors.AWAITING_APPROVAL,
                    PanelPhase2Errors.UPDATE_REQUIRED)) {
                assertThat(PanelCompat.refusalFor(null, phase2Code).getCode()).isEqualTo("PANEL_DISABLED");
                assertThat(PanelCompat.refusalFor(2, phase2Code).getCode()).isEqualTo("PANEL_DISABLED");
                PanelApiException real = PanelCompat.refusalFor(PanelCompat.FIRST_PHASE2_VERSION_CODE, phase2Code);
                assertThat(real.getCode()).isEqualTo(phase2Code);
                assertThat(real.getHttpStatus().value()).isEqualTo(403);
            }
            assertThat(new PanelCompat().refusal(device(2, "PENDING"), PanelPhase2Errors.AWAITING_APPROVAL).getCode())
                    .isEqualTo("PANEL_DISABLED");
        }

        @Test
        void theApprovalGateLetsApprovedAndUnknownThroughAndHoldsTheRest() {
            DefaultPanelApprovalGate gate = new DefaultPanelApprovalGate(new PanelCompat());
            assertThat(code(() -> gate.requireApproved(device(3, "APPROVED")))).isEqualTo("OK");
            assertThat(code(() -> gate.requireApproved(device(3, null)))).isEqualTo("OK");
            assertThat(code(() -> gate.requireApproved(device(3, "PENDING")))).isEqualTo("AWAITING_APPROVAL");
            assertThat(code(() -> gate.requireApproved(device(3, "REJECTED")))).isEqualTo("AWAITING_APPROVAL");
            assertThat(code(() -> gate.requireApproved(device(2, "PENDING")))).isEqualTo("PANEL_DISABLED");
        }

        @Test
        void phase2CodesHaveTheirStatuses() {
            assertThat(PanelPhase2Errors.featureOff().getHttpStatus().value()).isEqualTo(404);
            assertThat(PanelPhase2Errors.featureOff().getCode()).isEqualTo("FEATURE_OFF");
            assertThat(PanelPhase2Errors.noSeat().getHttpStatus().value()).isEqualTo(409);
            assertThat(PanelPhase2Errors.notInstaller().getHttpStatus().value()).isEqualTo(403);
            assertThat(PanelPhase2Errors.inviteInvalid().getCode()).isEqualTo("INVITE_INVALID");
        }
    }

    // ---------------------------------------------------------- switches ---

    @Nested
    class Switches {
        @Test
        void everySwitchIsOffByDefault() {
            PanelPhase2Properties off = PanelPhase2Properties.allOff();
            assertThat(off.isUsageEnabled()).isFalse();
            assertThat(off.isUsageRecording()).isFalse();
            assertThat(off.isLicenceEnabled()).isFalse();
            assertThat(off.getLicenceDefaultEnforcement()).isEqualTo("OFF");
            assertThat(off.isLicenceNeverBlock()).isFalse();
            assertThat(off.isPartnersEnabled()).isFalse();
            assertThat(off.isReleasesEnabled()).isFalse();
            assertThat(off.isFleetEnabled()).isFalse();
            assertThat(code(off::requireUsage)).isEqualTo("FEATURE_OFF");
            assertThat(code(off::requireLicence)).isEqualTo("FEATURE_OFF");
            assertThat(code(off::requirePartners)).isEqualTo("FEATURE_OFF");
            assertThat(code(off::requireReleases)).isEqualTo("FEATURE_OFF");
            assertThat(code(off::requireFleet)).isEqualTo("FEATURE_OFF");
            assertThat(off.getInstallerRoles()).containsExactly("ADMIN");
            assertThat(off.getUsageMaxDays()).isEqualTo(92);
            assertThat(off.getActivityRetentionDays()).isEqualTo(180);
        }

        @Test
        void aBadValueFallsBackToTheSafeDefault() {
            PanelPhase2Properties odd = PanelPhase2Properties.of(Map.of("panel.licence.default-enforcement", "STRICT",
                    "panel.usage.max-days", "lots", "panel.partners.installer-roles", " ADMIN , INSTALLER ,,"));
            assertThat(odd.getLicenceDefaultEnforcement()).isEqualTo("OFF");
            assertThat(odd.getUsageMaxDays()).isEqualTo(92);
            assertThat(odd.getInstallerRoles()).containsExactly("ADMIN", "INSTALLER");
            assertThat(PanelPhase2Properties.of(Map.of("panel.licence.default-enforcement", "shadow"))
                    .getLicenceDefaultEnforcement()).isEqualTo("SHADOW");
        }
    }

    // ------------------------------------------------- where seams are used ---

    @Nested
    class Seams {
        private final PanelRepository repository = mock(PanelRepository.class);
        private final PanelDevices devices = mock(PanelDevices.class);
        private final UserRepository users = mock(UserRepository.class);
        private final PanelActivityIngest activity = mock(PanelActivityIngest.class);
        private final PanelLicenceGate licence = mock(PanelLicenceGate.class);
        private final PanelReleaseOffer releases = mock(PanelReleaseOffer.class);

        private PanelSessionService service(PanelPhase2Properties phase2, DeviceRow device) {
            when(devices.require(anyString(), anyString())).thenReturn(device);
            when(devices.requireActive(anyString(), anyString())).thenReturn(device);
            return new PanelSessionService(repository, properties(), devices, mock(PanelAccessPolicy.class),
                    mock(PanelTokenService.class), new PanelRateLimiter(properties()), inlineTx(), users,
                    mock(AuthenticationManager.class), phase2, activity, licence,
                    new DefaultPanelApprovalGate(new PanelCompat()), releases);
        }

        @Test
        void refreshNeverConsultsTheLicence() {
            PanelSessionService service = service(PanelPhase2Properties.allOff(), device(3, "APPROVED"));
            SessionRow session = activeSession();
            when(repository.findSessionByRefreshHash(anyString())).thenReturn(Optional.of(session));
            when(repository.markRefreshed("s-1")).thenReturn(1);
            User user = new User();
            user.setId("u-1");
            when(users.findById("u-1")).thenReturn(Optional.of(user));
            service.refresh(new SessionRefreshRequest("dev-1", "secret", "token"));
            verifyNoInteractions(licence, releases, activity);
        }

        @Test
        void aSignedInSyncNeverShowsLicenceOrUpdateAndOnlyAcksWhileRecording() {
            SessionRow session = activeSession();
            when(repository.findSession("s-1")).thenReturn(Optional.of(session));
            List<ActivityEvent> events = List.of(new ActivityEvent(7, "LESSON", "slide", "chapter", "Title", 1L));
            SyncRequest body = new SyncRequest("dev-1", "secret", "s-1", "token", 3, 66, false, null, false, events,
                    null);

            SyncResponse off = service(PanelPhase2Properties.allOff(), device(3, "APPROVED")).sync(body, "ip");
            assertThat(off.activityAckedSeq()).isNull();
            verify(activity, never()).ingestSync(any(), any(), any());

            when(activity.ingestSync(any(), any(), any())).thenReturn(7);
            SyncResponse on = service(PanelPhase2Properties.of(Map.of("panel.usage.recording-enabled", "true")),
                    device(3, "APPROVED")).sync(body, "ip");
            assertThat(on.activityAckedSeq()).isEqualTo(7);
            assertThat(on.session().status()).isEqualTo("ACTIVE");
            verify(licence, never()).syncBlock(any());
            verify(releases, never()).syncBlock(any());
            verify(licence, never()).requireCanStart(any());
        }

        @Test
        void aSignedOutSyncCarriesTheBlocksAndTheFloor() {
            DeviceRow device = device(3, "APPROVED");
            when(licence.syncBlock(device)).thenReturn(new SyncLicence("LICENSED", true, null, null));
            when(releases.syncBlock(device)).thenReturn(new SyncUpdate(4, "0.4.0", "https://x/a.apk", "ab", 10L, false));
            when(releases.requiredVersionCode(device)).thenReturn(3);
            SyncResponse response = service(PanelPhase2Properties.allOff(), device)
                    .sync(new SyncRequest("dev-1", "secret", null, null, 3, 66, false, null), "ip");
            assertThat(response.licence().state()).isEqualTo("LICENSED");
            assertThat(response.update().versionCode()).isEqualTo(4);
            assertThat(response.minAppVersionCode()).isEqualTo(3);
            assertThat(response.device().approvalState()).isEqualTo("APPROVED");
            verify(licence, never()).requireCanStart(any());
        }

        /** Right after an update: the panel reports the new build while the stored row still has the old one. */
        @Test
        void aSignedOutSyncAnswersForTheBuildThePanelReportsNotTheStoredOne() {
            PanelReleaseRepository registry = mock(PanelReleaseRepository.class);
            Timestamp now = new Timestamp(System.currentTimeMillis());
            when(registry.listLive()).thenReturn(List.of(new ReleaseRow("rel-4", "DIRECT", 4, "0.4.0",
                    "https://downloads.example.test/classroom-direct-4.apk", "a".repeat(64), 1234L, 24, 100, true,
                    "LIVE", null, "staff", now, now, now)));
            PanelPhase2Properties on = PanelPhase2Properties.of(Map.of("panel.releases.enabled", "true"));
            PanelReleaseService real = new PanelReleaseService(registry, on, properties(),
                    PanelReleaseSettings.of(Map.of("panel.releases.allowed-hosts", "downloads.example.test")),
                    new PanelCompat());
            when(devices.require(anyString(), anyString())).thenReturn(device(3, "APPROVED"));
            PanelSessionService service = new PanelSessionService(repository, properties(), devices,
                    mock(PanelAccessPolicy.class), mock(PanelTokenService.class), new PanelRateLimiter(properties()),
                    inlineTx(), users, mock(AuthenticationManager.class), on, activity, licence,
                    new DefaultPanelApprovalGate(new PanelCompat()), real);

            SyncResponse stillOld = service.sync(new SyncRequest("dev-1", "secret", null, null, 3, 66, false, null),
                    "ip");
            assertThat(stillOld.update().versionCode()).isEqualTo(4);
            assertThat(stillOld.update().required()).isTrue();

            SyncResponse updated = service.sync(new SyncRequest("dev-1", "secret", null, null, 4, 66, false, null),
                    "ip");
            assertThat(updated.update()).isNull();
            assertThat(updated.minAppVersionCode()).isEqualTo(4);
            verify(licence).syncBlock(org.mockito.ArgumentMatchers.argThat(row -> row.appVersionCode() == 4));
        }

        @Test
        void passwordSignInChecksApprovalSeatAndFloorBeforeTheCredentials() {
            PanelSessionService pending = service(PanelPhase2Properties.allOff(), device(3, "PENDING"));
            assertThat(code(() -> pending.loginPassword(new LoginPasswordRequest("dev-1", "secret", "t", "pw"))))
                    .isEqualTo("AWAITING_APPROVAL");
            verifyNoInteractions(licence);

            PanelSessionService approved = service(PanelPhase2Properties.allOff(), device(3, "APPROVED"));
            org.mockito.Mockito.doThrow(PanelCompat.refusalFor(3, PanelPhase2Errors.LICENCE_REQUIRED)).when(licence)
                    .requireCanStart(any());
            assertThat(code(() -> approved.loginPassword(new LoginPasswordRequest("dev-1", "secret", "t", "pw"))))
                    .isEqualTo("LICENCE_REQUIRED");
            verify(releases, never()).requireNotBelowFloor(any());
        }

        @Test
        void anIdleEndWhileRecordingIngestsFirstAndTrimsTheTail() {
            SessionRow session = activeSession();
            when(repository.findSessionByRefreshHash(anyString())).thenReturn(Optional.of(session));
            List<ActivityEvent> events = List.of(new ActivityEvent(1, "HOME", null, null, null, 1L));
            service(PanelPhase2Properties.of(Map.of("panel.usage.recording-enabled", "true")), device(3, "APPROVED"))
                    .end(new SessionEndRequest("dev-1", "secret", "token", "IDLE", events));
            verify(activity).ingestEnd(any(), any(), any());
            verify(repository).endSessionWithActiveUntil("s-1", "IDLE", null, 30 * 60 + 60);
            verify(repository, never()).endSession(anyString(), anyString(), any());
        }

        @Test
        void maintenanceRunsEveryPurgeTaskAndSurvivesAFailingOne() {
            int[] ran = new int[1];
            org.springframework.beans.factory.support.StaticListableBeanFactory factory =
                    new org.springframework.beans.factory.support.StaticListableBeanFactory();
            factory.addBean("broken", (vacademy.io.auth_service.feature.panel.phase2.PanelPurgeTask) limit -> {
                throw new IllegalStateException("x");
            });
            factory.addBean("counting", (vacademy.io.auth_service.feature.panel.phase2.PanelPurgeTask) limit -> {
                ran[0] = limit;
                return 0;
            });
            new PanelMaintenance(repository,
                    factory.getBeanProvider(vacademy.io.auth_service.feature.panel.phase2.PanelPurgeTask.class))
                    .maybePurge();
            assertThat(ran[0]).isEqualTo(500);
        }
    }

    // -------------------------------------------------------------- wire ---

    @Nested
    class Wire {
        @Test
        void phase1ShapesSerialiseWithoutAnyPhase2Key() throws Exception {
            SyncResponse old = new SyncResponse(1L,
                    new SyncDevice("ACTIVE", "Room", "inst", "Alpha", "blue", "https://x", false), null,
                    new SyncFlags(false, 9999), new SyncPolicy(30, 4), 60_000, 1);
            JsonNode json = JSON.readTree(JSON.writeValueAsString(old));
            assertThat(json.has("licence")).isFalse();
            assertThat(json.has("update")).isFalse();
            assertThat(json.has("activity_acked_seq")).isFalse();
            assertThat(json.get("device").has("approval_state")).isFalse();
            assertThat(json.has("min_app_version_code")).isTrue();
        }

        @Test
        void phase2FieldsAreSnakeCase() throws Exception {
            SyncResponse response = new SyncResponse(1L,
                    new SyncDevice("ACTIVE", "Room", "inst", "Alpha", "blue", "https://x", false, "PENDING"), null,
                    new SyncFlags(false, 9999), new SyncPolicy(30, 4), 60_000, 3,
                    new SyncLicence("GRACE", true, "2027-03-31T18:29:59Z", null),
                    new SyncUpdate(4, "0.4.0", "https://x/a.apk", "ab", 10L, true), 9);
            JsonNode json = JSON.readTree(JSON.writeValueAsString(response));
            assertThat(json.get("device").get("approval_state").asText()).isEqualTo("PENDING");
            assertThat(json.get("licence").get("ends_at").asText()).isEqualTo("2027-03-31T18:29:59Z");
            assertThat(json.get("update").get("apk_url").asText()).isEqualTo("https://x/a.apk");
            assertThat(json.get("activity_acked_seq").asInt()).isEqualTo(9);
            SyncRequest request = JSON.readValue("{\"device_id\":\"d\",\"device_secret\":\"s\",\"presenting\":false,"
                    + "\"app_channel\":\"DIRECT\",\"activity\":[{\"seq\":1,\"kind\":\"DECK\",\"ref_id\":\"r\","
                    + "\"parent_id\":\"p\",\"title\":\"T\",\"at_ms\":5,\"extra\":1}],\"future\":true}", SyncRequest.class);
            assertThat(request.appChannel()).isEqualTo("DIRECT");
            assertThat(request.activity().get(0).refId()).isEqualTo("r");
            assertThat(request.activity().get(0).atMs()).isEqualTo(5L);
        }

        @Test
        void titlesAndCodesNeverReachALog() {
            String title = "PRIVATE-TITLE";
            ActivityEvent event = new ActivityEvent(1, "LESSON", "r", "p", title, 1L);
            assertThat(event.toString()).doesNotContain(title);
            assertThat(new SyncRequest("d", "s", null, null, 1, 2, false, null, null, List.of(event), "PLAY").toString())
                    .doesNotContain(title).contains("activity=1");
            assertThat(new SessionEndRequest("d", "s", "t", "IDLE", List.of(event)).toString()).doesNotContain(title);
            assertThat(new PartnerInviteResponse("i", "CODE1234", "x").toString()).doesNotContain("CODE1234");
            assertThat(new PartnerLinkRedeemRequest("CODE1234").toString()).doesNotContain("CODE1234");
            assertThat(new PartnerClaimRequest("CODE1234", 1, "inst", null, null).toString()).doesNotContain("CODE1234");
        }
    }
}
