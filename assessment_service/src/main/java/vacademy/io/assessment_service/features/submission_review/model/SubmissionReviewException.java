package vacademy.io.assessment_service.features.submission_review.model;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * A refusal of the submission-review API: an HTTP status, a stable code the dashboard
 * switches on (STALE_REVISION, OUT_OF_RANGE, ...), a message and optional details.
 * Rendered as {"code","message","details"} by SubmissionReviewExceptionHandler.
 *
 * <p>A VacademyException carrying its HTTP status, so the shared tracing aspect
 * (SlowQueryLogger) treats a 4xx as an expected outcome - a stale edit, a blocked release -
 * instead of logging every one at ERROR "FAILED" (and reporting it to Sentry). Any other
 * caller that does not catch it gets GlobalExceptionHandler's body with the same status.
 */
public class SubmissionReviewException extends VacademyException {
    private final HttpStatus status;
    private final String code;
    private final transient Map<String, Object> details;

    public SubmissionReviewException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(status, message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public SubmissionReviewException(HttpStatus status, String code, String message) {
        this(status, code, message, null);
    }

    @Override
    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }

    public static SubmissionReviewException unprocessable(String code, String message, Map<String, Object> details) {
        return new SubmissionReviewException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
    }

    public static SubmissionReviewException conflict(String code, String message, Map<String, Object> details) {
        return new SubmissionReviewException(HttpStatus.CONFLICT, code, message, details);
    }
}
