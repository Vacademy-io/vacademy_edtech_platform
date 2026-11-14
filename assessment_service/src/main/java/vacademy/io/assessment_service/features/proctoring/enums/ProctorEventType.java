package vacademy.io.assessment_service.features.proctoring.enums;

/**
 * Signals the learner's device can report. Stored as text so the log outlives
 * this enum; unknown values from a newer client are kept, not rejected.
 */
public enum ProctorEventType {
    /** Camera permission granted and the check-in selfie captured. Carries evidence. */
    CHECK_IN,
    /** Periodic frame. Carries evidence. INFO severity. */
    SNAPSHOT,
    CAMERA_DENIED,
    CAMERA_LOST,
    NO_FACE,
    MULTIPLE_FACES,
    TAB_SWITCH,
    FULLSCREEN_EXIT,
    /** The learner hit the configured violation ceiling and the attempt auto-submitted. */
    AUTO_SUBMITTED
}
