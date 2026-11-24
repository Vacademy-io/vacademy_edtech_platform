package vacademy.io.admin_core_service.features.learner_tracking.service;

/**
 * Where one learner's AI analysis of an assessment stands, in the terms a caller timing a
 * message needs: READY (made), PENDING (the hourly scheduler will still make it), GAVE_UP
 * (it will not be made on its own) or NONE (no analysis row).
 *
 * <p>Mirrors {@link ActivityLogProcessorService}: the scheduler takes 'raw' and 'failed'
 * rows with fewer than three attempts; 'processing' is in flight; 'skipped_no_credits' and
 * 'skipped_usage_limit' wait for an admin; 'on_demand' waits for a report to ask for it.
 */
public enum AssessmentAnalysisState {
    READY, PENDING, GAVE_UP, NONE;

    /** Must match ActivityLogProcessorService.MAX_PROCESSING_ATTEMPTS. */
    static final int MAX_PROCESSING_ATTEMPTS = 3;

    public static AssessmentAnalysisState of(String status, int processingAttempts) {
        if (status == null) {
            return NONE;
        }
        return switch (status) {
            case "processed" -> READY;
            case "raw", "processing" -> PENDING;
            case "failed" -> processingAttempts < MAX_PROCESSING_ATTEMPTS ? PENDING : GAVE_UP;
            case "skipped_no_credits", "skipped_usage_limit", "on_demand" -> GAVE_UP;
            // An unknown status is treated as still in progress; the caller's own time
            // limit decides when to stop waiting.
            default -> PENDING;
        };
    }
}
