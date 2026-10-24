package vacademy.io.assessment_service.features.proctoring.enums;

public enum ProctorEventSeverity {
    /** Routine: a snapshot, a check-in. Never counts against the learner. */
    INFO,
    /** Worth a look: a single tab switch, a short no-face gap. */
    WARN,
    /** Counts toward the violation ceiling and is what reviewers sort by. */
    FLAG;

    public static ProctorEventSeverity fromString(String value) {
        if (value == null) return INFO;
        try {
            return ProctorEventSeverity.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return INFO;
        }
    }
}
