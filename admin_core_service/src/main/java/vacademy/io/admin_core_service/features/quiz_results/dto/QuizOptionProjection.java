package vacademy.io.admin_core_service.features.quiz_results.dto;

/** One option of a quiz question, in the order positional answer keys index into. */
public interface QuizOptionProjection {
    String getOptionId();
    String getQuestionId();
    String getTextContent();
}
