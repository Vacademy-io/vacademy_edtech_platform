package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Result of a submit: what was scored, what was awarded, what to celebrate.
 *
 * Built with the builder; every field added after the first release is optional, and
 * a client that does not know one simply ignores it.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EngagementSubmitResponse {
    private String attemptId;
    private String status;
    private Boolean isCorrect;
    private Integer pointsAwarded;
    private Boolean isLate;
    private Boolean isVerified;
    /** Answers only travel once the reveal time has passed. */
    private Boolean isRevealed;
    private String correctOptionId;
    private String explanation;
    /**
     * The learner's new running total, so the UI can animate it without a refetch.
     * Null only when the ledger could not be read; the submit itself still stands.
     */
    private Long newTotalPoints;
    /**
     * The answer is in, but the outcome is being withheld until the reveal time.
     * isCorrect and the bonus are both absent while this is true.
     */
    private Boolean resultPending;

    // ── Added by the learner contract (WP-2A) ───────────────────────────────

    /**
     * True when the task was already COMPLETED before this call (a retry, a double tap,
     * or a lost race): nothing new was recorded or awarded, and the fields describe the
     * earlier attempt. The client must not celebrate it again.
     */
    private Boolean alreadyCompleted;
    /**
     * The answer was given at or after the reveal: isCorrect is recorded, but only
     * completion points (times any catch-up percent) are paid.
     */
    private Boolean answerAlreadyOut;
    /**
     * POLL only, once the result may be shown: the vote split in authored option order.
     * Null while fewer than 5 learners have voted (see responseCount).
     */
    private List<EngagementItemDTO.PollResult> pollResults;
    /** POLL: how many learners have voted, including this one. */
    private Long responseCount;
    /** FLASHCARDS only: the server-built summary of what was just recorded. */
    private EngagementItemDTO.FlashcardsResult flashcardsResult;
}
