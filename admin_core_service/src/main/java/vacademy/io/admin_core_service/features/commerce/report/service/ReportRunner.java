package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportDeadline;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * Runs every report read (contract section 3.6).
 *
 * <ul>
 *   <li>One read-only transaction per read, so the routing data source takes the replica. Its
 *       first statement is {@code SET LOCAL statement_timeout} (25 s on screen, 50 s for an
 *       export): transaction-scoped, so it never outlives the transaction on a pooled connection
 *       (PgBouncer transaction mode). No session setting is ever changed.</li>
 *   <li>The 25 s / 50 s also bound the whole request: a {@link ReportDeadline} starts with the
 *       request and every later statement gets only the time left (a report of many statements
 *       cannot hold a connection many times over). Time up, or a statement cancelled: 503
 *       {@code REPORT_TIMEOUT}.</li>
 *   <li>Load: at most {@value #SCREEN_SLOTS} screen requests at once per pod (else 429
 *       {@code REPORTS_BUSY} with {@code Retry-After}); at most {@value #EXPORT_SLOTS} exports at
 *       once per pod and one per institute (else 429 {@code REPORT_BUSY}). That is at most 3 report
 *       connections per pod, so reports never take most of the read pool, which is shared with the
 *       rest of the app (and, behind PgBouncer, with the other pods).</li>
 *   <li>Any other database error answers 500 {@code REPORT_FAILED} (logged here); the SQL text
 *       never reaches the client.</li>
 *   <li>An export writes one {@code commerce_audit} row (kind {@code REPORT_EXPORTED}) in its own
 *       short write transaction after the read.</li>
 * </ul>
 */
@Slf4j
@Component
public class ReportRunner {

    public static final String SCREEN_TIMEOUT = "SET LOCAL statement_timeout = '25s'";
    public static final String EXPORT_TIMEOUT = "SET LOCAL statement_timeout = '50s'";
    public static final long SCREEN_MILLIS = 25_000;
    public static final long EXPORT_MILLIS = 50_000;
    public static final String AUDIT_KIND = "REPORT_EXPORTED";
    public static final String AUDIT_REFERENCE_TYPE = "REPORT";
    /** Screen requests at once per pod. */
    public static final int SCREEN_SLOTS = 2;
    /** Exports at once per pod (and one per institute). */
    public static final int EXPORT_SLOTS = 1;
    /** How long a screen request waits for a slot before it is told to come back. */
    static final long SCREEN_WAIT_MILLIS = 2_000;
    /** Seconds a refused request is told to wait ({@code Retry-After}). */
    public static final int RETRY_AFTER_SECONDS = 5;
    /** PostgreSQL's code for a cancelled statement (statement_timeout or the query timeout). */
    static final String QUERY_CANCELED = "57014";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final JdbcOperations jdbc;
    private final TransactionTemplate readOnlyTx;
    private final TransactionTemplate writeTx;
    private final CommerceAuditService auditService;
    private final int maxExportRows;
    private final Semaphore screens;
    private final Semaphore exports;
    private final Set<String> exportingInstitutes = ConcurrentHashMap.newKeySet();
    private final long screenMillis;
    private final long exportMillis;

    @Autowired
    public ReportRunner(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                        CommerceAuditService auditService,
                        @Value("${commerce.reports.export-max-rows:50000}") int maxExportRows) {
        this(jdbc, transactionManager, auditService, maxExportRows, SCREEN_SLOTS, EXPORT_SLOTS, SCREEN_MILLIS,
                EXPORT_MILLIS);
    }

    /** As the bean, with the slots and time limits named (tests). */
    public ReportRunner(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                        CommerceAuditService auditService, int maxExportRows, int screenSlots, int exportSlots,
                        long screenMillis, long exportMillis) {
        this.jdbc = jdbc.getJdbcOperations();
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.writeTx = new TransactionTemplate(transactionManager);
        this.writeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.auditService = auditService;
        this.maxExportRows = maxExportRows;
        this.screens = new Semaphore(screenSlots);
        this.exports = new Semaphore(exportSlots);
        this.screenMillis = screenMillis;
        this.exportMillis = exportMillis;
    }

    /** The row cap of an export. */
    public int maxExportRows() {
        return maxExportRows;
    }

    /**
     * A whole screen request: one of the pod's screen slots and one deadline for everything it
     * reads (several reads, and the staff names between them). A read inside it ({@link #screen})
     * takes no second slot.
     */
    public <T> T screenRequest(Supplier<T> body) {
        if (ReportDeadline.active()) {
            return body.get();
        }
        boolean got;
        try {
            got = screens.tryAcquire(SCREEN_WAIT_MILLIS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            got = false;
        }
        if (!got) {
            throw new ReportBusyException("REPORTS_BUSY: many reports are being read right now; try again in "
                    + RETRY_AFTER_SECONDS + " seconds", RETRY_AFTER_SECONDS);
        }
        ReportDeadline.start(screenMillis);
        try {
            return body.get();
        } finally {
            ReportDeadline.clear();
            screens.release();
        }
    }

    /** A screen read: read-only transaction, 25 s statement timeout; inside a request when one runs. */
    public <T> T screen(Supplier<T> body) {
        return screenRequest(() -> read(SCREEN_TIMEOUT, body));
    }

    /** What an export writes: its rows into {@code out}, at most {@code maxRows}; returns the row count. */
    @FunctionalInterface
    public interface ExportBody {
        int write(OutputStream out, int maxRows) throws IOException;
    }

    /** What the audit row of an export records. */
    public record ExportAudit(String instituteId, String actorUserId, String locationId, String report,
                              String from, String to, Map<String, Object> filters, String format) {
    }

    /** The file and its row count. */
    public record ExportResult(byte[] bytes, int rows) {
    }

    /**
     * An export: at most {@value #EXPORT_SLOTS} per pod and one per institute at a time; one
     * deadline of 50 s; read-only transaction with the 50 s statement timeout; the file built in
     * memory (so a refusal such as {@code EXPORT_TOO_LARGE} is still a clean 400), then the audit
     * row in its own write transaction.
     */
    public ExportResult export(ExportAudit audit, ExportBody body) {
        String institute = audit.instituteId() == null ? "" : audit.instituteId();
        if (!exportingInstitutes.add(institute)) {
            throw new ReportBusyException("REPORT_BUSY: another export of this institute is running; try again "
                    + "in a minute", 60);
        }
        if (!exports.tryAcquire()) {
            exportingInstitutes.remove(institute);
            throw new ReportBusyException("REPORT_BUSY: another export is running; try again in a minute", 60);
        }
        boolean ownDeadline = ReportDeadline.start(exportMillis);
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(64 * 1024);
            int rows = read(EXPORT_TIMEOUT, () -> {
                try {
                    return body.write(buffer, maxExportRows);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
            recordExport(audit, rows);
            return new ExportResult(buffer.toByteArray(), rows);
        } finally {
            if (ownDeadline) {
                ReportDeadline.clear();
            }
            exports.release();
            exportingInstitutes.remove(institute);
        }
    }

    private <T> T read(String timeout, Supplier<T> body) {
        try {
            return readOnlyTx.execute(status -> {
                jdbc.execute(timeout);
                return body.get();
            });
        } catch (RuntimeException e) {
            if (isStatementTimeout(e)) {
                throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                        "REPORT_TIMEOUT: This range takes too long; narrow the dates");
            }
            if (e instanceof DataAccessException) {
                log.error("Report read failed", e);
                throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "REPORT_FAILED: the report could not be read; try again");
            }
            throw e;
        }
    }

    private void recordExport(ExportAudit audit, int rows) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("from", audit.from());
        value.put("to", audit.to());
        value.put("filters", audit.filters());
        value.put("format", audit.format());
        value.put("rows", rows);
        String json;
        try {
            json = JSON.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("report export audit value", e);
        }
        writeTx.executeWithoutResult(status -> auditService.record(audit.instituteId(), audit.actorUserId(),
                audit.locationId(), AUDIT_KIND, AUDIT_REFERENCE_TYPE, audit.report(), null, json, null));
    }

    /**
     * True when a cause in the chain is PostgreSQL's "canceling statement" (statement_timeout or
     * the query timeout), a query timeout, or the request's deadline.
     */
    static boolean isStatementTimeout(Throwable error) {
        Throwable cause = error;
        int depth = 0;
        while (cause != null && depth++ < 20) {
            if (cause instanceof SQLException sql && QUERY_CANCELED.equals(sql.getSQLState())) {
                return true;
            }
            if (cause instanceof org.springframework.dao.QueryTimeoutException
                    || cause instanceof TransactionTimedOutException) {
                return true;
            }
            cause = cause.getCause();
        }
        return false;
    }

    /** 429 with the seconds to wait; the controllers add the {@code Retry-After} header. */
    public static class ReportBusyException extends VacademyException {
        private final int retryAfterSeconds;

        public ReportBusyException(String message, int retryAfterSeconds) {
            super(HttpStatus.TOO_MANY_REQUESTS, message);
            this.retryAfterSeconds = retryAfterSeconds;
        }

        public int getRetryAfterSeconds() {
            return retryAfterSeconds;
        }
    }
}
