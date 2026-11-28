package vacademy.io.auth_service.feature.panel.phase2;

import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncLicence;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;

import java.time.Instant;
import java.util.Map;

/**
 * Seam: room seats. Consulted only where a session starts (challenge create and approve for SIGN_IN,
 * password sign-in), never from refresh, sync, the remote or ATTACH_REMOTE, so a running class is
 * never cut. Implementations make no HTTP call and take the seat lock themselves where they write.
 *
 * <p>The default methods are phase 1: everything allowed, nothing written, nothing shown.
 *
 * <p>Exactly one bean of this type exists: {@code licence.PanelLicenceService}.
 * {@link NoopPanelLicenceGate} is a plain class (not a bean) behind the phase 1 constructors.
 */
public interface PanelLicenceGate {

    /**
     * Before a session starts on this device. Throws {@code compat.refusal(device, LICENCE_REQUIRED)}
     * when enforcement is LIVE (and never-block is off) and the room may not start a session.
     */
    default void requireCanStart(DeviceRow device) {
    }

    /**
     * Inside the pairing confirm transaction, right after the device moved CLAIMED to ACTIVE. device
     * is the row as read before the confirm. Must not throw for "no seat left": it then assigns nothing.
     */
    default void onActivated(DeviceRow device) {
    }

    /** Inside the archive transaction, after the room was archived (it has no live device). */
    default void onRoomArchived(String instituteId, String roomId, String actorUserId) {
    }

    /** The licence block of a signed-out /sync, or null to omit it. */
    default SyncLicence syncBlock(DeviceRow device) {
        return null;
    }

    /** The institute's seat picture, for the device list and fleet alerts. */
    default InstituteLicenceView view(String instituteId) {
        return InstituteLicenceView.UNMANAGED;
    }

    /**
     * enforcement: OFF, SHADOW or LIVE. state: UNMANAGED, ACTIVE, TRIAL, GRACE, EXPIRED, NONE.
     * roomStates maps room id to LICENSED, GRACE, OVER_LIMIT, UNLICENSED or EXPIRED for rooms with a
     * live device; it is empty while unmanaged. endsAt is the latest end among covering grants.
     * endingGrantId / firstEndsAt name the earliest-ending covering grant whose end takes a seat a
     * room holds, or ends the coverage (both null when nothing covers now). graceSeats are seats of
     * ended grants still in grace that keep rooms beyond the covering seats working; graceEndsAt and
     * graceGrantId describe them (also set while the institute is in GRACE).
     */
    record InstituteLicenceView(String enforcement, String state, int seats, int seatsUsed, Instant endsAt,
            Instant graceEndsAt, String endingGrantId, Map<String, String> roomStates, int graceSeats,
            Instant firstEndsAt, String graceGrantId) {

        public static final InstituteLicenceView UNMANAGED = new InstituteLicenceView("OFF", "UNMANAGED", 0, 0,
                null, null, null, Map.of());

        /** Without grace seats: the first end is the latest end and the grace grant is the ending one. */
        public InstituteLicenceView(String enforcement, String state, int seats, int seatsUsed, Instant endsAt,
                Instant graceEndsAt, String endingGrantId, Map<String, String> roomStates) {
            this(enforcement, state, seats, seatsUsed, endsAt, graceEndsAt, endingGrantId, roomStates, 0, endsAt,
                    endingGrantId);
        }

        public String roomState(String roomId) {
            return roomStates == null ? null : roomStates.get(roomId);
        }
    }
}
