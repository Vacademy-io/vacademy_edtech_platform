package vacademy.io.auth_service.feature.panel.phase2;

import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncUpdate;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;

/**
 * Seam: app updates for panels on the direct channel, and the version floor below which a panel may
 * not start sessions. A device with no app_channel (phase 1 builds never send one) counts as DIRECT.
 * Implementations make no HTTP call.
 *
 * <p>The default methods are phase 1: no offer, no floor beyond panel.min-app-version-code, which
 * phase 1 only displays.
 *
 * <p>Exactly one bean of this type exists: {@code release.PanelReleaseService}.
 * {@link NoopPanelReleaseOffer} is a plain class (not a bean) behind the phase 1 constructors.
 */
public interface PanelReleaseOffer {

    /** The update block of a signed-out /sync, or null to omit it. */
    default SyncUpdate syncBlock(DeviceRow device) {
        return null;
    }

    /** At the three session starts. Throws {@code compat.refusal(device, UPDATE_REQUIRED)} below the floor. */
    default void requireNotBelowFloor(DeviceRow device) {
    }

    /**
     * The value for SyncResponse.min_app_version_code: the larger of panel.min-app-version-code and
     * the highest LIVE required release of the device's channel. Null means "use the property".
     */
    default Integer requiredVersionCode(DeviceRow device) {
        return null;
    }
}
