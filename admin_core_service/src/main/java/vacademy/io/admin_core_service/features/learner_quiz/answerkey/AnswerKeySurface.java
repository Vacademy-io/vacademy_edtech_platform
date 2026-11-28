package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

/** Which switch governs a response that can carry correct answers. */
public enum AnswerKeySurface {
    /** Public previews and catalogue pages. Nothing here grades. */
    OPEN,
    /** A signed-in learner. Older app versions grade from this data until they are replaced. */
    LEARNER,
    /** Authoring reads: staff keep the answers, anyone else does not. */
    AUTHORING
}
