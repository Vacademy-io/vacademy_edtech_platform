package vacademy.io.assessment_service.features.submission_review.model;

/** Stored state of one answer's mark (question_wise_marks.mark_state, spec 3). */
public enum MarkState { NOT_ANSWERED, NEEDS_MARKING, AI_DRAFT, MARKED }
