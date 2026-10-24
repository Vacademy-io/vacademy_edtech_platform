package vacademy.io.admin_core_service.features.engagement.service;

import vacademy.io.common.exceptions.VacademyException;

/**
 * A learner action the engagement rules refused, with a stable machine-readable reason.
 *
 * It IS a {@link VacademyException}, so the status (510) and the {@code ex} message are
 * exactly what the global handler has always sent for these refusals. The only addition
 * is {@code reasonCode}, which {@code EngagementExceptionAdvice} puts in the error body so
 * a client can act on the code (close, reload, stay) instead of matching message text.
 * Clients that do not know the field keep working unchanged.
 */
public class EngagementRejectedException extends VacademyException {

    /** COURSE_SLIDE: the slide's own progress does not read as finished yet. */
    public static final String LESSON_NOT_FINISHED = "LESSON_NOT_FINISHED";
    /** The occurrence has closed and its catch-up window (if any) is over. */
    public static final String TASK_CLOSED = "TASK_CLOSED";
    /** The occurrence has not opened yet. */
    public static final String NOT_OPEN = "NOT_OPEN";
    /** READING_HTML / VISUAL_NOTE: not opened, or the dwell or scroll gate is not met. */
    public static final String READ_GATE = "READ_GATE";
    /** A question or poll submitted without an answer, text or file. */
    public static final String ANSWER_REQUIRED = "ANSWER_REQUIRED";
    /** GAME / QUIZ: not opened, or the minimum play time has not passed. */
    public static final String GAME_NOT_FINISHED = "GAME_NOT_FINISHED";
    /** The stored item type is not one this server can grade. */
    public static final String UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE";
    /**
     * FLASHCARDS: the deck the client holds is not the one on the server (the teacher
     * edited it), or it was never opened through GET item. Refetch the item and resume.
     */
    public static final String FLASHCARDS_STALE = "FLASHCARDS_STALE";
    /** FLASHCARDS: the outcomes do not cover exactly the current deck once each. */
    public static final String FLASHCARDS_INCOMPLETE = "FLASHCARDS_INCOMPLETE";
    /** FLASHCARDS: submitted sooner than the per-deck patience gate. */
    public static final String FLASHCARDS_TOO_FAST = "FLASHCARDS_TOO_FAST";

    private final String reasonCode;

    public EngagementRejectedException(String reasonCode, String message) {
        super(message);
        this.reasonCode = reasonCode;
    }

    public String getReasonCode() {
        return reasonCode;
    }
}
