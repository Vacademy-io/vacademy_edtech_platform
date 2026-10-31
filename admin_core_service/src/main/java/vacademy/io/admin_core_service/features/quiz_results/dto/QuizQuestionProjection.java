package vacademy.io.admin_core_service.features.quiz_results.dto;

/**
 * One active question with its answer key. Text is only selected for the single-quiz
 * analysis view (see {@code includeText}); the overview needs the key and the marks only.
 */
public interface QuizQuestionProjection {
    String getSlideId();
    String getQuestionId();
    Integer getQuestionOrder();
    String getQuestionType();
    String getQuestionResponseType();

    /** Rich text (HTML + KaTeX); flattened before it leaves the server. */
    String getTextContent();

    String getExplanationContent();

    Double getMarks();

    /** The quiz's partial-marking setting, repeated on each of its questions. */
    Boolean getPartialMarking();

    String getAutoEvaluationJson();
}
