package vacademy.io.assessment_service.features.assessment.enums;

public enum EvaluationLogsTypeEnum {
    MANUAL_EVALUATION,
    /**
     * A staff member changed one question's marks (PR #3814). No longer written: the
     * question-marks endpoint records mark_event history through MarkWriter. Kept so rows
     * written before that are still read (History shows them as before-history entries).
     */
    MARKS_OVERRIDE
}
