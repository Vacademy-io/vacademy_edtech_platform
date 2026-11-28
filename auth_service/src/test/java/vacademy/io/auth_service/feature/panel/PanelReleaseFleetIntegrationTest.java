package vacademy.io.auth_service.feature.panel;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.auth_service.core.config.UserDetailsServiceImpl;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ChallengeRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetAlert;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.FleetResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseCreateRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleasePatchRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ReleaseResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncResponse;
import vacademy.io.auth_service.feature.panel.phase2.fleet.PanelFleetRepository;
import vacademy.io.auth_service.feature.panel.phase2.fleet.PanelFleetService;
import vacademy.io.auth_service.feature.panel.phase2.fleet.PanelFleetSettings;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseAdminService;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseService;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelChallengeService;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * App releases and fleet alerts against a real Postgres, with both switches on. Same local-only guard
 * and wiring as PanelDatabaseIntegrationTest; panels and sessions are seeded with SQL.
 */
@EnabledIfEnvironmentVariable(named = "PANEL_TEST_JDBC_URL", matches = ".+")
@SpringBootTest(classes = { PanelDatabaseIntegrationTest.Config.class, PanelReleaseFleetIntegrationTest.Extra.class },
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = { "panel.enabled=true", "spring.jpa.open-in-view=false", "spring.jpa.hibernate.ddl-auto=none",
                "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=true",
                "spring.flyway.baseline-version=1", "spring.datasource.hikari.maximum-pool-size=10",
                "spring.main.banner-mode=off", "panel.releases.enabled=true", "panel.fleet.enabled=true",
                "panel.releases.allowed-hosts=" + PanelReleaseFleetIntegrationTest.HOST,
                "panel.releases.signing-cert-sha256=" + PanelReleaseFleetIntegrationTest.CERT })
class PanelReleaseFleetIntegrationTest {

    static final String HOST = "downloads.example.test";
    static final String CERT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Configuration
    @Import({ PanelReleaseAdminService.class, PanelFleetService.class, PanelFleetRepository.class,
            PanelFleetSettings.class })
    static class Extra {
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) throws Exception {
        PanelDatabaseIntegrationTest.database(registry);
    }

    @MockBean
    InstituteInternalService instituteInternalService;

    @Autowired
    JdbcTemplate sql;
    @Autowired
    PanelReleaseAdminService registry;
    @Autowired
    PanelReleaseService releases;
    @Autowired
    PanelFleetService fleet;
    @Autowired
    PanelSessionService sessions;
    @Autowired
    PanelChallengeService challenges;
    @Autowired
    UserDetailsServiceImpl userDetails;

    private String institute;

    @BeforeEach
    void setUp() {
        institute = "rf-" + rand();
        when(instituteInternalService.getInstituteByInstituteId(anyString())).thenAnswer(call -> {
            InstituteInfoDTO info = new InstituteInfoDTO();
            info.setInstituteName("Institute " + call.getArgument(0));
            info.setInstituteThemeCode("blue");
            info.setAdminPortalUrl("https://portal.school.example/x");
            return info;
        });
        clearReleases();
    }

    @AfterEach
    void clearReleases() {
        // Release rows are global; leave none behind for the other suites on this database.
        sql.update("DELETE FROM panel_app_release");
        releases.invalidate();
    }

    // ---------------------------------------------------------- fixtures ---

    private static String rand() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private record Panel(String id, String secret, String roomId, String channel) {
    }

    /** An ACTIVE, APPROVED panel. Intervals are Postgres interval text, or null for a null column. */
    private Panel panel(String inst, String channel, Integer version, String lastSeenAgo, String confirmedAgo) {
        String roomId = UUID.randomUUID().toString();
        sql.update("INSERT INTO classroom_room (id, institute_id, name, created_by) VALUES (?, ?, ?, 'it')", roomId,
                inst, "Room " + rand());
        String id = UUID.randomUUID().toString();
        String secret = "secret-" + rand();
        sql.update("""
                INSERT INTO panel_device (id, institute_id, room_id, secret_hash, status, claimed_by, claimed_at,
                                          confirmed_at, last_seen_at, app_channel, app_version_code, sdk_int,
                                          webview_major)
                VALUES (?, ?, ?, ?, 'ACTIVE', 'it', now() - CAST(? AS interval), now() - CAST(? AS interval),
                        now() - CAST(? AS interval), ?, ?, 28, 66)
                """, id, inst, roomId, PanelSecrets.sha256Hex(secret), confirmedAgo, confirmedAgo, lastSeenAgo,
                channel, version);
        return new Panel(id, secret, roomId, channel);
    }

    /** A session on the panel; counted when the panel picked it up (panel_seen_at set). */
    private String session(Panel panel, String inst, String status, String createdAgo, boolean counted,
            String token) {
        String id = UUID.randomUUID().toString();
        sql.update("""
                INSERT INTO panel_session (id, device_id, institute_id, room_id, user_id, started_via, refresh_hash,
                                           status, expires_at, created_at, panel_seen_at)
                VALUES (?, ?, ?, ?, ?, 'QR', ?, ?, now() + interval '2 hours', now() - CAST(? AS interval),
                        CASE WHEN ? THEN now() - CAST(? AS interval) END)
                """, id, panel.id(), inst, panel.roomId(), "u-" + rand(),
                token == null ? null : PanelSecrets.sha256Hex(token), status, createdAgo, counted, createdAgo);
        return id;
    }

    private String admin(String inst) {
        String userId = "u-" + rand();
        sql.update("INSERT INTO users (id, username, email, password_hash, full_name, is_root_user) "
                + "VALUES (?, ?, ?, 'secret-pass', ?, false)", userId, userId, userId + "@local.test", "Name " + userId);
        sql.update("INSERT INTO roles (id, role_name) SELECT ?, 'ADMIN' "
                + "WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'ADMIN')", "rf-" + rand());
        String roleId = sql.queryForObject("SELECT id FROM roles WHERE role_name = 'ADMIN' LIMIT 1", String.class);
        sql.update("INSERT INTO user_role (id, user_id, role_id, institute_id, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), userId, roleId, inst);
        return userId;
    }

    private CustomUserDetails as(String userId) {
        return (CustomUserDetails) userDetails.loadUserByUsername("null@" + userId);
    }

    private ReleaseResponse draftDirect(int code, int rollout, boolean required) {
        return registry.create("staff-1", new ReleaseCreateRequest("DIRECT", code, "0." + code + ".0",
                "https://" + HOST + "/classroom-releases/direct/" + code + "-abcdef12.apk", "AB".repeat(32),
                23_456_789L, 24, rollout, required, null, "io.vacademy.classroom.direct", CERT.toUpperCase()));
    }

    /** Goes LIVE; a required build is confirmed with force_floor, as staff would after the warning. */
    private ReleaseResponse liveDirect(int code, int rollout, boolean required) {
        ReleaseResponse draft = draftDirect(code, rollout, required);
        return registry.patch(draft.id(), new ReleasePatchRequest("LIVE", null, null, required ? Boolean.TRUE : null));
    }

    private SyncResponse sync(Panel panel, String sessionId, String token, int version) {
        return sessions.sync(new SyncRequest(panel.id(), panel.secret(), sessionId, token, version, 66, false, null,
                false, null, panel.channel()), "10.0.0.1");
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    // ------------------------------------------------------------ releases ---

    @Test
    void theRegistryStoresDraftsStepsThemLiveAndRefusesDuplicates() {
        ReleaseResponse draft = registry.create("staff-1", new ReleaseCreateRequest("DIRECT", 4, "0.4.0",
                "https://" + HOST + "/classroom-releases/direct/4-abcdef12.apk", "AB".repeat(32), 23_456_789L, 26, 5,
                false, "first direct build", "io.vacademy.classroom.direct", CERT));
        assertThat(draft.status()).isEqualTo("DRAFT");
        assertThat(draft.sha256()).isEqualTo("ab".repeat(32));
        assertThat(draft.minSdk()).isEqualTo(26);
        assertThat(draft.createdBy()).isEqualTo("staff-1");
        assertThat(draft.publishedAt()).isNull();
        assertThat(draft.signingCertSha256()).isEqualTo(CERT);
        assertThat(registry.list()).extracting(ReleaseResponse::id).contains(draft.id());
        assertThat(releases.liveReleases()).isEmpty();

        ReleaseResponse live = registry.patch(draft.id(), new ReleasePatchRequest("LIVE", 25, null));
        assertThat(live.status()).isEqualTo("LIVE");
        assertThat(live.rolloutPercent()).isEqualTo(25);
        assertThat(live.publishedAt()).isNotNull();
        assertThat(releases.liveReleases()).extracting(r -> r.versionCode()).containsExactly(4);
        ReleaseResponse stepped = registry.patch(draft.id(), new ReleasePatchRequest(null, 100, null));
        assertThat(stepped.publishedAt()).isEqualTo(live.publishedAt());

        assertThat(code(() -> registry.create("staff-1", new ReleaseCreateRequest("DIRECT", 4, "0.4.1",
                "https://" + HOST + "/x.apk", "AB".repeat(32), 1L, 24, 0, false, null,
                "io.vacademy.classroom.direct", CERT)))).isEqualTo("RELEASE_EXISTS");
        assertThat(registry.create("staff-1", new ReleaseCreateRequest("PLAY", 4, "0.4.0", null, null, null, null,
                null, null, null)).channel()).isEqualTo("PLAY");

        registry.patch(draft.id(), new ReleasePatchRequest("PULLED", null, null));
        assertThat(releases.liveReleases()).isEmpty();
        assertThat(code(() -> registry.patch(draft.id(), new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("BAD_STATUS");
    }

    @Test
    void aSignedOutSyncCarriesTheOfferAndASignedInSyncNever() {
        liveDirect(4, 100, false);
        Panel panel = panel(institute, "DIRECT", 3, "1 minute", "30 days");

        SyncResponse signedOut = sync(panel, null, null, 3);
        assertThat(signedOut.update()).isNotNull();
        assertThat(signedOut.update().versionCode()).isEqualTo(4);
        assertThat(signedOut.update().apkUrl()).startsWith("https://" + HOST + "/");
        assertThat(signedOut.update().required()).isFalse();
        assertThat(signedOut.minAppVersionCode()).isEqualTo(1);

        String token = "token-" + rand();
        String sessionId = session(panel, institute, "ACTIVE", "5 minutes", true, token);
        SyncResponse signedIn = sync(panel, sessionId, token, 3);
        assertThat(signedIn.session().status()).isEqualTo("ACTIVE");
        assertThat(signedIn.update()).isNull();
    }

    @Test
    void aPlayPanelIsNeverOfferedADirectBuild() {
        liveDirect(4, 100, false);
        Panel panel = panel(institute, "PLAY", 3, "1 minute", "30 days");
        assertThat(sync(panel, null, null, 3).update()).isNull();
    }

    @Test
    void aRequiredBuildRaisesTheFloorAndGatesSignInOnly() {
        Panel v3 = panel(institute, "DIRECT", 3, "1 minute", "30 days");
        Panel v2 = panel(institute, null, 2, "1 minute", "30 days");
        Panel v4 = panel(institute, "DIRECT", 4, "1 minute", "30 days");
        Panel inClass = panel(institute, "DIRECT", 3, "1 minute", "30 days");
        String token = "token-" + rand();
        String running = session(inClass, institute, "ACTIVE", "5 minutes", true, token);
        assertThat(code(() -> challenges.create(new ChallengeRequest(v4.id(), v4.secret(), "SIGN_IN", null))))
                .isEqualTo("OK");

        // The v2 panel has no updater, so making v4 required is refused until staff confirm it.
        ReleaseResponse draft = draftDirect(4, 0, true);
        assertThat(code(() -> registry.patch(draft.id(), new ReleasePatchRequest("LIVE", null, null))))
                .isEqualTo("FLOOR_WITHOUT_UPDATE");
        registry.patch(draft.id(), new ReleasePatchRequest("LIVE", null, null, true));

        assertThat(code(() -> challenges.create(new ChallengeRequest(v3.id(), v3.secret(), "SIGN_IN", null))))
                .isEqualTo("UPDATE_REQUIRED");
        assertThat(code(() -> challenges.create(new ChallengeRequest(v2.id(), v2.secret(), "SIGN_IN", null))))
                .isEqualTo("PANEL_DISABLED");
        // A class already running on the old build is not cut.
        SyncResponse during = sync(inClass, running, token, 3);
        assertThat(during.session().status()).isEqualTo("ACTIVE");
        assertThat(during.minAppVersionCode()).isEqualTo(4);
        assertThat(during.update()).isNull();

        Panel v3b = panel(institute, "DIRECT", 3, "1 minute", "30 days");
        SyncResponse signedOut = sync(v3b, null, null, 3);
        assertThat(signedOut.update().versionCode()).isEqualTo(4);
        assertThat(signedOut.update().required()).isTrue();
    }

    // --------------------------------------------------------------- fleet ---

    @Test
    void fleetAlertsAreTheInstitutesOwnAndOnlyItsAdminsSeeThem() {
        String other = "rf-" + rand();
        Panel offline = panel(institute, "DIRECT", 3, "3 days", "60 days");
        Panel unused = panel(institute, "DIRECT", 3, "1 minute", "60 days");
        session(unused, institute, "ENDED", "40 days", true, null);
        session(unused, institute, "ENDED", "1 hour", false, null);
        Panel used = panel(institute, "DIRECT", 3, "1 minute", "60 days");
        session(used, institute, "ENDED", "1 hour", true, null);
        Panel elsewhere = panel(other, "DIRECT", 3, "5 days", "60 days");

        String adminId = admin(institute);
        FleetResponse mine = fleet.forAdmin(as(adminId), institute);
        assertThat(mine.alerts()).extracting(FleetAlert::deviceId)
                .contains(offline.id(), unused.id())
                .doesNotContain(used.id(), elsewhere.id());
        FleetAlert off = mine.alerts().stream().filter(a -> a.deviceId().equals(offline.id())).findFirst()
                .orElseThrow();
        assertThat(off.kind()).isEqualTo("OFFLINE");
        assertThat(off.severity()).isEqualTo("warn");
        assertThat(off.room().id()).isEqualTo(offline.roomId());
        assertThat(mine.alerts().stream().filter(a -> a.deviceId().equals(unused.id())).map(FleetAlert::kind))
                .containsExactly("UNUSED");
        assertThat(mine.counts()).containsEntry("OFFLINE", 1).containsEntry("UNUSED", 1);

        assertThat(fleet.forService(institute).alerts()).isEqualTo(mine.alerts());

        assertThatThrownBy(() -> fleet.forAdmin(as(adminId), other)).isInstanceOf(VacademyException.class);
        assertThat(fleet.forService(other).alerts()).extracting(FleetAlert::deviceId)
                .containsExactly(elsewhere.id());
        assertThat(fleet.forService("rf-empty-" + rand()).alerts()).isEmpty();
    }

    @Test
    void fleetReportsPanelsBelowTheFloor() {
        Panel old = panel(institute, "DIRECT", 3, "1 minute", "2 days");
        liveDirect(4, 100, true);
        List<FleetAlert> alerts = fleet.forService(institute).alerts();
        assertThat(alerts).extracting(FleetAlert::kind).containsExactly("UPDATE_REQUIRED");
        assertThat(alerts.get(0).deviceId()).isEqualTo(old.id());
        assertThat(alerts.get(0).incidentKey()).isEqualTo("4");
    }
}
