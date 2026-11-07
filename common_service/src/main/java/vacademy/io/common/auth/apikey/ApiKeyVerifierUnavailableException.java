package vacademy.io.common.auth.apikey;

/**
 * The key store could not be asked (timeout, connection refused, 5xx) and the key is not
 * cached. Mapped to 503 {@code auth_unavailable}, never to 401.
 */
public class ApiKeyVerifierUnavailableException extends RuntimeException {

    public ApiKeyVerifierUnavailableException(String message) {
        super(message);
    }

    public ApiKeyVerifierUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
