package vacademy.io.auth_service.feature.panel.phase2;

import org.springframework.http.HttpStatus;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;

/**
 * The refusal codes phase 2 adds to the wire contract (apiTypes.ts PanelErrorCode). Thrown as
 * PanelApiException, so PanelExceptionAdvice and PanelPhase2ExceptionAdvice render them as
 * {code, message} like every phase 1 refusal.
 *
 * <p>LICENCE_REQUIRED, AWAITING_APPROVAL and UPDATE_REQUIRED go to a panel only through
 * {@link PanelCompat#refusal}, never directly, so a panel too old to know them reads PANEL_DISABLED.
 */
public final class PanelPhase2Errors {

    public static final String LICENCE_REQUIRED = "LICENCE_REQUIRED";
    public static final String AWAITING_APPROVAL = "AWAITING_APPROVAL";
    public static final String UPDATE_REQUIRED = "UPDATE_REQUIRED";
    public static final String FEATURE_OFF = "FEATURE_OFF";
    public static final String NOT_INSTALLER = "NOT_INSTALLER";
    public static final String INVITE_INVALID = "INVITE_INVALID";
    public static final String NO_SEAT = "NO_SEAT";

    private PanelPhase2Errors() {
    }

    /** 404 on Bearer endpoints whose switch is off. Public endpoints answer PANEL_DISABLED instead. */
    public static PanelApiException featureOff() {
        return new PanelApiException(HttpStatus.NOT_FOUND, FEATURE_OFF, "This feature is not available");
    }

    public static PanelApiException noSeat() {
        return new PanelApiException(HttpStatus.CONFLICT, NO_SEAT, "No free seat is left");
    }

    public static PanelApiException notInstaller() {
        return new PanelApiException(HttpStatus.FORBIDDEN, NOT_INSTALLER, "This account is not an installer");
    }

    public static PanelApiException inviteInvalid() {
        return new PanelApiException(HttpStatus.NOT_FOUND, INVITE_INVALID, "This code is not valid");
    }
}
