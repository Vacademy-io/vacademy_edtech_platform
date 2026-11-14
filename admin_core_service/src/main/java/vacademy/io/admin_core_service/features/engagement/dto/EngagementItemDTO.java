package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One card in the learner feed.
 *
 * For a LOCKED (upcoming) item the content fields are deliberately left NULL — see
 * {@code EngagementLearnerService.toLearnerDto}. Shipping tomorrow's payload and
 * hiding it in the UI puts tomorrow's answer one devtools panel away.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EngagementItemDTO {
    private String id;
    private String slotId;
    private String planId;
    private String packageSessionId;
    /** Batch name, so a learner in several batches can tell the cards apart. */
    private String packageSessionName;
    private String itemType;
    private String title;
    private Integer version;
    private Integer sortOrder;
    private Boolean isRequired;

    // Content — NULL unless the item is currently openable by this learner.
    private String contentHtml;
    private String slideId;
    private String questionId;
    private String assessmentId;
    private String payloadJson;

    private Integer completionPoints;
    private Integer correctPoints;
    private Integer maxScore;

    /** UPCOMING | OPEN | CATCH_UP | CLOSED */
    private String state;
    /** The local date this occurrence runs on (yyyy-MM-dd). */
    private String runDate;
    /** ISO instants for the learner's countdown. */
    private String opensAt;
    private String closesAt;
    private String revealAt;
    private Boolean isRevealed;
    /** Points kept on a late completion (100 while OPEN). */
    private Integer pointsPercent;
    /** Outcome is withheld until revealAt. */
    private Boolean hideResultUntilReveal;

    // This learner's progress.
    private String attemptStatus;
    private Boolean isCorrect;
    /** True when isCorrect is deliberately withheld until revealAt. */
    private Boolean resultPending;
    private Integer pointsAwarded;
    private Boolean isLate;
    private String completedAt;
    /** History only: DONE, MISSED or CATCH_UP. */
    private String historyStatus;

    /** Social proof: how many learners have completed it. */
    private Long completedCount;

    // Admin plan view only (null in learner responses): the per-task schedule
    // overrides, so an editor can send them back unchanged instead of dropping them.
    private String missPolicy;
    private Integer catchUpDays;
    private Integer catchUpPercent;
    /** Admin plan view: active learners in the batch, the denominator for completedCount. */
    private Long learnerCount;

    // Present only on REVEALED entries — the answer key travels here, never on a
    // live item.
    private String correctOptionId;
    private String explanation;
    /** The learner's own pick; set on any COMPLETED attempt (it is their own answer). */
    private String selectedOptionId;

    // ── Learner contract (WP-2A). Every field is optional and additive. ─────────

    /** The learner's own written answer (TEXT question), on a COMPLETED attempt. */
    private String textAnswer;
    /** The learner's own attached file ids (UPLOAD question), on a COMPLETED attempt. */
    private java.util.List<String> fileIds;

    /**
     * What finishing now can still earn, catch-up percent applied: completion plus the
     * bonus when {@link #scoreBonusEnabled}. 0 once completed. For a GAME it is the
     * ceiling ("up to"), the bonus scaling with the score.
     */
    private Integer earnablePoints;
    /** Completion points after the catch-up percent (what "+N now" pays), until completed. */
    private Integer effectivePoints;
    /**
     * Bonus points that only arrive at the reveal (hide-until-reveal items). Before
     * answering: what a right answer adds at the reveal. After answering and before the
     * reveal: the same amount, without saying whether the answer was right. Null otherwise.
     */
    private Integer pendingBonus;
    /**
     * Whether correctPoints can actually be earned here: a keyed multiple-choice question
     * whose answer is not out yet, or a game whose score is trusted (verifiable, or the
     * institute allows unverified bonuses). Always false for flashcards, polls, readings,
     * written and uploaded answers and lessons.
     */
    private Boolean scoreBonusEnabled;
    /**
     * COURSE_SLIDE, still to do: the slide's own progress already reads as finished, so a
     * submit will succeed. Computed read-only; no attempt is created for it.
     */
    private Boolean claimable;
    /** Plain-text glimpse of a reading or visual note, at most 160 characters. */
    private String excerpt;
    /** Plain text of a question or poll prompt (the payload's rich text, tags removed). */
    private String promptText;
    /**
     * POLL, once this learner has voted and the result may be shown: the vote split in
     * authored option order. Null while fewer than 5 votes exist (see responseCount).
     */
    private java.util.List<PollResult> pollResults;
    /** How many learners have answered (polls and revealed questions). */
    private Long responseCount;
    /** Revealed keyed questions: share of answers that were right, 0..1; null under 5 answers. */
    private Double correctRate;
    /** CATCH_UP rows: when the catch-up window closes (ISO instant). */
    private String catchUpClosesAt;
    /** READING_HTML / VISUAL_NOTE: the server's dwell gate, measured from the first open. */
    private Long minReadMs;
    /** READING_HTML / VISUAL_NOTE: the scroll depth the submit must report. */
    private Integer minScrollPercent;
    /** GAME / QUIZ: minimum play time, measured by the server from the first open. */
    private Long minGameMs;
    /** The first open of this task (the STARTED row), ISO instant, when it exists. */
    private String startedAt;
    /** Server clock at response time (epoch ms), set on GET item, to align countdowns. */
    private Long serverTimeMs;
    /** The answer was given at or after the reveal: completion points only. */
    private Boolean answerAlreadyOut;
    /** FLASHCARDS with a COMPLETED attempt: what the learner recorded. */
    private FlashcardsResult flashcardsResult;

    /** One option's share of the votes (only sent once at least 5 learners voted). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PollResult {
        private String optionId;
        private Long count;
        /** Whole percent 0..100; the list sums to 100 (largest remainder). */
        private Integer percent;
    }

    /** A completed flashcards session, from the stored server-built response. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlashcardsResult {
        /** The deck version the learner studied. */
        private Integer version;
        private Integer known;
        private Integer total;
        /** Cards first rated "Still learning", in deck order. */
        private java.util.List<String> learningCardIds;
    }
}
