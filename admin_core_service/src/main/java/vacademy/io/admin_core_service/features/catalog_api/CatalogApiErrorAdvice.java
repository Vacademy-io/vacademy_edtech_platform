package vacademy.io.admin_core_service.features.catalog_api;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import vacademy.io.common.auth.apikey.ApiErrorWriter;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.tracing.RequestIds;

import java.util.Map;

/**
 * The public catalogue API's error envelope {"error":{"code","message","request_id","details"?}}.
 * Scoped to {@link PublicCatalogApiController} so every other endpoint keeps the platform's
 * GlobalExceptionHandler shape; ordered first so it wins over that handler for this controller.
 * Modelled on the Telleo API's AiCallingApiErrorAdvice.
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = PublicCatalogApiController.class)
public class CatalogApiErrorAdvice {

    @ExceptionHandler(CatalogApiException.class)
    public ResponseEntity<Map<String, Object>> api(CatalogApiException e, HttpServletRequest req) {
        ResponseEntity.BodyBuilder b = ResponseEntity.status(e.getStatus());
        if (e.getRetryAfterSeconds() != null) b.header("Retry-After", String.valueOf(e.getRetryAfterSeconds()));
        return body(b, req, e.getCode(), e.getMessage(), e.getDetails());
    }

    @ExceptionHandler(VacademyException.class)
    public ResponseEntity<Map<String, Object>> vacademy(VacademyException e, HttpServletRequest req) {
        HttpStatus status = e.getStatus() == null || e.getStatus().is5xxServerError()
                ? HttpStatus.BAD_REQUEST : e.getStatus();
        String code = status == HttpStatus.NOT_FOUND ? "not_found" : "invalid_request";
        return body(ResponseEntity.status(status), req, code,
                e.getMessage() == null ? "The request could not be processed." : e.getMessage(), null);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> unreadable(Exception e, HttpServletRequest req) {
        return body(ResponseEntity.badRequest(), req, "invalid_request",
                "The request is not valid for this endpoint (check the JSON body and the query parameters).", null);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, Object>> param(MissingServletRequestParameterException e, HttpServletRequest req) {
        return body(ResponseEntity.badRequest(), req, "invalid_request",
                "Missing query parameter: " + e.getParameterName() + ".", null);
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    public ResponseEntity<Map<String, Object>> header(MissingRequestHeaderException e, HttpServletRequest req) {
        return body(ResponseEntity.badRequest(), req, "invalid_request",
                "Missing header: " + e.getHeaderName() + ".", null);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> mediaType(Exception e, HttpServletRequest req) {
        return body(ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE), req, "invalid_request",
                "Send the body as application/json.", null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> method(Exception e, HttpServletRequest req) {
        return body(ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED), req, "method_not_allowed",
                e.getMessage(), null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> other(Exception e, HttpServletRequest req) {
        String requestId = RequestIds.resolve(req);
        log.error("catalog-api: unhandled error request_id={}", requestId, e);
        return body(ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR), req, "internal_error",
                "Something went wrong on our side. Retry, and contact support with the request_id if it persists.",
                null);
    }

    private static ResponseEntity<Map<String, Object>> body(ResponseEntity.BodyBuilder b, HttpServletRequest req,
                                                            String code, String message, Map<String, ?> details) {
        String requestId = RequestIds.resolve(req);
        // X-Request-Id itself is set on every response by RequestTracingFilter.
        return b.header("Cache-Control", "no-store")
                .body(ApiErrorWriter.envelope(code, message, requestId, details));
    }
}
