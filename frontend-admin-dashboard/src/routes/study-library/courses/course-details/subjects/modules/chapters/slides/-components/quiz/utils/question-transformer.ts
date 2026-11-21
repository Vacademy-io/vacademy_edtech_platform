import { BackendQuestion, TransformedQuestion } from '../types';
import { readNumericTolerance } from '@/routes/assessment/question-papers/-utils/numeric-tolerance';
import {
    cbeConfigFromEvaluationJson,
    cbeQuestionMark,
    isCbeQuestionType,
} from '@/routes/assessment/question-papers/-utils/cbe-question';
import { cbeTotalMarks } from '@/components/cbe/types';

// Helper function to parse auto_evaluation_json
// Returns an array that may contain numeric indices OR string option IDs (UUIDs).
export const parseValidAnswers = (question: BackendQuestion): (number | string)[] => {
    try {
        if (question.auto_evaluation_json) {
            const evaluationData = JSON.parse(question.auto_evaluation_json);
            return evaluationData.correctAnswers || [];
        }
    } catch (error) {
        console.warn('[QuizPreview] Failed to parse auto_evaluation_json:', error);
    }
    return [];
};

// Helper function to get question text
export const getQuestionText = (question: BackendQuestion): string => {
    return (
        question.parent_rich_text?.content ||
        question.text?.content ||
        question.text_data?.content ||
        question.questionName ||
        ''
    );
};

// Helper function to transform options
// validAnswers may contain numeric indices (legacy) OR string option IDs (new UUID format).
export const transformOptions = (
    options: BackendQuestion['options'],
    validAnswers: (number | string)[]
): Array<{ id: string; name: string; isSelected: boolean }> => {
    if (!options || options.length === 0) return [];

    // Detect format: if the first entry is a string, match by option ID; otherwise by index.
    const matchById = validAnswers.length > 0 && typeof validAnswers[0] === 'string';
    const answerStrings = validAnswers.map(String);

    return options.map((opt, idx: number) => ({
        id: opt.id || `opt-${idx}`,
        name: opt.text?.content || opt.content || '',
        isSelected: matchById
            ? answerStrings.includes(String(opt.id))
            : validAnswers.includes(idx),
    }));
};

// Helper function to extract subjective answer from auto_evaluation_json
const extractSubjectiveAnswer = (question: BackendQuestion, questionType: string): string => {
    if (!question.auto_evaluation_json) return '';

    try {
        const evaluationData = JSON.parse(question.auto_evaluation_json);

        let subjectiveAnswerText = '';
        if (questionType === 'ONE_WORD') {
            subjectiveAnswerText = evaluationData?.data?.answer || evaluationData?.answer || '';
        } else if (questionType === 'LONG_ANSWER') {
            subjectiveAnswerText =
                evaluationData?.data?.answer?.content ||
                evaluationData?.answer?.content ||
                evaluationData?.answer ||
                '';
        }

        return subjectiveAnswerText;
    } catch (error) {
        console.warn('[QuizPreview] Failed to parse auto_evaluation_json:', error);
        return '';
    }
};

// Helper function to create base transformed question
const createBaseTransformedQuestion = (
    question: BackendQuestion | any,
    questionText: string,
    questionType: string,
    validAnswers: (number | string)[]
): TransformedQuestion => {
    // Prefer explanation_text_data, then explanation_text, then explanation
    const explanation =
        (question.explanation_text_data && question.explanation_text_data.content) ||
        (question.explanation_text && question.explanation_text.content) ||
        question.explanation ||
        '';

    // For comprehension types, set questionName to passage and ensure parentRichTextContent is set from parent_rich_text.content if present
    let finalQuestionName = questionText;
    let parentRichTextContent = '';
    if (
        (questionType === 'CMCQS' || questionType === 'CMCQM' || questionType === 'CNUMERIC') &&
        (question.parent_rich_text?.content ||
            question.comprehensionText ||
            question.passage ||
            question.text?.content ||
            question.text_data?.content)
    ) {
        parentRichTextContent =
            question.parent_rich_text?.content ||
            question.comprehensionText ||
            question.passage ||
            question.text?.content ||
            question.text_data?.content ||
            '';
        finalQuestionName = question.text?.content || question.questionName || '';
    } else {
        parentRichTextContent = '';
        finalQuestionName = question.text?.content || question.questionName || '';
    }

    return {
        questionName: finalQuestionName,
        questionType,
        questionPenalty: question.penalty || question.questionPenalty || '0',
        questionDuration: {
            min: '0',
            hrs: '0',
        },
        questionMark: question.mark || question.questionMark || '1',
        id: question.id,
        status: question.status,
        validAnswers: validAnswers.length > 0 ? validAnswers : undefined,
        explanation: explanation,
        canSkip: question.can_skip || question.canSkip || false,
        tags: question.tags || [],
        level: question.level,
        questionPoints: question.questionPoints,
        reattemptCount: question.reattemptCount,
        decimals: question.decimals,
        numericType: question.numericType,
        // A form question carries its own (possibly just cleared) value; a saved one has it
        // in the answer key.
        numericTolerance:
            question.numericTolerance !== undefined
                ? question.numericTolerance
                : readNumericTolerance(question.auto_evaluation_json),
        parentRichTextContent: parentRichTextContent,
        singleChoiceOptions: [],
        multipleChoiceOptions: [],
        trueFalseOptions: [],
        subjectiveAnswerText: '',
        marks: question.marks ?? null,
        negativeMarking: question.negative_marking ?? null,
    };
};

// Helper function to handle subjective questions
const handleSubjectiveQuestion = (
    transformed: TransformedQuestion,
    question: BackendQuestion | any,
    questionType: string,
    validAnswers: (number | string)[],
    subjectiveAnswerText: string
): void => {
    // Remove default validAnswers for subjective questions
    if (validAnswers.length === 0 || (validAnswers.length === 1 && validAnswers[0] === 0)) {
        transformed.validAnswers = undefined;
    }

    // Set subjective answer text
    if (subjectiveAnswerText) {
        transformed.subjectiveAnswerText = subjectiveAnswerText;
    } else if (question.subjectiveAnswerText) {
        transformed.subjectiveAnswerText = question.subjectiveAnswerText;
    } else if (question.answerText) {
        // Check for answerText field from form
        transformed.subjectiveAnswerText = question.answerText;
    }
};

// Helper function to handle numeric questions
const handleNumericQuestion = (transformed: TransformedQuestion, validAnswers: (number | string)[]): void => {
    transformed.subjectiveAnswerText = validAnswers.join(', ');
};

// Helper function to handle options for different question types
const handleQuestionOptions = (
    transformed: TransformedQuestion,
    question: BackendQuestion | any,
    questionType: string,
    validAnswers: (number | string)[]
): void => {
    // First check if it's form data (has the options arrays)
    if (question.singleChoiceOptions && question.singleChoiceOptions.length > 0) {
        transformed.singleChoiceOptions = question.singleChoiceOptions;
    } else if (question.multipleChoiceOptions && question.multipleChoiceOptions.length > 0) {
        transformed.multipleChoiceOptions = question.multipleChoiceOptions;
    } else if (question.trueFalseOptions && question.trueFalseOptions.length > 0) {
        transformed.trueFalseOptions = question.trueFalseOptions;
    } else if (question.csingleChoiceOptions && question.csingleChoiceOptions.length > 0) {
        // Handle comprehensive single choice options
        transformed.singleChoiceOptions = question.csingleChoiceOptions;
    } else if (question.cmultipleChoiceOptions && question.cmultipleChoiceOptions.length > 0) {
        // Handle comprehensive multiple choice options
        transformed.multipleChoiceOptions = question.cmultipleChoiceOptions;
    }
    // Then check if it's backend data (has the options field)
    else if (question.options && question.options.length > 0) {
        const options = transformOptions(question.options, validAnswers);

        if (questionType === 'MCQS' || questionType === 'CMCQS') {
            transformed.singleChoiceOptions = options;
        } else if (questionType === 'MCQM' || questionType === 'CMCQM') {
            transformed.multipleChoiceOptions = options;
        } else if (questionType === 'TRUE_FALSE') {
            transformed.trueFalseOptions = options;
        }
    }
};

// Main function to transform a single question
export const transformQuestion = (question: BackendQuestion | any): TransformedQuestion => {
    const validAnswers = parseValidAnswers(question);
    const questionText = getQuestionText(question);
    const questionType =
        question.question_type ||
        question.question_response_type ||
        question.questionType ||
        'MCQS';

    // Extract subjective answer from backend data
    const subjectiveAnswerText = extractSubjectiveAnswer(question, questionType);

    // Create base transformed question
    const transformed = createBaseTransformedQuestion(
        question,
        questionText,
        questionType,
        validAnswers
    );

    // Handle different question types
    if (questionType === 'NUMERIC' || questionType === 'CNUMERIC') {
        handleNumericQuestion(transformed, validAnswers);
    } else if (questionType === 'ONE_WORD' || questionType === 'LONG_ANSWER') {
        handleSubjectiveQuestion(
            transformed,
            question,
            questionType,
            validAnswers,
            subjectiveAnswerText
        );
    }

    // Spreadsheet & Written Response: no options or answer key, a config instead.
    if (isCbeQuestionType(questionType)) {
        return handleCbeQuestion(transformed, question);
    }

    // Handle options for all question types
    handleQuestionOptions(transformed, question, questionType, validAnswers);

    return transformed;
};

/**
 * A CBE question in the editor form: `cbeConfig` (parts, templates; the solution half only
 * once the editor has loaded it), the scenario in `parentRichTextContent`, and total marks
 * from the parts. A question already in form shape keeps its config and secret status; one
 * read from the slide holds the redacted config, so its secret is not in the form yet
 * (`cbeSecretStatus` undefined) and a save keeps the stored one.
 */
const handleCbeQuestion = (
    transformed: TransformedQuestion,
    question: BackendQuestion | any
): TransformedQuestion => {
    const config =
        cbeConfigFromEvaluationJson(question.cbeConfig) ??
        cbeConfigFromEvaluationJson(question.auto_evaluation_json);
    return {
        ...transformed,
        validAnswers: undefined,
        parentRichTextContent:
            question.parentRichTextContent ?? question.parent_rich_text?.content ?? '',
        questionMark: config ? cbeQuestionMark(config) : transformed.questionMark,
        marks: config ? cbeTotalMarks(config) : transformed.marks,
        cbeConfig: config ?? null,
        cbeSecretStatus: question.cbeConfig ? question.cbeSecretStatus : undefined,
    };
};
