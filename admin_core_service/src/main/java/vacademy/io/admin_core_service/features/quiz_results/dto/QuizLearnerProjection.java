package vacademy.io.admin_core_service.features.quiz_results.dto;

/** One enrolled learner of the batch, whether or not they have attempted anything. */
public interface QuizLearnerProjection {
    String getUserId();
    String getFullName();
    String getEmail();
    String getMobileNumber();
    String getEnrollmentStatus();
}
