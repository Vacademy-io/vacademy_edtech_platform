import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { QuizSlidePayload, QuizSlideQuestion } from '../../../-hooks/use-slides';
import { Slide } from '../types';

// Helper function to create option structure
// Handles both form-format options ({ id, name, isSelected }) and
// backend-format options ({ id, text: { content }, ... })
const createOptionStructure = (option: any) => ({
    id: option.id || crypto.randomUUID(),
    quiz_slide_question_id: '',
    text: { id: option.text?.id || '', type: 'HTML', content: option.name || option.text?.content || '' },
    explanation_text: { id: '', type: 'HTML', content: '' },
    explanation_text_data: { id: '', type: 'HTML', content: '' }, // Added for backend compatibility
    media_id: '',
});

// Helper to get correct answer indices for MCQ/CMCQ/TRUE_FALSE
const getCorrectAnswerIndices = (question: any): number[] => {
    let opts = [];
    if (question.questionType === 'MCQS' || question.questionType === 'CMCQS') {
        opts = question.singleChoiceOptions || question.csingleChoiceOptions || [];
    } else if (question.questionType === 'MCQM' || question.questionType === 'CMCQM') {
        opts = question.multipleChoiceOptions || question.cmultipleChoiceOptions || [];
    } else if (question.questionType === 'TRUE_FALSE') {
        opts = question.trueFalseOptions || [];
    }
    return opts
        .map((opt: any, idx: number) => (opt.isSelected ? idx : null))
        .filter((idx: number | null) => idx !== null);
};

// Helper function to determine question response type and evaluation type
const getQuestionResponseConfig = (
    questionType: string
): { questionResponseType: string; evaluationType: string } => {
    switch (questionType) {
        case 'NUMERIC':
        case 'CNUMERIC':
            return { questionResponseType: 'NUMERIC', evaluationType: 'AUTO' };
        case 'LONG_ANSWER':
            return { questionResponseType: 'TEXT', evaluationType: 'MANUAL' };
        case 'ONE_WORD':
            return { questionResponseType: 'TEXT', evaluationType: 'AUTO' };
        default:
            return { questionResponseType: 'OPTION', evaluationType: 'AUTO' };
    }
};

// Helper function to transform options based on question type
// Handles both form-format (singleChoiceOptions etc.) and backend-format (options array)
const transformOptionsByType = (
    question: any
): Array<{
    id: string;
    quiz_slide_question_id: string;
    text: { id: string; type: string; content: string };
    explanation_text: { id: string; type: string; content: string };
    explanation_text_data: { id: string; type: string; content: string };
    media_id: string;
}> => {
    // Fallback: backend-format questions store options in question.options
    const backendOptions = question.options || [];
    const pick = (arr: any[], limit?: number) => {
        const src = arr && arr.length > 0 ? arr : backendOptions;
        return (limit ? src.slice(0, limit) : src).map(createOptionStructure);
    };
    switch (question.questionType) {
        case 'MCQS':
            return pick(question.singleChoiceOptions || []);
        case 'MCQM':
            return pick(question.multipleChoiceOptions || []);
        case 'CMCQS':
            return pick(question.csingleChoiceOptions || []);
        case 'CMCQM':
            return pick(question.cmultipleChoiceOptions || []);
        case 'TRUE_FALSE':
            return pick(question.trueFalseOptions || []);
        default:
            return pick(question.singleChoiceOptions || []);
    }
};

// Helper function to create auto evaluation JSON
// `transformedOptions` are the backend-format options (with stable IDs) produced by
// transformOptionsByType.  When available we store option **IDs** (strings) instead of
// positional indices so that the correct answer is independent of the order the DB
// returns options in.  The learner frontend already handles both formats.
const createAutoEvaluationJson = (question: any, transformedOptions?: any[]): string => {
    if (
        question.questionType === 'MCQS' ||
        question.questionType === 'MCQM' ||
        question.questionType === 'CMCQS' ||
        question.questionType === 'CMCQM' ||
        question.questionType === 'TRUE_FALSE'
    ) {
        const correctIndices = getCorrectAnswerIndices(question);
        if (correctIndices.length > 0) {
            // Map indices → option IDs when the transformed options are available
            if (transformedOptions && transformedOptions.length > 0) {
                const correctOptionIds = correctIndices
                    .map((idx: number) => transformedOptions[idx]?.id)
                    .filter(Boolean);
                if (correctOptionIds.length > 0) {
                    return JSON.stringify({ correctAnswers: correctOptionIds });
                }
            }
            // Fallback to indices if transformed options are not available
            return JSON.stringify({ correctAnswers: correctIndices });
        }
    }
    if (question.questionType === 'LONG_ANSWER' || question.questionType === 'ONE_WORD') {
        if (question.subjectiveAnswerText && question.subjectiveAnswerText.trim() !== '') {
            const autoEvaluationJson = JSON.stringify({
                data: {
                    answer:
                        question.questionType === 'LONG_ANSWER'
                            ? { content: question.subjectiveAnswerText }
                            : question.subjectiveAnswerText,
                },
            });
            return autoEvaluationJson;
        } else if (question.validAnswers && question.validAnswers.length > 0) {
            return JSON.stringify({ correctAnswers: question.validAnswers });
        }
    } else if (question.validAnswers && question.validAnswers.length > 0) {
        return JSON.stringify({ correctAnswers: question.validAnswers });
    }
    return '';
};

// Helper function to calculate question time in milliseconds
const calculateQuestionTimeInMillis = (question: any): number => {
    const duration = question.questionDuration;
    if (duration) {
        const hours = parseInt(duration.hrs || '0') * 60 * 60 * 1000; // Convert hours to milliseconds
        const minutes = parseInt(duration.min || '0') * 60 * 1000; // Convert minutes to milliseconds
        return hours + minutes;
    }
    return 0; // Default to 0 if no duration specified
};

// Helper function to create question structure
const createQuestionStructure = (
    question: any,
    questionOrder: number,
    options: any[],
    questionResponseType: string,
    evaluationType: string
): QuizSlideQuestion => {
    const explanationContent =
        question.explanation ||
        question.explanation_text_data?.content ||
        question.explanation_text?.content ||
        '';
    let textContent = question.questionName || '';
    let parentRichTextContent = '';
    let parentRichTextId = '';
    let textId = '';
    let textDataId = '';
    let explanationTextId = '';
    let explanationTextDataId = '';

    if (
        question.questionType === 'CMCQS' ||
        question.questionType === 'CMCQM' ||
        question.questionType === 'CNUMERIC'
    ) {
        parentRichTextContent =
            question.comprehensionText ||
            question.passage ||
            question.parentRichTextContent ||
            question.parent_rich_text?.content ||
            question.text?.content ||
            question.text_data?.content ||
            '';
        parentRichTextId =
            question.parent_rich_text?.id || question.parentRichTextId || crypto.randomUUID();
        // For comprehension types: questionName is the sub-question text; text.content is the sub-question too
        textContent = question.questionName || question.questionText || question.text?.content || '';
        textId = question.text?.id || question.textId || crypto.randomUUID();
        textDataId = question.text_data?.id || question.textDataId || crypto.randomUUID();
    } else {
        parentRichTextContent = '';
        parentRichTextId = crypto.randomUUID();
        // Fallback: backend-format questions have text.content instead of questionName
        textContent = question.questionName || question.questionText || question.text?.content || question.text_data?.content || '';
        textId = question.text?.id || question.textId || crypto.randomUUID();
        textDataId = question.text_data?.id || question.textDataId || crypto.randomUUID();
    }
    explanationTextId =
        question.explanation_text?.id || question.explanationTextId || crypto.randomUUID();
    explanationTextDataId =
        question.explanation_text_data?.id || question.explanationTextDataId || crypto.randomUUID();

    const questionStructure = {
        id: question.id || crypto.randomUUID(),
        parent_rich_text: {
            id: parentRichTextId,
            type: 'HTML',
            content: parentRichTextContent,
        },
        text: { id: textId, type: 'HTML', content: textContent },
        text_data: { id: textDataId, type: 'HTML', content: textContent },
        explanation_text: {
            id: explanationTextId,
            type: 'HTML',
            content: explanationContent,
        },
        explanation_text_data: {
            id: explanationTextDataId,
            type: 'HTML',
            content: explanationContent,
        },
        media_id: '',
        status: question.status || 'ACTIVE',
        question_response_type: questionResponseType,
        question_type: question.questionType,
        questionType: question.questionType, // Fix: Add questionType field for backend compatibility
        access_level: 'INSTITUTE',
        // Prefer freshly computed value; fall back to existing backend value to preserve correct answers
        // for backend-format passthrough (where option arrays are absent so computed value would be empty)
        auto_evaluation_json: createAutoEvaluationJson(question, options) || (question as any).auto_evaluation_json || '',
        evaluation_type: evaluationType,
        question_time_in_millis: calculateQuestionTimeInMillis(question),
        question_order: questionOrder,
        quiz_slide_id: '', // This will be set by the caller
        can_skip: question.canSkip || (question as any).can_skip || false,
        new_question: true, // Added for backend compatibility
        // Always null — the quiz-level marks_per_question is the single source of truth.
        // There is no per-question marks editor in the UI, so sending null ensures the
        // backend uses the quiz-level default consistently.
        marks: null,
        // Handle both camelCase (form-format) and snake_case (backend-format) negative_marking
        negative_marking: (question.negativeMarking ?? (question as any).negative_marking) != null
            ? (question.negativeMarking ?? (question as any).negative_marking)
            : (question.questionPenalty ? parseFloat(question.questionPenalty) : null),
        options: options,
    };

    return questionStructure;
};

// Helper function to transform form questions to backend format
// Handles both form-format questions (questionType camelCase, singleChoiceOptions etc.)
// and backend-format questions (question_type snake_case, options array) — the latter
// occurs when SaveDraft reads activeItem.quiz_slide.questions after a React-Query refetch
// replaces the store with fresh API data.
export const transformFormQuestionsToBackend = (
    questions: UploadQuestionPaperFormType['questions']
): QuizSlideQuestion[] => {
    // Deleting a question is a soft delete: the row stays in the array with status DELETED.
    // Only live questions may consume an order slot, otherwise the stored orders develop gaps
    // (delete the 3rd of 5 → 1,2,4,5). Deleted rows reuse the current counter; their order is
    // irrelevant to the backend since they are removed.
    let liveCount = 0;

    return questions.map((question) => {
        // Normalize: backend questions use snake_case question_type
        const questionType =
            question.questionType || (question as any).question_type || 'MCQS';
        const normalizedQuestion = { ...question, questionType };

        const { questionResponseType, evaluationType } = getQuestionResponseConfig(questionType);
        const options = transformOptionsByType(normalizedQuestion);

        const isDeleted = question.status === 'DELETED';
        const questionOrder = isDeleted ? liveCount + 1 : ++liveCount;

        return createQuestionStructure(
            normalizedQuestion,
            questionOrder,
            options,
            questionResponseType,
            evaluationType
        );
    });
};

export interface QuizSettings {
    timeLimitInMinutes?: number | null;
    marksPerQuestion?: number;
    negativeMarking?: number;
    partialMarking?: boolean;
    passPercentage?: number | null;
    reAttemptCount?: number | null;
}

// Helper function to create quiz slide payload for API
export const createQuizSlidePayload = (
    questions: UploadQuestionPaperFormType['questions'],
    activeItem: Slide,
    settings?: QuizSettings
): QuizSlidePayload => {
    const transformedQuestions = transformFormQuestionsToBackend(questions);

    const payload = {
        id: activeItem.id,
        source_id: activeItem.source_id || '',
        source_type: activeItem.source_type || 'QUIZ',
        title: activeItem.title || 'Quiz',
        image_file_id: activeItem.image_file_id || '',
        description: activeItem.description || '',
        status: activeItem.status || 'DRAFT',
        slide_order: activeItem.slide_order || 0,
        video_slide: null,
        document_slide: null,
        question_slide: null,
        assignment_slide: null,
        quiz_slide: {
            id: activeItem.quiz_slide?.id || crypto.randomUUID(),
            title: activeItem.quiz_slide?.title || activeItem.title || 'Quiz',
            description: activeItem.quiz_slide?.description || {
                id: '',
                content: '',
                type: 'TEXT',
            },
            time_limit_in_minutes:
                settings?.timeLimitInMinutes !== undefined
                    ? settings.timeLimitInMinutes
                    : (activeItem.quiz_slide?.time_limit_in_minutes ?? null),
            marks_per_question:
                settings?.marksPerQuestion !== undefined
                    ? settings.marksPerQuestion
                    : (activeItem.quiz_slide?.marks_per_question ?? 1),
            negative_marking:
                settings?.negativeMarking !== undefined
                    ? settings.negativeMarking
                    : (activeItem.quiz_slide?.negative_marking ?? 0),
            // null = "unchanged": the server keeps the stored setting
            partial_marking:
                settings?.partialMarking !== undefined
                    ? settings.partialMarking
                    : (activeItem.quiz_slide?.partial_marking ?? null),
            pass_percentage:
                settings?.passPercentage !== undefined
                    ? settings.passPercentage
                    : ((activeItem.quiz_slide as any)?.pass_percentage ?? null),
            re_attempt_count:
                settings?.reAttemptCount !== undefined
                    ? settings.reAttemptCount
                    : ((activeItem.quiz_slide as any)?.re_attempt_count ?? null),
            questions: transformedQuestions,
        },
        is_loaded: true,
        new_slide: false,
    };

    return payload;
};
