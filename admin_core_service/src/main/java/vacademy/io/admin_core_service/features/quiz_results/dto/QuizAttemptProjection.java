package vacademy.io.admin_core_service.features.quiz_results.dto;

import java.sql.Timestamp;

/**
 * One learner's standing on one quiz: the latest attempt (whose responses are the ones
 * that count) plus how many attempts there have been in total.
 */
public interface QuizAttemptProjection {
    String getSlideId();
    String getUserId();

    /** activity_log id of the LATEST attempt. */
    String getActivityId();

    /** engaged time on the latest attempt, milliseconds. */
    Long getEngagedMs();

    /** every attempt, re-attempts included. */
    Long getAttemptCount();

    Timestamp getLastAttemptAt();
}
