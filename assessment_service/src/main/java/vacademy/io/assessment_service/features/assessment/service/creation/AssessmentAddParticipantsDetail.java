package vacademy.io.assessment_service.features.assessment.service.creation;

import org.hibernate.Hibernate;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.StepStatus;
import vacademy.io.assessment_service.features.assessment.enums.creationSteps.ParticipantsCreationEnum;
import vacademy.io.assessment_service.features.assessment.enums.creationSteps.QuestionCreationEnum;
import vacademy.io.assessment_service.features.assessment.service.IStep;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class AssessmentAddParticipantsDetail extends IStep {

    private List<Map<String, String>> getStepsForManualUploadExam() {
        return List.of(
                Map.of(QuestionCreationEnum.MARKS_PER_QUESTION.name().toLowerCase(), "REQUIRED"),
                Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

    @Override
    public void checkStatusAndFetchData(Optional<Assessment> assessment) {
        setStatus(StepStatus.INCOMPLETE.name());
        if (assessment.isEmpty()) return;
        setAssessmentType(assessment.get().getAssessmentType());

        Map<String, Object> savedData = new HashMap<>();
        savedData.put(ParticipantsCreationEnum.PRE_BATCH_REGISTRATIONS.name().toLowerCase(), assessment.get().getBatchRegistrations());
        savedData.put(ParticipantsCreationEnum.PRE_USER_REGISTRATIONS.name().toLowerCase(), assessment.get().getUserRegistrations().size());
        Hibernate.initialize(assessment.get().getAssessmentCustomFields());
        savedData.put(ParticipantsCreationEnum.REGISTRATION_FORM_FIELDS.name().toLowerCase(), assessment.get().getAssessmentCustomFields());
        savedData.put(ParticipantsCreationEnum.REGISTRATION_OPEN_DATE.name().toLowerCase(), assessment.get().getRegistrationOpenDate());
        savedData.put(ParticipantsCreationEnum.REGISTRATION_CLOSE_DATE.name().toLowerCase(), assessment.get().getRegistrationCloseDate());
        savedData.put(ParticipantsCreationEnum.NOTIFICATIONS.name().toLowerCase(), assessment.get().getAssessmentNotificationMetadata());
        setSavedData(savedData);

        if (assessment.get().getRegistrationOpenDate() != null && assessment.get().getRegistrationCloseDate() != null) {
            setStatus(StepStatus.COMPLETED.name());
        } else if (assessment.get().getUserRegistrations().size() + assessment.get().getBatchRegistrations().size() > 0) {
            setStatus(StepStatus.COMPLETED.name());
        }
    }

    @Override
    public void fillStepKeysBasedOnAssessmentType(String type, String instituteId) {
        setStepName("Add Participants");
        setInstituteId(instituteId);
        setStatus(StepStatus.INCOMPLETE.name());
        setType(type);
        switch (type) {
            case "EXAM":
                setStepKeys(getStepsForExam());
                break;
            case "MOCK":
                setStepKeys(getStepsForMock());
                break;
            case "PRACTICE":
                setStepKeys(getStepsForPractice());
                break;
            case "SURVEY":
                setStepKeys(getStepsForSurvey());
                break;
            case "MANUAL_UPLOAD_EXAM":
                setStepKeys(getStepsForManualUploadExam());
                break;
        }
    }

    private List<Map<String, String>> getStepsForExam() {
        // Todo: get steps based on saved assessment
        return List.of(Map.of(ParticipantsCreationEnum.PUBLIC_REGISTRATIONS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.PRIVATE_REGISTRATIONS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_SELECT_BATCH.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_SELECT_STUDENT.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_LINK.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_SELECT_BATCH.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_SELECT_STUDENT.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_LINK.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_OPEN_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_CLOSE_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_FORM_FIELDS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.NOTIFY_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.NOTIFY_PARENTS.name().toLowerCase(), "REQUIRED")

        );
    }

    private List<Map<String, String>> getStepsForMock() {
        return List.of(Map.of(ParticipantsCreationEnum.PUBLIC_REGISTRATIONS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.PRIVATE_REGISTRATIONS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_SELECT_BATCH.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_SELECT_STUDENT.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_LINK.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_SELECT_BATCH.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_SELECT_STUDENT.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_LINK.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_OPEN_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_CLOSE_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_FORM_FIELDS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.NOTIFY_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.NOTIFY_PARENTS.name().toLowerCase(), "REQUIRED")

        );
    }

    /**
     * Step 3 renders each control only when its key is declared REQUIRED, so the
     * single PROBLEM_RANDOMIZATION entry this used to return (copied from the
     * questions step) left the Add Participants step **completely blank** for a
     * survey: no Open/Closed choice, no batch or learner picker, no share link,
     * no registration form. A survey could not be given participants at all.
     *
     * The registration window is deliberately absent rather than REQUIRED: a
     * survey does not need one, and AssessmentPublicPageManager reads an unset
     * window as "no limit on that side".
     */
    private List<Map<String, String>> getStepsForSurvey() {
        return List.of(Map.of(ParticipantsCreationEnum.PUBLIC_REGISTRATIONS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.PRIVATE_REGISTRATIONS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_SELECT_BATCH.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_SELECT_STUDENT.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.CLOSED_LINK.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_SELECT_BATCH.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_SELECT_STUDENT.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.OPEN_LINK.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.REGISTRATION_FORM_FIELDS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.NOTIFY_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(ParticipantsCreationEnum.NOTIFY_PARENTS.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForPractice() {
        return List.of(Map.of(QuestionCreationEnum.PROBLEM_RANDOMIZATION.name().toLowerCase(), "REQUIRED"));
    }

}