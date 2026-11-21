package vacademy.io.assessment_service.features.open_registration.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentBatchRegistration;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.open_registration.dto.ParticipantPublicResponseDto;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A learner enrolled in a batch the assessment is assigned to counts as registered.
 *
 * <p>The learner app sends its package session ids as {@code psIds}. They were compared
 * with the assignment row's own id instead of its batch id, so an enrolled learner was
 * never recognised and, once registration had closed, could not continue from the link.
 */
class AssessmentBatchMembershipStatusTest {

    private static final String ASSESSMENT_ID = "assessment-1";
    private static final String INSTITUTE_ID = "institute-1";
    private static final String ASSIGNED_BATCH = "package-session-assigned";
    private static final String ASSIGNMENT_ROW_ID = "batch-registration-row-1";

    private AssessmentPublicPageManager manager;

    @BeforeEach
    void setUp() {
        AssessmentBatchRegistration assignment = new AssessmentBatchRegistration();
        assignment.setId(ASSIGNMENT_ROW_ID);
        assignment.setBatchId(ASSIGNED_BATCH);
        assignment.setInstituteId(INSTITUTE_ID);
        assignment.setStatus("ACTIVE");

        Assessment assessment = new Assessment();
        assessment.setId(ASSESSMENT_ID);
        assessment.setReattemptCount(2);
        assessment.getBatchRegistrations().add(assignment);

        AssessmentRepository assessmentRepository = mock(AssessmentRepository.class);
        when(assessmentRepository.findByAssessmentIdAndInstituteId(ASSESSMENT_ID, INSTITUTE_ID))
                .thenReturn(Optional.of(assessment));

        manager = new AssessmentPublicPageManager();
        manager.assessmentRepository = assessmentRepository;
    }

    private ParticipantPublicResponseDto statusFor(String psIds) {
        return manager.checkBatchRegistration(ASSESSMENT_ID, INSTITUTE_ID, "user-1", psIds).getBody();
    }

    @Test
    void learnerInTheAssignedBatchIsRegistered() {
        ParticipantPublicResponseDto status = statusFor(ASSIGNED_BATCH);

        assertThat(status.getIsAlreadyRegistered()).isTrue();
        assertThat(status.getRemainingAttempts()).isEqualTo(2);
    }

    @Test
    void assignedBatchAmongSeveralWithSpacesIsRegistered() {
        assertThat(statusFor("package-session-other, " + ASSIGNED_BATCH + " ").getIsAlreadyRegistered()).isTrue();
    }

    @Test
    void learnerInAnotherBatchIsNotRegistered() {
        assertThat(statusFor("package-session-other").getIsAlreadyRegistered()).isFalse();
    }

    @Test
    void assignmentRowIdIsNotABatch() {
        assertThat(statusFor(ASSIGNMENT_ROW_ID).getIsAlreadyRegistered()).isFalse();
    }

    @Test
    void noBatchesMeansNotRegistered() {
        assertThat(statusFor(null).getIsAlreadyRegistered()).isFalse();
        assertThat(statusFor("").getIsAlreadyRegistered()).isFalse();
        assertThat(statusFor(" , ").getIsAlreadyRegistered()).isFalse();
    }
}
