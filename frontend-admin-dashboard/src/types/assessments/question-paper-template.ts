import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { Dispatch, ReactNode, SetStateAction } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;
export interface QuestionPaperTemplateProps {
    form: UseFormReturn<QuestionPaperForm>;
    questionPaperId: string | undefined;
    isViewMode: boolean;
    refetchData?: () => void;
    isManualCreated?: boolean;
    buttonText: ReactNode;
    isAssessment?: boolean;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    examType?: string;
    // View-mode trigger style: 'plain' is the borderless label used inside menus,
    // 'secondary' is a bordered action button for card rows.
    triggerVariant?: 'plain' | 'secondary';
    // Optional controlled mode. When `open` is passed the parent owns the dialog
    // state, and `hideTrigger` drops the built-in trigger button.
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
    // Create flow only: called instead of closing when Save passes the quick
    // validation check, so the parent can save the paper straight away.
    onValidSave?: () => void;
}

export interface QuestionData {
    questionId: number;
    questionHtml: string;
    explanationHtml: string;
    answerOptionIds: string[];
    optionsData: OptionData[];
    errors: string[];
    warnings: string[];
}

export interface OptionData {
    optionId: number;
    optionHtml: string;
}

export interface QuestionPaperInterface {
    id: string; // Unique identifier for the paper
    title: string; // Title of the paper
    status: string; // Status with possible values
    level_id: string | null; // Level ID, nullable
    subject_id: string | null; // Subject ID, nullable
    description: string | null; // Description, nullable
    created_on: string; // ISO 8601 timestamp of creation
    updated_on: string; // ISO 8601 timestamp of last update
    created_by_user_id: string; // ID of the user who created the paper
}

export interface PaginatedResponse {
    content: QuestionPaperInterface[];
    page_no: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    last: boolean;
}

export interface Subject {
    id: string;
    subject_name: string;
    subject_code: string;
    credit: number | null;
    created_at: string;
    updated_at: string;
}

export interface Level {
    id: string;
    level_name: string;
    duration_in_days: number | null;
}

interface TextContent {
    id: string;
    type: string | null;
    content: string | null;
}

interface ExplanationText {
    id: string | null;
    type: string | null;
    content: string | null;
}

export interface OptionText {
    id: string;
    preview_id: string | null;
    question_id: string;
    text: TextContent;
    media_id: string | null;
    option_order: number | null;
    created_on: string;
    updated_on: string;
    explanation_text: ExplanationText;
}

export interface QuestionResponse {
    id: string | null;
    preview_id: string | null;
    section_id: string | null;
    section_order: number | null;
    question_time_in_millis?: number;
    text: TextContent;
    text_data?: TextContent;
    media_id: string | null;
    created_at: string;
    updated_at: string;
    question_response_type: string;
    question_type: string;
    access_level: string;
    auto_evaluation_json: string;
    options_json: string | null;
    evaluation_type: string;
    explanation_text: ExplanationText;
    explanation_text_data?: ExplanationText;
    /** Where a question came from (e.g. KNOWLEDGE_BASE) — assessment_service V42. */
    source_type?: string | null;
    /** JSON provenance for KNOWLEDGE_BASE questions: kb_id, generation_id, marks, section, page. */
    source_meta?: string | null;
    new_question?: boolean;
    default_question_time_mins: number | null;
    options: OptionText[];
    parent_rich_text: TextContent | null;
    status: string;
    can_skip: boolean;
    subject_tags?: string[];
    errors: string[];
    warnings: string[];
}

export interface QuestionPaperInterface {
    id: string;
    title: string;
    comma_separated_subject_ids: string;
    institute_id: string;
    level_id: string | null;
    subject_id: string | null;
    tags: string[]; // Array of strings
    description_id: string;
    created_by_user_id: string;
    questions: QuestionResponse[];
}
