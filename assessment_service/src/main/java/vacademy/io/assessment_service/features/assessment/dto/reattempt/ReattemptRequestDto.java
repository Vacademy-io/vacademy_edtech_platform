package vacademy.io.assessment_service.features.assessment.dto.reattempt;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * One row of the admin inbox.
 *
 * <p>Carries the learner's name/email and the assessment title alongside the request so the
 * screen can render without an N+1 lookup per row.
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReattemptRequestDto {

    private String id;
    private String assessmentId;
    private String assessmentName;
    private String instituteId;
    private String userId;
    private String registrationId;
    private String attemptId;
    private String requestType;
    private String reason;
    private String status;
    private Integer grantedCount;
    private String reviewedBy;
    private String reviewNote;
    private Date reviewedAt;
    private Date createdAt;

    private String participantName;
    private String userEmail;
    private String phoneNumber;

    /** Total attempts the learner is allowed right now, so the admin can judge the ask. */
    private Integer attemptsAllowed;
    /** Attempts already taken. */
    private Integer attemptsUsed;
    /** PROBLEM_REPORT only: the reported question, when it was matched to this assessment. */
    private String questionId;
    /** Admin inbox only: the reported question's section name. */
    private String questionSectionName;
    /** Admin inbox only: the question's position in its section in the paper (1-based). */
    private Integer questionNumber;
    /** Admin inbox only: the start of the question text, without markup. */
    private String questionText;
}
