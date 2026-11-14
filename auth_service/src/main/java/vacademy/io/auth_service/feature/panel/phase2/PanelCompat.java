package vacademy.io.auth_service.feature.panel.phase2;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;

import java.util.Map;

/**
 * The one place a sign-in refusal is chosen for a panel's app version. Panels built before phase 2
 * (app_version_code below {@link #FIRST_PHASE2_VERSION_CODE}, or unknown) do not know the new codes,
 * so they get PANEL_DISABLED, which they already show as "not available" and retry after a minute.
 * Phase 2 panels get the real code and its own screen.
 */
@Component
public class PanelCompat {

    /** The first app build that understands LICENCE_REQUIRED, AWAITING_APPROVAL and UPDATE_REQUIRED. */
    public static final int FIRST_PHASE2_VERSION_CODE = 3;

    private static final Map<String, String> MESSAGES = Map.of(
            PanelPhase2Errors.LICENCE_REQUIRED, "This classroom needs a licence",
            PanelPhase2Errors.AWAITING_APPROVAL, "This panel is waiting for the school's approval",
            PanelPhase2Errors.UPDATE_REQUIRED, "This panel needs an app update");

    /**
     * A 403 refusal for this device. code is one of the three phase 2 sign-in codes; any other code
     * is passed through unchanged.
     */
    public PanelApiException refusal(DeviceRow device, String code) {
        return refusalFor(device == null ? null : device.appVersionCode(), code);
    }

    public static PanelApiException refusalFor(Integer appVersionCode, String code) {
        String message = MESSAGES.get(code);
        if (message == null) {
            return new PanelApiException(HttpStatus.FORBIDDEN, code, "This panel cannot sign in right now");
        }
        if (!understandsPhase2(appVersionCode)) {
            return new PanelApiException(HttpStatus.FORBIDDEN, "PANEL_DISABLED",
                    "Classroom panels are not available for this institute");
        }
        return new PanelApiException(HttpStatus.FORBIDDEN, code, message);
    }

    public static boolean understandsPhase2(Integer appVersionCode) {
        return appVersionCode != null && appVersionCode >= FIRST_PHASE2_VERSION_CODE;
    }
}
