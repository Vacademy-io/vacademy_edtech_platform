package vacademy.io.admin_core_service.features.telephony.publicapi;

import lombok.Getter;
import org.springframework.http.HttpStatus;

import java.util.Map;

/**
 * An error the public AI calling API returns to the client, rendered by
 * {@link AiCallingApiErrorAdvice} as {"error":{"code","message","request_id","details"}}.
 * {@code code} is a stable machine-readable string; clients branch on it, never on message.
 */
@Getter
public class AiCallingApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final transient Map<String, ?> details;
    /** Seconds, for 429 / 503 (sent as Retry-After). */
    private final Integer retryAfterSeconds;

    public AiCallingApiException(HttpStatus status, String code, String message) {
        this(status, code, message, null, null);
    }

    public AiCallingApiException(HttpStatus status, String code, String message, Map<String, ?> details) {
        this(status, code, message, details, null);
    }

    public AiCallingApiException(HttpStatus status, String code, String message, Map<String, ?> details,
                                 Integer retryAfterSeconds) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public static AiCallingApiException invalid(String message) {
        return new AiCallingApiException(HttpStatus.BAD_REQUEST, "invalid_request", message);
    }

    public static AiCallingApiException invalid(String message, Map<String, ?> details) {
        return new AiCallingApiException(HttpStatus.BAD_REQUEST, "invalid_request", message, details);
    }

    public static AiCallingApiException notFound(String what) {
        return new AiCallingApiException(HttpStatus.NOT_FOUND, "not_found", what + " not found.");
    }
}
