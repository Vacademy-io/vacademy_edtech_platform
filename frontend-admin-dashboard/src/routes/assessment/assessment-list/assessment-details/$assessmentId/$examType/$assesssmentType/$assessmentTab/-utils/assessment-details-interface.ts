import type { CbeConfig } from '@/components/cbe/types';
interface TextContent {
    id: number | null;
    type: string;
    content?: string;
}

interface Option {
    id: number | null;
    preview_id: number;
    question_id: number | null;
    text: TextContent;
    media_id: string;
    option_order: number | null;
    created_on: string | null;
    updated_on: string | null;
    explanation_text: TextContent;
}

interface Question {
    id: number | null;
    preview_id?: string;
    text: TextContent;
    media_id: string;
    created_at: string | null;
    updated_at: string | null;
    question_response_type: string | null;
    question_type?: string;
    access_level: string | null;
    auto_evaluation_json: string; // JSON string representation
    evaluation_type: string | null;
    explanation_text: TextContent;
    default_question_time_mins: number;
    options?: Option[];
    errors: string[];
    warnings: string[];
}

export interface AssessmentDetailQuestions {
    questions: Question[];
}

interface ImageDetails {
    imageId?: string;
    imageName?: string;
    imageTitle?: string;
    imageFile?: string;
    isDeleted?: boolean;
}

interface ChoiceOption {
    name?: string;
    isSelected?: boolean;
    image?: ImageDetails;
}

interface QuestionDuration {
    hrs: string;
    min: string;
}

export interface AssessmentSectionQuestionInterface {
    id: string;
    questionId?: string;
    questionName?: string;
    explanation?: string;
    questionType?: string;
    questionPenalty: string;
    questionDuration: QuestionDuration;
    questionMark: string;
    imageDetails?: ImageDetails[];
    singleChoiceOptions?: ChoiceOption[];
    multipleChoiceOptions?: ChoiceOption[];
    /** Passage / CBE scenario (parent_rich_text). */
    parentRichTextContent?: string | null;
    /** CBE_RESPONSE config, full (docs/CBE_RESPONSE_QUESTION.md §3). */
    cbeConfig?: CbeConfig | null;
}

interface QuestionMarking {
    question_id?: string;
    marking_json: string;
    question_duration_in_min: number;
    question_order: number;
    is_added: boolean;
    is_deleted: boolean;
    is_updated: boolean;
}

export interface AssessmentSection {
    section_description_html: string | { id: string; type: string; content: string };
    section_name: string;
    section_id: string;
    section_duration: number;
    section_order: number;
    total_marks: number;
    cutoff_marks: number;
    problem_randomization: boolean;
    question_and_marking: QuestionMarking[];
}

interface TestDuration {
    entire_test_duration?: number;
    distribution_duration?: string;
}

export interface AssessmentPreviewSectionsInterface {
    added_sections: AssessmentSection[];
    updated_sections: AssessmentSection[];
    deleted_sections: AssessmentSection[];
    test_duration: TestDuration;
}

//tranforming questions for helper

interface transformSectionsAndQuestionsDataQuestionText {
    id: string;
    type: 'HTML' | string;
    content: string;
}

interface transformSectionsAndQuestionsDataExplanationText {
    id: string | null;
    type: string | null;
    content: string | null;
}

interface transformSectionsAndQuestionsDataOption {
    id: string;
    preview_id: string | null;
    question_id: string;
    text: transformSectionsAndQuestionsDataQuestionText;
    media_id: string | null;
    option_order: number | null;
    created_on: string;
    updated_on: string;
    explanation_text: transformSectionsAndQuestionsDataExplanationText;
}

interface transformSectionsAndQuestionsDataInterface {
    question_id: string;
    parent_rich_text: {
        type: string;
        id: string;
        content: string;
    } | null;
    question: transformSectionsAndQuestionsDataQuestionText;
    section_id: string;
    question_duration: number;
    question_order: number;
    marking_json: string;
    evaluation_json: string;
    question_type: string;
    options: transformSectionsAndQuestionsDataOption[];
    options_json: string;
    options_with_explanation: transformSectionsAndQuestionsDataOption[];
}

export interface transformSectionsAndQuestionsDataQuestionsData {
    [sectionId: string]: transformSectionsAndQuestionsDataInterface[];
}

export interface StudentLeaderboardEntry {
    userId: string;
    rank: string;
    name: string;
    batch: string;
    percentile: string;
    scoredMarks: number;
    totalMarks: number;
}

export interface PreBatchRegistration {
    id: string;
    batchId: string;
    instituteId: string;
    registrationTime: string;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface calculateAverageMarksQuestionInterface {
    questionId: string;
    questionName: string;
    questionType: string;
    questionMark: string;
    questionPenalty: string;
    questionDuration: {
        hrs: string;
        min: string;
    };
}

export interface SectionInfoWithAddedQuestionsCnt {
    sectionId?: string;
    sectionName?: string;
    questions?: number;
}

export type SectionInfoWithAddedQuestionsCntOrNull = SectionInfoWithAddedQuestionsCnt | null;

interface ChoiceOptionWithAddedQuestions {
    name?: string;
    isSelected?: boolean;
}

interface QuestionDuration {
    hrs: string;
    min: string;
}

interface AssignedQuestion {
    questionId?: string;
    questionName: string;
    explanation?: string;
    questionType: string;
    questionPenalty: string;
    questionDuration: QuestionDuration;
    questionMark: string;
    singleChoiceOptions: ChoiceOptionWithAddedQuestions[];
    multipleChoiceOptions: ChoiceOptionWithAddedQuestions[];
    id: string;
}

export interface SectionInfoWithAddedQuestions {
    sectionId?: string;
    sectionName?: string;
    questions?: number;
    assignedQuestions: AssignedQuestion[];
}

// Question Insights Interface

interface QuestionInsightsContent {
    id: string;
    type: string | null;
    content: string | null;
}

interface QuestionInsightsOption {
    id: string;
    preview_id: string | null;
    question_id: string;
    text: QuestionInsightsContent;
    media_id: string | null;
    option_order: number | null;
    created_on: string;
    updated_on: string;
    explanation_text: QuestionInsightsContent;
}

interface QuestionInsightsQuestion {
    id: string;
    type: string;
    content: string;
}

interface AssessmentQuestionPreviewDTO {
    question_id: string;
    parent_rich_text: {
        type: string;
        id: string;
        content: string;
    } | null;
    question: QuestionInsightsQuestion;
    section_id: string;
    question_duration: number;
    question_order: number;
    marking_json: string;
    evaluation_json: string;
    question_type: string;
    options: QuestionInsightsOption[];
    options_json: string;
    options_with_explanation: QuestionInsightsOption[];
}

export interface QuestionInsightsQuestionStatus {
    incorrectAttempt: number;
    partialCorrectAttempt: number;
    questionId: string;
    correctAttempt: number;
}

interface QuestionInsightsTop3Interface {
    timeTakenInSeconds: number;
    userId: string;
    name: string;
}

export interface QuestionInsightDTO {
    assessment_question_preview_dto: AssessmentQuestionPreviewDTO;
    question_status: QuestionInsightsQuestionStatus;
    skipped: number;
    total_attempts: number;
    top3_correct_response_dto: QuestionInsightsTop3Interface[];
}

export interface QuestionInsightResponse {
    question_insight_dto: QuestionInsightDTO[];
}
