package vacademy.io.assessment_service.features.submission_review.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * After-commit work of a mark edit, on its own thread and transaction: release an attempt
 * the edit completed (contract 6.4) and send an updated result asked for with the edit (6.5).
 */
@Slf4j
@Component
public class SubmissionReviewListeners {

    private final SubmissionReleaseService releaseService;

    public SubmissionReviewListeners(SubmissionReleaseService releaseService) {
        this.releaseService = releaseService;
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onReadyForRelease(ReviewEvents.AttemptReadyForRelease event) {
        try {
            releaseService.releaseWhenMarked(event.attemptId(), event.actorUserId());
        } catch (Exception e) {
            log.error("[submission-review] release-when-marked failed for attempt {}", event.attemptId(), e);
        }
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onSendUpdate(ReviewEvents.SendUpdateRequested event) {
        try {
            releaseService.sendUpdate(event.attemptId(), event.actorUserId());
        } catch (Exception e) {
            log.error("[submission-review] send update failed for attempt {}", event.attemptId(), e);
        }
    }
}
