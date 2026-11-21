package vacademy.io.assessment_service.features.submission_review.service;

/** Events the submission review publishes for after-commit work. */
public final class ReviewEvents {
    private ReviewEvents() {
    }

    /** A teacher's edit completed the marking of an attempt that should now be released. */
    public record AttemptReadyForRelease(String attemptId, String actorUserId) {
    }

    /** "Send updated result" asked together with an edit of a released result. */
    public record SendUpdateRequested(String attemptId, String actorUserId) {
    }
}
