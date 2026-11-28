package vacademy.io.assessment_service.features.open_evaluation.error;

import lombok.Getter;
import org.springframework.http.HttpStatus;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A partner-facing error: HTTP status + machine code + human message + optional details,
 * rendered as the spec 7.0 envelope by {@link OpenEvaluationExceptionHandler}.
 *
 * <p>The message is shown to the partner as is, so it must never carry internal ids
 * of another institute, stack details or secrets.
 */
@Getter
public class OpenApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> details;
    /** Extra response headers (e.g. Retry-After on 429/503). */
    private final Map<String, String> headers;

    public OpenApiException(HttpStatus status, String code, String message) {
        this(status, code, message, null, null);
    }

    public OpenApiException(HttpStatus status, String code, String message, Map<String, ?> details) {
        this(status, code, message, details, null);
    }

    public OpenApiException(HttpStatus status, String code, String message, Map<String, ?> details,
            Map<String, String> headers) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details == null ? Collections.emptyMap() : Collections.unmodifiableMap(new LinkedHashMap<>(details));
        this.headers = headers == null ? Collections.emptyMap() : Collections.unmodifiableMap(new LinkedHashMap<>(headers));
    }

    // ------------------------------------------------------------ common shapes

    public static OpenApiException notFound(String code, String message) {
        return new OpenApiException(HttpStatus.NOT_FOUND, code, message);
    }

    public static OpenApiException conflict(String code, String message, Map<String, ?> details) {
        return new OpenApiException(HttpStatus.CONFLICT, code, message, details);
    }

    /** 422 validation_failed with {@code details.errors: [{field, code, message}]} (spec 7.0). */
    public static OpenApiException validation(List<FieldError> errors) {
        String message = errors.isEmpty() ? "The request is not valid."
                : errors.size() == 1 ? errors.get(0).message()
                : errors.size() + " fields are not valid; see details.errors.";
        List<Map<String, String>> rendered = errors.stream().map(FieldError::toMap).toList();
        return new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.VALIDATION_FAILED, message,
                Map.of("errors", rendered));
    }

    public static OpenApiException validation(String field, String code, String message) {
        return validation(List.of(new FieldError(field, code, message)));
    }

    /** One entry of {@code details.errors}. */
    public record FieldError(String field, String code, String message) {
        Map<String, String> toMap() {
            Map<String, String> m = new LinkedHashMap<>();
            m.put("field", field);
            m.put("code", code);
            m.put("message", message);
            return m;
        }
    }
}
