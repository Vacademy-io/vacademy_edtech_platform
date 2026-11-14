package vacademy.io.admin_core_service.features.engagement.entity;

/** Shared vocabulary for the daily-engagement feature. Stored as strings. */
public final class EngagementEnums {

    private EngagementEnums() {}

    public enum PlanStatus { DRAFT, PUBLISHED, ARCHIVED, DELETED }

    public enum SlotStatus { ACTIVE, DELETED }

    public enum ItemStatus {
        ACTIVE,
        /** Superseded by a newer version after an edit to an already-open item. */
        RETIRED,
        DELETED
    }

    public enum ItemType {
        READING_HTML,
        VISUAL_NOTE,
        QUESTION_OF_DAY,
        QUIZ,
        GAME,
        POLL,
        /**
         * An existing slide from the course library, assigned as a task.
         *
         * The slide is NOT re-rendered inside engagement — the learner is sent to it
         * in the study library, where every slide type already works. Completion is
         * then read back from the learner's own slide progress rather than tracked a
         * second time here, so a lesson finished the ordinary way also finishes the
         * task.
         */
        COURSE_SLIDE,
        /**
         * A deck of cards the learner flips and self-rates (Got it / Still learning).
         *
         * payload_json is {@code flashcards/v1} — see FlashcardsPayloadValidator for the
         * contract. The deck is plain text rendered natively (never an iframe), and it
         * pays COMPLETION points only: the self-rating is honest-effort, not graded, so
         * the server forces isVerifiable=false, hideResultUntilReveal=false,
         * correctPoints=0 and maxScore=cards.size() on every save. No migration: the
         * item_type column is varchar(48) with no CHECK constraint.
         */
        FLASHCARDS
    }

    /** What happens to an item a learner never opened while it was live. */
    public enum MissPolicy {
        /** Gone at end_time. The strongest hook. */
        EXPIRES,
        /** Attemptable for catch_up_days at full points. */
        CATCH_UP_FULL,
        /** Attemptable for catch_up_days at catch_up_percent of points. */
        CATCH_UP_REDUCED
    }

    public enum AttemptStatus { STARTED, COMPLETED, SKIPPED }
}
