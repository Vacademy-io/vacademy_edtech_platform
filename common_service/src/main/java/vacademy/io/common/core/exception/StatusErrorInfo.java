package vacademy.io.common.core.exception;

import java.util.Date;

/**
 * Error body for exceptions that already carry their own HTTP status.
 *
 * <p>Same shape as {@link ErrorInfo} plus {@code message}: that is the field Spring Boot's own
 * default error body uses and the one every client reads first, so callers can branch on the
 * reason code ({@code CHAT_DISABLED}, {@code DM_NOT_ALLOWED}, ...) without parsing prose.
 * {@code ex} repeats it so anything already reading {@link ErrorInfo}'s field keeps working.
 */
public record StatusErrorInfo(String url, String ex, String message, String responseCode, Date date) {
}
