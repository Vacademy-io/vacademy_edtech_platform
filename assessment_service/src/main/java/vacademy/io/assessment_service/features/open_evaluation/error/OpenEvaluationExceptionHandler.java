package vacademy.io.assessment_service.features.open_evaluation.error;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.BindException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.ResultReleasedException;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.CreditCheckUnavailableException;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiScopes;
import vacademy.io.assessment_service.features.open_evaluation.config.NulCharacterGuard;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;
import vacademy.io.common.auth.apikey.ApiErrorWriter;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.tracing.RequestIds;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Error envelope of the partner API (spec 7.0):
 * {@code {"error":{"code","message","request_id","details"}}}, with {@code X-Request-Id}.
 *
 * <p>Scoped by {@code basePackages} to the partner controllers only, and ordered first so it
 * wins over common_service's {@code GlobalExceptionHandler} for them. Every other controller
 * keeps its existing error body. A catch-all makes sure nothing from a partner endpoint
 * falls through to the legacy 511 shape, and 5xx answers never carry internal detail.
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(basePackages = "vacademy.io.assessment_service.features.open_evaluation")
public class OpenEvaluationExceptionHandler {

    @ExceptionHandler(OpenApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(HttpServletRequest req, OpenApiException ex) {
        if (ex.getStatus().is5xxServerError()) {
            log.error("Partner API error {} {}: {}", ex.getStatus().value(), ex.getCode(), ex.getMessage(), ex);
        } else {
            log.info("Partner API rejected {} {}: {}", ex.getStatus().value(), ex.getCode(), ex.getMessage());
        }
        return respond(req, ex.getStatus(), ex.getCode(), ex.getMessage(), ex.getDetails(), ex.getHeaders());
    }

    @ExceptionHandler(ResultLockedException.class)
    public ResponseEntity<Map<String, Object>> handleLocked(HttpServletRequest req, ResultLockedException ex) {
        return respond(req, HttpStatus.CONFLICT, ApiErrorCode.SUBMISSION_FINALIZED,
                "The submission is finalized. Unfinalize it before changing marks or re-evaluating.",
                ex.getAttemptId() == null ? null : Map.of("submission_id", ex.getAttemptId()), null);
    }

    /** The credit check refused the work (spec 10.6): 402 with the numbers behind it. */
    @ExceptionHandler(InsufficientCreditsException.class)
    public ResponseEntity<Map<String, Object>> handleCredits(HttpServletRequest req, InsufficientCreditsException ex) {
        return handleApi(req, OpenApiErrors.insufficientCredits(ex));
    }

    /** API traffic fails closed when the credit service cannot be asked (spec 10.6.3). */
    @ExceptionHandler(CreditCheckUnavailableException.class)
    public ResponseEntity<Map<String, Object>> handleCreditsUnavailable(HttpServletRequest req,
            CreditCheckUnavailableException ex) {
        return handleApi(req, OpenApiErrors.engineUnavailable(ex.getRetryAfterSeconds()));
    }

    /** The engine's own release lock (T0.33) seen from a partner path. */
    @ExceptionHandler(ResultReleasedException.class)
    public ResponseEntity<Map<String, Object>> handleReleased(HttpServletRequest req, ResultReleasedException ex) {
        return respond(req, HttpStatus.CONFLICT, ApiErrorCode.SUBMISSION_FINALIZED,
                "The submission is finalized. Unfinalize it before changing marks or re-evaluating.", null, null);
    }

    /** {@code @PreAuthorize("@apiScopes.has(…)")} refused the call. */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, Object>> handleDenied(HttpServletRequest req, AccessDeniedException ex) {
        Object required = req.getAttribute(ApiScopes.REQUIRED_SCOPE_ATTRIBUTE);
        Map<String, Object> details = required == null ? null : Map.of("required_scope", required);
        String message = required == null
                ? "This API key is not allowed to call this endpoint."
                : "This API key lacks the " + required + " scope.";
        return respond(req, HttpStatus.FORBIDDEN, ApiErrorCode.INSUFFICIENT_SCOPE, message, details, null);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleUnreadable(HttpServletRequest req, HttpMessageNotReadableException ex) {
        return respond(req, HttpStatus.BAD_REQUEST, ApiErrorCode.MALFORMED_JSON,
                "The request body is not valid JSON for this endpoint.", null, null);
    }

    @ExceptionHandler(BindException.class) // includes MethodArgumentNotValidException
    public ResponseEntity<Map<String, Object>> handleBind(HttpServletRequest req, BindException ex) {
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        ex.getBindingResult().getFieldErrors().forEach(fe -> errors.add(new OpenApiException.FieldError(
                fe.getField(), fe.getCode() == null ? "invalid" : fe.getCode().toLowerCase(),
                fe.getDefaultMessage() == null ? "Invalid value." : fe.getDefaultMessage())));
        ex.getBindingResult().getGlobalErrors().forEach(ge -> errors.add(new OpenApiException.FieldError(
                ge.getObjectName(), ge.getCode() == null ? "invalid" : ge.getCode().toLowerCase(),
                ge.getDefaultMessage() == null ? "Invalid request." : ge.getDefaultMessage())));
        return handleApi(req, OpenApiException.validation(errors));
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingRequestHeaderException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> handleBadParameter(HttpServletRequest req, Exception ex) {
        String field = ex instanceof MissingServletRequestParameterException m ? m.getParameterName()
                : ex instanceof MissingRequestHeaderException h ? h.getHeaderName()
                : ex instanceof MethodArgumentTypeMismatchException t ? t.getName() : null;
        String code = ex instanceof MethodArgumentTypeMismatchException ? "invalid" : "required";
        String message = "required".equals(code) ? field + " is required." : field + " has an invalid value.";
        return handleApi(req, OpenApiException.validation(field, code, message));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMethod(HttpServletRequest req, HttpRequestMethodNotSupportedException ex) {
        return respond(req, HttpStatus.METHOD_NOT_ALLOWED, ApiErrorCode.METHOD_NOT_ALLOWED,
                "Method " + ex.getMethod() + " is not allowed here.", null, null);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMediaType(HttpServletRequest req, HttpMediaTypeNotSupportedException ex) {
        return respond(req, HttpStatus.UNSUPPORTED_MEDIA_TYPE, ApiErrorCode.UNSUPPORTED_MEDIA_TYPE,
                "Send JSON with Content-Type: application/json.", null, null);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleTooLarge(HttpServletRequest req, MaxUploadSizeExceededException ex) {
        return respond(req, HttpStatus.PAYLOAD_TOO_LARGE, ApiErrorCode.PAYLOAD_TOO_LARGE,
                "The request body is too large.", null, null);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(HttpServletRequest req, ResourceNotFoundException ex) {
        // Never echo the internal message: it can name ids of another institute.
        return respond(req, HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, "The resource was not found.", null, null);
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<Map<String, Object>> handleForbidden(HttpServletRequest req, ForbiddenException ex) {
        // A tenant check failing inside a shared manager means "not yours": 404, never 403 (spec 8.3).
        return respond(req, HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, "The resource was not found.", null, null);
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String, Object>> handleConflict(HttpServletRequest req, ConflictException ex) {
        return respond(req, HttpStatus.CONFLICT, ApiErrorCode.CONFLICT, ex.getMessage(), null, null);
    }

    @ExceptionHandler(InvalidRequestException.class)
    public ResponseEntity<Map<String, Object>> handleInvalid(HttpServletRequest req, InvalidRequestException ex) {
        return handleApi(req, OpenApiException.validation(null, "invalid", ex.getMessage()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleStatus(HttpServletRequest req, ResponseStatusException ex) {
        HttpStatusCode status = ex.getStatusCode();
        if (status.is5xxServerError()) {
            return internal(req, ex);
        }
        String code = status.value() == 404 ? ApiErrorCode.NOT_FOUND : ApiErrorCode.VALIDATION_FAILED;
        return respond(req, status, code, ex.getReason() != null ? ex.getReason() : "The request was rejected.",
                null, null);
    }

    /**
     * Shared managers throw VacademyException for business rules (status 510 by default).
     * The facade translates the ones it expects; anything left is reported as a 4xx when
     * the exception says so, otherwise as an internal error without its message.
     */
    @ExceptionHandler(VacademyException.class)
    public ResponseEntity<Map<String, Object>> handleVacademy(HttpServletRequest req, VacademyException ex) {
        HttpStatus status = ex.getStatus();
        if (status != null && status.is4xxClientError()) {
            String code = status == HttpStatus.NOT_FOUND ? ApiErrorCode.NOT_FOUND
                    : status == HttpStatus.CONFLICT ? ApiErrorCode.CONFLICT
                    : ApiErrorCode.VALIDATION_FAILED;
            HttpStatus mapped = status == HttpStatus.FORBIDDEN || status == HttpStatus.UNAUTHORIZED
                    ? HttpStatus.NOT_FOUND : status;
            String message = mapped == HttpStatus.NOT_FOUND ? "The resource was not found." : ex.getMessage();
            return respond(req, mapped, mapped == HttpStatus.NOT_FOUND ? ApiErrorCode.NOT_FOUND : code, message,
                    null, null);
        }
        return internal(req, ex);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleAny(HttpServletRequest req, Exception ex) {
        return internal(req, ex);
    }

    private ResponseEntity<Map<String, Object>> internal(HttpServletRequest req, Exception ex) {
        if (isUnstorableText(ex)) {
            // Safety net behind NulCharacterGuard (query parameters, anything it cannot see):
            // Postgres refused a character in a partner string. That is the caller's input.
            // WARN, not INFO: a server-side encoding bug would land here too and must be findable.
            log.warn("Partner API rejected 422 {}: Postgres refused a character in the input on {} {} (request {})",
                    NulCharacterGuard.CODE, req.getMethod(), req.getRequestURI(), req.getHeader("X-Request-Id"));
            return handleApi(req, OpenApiException.validation(null, NulCharacterGuard.CODE,
                    "A text value contains a character that cannot be stored, such as U+0000 (NUL)."));
        }
        log.error("Partner API internal error on {} {}", req.getMethod(), req.getRequestURI(), ex);
        return respond(req, HttpStatus.INTERNAL_SERVER_ERROR, ApiErrorCode.INTERNAL_ERROR,
                "Something went wrong on our side. Retry later; quote the request_id if it persists.", null, null);
    }

    /**
     * True when the failure is Postgres refusing a character of the input: 22021 (a 0x00 byte
     * in text/varchar, "invalid byte sequence for encoding UTF8") or 22P05 ({@code \\u0000} in
     * jsonb, "unsupported Unicode escape sequence"), anywhere in the cause chain.
     */
    static boolean isUnstorableText(Throwable ex) {
        Throwable t = ex;
        for (int depth = 0; t != null && depth < 16; depth++) {
            if (t instanceof SQLException sql) {
                for (SQLException s = sql; s != null; s = s.getNextException()) {
                    if ("22021".equals(s.getSQLState()) || "22P05".equals(s.getSQLState())) {
                        return true;
                    }
                    if (s.getNextException() == s) {
                        break;
                    }
                }
            }
            t = t.getCause() == t ? null : t.getCause();
        }
        return false;
    }

    static ResponseEntity<Map<String, Object>> respond(HttpServletRequest req, HttpStatusCode status, String code,
            String message, Map<String, ?> details, Map<String, String> extraHeaders) {
        String requestId = RequestIds.resolve(req);
        HttpHeaders headers = new HttpHeaders();
        headers.set(RequestIds.HEADER, requestId);
        headers.setCacheControl("no-store");
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (extraHeaders != null) {
            extraHeaders.forEach(headers::set);
        }
        return ResponseEntity.status(status).headers(headers)
                .body(ApiErrorWriter.envelope(code, message, requestId, details));
    }
}
