package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.Data;

/**
 * Authoring payload for one item.
 *
 * For QUESTION_OF_DAY the payload also carries the FORMAT:
 * {"format":"MCQ","options":[{"id":"a","text":"…"}],"correctOptionId":"a","explanation":"…"}
 * format is MCQ (default), TEXT (the learner writes an answer) or UPLOAD (the learner
 * attaches a document). Only MCQ has an answer key the server can grade; TEXT and
 * UPLOAD earn completion points and are read by the teacher in the tracking table.
 *
 * The key is stripped before the item ever reaches a learner and MCQ grading happens
 * server-side, which is what makes that format genuinely verifiable.
 *
 * FLASHCARDS: payloadJson is flashcards/v1 (see FlashcardsPayloadValidator). The server
 * validates and canonicalises it and IGNORES these request fields, forcing
 * correctPoints=0, hideResultUntilReveal=false, maxScore=cards.size() and
 * isVerifiable=false. Card ids are preserved across edits; send every card with its id.
 *
 * Every save must send ALL of the slot's items: an active item missing from the request
 * is removed (retireItemsNotIn).
 */
@Data
public class EngagementItemRequest {
    private String id;
    private String itemType;
    private String title;
    private Integer sortOrder;
    private Boolean isRequired;
    private String contentHtml;
    private String slideId;
    private String questionId;
    private String assessmentId;
    private String payloadJson;
    private Integer completionPoints;
    private Integer correctPoints;
    private Integer maxScore;
    /** Keep correctness (and the bonus) hidden until the slot's reveal time. */
    private Boolean hideResultUntilReveal;
    private String missPolicy;
    private Integer catchUpDays;
    private Integer catchUpPercent;
}
