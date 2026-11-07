package vacademy.io.assessment_service.features.open_evaluation.support;

import java.util.Locale;

/**
 * Internal state → public status of the partner API (spec 8.1, 8.2). One place, so every
 * endpoint and (later) every webhook says the same thing.
 */
public final class PublicStatus {

    // submission
    public static final String QUEUED = "queued";
    public static final String PROCESSING = "processing";
    public static final String READING = "reading";
    public static final String GRADING = "grading";
    public static final String GRADED = "graded";
    public static final String PARTIALLY_GRADED = "partially_graded";
    public static final String FAILED = "failed";
    public static final String CANCELLED = "cancelled";

    // exam
    public static final String EXAM_DRAFT = "draft";
    public static final String EXAM_OPEN = "open";
    public static final String EXAM_FINALIZED = "finalized";
    public static final String EXAM_DELETED = "deleted";

    private PublicStatus() {
    }

    /**
     * Public status of a submission from its latest {@code ai_evaluation_process.status}.
     *
     * @param processStatus      latest process status; null = no AI run (typed, all objective)
     * @param anyQuestionFailed  for COMPLETED: at least one question row ended FAILED
     */
    public static String submission(String processStatus, boolean anyQuestionFailed) {
        if (processStatus == null || processStatus.isBlank()) {
            return GRADED; // typed with only objective questions: marked without an AI run
        }
        return switch (processStatus.trim().toUpperCase(Locale.ROOT)) {
            case "PENDING", "STARTED", "DISPATCHED", "REQUEUED" -> QUEUED;
            case "PROCESSING" -> PROCESSING;
            case "EXTRACTING" -> READING;
            case "EVALUATING", "GRADING", "IN_PROGRESS" -> GRADING;
            case "COMPLETED" -> anyQuestionFailed ? PARTIALLY_GRADED : GRADED;
            case "FAILED" -> FAILED;
            case "CANCELLED" -> CANCELLED;
            default -> PROCESSING; // an unknown in-flight state is still in flight
        };
    }

    /**
     * Public status of an exam.
     *
     * @param assessmentStatus {@code assessment.status} (DRAFT, PUBLISHED, DELETED)
     * @param allFinalized     every submission is finalized (only meaningful when open)
     */
    public static String exam(String assessmentStatus, boolean allFinalized) {
        if (assessmentStatus == null) {
            return EXAM_DRAFT;
        }
        return switch (assessmentStatus.trim().toUpperCase(Locale.ROOT)) {
            case "PUBLISHED" -> allFinalized ? EXAM_FINALIZED : EXAM_OPEN;
            case "DELETED" -> EXAM_DELETED;
            default -> EXAM_DRAFT;
        };
    }
}
