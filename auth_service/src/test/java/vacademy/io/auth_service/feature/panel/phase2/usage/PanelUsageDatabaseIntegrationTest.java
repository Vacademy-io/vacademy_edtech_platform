package vacademy.io.auth_service.feature.panel.phase2.usage;

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
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.auth_service.feature.demo.repository.InstituteTrialRepository;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ActivityEvent;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageContent;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageSessionRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageSessionsResponse;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The usage SQL and the activity log against a real local Postgres with every migration applied.
 * Rows are seeded with times relative to the database clock. Skipped unless PANEL_TEST_JDBC_URL is
 * set, and refuses anything but a loopback database, like PanelDatabaseIntegrationTest.
 */
@EnabledIfEnvironmentVariable(named = "PANEL_TEST_JDBC_URL", matches = ".+")
@SpringBootTest(classes = PanelUsageDatabaseIntegrationTest.Config.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE,
        properties = { "panel.enabled=true", "panel.usage.enabled=true", "panel.usage.recording-enabled=true",
                "spring.jpa.open-in-view=false", "spring.jpa.hibernate.ddl-auto=none",
                "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=true",
                "spring.flyway.baseline-version=1", "spring.datasource.hikari.maximum-pool-size=5",
                "spring.main.banner-mode=off" })
class PanelUsageDatabaseIntegrationTest {

    @Configuration
    @ImportAutoConfiguration({ DataSourceAutoConfiguration.class, FlywayAutoConfiguration.class,
            HibernateJpaAutoConfiguration.class, JdbcTemplateAutoConfiguration.class,
            TransactionAutoConfiguration.class })
    @EntityScan(basePackages = { "vacademy.io.common.auth.entity", "vacademy.io.auth_service.feature.demo.entity" })
    @EnableJpaRepositories(basePackageClasses = { UserRepository.class, InstituteTrialRepository.class })
    @Import({ PanelRepository.class, PanelUsageRepository.class, PanelUsageService.class,
            PanelActivityRecorder.class, PanelActivityPurgeTask.class, PanelTx.class, PanelProperties.class,
            PanelPhase2Properties.class, InstituteOAuthClientAccessGuard.class })
    static class Config {
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
        // Same prerequisite as PanelDatabaseIntegrationTest: V1 needs two trigger functions.
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

    @Autowired
    JdbcTemplate sql;
    @Autowired
    PanelUsageService usage;
    @Autowired
    PanelActivityRecorder recorder;
    @Autowired
    PanelActivityPurgeTask purge;
    @Autowired
    PanelRepository panels;

    private String institute;
    private CustomUserDetails admin;
    private String from;
    private String to;

    @BeforeEach
    void freshInstitute() {
        institute = "ua-" + rand();
        admin = principal(user(institute, "ADMIN"));
        // UTC dates around the database clock: every seeded row (at most a day old) falls inside.
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        from = today.minusDays(2).toString();
        to = today.plusDays(1).toString();
        usage.clearCache();
    }

    // ---------------------------------------------------------- fixtures ---

    private static String rand() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private static CustomUserDetails principal(String userId) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(userId);
        return user;
    }

    private String roleId(String name) {
        sql.update("INSERT INTO roles (id, role_name) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = ?)",
                "ua-" + rand(), name, name);
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

    private String room(String inst, String name) {
        String id = UUID.randomUUID().toString();
        sql.update("INSERT INTO classroom_room (id, institute_id, name) VALUES (?, ?, ?)", id, inst, name);
        return id;
    }

    private String device(String inst, String roomId) {
        String id = UUID.randomUUID().toString();
        sql.update("INSERT INTO panel_device (id, institute_id, room_id, secret_hash, status, claimed_by, "
                + "last_seen_at, app_version_code) VALUES (?, ?, ?, ?, 'ACTIVE', 'seed', now(), 3)", id, inst, roomId,
                rand() + rand() + rand());
        return id;
    }

    /**
     * A session with times as minutes before the database's now(). Null leaves the column null.
     * status follows ended.
     */
    private String session(String inst, String deviceId, String roomId, String userId, int createdAgo,
            Integer endedAgo, Integer seenAgo, Integer activeUntilAgo, String reason) {
        String id = UUID.randomUUID().toString();
        sql.update("""
                INSERT INTO panel_session (id, device_id, institute_id, room_id, user_id, started_via, refresh_hash,
                    status, created_at, expires_at, ended_at, end_reason, panel_seen_at, active_until)
                VALUES (?, ?, ?, ?, ?, 'QR', ?, ?, now() - ? * interval '1 minute',
                    now() - ? * interval '1 minute' + interval '4 hours',
                    now() - CAST(? AS integer) * interval '1 minute', ?,
                    now() - CAST(? AS integer) * interval '1 minute',
                    now() - CAST(? AS integer) * interval '1 minute')
                """, id, deviceId, inst, roomId, userId, rand() + rand(), endedAgo == null ? "ACTIVE" : "ENDED",
                createdAgo, createdAgo, endedAgo, reason, seenAgo, activeUntilAgo);
        return id;
    }

    private void event(String sessionId, int seq, String kind, String ref, String title, int minutesAfterStart) {
        sql.update("""
                INSERT INTO panel_activity (session_id, device_id, institute_id, room_id, user_id, client_seq, kind,
                    ref_id, title, started_at)
                SELECT s.id, s.device_id, s.institute_id, s.room_id, s.user_id, ?, ?, ?, ?,
                       s.created_at + ? * interval '1 minute'
                FROM panel_session s WHERE s.id = ?
                """, seq, kind, ref, title, minutesAfterStart, sessionId);
    }

    private UsageSessionsResponse drill() {
        return usage.sessions(admin, institute, from, to, "UTC", null, null, 0, 200);
    }

    private Map<String, UsageSessionRow> byId(UsageSessionsResponse response) {
        return response.sessions().stream().collect(Collectors.toMap(UsageSessionRow::id, Function.identity()));
    }

    private static ActivityEvent ev(int seq, String kind, Long atMs) {
        return new ActivityEvent(seq, kind, "ref-" + seq, null, "Title " + seq, atMs);
    }

    private int activityCount(String sessionId) {
        Integer n = sql.queryForObject("SELECT count(*) FROM panel_activity WHERE session_id = ?", Integer.class,
                sessionId);
        return n == null ? 0 : n;
    }

    // ---------------------------------------------------- hour arithmetic ---

    @Test
    void effectiveEndForSignOutAbandonedIdleAndUnredeemedSessions() {
        String roomA = room(institute, "5A");
        String dev = device(institute, roomA);
        String teacher = user(institute, "TEACHER");
        String signOut = session(institute, dev, roomA, teacher, 180, 120, 120, null, "SIGN_OUT");
        // Ended an hour ago by whoever looked next, but the panel was last seen 30 minutes in.
        String abandoned = session(institute, dev, roomA, teacher, 300, 60, 270, null, "EXPIRED");
        String idle = session(institute, dev, roomA, teacher, 90, 10, 10, 41, "IDLE");
        session(institute, dev, roomA, teacher, 100, 95, null, null, "UNBOUND");
        String otherInst = "ua-" + rand();
        String otherRoom = room(otherInst, "X");
        session(otherInst, device(otherInst, otherRoom), otherRoom, teacher, 50, 20, 20, null, "SIGN_OUT");

        Map<String, UsageSessionRow> rows = byId(drill());
        assertThat(rows).containsOnlyKeys(signOut, abandoned, idle);
        assertThat(rows.get(signOut).minutes()).isEqualTo(60);
        assertThat(rows.get(abandoned).minutes()).isEqualTo(32); // 30 min + 90 s, rounded
        assertThat(rows.get(idle).minutes()).isEqualTo(49);
        assertThat(rows.get(idle).endReason()).isEqualTo("IDLE");

        UsageResponse report = usage.usage(admin, institute, from, to, "UTC");
        assertThat(report.totals().sessions()).isEqualTo(3);
        assertThat(report.totals().teachers()).isEqualTo(1);
        assertThat(report.totals().panelHours()).isEqualTo(2.3); // 140.5 minutes
        assertThat(report.totals().roomsUsed()).isEqualTo(1);
        assertThat(report.totals().roomsWithPanel()).isEqualTo(1);
        assertThat(report.totals().idleRooms()).isZero();
        assertThat(report.totals().coveragePct()).isZero();
        assertThat(report.byTeacher()).singleElement().satisfies(t -> {
            assertThat(t.user().id()).isEqualTo(teacher);
            assertThat(t.user().name()).isEqualTo("Name " + teacher);
        });
        assertThat(report.byRoom()).singleElement().satisfies(r -> assertThat(r.room().name()).isEqualTo("5A"));
    }

    @Test
    void idleEndWritesActiveUntilAndTheReportStopsThere() {
        String roomA = room(institute, "7C");
        String dev = device(institute, roomA);
        String teacher = user(institute, "TEACHER");
        String open = session(institute, dev, roomA, teacher, 120, null, 0, null, null);
        assertThat(byId(drill()).get(open).minutes()).isEqualTo(120);

        panels.endSessionWithActiveUntil(open, "IDLE", null, 31 * 60);
        usage.clearCache();
        UsageSessionRow row = byId(drill()).get(open);
        assertThat(row.minutes()).isEqualTo(89);
        assertThat(row.endReason()).isEqualTo("IDLE");
    }

    @Test
    void openSessionOfAPanelThatWentDarkStopsCountingNinetySecondsAfterItWasSeen() {
        String roomA = room(institute, "Lab");
        String dev = device(institute, roomA);
        String open = session(institute, dev, roomA, user(institute, "TEACHER"), 60, null, 45, null, null);
        assertThat(byId(drill()).get(open).minutes()).isEqualTo(17); // 15 min + 90 s
    }

    @Test
    void idleRoomsAndRoomsWithoutAnApprovedPanel() {
        String used = room(institute, "Used");
        String idle = room(institute, "Idle");
        String pending = room(institute, "Pending");
        String devUsed = device(institute, used);
        String devIdle = device(institute, idle);
        String devPending = device(institute, pending);
        sql.update("UPDATE panel_device SET approval_state = 'PENDING' WHERE id = ?", devPending);
        String teacher = user(institute, "TEACHER");
        session(institute, devUsed, used, teacher, 60, 30, 30, null, "SIGN_OUT");
        // An old session of the idle panel, before the window.
        sql.update("""
                INSERT INTO panel_session (id, device_id, institute_id, room_id, user_id, started_via, status,
                    created_at, expires_at, ended_at, end_reason, panel_seen_at)
                VALUES (?, ?, ?, ?, ?, 'QR', 'ENDED', now() - interval '20 days', now() - interval '20 days',
                    now() - interval '20 days', 'SIGN_OUT', now() - interval '20 days')
                """, UUID.randomUUID().toString(), devIdle, institute, idle, teacher);

        UsageResponse report = usage.usage(admin, institute, from, to, "UTC");
        assertThat(report.totals().roomsWithPanel()).isEqualTo(2);
        assertThat(report.totals().idleRooms()).isEqualTo(1);
        assertThat(report.idleRooms()).singleElement().satisfies(r -> {
            assertThat(r.room().id()).isEqualTo(idle);
            assertThat(r.deviceId()).isEqualTo(devIdle);
            assertThat(r.lastUsedAt()).isNotNull();
            assertThat(r.online()).isTrue();
        });
    }

    // ------------------------------------------------------------ content ---

    @Test
    void contentSqlAgreesWithTheJavaRule() {
        String roomA = room(institute, "9B");
        String dev = device(institute, roomA);
        String teacher = user(institute, "TEACHER");
        String s1 = session(institute, dev, roomA, teacher, 180, 120, 120, null, "SIGN_OUT"); // 60 min
        event(s1, 1, "LESSON", "slide-1", "Leaves", 0);
        event(s1, 2, "HOME", null, null, 10);
        event(s1, 3, "DECK", "deck-1", "Old title", 15);
        event(s1, 4, "WHITEBOARD", null, null, 50);
        String s2 = session(institute, dev, roomA, teacher, 100, 40, 40, null, "CLASS_END"); // 60 min
        event(s2, 1, "CLASS", "sch-1", "Maths", 0);
        event(s2, 2, "DECK", "deck-1", "New title", 5);
        // The last event runs to the session's effective end.
        event(s2, 3, "LESSON", "slide-1", "Leaves", 55);

        UsageResponse report = usage.usage(admin, institute, from, to, "UTC");
        Map<String, UsageContent> content = report.content().stream()
                .collect(Collectors.toMap(c -> c.kind() + ":" + c.refId(), Function.identity()));
        assertThat(content.get("DECK:deck-1").minutes()).isEqualTo(35 + 50);
        assertThat(content.get("DECK:deck-1").sessions()).isEqualTo(2);
        assertThat(content.get("DECK:deck-1").title()).isEqualTo("New title");
        assertThat(content.get("LESSON:slide-1").minutes()).isEqualTo(10 + 5);
        assertThat(content.get("WHITEBOARD:null").minutes()).isEqualTo(10);
        assertThat(content.get("CLASS:sch-1").minutes()).isEqualTo(5);
        assertThat(content).doesNotContainKey("HOME:null");
        assertThat(report.totals().classesStarted()).isEqualTo(1);
        assertThat(report.totals().coveragePct()).isEqualTo(100);
        assertThat(report.notes().contentRecordedFrom()).isNotNull();

        // The drill-down computes the same durations in Java.
        Map<String, UsageSessionRow> rows = byId(drill());
        int javaDeck = rows.values().stream().flatMap(r -> r.events().stream())
                .filter(e -> "DECK".equals(e.kind())).mapToInt(e -> e.minutes()).sum();
        assertThat(javaDeck).isEqualTo(content.get("DECK:deck-1").minutes());
        assertThat(rows.get(s1).events()).extracting(e -> e.kind()).containsExactly("LESSON", "DECK", "WHITEBOARD");
        assertThat(rows.get(s1).events()).extracting(e -> e.minutes()).containsExactly(10, 35, 10);
    }

    // ------------------------------------------------------------- ingest ---

    @Test
    void ingestIsIdempotentAcksTheLargestSeqAndClampsTimes() {
        String roomA = room(institute, "1A");
        String dev = device(institute, roomA);
        String s = session(institute, dev, roomA, user(institute, "TEACHER"), 30, null, 0, null, null);
        DeviceRow device = panels.findDevice(dev).orElseThrow();
        SessionRow session = panels.findSession(s).orElseThrow();

        List<ActivityEvent> events = List.of(ev(1, "LESSON", 1L), ev(2, "DECK", null), ev(3, "HOME",
                System.currentTimeMillis() + 86_400_000L), ev(7, "BOGUS", null));
        assertThat(recorder.ingestSync(device, session, events)).isEqualTo(7);
        assertThat(recorder.ingestSync(device, session, events)).isEqualTo(7);
        assertThat(activityCount(s)).isEqualTo(3);

        Boolean clampedLow = sql.queryForObject("SELECT a.started_at = s.created_at FROM panel_activity a "
                + "JOIN panel_session s ON s.id = a.session_id WHERE a.session_id = ? AND a.client_seq = 1",
                Boolean.class, s);
        Boolean clampedHigh = sql.queryForObject("SELECT started_at <= now() FROM panel_activity "
                + "WHERE session_id = ? AND client_seq = 3", Boolean.class, s);
        assertThat(clampedLow).isTrue();
        assertThat(clampedHigh).isTrue();
        String row = sql.queryForObject("SELECT institute_id || '|' || room_id || '|' || device_id FROM panel_activity "
                + "WHERE session_id = ? AND client_seq = 2", String.class, s);
        assertThat(row).isEqualTo(institute + "|" + roomA + "|" + dev);
    }

    @Test
    void aSessionKeepsAtMostOneHundredEvents() {
        String roomA = room(institute, "1B");
        String dev = device(institute, roomA);
        String s = session(institute, dev, roomA, user(institute, "TEACHER"), 30, null, 0, null, null);
        DeviceRow device = panels.findDevice(dev).orElseThrow();
        SessionRow session = panels.findSession(s).orElseThrow();
        for (int batch = 0; batch < 6; batch++) {
            int first = batch * 20 + 1;
            List<ActivityEvent> events = IntStream.range(first, first + 20).mapToObj(i -> ev(i, "DECK", null)).toList();
            assertThat(recorder.ingestSync(device, session, events)).isEqualTo(first + 19);
        }
        assertThat(activityCount(s)).isEqualTo(100);
    }

    @Test
    void endTakesEventsOnlyForThisDevicesSessionWhileRecentlyEnded() {
        String roomA = room(institute, "1C");
        String dev = device(institute, roomA);
        String other = device(institute, room(institute, "1D"));
        String teacher = user(institute, "TEACHER");
        String recent = session(institute, dev, roomA, teacher, 60, 5, 5, null, "SIGN_OUT");
        String old = session(institute, dev, roomA, teacher, 90, 30, 30, null, "SIGN_OUT");
        DeviceRow device = panels.findDevice(dev).orElseThrow();

        recorder.ingestEnd(device, panels.findSession(recent).orElseThrow(), List.of(ev(1, "LESSON", null)));
        recorder.ingestEnd(device, panels.findSession(old).orElseThrow(), List.of(ev(1, "LESSON", null)));
        assertThat(activityCount(recent)).isEqualTo(1);
        assertThat(activityCount(old)).isZero();

        // A session row of this device presented with another device's credentials stores nothing.
        DeviceRow otherDevice = panels.findDevice(other).orElseThrow();
        SessionRow recentRow = panels.findSession(recent).orElseThrow();
        SessionRow forged = new SessionRow(recentRow.id(), other, recentRow.instituteId(), recentRow.userId(),
                recentRow.startedVia(), recentRow.refreshHash(), recentRow.status(), recentRow.expiresAt(),
                recentRow.createdAt(), recentRow.lastRefreshedAt(), recentRow.endReason(), 0, 0, null, null,
                recentRow.panelSeenAt(), null, null, null, recentRow.dbNow());
        recorder.ingestEnd(otherDevice, forged, List.of(ev(2, "LESSON", null)));
        assertThat(activityCount(recent)).isEqualTo(1);
    }

    @Test
    void purgeRemovesOnlyEventsPastRetention() {
        String roomA = room(institute, "P1");
        String dev = device(institute, roomA);
        String s = session(institute, dev, roomA, user(institute, "TEACHER"), 30, null, 0, null, null);
        for (int i = 1; i <= 4; i++) {
            event(s, i, "DECK", "d" + i, null, i);
        }
        sql.update("UPDATE panel_activity SET created_at = now() - interval '181 days' "
                + "WHERE session_id = ? AND client_seq IN (1, 2)", s);
        int deleted = 0;
        for (int round = 0; round < 50; round++) {
            int n = purge.purge(500);
            deleted += n;
            if (n < 500) {
                break;
            }
        }
        assertThat(deleted).isGreaterThanOrEqualTo(2);
        assertThat(sql.queryForList("SELECT client_seq FROM panel_activity WHERE session_id = ? ORDER BY 1",
                Integer.class, s)).containsExactly(3, 4);
    }

    // --------------------------------------------------- tenant isolation ---

    @Test
    void anAdminOfOneInstituteReadsNothingOfAnother() {
        String otherInst = "ua-" + rand();
        String otherRoom = room(otherInst, "Theirs");
        String otherDev = device(otherInst, otherRoom);
        String theirTeacher = user(otherInst, "TEACHER");
        session(otherInst, otherDev, otherRoom, theirTeacher, 60, 30, 30, null, "SIGN_OUT");

        assertThatThrownBy(() -> usage.usage(admin, otherInst, from, to, "UTC"))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> usage.sessions(admin, otherInst, from, to, "UTC", null, null, 0, 50))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> usage.multi(admin, institute + "," + otherInst, from, to, "UTC"))
                .isInstanceOf(VacademyException.class);
        // Their room and teacher ids as filters on my institute find nothing of theirs.
        assertThat(usage.sessions(admin, institute, from, to, "UTC", otherRoom, null, 0, 50).total()).isZero();
        assertThat(usage.sessions(admin, institute, from, to, "UTC", null, theirTeacher, 0, 50).total()).isZero();
        // A teacher of my institute is not an admin of it.
        CustomUserDetails teacher = principal(user(institute, "TEACHER"));
        assertThatThrownBy(() -> usage.usage(teacher, institute, from, to, "UTC"))
                .isInstanceOf(VacademyException.class);
        assertThat(usage.multi(admin, institute, from, to, "UTC")).singleElement()
                .satisfies(r -> assertThat(r.instituteId()).isEqualTo(institute));
    }

    @Test
    void theReportStatementLimitEndsWithItsTransaction() {
        for (int i = 0; i < 6; i++) {
            usage.clearCache();
            usage.usage(admin, institute, from, to, "UTC");
            usage.sessions(admin, institute, from, to, "UTC", null, null, 0, 10);
        }
        // The pool is small, so these reads reuse the report's connections.
        for (int i = 0; i < 6; i++) {
            assertThat(sql.queryForObject("SHOW statement_timeout", String.class)).isEqualTo("0");
        }
    }

    // ----------------------------------------------------------- internal ---

    @Test
    void internalListingAndHasPanels() {
        assertThat(usage.hasPanels(institute).hasPanels()).isFalse();
        String roomA = room(institute, "I1");
        device(institute, roomA);
        assertThat(usage.hasPanels(institute).hasPanels()).isTrue();

        boolean found = false;
        for (int page = 0; page < 100 && !found; page++) {
            var response = usage.institutes(page);
            found = response.institutes().stream().anyMatch(r -> r.instituteId().equals(institute)
                    && r.roomsWithPanel() == 1 && r.devices() == 1 && r.firstPairedAt() != null);
            if (!response.hasMore()) {
                break;
            }
        }
        assertThat(found).isTrue();

        UsageResponse summary = usage.summary(institute, from, to, "UTC");
        assertThat(summary.idleRooms()).hasSize(1);
    }
}
