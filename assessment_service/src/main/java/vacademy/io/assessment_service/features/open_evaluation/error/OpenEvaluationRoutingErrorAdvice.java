package vacademy.io.assessment_service.features.open_evaluation.error;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;

import java.util.Map;

/**
 * Routing errors on partner paths, in the partner envelope (spec 7.0).
 *
 * <p>{@link OpenEvaluationExceptionHandler} is scoped to the partner controllers, so it only
 * applies once a partner handler was resolved. An unknown route, a wrong method or an
 * unsupported content type is raised before any handler exists and would otherwise reach
 * the container's {@code /error} page (the dashboard's 403 body). This advice applies to
 * every handler but acts on partner paths only.
 *
 * <p>Everywhere else it rethrows the original exception. Spring's
 * {@code ExceptionHandlerExceptionResolver} treats a rethrown original as "not handled" and
 * continues with the default resolvers, which is exactly what happens today: common_service's
 * {@code GlobalExceptionHandler} has no handler for these servlet exceptions, so dashboard
 * responses are unchanged.
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
public class OpenEvaluationRoutingErrorAdvice {

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<Map<String, Object>> handleNoRoute(HttpServletRequest req, Exception ex) throws Exception {
        if (!OpenApiPaths.isOpenEvaluation(req)) {
            throw ex;
        }
        log.info("Partner API unknown route {} {}", req.getMethod(), req.getRequestURI());
        return OpenEvaluationExceptionHandler.respond(req, HttpStatus.NOT_FOUND, ApiErrorCode.ENDPOINT_NOT_FOUND,
                "No endpoint matches this method and path. Check it against the API reference.", null, null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMethod(HttpServletRequest req,
            HttpRequestMethodNotSupportedException ex) throws Exception {
        if (!OpenApiPaths.isOpenEvaluation(req)) {
            throw ex;
        }
        ResponseEntity<Map<String, Object>> body = OpenEvaluationExceptionHandler.respond(req,
                HttpStatus.METHOD_NOT_ALLOWED, ApiErrorCode.METHOD_NOT_ALLOWED,
                "Method " + ex.getMethod() + " is not allowed here.", null, null);
        if (ex.getSupportedHttpMethods() != null && !ex.getSupportedHttpMethods().isEmpty()) {
            return ResponseEntity.status(body.getStatusCode())
                    .headers(h -> {
                        h.putAll(body.getHeaders());
                        h.setAllow(ex.getSupportedHttpMethods());
                    })
                    .body(body.getBody());
        }
        return body;
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMediaType(HttpServletRequest req,
            HttpMediaTypeNotSupportedException ex) throws Exception {
        if (!OpenApiPaths.isOpenEvaluation(req)) {
            throw ex;
        }
        return OpenEvaluationExceptionHandler.respond(req, HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                ApiErrorCode.UNSUPPORTED_MEDIA_TYPE, "Send JSON with Content-Type: application/json.", null, null);
    }
}
