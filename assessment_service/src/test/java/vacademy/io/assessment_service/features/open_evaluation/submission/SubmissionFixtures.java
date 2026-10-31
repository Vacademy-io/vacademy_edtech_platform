package vacademy.io.assessment_service.features.open_evaluation.submission;

import java.math.BigDecimal;
import java.time.Instant;

/** Builds {@link ApiSubmissionStore.SubmissionView} rows for tests. */
public final class SubmissionFixtures {

    public static final Instant CREATED = Instant.parse("2026-10-01T10:00:00Z");

    private SubmissionFixtures() {
    }

    /** A mutable builder over the view's many columns. */
    public static class View {
        public String attemptId = "sub-1";
        public String examId = "exam-1";
        public String state = "LIVE";
        public String mode = "handwritten";
        public Integer pages = 12;
        public String reviewReasons;
        public Instant approvedAt;
        public String release = "PENDING";
        public Instant releasedAt;
        public String evaluatedFileId;
        public String processId = "p-1";
        public String processStatus = "PENDING";
        public String step;
        public Integer done;
        public Integer total;
        public String error;
        public BigDecimal quoted = new BigDecimal("12.00");
        public Instant processCreated = CREATED;
        public Instant processStarted;
        public Instant processCompleted;
        public String lane = "COPY";
        public long runs = 1;
        public boolean anyFailed;
        public boolean questionNeedsReview;
        public String metadata;

        public ApiSubmissionStore.SubmissionView build() {
            return new ApiSubmissionStore.SubmissionView(attemptId, examId, "cand-1", "inst-1", "key-1", state, mode,
                    "up-1", pages, metadata, reviewReasons, approvedAt, null, CREATED, CREATED.plusSeconds(5),
                    "STU-1", "Aarav Mehta", "10A07", release, releasedAt, evaluatedFileId, "PENDING", processId,
                    processStatus, step, done, total, error, quoted, processCreated, processStarted, processCompleted,
                    lane, pages, "inst-1", runs, anyFailed, questionNeedsReview, 4);
        }
    }

    public static View view() {
        return new View();
    }
}
