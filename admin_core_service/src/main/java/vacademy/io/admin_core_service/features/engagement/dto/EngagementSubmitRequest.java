package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.Data;

/** A learner completing an item. */
@Data
public class EngagementSubmitRequest {
    /** QUESTION_OF_DAY: the chosen option id. */
    private String selectedOptionId;
    /** GAME/QUIZ: the self-reported score. Clamped server-side to the item's max_score. */
    private Double score;
    /**
     * Free-form per-type response payload, stored as-is for the teacher's tracking view.
     * Ignored for FLASHCARDS, whose stored response is built by the server.
     */
    private String responseJson;
    /** Advisory only: the reading and game gates use the server's clock from the first open. */
    private Long timeSpentMs;
    /** READING_HTML: how far the learner scrolled, 0-100. */
    private Integer scrollPercent;
    /** QUESTION_OF_DAY, format TEXT: what the learner wrote. */
    private String textAnswer;
    /** QUESTION_OF_DAY, format UPLOAD: ids of the files the learner attached. */
    private java.util.List<String> fileIds;
    /**
     * FLASHCARDS: one first rating per card of the current deck. Missing, duplicate or
     * unknown card ids are refused (FLASHCARDS_INCOMPLETE).
     */
    private java.util.List<FlashcardOutcome> cardOutcomes;
    /**
     * FLASHCARDS: the deck version the learner studied (the item's {@code version}). A
     * different version is refused (FLASHCARDS_STALE) so the client reloads the deck.
     */
    private Integer itemVersion;
}
