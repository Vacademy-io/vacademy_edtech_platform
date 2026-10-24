package vacademy.io.admin_core_service.features.engagement.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Teacher's view of how one item went.
 *
 * <p>Every field added after the first release is a boxed, nullable type: the admin UI
 * that is live today does not know about them, and a newer UI must tolerate an older
 * server that leaves them out.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EngagementTrackingDTO {
    private String itemId;
    private String title;
    private String itemType;
    private long completedCount;
    private long correctCount;
    private List<Row> rows;
    /** Paging over `rows`; the counts above are always for the whole item. */
    private int page;
    private int pageSize;
    private long totalRows;
    private int totalPages;

    // ── Added in the insight contract (all optional) ─────────────────────────

    /** The filter the rows were built with: ALL | DONE | NOT_DONE | STARTED | LATE; null = attempts only. */
    private String status;
    /** Learners with an ACTIVE enrolment in the plan's batch: the "of N" in "1 of 2". */
    private Long enrolledCount;
    /** Attempts opened but not finished (STARTED rows). */
    private Long startedCount;
    /** Enrolled learners who have neither opened nor finished the task. */
    private Long notDoneCount;
    /** Completed under catch-up. */
    private Long lateCount;
    /** Completed attempts that carry a correct / wrong verdict (a keyed MCQ). */
    private Long gradedCount;
    /** The item's score ceiling (games: declared max; flashcards: the card count). */
    private Integer maxScore;
    /**
     * MCQ and poll picks across the whole item (every page), completed attempts only.
     * Options from the payload come first in authored order, including those nobody
     * picked (count 0); ids no longer in the payload follow. Null for other types.
     */
    private List<OptionCount> optionCounts;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Row {
        private String userId;
        /** Hydrated from auth_service — admin_core has no users table to join. */
        private String fullName;
        private String username;
        private String email;
        /** STARTED | COMPLETED | SKIPPED, or NOT_STARTED for a synthesized not-done row. */
        private String status;
        private Boolean isCorrect;
        private Double score;
        private Integer pointsAwarded;
        private Boolean isLate;
        /** Client-reported; advisory only. Prefer serverTimeMs. */
        private Long timeSpentMs;
        private String completedAt;
        /** The written answer, when the format was TEXT. */
        private String textAnswer;
        /** Uploaded file ids, when the format was UPLOAD. */
        private List<String> fileIds;
        /** The option chosen, for MCQ/poll. */
        private String selectedOptionId;

        // ── Added in the insight contract (all optional) ─────────────────────

        /** Score ceiling for this attempt (flashcards: the deck size it was made against). */
        private Double maxScore;
        /** First time the learner opened the task (the STARTED row). */
        private String startedAt;
        /**
         * completedAt − startedAt, measured on the server. startedAt is the FIRST open
         * ever, so this reads "since first opened", not time on task.
         */
        private Long serverTimeMs;
        /** FLASHCARDS: cards rated "Got it" on the first pass. */
        private Integer flashcardsKnown;
        /** FLASHCARDS: cards in the deck the attempt was made against. */
        private Integer flashcardsTotal;
        /** FLASHCARDS: ids rated "Still learning". Fronts come from the item payload. */
        private List<String> learningCardIds;
    }

    /** One option's pick count. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OptionCount {
        private String optionId;
        private long count;
    }

    /** Batch-level view: how each learner is keeping up across the whole plan. */
    @Data
    @NoArgsConstructor
    public static class LearnerProgress {
        private String userId;
        private String fullName;
        private String username;
        private long completed;
        private long correct;
        private long pointsEarned;
        /**
         * Tasks whose window has closed with no catch-up left that this learner never
         * did. Tasks the daily cap hid from the learner are not counted.
         */
        private long missed;
        private String lastCompletedAt;

        // ── Added in the insight contract (all optional) ─────────────────────

        /** Tasks that have opened for this learner (cap-hidden ones excluded unless done). */
        private Long available;
        /** Completed tasks. */
        private Long done;
        /** Past the window end and not done, catch-up included (a superset of missed). */
        private Long overdue;
        /** NOT_STARTED (nothing done) | BEHIND (under half of available) | ON_TRACK. */
        @JsonProperty("class")
        private String learnerClass;

        public LearnerProgress(String userId, String fullName, String username, long completed,
                               long correct, long pointsEarned, long missed, String lastCompletedAt) {
            this.userId = userId;
            this.fullName = fullName;
            this.username = username;
            this.completed = completed;
            this.correct = correct;
            this.pointsEarned = pointsEarned;
            this.missed = missed;
            this.lastCompletedAt = lastCompletedAt;
        }
    }

    /** Completion for one scheduled day (the completion-by-day chart). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Day {
        /** yyyy-MM-dd in the plan's timezone. */
        private String date;
        /** Tasks that ran that day (cap-hidden ones excluded). */
        private long tasks;
        /** Learner-task completions filed under that day. */
        private long completed;
        /** Learner-task pairs that were due that day. */
        private long available;
        /** completed / available, 0..1; null when nothing was available. */
        private Double rate;
    }

    /** One task's completion across the batch (least-completed tasks, Wave 4). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskProgress {
        private String itemId;
        private String slotId;
        private String title;
        private String itemType;
        /** yyyy-MM-dd of the occurrence in effect (most recent opened run), or the next run. */
        private String runDate;
        /** UPCOMING | OPEN | CATCH_UP | CLOSED for that occurrence. */
        private String state;
        /** True when the institute's daily cap hides this task from learners that day. */
        private boolean capHidden;
        /** Enrolled learners who completed it. */
        private long completed;
        /** Enrolled learners who opened it but have not finished. */
        private long started;
        /** completed / enrolled learners, 0..1; null for an empty batch. */
        private Double rate;
    }

    @Data
    @NoArgsConstructor
    public static class PlanOverview {
        private String planId;
        private String title;
        /** Tasks whose window has already closed. */
        private long tasksClosed;
        private long tasksTotal;
        private long learners;
        /** Learners with at least one completion. */
        private long learnersActive;
        /**
         * Learners who need a nudge: NOT_STARTED or BEHIND with at least one task past
         * its window. (Was "3+ missed", which never fired on a short plan.)
         */
        private long learnersSlipping;
        private List<LearnerProgress> rows;

        // ── Added in the insight contract (all optional) ─────────────────────

        private Long notStarted;
        private Long behind;
        private Long onTrack;
        /** Tasks that have opened so far (cap-hidden ones excluded). 0 = the plan has not begun. */
        private Long tasksOpened;
        /** Tasks past their window end (catch-up or closed). */
        private Long tasksPastDue;
        /** Tasks the daily cap hides from learners on their day. */
        private Long tasksCapHidden;
        /** The institute's daily task cap the overview was computed with. */
        private Integer dailyItemCap;
        /** yyyy-MM-dd "today" in the plan's timezone. */
        private String today;
        /** Oldest first, up to today, at most the last 60 run days. */
        private List<Day> days;
        /** In schedule order. */
        private List<TaskProgress> tasks;
        /** Paging over `rows`; null when every row was returned. Tiles are always batch-wide. */
        private Integer page;
        private Integer pageSize;
        private Long totalRows;
        private Integer totalPages;

        public PlanOverview(String planId, String title, long tasksClosed, long tasksTotal, long learners,
                            long learnersActive, long learnersSlipping, List<LearnerProgress> rows) {
            this.planId = planId;
            this.title = title;
            this.tasksClosed = tasksClosed;
            this.tasksTotal = tasksTotal;
            this.learners = learners;
            this.learnersActive = learnersActive;
            this.learnersSlipping = learnersSlipping;
            this.rows = rows;
        }
    }

    /** One card's outcomes across every completed attempt. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CardStat {
        private String cardId;
        private String front;
        private String back;
        /** Completed attempts that rated this card. */
        private long studied;
        private long gotIt;
        private long stillLearning;
        /** stillLearning / studied, 0..1 (0 when nobody studied it). */
        private double stillLearningRate;
    }

    /** GET item/{id}/tracking/cards. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CardStats {
        private String itemId;
        /** The deck version the card text comes from. */
        private Integer version;
        /** Completed attempts on the item, across versions. */
        private long completedCount;
        /** In deck order. */
        private List<CardStat> cards;
        /** Outcomes recorded against card ids no longer in the deck. */
        private long removedOutcomes;
    }
}
