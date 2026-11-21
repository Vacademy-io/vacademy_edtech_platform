package vacademy.io.auth_service.feature.panel;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.exception.FlywayValidateException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
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
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
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
import vacademy.io.auth_service.feature.panel.phase2.DefaultPanelApprovalGate;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelActivityRecorder;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceService;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseRepository;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseService;
import vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseSettings;
import vacademy.io.auth_service.feature.panel.phase2.PanelCompat;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
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
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
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
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * The real services against a real Postgres: migrations, every conditional UPDATE, the partial unique
 * indexes and races with real threads. Windows are tested by moving timestamps in SQL, which is what
 * the database clock would do. Skipped unless PANEL_TEST_JDBC_URL is set, so a build with no database
 * is unaffected. It writes to that database, so it refuses anything but a local one.
 *
 *   PANEL_TEST_JDBC_URL=jdbc:postgresql://127.0.0.1:55432/panel_it PANEL_TEST_DB_USER=postgres
 */
@EnabledIfEnvironmentVariable(named = "PANEL_TEST_JDBC_URL", matches = ".+")
@SpringBootTest(classes = PanelDatabaseIntegrationTest.Config.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = { "panel.enabled=true", "spring.jpa.open-in-view=false", "spring.jpa.hibernate.ddl-auto=none",
                "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=true",
                "spring.flyway.baseline-version=1", "spring.datasource.hikari.maximum-pool-size=15",
                "spring.main.banner-mode=off" })
class PanelDatabaseIntegrationTest {

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
            UserDetailsServiceImpl.class,
            // Phase 2 seams. A chunk that replaces a placeholder swaps its class here.
            PanelPhase2Properties.class, PanelCompat.class, PanelActivityRecorder.class, PanelUsageRepository.class,
            PanelLicenceService.class, PanelLicenceRepository.class, DefaultPanelApprovalGate.class, PanelReleaseService.class,
            PanelReleaseRepository.class, PanelReleaseSettings.class })
    static class Config {
        @Bean
        AuthenticationManager authenticationManager(UserDetailsServiceImpl userDetails) {
            DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
            provider.setUserDetailsService(userDetails);
            provider.setPasswordEncoder(NoOpPasswordEncoder.getInstance());
            return new ProviderManager(provider);
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
        // V1 uses two trigger functions the historical database already had. They live outside public,
        // so Flyway still sees an empty schema and runs the whole history instead of baselining past V1.
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

    @Autowired
    JdbcTemplate sql;
    @Autowired
    DataSource dataSource;
    @Autowired
    PanelPairingService pairing;
    @Autowired
    PanelChallengeService challenges;
    @Autowired
    PanelSessionService sessions;
    @Autowired
    PanelAdminService admin;
    @Autowired
    PanelMaintenance maintenance;
    @Autowired
    PanelRepository repository;
    @Autowired
    UserDetailsServiceImpl userDetails;

    private String institute;

    @BeforeEach
    void freshInstitute() {
        institute = "it-" + rand();
        when(instituteInternalService.getInstituteByInstituteId(anyString())).thenAnswer(call -> {
            InstituteInfoDTO info = new InstituteInfoDTO();
            info.setInstituteName("Institute " + call.getArgument(0));
            info.setInstituteThemeCode("blue");
            info.setAdminPortalUrl("https://portal.school.example/x");
            return info;
        });
        sql.update("INSERT INTO roles (id, role_name) SELECT 'it-teacher', 'TEACHER' "
                + "WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = 'TEACHER')");
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

    private String user(String inst, String role, String status) {
        String id = "u-" + rand();
        sql.update("INSERT INTO users (id, username, email, password_hash, full_name, is_root_user) "
                + "VALUES (?, ?, ?, 'secret-pass', ?, false)", id, id, id + "@local.test", "Name " + id);
        grant(id, inst, role, status);
        return id;
    }

    private void grant(String userId, String inst, String role, String status) {
        sql.update("INSERT INTO user_role (id, user_id, role_id, institute_id, status) VALUES (?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(), userId, roleId(role), inst, status);
    }

    private CustomUserDetails as(String userId) {
        return (CustomUserDetails) userDetails.loadUserByUsername("null@" + userId);
    }

    private String teacher() {
        return user(institute, "TEACHER", "ACTIVE");
    }

    private PairStartResponse pairStart() {
        return pairing.start(new PairStartRequest("install-" + rand(),
                Map.of("manufacturer", "Lab", "model", "Panel 65", "sdk_int", 28, "webview_major", 66,
                        "app_version_code", 2)), ip());
    }

    private DeviceClaimRequest claimBody(PairStartResponse pair, String roomId, boolean replace) {
        return new DeviceClaimRequest(pair.code(), pair.matchCode(), institute, roomId,
                roomId == null ? "Room " + rand() : null, replace);
    }

    private record Paired(String id, String secret, String roomId) {
        SyncRequest sync(String sessionId, String token, Boolean presenting, NavState state) {
            return new SyncRequest(id, secret, sessionId, token, null, null, presenting, state);
        }
    }

    private Paired pairedDevice() {
        return pairedDevice(null, false);
    }

    private Paired pairedDevice(String roomId, boolean replace) {
        PairStartResponse pair = pairStart();
        DeviceClaimResponse claimed = pairing.claim(as(user(institute, "ADMIN", "ACTIVE")),
                claimBody(pair, roomId, replace));
        PairPollResponse polled = pairing.poll(new PairPollRequest(pair.pairSecret()));
        assertThat(polled.state()).isEqualTo("CLAIMED");
        pairing.confirm(new PairConfirmRequest(polled.deviceId(), polled.deviceSecret(), true));
        return new Paired(polled.deviceId(), polled.deviceSecret(), claimed.room().id());
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

    private ChallengePollResponse poll(Paired device, ChallengeResponse challenge) {
        return challenges.poll(new ChallengePollRequest(device.id(), device.secret(), challenge.challengeId()));
    }

    private record Signed(ChallengeResponse challenge, ChallengeApprovedResponse approved,
            ChallengePollResponse redeemed) {
    }

    private Signed signIn(Paired device, String userId) {
        ChallengeResponse challenge = challenge(device);
        challenges.describe(as(userId), new ChallengeDescribeRequest(tokenOf(challenge), null));
        ChallengeApprovedResponse approved = approve(userId, challenge);
        ChallengePollResponse redeemed = poll(device, challenge);
        assertThat(redeemed.state()).isEqualTo("REDEEMED");
        return new Signed(challenge, approved, redeemed);
    }

    private SessionRefreshRequest refreshBody(Paired device, Signed signed) {
        return new SessionRefreshRequest(device.id(), device.secret(), signed.redeemed().sessionToken());
    }

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        }
        return "OK";
    }

    private String sessionColumn(String sessionId, String column) {
        return sql.queryForObject("SELECT " + column + "::text FROM panel_session WHERE id = ?", String.class, sessionId);
    }

    private String challengeState(String id) {
        return sql.queryForObject("SELECT state FROM panel_login_challenge WHERE id = ?", String.class, id);
    }

    private void backdateSession(String sessionId, String column, String interval) {
        sql.update("UPDATE panel_session SET " + column + " = now() - interval '" + interval + "' WHERE id = ?", sessionId);
    }

    /** All at once from real threads. Each result is a value or the PanelApiException code. */
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

    private static <T> List<Callable<T>> times(int n, Supplier<T> call) {
        List<Callable<T>> calls = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            calls.add(call::get);
        }
        return calls;
    }

    // ---------------------------------------------------------- migration ---

    @Test
    void v26AppliedWithEveryIndexAndVarcharHashes() {
        assertThat(sql.queryForObject("SELECT success FROM flyway_schema_history WHERE version = '26'", Boolean.class)).isTrue();
        assertThat(sql.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version IS NOT NULL AND success", Integer.class))
                .isGreaterThanOrEqualTo(26);
        List<String> indexes = sql.queryForList("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND "
                + "tablename IN ('classroom_room','panel_pairing','panel_device','panel_session','panel_login_challenge')", String.class);
        assertThat(indexes).contains("uq_classroom_room_name", "uq_panel_pairing_code", "uq_panel_pairing_secret",
                "idx_panel_pairing_expires", "idx_panel_pairing_pending", "uq_panel_device_secret",
                "idx_panel_device_institute", "uq_panel_device_room", "uq_panel_session_refresh",
                "uq_panel_session_remote", "uq_panel_session_device_active", "uq_panel_session_user_active",
                "uq_panel_challenge_token", "uq_panel_challenge_code", "uq_panel_challenge_device_open",
                "idx_panel_challenge_expires");
        assertThat(sql.queryForList("SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' "
                + "AND table_name IN ('panel_pairing','panel_device','panel_session','panel_login_challenge') "
                + "AND column_name IN ('code_hash','secret_hash','refresh_hash','remote_token_hash','token_hash','user_code_hash')",
                String.class)).hasSize(7).containsOnly("character varying");
    }

    /**
     * T61, for whichever migration is newest (V26 in phase 1, V27 since phase 2). Keeping the file
     * validates. Removing it while it is the newest applied migration also validates, because Flyway
     * reads that as a "future" migration; but it fails as soon as any later migration exists, which
     * is why a rollback must keep the file.
     */
    @Test
    void rollbackMustKeepTheMigrationFile(@TempDir Path withAll, @TempDir Path withoutNewest,
            @TempDir Path withLaterOnly) throws Exception {
        Resource[] all = new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/*.sql");
        assertThat(all.length).isGreaterThanOrEqualTo(27);
        int newest = 0;
        for (Resource resource : all) {
            newest = Math.max(newest, version(resource.getFilename()));
        }
        assertThat(newest).isGreaterThanOrEqualTo(27);
        for (Resource resource : all) {
            byte[] content = resource.getContentAsByteArray();
            Files.write(withAll.resolve(resource.getFilename()), content);
            if (version(resource.getFilename()) != newest) {
                Files.write(withoutNewest.resolve(resource.getFilename()), content);
                Files.write(withLaterOnly.resolve(resource.getFilename()), content);
            }
        }
        Files.writeString(withLaterOnly.resolve("V" + (newest + 1) + "__later.sql"), "SELECT 1;");
        Flyway.configure().dataSource(dataSource).locations("filesystem:" + withAll).load().validate();
        Flyway.configure().dataSource(dataSource).locations("filesystem:" + withoutNewest).load().validate();
        int expected = newest;
        assertThatThrownBy(() -> Flyway.configure().dataSource(dataSource).locations("filesystem:" + withLaterOnly)
                .load().validate())
                .isInstanceOf(FlywayValidateException.class)
                .hasMessageContaining("applied migration not resolved locally: " + expected);
    }

    private static int version(String filename) {
        return Integer.parseInt(filename.substring(1, filename.indexOf("__")));
    }

    // ------------------------------------------------- phase 2 contract (V27) ---

    @Test
    void v27AppliedWithEveryPhase2TableColumnAndIndex() {
        assertThat(sql.queryForObject("SELECT success FROM flyway_schema_history WHERE version = '27'", Boolean.class)).isTrue();
        List<String> tables = sql.queryForList("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' "
                + "AND table_name LIKE 'panel_%'", String.class);
        assertThat(tables).contains("panel_activity", "panel_licence_setting", "panel_licence_grant",
                "panel_licence_template", "panel_licence_event", "panel_partner", "panel_partner_link",
                "panel_partner_invite", "panel_app_release");
        assertThat(columns("panel_session")).contains("active_until");
        assertThat(columns("classroom_room")).contains("licensed_at", "licensed_by", "partner_id");
        assertThat(columns("panel_device")).contains("approval_state", "installed_by_partner_id", "approved_by",
                "approved_at", "app_channel");
        List<String> indexes = sql.queryForList("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'", String.class);
        assertThat(indexes).contains("idx_panel_session_inst_created", "idx_panel_session_dev_created",
                "uq_panel_activity_seq", "idx_panel_activity_inst_started", "idx_plg_institute", "idx_ple_inst_at",
                "uq_panel_partner_inst", "uq_ppl_active", "uq_ppi_code", "uq_par_channel_code");
        assertThat(sql.queryForObject("SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' "
                + "AND table_name = 'panel_device' AND column_name = 'approval_state'", String.class)).contains("APPROVED");
        // Secrets stay varchar so JDBC parameters use the unique index.
        assertThat(sql.queryForObject("SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' "
                + "AND table_name = 'panel_partner_invite' AND column_name = 'code_hash'", String.class))
                .isEqualTo("character varying");
    }

    private List<String> columns(String table) {
        return sql.queryForList("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
                + "AND table_name = ?", String.class, table);
    }

    @Test
    void phase1DevicesAreApprovedAndListedWithThePhase2Columns() {
        Paired device = pairedDevice();
        assertThat(sql.queryForObject("SELECT approval_state FROM panel_device WHERE id = ?", String.class, device.id()))
                .isEqualTo("APPROVED");
        sessions.sync(new SyncRequest(device.id(), device.secret(), null, null, 3, 67, false, null, null, null, "DIRECT"),
                "5.5.5.5");
        SyncResponse synced = sessions.sync(device.sync(null, null, false, null), "ip");
        assertThat(synced.device().approvalState()).isEqualTo("APPROVED");
        // Every switch is off: no licence, no update, no ack.
        assertThat(synced.licence()).isNull();
        assertThat(synced.update()).isNull();
        assertThat(synced.activityAckedSeq()).isNull();
        DeviceRowResponse row = admin.listDevices(as(user(institute, "ADMIN", "ACTIVE")), institute).get(0);
        assertThat(row.approvalState()).isEqualTo("APPROVED");
        assertThat(row.appChannel()).isEqualTo("DIRECT");
        assertThat(row.installedBy()).isNull();
        assertThat(row.licenceState()).isNull();
        // An unknown channel is ignored, never stored.
        sql.update("UPDATE panel_device SET last_seen_at = NULL WHERE id = ?", device.id());
        sessions.sync(new SyncRequest(device.id(), device.secret(), null, null, 3, 67, false, null, null, null, "X"), "ip");
        assertThat(sql.queryForObject("SELECT app_channel FROM panel_device WHERE id = ?", String.class, device.id()))
                .isEqualTo("DIRECT");
    }

    @Test
    void aPendingDeviceCannotStartASessionAndAnOldAppReadsPanelDisabled() {
        Paired device = pairedDevice();
        String teacher = teacher();
        ChallengeResponse open = challenge(device);
        sql.update("UPDATE panel_device SET approval_state = 'PENDING' WHERE id = ?", device.id());
        // The approve re-checks: a QR that was up before the change cannot start a session.
        assertThat(code(() -> approve(teacher, open))).isEqualTo("PANEL_DISABLED");
        sql.update("UPDATE panel_device SET app_version_code = 2 WHERE id = ?", device.id());
        assertThat(code(() -> challenge(device))).isEqualTo("PANEL_DISABLED");
        sql.update("UPDATE panel_device SET app_version_code = 3 WHERE id = ?", device.id());
        assertThat(code(() -> challenge(device))).isEqualTo("AWAITING_APPROVAL");
        sql.update("UPDATE panel_device SET approval_state = 'APPROVED' WHERE id = ?", device.id());
        signIn(device, teacher);
    }

    @Test
    void endSessionWithActiveUntilTrimsTheIdleTailButNeverBeforeTheStart() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        String id = signed.approved().sessionId();
        backdateSession(id, "created_at", "2 hours");
        assertThat(repository.endSessionWithActiveUntil(id, "IDLE", null, 31 * 60)).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT ended_at - active_until BETWEEN interval '30 minutes 59 seconds' "
                + "AND interval '31 minutes 1 second' FROM panel_session WHERE id = ?", Boolean.class, id)).isTrue();
        Signed again = signIn(device, teacher());
        String second = again.approved().sessionId();
        assertThat(repository.endSessionWithActiveUntil(second, "IDLE", null, 31 * 60)).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT active_until = created_at FROM panel_session WHERE id = ?", Boolean.class,
                second)).isTrue();
        // With recording off (the default) the panel's IDLE end leaves active_until alone.
        Signed third = signIn(device, teacher());
        sessions.end(new SessionEndRequest(device.id(), device.secret(), third.redeemed().sessionToken(), "IDLE"));
        assertThat(sessionColumn(third.approved().sessionId(), "active_until")).isNull();
        assertThat(sessionColumn(third.approved().sessionId(), "end_reason")).isEqualTo("IDLE");
    }

    /** Token lookups must use their indexes with varchar parameters, as JDBC sends them. */
    @Test
    void tokenLookupsUseTheirIndexes() throws Exception {
        String stamp = rand();
        sql.update("INSERT INTO panel_pairing (id, code_hash, secret_hash, match_code, match_options, install_id, state, expires_at) "
                + "SELECT 'pi-" + stamp + "-' || g, md5('c" + stamp + "' || g) || md5('x' || g), md5('s" + stamp + "' || g) || md5('y' || g), "
                + "10, '10,20,30', 'i', 'CANCELLED', now() + interval '10 minutes' FROM generate_series(1, 3000) g");
        Paired device = pairedDevice();
        sql.update("INSERT INTO panel_session (id, device_id, institute_id, room_id, user_id, started_via, status, refresh_hash, remote_token_hash, expires_at) "
                + "SELECT 'si-" + stamp + "-' || g, ?, ?, ?, 'u' || g, 'QR', 'ENDED', md5('r" + stamp + "' || g) || md5('a' || g), "
                + "md5('t" + stamp + "' || g) || md5('b' || g), now() FROM generate_series(1, 3000) g",
                device.id(), institute, device.roomId());
        sql.update("INSERT INTO panel_login_challenge (id, device_id, institute_id, purpose, token_hash, user_code_hash, match_code, match_options, state, expires_at) "
                + "SELECT 'ci-" + stamp + "-' || g, ?, ?, 'SIGN_IN', md5('k" + stamp + "' || g) || md5('c' || g), md5('u" + stamp + "' || g) || md5('d' || g), "
                + "10, '10,20,30', 'DEAD', now() FROM generate_series(1, 3000) g", device.id(), institute);
        sql.execute("ANALYZE panel_pairing");
        sql.execute("ANALYZE panel_session");
        sql.execute("ANALYZE panel_login_challenge");
        try {
            String hash = "a".repeat(64);
            assertThat(plan("SELECT * FROM panel_session WHERE refresh_hash = $1", "varchar", hash)).contains("uq_panel_session_refresh");
            assertThat(plan("SELECT * FROM panel_session WHERE remote_token_hash = $1", "varchar", hash)).contains("uq_panel_session_remote");
            assertThat(plan("SELECT * FROM panel_login_challenge WHERE token_hash = $1", "varchar", hash)).contains("uq_panel_challenge_token");
            assertThat(plan("SELECT * FROM panel_login_challenge WHERE user_code_hash = $1", "varchar", hash)).contains("uq_panel_challenge_code");
            assertThat(plan("SELECT * FROM panel_pairing WHERE code_hash = $1", "varchar", hash)).contains("uq_panel_pairing_code");
            assertThat(plan("SELECT * FROM panel_pairing WHERE secret_hash = $1", "varchar", hash)).contains("uq_panel_pairing_secret");
            assertThat(plan("SELECT * FROM panel_session WHERE id = $1", "varchar", "x")).contains("panel_session_pkey");
            assertThat(plan("SELECT * FROM panel_session WHERE user_id = $1 AND status = 'ACTIVE'", "varchar", "x")).contains("uq_panel_session_user_active");
            assertThat(plan("SELECT count(*) FROM panel_pairing WHERE state = 'PENDING' AND expires_at > now() AND id <> $1", "varchar", "x"))
                    .contains("idx_panel_pairing_pending");
        } finally {
            sql.update("DELETE FROM panel_pairing WHERE id LIKE ?", "pi-" + stamp + "-%");
            sql.update("DELETE FROM panel_session WHERE id LIKE ?", "si-" + stamp + "-%");
            sql.update("DELETE FROM panel_login_challenge WHERE id LIKE ?", "ci-" + stamp + "-%");
        }
    }

    private String plan(String query, String type, String value) throws Exception {
        String name = "p_" + rand();
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("PREPARE " + name + "(" + type + ") AS " + query);
            StringBuilder plan = new StringBuilder();
            try (var rows = statement.executeQuery("EXPLAIN EXECUTE " + name + "('" + value + "')")) {
                while (rows.next()) {
                    plan.append(rows.getString(1)).append('\n');
                }
            }
            statement.execute("DEALLOCATE " + name);
            return plan.toString();
        }
    }

    // ------------------------------------------------------------ pairing ---

    @Test
    void pairingOnlyWritesAPairingRowAndStoresHashes() {
        PairStartResponse pair = pairStart();
        assertThat(pair.qrUrl()).isEqualTo("https://classroom.vacademy.io/classroom#pair=" + pair.code());
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_pairing WHERE code_hash = ? AND secret_hash = ?",
                Integer.class, PanelSecrets.sha256Hex(pair.code()), PanelSecrets.sha256Hex(pair.pairSecret()))).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_pairing WHERE code_hash = ? OR secret_hash = ?",
                Integer.class, pair.code(), pair.pairSecret())).isZero();
    }

    @Test
    void claimRemintDeclineAndReplaceThroughSql() {
        Paired first = pairedDevice();
        assertThat(sql.queryForObject("SELECT status FROM panel_device WHERE id = ?", String.class, first.id())).isEqualTo("ACTIVE");
        assertThat(sql.queryForObject("SELECT approve_base_url FROM panel_device WHERE id = ?", String.class, first.id()))
                .isEqualTo("https://portal.school.example");

        PairStartResponse pair = pairStart();
        String adminId = user(institute, "ADMIN", "ACTIVE");
        assertThat(code(() -> pairing.claim(as(adminId), claimBody(pair, first.roomId(), false)))).isEqualTo("ROOM_OCCUPIED");
        assertThat(sql.queryForObject("SELECT state FROM panel_pairing WHERE code_hash = ?", String.class,
                PanelSecrets.sha256Hex(pair.code()))).isEqualTo("PENDING");

        Signed signed = signIn(first, teacher());
        DeviceClaimResponse replaced = pairing.claim(as(adminId), claimBody(pair, first.roomId(), true));
        assertThat(replaced.room().id()).isEqualTo(first.roomId());
        assertThat(sql.queryForObject("SELECT status FROM panel_device WHERE id = ?", String.class, first.id())).isEqualTo("REVOKED");
        assertThat(sessionColumn(signed.approved().sessionId(), "end_reason")).isEqualTo("UNBOUND");

        // A retry inside 60 s overwrites the secret; the first one stops working.
        PairPollResponse one = pairing.poll(new PairPollRequest(pair.pairSecret()));
        PairPollResponse two = pairing.poll(new PairPollRequest(pair.pairSecret()));
        assertThat(one.deviceSecret()).isNotEqualTo(two.deviceSecret());
        assertThat(code(() -> pairing.confirm(new PairConfirmRequest(two.deviceId(), one.deviceSecret(), true)))).isEqualTo("DEVICE_REVOKED");

        sql.update("UPDATE panel_pairing SET picked_up_at = now() - interval '61 seconds' WHERE code_hash = ?", PanelSecrets.sha256Hex(pair.code()));
        assertThat(pairing.poll(new PairPollRequest(pair.pairSecret())).state()).isEqualTo("EXPIRED");

        // Decline frees the room.
        pairing.confirm(new PairConfirmRequest(two.deviceId(), two.deviceSecret(), false));
        assertThat(sql.queryForObject("SELECT status FROM panel_device WHERE id = ?", String.class, two.deviceId())).isEqualTo("REVOKED");
        assertThat(sql.queryForObject("SELECT state FROM panel_pairing WHERE code_hash = ?", String.class,
                PanelSecrets.sha256Hex(pair.code()))).isEqualTo("CANCELLED");
        pairedDevice(first.roomId(), false);
    }

    @Test
    void aConfirmedPanelSecretCannotBeRemintedByALatePoll() {
        PairStartResponse pair = pairStart();
        pairing.claim(as(user(institute, "ADMIN", "ACTIVE")), claimBody(pair, null, false));
        PairPollResponse polled = pairing.poll(new PairPollRequest(pair.pairSecret()));
        pairing.confirm(new PairConfirmRequest(polled.deviceId(), polled.deviceSecret(), true));
        assertThat(pairing.poll(new PairPollRequest(pair.pairSecret())).state()).isEqualTo("EXPIRED");
        assertThat(sessions.sync(new SyncRequest(polled.deviceId(), polled.deviceSecret(), null, null, null, null, false, null), "ip")
                .device().status()).isEqualTo("ACTIVE");
    }

    @Test
    void wrongNumberCancelsAndAnotherInstitutesRoomIsRefused() {
        PairStartResponse pair = pairStart();
        String adminId = user(institute, "ADMIN", "ACTIVE");
        int wrong = pair.matchCode() == 10 ? 11 : 10;
        assertThat(code(() -> pairing.claim(as(adminId), new DeviceClaimRequest(pair.code(), wrong, institute, null, "Room " + rand(), false))))
                .isEqualTo("WRONG_NUMBER");
        assertThat(sql.queryForObject("SELECT state FROM panel_pairing WHERE code_hash = ?", String.class,
                PanelSecrets.sha256Hex(pair.code()))).isEqualTo("CANCELLED");
        assertThat(code(() -> pairing.claim(as(adminId), claimBody(pair, null, false)))).isEqualTo("NOT_FOUND");

        Paired victim = pairedDevice();
        String otherInstitute = "it-" + rand();
        String otherAdmin = user(otherInstitute, "ADMIN", "ACTIVE");
        PairStartResponse other = pairStart();
        assertThat(code(() -> pairing.claim(as(otherAdmin), new DeviceClaimRequest(other.code(), other.matchCode(),
                otherInstitute, victim.roomId(), null, true)))).isEqualTo("ROOM_OTHER_INSTITUTE");
        assertThat(sql.queryForObject("SELECT status FROM panel_device WHERE id = ?", String.class, victim.id())).isEqualTo("ACTIVE");
    }

    @Test
    void anInstituteIdThatCouldEscapeTheInternalPathNeverReachesIt() {
        PairStartResponse pair = pairStart();
        String adminId = user(institute, "ADMIN", "ACTIVE");
        for (String bad : List.of("../../secret", "a/b", "a?b", "x".repeat(65))) {
            assertThat(code(() -> pairing.claim(as(adminId), new DeviceClaimRequest(pair.code(), pair.matchCode(), bad, null, "R", false))))
                    .isEqualTo("BAD_REQUEST");
        }
        org.mockito.Mockito.verify(instituteInternalService, org.mockito.Mockito.never()).getInstituteByInstituteId("../../secret");
    }

    /** T8: exactly one winner, no stray device or room from the losers. */
    @Test
    void concurrentClaimsOfOneCode() throws Exception {
        PairStartResponse pair = pairStart();
        List<String> admins = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            admins.add(user(institute, "ADMIN", "ACTIVE"));
        }
        List<Callable<Object>> calls = new ArrayList<>();
        for (String adminId : admins) {
            CustomUserDetails principal = as(adminId);
            calls.add(() -> pairing.claim(principal, claimBody(pair, null, false)));
        }
        List<Object> results = race(calls);
        assertThat(results.stream().filter(DeviceClaimResponse.class::isInstance).count()).isEqualTo(1);
        assertThat(results.stream().filter("NOT_FOUND"::equals).count()).isEqualTo(7);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_device WHERE institute_id = ?", Integer.class, institute)).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT count(*) FROM classroom_room WHERE institute_id = ?", Integer.class, institute)).isEqualTo(1);
    }

    @Test
    void concurrentClaimsOfOneRoomWithDifferentCodes() throws Exception {
        String roomId = admin.createRoom(as(user(institute, "ADMIN", "ACTIVE")), new RoomCreateRequest(institute, "Lab " + rand())).id();
        List<Callable<Object>> calls = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            PairStartResponse pair = pairStart();
            CustomUserDetails principal = as(user(institute, "ADMIN", "ACTIVE"));
            calls.add(() -> pairing.claim(principal, claimBody(pair, roomId, false)));
        }
        List<Object> results = race(calls);
        assertThat(results.stream().filter(DeviceClaimResponse.class::isInstance).count()).isEqualTo(1);
        assertThat(results.stream().filter("ROOM_OCCUPIED"::equals).count()).isEqualTo(5);
        String winner = results.stream().filter(DeviceClaimResponse.class::isInstance)
                .map(r -> ((DeviceClaimResponse) r).deviceId()).findFirst().orElseThrow();
        PairStartResponse late = pairStart();
        assertThatThrownBy(() -> pairing.claim(as(user(institute, "ADMIN", "ACTIVE")), claimBody(late, roomId, false)))
                .isInstanceOfSatisfying(PanelApiException.class, e -> assertThat(e.getExtras().get("current_device").toString()).contains(winner));
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_device WHERE room_id = ? AND status IN ('CLAIMED','ACTIVE')", Integer.class, roomId)).isEqualTo(1);
    }

    /** T60: the cap counts live rows only, and old rows are purged. */
    @Test
    void pendingCapCountsOnlyUnexpiredRowsAndCleanupPurges() throws Exception {
        String stamp = rand();
        String prefix = "cap-" + stamp + "-";
        sql.update("INSERT INTO panel_pairing (id, code_hash, secret_hash, match_code, match_options, install_id, expires_at) "
                + "SELECT '" + prefix + "' || g, md5('c" + stamp + "' || g) || md5('x' || g), md5('s" + stamp + "' || g) || md5('y' || g), "
                + "10, '10,20,30', 'i', now() + interval '10 minutes' FROM generate_series(1, 10001) g");
        try {
            Thread.sleep(10_100);
            assertThatThrownBy(this::pairStart).isInstanceOfSatisfying(PanelApiException.class, e -> {
                assertThat(e.getCode()).isEqualTo("BUSY");
                assertThat(e.getHttpStatus().value()).isEqualTo(503);
            });
            sql.update("UPDATE panel_pairing SET expires_at = now() - interval '1 second' WHERE id LIKE ?", prefix + "%");
            Thread.sleep(10_100);
            pairStart();

            assertThat(repository.purgeOldPairings(100_000) >= 0).isTrue();
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_pairing WHERE id LIKE ?", Integer.class, prefix + "%")).isEqualTo(10001);
            sql.update("UPDATE panel_pairing SET expires_at = now() - interval '61 minutes' WHERE id LIKE ?", prefix + "%");
            assertThat(repository.purgeOldPairings(500)).isEqualTo(500);
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_pairing WHERE id LIKE ?", Integer.class, prefix + "%")).isEqualTo(9501);

            PanelMaintenance fresh = new PanelMaintenance(repository);
            fresh.maybePurge();
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_pairing WHERE id LIKE ?", Integer.class, prefix + "%")).isEqualTo(9001);
            fresh.maybePurge();
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_pairing WHERE id LIKE ?", Integer.class, prefix + "%"))
                    .as("at most once a minute per pod").isEqualTo(9001);
        } finally {
            sql.update("DELETE FROM panel_pairing WHERE id LIKE ?", prefix + "%");
        }
    }

    @Test
    void cleanupRemovesChallengesOnlyAfterADay() {
        Paired device = pairedDevice();
        ChallengeResponse old = challenge(device);
        challenge(device);
        sql.update("UPDATE panel_login_challenge SET expires_at = now() - interval '23 hours' WHERE id = ?", old.challengeId());
        repository.purgeOldChallenges(100_000);
        assertThat(challengeState(old.challengeId())).isEqualTo("DEAD");
        sql.update("UPDATE panel_login_challenge SET expires_at = now() - interval '25 hours' WHERE id = ?", old.challengeId());
        repository.purgeOldChallenges(100_000);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_login_challenge WHERE id = ?", Integer.class, old.challengeId())).isZero();
    }

    // ----------------------------------------------------------- challenge ---

    @Test
    void wholeSignInStateMachine() {
        Paired device = pairedDevice();
        String teacher = teacher();
        ChallengeResponse challenge = challenge(device);
        String id = challenge.challengeId();
        assertThat(challengeState(id)).isEqualTo("PENDING");
        assertThat(tokenOf(challenge)).hasSize(22);
        assertThat(poll(device, challenge).state()).isEqualTo("PENDING");

        ChallengeDescribeResponse described = challenges.describe(as(teacher), new ChallengeDescribeRequest(tokenOf(challenge), null));
        assertThat(described.matchOptions()).hasSize(3).contains(challenge.matchCode());
        assertThat(challengeState(id)).isEqualTo("SCANNED");
        ChallengePollResponse scanned = poll(device, challenge);
        assertThat(scanned.state()).isEqualTo("SCANNED");
        assertThat(scanned.scannedByName()).isEqualTo("Name");

        ChallengeApprovedResponse approved = approve(teacher, challenge);
        assertThat(challengeState(id)).isEqualTo("APPROVED");
        assertThat(sessionColumn(approved.sessionId(), "refresh_hash")).isNull();
        assertThat(sessionColumn(approved.sessionId(), "status")).isEqualTo("ACTIVE");
        assertThat(sql.queryForObject("SELECT remote_token_hash FROM panel_session WHERE id = ?", String.class, approved.sessionId()))
                .isEqualTo(PanelSecrets.sha256Hex(approved.remoteToken()));

        ChallengePollResponse redeemed = poll(device, challenge);
        assertThat(redeemed.state()).isEqualTo("REDEEMED");
        assertThat(challengeState(id)).isEqualTo("REDEEMED");
        assertThat(sql.queryForObject("SELECT refresh_hash FROM panel_session WHERE id = ?", String.class, approved.sessionId()))
                .isEqualTo(PanelSecrets.sha256Hex(redeemed.sessionToken()));
        assertThat(sql.queryForObject("SELECT count(*) FROM refresh_token WHERE user_id = ?", Integer.class, teacher))
                .as("the panel flow writes nothing to refresh_token").isZero();

        // T19: a retry inside 60 s re-mints; the older token stops working.
        ChallengePollResponse retry = poll(device, challenge);
        assertThat(retry.sessionToken()).isNotEqualTo(redeemed.sessionToken());
        assertThat(code(() -> sessions.refresh(new SessionRefreshRequest(device.id(), device.secret(), redeemed.sessionToken())))).isEqualTo("SESSION_ENDED");
        sessions.refresh(new SessionRefreshRequest(device.id(), device.secret(), retry.sessionToken()));
        sql.update("UPDATE panel_login_challenge SET redeemed_at = now() - interval '61 seconds' WHERE id = ?", id);
        assertThat(poll(device, challenge).state()).isEqualTo("EXPIRED");
    }

    @Test
    void approveActivatesAnInviteAndADisabledRoleIsLeftAlone() {
        Paired device = pairedDevice();
        String invited = user(institute, "TEACHER", "INVITED");
        grant(invited, "other-" + rand(), "TEACHER", "INVITED");
        signIn(device, invited);
        assertThat(sql.queryForObject("SELECT status FROM user_role WHERE user_id = ? AND institute_id = ?", String.class, invited, institute)).isEqualTo("ACTIVE");
        assertThat(sql.queryForObject("SELECT status FROM user_role WHERE user_id = ? AND institute_id <> ?", String.class, invited, institute))
                .as("only the panel's institute").isEqualTo("INVITED");

        String removed = user(institute, "TEACHER", "DISABLED");
        ChallengeResponse challenge = challenge(device);
        assertThat(code(() -> approve(removed, challenge))).isEqualTo("NOT_STAFF");
        assertThat(sql.queryForObject("SELECT status FROM user_role WHERE user_id = ?", String.class, removed)).isEqualTo("DISABLED");
    }

    @Test
    void aFreshChallengeKillsOpenOnesAndAnApprovedOneBlocks() {
        Paired device = pairedDevice();
        ChallengeResponse first = challenge(device);
        ChallengeResponse second = challenge(device);
        assertThat(challengeState(first.challengeId())).isEqualTo("DEAD");
        approve(teacher(), second);
        assertThatThrownBy(() -> challenge(device)).isInstanceOfSatisfying(PanelApiException.class, e -> {
            assertThat(e.getCode()).isEqualTo("APPROVED_PENDING");
            assertThat(e.getExtras()).containsEntry("challenge_id", second.challengeId());
        });
        assertThat(challengeState(second.challengeId())).isEqualTo("APPROVED");
    }

    /** T54: scan at 4:50, tap at 5:30, redeem 90 s later, and the ceiling. */
    @Test
    void timersOfTheChallenge() {
        Paired device = pairedDevice();
        String teacher = teacher();
        ChallengeResponse challenge = challenge(device);
        String id = challenge.challengeId();
        sql.update("UPDATE panel_login_challenge SET created_at = now() - interval '290 seconds', expires_at = now() + interval '10 seconds' WHERE id = ?", id);
        ChallengeDescribeResponse described = challenges.describe(as(teacher), new ChallengeDescribeRequest(tokenOf(challenge), null));
        assertThat(described.expiresInS()).isBetween(118L, 120L);

        sql.update("UPDATE panel_login_challenge SET created_at = created_at - interval '40 seconds', expires_at = expires_at - interval '40 seconds' WHERE id = ?", id);
        assertThat(poll(device, challenge).state()).isEqualTo("SCANNED");
        ChallengeApprovedResponse approved = approve(teacher, challenge);
        sql.update("UPDATE panel_login_challenge SET approved_at = now() - interval '90 seconds', expires_at = now() - interval '89 seconds' WHERE id = ?", id);
        assertThat(poll(device, challenge).state()).as("redeem runs off approved_at, not expires_at").isEqualTo("REDEEMED");
        assertThat(sessionColumn(approved.sessionId(), "status")).isEqualTo("ACTIVE");

        ChallengeResponse late = challenge(device);
        sql.update("UPDATE panel_login_challenge SET expires_at = now() - interval '1 second' WHERE id = ?", late.challengeId());
        assertThat(poll(device, late).state()).isEqualTo("EXPIRED");
        assertThat(challengeState(late.challengeId())).as("read as EXPIRED, not rewritten").isEqualTo("PENDING");
        assertThat(code(() -> approve(teacher, late))).isEqualTo("EXPIRED");

        ChallengeResponse capped = challenge(device);
        sql.update("UPDATE panel_login_challenge SET created_at = now() - interval '599 seconds', expires_at = now() + interval '1 second' WHERE id = ?", capped.challengeId());
        ChallengeDescribeResponse ceiling = challenges.describe(as(teacher), new ChallengeDescribeRequest(tokenOf(capped), null));
        assertThat(ceiling.expiresInS()).as("never past created_at + 10 min").isLessThanOrEqualTo(1);
    }

    /** T54b: an approval nobody picks up dies, and its session with it, at the next renewal. */
    @Test
    void anUnredeemedApprovalExpiresWithItsSession() {
        Paired device = pairedDevice();
        ChallengeResponse challenge = challenge(device);
        ChallengeApprovedResponse approved = approve(teacher(), challenge);
        sql.update("UPDATE panel_login_challenge SET approved_at = now() - interval '121 seconds' WHERE id = ?", challenge.challengeId());
        assertThat(poll(device, challenge).state()).isEqualTo("EXPIRED");
        ChallengeResponse next = challenge(device);
        assertThat(challengeState(challenge.challengeId())).isEqualTo("EXPIRED");
        assertThat(sessionColumn(approved.sessionId(), "end_reason")).isEqualTo("EXPIRED");
        assertThat(challengeState(next.challengeId())).isEqualTo("PENDING");
    }

    /** T55 and the repeat window. */
    @Test
    void repeatApproveRotatesTheRemoteTokenWithinSixtySeconds() {
        Paired device = pairedDevice();
        String teacher = teacher();
        ChallengeResponse challenge = challenge(device);
        ChallengeApprovedResponse first = approve(teacher, challenge);
        ChallengeApprovedResponse second = approve(teacher, challenge);
        assertThat(second.sessionId()).isEqualTo(first.sessionId());
        assertThat(second.remoteToken()).isNotEqualTo(first.remoteToken());
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ?", Integer.class, device.id())).isEqualTo(1);
        assertThat(code(() -> approve(teacher(), challenge))).isEqualTo("EXPIRED");
        poll(device, challenge);
        approve(teacher, challenge);
        sql.update("UPDATE panel_login_challenge SET approved_at = now() - interval '61 seconds' WHERE id = ?", challenge.challengeId());
        assertThat(code(() -> approve(teacher, challenge))).isEqualTo("EXPIRED");
    }

    /** T18: exactly one session from many approvals of one token. */
    @Test
    void concurrentApprovalsByDifferentPeople() throws Exception {
        Paired device = pairedDevice();
        ChallengeResponse challenge = challenge(device);
        List<Callable<Object>> calls = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            CustomUserDetails principal = as(teacher());
            calls.add(() -> challenges.approve(principal, new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), "ip"));
        }
        List<Object> results = race(calls);
        assertThat(results.stream().filter(ChallengeApprovedResponse.class::isInstance).count()).isEqualTo(1);
        assertThat(results.stream().filter("EXPIRED"::equals).count()).isEqualTo(7);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ?", Integer.class, device.id())).isEqualTo(1);
    }

    @Test
    void aDoubleTapFromOnePhoneMakesOneSession() throws Exception {
        Paired device = pairedDevice();
        ChallengeResponse challenge = challenge(device);
        CustomUserDetails principal = as(teacher());
        List<Object> results = race(times(6, () -> challenges.approve(principal,
                new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), "ip")));
        assertThat(results).allMatch(ChallengeApprovedResponse.class::isInstance);
        assertThat(results.stream().map(r -> ((ChallengeApprovedResponse) r).sessionId()).distinct().count()).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ?", Integer.class, device.id())).isEqualTo(1);
    }

    @Test
    void concurrentRedeemsLeaveOneWorkingToken() throws Exception {
        Paired device = pairedDevice();
        ChallengeResponse challenge = challenge(device);
        ChallengeApprovedResponse approved = approve(teacher(), challenge);
        List<Object> results = race(times(6, () -> poll(device, challenge)));
        assertThat(results).allMatch(r -> "REDEEMED".equals(((ChallengePollResponse) r).state()));
        String stored = sql.queryForObject("SELECT refresh_hash FROM panel_session WHERE id = ?", String.class, approved.sessionId());
        long matching = results.stream()
                .filter(r -> PanelSecrets.sha256Hex(((ChallengePollResponse) r).sessionToken()).equals(stored))
                .count();
        assertThat(matching).as("only the last writer's token is stored").isEqualTo(1);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ?", Integer.class, device.id())).isEqualTo(1);
    }

    @Test
    void concurrentChallengesLeaveOneOpen() throws Exception {
        Paired device = pairedDevice();
        List<Object> results = race(times(8, () -> challenge(device)));
        assertThat(results).as("%s", results).allMatch(ChallengeResponse.class::isInstance);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_login_challenge WHERE device_id = ? AND state IN ('PENDING','SCANNED','APPROVED')",
                Integer.class, device.id())).isEqualTo(1);
    }

    /** T53: approve against renewal, many rounds. Either order is fine; both winning is not. */
    @Test
    void approveRacingARenewal() throws Exception {
        Paired device = pairedDevice();
        for (int round = 0; round < 12; round++) {
            ChallengeResponse challenge = challenge(device);
            String teacher = teacher();
            CustomUserDetails principal = as(teacher);
            List<Callable<Object>> calls = List.of(
                    () -> challenges.approve(principal, new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), "ip"),
                    () -> challenge(device));
            List<Object> results = race(calls);
            boolean approved = results.get(0) instanceof ChallengeApprovedResponse;
            if (approved) {
                assertThat(results.get(1)).isEqualTo("APPROVED_PENDING");
                assertThat(poll(device, challenge).state()).isEqualTo("REDEEMED");
            } else {
                assertThat(results.get(0)).isEqualTo("EXPIRED");
                assertThat(results.get(1)).isInstanceOf(ChallengeResponse.class);
                assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE user_id = ?", Integer.class, teacher)).isZero();
            }
        }
    }

    /** The order in revokeInTx: nothing may stay live on a revoked panel, whichever wins. */
    @Test
    void approveRacingARevoke() throws Exception {
        for (int round = 0; round < 12; round++) {
            Paired device = pairedDevice();
            ChallengeResponse challenge = challenge(device);
            CustomUserDetails principal = as(teacher());
            CustomUserDetails adminPrincipal = as(user(institute, "ADMIN", "ACTIVE"));
            List<Callable<Object>> calls = List.of(
                    () -> challenges.approve(principal, new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), "ip"),
                    () -> admin.revokeDevice(adminPrincipal, device.id()));
            race(calls);
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ? AND status = 'ACTIVE'", Integer.class, device.id())).isZero();
            assertThat(sql.queryForObject("SELECT count(*) FROM panel_login_challenge WHERE device_id = ? AND state IN ('PENDING','SCANNED','APPROVED')",
                    Integer.class, device.id())).isZero();
        }
    }

    /** T20 with threads: one teacher approving on many panels at once keeps one live session. */
    @Test
    void oneTeacherApprovingOnManyPanelsAtOnce() throws Exception {
        String teacher = teacher();
        CustomUserDetails principal = as(teacher);
        List<Callable<Object>> calls = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            Paired device = pairedDevice();
            ChallengeResponse challenge = challenge(device);
            calls.add(() -> challenges.approve(principal, new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), "ip"));
        }
        List<Object> results = race(calls);
        assertThat(results).as("each approval ends the one before it: %s", results)
                .allMatch(ChallengeApprovedResponse.class::isInstance);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE user_id = ? AND status = 'ACTIVE'", Integer.class, teacher)).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE user_id = ? AND end_reason = 'SUPERSEDED'", Integer.class, teacher)).isEqualTo(5);
    }

    /** T21 with threads: many teachers approving on one panel at once, one live session. */
    @Test
    void manyTeachersApprovingOnOnePanelInTurn() throws Exception {
        // One device has one open challenge at a time, so these race the partial index through
        // password login, which has no challenge row in front of it.
        Paired device = pairedDevice();
        admin.patchDevice(as(user(institute, "ADMIN", "ACTIVE")), device.id(), new DevicePatchRequest(null, true));
        List<Callable<Object>> calls = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            String teacher = teacher();
            calls.add(() -> sessions.loginPassword(new LoginPasswordRequest(device.id(), device.secret(), teacher, "secret-pass")));
        }
        List<Object> results = race(calls);
        assertThat(results).as("%s", results).allMatch(RedeemedSession.class::isInstance);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ? AND status = 'ACTIVE'", Integer.class, device.id())).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT count(*) FROM panel_session WHERE device_id = ? AND end_reason = 'REPLACED'", Integer.class, device.id())).isEqualTo(5);
    }

    /** The indexes themselves, should any future code path skip the conditional UPDATEs. */
    @Test
    void uniqueIndexesHoldOneActiveSessionPerDeviceAndUser() {
        Paired device = pairedDevice();
        String teacher = teacher();
        Signed signed = signIn(device, teacher);
        String roomId = device.roomId();
        assertThatThrownBy(() -> sql.update("INSERT INTO panel_session (id, device_id, institute_id, room_id, user_id, started_via, expires_at) "
                + "VALUES (?, ?, ?, ?, 'someone-else', 'QR', now() + interval '1 hour')", "dup-" + rand(), device.id(), institute, roomId))
                .hasMessageContaining("uq_panel_session_device_active");
        Paired other = pairedDevice();
        assertThatThrownBy(() -> sql.update("INSERT INTO panel_session (id, device_id, institute_id, room_id, user_id, started_via, expires_at) "
                + "VALUES (?, ?, ?, ?, ?, 'QR', now() + interval '1 hour')", "dup-" + rand(), other.id(), institute, other.roomId(), teacher))
                .hasMessageContaining("uq_panel_session_user_active");
        assertThat(sessionColumn(signed.approved().sessionId(), "status")).isEqualTo("ACTIVE");
    }

    @Test
    void attachRemoteRotatesTheTokenResetsSeqAndAnswersAttached() {
        Paired device = pairedDevice();
        String teacher = teacher();
        Signed signed = signIn(device, teacher);
        String oldRemote = signed.approved().remoteToken();
        sessions.remoteNav(new RemoteNavRequest(oldRemote, 1, 5_000_000L));

        ChallengeResponse attach = challenges.create(new ChallengeRequest(device.id(), device.secret(), "ATTACH_REMOTE", signed.redeemed().sessionToken()));
        assertThat(code(() -> challenges.describe(as(teacher()), new ChallengeDescribeRequest(tokenOf(attach), null)))).isEqualTo("OTHER_USER");
        assertThat(code(() -> challenges.approve(as(teacher()), new ChallengeApproveRequest(tokenOf(attach), null, attach.matchCode(), null), "ip"))).isEqualTo("OTHER_USER");
        ChallengeApprovedResponse attached = approve(teacher, attach);
        assertThat(attached.sessionId()).isEqualTo(signed.approved().sessionId());
        assertThat(challengeState(attach.challengeId())).isEqualTo("REDEEMED");
        assertThat(poll(device, attach).state()).isEqualTo("ATTACHED");
        assertThat(sessionColumn(attached.sessionId(), "remote_client_seq")).isEqualTo("0");
        assertThat(sessionColumn(attached.sessionId(), "remote_nav_counter")).isEqualTo("1");
        assertThat(sessions.remoteNav(new RemoteNavRequest(attached.remoteToken(), 1, 7L)).accepted()).isTrue();
        assertThat(sessions.remoteNav(new RemoteNavRequest(oldRemote, 1, 6_000_000L)).accepted()).isFalse();

        assertThat(code(() -> challenges.create(new ChallengeRequest(device.id(), device.secret(), "ATTACH_REMOTE", "nonsense")))).isEqualTo("SESSION_ENDED");
    }

    // ------------------------------------------------------------- session ---

    /** T31: refused at the cap, and refreshing cannot extend it. */
    @Test
    void theCapHoldsAndRefreshDoesNotExtendIt() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        String id = signed.approved().sessionId();
        assertThat(signed.redeemed().sessionExpiresInS()).isBetween(4 * 3600L - 30, 4 * 3600L);
        String before = sessionColumn(id, "expires_at");
        SessionRefreshResponse refreshed = sessions.refresh(refreshBody(device, signed));
        assertThat(refreshed.expiresInS()).isEqualTo(900);
        assertThat(sessionColumn(id, "expires_at")).isEqualTo(before);
        sql.update("UPDATE panel_session SET expires_at = now() - interval '1 second' WHERE id = ?", id);
        assertThatThrownBy(() -> sessions.refresh(refreshBody(device, signed))).isInstanceOfSatisfying(PanelApiException.class, e -> {
            assertThat(e.getCode()).isEqualTo("SESSION_ENDED");
            assertThat(e.getExtras()).containsEntry("reason", "EXPIRED");
        });
        assertThat(sessionColumn(id, "status")).isEqualTo("ENDED");
        assertThat(sessionColumn(id, "end_reason")).isEqualTo("EXPIRED");
    }

    @Test
    void aSessionPastItsCapReadsEndedEverywhere() {
        Paired device = pairedDevice();
        String teacher = teacher();
        Signed signed = signIn(device, teacher);
        sql.update("UPDATE panel_session SET expires_at = now() - interval '1 second' WHERE id = ?", signed.approved().sessionId());
        assertThat(sessions.remoteNav(new RemoteNavRequest(signed.approved().remoteToken(), 1, 9L)).status()).isEqualTo("ENDED");
        assertThat(sessions.remoteState(new RemoteTokenRequest(signed.approved().remoteToken())).status()).isEqualTo("ENDED");
        assertThat(sessions.mySession(as(teacher))).isEmpty();
    }

    /** T31b and the refresh that keeps it quiet. */
    @Test
    void deadManEndsASessionNotRefreshedForAnHour() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        String id = signed.approved().sessionId();
        backdateSession(id, "last_refreshed_at", "59 minutes");
        sessions.refresh(refreshBody(device, signed));
        assertThat(sql.queryForObject("SELECT last_refreshed_at > now() - interval '5 seconds' FROM panel_session WHERE id = ?", Boolean.class, id)).isTrue();
        backdateSession(id, "last_refreshed_at", "61 minutes");
        assertThatThrownBy(() -> sessions.refresh(refreshBody(device, signed))).isInstanceOfSatisfying(PanelApiException.class,
                e -> assertThat(e.getExtras()).containsEntry("reason", "DEAD_MAN"));
        assertThat(sessionColumn(id, "end_reason")).isEqualTo("DEAD_MAN");
    }

    /** T26: rechecked at every refresh, from user_role. */
    @Test
    void removingTheRoleEndsTheSessionAtTheNextRefresh() {
        Paired device = pairedDevice();
        String teacher = teacher();
        Signed signed = signIn(device, teacher);
        sessions.refresh(refreshBody(device, signed));
        sql.update("UPDATE user_role SET status = 'DISABLED' WHERE user_id = ?", teacher);
        assertThatThrownBy(() -> sessions.refresh(refreshBody(device, signed))).isInstanceOfSatisfying(PanelApiException.class,
                e -> assertThat(e.getExtras()).containsEntry("reason", "ACCESS_REMOVED"));
        assertThat(sessionColumn(signed.approved().sessionId(), "end_reason")).isEqualTo("ACCESS_REMOVED");
        SyncResponse synced = sessions.sync(device.sync(signed.approved().sessionId(), signed.redeemed().sessionToken(), false, null), "ip");
        assertThat(synced.session().endReason()).isEqualTo("ACCESS_REMOVED");
    }

    @Test
    void aLapsedTrialEndsTheSessionAtTheNextRefresh() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        sql.update("INSERT INTO institute_trial (institute_id, expires_at, created_by) VALUES (?, now() - interval '1 day', 'it')", institute);
        assertThatThrownBy(() -> sessions.refresh(refreshBody(device, signed))).isInstanceOfSatisfying(PanelApiException.class,
                e -> assertThat(e.getExtras()).containsEntry("reason", "ACCESS_REMOVED"));
        ChallengeResponse next = challenge(device);
        CustomUserDetails anotherTeacher = as(teacher());
        assertThat(callerCode(() -> challenges.describe(anotherTeacher, new ChallengeDescribeRequest(tokenOf(next), null))))
                .as("the trial guard refuses a new sign-in").isEqualTo(403);
    }

    @Test
    void endReasonsFromEveryRoute() {
        Paired device = pairedDevice();
        String teacher = teacher();
        Signed one = signIn(device, teacher);
        Signed two = signIn(device, teacher());
        assertThat(sessionColumn(one.approved().sessionId(), "end_reason")).as("switch teacher").isEqualTo("REPLACED");
        Paired other = pairedDevice();
        String secondTeacher = teacher();
        Signed three = signIn(other, secondTeacher);
        Paired third = pairedDevice();
        Signed four = signIn(third, secondTeacher);
        assertThat(sessionColumn(three.approved().sessionId(), "end_reason")).as("same teacher elsewhere").isEqualTo("SUPERSEDED");

        sessions.end(new SessionEndRequest(device.id(), device.secret(), two.redeemed().sessionToken(), "IDLE"));
        assertThat(sessionColumn(two.approved().sessionId(), "end_reason")).isEqualTo("IDLE");
        sessions.end(new SessionEndRequest(device.id(), device.secret(), two.redeemed().sessionToken(), "SIGN_OUT"));
        assertThat(sessionColumn(two.approved().sessionId(), "end_reason")).as("idempotent, first reason stays").isEqualTo("IDLE");
        assertThat(code(() -> sessions.end(new SessionEndRequest(device.id(), device.secret(), null, "ADMIN")))).isEqualTo("BAD_REQUEST");

        sessions.mySessionEnd(as(secondTeacher));
        assertThat(sessionColumn(four.approved().sessionId(), "end_reason")).isEqualTo("PHONE");
        assertThat(sessionColumn(four.approved().sessionId(), "ended_by")).isEqualTo(secondTeacher);

        Signed five = signIn(third, secondTeacher);
        CustomUserDetails adminPrincipal = as(user(institute, "ADMIN", "ACTIVE"));
        admin.endSession(adminPrincipal, five.approved().sessionId());
        assertThat(sessionColumn(five.approved().sessionId(), "end_reason")).isEqualTo("ADMIN");

        Signed six = signIn(third, secondTeacher);
        sessions.remoteEnd(new RemoteTokenRequest(six.approved().remoteToken()));
        assertThat(sessionColumn(six.approved().sessionId(), "end_reason")).isEqualTo("PHONE");

        Signed seven = signIn(third, secondTeacher);
        admin.revokeDevice(adminPrincipal, third.id());
        assertThat(sessionColumn(seven.approved().sessionId(), "end_reason")).isEqualTo("UNBOUND");
        assertThat(sessionColumn(seven.approved().sessionId(), "ended_by")).isEqualTo(adminPrincipal.getUserId());
    }

    @Test
    void passwordLoginNeverTouchesRefreshTokens() {
        Paired device = pairedDevice();
        String teacher = teacher();
        LoginPasswordRequest good = new LoginPasswordRequest(device.id(), device.secret(), teacher, "secret-pass");
        assertThat(code(() -> sessions.loginPassword(good))).isEqualTo("PASSWORD_DISABLED");
        admin.patchDevice(as(user(institute, "ADMIN", "ACTIVE")), device.id(), new DevicePatchRequest(null, true));
        assertThat(code(() -> sessions.loginPassword(new LoginPasswordRequest(device.id(), device.secret(), teacher, "wrong")))).isEqualTo("BAD_CREDENTIALS");
        sql.update("INSERT INTO refresh_token (id, token, user_id, client_name, expiry_date) VALUES (?, 'keep', ?, 'ADMIN_PORTAL', now() + interval '1 day')", rand(), teacher);
        RedeemedSession session = sessions.loginPassword(good);
        assertThat(session.user().id()).isEqualTo(teacher);
        assertThat(sessionColumn(session.sessionId(), "started_via")).isEqualTo("PASSWORD");
        assertThat(sessionColumn(session.sessionId(), "remote_token_hash")).isNull();
        assertThat(sql.queryForObject("SELECT count(*) FROM refresh_token WHERE user_id = ? AND token = 'keep'", Integer.class, teacher)).isEqualTo(1);

        String student = user(institute, "STUDENT", "ACTIVE");
        assertThat(code(() -> sessions.loginPassword(new LoginPasswordRequest(device.id(), device.secret(), student, "secret-pass")))).isEqualTo("NOT_STAFF");
        for (int i = 0; i < 5; i++) {
            code(() -> sessions.loginPassword(new LoginPasswordRequest(device.id(), device.secret(), "limited-" + institute, "x")));
        }
        assertThat(code(() -> sessions.loginPassword(new LoginPasswordRequest(device.id(), device.secret(), "limited-" + institute, "x")))).isEqualTo("RATE_LIMITED");
    }

    // ---------------------------------------------------------------- sync ---

    @Test
    void syncWritesOnlyWhenDue() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        String id = signed.approved().sessionId();
        String token = signed.redeemed().sessionToken();
        NavState state = new NavState(1, 5, "Slide");

        sessions.sync(device.sync(id, token, true, state), "ip");
        String xmin = sessionColumn(id, "xmin");
        String deviceXmin = sql.queryForObject("SELECT xmin::text FROM panel_device WHERE id = ?", String.class, device.id());
        for (int i = 0; i < 5; i++) {
            sessions.sync(device.sync(id, token, true, state), "ip");
        }
        assertThat(sessionColumn(id, "xmin")).as("no write while nothing is due").isEqualTo(xmin);
        assertThat(sql.queryForObject("SELECT xmin::text FROM panel_device WHERE id = ?", String.class, device.id())).isEqualTo(deviceXmin);

        sessions.sync(device.sync(id, token, true, new NavState(2, 5, "Slide")), "ip");
        assertThat(sessionColumn(id, "state_index")).isEqualTo("2");
        assertThat(sessionColumn(id, "xmin")).isNotEqualTo(xmin);

        backdateSession(id, "panel_seen_at", "29 seconds");
        String beforeTouch = sessionColumn(id, "xmin");
        sessions.sync(device.sync(id, token, true, new NavState(2, 5, "Slide")), "ip");
        assertThat(sessionColumn(id, "xmin")).as("under 30 s").isEqualTo(beforeTouch);
        backdateSession(id, "panel_seen_at", "31 seconds");
        sessions.sync(device.sync(id, token, true, new NavState(2, 5, "Slide")), "ip");
        assertThat(sql.queryForObject("SELECT panel_seen_at > now() - interval '5 seconds' FROM panel_session WHERE id = ?", Boolean.class, id)).isTrue();

        sql.update("UPDATE panel_device SET last_seen_at = now() - interval '299 seconds' WHERE id = ?", device.id());
        sessions.sync(device.sync(id, token, true, new NavState(2, 5, "Slide")), "ip");
        assertThat(sql.queryForObject("SELECT last_seen_at < now() - interval '200 seconds' FROM panel_device WHERE id = ?", Boolean.class, device.id())).isTrue();
        sql.update("UPDATE panel_device SET last_seen_at = now() - interval '301 seconds' WHERE id = ?", device.id());
        sessions.sync(device.sync(id, token, true, new NavState(2, 5, "Slide")), "9.9.9.9");
        assertThat(sql.queryForObject("SELECT last_seen_at > now() - interval '5 seconds' FROM panel_device WHERE id = ?", Boolean.class, device.id())).isTrue();
        assertThat(sql.queryForObject("SELECT last_ip FROM panel_device WHERE id = ?", String.class, device.id())).isEqualTo("9.9.9.9");

        sessions.sync(device.sync(id, token, false, null), "ip");
        assertThat(sessionColumn(id, "state_index")).isNull();
        String cleared = sessionColumn(id, "xmin");
        sessions.sync(device.sync(id, token, false, null), "ip");
        assertThat(sessionColumn(id, "xmin")).as("clears once").isEqualTo(cleared);

        sessions.sync(device.sync(id, token, true, new NavState(1, 2, "x".repeat(250))), "ip");
        assertThat(sessionColumn(id, "state_title")).hasSize(200);
    }

    /** The panel is polling when it redeems, so the phone sees it online straight after the tap. */
    @Test
    void redeemingMarksThePanelSeen() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        assertThat(sql.queryForObject("SELECT panel_seen_at > now() - interval '5 seconds' FROM panel_session WHERE id = ?",
                Boolean.class, signed.approved().sessionId())).isTrue();
        assertThat(sessions.remoteState(new RemoteTokenRequest(signed.approved().remoteToken())).panelOnline()).isTrue();
    }

    /** T57: an idle phone, a static slide, and the poll interval. */
    @Test
    void onlineFlagsAndPollIntervals() {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        String id = signed.approved().sessionId();
        String token = signed.redeemed().sessionToken();
        String remote = signed.approved().remoteToken();
        NavState state = new NavState(1, 5, "Static");

        assertThat(sessions.sync(new SyncRequest(device.id(), device.secret(), null, null, null, null, false, null), "ip").nextPollMs()).isEqualTo(300_000);
        assertThat(sessions.sync(device.sync(id, token, false, null), "ip").nextPollMs()).isEqualTo(60_000);
        // A meeting screen is open: polled often enough that a sign-out or revoke closes it quickly.
        assertThat(sessions.sync(new SyncRequest(device.id(), device.secret(), id, token, null, null, false, null,
                true), "ip").nextPollMs()).isEqualTo(10_000);
        assertThat(sessions.sync(new SyncRequest(device.id(), device.secret(), null, null, null, null, false, null,
                true), "ip").nextPollMs()).isEqualTo(300_000);
        SyncResponse quiet = sessions.sync(device.sync(id, token, true, state), "ip");
        assertThat(quiet.nextPollMs()).isEqualTo(5_000);
        assertThat(quiet.session().phoneConnected()).isFalse();
        assertThat(quiet.session().navAgeMs()).isNull();

        assertThat(sessions.remoteState(new RemoteTokenRequest(remote)).panelOnline()).isTrue();
        SyncResponse withPhone = sessions.sync(device.sync(id, token, true, state), "ip");
        assertThat(withPhone.nextPollMs()).isEqualTo(1_000);
        assertThat(withPhone.session().phoneConnected()).isTrue();

        // Static slide for 5 minutes: state_updated_at is old, panel_seen_at keeps panel_online true.
        sql.update("UPDATE panel_session SET state_updated_at = now() - interval '5 minutes', panel_seen_at = now() - interval '89 seconds' WHERE id = ?", id);
        assertThat(sessions.remoteState(new RemoteTokenRequest(remote)).panelOnline()).isTrue();
        sql.update("UPDATE panel_session SET panel_seen_at = now() - interval '91 seconds' WHERE id = ?", id);
        assertThat(sessions.remoteState(new RemoteTokenRequest(remote)).panelOnline()).isFalse();

        backdateSession(id, "remote_seen_at", "31 seconds");
        SyncResponse gone = sessions.sync(device.sync(id, token, true, state), "ip");
        assertThat(gone.session().phoneConnected()).isFalse();
        assertThat(gone.nextPollMs()).isEqualTo(5_000);

        // The first press after an idle phone is fresh by nav_age_ms, with no client gap timer.
        sessions.remoteNav(new RemoteNavRequest(remote, 1, 9000L));
        backdateSession(id, "remote_nav_at", "5 seconds");
        SyncResponse after = sessions.sync(device.sync(id, token, true, state), "ip");
        assertThat(after.session().navCounter()).isEqualTo(1);
        assertThat(after.session().navAgeMs()).isBetween(5_000L, 7_000L);

        // remote_seen_at is written at most once per 10 s.
        sql.update("UPDATE panel_session SET remote_seen_at = now() - interval '9 seconds' WHERE id = ?", id);
        String xmin = sessionColumn(id, "xmin");
        sessions.remoteState(new RemoteTokenRequest(remote));
        assertThat(sessionColumn(id, "xmin")).isEqualTo(xmin);
        sql.update("UPDATE panel_session SET remote_seen_at = now() - interval '11 seconds' WHERE id = ?", id);
        sessions.remoteState(new RemoteTokenRequest(remote));
        assertThat(sql.queryForObject("SELECT remote_seen_at > now() - interval '5 seconds' FROM panel_session WHERE id = ?", Boolean.class, id)).isTrue();
    }

    /** T56 at the SQL level, with real threads on one client_seq. */
    @Test
    void oneClientSeqMovesTheCounterOnce() throws Exception {
        Paired device = pairedDevice();
        Signed signed = signIn(device, teacher());
        String remote = signed.approved().remoteToken();
        List<Object> results = race(times(10, () -> sessions.remoteNav(new RemoteNavRequest(remote, 1, 500L))));
        assertThat(results).allMatch(r -> ((RemoteNavResponse) r).accepted());
        assertThat(results.stream().filter(r -> ((RemoteNavResponse) r).duplicate() == null).count()).isEqualTo(1);
        assertThat(sessionColumn(signed.approved().sessionId(), "remote_nav_counter")).isEqualTo("1");

        List<Object> distinct = race(List.of(
                () -> sessions.remoteNav(new RemoteNavRequest(remote, 1, 501L)),
                () -> sessions.remoteNav(new RemoteNavRequest(remote, -1, 502L))));
        assertThat(distinct).allMatch(r -> ((RemoteNavResponse) r).accepted());
        assertThat(sessions.remoteNav(new RemoteNavRequest(remote, 1, 400L)).duplicate()).isTrue();
        assertThat(code(() -> sessions.remoteNav(new RemoteNavRequest(remote, 2, 600L)))).isEqualTo("BAD_REQUEST");
        assertThat(code(() -> sessions.remoteNav(new RemoteNavRequest(remote, 1, null)))).isEqualTo("BAD_REQUEST");
    }

    // --------------------------------------------------------------- admin ---

    @Test
    void roomsThroughRealSql() {
        CustomUserDetails adminPrincipal = as(user(institute, "ADMIN", "ACTIVE"));
        RoomResponse room = admin.createRoom(adminPrincipal, new RoomCreateRequest(institute, "  Lab 1 "));
        assertThat(room.name()).isEqualTo("Lab 1");
        assertThat(code(() -> admin.createRoom(adminPrincipal, new RoomCreateRequest(institute, "LAB 1")))).isEqualTo("ROOM_NAME_TAKEN");
        RoomBulkResponse bulk = admin.createRooms(adminPrincipal, new RoomBulkCreateRequest(institute, List.of("Lab 2", "lab 1", "Lab 3", "LAB 2")));
        assertThat(bulk.created()).extracting(RoomResponse::name).containsExactly("Lab 2", "Lab 3");
        assertThat(bulk.skippedDuplicates()).containsExactly("lab 1", "LAB 2");
        assertThat(code(() -> admin.createRooms(adminPrincipal, new RoomBulkCreateRequest(institute, java.util.Collections.nCopies(201, "x"))))).isEqualTo("BAD_REQUEST");

        assertThat(code(() -> admin.patchRoom(adminPrincipal, room.id(), new RoomPatchRequest("Lab 2", null)))).isEqualTo("ROOM_NAME_TAKEN");
        assertThat(admin.patchRoom(adminPrincipal, room.id(), new RoomPatchRequest("Renamed", null)).name()).isEqualTo("Renamed");

        Paired device = pairedDevice(room.id(), false);
        assertThat(code(() -> admin.patchRoom(adminPrincipal, room.id(), new RoomPatchRequest(null, "ARCHIVED")))).isEqualTo("ROOM_HAS_DEVICE");
        RoomListResponse list = admin.listRooms(adminPrincipal, institute);
        assertThat(list.rooms()).hasSize(3);
        assertThat(list.rooms().stream().filter(r -> r.id().equals(room.id())).findFirst().orElseThrow().deviceId()).isEqualTo(device.id());
        assertThat(list.nextUnpairedRoomId()).isNotNull().isNotEqualTo(room.id());

        String target = list.nextUnpairedRoomId();
        DeviceRowResponse moved = admin.patchDevice(adminPrincipal, device.id(), new DevicePatchRequest(target, null));
        assertThat(moved.room().id()).isEqualTo(target);
        assertThat(admin.patchRoom(adminPrincipal, room.id(), new RoomPatchRequest(null, "ARCHIVED")).status()).isEqualTo("ARCHIVED");
        admin.createRoom(adminPrincipal, new RoomCreateRequest(institute, "Renamed"));
        assertThat(code(() -> admin.patchRoom(adminPrincipal, room.id(), new RoomPatchRequest(null, "ACTIVE")))).as("reactivating hits the name index").isEqualTo("ROOM_NAME_TAKEN");

        String otherInstitute = "it-" + rand();
        CustomUserDetails outsider = as(user(otherInstitute, "ADMIN", "ACTIVE"));
        assertThat(callerCode(() -> admin.patchRoom(outsider, room.id(), new RoomPatchRequest("x", null)))).isEqualTo(403);
        assertThat(callerCode(() -> admin.patchDevice(outsider, device.id(), new DevicePatchRequest(null, true)))).isEqualTo(403);
        assertThat(callerCode(() -> admin.revokeDevice(outsider, device.id()))).isEqualTo(403);
        assertThat(callerCode(() -> admin.listRooms(outsider, institute))).isEqualTo(403);
        assertThat(admin.adminInstitutes(outsider)).extracting(AdminInstituteRow::instituteId).containsExactly(otherInstitute);
    }

    /** A claim holds panel_room:<id> until its device row commits; archiving waits for it and then sees the device. */
    @Test
    void archivingARoomWaitsForAClaimInProgress() throws Exception {
        CustomUserDetails adminPrincipal = as(user(institute, "ADMIN", "ACTIVE"));
        RoomResponse room = admin.createRoom(adminPrincipal, new RoomCreateRequest(institute, "Lab " + rand()));
        Paired device = pairedDevice();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection claim = dataSource.getConnection()) {
            claim.setAutoCommit(false);
            try (Statement statement = claim.createStatement()) {
                statement.execute("SELECT pg_advisory_xact_lock(hashtextextended('panel_room:" + room.id() + "', 0))");
                statement.execute("UPDATE panel_device SET room_id = '" + room.id() + "' WHERE id = '" + device.id() + "'");
            }
            Future<String> archive = pool.submit(() -> code(() -> admin.patchRoom(adminPrincipal, room.id(),
                    new RoomPatchRequest(null, "ARCHIVED"))));
            Thread.sleep(500);
            assertThat(archive.isDone()).as("archive must wait for the claim's lock").isFalse();
            claim.commit();
            assertThat(archive.get(10, TimeUnit.SECONDS)).isEqualTo("ROOM_HAS_DEVICE");
        } finally {
            pool.shutdownNow();
        }
        assertThat(sql.queryForObject("SELECT status FROM classroom_room WHERE id = ?", String.class, room.id())).isEqualTo("ACTIVE");
    }

    private static int callerCode(Runnable call) {
        try {
            call.run();
            return 200;
        } catch (vacademy.io.common.exceptions.VacademyException e) {
            return e.getStatus().value();
        }
    }

    @Test
    void deviceListShowsTheSessionTeacherAndApproverIpAndHidesPastCapSessions() {
        Paired device = pairedDevice();
        CustomUserDetails adminPrincipal = as(user(institute, "ADMIN", "ACTIVE"));
        String teacher = teacher();
        ChallengeResponse challenge = challenge(device);
        ChallengeApprovedResponse approved = (ChallengeApprovedResponse) challenges.approve(as(teacher),
                new ChallengeApproveRequest(tokenOf(challenge), null, challenge.matchCode(), null), "6.6.6.6");
        sessions.sync(new SyncRequest(device.id(), device.secret(), null, null, 3, 67, false, null), "5.5.5.5");
        DeviceRowResponse row = admin.listDevices(adminPrincipal, institute).get(0);
        assertThat(row.online()).isTrue();
        assertThat(row.lastIp()).isEqualTo("5.5.5.5");
        assertThat(row.appVersionCode()).isEqualTo(3);
        assertThat(row.webviewMajor()).isEqualTo(67);
        assertThat(row.currentSession().id()).isEqualTo(approved.sessionId());
        assertThat(row.currentSession().userName()).isEqualTo("Name " + teacher);
        assertThat(row.currentSession().approvedIp()).isEqualTo("6.6.6.6");
        sql.update("UPDATE panel_session SET expires_at = now() - interval '1 second' WHERE id = ?", approved.sessionId());
        assertThat(admin.listDevices(adminPrincipal, institute).get(0).currentSession()).isNull();
        sql.update("UPDATE panel_device SET last_seen_at = now() - interval '7 minutes 1 second' WHERE id = ?", device.id());
        assertThat(admin.listDevices(adminPrincipal, institute).get(0).online()).isFalse();
    }

    @Test
    void aStaleBrandingIsRefreshedWithoutWaitingAndAFailureKeepsTheOldValues() throws Exception {
        Paired device = pairedDevice();
        sql.update("UPDATE panel_device SET branding_synced_at = now() - interval '25 hours', institute_name = 'Old' WHERE id = ?", device.id());
        when(instituteInternalService.getInstituteByInstituteId(anyString())).thenThrow(new RuntimeException("down"));
        String other = "it-" + rand();
        sql.update("UPDATE panel_device SET institute_id = ? WHERE id = ?", other, device.id());
        challenge(device);
        Thread.sleep(300);
        assertThat(sql.queryForObject("SELECT institute_name FROM panel_device WHERE id = ?", String.class, device.id())).isEqualTo("Old");
        org.mockito.Mockito.reset(instituteInternalService);
        InstituteInfoDTO info = new InstituteInfoDTO();
        info.setInstituteName("New Name");
        info.setAdminPortalUrl("new.school.example");
        when(instituteInternalService.getInstituteByInstituteId(other)).thenReturn(info);
        challenge(device);
        for (int i = 0; i < 50 && !"New Name".equals(sql.queryForObject("SELECT institute_name FROM panel_device WHERE id = ?", String.class, device.id())); i++) {
            Thread.sleep(100);
        }
        assertThat(sql.queryForObject("SELECT institute_name FROM panel_device WHERE id = ?", String.class, device.id())).isEqualTo("New Name");
        assertThat(sql.queryForObject("SELECT approve_base_url FROM panel_device WHERE id = ?", String.class, device.id())).isEqualTo("https://new.school.example");
        assertThat(sql.queryForObject("SELECT branding_synced_at > now() - interval '1 minute' FROM panel_device WHERE id = ?", Boolean.class, device.id())).isTrue();
    }
}
