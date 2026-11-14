export interface QuizPreviewProps {
    activeItem: Slide;
    routeParams?: {
        chapterId?: string;
        moduleId?: string;
        subjectId?: string;
        sessionId?: string;
        courseId?: string;
        levelId?: string;
    };
}

export interface BackendQuestion {
    id: string;
    parent_rich_text?: { content: string };
    text?: { content: string };
    text_data?: { content: string };
    questionName?: string;
    question_type?: string;
    question_response_type?: string;
    penalty?: string;
    mark?: string;
    status?: string;
    auto_evaluation_json?: string;
    explanation?: string;
    explanation_text?: { content: string };
    explanation_text_data?: { content: string }; // Added to match backend payload
    can_skip?: boolean;
    canSkip?: boolean;
    tags?: string[];
    marks?: number | null;
    negative_marking?: number | null;
    options?: Array<{ id?: string; text?: { content: string }; content?: string }>;
}

export interface TransformedQuestion {
    questionName: string;
    questionType: string;
    questionPenalty: string;
    questionDuration: { min: string; hrs: string };
    questionMark: string;
    id: string;
    status?: string;
    validAnswers?: (number | string)[] | null;
    explanation?: string;
    canSkip?: boolean;
    tags?: string[];
    level?: string;
    questionPoints?: string;
    reattemptCount?: string;
    decimals?: number;
    numericType?: string;
    parentRichTextContent?: string | null;
    singleChoiceOptions?: Array<{ id: string; name: string; isSelected: boolean }>;
    multipleChoiceOptions?: Array<{ id: string; name: string; isSelected: boolean }>;
    trueFalseOptions?: Array<{ id: string; name: string; isSelected: boolean }>;
    csingleChoiceOptions?: Array<{ id: string; name: string; isSelected: boolean }>;
    cmultipleChoiceOptions?: Array<{ id: string; name: string; isSelected: boolean }>;
    subjectiveAnswerText?: string;
    marks?: number | null;
    negativeMarking?: number | null;
}

export interface QuestionTypeProps {
    icon: React.ReactNode;
    text: string;
    type?: string;
    handleAddQuestion: (type: string) => void;
}

// Define Slide interface locally to avoid import issues
export interface Slide {
    id: string;
    source_id: string;
    source_type: string;
    title: string;
    image_file_id: string;
    description: string;
    status: string;
    slide_order: number;
    video_slide?: any | null;
    document_slide?: any | null;
    question_slide?: any | null;
    assignment_slide?: any | null;
    quiz_slide?: {
        id: string;
        title: string;
        description: { id: string; content: string; type: string };
        time_limit_in_minutes?: number | null;
        marks_per_question?: number;
        negative_marking?: number;
        partial_marking?: boolean | null;
        questions?: BackendQuestion[];
    } | null;
    is_loaded: boolean;
    new_slide: boolean;
}
