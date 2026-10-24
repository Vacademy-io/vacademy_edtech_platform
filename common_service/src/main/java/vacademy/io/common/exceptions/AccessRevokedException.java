package vacademy.io.common.exceptions;

import org.springframework.http.HttpStatus;
import org.springframework.web.client.RestClientResponseException;

/**
 * The caller is (or was) staff in this institute and every role they held there has been
 * revoked — "Disable access" or "Delete member" on the Teams tab.
 *
 * <p>Thrown by auth-service's internal user lookup, which every other service calls on each
 * request. {@link #CODE} travels inside the error body, so a service's JwtAuthFilter can tell
 * "this person was switched off" (end the session) apart from "auth-service did not answer"
 * (a blip — must NOT log anyone out).
 */
public class AccessRevokedException extends VacademyException {

    public static final String CODE = "STAFF_ACCESS_REVOKED";

    public AccessRevokedException(String message) {
        super(HttpStatus.FORBIDDEN, CODE + ": " + message);
    }

    /** True when {@code failure} (or anything in its cause chain) carries {@link #CODE}. */
    public static boolean isCause(Throwable failure) {
        Throwable current = failure;
        int depth = 0;
        while (current != null && depth++ < 10) {
            if (current instanceof AccessRevokedException) {
                return true;
            }
            String message = current.getMessage();
            if (message != null && message.contains(CODE)) {
                return true;
            }
            // The HTTP client shortens the body inside its message; read the full body too.
            if (current instanceof RestClientResponseException response
                    && response.getResponseBodyAsString().contains(CODE)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
