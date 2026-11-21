package vacademy.io.auth_service.feature.panel.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Every refusal from the panel endpoints. Clients switch on {@code code}, so codes are part of the
 * wire contract (frontend-admin-dashboard/src/classroom-shared/apiTypes.ts) and the message is only
 * ever shown to a person. A ResponseStatusException, so the shared tracing treats a 4xx as an expected
 * refusal rather than an error, and a 5xx as a failure.
 */
public class PanelApiException extends ResponseStatusException {

    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> extras = new LinkedHashMap<>();

    public PanelApiException(HttpStatus status, String code, String message) {
        super(status, message);
        this.status = status;
        this.code = code;
    }

    public PanelApiException with(String key, Object value) {
        extras.put(key, value);
        return this;
    }

    public HttpStatus getHttpStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getExtras() {
        return extras;
    }

    public static PanelApiException deviceRevoked() {
        return new PanelApiException(HttpStatus.UNAUTHORIZED, "DEVICE_REVOKED", "This panel is not registered");
    }

    public static PanelApiException deviceNotActive() {
        return new PanelApiException(HttpStatus.CONFLICT, "DEVICE_NOT_ACTIVE", "Confirm pairing on the panel first");
    }

    public static PanelApiException sessionEnded(String reason) {
        return new PanelApiException(HttpStatus.UNAUTHORIZED, "SESSION_ENDED", "This session has ended")
                .with("reason", reason);
    }

    public static PanelApiException badRequest(String message) {
        return new PanelApiException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
    }

    public static PanelApiException notFound(String message) {
        return new PanelApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
    }

    public static PanelApiException notStaff(String instituteName) {
        return new PanelApiException(HttpStatus.FORBIDDEN, "NOT_STAFF", "This account is not staff at this institute")
                .with("institute_name", instituteName);
    }

    public static PanelApiException otherUser() {
        return new PanelApiException(HttpStatus.FORBIDDEN, "OTHER_USER", "Another teacher is signed in on this panel");
    }

    public static PanelApiException tryAgain() {
        return new PanelApiException(HttpStatus.SERVICE_UNAVAILABLE, "TRY_AGAIN", "Please try again in a moment");
    }

    public static PanelApiException busy(HttpStatus status) {
        return new PanelApiException(status, "BUSY", "Try again shortly").with("retry_after_ms", 2000);
    }

    public static PanelApiException disabled() {
        return new PanelApiException(HttpStatus.SERVICE_UNAVAILABLE, "PANEL_DISABLED", "Classroom panels are not available");
    }
}
