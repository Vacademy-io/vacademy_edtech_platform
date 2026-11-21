package vacademy.io.auth_service.feature.panel.phase2;

import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ActivityEvent;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;

import java.util.List;

/**
 * Seam: stores the "what was shown" events a panel sends on /sync and /session/end.
 *
 * <p>Called on the request thread, with the device already authenticated and the session already
 * matched to it by its token. Implementations make no HTTP call (OSIV holds the connection) and
 * never throw for bad events: they drop them. The default methods do nothing, which is phase 1.
 *
 * <p>Exactly one bean of this type exists: {@code usage.PanelActivityRecorder}.
 * {@link NoopPanelActivityIngest} is a plain class (not a bean) behind the phase 1 constructors.
 */
public interface PanelActivityIngest {

    /**
     * From /sync, only while the session is ACTIVE, and only when events is non-empty.
     *
     * @return the ack for the panel (the largest seq received in this request, also when events were
     *         ignored over a cap), or null when nothing was taken, which omits activity_acked_seq so the
     *         panel keeps its queue
     */
    default Integer ingestSync(DeviceRow device, SessionRow session, List<ActivityEvent> events) {
        return null;
    }

    /**
     * From /session/end, before the session is ended, for a session found by this device's session
     * token, whatever its status. The implementation decides whether a recently ended session still
     * takes events (the design allows 10 minutes).
     */
    default void ingestEnd(DeviceRow device, SessionRow session, List<ActivityEvent> events) {
    }
}
