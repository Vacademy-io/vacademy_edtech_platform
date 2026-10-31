package vacademy.io.admin_core_service.features.quiz_results.dto;

/**
 * One learner's answer to one question on their latest attempt.
 *
 * <p>{@code responseStatus} is only sometimes a verdict: the quiz viewer used to send the
 * placeholder {@code "SUBMITTED"} for every question, and most stored rows still carry it.
 * The service re-grades those from {@code responseJson} against the question's answer key
 * rather than reading them as zero.
 */
public interface QuizResponseProjection {
    String getSlideId();
    String getUserId();
    String getQuestionId();
    String getResponseStatus();
    String getResponseJson();
}
