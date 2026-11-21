package vacademy.io.admin_core_service.features.telephony.publicapi;

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
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import vacademy.io.common.auth.apikey.ApiErrorWriter;
import vacademy.io.common.tracing.RequestIds;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * The public AI calling API's error envelope. Scoped to its controller so every other
 * endpoint keeps the platform's GlobalExceptionHandler shape; ordered first so it wins
 * over that handler for this controller.
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = {PublicAiCallingApiController.class, PublicAiCallingManagementController.class})
public class AiCallingApiErrorAdvice {

    @ExceptionHandler(AiCallingApiException.class)
    public ResponseEntity<Map<String, Object>> api(AiCallingApiException e, HttpServletRequest req) {
        ResponseEntity.BodyBuilder b = ResponseEntity.status(e.getStatus());
        if (e.getRetryAfterSeconds() != null) b.header("Retry-After", String.valueOf(e.getRetryAfterSeconds()));
        return body(b, req, e.getCode(), e.getMessage(), e.getDetails());
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String, Object>> conflict(ConflictException e, HttpServletRequest req) {
        String msg = e.getMessage() == null ? "Conflict." : e.getMessage();
        if (msg.toLowerCase().contains("credit")) {
            return body(ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED), req, "insufficient_credits",
                    AiCallingApiService.OUT_OF_CREDITS, null);
        }
        return body(ResponseEntity.status(HttpStatus.CONFLICT), req, "conflict", msg, null);
    }

    @ExceptionHandler(VacademyException.class)
    public ResponseEntity<Map<String, Object>> vacademy(VacademyException e, HttpServletRequest req) {
        HttpStatus status = e.getStatus() == null || e.getStatus().is5xxServerError()
                ? HttpStatus.BAD_REQUEST : e.getStatus();
        return body(ResponseEntity.status(status), req, "invalid_request",
                e.getMessage() == null ? "The request could not be processed." : e.getMessage(), null);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> unreadable(Exception e, HttpServletRequest req) {
        return body(ResponseEntity.badRequest(), req, "invalid_request",
                "The request body is not valid JSON for this endpoint.", null);
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
        log.error("ai-calling-api: unhandled error request_id={}", requestId, e);
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
