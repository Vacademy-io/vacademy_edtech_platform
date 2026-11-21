package vacademy.io.admin_core_service.features.classroom.notify;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * The claim SQL and the V655 table against a real PostgreSQL.
 *
 * Runs only when {@code CLASSROOM_TEST_JDBC_URL} points at a database on this
 * machine (127.0.0.1 or localhost); otherwise it is skipped. It drops and
 * recreates {@code classroom_notice_log} in that database, so never point it at
 * anything shared.
 */
class JdbcClassroomNoticeLogDbTest {

    private JdbcTemplate jdbc;
    private JdbcClassroomNoticeLog log;

    @BeforeEach
    void setUp() throws Exception {
        String url = System.getenv("CLASSROOM_TEST_JDBC_URL");
        assumeTrue(url != null && (url.startsWith("jdbc:postgresql://127.0.0.1:")
                || url.startsWith("jdbc:postgresql://localhost:")), "no local test database");
        String user = System.getenv().getOrDefault("CLASSROOM_TEST_DB_USER", "postgres");
        DriverManagerDataSource ds = new DriverManagerDataSource(url, user, System.getenv("CLASSROOM_TEST_DB_PASSWORD"));
        ds.setDriverClassName("org.postgresql.Driver");
        jdbc = new JdbcTemplate(ds);

        jdbc.execute("DROP TABLE IF EXISTS public.classroom_notice_log");
        try (InputStream in = getClass().getClassLoader()
                .getResourceAsStream("db/migration/V655__classroom_notice_log.sql")) {
            assertNotNull(in, "migration file on the classpath");
            jdbc.execute(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
        log = new JdbcClassroomNoticeLog(jdbc);
    }

    @Test
    void aSecondClaimOfTheSameIncidentIsRefused() {
        String first = log.claim("inst", "OFFLINE", "dev-1", "1762500000");
        assertNotNull(first);
        assertNull(log.claim("inst", "OFFLINE", "dev-1", "1762500000"));
        // Any part of the key differing is a new incident.
        assertNotNull(log.claim("inst", "OFFLINE", "dev-1", "1762600000"));
        assertNotNull(log.claim("inst", "UPDATE_REQUIRED", "dev-1", "1762500000"));
        assertNotNull(log.claim("other", "OFFLINE", "dev-1", "1762500000"));
        assertEquals(4, jdbc.queryForObject("SELECT count(*) FROM classroom_notice_log", Integer.class));
    }

    @Test
    void overlongValuesAreCutAndStillDeduped() {
        String longKey = "k".repeat(300);
        assertNotNull(log.claim("inst", "LICENCE_ENDING_AND_MORE_TEXT", "s".repeat(100), longKey));
        assertNull(log.claim("inst", "LICENCE_ENDING_AND_MORE_TEXT", "s".repeat(100), longKey + "x"));
    }

    @Test
    void markSentRecordsTheOutcome() {
        String a = log.claim("inst", "OFFLINE", "dev-1", "1");
        String b = log.claim("inst", "OFFLINE", "dev-2", "1");
        assertNull(jdbc.queryForObject("SELECT sent_ok FROM classroom_notice_log WHERE id = ?", Boolean.class, a));
        log.markSent(List.of(a, b), false);
        assertEquals(Boolean.FALSE,
                jdbc.queryForObject("SELECT sent_ok FROM classroom_notice_log WHERE id = ?", Boolean.class, b));
        log.markSent(List.of(a), true);
        assertEquals(Boolean.TRUE,
                jdbc.queryForObject("SELECT sent_ok FROM classroom_notice_log WHERE id = ?", Boolean.class, a));
    }

    @Test
    void isClaimedReadsAndReleaseLetsAClaimHappenAgain() {
        assertFalse(log.isClaimed("inst", "ALERT_DAY", "day", "2026-11-09"));
        String day = log.claim("inst", "ALERT_DAY", "day", "2026-11-09");
        String incident = log.claim("inst", "OFFLINE", "dev-9", "7");
        assertTrue(log.isClaimed("inst", "ALERT_DAY", "day", "2026-11-09"));
        assertFalse(log.isClaimed("other", "ALERT_DAY", "day", "2026-11-09"));
        log.release(List.of(incident));
        assertFalse(log.isClaimed("inst", "OFFLINE", "dev-9", "7"));
        assertNotNull(log.claim("inst", "OFFLINE", "dev-9", "7"));
        assertTrue(log.isClaimed("inst", "ALERT_DAY", "day", "2026-11-09"));
        assertNotNull(day);
    }

    @Test
    void concurrentClaimsLetExactlyOneThrough() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            Callable<String> claim = () -> log.claim("inst", "OFFLINE", "dev-race", "same");
            List<Future<String>> results = pool.invokeAll(java.util.Collections.nCopies(8, claim));
            long winners = 0;
            for (Future<String> f : results) if (f.get() != null) winners++;
            assertEquals(1, winners);
        } finally {
            pool.shutdownNow();
        }
    }
}
