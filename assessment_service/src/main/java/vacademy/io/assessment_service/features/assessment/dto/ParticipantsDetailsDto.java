package vacademy.io.assessment_service.features.assessment.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.Date;


@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public interface ParticipantsDetailsDto {
    String getRegistrationId();

    String getAttemptId();

    String getStudentName();

    Date getAttemptDate();

    Date getEndTime();

    Long getDuration();

    Double getScore();

    String getUserId();

    String getBatchId();

    String getEvaluationStatus();

    String getReportReleaseResultStatus();

    Date getLastReportReleaseDate();

    String getUserEmail();

    /**
     * Contact details, so every participants list can show how to reach a learner rather
     * than only naming them. Backed by columns {@code assessment_user_registration} has
     * always carried, and populated in practice: on this institute's 1,320 registrations
     * only 7 are missing a phone number and none are missing an email or username.
     *
     * <p>Every native query behind this projection aliases these — see the repository. A
     * query that stopped selecting one would silently start reporting null, i.e. an empty
     * column, so add them to any new query too.
     */
    String getPhoneNumber();

    String getUsername();

}
