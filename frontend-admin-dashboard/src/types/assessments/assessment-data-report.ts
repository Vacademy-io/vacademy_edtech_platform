interface Option {
    option_id: string; // UUID
    option_name: string;
}

export interface ReportQuestion {
    question_id: string; // UUID
    question_name: string;
    question_order?: number | null;
    // The stored response JSON (question_wise_marks.response_json) for every type;
    // older payloads sent an Option[]. Read with parseStudentAnswer.
    student_response_options: Option[] | string | null;
    // The question's auto_evaluation_json; older payloads sent an Option[].
    // Read with parseCorrectAnswer.
    correct_options: Option[] | string | null;
    question_type?: string;
    explanation_id: string; // UUID
    explanation: string;
    mark: number;
    time_taken_in_seconds: number;
    answer_status: string;
    evaluator_feedback?: string | null;
    ai_feedback?: string | null;
}

interface AllSections {
    [sectionId: string]: ReportQuestion[]; // Dynamic section ID as key
}

interface QuestionOverallDetailDTO {
    submitTime: string;
    completionTimeInSeconds: number;
    totalCorrectMarks: number;
    totalIncorrectMarks: number;
    rank: number;
    achievedMarks: number;
    percentile: number;
    wrongAttempt: number;
    skippedCount: number;
    totalPartialMarks: number;
    startTime: string; // ISO date string
    subjectId: string; // UUID
    attemptId: string; // UUID
    correctAttempt: number;
    partialCorrectAttempt: number;
    userId: string; // UUID
}

export interface AssessmentTestReport {
    all_sections: AllSections;
    question_overall_detail_dto: QuestionOverallDetailDTO;
}
