package vacademy.io.admin_core_service.features.marketing.client;

import org.springframework.http.HttpStatus;
import vacademy.io.common.exceptions.VacademyException;

/**
 * An error returned by (or while reaching) Meta Graph, Google Ads, Google Business Profile or
 * Google OAuth. The message is the platform message, safe to show to the admin verbatim (it never
 * contains a token).
 *
 * <p>Extends VacademyException so the global handler answers it without any controller code:
 * transient errors as 502, everything else as 400.
 */
public class MarketingApiException extends VacademyException {

    /** The connection could not be opened: the request never reached the platform (safe to retry). */
    public static final String CONNECT_ERROR = "CONNECT_ERROR";
    /**
     * A create call (a post, a publish) failed in a way that does not tell whether the platform
     * acted on it (timeout, dropped response, 5xx). Never retried automatically: it may be live.
     */
    public static final String OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN";

    /** Platform error code, e.g. "190", "190/463", "DEVELOPER_TOKEN_NOT_APPROVED", "invalid_grant". */
    private final String platformCode;
    /** Worth retrying later (rate limit, 5xx, network). */
    private final boolean transientError;
    /** The grant is no longer usable: the admin must reconnect the account. */
    private final boolean authError;

    public MarketingApiException(String platformCode, String message, boolean transientError, boolean authError) {
        super(transientError && !authError ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST,
                message == null || message.isBlank() ? "The ad platform returned an error" : message);
        this.platformCode = platformCode;
        this.transientError = transientError && !authError;
        this.authError = authError;
    }

    public String getPlatformCode() {
        return platformCode;
    }

    public boolean isTransientError() {
        return transientError;
    }

    public boolean isAuthError() {
        return authError;
    }
}
