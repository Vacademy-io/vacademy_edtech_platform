package vacademy.io.admin_core_service.features.member_api;

import lombok.Getter;
import org.springframework.http.HttpStatus;

import java.util.Map;

/**
 * An error the public Member Lookup API returns, rendered as
 * {"error":{"code","message","details"?,"request_id"?}}. {@code code} is stable and
 * machine-readable (missing_api_key, invalid_api_key, product_not_enabled, rate_limited,
 * not_found, invalid_request, auth_unavailable); clients branch on it, never on the message.
 */
@Getter
public class MemberApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final transient Map<String, Object> details;
    /** Seconds, for 429 / 503 (sent as Retry-After). */
    private final Integer retryAfterSeconds;

    public MemberApiException(HttpStatus status, String code, String message) {
        this(status, code, message, null, null);
    }

    public MemberApiException(HttpStatus status, String code, String message, Map<String, Object> details,
                              Integer retryAfterSeconds) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
