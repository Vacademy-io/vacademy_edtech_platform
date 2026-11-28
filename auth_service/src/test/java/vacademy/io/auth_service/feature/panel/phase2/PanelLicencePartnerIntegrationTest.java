package vacademy.io.auth_service.feature.panel.phase2;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.autoconfigure.transaction.TransactionAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.crypto.password.NoOpPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.auth_service.core.config.UserDetailsServiceImpl;
import vacademy.io.auth_service.feature.demo.repository.InstituteTrialRepository;
import vacademy.io.auth_service.feature.demo.service.TrialAccessGuard;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceService;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceUsageService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelInstallerService;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerOpenInviteRow;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelInvitePurgeTask;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerAdminService;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerNames;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerRepository;
import vacademy.io.auth_service.feature.panel.phase2.partner.PanelPartnerStaffService;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.service.PanelAccessPolicy;
import vacademy.io.auth_service.feature.panel.service.PanelAdminService;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelChallengeService;
import vacademy.io.auth_service.feature.panel.service.PanelDevices;
import vacademy.io.auth_service.feature.panel.service.PanelInstituteDirectory;
import vacademy.io.auth_service.feature.panel.service.PanelMaintenance;
import vacademy.io.auth_service.feature.panel.service.PanelPairingService;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelSessionService;
import vacademy.io.auth_service.feature.panel.service.PanelTokenService;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Seats, approvals and installers against a real local Postgres, with every switch of this chunk on
 * and enforcement per institute. Each state transition is driven through the real services, the way
 * the endpoints call them. Skipped unless PANEL_TEST_JDBC_URL is set; refuses anything but loopback.
 */
@EnabledIfEnvironmentVariable(named = "PANEL_TEST_JDBC_URL", matches = ".+")
@SpringBootTest(classes = PanelLicencePartnerIntegrationTest.Config.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = { "panel.enabled=true", "panel.licence.enabled=true", "panel.partners.enabled=true",
                "spring.jpa.open-in-view=false", "spring.jpa.hibernate.ddl-auto=none",
                "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=true",
                "spring.flyway.baseline-version=1", "spring.datasource.hikari.maximum-pool-size=15",
                "spring.main.banner-mode=off" })
class PanelLicencePartnerIntegrationTest {

    @Configuration
    @ImportAutoConfiguration({ DataSourceAutoConfiguration.class, FlywayAutoConfiguration.class,
            HibernateJpaAutoConfiguration.class, JdbcTemplateAutoConfiguration.class,
            TransactionAutoConfiguration.class })
    @EntityScan(basePackages = { "vacademy.io.common.auth.entity", "vacademy.io.auth_service.feature.demo.entity" })
    @EnableJpaRepositories(basePackageClasses = { UserRepository.class, InstituteTrialRepository.class })
    @Import({ PanelRepository.class, PanelProperties.class, PanelRateLimiter.class, PanelMaintenance.class,
            PanelDevices.class, PanelTx.class, PanelInstituteDirectory.class, PanelPairingService.class,
            PanelChallengeService.class, PanelSessionService.class, PanelAdminService.class, PanelTokenService.class,
            PanelAccessPolicy.class, TrialAccessGuard.class, InstituteOAuthClientAccessGuard.class,
            UserDetailsServiceImpl.class, PanelPhase2Properties.class, PanelCompat.class,
            DefaultPanelApprovalGate.class,
            // This chunk.
            PanelLicenceService.class, PanelLicenceRepository.class, PanelLicenceUsageService.class,
            PanelPartnerRepository.class, PanelPartnerNames.class, PanelInstallerService.class,
            PanelPartnerAdminService.class, PanelPartnerStaffService.class, PanelInvitePurgeTask.class })
    static class Config {
        @Bean
        AuthenticationManager authenticationManager(UserDetailsServiceImpl userDetails) {
            DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
            provider.setUserDetailsService(userDetails);
            provider.setPasswordEncoder(NoOpPasswordEncoder.getInstance());
            return new ProviderManager(provider);
        }

        /** The other phase 2 seams at their phase 1 behaviour, so this test depends only on this chunk. */
        @Bean
        PanelActivityIngest activityIngest() {
            return new PanelActivityIngest() {
            };
        }

        @Bean
        PanelReleaseOffer releaseOffer() {
            return new PanelReleaseOffer() {
            };
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) throws Exception {
        String url = System.getenv("PANEL_TEST_JDBC_URL");
        if (url == null || !(url.startsWith("jdbc:postgresql://127.0.0.1:") || url.startsWith("jdbc:postgresql://localhost:"))) {
            throw new IllegalStateException("PANEL_TEST_JDBC_URL must point at a local throwaway database");
        }
        String user = System.getenv().getOrDefault("PANEL_TEST_DB_USER", "postgres");
        String password = System.getenv().getOrDefault("PANEL_TEST_DB_PASSWORD", "");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> user);
        registry.add("spring.datasource.password", () -> password);
        try (Connection connection = DriverManager.getConnection(url, user, password);
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA IF NOT EXISTS panel_it_prereq");
            for (String name : List.of("update_updated_on_user_task", "update_updated_at_column")) {
                statement.execute("CREATE OR REPLACE FUNCTION panel_it_prereq." + name + "() RETURNS trigger "
                        + "LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$");
            }
            statement.execute("ALTER DATABASE \"" + connection.getCatalog()
                    + "\" SET search_path = public, panel_it_prereq");
        }
    }

    @MockBean
    InstituteInternalService instituteInternalService;
    @SpyBean
    PanelLicenceService licence;

    @Autowired
    JdbcTemplate sql;
    @Autowired
    PanelPairingService pairing;
    @Autowired
    PanelChallengeService challenges;
    @Autowired
    PanelSessionService sessions;
    @Autowired
    PanelAdminService admin;
    @Autowired
    PanelLicenceUsageService usage;
    @Autowired
    PanelInstallerService installers;
    @Autowired
    PanelPartnerAdminService partnerAdmin;
    @Autowired
    PanelPartnerStaffService staff;
    @Autowired
    PanelInvitePurgeTask invitePurge;
    @Autowired
    UserDetailsServiceImpl userDetails;
    @Autowired
    PanelPartnerRepository partnerRepository;
    @Autowired
    PanelRepository panelRepository;
    @Autowired
    PanelRateLimiter rateLimiter;
    @Autowired
    PanelTx panelTx;
    @Autowired
    InstituteOAuthClientAccessGuard accessGuard;
    @Autowired
    PanelDevices panelDevices;

    private String institute;
    private String schoolAdmin;

    @BeforeEach
    void freshInstitute() {
        institute = "it-" + rand();
        when(instituteInternalService.getInstituteByInstituteId(anyString())).thenAnswer(call -> {
            InstituteInfoDTO info = new InstituteInfoDTO();
            info.setInstituteName("School " + call.getArgument(0));
            info.setInstituteThemeCode("blue");
            info.setAdminPortalUrl("https://portal.school.example/x");
            return info;
        });
        schoolAdmin = user(institute, "ADMIN");
    }

    // ---------------------------------------------------------- fixtures ---

    private static String rand() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private static String ip() {
        return "ip-" + rand();
    }

    private String roleId(String name) {
        sql.update("INSERT INTO roles (id, role_name) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = ?)",
                "it-" + rand(), name, name);
        return sql.queryForObject("SELECT id FROM roles WHERE role_name = ? LIMIT 1", String.class, name);
    }

    private String user(String inst, String role) {
        String id = "u-" + rand();
        sql.update("INSERT INTO users (id, username, email, password_hash, full_name, is_root_user) "
                + "VALUES (?, ?, ?, 'secret-pass', ?, false)", id, id, id + "@local.test", "Name " + id);
        sql.update("INSERT INTO user_role (id, user_id, role_id, institute_id, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), id, roleId(role), inst);
        return id;
    }

    private CustomUserDetails as(String userId) {
        return (CustomUserDetails) userDetails.loadUserByUsername("null@" + userId);
    }

    /** The PanelApiException code, FORBIDDEN for the shared guard's refusal, or OK. */
    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        } catch (VacademyException e) {
            return e.getStatus().value() == 403 ? "FORBIDDEN" : "ERROR_" + e.getStatus().value();
        }
        return "OK";
    }

    private PairStartResponse pairStart(int appVersion) {
        return pairing.start(new PairStartRequest("install-" + rand(),
                Map.of("manufacturer", "Lab", "model", "Panel 65", "sdk_int", 28, "webview_major", 66,
                        "app_version_code", appVersion)), ip());
    }

    private record Paired(String id, String secret, String roomId) {
    }

    private Paired pickUpAndConfirm(PairStartResponse pair, String roomId) {
        PairPollResponse polled = pairing.poll(new PairPollRequest(pair.pairSecret()));
        assertThat(polled.state()).isEqualTo("CLAIMED");
        pairing.confirm(new PairConfirmRequest(polled.deviceId(), polled.deviceSecret(), true));
        return new Paired(polled.deviceId(), polled.deviceSecret(), roomId);
    }

    /** An admin claim (auto-approved, as in phase 1) into a new room. */
    private Paired adminPaired(String inst, int appVersion) {
        PairStartResponse pair = pairStart(appVersion);
        DeviceClaimResponse claimed = pairing.claim(as(user(inst, "ADMIN")), new DeviceClaimRequest(pair.code(),
                pair.matchCode(), inst, null, "Room " + rand(), false));
        return pickUpAndConfirm(pair, claimed.room().id());
    }

    private Paired adminPaired(int appVersion) {
        return adminPaired(institute, appVersion);
    }

    private void enforce(String inst, String mode) {
        licence.setEnforcement(inst, new LicenceEnforcementRequest(mode), "staff");
    }

    private LicenceGrantDetail grant(String inst, String kind, int seats, long fromDays, long toDays, int grace) {
        Instant now = Instant.now();
        return licence.createGrant(inst, new LicenceGrantCreateRequest(kind, seats,
                now.plus(fromDays, ChronoUnit.DAYS).toString(), now.plus(toDays, ChronoUnit.DAYS).toString(), grace,
                null, "REF-1", "staff note"), "staff");
    }

    private String roomLicensedAt(String roomId) {
        return sql.queryForObject("SELECT licensed_at::text FROM classroom_room WHERE id = ?", String.class, roomId);
    }

    private int events(String inst, String action, String reason) {
        return sql.queryForObject("SELECT count(*) FROM panel_licence_event WHERE institute_id = ? AND action = ? "
                + "AND reason = ?", Integer.class, inst, action, reason);
    }

    private ChallengeResponse challenge(Paired device) {
        return challenges.create(new ChallengeRequest(device.id(), device.secret(), "SIGN_IN", null));
    }

    private static String tokenOf(ChallengeResponse challenge) {
        return challenge.qrUrl().split("#c=")[1];
    }

    private ChallengeApprovedResponse approve(String userId, ChallengeResponse challenge) {
        return (ChallengeApprovedResponse) challenges.approve(as(userId),
                new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), ip());
    }

    private record Signed(ChallengeApprovedResponse approved, ChallengePollResponse redeemed) {
    }

    private Signed signIn(Paired device, String teacher) {
        ChallengeResponse challenge = challenge(device);
        ChallengeApprovedResponse approved = approve(teacher, challenge);
        ChallengePollResponse redeemed = challenges.poll(new ChallengePollRequest(device.id(), device.secret(),
                challenge.challengeId()));
        assertThat(redeemed.state()).isEqualTo("REDEEMED");
        return new Signed(approved, redeemed);
    }

    private SyncResponse signedOutSync(Paired device) {
        return sessions.sync(new SyncRequest(device.id(), device.secret(), null, null, null, null, false, null), ip());
    }

    private record Partner(String id, String institute, String installer) {
    }

    private Partner partner() {
        String partnerInstitute = "pi-" + rand();
        PartnerResponse created = staff.create(new PartnerCreateRequest("Installer Org " + rand(), partnerInstitute),
                "staff");
        return new Partner(created.id(), partnerInstitute, user(partnerInstitute, "ADMIN"));
    }

    private PartnerLinkRedeemResponse link(Partner partner, String inst) {
        PartnerInviteResponse invite = partnerAdmin.createInvite(as(user(inst, "ADMIN")),
                new PartnerInviteRequest(inst, 30));
        return installers.redeem(as(partner.installer()), new PartnerLinkRedeemRequest(invite.code()));
    }

    private DeviceClaimResponse installerClaim(Partner partner, String inst, PairStartResponse pair, String roomId) {
        return installers.claim(as(partner.installer()), new PartnerClaimRequest(pair.code(), pair.matchCode(), inst,
                roomId, roomId == null ? "Room " + rand() : null));
    }

    private static <T> List<Object> race(List<Callable<T>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CountDownLatch ready = new CountDownLatch(calls.size());
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Object>> futures = new ArrayList<>();
        for (Callable<T> call : calls) {
            futures.add(pool.submit(() -> {
                ready.countDown();
                go.await();
                try {
                    return call.call();
                } catch (PanelApiException e) {
                    return e.getCode();
                }
            }));
        }
        ready.await();
        go.countDown();
        List<Object> results = new ArrayList<>();
        for (Future<Object> future : futures) {
            results.add(future.get(30, TimeUnit.SECONDS));
        }
        pool.shutdown();
        return results;
    }

    // --------------------------------------------------------------- seats ---

    @Test
    void seatsFollowActivationEnforcementAssignAndRelease() {
        LicenceResponse unmanaged = licence.adminLicence(as(schoolAdmin), institute);
        assertThat(unmanaged.state()).isEqualTo("UNMANAGED");
        assertThat(unmanaged.enforcement()).isEqualTo("OFF");

        grant(institute, "PAID", 2, -1, 30, 0);
        // Seats are handed out at activation even before enforcement is on, so switching it on later is quiet.
        Paired first = adminPaired(3);
        assertThat(roomLicensedAt(first.roomId())).isNotNull();
        assertThat(events(institute, "ASSIGNED", "AUTO_ACTIVATE")).isEqualTo(1);
        assertThat(signedOutSync(first).licence().state()).isEqualTo("UNMANAGED");

        enforce(institute, "SHADOW");
        Paired second = adminPaired(3);
        Paired third = adminPaired(3);
        assertThat(roomLicensedAt(second.roomId())).isNotNull();
        assertThat(roomLicensedAt(third.roomId())).isNull();
        LicenceResponse shadow = licence.adminLicence(as(schoolAdmin), institute);
        assertThat(shadow.state()).isEqualTo("ACTIVE");
        assertThat(shadow.seatsGranted()).isEqualTo(2);
        assertThat(shadow.seatsUsed()).isEqualTo(2);
        assertThat(shadow.grants()).hasSize(1);
        assertThat(shadow.rooms()).filteredOn(row -> row.room().id().equals(third.roomId()))
                .singleElement().satisfies(row -> assertThat(row.licenceState()).isEqualTo("UNLICENSED"));
        SyncLicence shadowBlock = signedOutSync(third).licence();
        assertThat(shadowBlock.state()).isEqualTo("UNLICENSED");
        assertThat(shadowBlock.enforced()).isFalse();
        assertThat(code(() -> challenge(third))).isEqualTo("OK");

        enforce(institute, "LIVE");
        assertThat(code(() -> challenge(third))).isEqualTo("LICENCE_REQUIRED");
        assertThat(signedOutSync(third).licence().enforced()).isTrue();
        assertThat(code(() -> signIn(first, user(institute, "TEACHER")))).isEqualTo("OK");
        assertThat(code(() -> licence.assign(as(schoolAdmin), third.roomId()))).isEqualTo("NO_SEAT");

        assertThat(licence.release(as(schoolAdmin), second.roomId()).licenceState()).isEqualTo("UNLICENSED");
        assertThat(events(institute, "RELEASED", "ADMIN")).isEqualTo(1);
        assertThat(licence.assign(as(schoolAdmin), third.roomId()).licenceState()).isEqualTo("LICENSED");
        assertThat(licence.assign(as(schoolAdmin), third.roomId()).licenceState()).isEqualTo("LICENSED");
        assertThat(events(institute, "ASSIGNED", "ADMIN")).isEqualTo(1);
        assertThat(code(() -> challenge(third))).isEqualTo("OK");
        assertThat(code(() -> challenge(second))).isEqualTo("LICENCE_REQUIRED");

        // The device list and the platform view read the same picture; tenants never see the reference.
        assertThat(admin.listDevices(as(schoolAdmin), institute))
                .filteredOn(row -> row.id().equals(second.id())).singleElement()
                .satisfies(row -> assertThat(row.licenceState()).isEqualTo("UNLICENSED"));
        LicenceAdminResponse detail = licence.adminDetail(institute);
        assertThat(detail.grants()).singleElement().satisfies(g -> {
            assertThat(g.externalRef()).isEqualTo("REF-1");
            assertThat(g.note()).isEqualTo("staff note");
        });
    }

    @Test
    void anOldAppIsToldPanelDisabledAndTheApproveIsCheckedAgain() {
        grant(institute, "PAID", 1, -1, 30, 0);
        Paired licensed = adminPaired(3);
        Paired oldApp = adminPaired(2);
        enforce(institute, "LIVE");
        assertThat(code(() -> challenge(oldApp))).isEqualTo("PANEL_DISABLED");

        // A QR shown while the room had its seat, approved after the seat went.
        ChallengeResponse shown = challenge(licensed);
        licence.release(as(schoolAdmin), licensed.roomId());
        assertThat(code(() -> approve(user(institute, "TEACHER"), shown))).isEqualTo("LICENCE_REQUIRED");

        admin.patchDevice(as(schoolAdmin), licensed.id(), new DevicePatchRequest(null, true));
        String teacher = user(institute, "TEACHER");
        assertThat(code(() -> sessions.loginPassword(new LoginPasswordRequest(licensed.id(), licensed.secret(),
                teacher, "secret-pass")))).isEqualTo("LICENCE_REQUIRED");
        licence.assign(as(schoolAdmin), licensed.roomId());
        assertThat(sessions.loginPassword(new LoginPasswordRequest(licensed.id(), licensed.secret(), teacher,
                "secret-pass")).sessionId()).isNotNull();
    }

    @Test
    void shadowNeverBlocksButRecords() {
        enforce(institute, "SHADOW");
        Paired device = adminPaired(3);
        assertThat(licence.adminLicence(as(schoolAdmin), institute).state()).isEqualTo("NONE");
        long before = licence.shadowRefusals();
        Signed signed = signIn(device, user(institute, "TEACHER"));
        assertThat(signed.approved().sessionId()).isNotNull();
        // Counted at challenge create and again at approve.
        assertThat(licence.shadowRefusals()).isGreaterThanOrEqualTo(before + 2);
        assertThat(signedOutSync(adminPaired(3)).licence().state()).isEqualTo("EXPIRED");
    }

    /** T75: a class running when the seat goes keeps running; only the next sign-in is refused. */
    @Test
    void liveBlocksOnlyNewStartsAndNeverConsultsSeatsMidClass() {
        LicenceGrantDetail only = grant(institute, "PAID", 1, -1, 30, 0);
        Paired device = adminPaired(3);
        enforce(institute, "LIVE");
        String teacher = user(institute, "TEACHER");
        Signed signed = signIn(device, teacher);
        String sessionId = signed.approved().sessionId();
        String token = signed.redeemed().sessionToken();

        licence.cancelGrant(only.id(), new LicenceGrantCancelRequest("ended"), "staff");
        assertThat(licence.adminLicence(as(schoolAdmin), institute).state()).isEqualTo("EXPIRED");
        clearInvocations(licence);

        SessionRefreshResponse refreshed = sessions.refresh(new SessionRefreshRequest(device.id(), device.secret(),
                token));
        assertThat(refreshed.accessToken()).isNotBlank();
        SyncResponse running = sessions.sync(new SyncRequest(device.id(), device.secret(), sessionId, token, null,
                null, true, new NavState(1, 5, "Slide")), ip());
        assertThat(running.session().status()).isEqualTo("ACTIVE");
        assertThat(running.licence()).isNull();
        assertThat(sessions.remoteNav(new RemoteNavRequest(signed.approved().remoteToken(), 1, 1L)).accepted())
                .isTrue();
        ChallengeResponse attach = challenges.create(new ChallengeRequest(device.id(), device.secret(),
                "ATTACH_REMOTE", token));
        ChallengeApprovedResponse attached = approve(teacher, attach);
        assertThat(attached.sessionId()).isEqualTo(sessionId);
        assertThat(sessions.remoteNav(new RemoteNavRequest(attached.remoteToken(), 1, 2L)).accepted()).isTrue();
        verify(licence, never()).requireCanStart(any());

        assertThat(code(() -> challenge(device))).isEqualTo("LICENCE_REQUIRED");
        verify(licence).requireCanStart(any());
    }

    @Test
    void graceAllowsAndShrinkingPutsTheNewestRoomOverTheLimit() {
        enforce(institute, "LIVE");
        grant(institute, "PAID", 1, -30, 30, 0);
        LicenceGrantDetail extra = grant(institute, "PAID", 1, -30, 30, 0);
        Paired older = adminPaired(3);
        Paired newer = adminPaired(3);
        assertThat(roomLicensedAt(newer.roomId())).isNotNull();

        licence.cancelGrant(extra.id(), null, "staff");
        assertThat(signedOutSync(older).licence().state()).isEqualTo("LICENSED");
        assertThat(signedOutSync(newer).licence().state()).isEqualTo("OVER_LIMIT");
        assertThat(code(() -> challenge(newer))).isEqualTo("LICENCE_REQUIRED");
        assertThat(roomLicensedAt(newer.roomId())).isNotNull();

        String other = "it-" + rand();
        String otherAdmin = user(other, "ADMIN");
        enforce(other, "LIVE");
        grant(other, "PAID", 1, -40, 30, 0);
        Paired graced = adminPaired(other, 3);
        sql.update("UPDATE panel_licence_grant SET ends_at = now() - interval '2 days', grace_days = 5 "
                + "WHERE institute_id = ?", other);
        licence.setEnforcement(other, new LicenceEnforcementRequest("LIVE"), "staff");
        SyncLicence block = signedOutSync(graced).licence();
        assertThat(block.state()).isEqualTo("GRACE");
        assertThat(block.graceEndsAt()).isNotNull();
        assertThat(code(() -> challenge(graced))).isEqualTo("OK");
        assertThat(licence.adminLicence(as(otherAdmin), other).state()).isEqualTo("GRACE");
    }

    @Test
    void autoTrialOnlyWithAnActiveTemplateRow() {
        try {
            licence.putTemplate("auto_trial", new LicenceTemplateRequest("TRIAL", 1, 14, 0, false), "staff");
            enforce(institute, "SHADOW");
            adminPaired(3);
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_licence_grant WHERE institute_id = ?",
                    Integer.class, institute)).isZero();

            licence.putTemplate("auto_trial", new LicenceTemplateRequest("TRIAL", 1, 14, 0, true), "staff");
            String trial = "it-" + rand();
            String trialAdmin = user(trial, "ADMIN");
            enforce(trial, "SHADOW");
            Paired first = adminPaired(trial, 3);
            LicenceResponse view = licence.adminLicence(as(trialAdmin), trial);
            assertThat(view.state()).isEqualTo("TRIAL");
            assertThat(view.seatsGranted()).isEqualTo(1);
            assertThat(roomLicensedAt(first.roomId())).isNotNull();
            adminPaired(trial, 3);
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_licence_grant WHERE institute_id = ?",
                    Integer.class, trial)).isEqualTo(1);

            String unmanaged = "it-" + rand();
            adminPaired(unmanaged, 3);
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_licence_grant WHERE institute_id = ?",
                    Integer.class, unmanaged)).isZero();
        } finally {
            licence.putTemplate("auto_trial", new LicenceTemplateRequest("TRIAL", 1, 14, 0, false), "staff");
        }
    }

    @Test
    void concurrentAssignmentNeverOversubscribes() throws Exception {
        grant(institute, "PAID", 1, -1, 30, 0);
        String roomA = admin.createRoom(as(schoolAdmin), new RoomCreateRequest(institute, "A " + rand())).id();
        String roomB = admin.createRoom(as(schoolAdmin), new RoomCreateRequest(institute, "B " + rand())).id();
        String adminA = user(institute, "ADMIN");
        String adminB = user(institute, "ADMIN");
        List<Object> results = race(List.<Callable<Object>>of(
                () -> licence.assign(as(adminA), roomA).licenceState(),
                () -> licence.assign(as(adminB), roomB).licenceState()));
        assertThat(results).containsExactlyInAnyOrder("LICENSED", "NO_SEAT")
                .withFailMessage("results %s", results);
        assertThat(sql.queryForObject("SELECT count(*) FROM classroom_room WHERE institute_id = ? "
                + "AND licensed_at IS NOT NULL", Integer.class, institute)).isEqualTo(1);
    }

    @Test
    void archivingAnEmptyRoomGivesItsSeatBack() {
        grant(institute, "PAID", 1, -1, 30, 0);
        String room = admin.createRoom(as(schoolAdmin), new RoomCreateRequest(institute, "Lab " + rand())).id();
        licence.assign(as(schoolAdmin), room);
        admin.patchRoom(as(schoolAdmin), room, new RoomPatchRequest(null, "ARCHIVED"));
        assertThat(roomLicensedAt(room)).isNull();
        assertThat(events(institute, "RELEASED", "ROOM_ARCHIVED")).isEqualTo(1);
        assertThat(code(() -> licence.assign(as(schoolAdmin), room))).isEqualTo("BAD_REQUEST");
    }

    @Test
    void anAdminOfAnotherSchoolReachesNothingByItsIds() {
        grant(institute, "PAID", 2, -1, 30, 0);
        Partner partner = partner();
        PartnerLinkRedeemResponse linked = link(partner, institute);
        PairStartResponse pair = pairStart(3);
        DeviceClaimResponse pending = installerClaim(partner, institute, pair, null);
        PartnerInviteResponse invite = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 10));
        Paired approved = adminPaired(3);

        String elsewhere = "it-" + rand();
        CustomUserDetails stranger = as(user(elsewhere, "ADMIN"));
        assertThat(code(() -> licence.adminLicence(stranger, institute))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> licence.assign(stranger, approved.roomId()))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> licence.release(stranger, approved.roomId()))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.approve(stranger, pending.deviceId()))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.reject(stranger, pending.deviceId()))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.cancelInvite(stranger, invite.id()))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.revokeLink(stranger, linked.linkId()))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.links(stranger, institute))).isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.createInvite(stranger, new PartnerInviteRequest(institute, 10))))
                .isEqualTo("FORBIDDEN");
        // A teacher of the school is not its admin either.
        assertThat(code(() -> partnerAdmin.approve(as(user(institute, "TEACHER")), pending.deviceId())))
                .isEqualTo("FORBIDDEN");

        assertThat(sql.queryForObject("SELECT approval_state FROM panel_device WHERE id = ?", String.class,
                pending.deviceId())).isEqualTo("PENDING");
        assertThat(roomLicensedAt(approved.roomId())).isNotNull();
    }

    // ---------------------------------------------------------- installers ---

    @Test
    void anInstallerLinksWithACodeAndItsPanelWaitsForTheSchool() {
        grant(institute, "PAID", 1, -1, 30, 0);
        enforce(institute, "LIVE");
        Partner partner = partner();
        assertThat(installers.me(as(partner.installer())).partner().id()).isEqualTo(partner.id());

        PartnerInviteResponse invite = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 30));
        assertThat(sql.queryForObject("SELECT code_hash FROM panel_partner_invite WHERE id = ?", String.class,
                invite.id())).isEqualTo(PanelSecrets.sha256Hex(invite.code())).isNotEqualTo(invite.code());
        PartnerLinkRedeemResponse linked = installers.redeem(as(partner.installer()),
                new PartnerLinkRedeemRequest(invite.code().substring(0, 4) + "-" + invite.code().substring(4)));
        assertThat(linked.instituteId()).isEqualTo(institute);
        assertThat(Instant.parse(linked.installUntil())).isAfter(Instant.now().plus(29, ChronoUnit.DAYS));
        assertThat(code(() -> installers.redeem(as(partner.installer()), new PartnerLinkRedeemRequest(invite.code()))))
                .isEqualTo("INVITE_INVALID");
        assertThat(installers.customers(as(partner.installer())))
                .extracting(PartnerCustomerRow::instituteId).containsExactly(institute);

        PairStartResponse pair = pairStart(3);
        DeviceClaimResponse claimed = installerClaim(partner, institute, pair, null);
        assertThat(sql.queryForMap("SELECT approval_state, installed_by_partner_id FROM panel_device WHERE id = ?",
                claimed.deviceId())).containsEntry("approval_state", "PENDING")
                .containsEntry("installed_by_partner_id", partner.id());
        assertThat(sql.queryForObject("SELECT partner_id FROM classroom_room WHERE id = ?", String.class,
                claimed.room().id())).isEqualTo(partner.id());
        PairPollResponse polled = pairing.poll(new PairPollRequest(pair.pairSecret()));
        assertThat(polled.installedBy()).startsWith("Installer Org ");
        pairing.confirm(new PairConfirmRequest(polled.deviceId(), polled.deviceSecret(), true));
        Paired device = new Paired(polled.deviceId(), polled.deviceSecret(), claimed.room().id());
        assertThat(roomLicensedAt(device.roomId())).isNull();
        assertThat(signedOutSync(device).device().approvalState()).isEqualTo("PENDING");
        assertThat(code(() -> challenge(device))).isEqualTo("AWAITING_APPROVAL");

        assertThat(partnerAdmin.links(as(schoolAdmin), institute)).singleElement().satisfies(row -> {
            assertThat(row.linkedVia()).isEqualTo("SCHOOL_CODE");
            assertThat(row.installs()).isEqualTo(1);
        });
        assertThat(installers.installs(as(partner.installer()), institute)).singleElement()
                .satisfies(row -> assertThat(row.approvalState()).isEqualTo("PENDING"));

        DeviceRowResponse approvedRow = partnerAdmin.approve(as(schoolAdmin), device.id());
        assertThat(approvedRow.approvalState()).isEqualTo("APPROVED");
        assertThat(approvedRow.licenceState()).isEqualTo("LICENSED");
        assertThat(approvedRow.installedBy()).startsWith("Installer Org ");
        assertThat(events(institute, "ASSIGNED", "AUTO_APPROVE")).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT partner_id FROM panel_licence_event WHERE institute_id = ? "
                + "AND reason = 'AUTO_APPROVE'", String.class, institute)).isEqualTo(partner.id());
        assertThat(partnerAdmin.approve(as(schoolAdmin), device.id()).approvalState()).isEqualTo("APPROVED");
        assertThat(code(() -> signIn(device, user(institute, "TEACHER")))).isEqualTo("OK");
        assertThat(installers.installs(as(partner.installer()), institute)).singleElement()
                .satisfies(row -> assertThat(row.approvalState()).isEqualTo("APPROVED"));

        // Rejecting is for waiting panels only; an approved one is removed with revoke. A second
        // installer setting up the emptied room later never takes the attribution, and the room keeps its seat.
        assertThat(code(() -> partnerAdmin.reject(as(schoolAdmin), device.id()))).isEqualTo("BAD_REQUEST");
        admin.revokeDevice(as(schoolAdmin), device.id());
        Partner second = partner();
        link(second, institute);
        installerClaim(second, institute, pairStart(3), device.roomId());
        assertThat(roomLicensedAt(device.roomId())).isNotNull();
        assertThat(sql.queryForObject("SELECT partner_id FROM classroom_room WHERE id = ?", String.class,
                device.roomId())).isEqualTo(partner.id());
    }

    @Test
    void anInstallerCannotReplaceOrReachSchoolsThatDidNotLinkIt() {
        Partner partner = partner();
        String unlinked = "it-" + rand();
        assertThat(code(() -> installerClaim(partner, unlinked, pairStart(3), null))).isEqualTo("NOT_INSTALLER");
        assertThat(code(() -> installers.rooms(as(partner.installer()), unlinked))).isEqualTo("NOT_INSTALLER");
        assertThat(code(() -> installers.installs(as(partner.installer()), unlinked))).isEqualTo("NOT_INSTALLER");
        assertThat(code(() -> installers.me(as(user(institute, "TEACHER"))))).isEqualTo("NOT_INSTALLER");
        assertThat(code(() -> installers.me(as(schoolAdmin)))).isEqualTo("NOT_INSTALLER");

        PartnerLinkRedeemResponse linked = link(partner, institute);
        Paired occupant = adminPaired(3);
        assertThat(installers.rooms(as(partner.installer()), institute))
                .filteredOn(row -> row.id().equals(occupant.roomId())).singleElement()
                .satisfies(row -> assertThat(row.hasPanel()).isTrue());
        PairStartResponse pair = pairStart(3);
        assertThatOccupied(() -> installerClaim(partner, institute, pair, occupant.roomId()));
        assertThat(sql.queryForObject("SELECT status FROM panel_device WHERE id = ?", String.class, occupant.id()))
                .isEqualTo("ACTIVE");

        // The install window closes: no more installs, but the health view stays.
        installerClaim(partner, institute, pairStart(3), null);
        sql.update("UPDATE panel_partner_link SET install_until = now() - interval '1 minute' WHERE id = ?",
                linked.linkId());
        assertThat(code(() -> installerClaim(partner, institute, pairStart(3), null))).isEqualTo("NOT_INSTALLER");
        assertThat(code(() -> installers.rooms(as(partner.installer()), institute))).isEqualTo("NOT_INSTALLER");
        assertThat(installers.installs(as(partner.installer()), institute)).hasSize(1);

        // Revoked by the school: nothing at all. A suspended organisation has no installers.
        partnerAdmin.revokeLink(as(schoolAdmin), linked.linkId());
        assertThat(code(() -> installers.installs(as(partner.installer()), institute))).isEqualTo("NOT_INSTALLER");
        assertThat(installers.customers(as(partner.installer()))).isEmpty();
        staff.patch(partner.id(), new PartnerPatchRequest("SUSPENDED"));
        assertThat(code(() -> installers.me(as(partner.installer())))).isEqualTo("NOT_INSTALLER");
    }

    private void assertThatOccupied(Runnable claim) {
        try {
            claim.run();
            throw new AssertionError("claimed an occupied room");
        } catch (PanelApiException e) {
            assertThat(e.getCode()).isEqualTo("ROOM_OCCUPIED");
            assertThat(e.getExtras()).doesNotContainKey("current_device");
        }
    }

    @Test
    void inviteCodesAreSingleUseExpireAndCanBeCancelled() {
        Partner partner = partner();
        CustomUserDetails installer = as(partner.installer());

        PartnerInviteResponse expired = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 5));
        sql.update("UPDATE panel_partner_invite SET expires_at = now() - interval '1 second' WHERE id = ?", expired.id());
        assertThat(code(() -> installers.redeem(installer, new PartnerLinkRedeemRequest(expired.code()))))
                .isEqualTo("INVITE_INVALID");

        PartnerInviteResponse cancelled = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 5));
        assertThat(partnerAdmin.cancelInvite(as(schoolAdmin), cancelled.id()).status()).isEqualTo("CANCELLED");
        assertThat(partnerAdmin.cancelInvite(as(schoolAdmin), cancelled.id()).status()).isEqualTo("CANCELLED");
        assertThat(code(() -> installers.redeem(installer, new PartnerLinkRedeemRequest(cancelled.code()))))
                .isEqualTo("INVITE_INVALID");

        assertThat(code(() -> partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 91))))
                .isEqualTo("BAD_REQUEST");

        // Two codes in a row extend the one link instead of adding a second.
        PartnerLinkRedeemResponse first = link(partner, institute);
        PartnerLinkRedeemResponse again = link(partner, institute);
        assertThat(again.linkId()).isEqualTo(first.linkId());
        PartnerInviteResponse used = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 5));
        installers.redeem(installer, new PartnerLinkRedeemRequest(used.code()));
        assertThat(code(() -> partnerAdmin.cancelInvite(as(schoolAdmin), used.id()))).isEqualTo("INVITE_INVALID");

        // Purge: unredeemed codes past expiry are marked, old ones deleted.
        sql.update("UPDATE panel_partner_invite SET expires_at = now() - interval '31 days' WHERE id = ?", used.id());
        invitePurge.purge(500);
        assertThat(sql.queryForObject("SELECT state FROM panel_partner_invite WHERE id = ?", String.class,
                expired.id())).isEqualTo("EXPIRED");
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_partner_invite WHERE id = ?", Integer.class,
                used.id())).isZero();
    }

    @Test
    void aSchoolCanRejectAPendingPanelAndApprovalBeforeConfirmStillGetsASeat() {
        grant(institute, "PAID", 1, -1, 30, 0);
        Partner partner = partner();
        link(partner, institute);

        DeviceClaimResponse rejected = installerClaim(partner, institute, pairStart(3), null);
        assertThat(partnerAdmin.reject(as(schoolAdmin), rejected.deviceId()).status()).isEqualTo("REVOKED");
        assertThat(sql.queryForMap("SELECT status, approval_state FROM panel_device WHERE id = ?", rejected.deviceId()))
                .containsEntry("status", "REVOKED").containsEntry("approval_state", "REJECTED");
        assertThat(code(() -> partnerAdmin.approve(as(schoolAdmin), rejected.deviceId()))).isEqualTo("DEVICE_NOT_ACTIVE");

        PairStartResponse pair = pairStart(3);
        DeviceClaimResponse early = installerClaim(partner, institute, pair, null);
        partnerAdmin.approve(as(schoolAdmin), early.deviceId());
        assertThat(roomLicensedAt(early.room().id())).isNull();
        Paired device = pickUpAndConfirm(pair, early.room().id());
        assertThat(roomLicensedAt(device.roomId())).isNotNull();
        assertThat(events(institute, "ASSIGNED", "AUTO_ACTIVATE")).isEqualTo(1);

        Paired direct = adminPaired(3);
        assertThat(code(() -> partnerAdmin.reject(as(schoolAdmin), direct.id()))).isEqualTo("BAD_REQUEST");
    }

    @Test
    void revokingALinkCancelsTheSchoolsOpenCodesSoTheOrganisationCannotLinkItselfAgain() {
        Partner partner = partner();
        CustomUserDetails installer = as(partner.installer());
        PartnerLinkRedeemResponse linked = link(partner, institute);
        PartnerInviteResponse second = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 30));
        PartnerInviteResponse forSomeoneElse = partnerAdmin.createInvite(as(schoolAdmin),
                new PartnerInviteRequest(institute, 30));
        assertThat(partnerAdmin.openInvites(as(schoolAdmin), institute))
                .extracting(PartnerOpenInviteRow::id).containsExactlyInAnyOrder(second.id(), forSomeoneElse.id());

        partnerAdmin.revokeLink(as(schoolAdmin), linked.linkId());
        assertThat(partnerAdmin.openInvites(as(schoolAdmin), institute)).isEmpty();
        assertThat(code(() -> installers.redeem(installer, new PartnerLinkRedeemRequest(second.code()))))
                .isEqualTo("INVITE_INVALID");
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_partner_link WHERE partner_id = ? "
                + "AND institute_id = ? AND status = 'ACTIVE'", Integer.class, partner.id(), institute)).isZero();

        // A code older than the revoke that is still open (written before this rule) is refused too,
        // and is no longer usable afterwards.
        sql.update("UPDATE panel_partner_invite SET state = 'PENDING' WHERE id = ?", second.id());
        sql.update("UPDATE panel_partner_invite SET created_at = created_at - interval '1 hour' WHERE id = ?",
                second.id());
        assertThat(code(() -> installers.redeem(installer, new PartnerLinkRedeemRequest(second.code()))))
                .isEqualTo("INVITE_INVALID");
        assertThat(sql.queryForObject("SELECT state FROM panel_partner_invite WHERE id = ?", String.class,
                second.id())).isEqualTo("CANCELLED");
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_partner_link WHERE partner_id = ? "
                + "AND institute_id = ? AND status = 'ACTIVE'", Integer.class, partner.id(), institute)).isZero();

        // A code the school creates after the revoke links the organisation again on purpose.
        PartnerInviteResponse fresh = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 30));
        assertThat(installers.redeem(installer, new PartnerLinkRedeemRequest(fresh.code())).instituteId())
                .isEqualTo(institute);
    }

    @Test
    void onlyTheSchoolsAdminListsItsOpenCodesAndNeverSeesTheCode() {
        PartnerInviteResponse open = partnerAdmin.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 12));
        assertThat(partnerAdmin.openInvites(as(schoolAdmin), institute)).singleElement().satisfies(row -> {
            assertThat(row.id()).isEqualTo(open.id());
            assertThat(row.installDays()).isEqualTo(12);
            assertThat(row.createdBy()).isEqualTo(schoolAdmin);
            assertThat(row.toString()).doesNotContain(open.code());
        });
        assertThat(code(() -> partnerAdmin.openInvites(as(user("it-" + rand(), "ADMIN")), institute)))
                .isEqualTo("FORBIDDEN");
        assertThat(code(() -> partnerAdmin.openInvites(as(user(institute, "TEACHER")), institute)))
                .isEqualTo("FORBIDDEN");
        sql.update("UPDATE panel_partner_invite SET expires_at = now() - interval '1 second' WHERE id = ?", open.id());
        assertThat(partnerAdmin.openInvites(as(schoolAdmin), institute)).isEmpty();
    }

    /** Approve and reject stay available with installers switched off, for panels already waiting. */
    @Test
    void waitingPanelsCanStillBeApprovedOrRejectedWithInstallersSwitchedOff() {
        Partner partner = partner();
        link(partner, institute);
        PairStartResponse pair = pairStart(3);
        DeviceClaimResponse claimed = installerClaim(partner, institute, pair, null);
        Paired waiting = pickUpAndConfirm(pair, claimed.room().id());
        DeviceClaimResponse toReject = installerClaim(partner, institute, pairStart(3), null);
        assertThat(code(() -> challenge(waiting))).isEqualTo("AWAITING_APPROVAL");

        PanelPartnerAdminService switchedOff = new PanelPartnerAdminService(partnerRepository, panelRepository,
                PanelPhase2Properties.allOff(), rateLimiter, panelTx, accessGuard, panelDevices, licence, 7, 30);
        assertThat(code(() -> switchedOff.createInvite(as(schoolAdmin), new PartnerInviteRequest(institute, 5))))
                .isEqualTo("FEATURE_OFF");
        assertThat(code(() -> switchedOff.approve(as(user("it-" + rand(), "ADMIN")), waiting.id())))
                .isEqualTo("FORBIDDEN");

        assertThat(switchedOff.approve(as(schoolAdmin), waiting.id()).approvalState()).isEqualTo("APPROVED");
        assertThat(code(() -> challenge(waiting))).isEqualTo("OK");

        assertThat(switchedOff.reject(as(schoolAdmin), toReject.deviceId()).status()).isEqualTo("REVOKED");
        assertThat(sql.queryForMap("SELECT status, approval_state FROM panel_device WHERE id = ?",
                toReject.deviceId())).containsEntry("status", "REVOKED").containsEntry("approval_state", "REJECTED");
    }

    @Test
    void staffLinkDirectlyAndFixAttribution() {
        Partner partner = partner();
        assertThat(code(() -> staff.create(new PartnerCreateRequest("Again", partner.institute()), "staff")))
                .isEqualTo("ALREADY_EXISTS");
        String until = Instant.now().plus(10, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS).toString();
        PartnerLinkResponse link = staff.link(partner.id(), new PartnerLinkCreateRequest(institute, until), "staff");
        assertThat(link.linkedVia()).isEqualTo("SUPER_ADMIN");
        assertThat(Instant.parse(link.installUntil())).isEqualTo(Instant.parse(until));
        DeviceClaimResponse claimed = installerClaim(partner, institute, pairStart(3), null);

        staff.setRoomPartner(claimed.room().id(), new RoomPartnerPatchRequest(null));
        assertThat(sql.queryForObject("SELECT partner_id FROM classroom_room WHERE id = ?", String.class,
                claimed.room().id())).isNull();
        assertThat(code(() -> staff.setRoomPartner(claimed.room().id(), new RoomPartnerPatchRequest("nope"))))
                .isEqualTo("NOT_FOUND");
        assertThat(staff.revokeLink(link.id(), "staff").status()).isEqualTo("REVOKED");
        assertThat(code(() -> installers.rooms(as(partner.installer()), institute))).isEqualTo("NOT_INSTALLER");
    }

    // ---------------------------------------------------------------- counts ---

    @Test
    void monthlyCountsComeFromSeatHistoryAndCountedSessions() {
        Partner partner = partner();
        link(partner, institute);
        licence.createGrant(institute, new LicenceGrantCreateRequest("PAID", 3,
                Instant.now().minus(40, ChronoUnit.DAYS).toString(), Instant.now().plus(40, ChronoUnit.DAYS).toString(),
                0, partner.id(), null, null), "staff");
        Paired used = adminPaired(3);
        adminPaired(3);
        PairStartResponse pair = pairStart(3);
        DeviceClaimResponse viaInstaller = installerClaim(partner, institute, pair, null);
        Paired installed = pickUpAndConfirm(pair, viaInstaller.room().id());
        partnerAdmin.approve(as(schoolAdmin), installed.id());
        signIn(used, user(institute, "TEACHER"));
        signIn(installed, user(institute, "TEACHER"));

        String zone = "Asia/Kolkata";
        LicenceUsageResponse counts = usage.usage(YearMonth.now(ZoneId.of(zone)).toString(), zone);
        assertThat(counts.rows()).filteredOn(row -> row.instituteId().equals(institute)).singleElement()
                .satisfies(row -> {
                    assertThat(row.partnerId()).isEqualTo(partner.id());
                    assertThat(row.seatsGrantedPeak()).isEqualTo(3);
                    assertThat(row.licensedRoomsPeak()).isEqualTo(3);
                    assertThat(row.activeLicensedRooms()).isEqualTo(2);
                    assertThat(row.roomsByPartner()).singleElement().satisfies(byPartner -> {
                        assertThat(byPartner.partnerId()).isEqualTo(partner.id());
                        assertThat(byPartner.activeLicensedRooms()).isEqualTo(1);
                    });
                    assertThat(row.enforcement()).isEqualTo("OFF");
                    assertThat(row.state()).isEqualTo("UNMANAGED");
                });
        assertThat(code(() -> usage.usage("2026-13", zone))).isEqualTo("BAD_REQUEST");
    }
}
