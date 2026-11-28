package vacademy.io.assessment_service.features.question_core.enums;

public enum QuestionTypes {
    MCQS,
    ONE_WORD,
    LONG_ANSWER,
    TRUE_FALSE,
    MATCH,
    MCQM,
    FILL_IN_THE_BLANK,
    NUMERIC,
    CODING,
    CBE_RESPONSE, // ACCA-style spreadsheet & written response; config in auto_evaluation_json, see docs/CBE_RESPONSE_QUESTION.md
}
