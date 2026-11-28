package vacademy.io.assessment_service.features.submission_review.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Error body of the submission review API: {"code","message","details"} (contract 5.0).
 * Scoped to SubmissionReviewController; ForbiddenException keeps the global 403 body.
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = SubmissionReviewController.class)
public class SubmissionReviewExceptionHandler {

    @ExceptionHandler(SubmissionReviewException.class)
    public ResponseEntity<Map<String, Object>> handle(SubmissionReviewException ex) {
        log.info("[submission-review] {} {}: {}", ex.getStatus().value(), ex.getCode(), ex.getMessage());
        return body(ex.getStatus(), ex.getCode(), ex.getMessage(), ex.getDetails());
    }

    @ExceptionHandler(ResultLockedException.class)
    public ResponseEntity<Map<String, Object>> locked(ResultLockedException ex) {
        return body(HttpStatus.CONFLICT, "RESULT_LOCKED",
                "This exam's result is finalized through the partner API; unfinalize it first",
                ex.getAttemptId() == null ? null : Map.of("attempt_id", ex.getAttemptId()));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(ResourceNotFoundException ex) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", ex.getMessage(), null);
    }

    static ResponseEntity<Map<String, Object>> body(HttpStatus status, String code, String message,
                                                    Map<String, Object> details) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("code", code);
        b.put("message", message);
        if (details != null) b.put("details", details);
        return ResponseEntity.status(status).body(b);
    }
}
