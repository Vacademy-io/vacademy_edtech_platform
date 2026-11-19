package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;

/**
 * Runs every report read (contract section 3.6).
 *
 * <ul>
 *   <li>One read-only transaction, so the routing data source takes the replica. Its first
 *       statement is {@code SET LOCAL statement_timeout} (25 s on screen, 50 s for an export):
 *       transaction-scoped, so it never outlives the transaction on a pooled connection. No
 *       session setting is ever changed.</li>
 *   <li>A statement cancelled by that timeout answers 503 {@code REPORT_TIMEOUT}.</li>
 *   <li>One export at a time per pod: a second one answers 429 {@code REPORT_BUSY}.</li>
 *   <li>An export writes one {@code commerce_audit} row (kind {@code REPORT_EXPORTED}) in its own
 *       short write transaction after the read.</li>
 * </ul>
 */
@Component
public class ReportRunner {

    public static final String SCREEN_TIMEOUT = "SET LOCAL statement_timeout = '25s'";
    public static final String EXPORT_TIMEOUT = "SET LOCAL statement_timeout = '50s'";
    public static final String AUDIT_KIND = "REPORT_EXPORTED";
    public static final String AUDIT_REFERENCE_TYPE = "REPORT";
    /** PostgreSQL's code for a statement cancelled by statement_timeout. */
    static final String QUERY_CANCELED = "57014";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final JdbcOperations jdbc;
    private final TransactionTemplate readOnlyTx;
    private final TransactionTemplate writeTx;
    private final CommerceAuditService auditService;
    private final int maxExportRows;
    private final Semaphore exports = new Semaphore(1);

    public ReportRunner(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                        CommerceAuditService auditService,
                        @Value("${commerce.reports.export-max-rows:50000}") int maxExportRows) {
        this.jdbc = jdbc.getJdbcOperations();
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.writeTx = new TransactionTemplate(transactionManager);
        this.writeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.auditService = auditService;
        this.maxExportRows = maxExportRows;
    }

    /** The row cap of an export. */
    public int maxExportRows() {
        return maxExportRows;
    }

    /** A screen read: read-only transaction, 25 s statement timeout. */
    public <T> T screen(Supplier<T> body) {
        return read(SCREEN_TIMEOUT, body);
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
     * An export: one at a time per pod, read-only transaction with the 50 s timeout, the file built
     * in memory (so a refusal such as {@code EXPORT_TOO_LARGE} is still a clean 400), then the audit
     * row in its own write transaction.
     */
    public ExportResult export(ExportAudit audit, ExportBody body) {
        if (!exports.tryAcquire()) {
            throw new VacademyException(HttpStatus.TOO_MANY_REQUESTS,
                    "REPORT_BUSY: another export is running; try again in a minute");
        }
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
            exports.release();
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

    /** True when a cause in the chain is PostgreSQL's "canceling statement due to statement timeout". */
    static boolean isStatementTimeout(Throwable error) {
        Throwable cause = error;
        int depth = 0;
        while (cause != null && depth++ < 20) {
            if (cause instanceof SQLException sql && QUERY_CANCELED.equals(sql.getSQLState())) {
                return true;
            }
            if (cause instanceof org.springframework.dao.QueryTimeoutException) {
                return true;
            }
            cause = cause.getCause();
        }
        return false;
    }
}
