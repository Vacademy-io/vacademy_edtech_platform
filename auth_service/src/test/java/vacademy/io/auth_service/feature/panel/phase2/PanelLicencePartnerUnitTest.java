package vacademy.io.auth_service.feature.panel.phase2;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceEnforcementRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerClaimRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerInviteRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerLinkRedeemRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncLicence;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.GrantRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.RoomSeatRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.TemplateRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceService;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceSuperAdminController;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceUsageService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelInstallerService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelInvitePurgeTask;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerAdminService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerNames;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerStaffService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerSuperAdminController;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelDevices;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Seats, approvals and installers without a database: switches, kill switch, gating and staff-only paths. */
class PanelLicencePartnerUnitTest {

    private static final Timestamp NOW = Timestamp.from(Instant.parse("2026-11-09T06:00:00Z"));

    @SuppressWarnings("unchecked")
    private static PanelTx inlineTx() {
        PanelTx tx = mock(PanelTx.class);
        when(tx.run(any())).thenAnswer(call -> ((Supplier<Object>) call.getArgument(0)).get());
        return tx;
    }

    private static CustomUserDetails principal(String userId) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(userId);
        when(user.getFullName()).thenReturn("Ira Installer");
        return user;
    }

    private static DeviceRow device(Integer appVersionCode, String approvalState) {
        return new DeviceRow("dev-1", "inst", "room-1", "Room 1", PanelSecrets.sha256Hex("secret"), "ACTIVE", "Alpha",
                "blue", null, NOW, true, "Lab", "Panel", 28, 66, appVersionCode, NOW, "1.1.1.1", "Admin", NOW, NOW,
                approvalState, null, null, null, NOW);
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    private static GrantRow grant(int seats, Instant from, Instant to, String status) {
        return new GrantRow("g-" + seats, "inst", "PAID", seats, Timestamp.from(from), Timestamp.from(to), 0, status,
                null, null, null, "staff", NOW, null, null);
    }

    private static RoomSeatRow room(String id, Timestamp licensedAt) {
        return new RoomSeatRow(id, "inst", "Room " + id, "ACTIVE", licensedAt, null, null);
    }

    // ---------------------------------------------------------------- seats ---

    @Nested
    class Seats {
        private final PanelLicenceRepository seats = mock(PanelLicenceRepository.class);
        private final PanelRepository panels = mock(PanelRepository.class);

        private PanelLicenceService service(Map<String, String> props) {
            return new PanelLicenceService(seats, panels, PanelPhase2Properties.of(props), new PanelCompat(),
                    inlineTx(), mock(InstituteOAuthClientAccessGuard.class));
        }

        private void picture(String enforcement, List<GrantRow> grants, List<RoomSeatRow> rooms) {
            when(seats.findEnforcement("inst")).thenReturn(Optional.ofNullable(enforcement));
            when(seats.listGrants("inst")).thenReturn(grants);
            when(seats.listRoomSeats("inst")).thenReturn(rooms);
            when(seats.dbNow()).thenReturn(NOW);
        }

        private List<GrantRow> oneSeat() {
            return List.of(grant(1, NOW.toInstant().minusSeconds(3600), NOW.toInstant().plusSeconds(86_400),
                    "ACTIVE"));
        }

        @Test
        void switchedOffTheGateIsPhase1AndReadsNothing() {
            PanelLicenceService off = service(Map.of());
            off.requireCanStart(device(3, "APPROVED"));
            off.onActivated(device(3, "APPROVED"));
            off.onApproved("dev-1", "inst", "u");
            assertThat(off.syncBlock(device(3, "APPROVED"))).isNull();
            assertThat(off.view("inst")).isEqualTo(PanelLicenceGate.InstituteLicenceView.UNMANAGED);
            verifyNoInteractions(seats, panels);
            assertThat(code(() -> off.adminLicence(principal("u"), "inst"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.assign(principal("u"), "room-1"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.release(principal("u"), "room-1"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.setEnforcement("inst", new LicenceEnforcementRequest("LIVE"), "s")))
                    .isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.template("auto_trial"))).isEqualTo("FEATURE_OFF");
        }

        @Test
        void liveRefusesAnUnlicensedRoomWithTheCodeTheAppKnows() {
            picture("LIVE", oneSeat(), List.of(room("room-1", null), room("room-2", NOW)));
            PanelLicenceService live = service(Map.of("panel.licence.enabled", "true"));
            assertThat(code(() -> live.requireCanStart(device(3, "APPROVED")))).isEqualTo("LICENCE_REQUIRED");
            assertThat(code(() -> live.requireCanStart(device(2, "APPROVED")))).isEqualTo("PANEL_DISABLED");
            assertThat(code(() -> live.requireCanStart(device(null, "APPROVED")))).isEqualTo("PANEL_DISABLED");
            assertThat(live.shadowRefusals()).isZero();
        }

        @Test
        void shadowAndTheKillSwitchNeverRefuseButCount() {
            picture("SHADOW", List.of(), List.of(room("room-1", null)));
            PanelLicenceService shadow = service(Map.of("panel.licence.enabled", "true"));
            assertThat(code(() -> shadow.requireCanStart(device(3, "APPROVED")))).isEqualTo("OK");
            assertThat(shadow.shadowRefusals()).isEqualTo(1);

            picture("LIVE", List.of(), List.of(room("room-1", null)));
            PanelLicenceService neverBlock = service(Map.of("panel.licence.enabled", "true",
                    "panel.licence.never-block", "true"));
            assertThat(code(() -> neverBlock.requireCanStart(device(3, "APPROVED")))).isEqualTo("OK");
            assertThat(neverBlock.shadowRefusals()).isEqualTo(1);
            SyncLicence block = neverBlock.syncBlock(device(3, "APPROVED"));
            assertThat(block.state()).isEqualTo("EXPIRED");
            assertThat(block.enforced()).isFalse();
        }

        @Test
        void aCachedRefusalIsReadAgainBeforeItBlocks() {
            when(seats.findEnforcement("inst")).thenReturn(Optional.of("LIVE"));
            when(seats.listGrants("inst")).thenReturn(oneSeat());
            when(seats.dbNow()).thenReturn(NOW);
            // The first read has no seat on the room; the second (another pod assigned one) has.
            when(seats.listRoomSeats("inst")).thenReturn(List.of(room("room-1", null)),
                    List.of(room("room-1", NOW)));
            PanelLicenceService live = service(Map.of("panel.licence.enabled", "true"));
            assertThat(code(() -> live.requireCanStart(device(3, "APPROVED")))).isEqualTo("OK");
        }

        @Test
        void offEnforcementShowsUnmanagedAndAllows() {
            picture(null, List.of(), List.of(room("room-1", null)));
            PanelLicenceService on = service(Map.of("panel.licence.enabled", "true"));
            assertThat(code(() -> on.requireCanStart(device(3, "APPROVED")))).isEqualTo("OK");
            assertThat(on.syncBlock(device(3, "APPROVED")).state()).isEqualTo("UNMANAGED");
            assertThat(on.view("inst").state()).isEqualTo("UNMANAGED");
            assertThat(on.view("inst").roomStates()).isEmpty();
            assertThat(on.shadowRefusals()).isZero();
        }

        @Test
        void autoTrialOnlyWithAnActiveTemplateRowAndEnforcementOn() {
            when(panels.findDevice("dev-1")).thenReturn(Optional.of(device(3, "APPROVED")));
            picture("SHADOW", List.of(), List.of(room("room-1", null)));
            when(seats.countStartedGrants("inst")).thenReturn(0);
            when(seats.findTemplate("auto_trial")).thenReturn(Optional.empty());
            PanelLicenceService on = service(Map.of("panel.licence.enabled", "true"));
            on.onActivated(device(3, "APPROVED"));
            verify(seats, never()).insertGrantFromTemplate(anyString(), anyString(), any(), anyString());
            verify(seats, never()).assignSeat(anyString(), any());

            TemplateRow inactive = new TemplateRow("auto_trial", "TRIAL", 2, 14, 0, false, "s", NOW);
            when(seats.findTemplate("auto_trial")).thenReturn(Optional.of(inactive));
            on.onActivated(device(3, "APPROVED"));
            verify(seats, never()).insertGrantFromTemplate(anyString(), anyString(), any(), anyString());

            TemplateRow active = new TemplateRow("auto_trial", "TRIAL", 2, 14, 0, true, "s", NOW);
            when(seats.findTemplate("auto_trial")).thenReturn(Optional.of(active));
            on.onActivated(device(3, "APPROVED"));
            verify(seats).insertGrantFromTemplate(anyString(), eq("inst"), eq(active), eq("auto_trial"));

            when(seats.findEnforcement("inst")).thenReturn(Optional.of("OFF"));
            PanelLicenceService off = service(Map.of("panel.licence.enabled", "true"));
            off.onActivated(device(3, "APPROVED"));
            verify(seats).insertGrantFromTemplate(anyString(), eq("inst"), eq(active), eq("auto_trial"));
        }

        @Test
        void aPendingPanelGetsNoSeatAtActivation() {
            when(panels.findDevice("dev-1")).thenReturn(Optional.of(device(3, "PENDING")));
            picture("LIVE", oneSeat(), List.of(room("room-1", null)));
            service(Map.of("panel.licence.enabled", "true")).onActivated(device(3, "PENDING"));
            verify(seats, never()).assignSeat(anyString(), any());
            verify(panels).lockForTransaction("panel_licence:inst");
        }

        @Test
        void activationTakesAFreeSeatOnlyWhenOneIsLeft() {
            when(panels.findDevice("dev-1")).thenReturn(Optional.of(device(3, "APPROVED")));
            picture("LIVE", oneSeat(), List.of(room("room-1", null), room("room-9", NOW)));
            service(Map.of("panel.licence.enabled", "true")).onActivated(device(3, "APPROVED"));
            verify(seats, never()).assignSeat(anyString(), any());

            picture("LIVE", oneSeat(), List.of(room("room-1", null)));
            when(seats.assignSeat("room-1", null)).thenReturn(1);
            service(Map.of("panel.licence.enabled", "true")).onActivated(device(3, "APPROVED"));
            verify(seats).insertEvent("inst", "room-1", "ASSIGNED", "AUTO_ACTIVATE", null);
        }
    }

    // ------------------------------------------------------------ installers ---

    @Nested
    class Installers {
        private final PanelPartnerRepository partners = mock(PanelPartnerRepository.class);
        private final PanelRepository panels = mock(PanelRepository.class);
        private final PanelInstituteDirectory directory = mock(PanelInstituteDirectory.class);
        private final UserRoleRepository roles = mock(UserRoleRepository.class);

        private PanelInstallerService installers(Map<String, String> props) {
            PanelProperties properties = new PanelProperties(true, true, 1, 4, false, 9999, 30, 4, 1,
                    "https://classroom.vacademy.io", "", "");
            return new PanelInstallerService(partners, panels, PanelPhase2Properties.of(props), properties,
                    new PanelRateLimiter(properties), inlineTx(), directory, roles,
                    mock(PanelPartnerNames.class));
        }

        @Test
        void switchedOffEveryInstallerAndSchoolPathIsFeatureOffBeforeAnyRead() {
            PanelInstallerService off = installers(Map.of());
            CustomUserDetails user = principal("u");
            assertThat(code(() -> off.me(user))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.redeem(user, new PartnerLinkRedeemRequest("ABCD1234")))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.customers(user))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.rooms(user, "inst"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.installs(user, "inst"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.claim(user, new PartnerClaimRequest("ABCD1234", 1, "inst", null, "R"))))
                    .isEqualTo("FEATURE_OFF");
            verifyNoInteractions(partners, panels, directory, roles);

            PanelPartnerAdminService admin = new PanelPartnerAdminService(partners, panels,
                    PanelPhase2Properties.allOff(), mock(PanelRateLimiter.class), inlineTx(),
                    mock(InstituteOAuthClientAccessGuard.class), mock(PanelDevices.class),
                    mock(PanelLicenceService.class), 7, 30);
            assertThat(code(() -> admin.links(user, "inst"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> admin.createInvite(user, new PartnerInviteRequest("inst", 30))))
                    .isEqualTo("FEATURE_OFF");
            assertThat(code(() -> admin.cancelInvite(user, "i"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> admin.revokeLink(user, "l"))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> admin.openInvites(user, "inst"))).isEqualTo("FEATURE_OFF");

            PanelPartnerStaffService staff = new PanelPartnerStaffService(partners, panels,
                    PanelPhase2Properties.allOff(), inlineTx(), mock(PanelPartnerNames.class), 30);
            assertThat(code(staff::list)).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> staff.revokeLink("l", "s"))).isEqualTo("FEATURE_OFF");
            verifyNoInteractions(partners, panels);

            assertThat(new PanelInvitePurgeTask(partners, PanelPhase2Properties.allOff(), 30).purge(500)).isZero();
            verifyNoInteractions(partners);

            // Approve and reject settle panels already waiting, so they stay reachable with the switch off.
            when(panels.findDevice("d")).thenReturn(Optional.empty());
            assertThat(code(() -> admin.approve(user, "d"))).isEqualTo("NOT_FOUND");
            assertThat(code(() -> admin.reject(user, "d"))).isEqualTo("NOT_FOUND");
        }

        @Test
        void someoneWithoutTheRoleIsNotAnInstallerAndCannotBurnACode() {
            when(roles.findUserRolesByUserIdAndStatusesAndRoleNames(anyString(), any(), any())).thenReturn(List.of());
            when(partners.findActivePartnerOfInstitutes(any())).thenReturn(Optional.empty());
            PanelInstallerService on = installers(Map.of("panel.partners.enabled", "true"));
            assertThat(code(() -> on.me(principal("u")))).isEqualTo("NOT_INSTALLER");
            assertThat(code(() -> on.redeem(principal("u"), new PartnerLinkRedeemRequest("ABCD-1234"))))
                    .isEqualTo("NOT_INSTALLER");
            verify(partners, never()).consumeInvite(anyString(), anyString());
            verify(roles, org.mockito.Mockito.atLeastOnce())
                    .findUserRolesByUserIdAndStatusesAndRoleNames("u", List.of("ACTIVE"), List.of("ADMIN"));
        }

        @Test
        void redeemIsLimitedToTenAnHourPerUser() {
            PanelInstallerService on = installers(Map.of("panel.partners.enabled", "true"));
            CustomUserDetails user = principal("u-limit");
            List<String> codes = new ArrayList<>();
            for (int i = 0; i < 11; i++) {
                codes.add(code(() -> on.redeem(user, new PartnerLinkRedeemRequest("x"))));
            }
            assertThat(codes.subList(0, 10)).containsOnly("INVITE_INVALID");
            assertThat(codes.get(10)).isEqualTo("RATE_LIMITED");
            assertThat(code(() -> on.redeem(principal("u-other"), new PartnerLinkRedeemRequest("x"))))
                    .isEqualTo("INVITE_INVALID");
        }

        @Test
        void theClaimWaitsForTheSchoolNameBeforeTouchingTheDatabase() {
            PanelInstallerService on = installers(Map.of("panel.partners.enabled", "true"));
            when(directory.get("inst")).thenReturn(Optional.empty());
            assertThat(code(() -> on.claim(principal("u"), new PartnerClaimRequest("ABCD1234", 12, "inst", null,
                    "Room")))).isEqualTo("TRY_AGAIN");
            verifyNoInteractions(partners, panels, roles);
            assertThat(code(() -> on.claim(principal("u"), new PartnerClaimRequest("ABCD1234", 12, "../x", null,
                    "Room")))).isEqualTo("BAD_REQUEST");
        }
    }

    // ---------------------------------------------------------- staff only ---

    @Nested
    class StaffOnly {
        /**
         * Every handler of both platform-staff controllers refuses a caller outside the allowlist
         * before the service is touched. The test environment has no allowlist, which also refuses.
         */
        @Test
        void everySuperAdminHandlerChecksTheAllowlistFirst() throws Exception {
            PanelLicenceService licence = mock(PanelLicenceService.class);
            PanelLicenceUsageService usage = mock(PanelLicenceUsageService.class);
            PanelPartnerStaffService staff = mock(PanelPartnerStaffService.class);
            int handlers = 0;
            for (Object controller : List.of(new PanelLicenceSuperAdminController(licence, usage),
                    new PanelPartnerSuperAdminController(staff))) {
                for (Method method : controller.getClass().getDeclaredMethods()) {
                    if (!isHandler(method)) {
                        continue;
                    }
                    handlers++;
                    Object[] args = new Object[method.getParameterCount()];
                    args[0] = principal("not-staff-" + method.getName());
                    try {
                        method.invoke(controller, args);
                        throw new AssertionError(method.getName() + " did not refuse");
                    } catch (InvocationTargetException e) {
                        assertThat(e.getCause()).isInstanceOf(VacademyException.class);
                        assertThat(((VacademyException) e.getCause()).getStatus().value()).isEqualTo(403);
                    }
                }
            }
            assertThat(handlers).isEqualTo(14);
            verifyNoInteractions(licence, usage, staff);
        }

        private boolean isHandler(Method method) {
            return method.isAnnotationPresent(GetMapping.class) || method.isAnnotationPresent(PostMapping.class)
                    || method.isAnnotationPresent(PutMapping.class) || method.isAnnotationPresent(PatchMapping.class)
                    || method.isAnnotationPresent(DeleteMapping.class);
        }
    }

    @Test
    void invitePurgeRunsOnlyWhileInstallersAreOn() {
        PanelPartnerRepository partners = mock(PanelPartnerRepository.class);
        when(partners.purgeOldInvites(anyInt(), anyInt())).thenReturn(3);
        int purged = new PanelInvitePurgeTask(partners, PanelPhase2Properties.of(Map.of("panel.partners.enabled",
                "true")), 30).purge(500);
        assertThat(purged).isEqualTo(3);
        verify(partners).markExpiredInvites(500);
        verify(partners).purgeOldInvites(30, 500);
    }
}
