package vacademy.io.assessment_service.features.assessment.service.creation;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.proctoring.service.ProctoringConfigService;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.enums.StepStatus;
import vacademy.io.assessment_service.features.assessment.enums.creationSteps.AssessmentCreationEnum;
import vacademy.io.assessment_service.features.assessment.service.IStep;
import vacademy.io.assessment_service.features.assessment.service.StepOption;
import vacademy.io.assessment_service.features.assessment.enums.ResultTypeEnum;
import vacademy.io.assessment_service.features.question_core.enums.EvaluationTypes;
import vacademy.io.assessment_service.features.question_core.enums.SubmissionTypes;

import java.util.*;


@Component
public class AssessmentBasicDetail extends IStep {

    @Autowired
    private ProctoringConfigService proctoringConfigService;

    @Override
    public void checkStatusAndFetchData(Optional<Assessment> assessment) {
        setStatus(StepStatus.INCOMPLETE.name());
        if (assessment.isEmpty()) return;
        setAssessmentType(assessment.get().getAssessmentType());

        Map<String, Object> savedData = new HashMap<>();
        savedData.put(AssessmentCreationEnum.ASSESSMENT_URL.name().toLowerCase(), getAssessmentUrlByInstituteId(this.getInstituteId(), assessment.get()));
        savedData.put(AssessmentCreationEnum.ASSESSMENT_ID.name().toLowerCase(), assessment.get().getId());
        savedData.put(AssessmentCreationEnum.ASSESSMENT_MODE.name().toLowerCase(), assessment.get().getPlayMode());
        savedData.put(AssessmentCreationEnum.NAME.name().toLowerCase(), assessment.get().getName());
        savedData.put(AssessmentCreationEnum.INSTRUCTIONS.name().toLowerCase(), assessment.get().getInstructions().toDTO());
        savedData.put(AssessmentCreationEnum.SUBMISSION_TYPE.name().toLowerCase(), assessment.get().getSubmissionType());
        savedData.put(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), assessment.get().getEvaluationType());
        savedData.put(AssessmentCreationEnum.ASSESSMENT_PREVIEW.name().toLowerCase(), assessment.get().getPreviewTime());
        savedData.put(AssessmentCreationEnum.ASSESSMENT_VISIBILITY.name().toLowerCase(), assessment.get().getAssessmentVisibility());
        savedData.put(AssessmentCreationEnum.OMR_MODE.name().toLowerCase(), assessment.get().getOmrMode());
        savedData.put(AssessmentCreationEnum.REATTEMPT_COUNT.name().toLowerCase(), assessment.get().getReattemptCount());
        savedData.put(AssessmentCreationEnum.EXPECTED_PARTICIPANTS.name().toLowerCase(), assessment.get().getExpectedParticipants());
        savedData.put(AssessmentCreationEnum.CAN_SWITCH_SECTION.name().toLowerCase(), assessment.get().getCanSwitchSection());
        savedData.put(AssessmentCreationEnum.ADD_TIME_CONSENT.name().toLowerCase(), assessment.get().getCanRequestTimeIncrease());
        savedData.put(AssessmentCreationEnum.REATTEMPT_CONSENT.name().toLowerCase(), assessment.get().getCanRequestReattempt());
        savedData.put(AssessmentCreationEnum.SUBJECT_SELECTION.name().toLowerCase(), getSubjectIdByInstituteId(this.getInstituteId(), assessment.get()));
        savedData.put(AssessmentCreationEnum.BOUNDATION_START_DATE.name().toLowerCase(), assessment.get().getBoundStartTime());
        savedData.put(AssessmentCreationEnum.BOUNDATION_END_DATE.name().toLowerCase(), assessment.get().getBoundEndTime());
        savedData.put(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), assessment.get().getResultType());
        // Echoed back so the Step-1 toggle shows its real saved state rather than
        // silently resetting to the default every time the wizard is reopened.
        savedData.put(AssessmentCreationEnum.AI_EVALUATION_ENABLED.name().toLowerCase(), assessment.get().getAiEvaluationEnabled());
        savedData.put(AssessmentCreationEnum.AI_EVALUATION_MODEL.name().toLowerCase(), assessment.get().getAiEvaluationModel());
        // Effective config (defaults filled, NONE when unset) so the wizard's picker
        // and the learner runtime read the same thing.
        savedData.put(AssessmentCreationEnum.PROCTORING_CONFIG.name().toLowerCase(), proctoringConfigService.effectiveConfig(assessment.get()));
        setSavedData(savedData);
        updateStatusForStep();
    }

    private void updateStatusForStep() {
        Boolean isComplete = isStepComplete(getSavedData());
        setStatus(isComplete ? StepStatus.COMPLETED.name() : StepStatus.INCOMPLETE.name());
    }

    private Optional<AssessmentInstituteMapping> getAssessmentUrlByInstituteIdAndAssessmentId(String instituteId, Assessment assessment) {
        return assessment.getAssessmentInstituteMappings().stream().filter(
                assessmentInstituteMapping -> assessmentInstituteMapping.getAssessment().equals(assessment) && assessmentInstituteMapping.getInstituteId().equals(instituteId)).findFirst();
    }

    private String getAssessmentUrlByInstituteId(String instituteId, Assessment assessment) {
        Optional<AssessmentInstituteMapping> assessmentInstituteMapping = getAssessmentUrlByInstituteIdAndAssessmentId(instituteId, assessment);
        return assessmentInstituteMapping.map(AssessmentInstituteMapping::getAssessmentUrl).orElse(null);
    }

    private String getSubjectIdByInstituteId(String instituteId, Assessment assessment) {
        Optional<AssessmentInstituteMapping> assessmentInstituteMapping = getAssessmentUrlByInstituteIdAndAssessmentId(instituteId, assessment);
        return assessmentInstituteMapping.map(AssessmentInstituteMapping::getSubjectId).orElse(null);
    }

    @Override
    public void fillStepKeysBasedOnAssessmentType(String type, String instituteId) {
        setStepName("Basic Info");
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
                // The missing break here handed every survey the manual-upload
                // exam's step keys (live-window dates required, result type).
                break;
            case "MANUAL_UPLOAD_EXAM":
                setStepKeys(getStepsForManualUploadExam());
                break;
        }


        this.getFieldOptions().put(AssessmentCreationEnum.SUBMISSION_TYPE.name().toLowerCase(), Arrays.stream(SubmissionTypes.values()).map((option) ->
                new StepOption(AssessmentCreationEnum.SUBMISSION_TYPE.name().toLowerCase(), option.name(), null, false)
        ).toList());

        this.getFieldOptions().put(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), Arrays.stream(EvaluationTypes.values()).map((option) ->
                new StepOption(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), option.name(), null, false)
        ).toList());

        this.getDefaultValues().put(AssessmentCreationEnum.SUBMISSION_TYPE.name().toLowerCase(), new StepOption(AssessmentCreationEnum.SUBMISSION_TYPE.name().toLowerCase(), SubmissionTypes.FILE.name(), null, false));
        this.getDefaultValues().put(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), new StepOption(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), EvaluationTypes.AUTO.name(), null, false));

        this.getDefaultValues().put(AssessmentCreationEnum.ASSESSMENT_PREVIEW.name().toLowerCase(), new StepOption(AssessmentCreationEnum.ASSESSMENT_PREVIEW.name().toLowerCase(), "FALSE", null, false));
        this.getDefaultValues().put(AssessmentCreationEnum.CAN_SWITCH_SECTION.name().toLowerCase(), new StepOption(AssessmentCreationEnum.CAN_SWITCH_SECTION.name().toLowerCase(), "TRUE", null, false));
        this.getDefaultValues().put(AssessmentCreationEnum.ADD_TIME_CONSENT.name().toLowerCase(), new StepOption(AssessmentCreationEnum.ADD_TIME_CONSENT.name().toLowerCase(), "TRUE", null, false));
        this.getDefaultValues().put(AssessmentCreationEnum.REATTEMPT_CONSENT.name().toLowerCase(), new StepOption(AssessmentCreationEnum.REATTEMPT_CONSENT.name().toLowerCase(), "TRUE", null, false));

        this.getFieldOptions().put(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), Arrays.stream(ResultTypeEnum.values()).map((option) ->
                new StepOption(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), option.name(), null, false)
        ).toList());
        this.getDefaultValues().put(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), new StepOption(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), ResultTypeEnum.MANUAL.name(), null, false));

    }

    private List<Map<String, String>> getStepsForExam() {
        return List.of(Map.of(AssessmentCreationEnum.BOUNDATION_START_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.SUBJECT_SELECTION.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.BOUNDATION_END_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.CAN_SWITCH_SECTION.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_VISIBILITY.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EXPECTED_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.OMR_MODE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.SUBMISSION_TYPE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_PREVIEW.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ADD_TIME_CONSENT.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.REATTEMPT_CONSENT.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForMock() {

        return List.of(
                Map.of(AssessmentCreationEnum.SUBJECT_SELECTION.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.CAN_SWITCH_SECTION.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_VISIBILITY.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EXPECTED_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.OMR_MODE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_PREVIEW.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ADD_TIME_CONSENT.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.REATTEMPT_COUNT.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForSurvey() {
        return List.of(
                // A survey may be given a live window, but does not need one — declared
                // OPTIONAL so Step 1 renders both inputs without an asterisk and without
                // blocking "Next". Omitting them entirely (as this did) hid the inputs
                // while the admin form still demanded their values, which left "Next"
                // permanently disabled on every new survey.
                Map.of(AssessmentCreationEnum.BOUNDATION_START_DATE.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.BOUNDATION_END_DATE.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.SUBJECT_SELECTION.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_VISIBILITY.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EXPECTED_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.REATTEMPT_COUNT.name().toLowerCase(), "REQUIRED"));

    }

    private List<Map<String, String>> getStepsForPractice() {
        return List.of(
                Map.of(AssessmentCreationEnum.SUBJECT_SELECTION.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_VISIBILITY.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EXPECTED_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.OMR_MODE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EVALUATION_TYPE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_PREVIEW.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.REATTEMPT_COUNT.name().toLowerCase(), "REQUIRED"));
    }

    private List<Map<String, String>> getStepsForManualUploadExam() {
        return List.of(Map.of(AssessmentCreationEnum.BOUNDATION_START_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.SUBJECT_SELECTION.name().toLowerCase(), "OPTIONAL"),
                Map.of(AssessmentCreationEnum.BOUNDATION_END_DATE.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.ASSESSMENT_VISIBILITY.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.EXPECTED_PARTICIPANTS.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.REATTEMPT_CONSENT.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.REATTEMPT_COUNT.name().toLowerCase(), "REQUIRED"),
                Map.of(AssessmentCreationEnum.RESULT_TYPE.name().toLowerCase(), "REQUIRED"));

    }

    private Boolean isStepComplete(Map<String, Object> savedData) {

        for (Map<String, String> entry : getStepKeys()) {
            for (Map.Entry<String, String> stepKey : entry.entrySet()) {
                if (stepKey.getValue().equals("OPTIONAL")) continue;
                if (!savedData.containsKey(stepKey.getKey())) {
                    return false;
                }
            }
        }

        return true;
    }


}