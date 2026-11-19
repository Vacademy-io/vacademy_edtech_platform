package vacademy.io.admin_core_service.core.external;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.common.external.VendorCallLog;

import java.sql.Timestamp;

/**
 * admin-core's {@link VendorCallLog.Sink}: failed third-party calls, its own and those the other
 * Java services post to {@link ExternalCallFailureController}, go into external_api_call_log.
 */
@Component
public class ExternalCallStore implements VendorCallLog.Sink {

    private final JdbcTemplate jdbc;

    public ExternalCallStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void write(VendorCallLog.Failure f) {
        jdbc.update("""
                INSERT INTO external_api_call_log
                    (occurred_at, vendor, source_service, operation, status, http_status, error_message,
                     request_summary, response_summary)
                VALUES (?, ?, ?, ?, 'FAILED', ?, ?, CAST(? AS jsonb), CAST(? AS jsonb))""",
                Timestamp.from(f.at()), f.vendor(), f.sourceService(), f.operation(), f.httpStatus(), f.error(),
                f.request(), f.response());
    }
}
