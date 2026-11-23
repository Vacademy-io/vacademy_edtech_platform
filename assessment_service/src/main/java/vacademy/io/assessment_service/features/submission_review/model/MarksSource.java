package vacademy.io.assessment_service.features.submission_review.model;

import java.util.Set;

/** question_wise_marks.marks_source values. */
public final class MarksSource {
    public static final String AUTO = "AUTO";
    public static final String KEYWORD = "KEYWORD";
    public static final String AI = "AI";
    public static final String AI_REVIEWED = "AI_REVIEWED";
    public static final String MANUAL = "MANUAL";
    public static final String OMR = "OMR";
    public static final String OFFLINE = "OFFLINE";
    /**
     * Read-only legacy value: a hand mark written by the first "question-marks" endpoint
     * (PR #3814, 2026-11-18). It means exactly what MANUAL means; nothing writes it any more
     * (that endpoint now goes through MarkWriter, which writes MANUAL).
     */
    public static final String TEACHER = "TEACHER";

    /** A machine (answer key, keyword match, AI) never overwrites these (spec R4). */
    public static final Set<String> PROTECTED = Set.of(AI_REVIEWED, MANUAL, TEACHER, OMR, OFFLINE);

    private MarksSource() {
    }

    public static boolean isProtected(String source) {
        return source != null && PROTECTED.contains(source);
    }

    /** A mark a person typed: MANUAL, or its legacy alias TEACHER. */
    public static boolean isHandMarked(String source) {
        return MANUAL.equals(source) || TEACHER.equals(source);
    }

    /** The value to show / compare: TEACHER is read as MANUAL. */
    public static String canonical(String source) {
        return TEACHER.equals(source) ? MANUAL : source;
    }
}
