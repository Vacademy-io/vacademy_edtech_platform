package vacademy.io.assessment_service.features.assessment.dto.batch_pending;

import vacademy.io.assessment_service.features.assessment.dto.ParticipantsDetailsDto;

import java.util.Date;

/**
 * A batch-enrolled learner who has not attempted the assessment, shaped as a
 * {@link ParticipantsDetailsDto} so the Pending tab reuses the existing table, row
 * mapping and response envelope.
 *
 * <p>Everything attempt-shaped is null on purpose: these learners have no
 * {@code assessment_user_registration} row and no {@code student_attempt} row — that
 * absence IS the reason they appear here. Consumers must treat a null
 * {@code registrationId}/{@code attemptId} as "never started", not as missing data.
 */
public class NotAttemptedParticipantDto implements ParticipantsDetailsDto {

    private final String userId;
    private final String studentName;
    private final String batchId;
    // Contact details, so the Pending tab can show the same "how do I reach this learner"
    // columns its own CSV export already carries. The tab and the export answer the same
    // question and must not disagree about what they know. Any of these can be null for a
    // learner imported without one — that is a blank cell, not a missing row.
    private final String userEmail;
    private final String phoneNumber;
    private final String username;

    public NotAttemptedParticipantDto(String userId, String studentName, String batchId,
                                      String userEmail, String phoneNumber, String username) {
        this.userId = userId;
        this.studentName = studentName;
        this.batchId = batchId;
        this.userEmail = userEmail;
        this.phoneNumber = phoneNumber;
        this.username = username;
    }

    /**
     * Identity only, no contact details — for callers (and tests) that care about who is on
     * the list rather than how to reach them. Kept explicit so widening the constructor
     * doesn't silently break every existing three-arg call site.
     */
    public NotAttemptedParticipantDto(String userId, String studentName, String batchId) {
        this(userId, studentName, batchId, null, null, null);
    }

    @Override
    public String getUserId() {
        return userId;
    }

    @Override
    public String getStudentName() {
        return studentName;
    }

    @Override
    public String getBatchId() {
        return batchId;
    }

    @Override
    public String getUserEmail() {
        return userEmail;
    }

    @Override
    public String getPhoneNumber() {
        return phoneNumber;
    }

    @Override
    public String getUsername() {
        return username;
    }

    // --- No attempt exists, so nothing attempt-derived can be reported. ---

    @Override
    public String getRegistrationId() {
        return null;
    }

    @Override
    public String getAttemptId() {
        return null;
    }

    @Override
    public Date getAttemptDate() {
        return null;
    }

    @Override
    public Date getEndTime() {
        return null;
    }

    @Override
    public Long getDuration() {
        return null;
    }

    @Override
    public Double getScore() {
        return null;
    }

    @Override
    public String getEvaluationStatus() {
        return null;
    }

    @Override
    public String getReportReleaseResultStatus() {
        return null;
    }

    @Override
    public Date getLastReportReleaseDate() {
        return null;
    }
}
