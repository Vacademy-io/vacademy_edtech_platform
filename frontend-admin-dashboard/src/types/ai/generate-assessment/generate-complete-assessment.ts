interface RichText {
    id: string | null;
    type: string;
    content: string;
}

interface Option {
    id: string | null;
    preview_id: string;
    question_id: string | null;
    text: RichText;
    media_id: string | null;
    option_order: number | null;
    created_on: string | null;
    updated_on: string | null;
    explanation_text: string | null;
}

export interface AIAssessmentCompleteQuestion {
    id: string | null;
    preview_id: string | null;
    section_id: string | null;
    question_order_in_section: number | null;
    text: RichText;
    media_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    question_response_type: string;
    question_type: string;
    access_level: string;
    auto_evaluation_json: string;
    options_json: string | null;
    parsed_evaluation_object: string | null;
    evaluation_type: string | null;
    explanation_text: RichText;
    default_question_time_mins: number | null;
    parent_rich_text_id: string | null;
    parent_rich_text: RichText | null;
    options: Option[];
    errors: string[];
    warnings: string[];
    tags: string[];
    level: string;
    /** Vsmart Extract: the paper's section the question was printed under, and its printed marks. */
    section_name?: string | null;
    marks?: number | null;
    negative_marks?: number | null;
}

/** A section the paper prints, as found at upload / after extraction. */
export interface AIPaperSection {
    name: string;
    count: number;
    from?: number | null;
    to?: number | null;
    marks?: number | null;
    negative_marks?: number | null;
    instruction?: string | null;
    /** Time the paper allows for this section, when it says so. */
    duration_minutes?: number | null;
}

export interface AIPaperMarking {
    marks: number | null;
    negative_marks: number | null;
}

/** How a paper was digitised (Vsmart Extract only); absent for generated papers. */
export interface AIExtractionSummary {
    parts: number;
    key_parts: number;
    questions: number;
    key_found: boolean;
    keyed: number;
    unkeyed: number;
    explained: number;
    /** Question numbers the teacher should look at (e.g. options the model dropped and the paper text could not restore). */
    check?: string[];
    key_source?: 'regex' | 'regex+model' | 'none';
    ocr_pages?: number;
    /** The paper's sections and how the teacher asked for them: one assessment section each, or all in one. */
    sections?: AIPaperSection[];
    section_mode?: 'split' | 'single';
    marking?: AIPaperMarking | null;
    /** Time the paper allows in all, when it says so (or the sum of its sections' times). */
    duration_minutes?: number | null;
    credits: number | null;
    prompt_tokens: number;
    completion_tokens: number;
}

export interface AIAssessmentResponseInterface {
    title: string;
    tags: string[];
    difficulty: string;
    description: string | null;
    subjects: string[];
    classes: string[];
    questions: AIAssessmentCompleteQuestion[];
    extraction?: AIExtractionSummary | null;
}

export interface AITaskIndividualListInterface {
    id: string;
    task_name: string;
    institute_id: string;
    parent_id: string;
    status: string; // Add more status values as needed
    result_json: string;
    input_id: string;
    input_type: string; // PROMPT_ID | PDF_ID | IMAGE_ID | AUDIO_ID | ...
    // AiTaskType (TEXT_TO_QUESTIONS, LECTURE_PLANNER, ...). Optional because the
    // legacy media_service TaskStatusDto never carried it; ai_service does.
    type?: string;
    created_at: string; // ISO datetime string
    updated_at: string; // ISO datetime string
    file_detail: {
        id: string;
        url: string;
        file_name: string;
        file_type: string;
        source: string;
        source_id: string;
        expiry: string; // ISO datetime string
        width: number;
        height: number;
        created_on: string; // ISO datetime string
        updated_on: string; // ISO datetime string
    } | null; // Making file_detail potentially null if a task might not have one
}

interface TimeWiseSection {
    sectionHeading: string;
    timeSplit: string;
    content: string;
    topicCovered: string[];
    questionToStudents: string[];
    activity: string[];
}

interface Assignment {
    topicCovered: string[];
    tasks: string[];
}

export interface PlanLectureDataInterface {
    heading: string;
    mode: string;
    duration: string;
    language: string;
    level: string;
    timeWiseSplit: TimeWiseSection[];
    assignment: Assignment;
    summary: string[];
}

export interface AILectureFeedbackInterface {
    title: string;
    reportTitle: string;
    lectureInfo: LectureInfo;
    totalScore: string; // or number, depending on usage
    criteria: EvaluationCriterion[];
    summary: string[];
}

export interface LectureInfo {
    lectureTitle: string;
    duration: string;
    evaluationDate: string;
}

export interface EvaluationCriterion {
    name: string;
    score: string; // or number
    points: CriterionPoint[];
    scopeOfImprovement: string[];
}

export interface CriterionPoint {
    title: string;
    description: string[];
}
