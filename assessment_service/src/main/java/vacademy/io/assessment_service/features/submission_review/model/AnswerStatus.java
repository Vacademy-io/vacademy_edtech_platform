package vacademy.io.assessment_service.features.submission_review.model;

import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;

import java.util.Set;
import java.util.function.Supplier;

/**
 * question_wise_marks.status from a mark a person (or the AI) gave. Moved out of
 * AdminManualEvaluationManager.deriveStatusFromMarks so every writer derives it the same way:
 * full marks CORRECT, 0 (or less) INCORRECT, anything between PARTIAL_CORRECT; a "not
 * answered" row stays PENDING. The learner report counts PENDING rows as skipped, so every
 * writer that puts a mark on a row must also set this.
 */
public final class AnswerStatus {
    /**
     * Sources whose marks are a judgement on an answer the learner gave (AI verdict, a
     * person). Their rows were written with a stale PENDING status before 2026-11-19 (the AI
     * callback, the old review PUT and release-time AI acceptance never set it).
     */
    private static final Set<String> JUDGED = Set.of(MarksSource.AI, MarksSource.AI_REVIEWED, MarksSource.MANUAL,
            MarksSource.TEACHER);

    private AnswerStatus() {
    }

    public static String fromMarks(double marks, Double max) {
        if (marks <= 0) {
            // A teacher's 0 is a judgement (incorrect), not "unanswered".
            return QuestionResponseEnum.INCORRECT.name();
        }
        if (max != null && max > 0) {
            return marks >= max ? QuestionResponseEnum.CORRECT.name() : QuestionResponseEnum.PARTIAL_CORRECT.name();
        }
        return QuestionResponseEnum.CORRECT.name();
    }

    /** Whether {@code status} is one of the four QuestionResponseEnum names. */
    public static boolean isKnown(String status) {
        if (status == null) return false;
        for (QuestionResponseEnum e : QuestionResponseEnum.values()) {
            if (e.name().equals(status)) return true;
        }
        return false;
    }

    /** {@code status} when it is a QuestionResponseEnum name, else the status the mark gives. */
    public static String knownOrFromMarks(String status, double marks, Double max) {
        return isKnown(status) ? status : fromMarks(marks, max);
    }

    /**
     * The status of an AI verdict mirrored onto the answer: PENDING ("skipped") when the AI
     * found no answer - 0 marks and nothing extracted, the shape of ai_service's
     * "unattempted" verdict (typed_answers.unattempted_verdict for a blank typed answer; a
     * handwritten question with no ink) - else the status the mark gives.
     */
    public static String forAiVerdict(double marks, Double max, String extractedAnswer) {
        if (marks <= 0 && (extractedAnswer == null || extractedAnswer.isBlank())) {
            return QuestionResponseEnum.PENDING.name();
        }
        return fromMarks(marks, max);
    }

    /**
     * The status when a teacher accepts the AI's mark (Accept, or Release taking the drafts).
     * A positive mark: the status the mark gives. A 0: PENDING when the answer is blank
     * ({@code blankAnswer} true: an online answer with nothing typed), INCORRECT when it is
     * not (false); unknown (null: an uploaded sheet) keeps a PENDING the AI callback left -
     * the AI found no answer there - and is INCORRECT otherwise.
     */
    public static String forAcceptedAi(double marks, Double max, String currentStatus, Boolean blankAnswer) {
        if (marks > 0) return fromMarks(marks, max);
        if (blankAnswer != null) {
            return blankAnswer ? QuestionResponseEnum.PENDING.name() : fromMarks(marks, max);
        }
        boolean pending = currentStatus == null || QuestionResponseEnum.PENDING.name().equals(currentStatus);
        return pending ? QuestionResponseEnum.PENDING.name() : fromMarks(marks, max);
    }

    /**
     * Whether a report reads this stored row by its marks instead of its status (then it
     * needs the question's max). Two kinds of rows:
     * <ul>
     * <li>a positive mark the AI or a person gave that still says PENDING (or nothing):
     * written before every writer set the status. A 0 is left as stored: an old row cannot
     * tell a blank answer (skipped) from a wrong one, and before 2026-11-19 it read as
     * skipped;</li>
     * <li>a status that is none of the four names, e.g. "evaluated", which the PDF evaluation
     * tool sent with every mark and the manual submit stored as given.</li>
     * </ul>
     * A row marked "not answered" is never re-read. Same rule as the report SQL in
     * StudentAttemptRepository.findParticipantsQuestionOverallDetails (CTE AttemptMarks).
     */
    public static boolean readsByMarks(String status, double marks, String source, String markState) {
        if (MarkState.NOT_ANSWERED.name().equals(markState)) return false;
        boolean pending = status == null || QuestionResponseEnum.PENDING.name().equals(status);
        if (pending) {
            return marks > 0 && source != null && JUDGED.contains(source);
        }
        return !isKnown(status);
    }

    /** The status a report shows for a stored row (see {@link #readsByMarks}). */
    public static String effective(String status, double marks, Double max, String source, String markState) {
        return effective(status, marks, max, source, markState, () -> null);
    }

    /**
     * As above; {@code paperMax} gives the question's max from the paper when the row has
     * none (rows written before max_marks existed, or by a writer that never set it), and is
     * only asked when the row is read by its marks.
     */
    public static String effective(String status, double marks, Double max, String source, String markState,
                                   Supplier<Double> paperMax) {
        if (!readsByMarks(status, marks, source, markState)) return status;
        Double m = max != null && max > 0 ? max : paperMax.get();
        return fromMarks(marks, m);
    }
}
