package vacademy.io.assessment_service.features.proctoring.enums;

/**
 * What an assessment's proctoring costs and does. Ordered cheapest first.
 * <p>
 * Only NONE and BASIC exist today. The catalogue is an enum rather than free text
 * so pricing, the admin picker and the learner runtime all agree on the set, and
 * so a new tier (clips on flag, live proctor room, post-hoc AI review) is one
 * constant plus its defaults, not a schema change.
 */
public enum ProctoringTier {
    /** No camera, no events. The behaviour of every assessment created before V50. */
    NONE,
    /**
     * On-device AI, snapshots only. The learner's browser runs face detection
     * locally and uploads a small JPEG every N seconds plus one on every flag.
     * Nothing streams; the server cost is object storage.
     */
    BASIC;

    public static ProctoringTier fromString(String value) {
        if (value == null) return NONE;
        try {
            return ProctoringTier.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return NONE;
        }
    }
}
