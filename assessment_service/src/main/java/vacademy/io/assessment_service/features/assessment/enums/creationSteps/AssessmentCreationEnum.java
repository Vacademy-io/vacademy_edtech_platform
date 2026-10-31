package vacademy.io.assessment_service.features.assessment.enums.creationSteps;


public enum AssessmentCreationEnum {

    SUBJECT_SELECTION,

    ASSESSMENT_URL,
    BOUNDATION_START_DATE,
    BOUNDATION_END_DATE,
    CAN_SWITCH_SECTION,
    ASSESSMENT_VISIBILITY,
    EXPECTED_PARTICIPANTS,
    OMR_MODE,
    EVALUATION_TYPE,
    SUBMISSION_TYPE,
    ASSESSMENT_PREVIEW,
    ADD_TIME_CONSENT,
    REATTEMPT_CONSENT,
    NAME,

    ASSESSMENT_ID,
    ASSESSMENT_MODE,
    INSTRUCTIONS,
    REATTEMPT_COUNT,
    RESULT_TYPE,
    // Automatic AI evaluation on submit (V43).
    AI_EVALUATION_ENABLED,
    AI_EVALUATION_MODEL,
    // Proctoring tier + knobs (V50).
    PROCTORING_CONFIG;
}
