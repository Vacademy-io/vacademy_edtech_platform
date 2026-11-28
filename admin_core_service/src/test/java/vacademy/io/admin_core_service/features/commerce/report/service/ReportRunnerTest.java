package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportDeadline;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportJdbcTemplate;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The runner: read-only transaction whose first statement is the SET LOCAL timeout, one export
 * per pod (429 REPORT_BUSY), the audit row written after the read in its own write transaction,
 * a statement timeout answered 503 REPORT_TIMEOUT.
 */
class ReportRunnerTest {

    private JdbcOperations jdbc;
    private PlatformTransactionManager txManager;
    private CommerceAuditService audit;
    private ReportRunner runner;
    private final List<String> events = Collections.synchronizedList(new ArrayList<>());
    private final List<TransactionDefinition> definitions = Collections.synchronizedList(new ArrayList<>());

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcOperations.class);
        NamedParameterJdbcTemplate named = mock(NamedParameterJdbcTemplate.class);
        when(named.getJdbcOperations()).thenReturn(jdbc);
        txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenAnswer(inv -> {
            definitions.add(inv.getArgument(0));
            events.add("BEGIN");
            return new SimpleTransactionStatus();
        });
        doAnswer(inv -> events.add("COMMIT")).when(txManager).commit(any());
        doAnswer(inv -> events.add("SQL " + inv.getArgument(0))).when(jdbc).execute(anyString());
        audit = mock(CommerceAuditService.class);
        doAnswer(inv -> events.add("AUDIT")).when(audit).record(anyString(), any(), any(), anyString(), any(),
                any(), any(), any(), any());
        runner = new ReportRunner(named, txManager, audit, 50_000);
    }

    @Test
    void screenReadIsReadOnlyAndSetsTheTimeoutFirst() {
        String result = runner.screen(() -> {
            events.add("BODY");
            return "ok";
        });
        assertEquals("ok", result);
        assertEquals(List.of("BEGIN", "SQL SET LOCAL statement_timeout = '25s'", "BODY", "COMMIT"), events);
        assertTrue(definitions.get(0).isReadOnly());
    }

    @Test
    void exportUsesTheLongTimeoutAndWritesTheAuditRowAfterTheRead() {
        ReportRunner.ExportResult file = runner.export(audit("sales-register"), (out, maxRows) -> {
            events.add("BODY");
            assertEquals(50_000, maxRows);
            out.write("a,b".getBytes(StandardCharsets.UTF_8));
            return 7;
        });
        assertArrayEquals("a,b".getBytes(StandardCharsets.UTF_8), file.bytes());
        assertEquals(7, file.rows());
        assertEquals(List.of("BEGIN", "SQL SET LOCAL statement_timeout = '50s'", "BODY", "COMMIT",
                "BEGIN", "AUDIT", "COMMIT"), events);
        assertTrue(definitions.get(0).isReadOnly());
        assertFalse(definitions.get(1).isReadOnly());
        assertEquals(TransactionDefinition.PROPAGATION_REQUIRES_NEW, definitions.get(1).getPropagationBehavior());

        ArgumentCaptor<String> value = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq("inst-1"), eq("u-1"), eq("loc-1"), eq("REPORT_EXPORTED"), eq("REPORT"),
                eq("sales-register"), isNull(), value.capture(), isNull());
        assertTrue(value.getValue().contains("\"rows\":7"), value.getValue());
        assertTrue(value.getValue().contains("\"format\":\"csv\""), value.getValue());
        assertTrue(value.getValue().contains("\"from\":\"2026-11-01\""), value.getValue());
    }

    @Test
    void aSecondExportWhileOneRunsIsRefusedBusy() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<ReportRunner.ExportResult> first = pool.submit(() -> runner.export(audit("gstr1"), (out, max) -> {
                started.countDown();
                try {
                    assertTrue(release.await(10, TimeUnit.SECONDS));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return 1;
            }));
            assertTrue(started.await(10, TimeUnit.SECONDS));
            VacademyException busy = assertThrows(VacademyException.class,
                    () -> runner.export(audit("gstr1"), (out, max) -> 1));
            assertEquals(HttpStatus.TOO_MANY_REQUESTS, busy.getStatus());
            assertTrue(busy.getMessage().startsWith("REPORT_BUSY:"));
            release.countDown();
            assertEquals(1, first.get(10, TimeUnit.SECONDS).rows());
            // The permit is back: the next export runs.
            assertEquals(2, runner.export(audit("gstr1"), (out, max) -> 2).rows());
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void aFailedExportWritesNoAuditRowAndFreesThePermit() {
        assertThrows(IllegalStateException.class, () -> runner.export(audit("gstr1"), (out, max) -> {
            throw new IllegalStateException("boom");
        }));
        verify(audit, never()).record(anyString(), any(), any(), anyString(), any(), any(), any(), any(), any());
        assertEquals(3, runner.export(audit("gstr1"), (out, max) -> 3).rows());
    }

    @Test
    void aStatementTimeoutAnswersReportTimeout() {
        VacademyException e = assertThrows(VacademyException.class, () -> runner.screen(() -> {
            throw new DataAccessResourceFailureException("cancelled",
                    new SQLException("canceling statement due to statement timeout", "57014"));
        }));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertTrue(e.getMessage().startsWith("REPORT_TIMEOUT:"));
    }

    @Test
    void anotherSqlErrorIsNotATimeoutAndNeverShowsItsSql() {
        VacademyException e = assertThrows(VacademyException.class, () -> runner.screen(() -> {
            throw new org.springframework.jdbc.BadSqlGrammarException("report", "SELECT secret FROM x",
                    new SQLException("syntax error", "42601"));
        }));
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, e.getStatus());
        assertTrue(e.getMessage().startsWith("REPORT_FAILED:"));
        assertFalse(e.getMessage().contains("SELECT"), e.getMessage());
        assertThrows(VacademyException.class, () -> runner.screen(() -> {
            throw new DataAccessResourceFailureException("other", new SQLException("other", "08006"));
        }));
    }

    @Test
    void atMostTheScreenSlotsAtOnceThenReportsBusyWithRetryAfter() throws Exception {
        CountDownLatch inside = new CountDownLatch(ReportRunner.SCREEN_SLOTS);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(ReportRunner.SCREEN_SLOTS);
        try {
            List<Future<String>> held = new ArrayList<>();
            for (int i = 0; i < ReportRunner.SCREEN_SLOTS; i++) {
                held.add(pool.submit(() -> runner.screen(() -> {
                    inside.countDown();
                    try {
                        assertTrue(release.await(20, TimeUnit.SECONDS));
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return "ok";
                })));
            }
            assertTrue(inside.await(10, TimeUnit.SECONDS));
            ReportRunner.ReportBusyException busy = assertThrows(ReportRunner.ReportBusyException.class,
                    () -> runner.screen(() -> "fifth"));
            assertEquals(HttpStatus.TOO_MANY_REQUESTS, busy.getStatus());
            assertTrue(busy.getMessage().startsWith("REPORTS_BUSY:"));
            assertEquals(ReportRunner.RETRY_AFTER_SECONDS, busy.getRetryAfterSeconds());
            release.countDown();
            for (Future<String> f : held) {
                assertEquals("ok", f.get(10, TimeUnit.SECONDS));
            }
            assertEquals("again", runner.screen(() -> "again"), "the slots are back");
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void readsInsideOneRequestShareItsSlotAndDeadline() {
        ReportRunner one = new ReportRunner(named(), txManager, audit, 50_000, 1, 2, 25_000, 50_000);
        String result = one.screenRequest(() -> one.screen(() -> "a") + one.screen(() -> "b"));
        assertEquals("ab", result, "a request of two reads holds one slot");
        assertFalse(ReportDeadline.active(), "the deadline ends with the request");
    }

    @Test
    void theWholeRequestHasOneDeadline() {
        ReportRunner quick = new ReportRunner(named(), txManager, audit, 50_000, 4, 2, 50, 100);
        VacademyException e = assertThrows(VacademyException.class, () -> quick.screenRequest(() -> {
            quick.screen(() -> "first read");
            try {
                Thread.sleep(80);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
            // The next statement would start after the request's 50 ms: refused before the database.
            return quick.screen(() -> ReportDeadline.secondsForNextStatement());
        }));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertTrue(e.getMessage().startsWith("REPORT_TIMEOUT:"));
        assertFalse(ReportDeadline.active());
    }

    @Test
    void everyStatementGetsTheTimeLeftAsItsQueryTimeout() throws Exception {
        ReportJdbcTemplate template = new ReportJdbcTemplate(org.mockito.Mockito.mock(javax.sql.DataSource.class));
        java.sql.Statement statement = org.mockito.Mockito.mock(java.sql.Statement.class);
        java.lang.reflect.Method apply = org.springframework.jdbc.core.JdbcTemplate.class
                .getDeclaredMethod("applyStatementSettings", java.sql.Statement.class);
        apply.setAccessible(true);
        apply.invoke(template, statement);
        verify(statement, never()).setQueryTimeout(org.mockito.ArgumentMatchers.anyInt());
        ReportDeadline.start(7_500);
        try {
            apply.invoke(template, statement);
            verify(statement).setQueryTimeout(8);
            verify(statement, org.mockito.Mockito.atLeastOnce()).setFetchSize(1000);
        } finally {
            ReportDeadline.clear();
        }
    }

    @Test
    void productionLimitsLeaveMostOfTheReadPoolToTheApp() {
        assertEquals(2, ReportRunner.SCREEN_SLOTS);
        assertEquals(1, ReportRunner.EXPORT_SLOTS);
        assertTrue(ReportRunner.SCREEN_SLOTS + ReportRunner.EXPORT_SLOTS <= 3,
                "reports hold at most 3 read connections per pod");
    }

    @Test
    void exportsAreLimitedPerPodAndOnePerInstitute() throws Exception {
        // Two export slots here to show the per-institute rule apart from the pod limit.
        ReportRunner runner = new ReportRunner(named(), txManager, audit, 50_000, 2, 2, 25_000, 50_000);
        CountDownLatch started = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<ReportRunner.ExportResult>> held = new ArrayList<>();
            for (String institute : List.of("inst-1", "inst-2")) {
                held.add(pool.submit(() -> runner.export(audit("gstr1", institute), (out, max) -> {
                    started.countDown();
                    try {
                        assertTrue(release.await(20, TimeUnit.SECONDS));
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return 1;
                })));
            }
            assertTrue(started.await(10, TimeUnit.SECONDS), "two institutes export at once");
            ReportRunner.ReportBusyException same = assertThrows(ReportRunner.ReportBusyException.class,
                    () -> runner.export(audit("sales", "inst-1"), (out, max) -> 1));
            assertTrue(same.getMessage().startsWith("REPORT_BUSY:"));
            assertThrows(ReportRunner.ReportBusyException.class,
                    () -> runner.export(audit("sales", "inst-3"), (out, max) -> 1), "a third export on the pod");
            release.countDown();
            for (Future<ReportRunner.ExportResult> f : held) {
                assertEquals(1, f.get(10, TimeUnit.SECONDS).rows());
            }
            assertEquals(2, runner.export(audit("sales", "inst-3"), (out, max) -> 2).rows());
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private NamedParameterJdbcTemplate named() {
        NamedParameterJdbcTemplate named = mock(NamedParameterJdbcTemplate.class);
        when(named.getJdbcOperations()).thenReturn(jdbc);
        return named;
    }

    private static ReportRunner.ExportAudit audit(String report) {
        return audit(report, "inst-1");
    }

    private static ReportRunner.ExportAudit audit(String report, String institute) {
        return new ReportRunner.ExportAudit(institute, "u-1", "loc-1", report, "2026-11-01", "2026-11-19",
                Map.of("channel", "POS"), "csv");
    }
}
