package vacademy.io.admin_core_service.features.commerce.report.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner.ReportBusyException;
import vacademy.io.common.core.exception.ErrorInfo;

import java.util.Date;

/**
 * A report refused for load (429 {@code REPORTS_BUSY} / {@code REPORT_BUSY}) answers with the same
 * body as every other refusal and a {@code Retry-After} header (seconds), which the CORS setup
 * already exposes to the screens. Only for the report and audit controllers; ahead of the global
 * handler.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = {CommerceReportController.class, CommerceAuditController.class})
public class ReportBusyAdvice {

    @ExceptionHandler(ReportBusyException.class)
    public ResponseEntity<ErrorInfo> busy(HttpServletRequest req, ReportBusyException ex) {
        return ResponseEntity.status(ex.getStatus())
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(ex.getRetryAfterSeconds()))
                .body(new ErrorInfo(req.getRequestURL().toString(), ex.getMessage(), String.valueOf(ex.getStatus()),
                        new Date()));
    }
}
