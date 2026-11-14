package vacademy.io.auth_service.feature.panel.controller;

import jakarta.servlet.ServletException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.logging.SentryLogger;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Gives every panel endpoint the {code, message} body clients switch on. Ordered ahead of the shared
 * handler and limited to these controllers, so nothing else in the service changes. VacademyException
 * is mapped here because the reused guards throw it.
 */
@RestControllerAdvice(basePackageClasses = PanelPublicController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class PanelExceptionAdvice {

    private static final Logger log = LoggerFactory.getLogger(PanelExceptionAdvice.class);

    @ExceptionHandler(PanelApiException.class)
    public ResponseEntity<Map<String, Object>> panel(PanelApiException e) {
        Map<String, Object> body = body(e.getCode(), e.getReason());
        body.putAll(e.getExtras());
        return ResponseEntity.status(e.getHttpStatus()).body(body);
    }

    @ExceptionHandler(VacademyException.class)
    public ResponseEntity<Map<String, Object>> vacademy(VacademyException e) {
        HttpStatusCode status = e.getStatus();
        String code;
        if (status.value() == HttpStatus.FORBIDDEN.value()) {
            code = "FORBIDDEN";
        } else if (status.value() == HttpStatus.UNAUTHORIZED.value()) {
            code = "UNAUTHORIZED";
        } else if (status.value() == HttpStatus.BAD_REQUEST.value()) {
            code = "BAD_REQUEST";
        } else {
            code = "ERROR";
        }
        return ResponseEntity.status(status).body(body(code, e.getMessage()));
    }

    @ExceptionHandler({ HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            ServletRequestBindingException.class })
    public ResponseEntity<Map<String, Object>> badRequest(Exception e) {
        return ResponseEntity.badRequest().body(body("BAD_REQUEST", "Invalid request"));
    }

    /**
     * A body type, Accept header or method the endpoint does not take: the caller's mistake, with
     * Spring's own status (415, 406 or 405). Nothing is logged. A 406 has no body, because the
     * caller has said it cannot read JSON.
     */
    @ExceptionHandler({ HttpMediaTypeNotSupportedException.class, HttpMediaTypeNotAcceptableException.class,
            HttpRequestMethodNotSupportedException.class })
    public ResponseEntity<Map<String, Object>> unsupportedRequest(ServletException e) {
        HttpStatusCode status = ((ErrorResponse) e).getStatusCode();
        if (e instanceof HttpMediaTypeNotAcceptableException) {
            return ResponseEntity.status(status).build();
        }
        return ResponseEntity.status(status).body(body("BAD_REQUEST", "Invalid request"));
    }

    /** No connection or a timeout: a panel treats this like a network failure, so it stays signed in. */
    @ExceptionHandler({ CannotCreateTransactionException.class, DataAccessResourceFailureException.class,
            QueryTimeoutException.class })
    public ResponseEntity<Map<String, Object>> databaseBusy(Exception e) {
        log.warn("Panel request could not reach the database: {}", e.getClass().getSimpleName());
        Map<String, Object> body = body("BUSY", "Try again shortly");
        body.put("retry_after_ms", 2000);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected(Exception e) {
        log.error("Panel request failed", e);
        SentryLogger.logError(e, "Panel request failed");
        return ResponseEntity.internalServerError().body(body("ERROR", "Something went wrong"));
    }

    private static Map<String, Object> body(String code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("message", message);
        return body;
    }
}
