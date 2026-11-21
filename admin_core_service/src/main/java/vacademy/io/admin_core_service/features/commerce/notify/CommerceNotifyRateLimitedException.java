package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

/** 429 {@code rate_limited} of a staff message action, with the seconds to send as {@code Retry-After}. */
public class CommerceNotifyRateLimitedException extends VacademyException {

    public static final String CODE = "rate_limited";

    private final int retryAfterSeconds;

    public CommerceNotifyRateLimitedException(String message, int retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, CODE + ": " + message);
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public int getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
