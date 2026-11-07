import { FilterOption } from '@/types/assessments/question-paper-filter';
import { Level, QuestionResponse, Subject } from '@/types/assessments/question-paper-template';
import {
    MyMultipleChoiceOption,
    MyQuestion,
    MyQuestionPaperFormEditInterface,
    MyQuestionPaperFormInterface,
} from '../../../../types/assessments/question-paper-form';
import { useMutation } from '@tanstack/react-query';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { QuestionType, QUESTION_TYPES } from '@/constants/dummy-data';
import { getInstituteId } from '@/constants/helper';
import { renderLatexDelimiters } from '@/lib/latex-delimiters';
// function defined locally below to avoid circular dependency
// import { formatTimeStudyLibraryInSeconds } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-helper/helper';

/**
 * Per-question marks a generated paper carries in its provenance
 * (`source_meta.marks`, written by ai_service for KNOWLEDGE_BASE questions).
 * Returned as the form's string mark, or '' when the question has none — the
 * section default then applies exactly as before.
 */
export const marksFromSourceMeta = (item: { source_meta?: string | null }): string => {
    if (!item?.source_meta) return '';
    try {
        const meta = JSON.parse(item.source_meta) as { marks?: unknown };
        const marks = Number(meta?.marks);
        return Number.isFinite(marks) && marks > 0 ? String(marks) : '';
    } catch {
        return '';
    }
};

export const formatTimeStudyLibraryInSeconds = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}:${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
};

export function getPPTViewTitle(type: QuestionType): string {
    const question = QUESTION_TYPES.find((q) => q.code === type);
    if (question)
        return question.display; // Return the display text or undefined if not found
    else return '';
}

export function formatStructure(structure: string, value: string | number): string {
    // If structure does not contain parentheses, just replace the number/letter with the value
    return structure.replace(/[a-zA-Z0-9]/, `${value}`);
}

export function transformFilterData(data: Record<string, FilterOption[]>) {
    const result: Record<string, string[] | string> = {};

    Object.keys(data).forEach((key) => {
        // Safely handle undefined and assign an empty array if necessary
        const items = data[key] || [];
        result[key] = items.map((item) => item.id);

        if (key === 'name' && Array.isArray(result[key])) {
            // Perform join only if result[key] is an array
            result[key] = (result[key] as string[]).join('');
        }
    });

    return result;
}

export function transformQuestionPaperDataAI(data: MyQuestionPaperFormInterface) {
    const instituteId = getInstituteId();
    return {
        title: data.title || '',
        institute_id: instituteId,
        questions: data?.questions?.map((question) => {
            let options;
            if (question.questionType === QuestionType.MCQS) {
                options = question.singleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name ?? '',
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation ?? '', // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.TRUE_FALSE) {
                options = question.trueFalseOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name ?? '',
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation ?? '', // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.MCQM) {
                options = question.multipleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name ?? '',
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation ?? '', // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.CMCQS) {
                options = question.csingleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name ?? '',
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation ?? '', // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.CMCQM) {
                options = question.cmultipleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name ?? '',
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation ?? '', // Assuming no explanation provided for options
                    },
                }));
            }

            // Extract correct option indices as strings
            let correctOptionIds;

            if (question.questionType === QuestionType.MCQS) {
                correctOptionIds = question.singleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.MCQM) {
                correctOptionIds = question.multipleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.CMCQS) {
                correctOptionIds = question.csingleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.CMCQM) {
                correctOptionIds = question.cmultipleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.TRUE_FALSE) {
                correctOptionIds = question.trueFalseOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            }

            const auto_evaluation_json = getEvaluationJSON(
                question,
                correctOptionIds,
                question.validAnswers,
                question.subjectiveAnswerText
            );
            const options_json = getOptionsJson(question);
            const parent_rich_text = question.parentRichTextContent
                ? {
                      id: null,
                      type: 'HTML',
                      content: question.parentRichTextContent,
                  }
                : null;

            const questionTypeForBackend = getQuestionType(question.questionType);

            return {
                id: null,
                preview_id: question.questionId, // Assuming no direct mapping for preview_id
                text: {
                    id: null, // Assuming no direct mapping for text ID
                    type: 'HTML', // Assuming the content is HTML
                    content: question.questionName ?? '',
                },
                media_id: null, // Assuming no direct mapping for media_id
                created_at: null,
                updated_at: null,
                question_response_type: null, // Assuming no direct mapping for response type
                question_type: questionTypeForBackend,
                access_level: null, // Assuming no direct mapping for access level
                auto_evaluation_json, // Add auto_evaluation_json
                evaluation_type: null, // Assuming no direct mapping for evaluation type
                explanation_text: {
                    id: null, // Assuming no direct mapping for explanation text ID
                    type: 'HTML', // Assuming explanation is in HTML
                    content: question.explanation ?? '',
                },
                default_question_time_mins:
                    Number(question.questionDuration.hrs || 0) * 60 +
                    Number(question.questionDuration.min || 0),
                options, // Use the mapped options
                parent_rich_text,
                options_json,
                subject_tags: question.tags ?? [], // Manual subject/topic tags
                errors: [], // Assuming no errors are provided
                warnings: [], // Assuming no warnings are provided
            };
        }),
    };
}

export function transformQuestionPaperData(data: MyQuestionPaperFormInterface) {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    return {
        title: data.title || '',
        institute_id: INSTITUTE_ID, // Assuming there's no direct mapping for institute_id
        level_id: data.yearClass, // Assuming there's no direct mapping for level_id
        subject_id: data.subject, // Assuming there's no direct mapping for subject_id
        questions: data?.questions?.map((question) => {
            let options;
            if (question.questionType === QuestionType.MCQS) {
                options = question.singleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name,
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation, // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.TRUE_FALSE) {
                options = question.trueFalseOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name,
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation, // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.MCQM) {
                options = question.multipleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name,
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation, // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.CMCQS) {
                options = question.csingleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name,
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation, // Assuming no explanation provided for options
                    },
                }));
            } else if (question.questionType === QuestionType.CMCQM) {
                options = question.cmultipleChoiceOptions.map((opt, idx) => ({
                    id: null, // Assuming no direct mapping for option ID
                    preview_id: idx, // Using index as preview_id
                    question_id: null,
                    text: {
                        id: null, // Assuming no direct mapping for option text ID
                        type: 'HTML', // Assuming option content is HTML
                        content: opt?.name,
                    },
                    media_id: null, // Assuming no direct mapping for option media ID
                    option_order: null,
                    created_on: null,
                    updated_on: null,
                    explanation_text: {
                        id: null, // Assuming no direct mapping for explanation text ID
                        type: 'HTML', // Assuming explanation for options is in HTML
                        content: question.explanation, // Assuming no explanation provided for options
                    },
                }));
            }

            // Extract correct option indices as strings
            let correctOptionIds;

            if (question.questionType === QuestionType.MCQS) {
                correctOptionIds = question.singleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.MCQM) {
                correctOptionIds = question.multipleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.CMCQS) {
                correctOptionIds = question.csingleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.CMCQM) {
                correctOptionIds = question.cmultipleChoiceOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            } else if (question.questionType === QuestionType.TRUE_FALSE) {
                correctOptionIds = question.trueFalseOptions
                    .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
                    .filter((idx) => idx !== null); // Remove null values
            }

            const auto_evaluation_json = getEvaluationJSON(
                question,
                correctOptionIds,
                question.validAnswers,
                question.subjectiveAnswerText
            );
            const options_json = getOptionsJson(question);
            const parent_rich_text = question.parentRichTextContent
                ? {
                      id: null,
                      type: 'HTML',
                      content: question.parentRichTextContent,
                  }
                : null;

            const questionTypeForBackend = getQuestionType(question.questionType);

            return {
                id: null,
                preview_id: question.questionId, // Assuming no direct mapping for preview_id
                text: {
                    id: null, // Assuming no direct mapping for text ID
                    type: 'HTML', // Assuming the content is HTML
                    content: question.questionName,
                },
                media_id: null, // Assuming no direct mapping for media_id
                created_at: null,
                updated_at: null,
                question_response_type: null, // Assuming no direct mapping for response type
                question_type: questionTypeForBackend,
                access_level: null, // Assuming no direct mapping for access level
                auto_evaluation_json, // Add auto_evaluation_json
                evaluation_type: null, // Assuming no direct mapping for evaluation type
                explanation_text: {
                    id: null, // Assuming no direct mapping for explanation text ID
                    type: 'HTML', // Assuming explanation is in HTML
                    content: question.explanation,
                },
                default_question_time_mins:
                    Number(question.questionDuration.hrs || 0) * 60 +
                    Number(question.questionDuration.min || 0),
                options, // Use the mapped options
                parent_rich_text,
                options_json,
                subject_tags: question.tags ?? [], // Manual subject/topic tags (also pre-filled from "Tags:" marker)
                errors: [], // Assuming no errors are provided
                warnings: [], // Assuming no warnings are provided
            };
        }),
    };
}

/**
 * The answer choices a question type carries, or [] for types with none
 * (NUMERIC, ONE_WORD, LONG_ANSWER, CODING). Every row keeps all five option
 * arrays, so reading the wrong one sends four blank options to the backend.
 */
function getChoiceOptions(question: MyQuestion): MyMultipleChoiceOption[] {
    switch (question.questionType) {
        case 'MCQS':
            return question.singleChoiceOptions ?? [];
        case 'MCQM':
            return question.multipleChoiceOptions ?? [];
        case 'CMCQS':
            return question.csingleChoiceOptions ?? [];
        case 'CMCQM':
            return question.cmultipleChoiceOptions ?? [];
        case 'TRUE_FALSE':
            return question.trueFalseOptions ?? [];
        default:
            return [];
    }
}

export function convertQuestionsDataToResponse(questions: MyQuestion[], key: string) {
    const convertedQuestions = questions?.map((question) => {
        const isNew = key === 'added';
        const choiceOptions = getChoiceOptions(question);
        const options = choiceOptions.map((opt, idx) => ({
            id: isNew ? null : opt.id, // Set to null if it's a new question
            preview_id: isNew ? idx : opt.id,
            question_id: question.questionId,
            text: {
                id: null, // Assuming no mapping for text ID
                type: 'HTML',
                content: opt?.name,
            },
            media_id: null,
            option_order: null,
            created_on: null,
            updated_on: null,
            explanation_text: {
                id: null,
                type: 'HTML',
                content: question.explanation,
            },
        }));

        const correctOptionIds = choiceOptions
            .map((opt, idx) => (opt.isSelected ? (opt.id ? opt.id : idx.toString()) : null))
            .filter((idx) => idx !== null);

        // Same answer-key builder as a new paper's save. This used to be MCQ-only,
        // so an edited NUMERIC question was sent {"type":"MCQM","data":{correctOptionIds:[]}},
        // the backend found no validAnswers, and the answer reloaded as 0.
        const auto_evaluation_json = getEvaluationJSON(
            question,
            correctOptionIds,
            question.validAnswers,
            question.subjectiveAnswerText
        );
        const parent_rich_text = question.parentRichTextContent
            ? {
                  id: null,
                  type: 'HTML',
                  content: question.parentRichTextContent,
              }
            : null;

        return {
            id: isNew ? null : question.questionId, // Set to null if it's a new question
            preview_id: question.questionId, // Keep preview_id as the questionId
            text: {
                id: null,
                type: 'HTML',
                content: question.questionName,
            },
            media_id: null,
            created_at: null,
            updated_at: null,
            question_response_type: null,
            // CMCQS/CMCQM/CNUMERIC are form-only types; the backend rejects them.
            question_type: getQuestionType(question.questionType),
            access_level: null,
            auto_evaluation_json,
            evaluation_type: null,
            explanation_text: {
                id: null,
                type: 'HTML',
                content: question.explanation,
            },
            default_question_time_mins: null,
            options,
            parent_rich_text,
            options_json: getOptionsJson(question),
            subject_tags: question.tags ?? [], // Preserve/update subject tags on edit
            errors: [],
            warnings: [],
        };
    });
    return convertedQuestions;
}

export function compareQuestions(
    oldData: MyQuestionPaperFormInterface,
    newData: MyQuestionPaperFormInterface
) {
    const oldQuestionsMap = new Map(oldData.questions?.map((q) => [q.questionId, q]));
    const newQuestionsMap = new Map(newData.questions?.map((q) => [q.questionId, q]));

    let added_questions = [];
    let deleted_questions = [];
    let updated_questions = [];

    // Find added and updated questions
    for (const [questionId, newQuestion] of newQuestionsMap.entries()) {
        if (!oldQuestionsMap.has(questionId)) {
            added_questions.push(newQuestion);
        } else {
            const oldQuestion = oldQuestionsMap.get(questionId);
            if (JSON.stringify(oldQuestion) !== JSON.stringify(newQuestion)) {
                updated_questions.push(newQuestion);
            }
        }
    }

    // Find deleted questions
    for (const [questionId, oldQuestion] of oldQuestionsMap.entries()) {
        if (!newQuestionsMap.has(questionId)) {
            deleted_questions.push(oldQuestion);
        }
    }
    added_questions = convertQuestionsDataToResponse(added_questions, 'added');
    deleted_questions = convertQuestionsDataToResponse(deleted_questions, 'deleted');
    updated_questions = convertQuestionsDataToResponse(updated_questions, 'updated');

    return { added_questions, deleted_questions, updated_questions };
}

export function transformQuestionPaperEditData(
    data: MyQuestionPaperFormInterface,
    previousQuestionPaperData: MyQuestionPaperFormEditInterface
) {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];

    return {
        id: data.questionPaperId,
        title: data.title,
        institute_id: INSTITUTE_ID,
        ...(data.yearClass !== 'N/A' && { level_id: data.yearClass }),
        ...(data.subject !== 'N/A' && { subject_id: data.subject }),
        ...compareQuestions(previousQuestionPaperData, data),
    };
}

export const getLevelNameById = (levels: Level[], id: string | null): string => {
    const level = levels.find((item) => item.id === id);
    return level?.level_name ?? 'N/A';
};

export const getSubjectNameById = (subjects: Subject[], id: string | null): string => {
    const subject = subjects.find((item) => item.id === id);
    return subject?.subject_name || 'N/A';
};

export const getIdByLevelName = (levels: Level[], name: string | null | undefined): string => {
    const level = levels.find((item) => item.level_name === name);
    return level?.id || 'N/A';
};

export const getIdBySubjectName = (
    subjects: Subject[],
    name: string | null | undefined
): string => {
    const subject = subjects.find((item) => item.subject_name === name);
    return subject?.id || 'N/A';
};

export const transformResponseDataToMyQuestionsSchema = (data: QuestionResponse[]) => {
    return data?.map((item) => {
        const correctOptionIds = item.auto_evaluation_json
            ? JSON.parse(item.auto_evaluation_json)?.data?.correctOptionIds
            : [];
        const validAnswers = item.auto_evaluation_json
            ? JSON.parse(item.auto_evaluation_json)?.data?.validAnswers
            : [];
        let decimals;
        let numericType;
        let subjectiveAnswerText;
        if (item.options_json) {
            const optionsJson = JSON.parse(item.options_json);
            decimals = optionsJson?.decimals || 0;
            // Saved as numericType; numeric_type kept for any older rows.
            numericType = optionsJson?.numericType || optionsJson?.numeric_type || '';
        }
        if (item.auto_evaluation_json) {
            if (item.question_type === 'ONE_WORD') {
                subjectiveAnswerText = JSON.parse(item.auto_evaluation_json)?.data?.answer;
            } else if (item.question_type === 'LONG_ANSWER') {
                subjectiveAnswerText = renderLatexDelimiters(
                    JSON.parse(item.auto_evaluation_json)?.data?.answer?.content
                );
            }
        }
        let codingConfig;
        if (item.question_type === 'CODING' && item.auto_evaluation_json) {
            try {
                codingConfig = JSON.parse(item.auto_evaluation_json)?.data;
            } catch {
                codingConfig = undefined;
            }
        }
        const baseQuestion: MyQuestion = {
            id: item.id || '',
            questionId: item.id || item.preview_id || undefined,
            questionName:
                renderLatexDelimiters(item.text?.content || item.text_data?.content) || '',
            explanation:
                renderLatexDelimiters(
                    item.explanation_text?.content || item.explanation_text_data?.content
                ) || '',
            questionType: item.question_type,
            questionMark: marksFromSourceMeta(item),
            questionPenalty: '',
            questionDuration: {
                hrs: String(Math.floor((item.default_question_time_mins ?? 0) / 60)), // Extract hours
                min: String((item.default_question_time_mins ?? 0) % 60), // Extract remaining minutes
            },
            singleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            multipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            csingleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            cmultipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            trueFalseOptions: Array(2).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            timestamp: item.question_time_in_millis
                ? formatTimeStudyLibraryInSeconds(item.question_time_in_millis / 1000)
                : '0:0:0',
            newQuestion: item?.new_question,
            validAnswers: [],
            decimals,
            numericType,
            parentRichTextContent: renderLatexDelimiters(item.parent_rich_text?.content) || null,
            subjectiveAnswerText,
            status: item.status,
            canSkip: item.can_skip,
            codingConfig,
            tags: item.subject_tags ?? [], // Subject tags: marker-pre-filled on parse, saved tags on edit/read-back
        };

        if (item.question_type === 'MCQS') {
            baseQuestion.singleChoiceOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: renderLatexDelimiters(option.text?.content) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'MCQM') {
            baseQuestion.multipleChoiceOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: renderLatexDelimiters(option.text?.content) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'CMCQS') {
            baseQuestion.csingleChoiceOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: renderLatexDelimiters(option.text?.content) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'CMCQM') {
            baseQuestion.cmultipleChoiceOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: renderLatexDelimiters(option.text?.content) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'TRUE_FALSE') {
            baseQuestion.trueFalseOptions = item.options.map((option) => ({
                id: option.id ? option.id : '',
                name: renderLatexDelimiters(option.text?.content) || '',
                isSelected: correctOptionIds.includes(option.id || option.preview_id),
            }));
        } else if (item.question_type === 'NUMERIC') {
            baseQuestion.validAnswers = validAnswers;
        }
        return baseQuestion;
    });
};

export const transformResponseDataToMyQuestionsSchemaSingleQuestion = (item: QuestionResponse) => {
    const correctOptionIds = item.auto_evaluation_json
        ? JSON.parse(item.auto_evaluation_json)?.data?.correctOptionIds
        : [];
    const validAnswers = item.auto_evaluation_json
        ? JSON.parse(item.auto_evaluation_json)?.data?.validAnswers
        : [];
    let decimals;
    let numericType;
    let subjectiveAnswerText;
    if (item.options_json) {
        const optionsJson = JSON.parse(item.options_json);
        decimals = optionsJson?.decimals || 0;
        // Saved as numericType; numeric_type kept for any older rows.
        numericType = optionsJson?.numericType || optionsJson?.numeric_type || '';
    }
    if (item.auto_evaluation_json) {
        if (item.question_type === 'ONE_WORD') {
            subjectiveAnswerText = JSON.parse(item.auto_evaluation_json)?.data?.answer;
        } else if (item.question_type === 'LONG_ANSWER') {
            subjectiveAnswerText = renderLatexDelimiters(
                JSON.parse(item.auto_evaluation_json)?.data?.answer?.content
            );
        }
    }
    let codingConfig;
    if (item.question_type === 'CODING' && item.auto_evaluation_json) {
        try {
            codingConfig = JSON.parse(item.auto_evaluation_json)?.data;
        } catch {
            codingConfig = undefined;
        }
    }
    const baseQuestion: MyQuestion = {
        id: item.id || '',
        questionId: item.id || item.preview_id || undefined,
        questionName: renderLatexDelimiters(item.text?.content || item.text_data?.content) || '',
        explanation:
            renderLatexDelimiters(
                item.explanation_text?.content || item.explanation_text_data?.content
            ) || '',
        questionType: item.question_type,
        questionMark: marksFromSourceMeta(item),
        questionPenalty: '',
        questionDuration: {
            hrs: String(Math.floor((item.default_question_time_mins ?? 0) / 60)), // Extract hours
            min: String((item.default_question_time_mins ?? 0) % 60), // Extract remaining minutes
        },
        singleChoiceOptions: Array(4).fill({
            id: '',
            name: '',
            isSelected: false,
        }),
        multipleChoiceOptions: Array(4).fill({
            id: '',
            name: '',
            isSelected: false,
        }),
        csingleChoiceOptions: Array(4).fill({
            id: '',
            name: '',
            isSelected: false,
        }),
        cmultipleChoiceOptions: Array(4).fill({
            id: '',
            name: '',
            isSelected: false,
        }),
        trueFalseOptions: Array(2).fill({
            id: '',
            name: '',
            isSelected: false,
        }),
        timestamp: item.question_time_in_millis
            ? formatTimeStudyLibraryInSeconds(item.question_time_in_millis / 1000)
            : '0:0:0',
        newQuestion: item?.new_question,
        validAnswers: [],
        decimals,
        numericType,
        parentRichTextContent: renderLatexDelimiters(item.parent_rich_text?.content) || null,
        subjectiveAnswerText,
        codingConfig,
    };

    if (item.question_type === 'MCQS') {
        baseQuestion.singleChoiceOptions = item.options.map((option) => ({
            id: option.id ? option.id : '',
            name: renderLatexDelimiters(option.text?.content) || '',
            isSelected: correctOptionIds.includes(option.id || option.preview_id),
        }));
    } else if (item.question_type === 'MCQM') {
        baseQuestion.multipleChoiceOptions = item.options.map((option) => ({
            id: option.id ? option.id : '',
            name: renderLatexDelimiters(option.text?.content) || '',
            isSelected: correctOptionIds.includes(option.id || option.preview_id),
        }));
    } else if (item.question_type === 'CMCQS') {
        baseQuestion.csingleChoiceOptions = item.options.map((option) => ({
            id: option.id ? option.id : '',
            name: renderLatexDelimiters(option.text?.content) || '',
            isSelected: correctOptionIds.includes(option.id || option.preview_id),
        }));
    } else if (item.question_type === 'CMCQM') {
        baseQuestion.cmultipleChoiceOptions = item.options.map((option) => ({
            id: option.id ? option.id : '',
            name: renderLatexDelimiters(option.text?.content) || '',
            isSelected: correctOptionIds.includes(option.id || option.preview_id),
        }));
    } else if (item.question_type === 'TRUE_FALSE') {
        baseQuestion.trueFalseOptions = item.options.map((option) => ({
            id: option.id ? option.id : '',
            name: renderLatexDelimiters(option.text?.content) || '',
            isSelected: correctOptionIds.includes(option.id || option.preview_id),
        }));
    } else if (item.question_type === 'NUMERIC') {
        baseQuestion.validAnswers = validAnswers;
    }
    return baseQuestion;
};

export const convertQuestionsToExportSchema = (rawQuestions: QuestionResponse[]) => {
    return rawQuestions.map((q, idx) => ({
        question_id: q.id,
        question: {
            id: q.text.id,
            type: q.text.type,
            content: q.text.content,
        },
        options_with_explanation: q.options.map((opt) => ({
            id: opt.id,
            text: {
                content: opt.text.content,
            },
        })),
        marking_json: q.auto_evaluation_json,
        evaluation_json: q.auto_evaluation_json,
        explanation_text: q.explanation_text?.content || q.explanation_text_data?.content || '',
        question_type: q.question_type,
        section_id: q.section_id ?? '',
        question_duration: q.default_question_time_mins ?? 1, // default to 1 if null
        question_order: idx + 1,
    }));
};

export const handleRefetchData = (
    getFilteredFavouriteData: ReturnType<typeof useMutation>,
    getFilteredActiveData: ReturnType<typeof useMutation>,
    pageNo: number,
    selectedQuestionPaperFilters: Record<string, FilterOption[]>
) => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    getFilteredFavouriteData.mutate({
        pageNo,
        pageSize: 10,
        instituteId: INSTITUTE_ID,
        data: {
            ...selectedQuestionPaperFilters,
            statuses: [{ id: 'FAVOURITE', name: 'FAVOURITE' }],
        },
    });
    getFilteredActiveData.mutate({
        pageNo,
        pageSize: 10,
        instituteId: INSTITUTE_ID,
        data: {
            ...selectedQuestionPaperFilters,
            statuses: [{ id: 'ACTIVE', name: 'ACTIVE' }],
        },
    });
};

// Helper function to check if Quill content is effectively empty
export const isQuillContentEmpty = (content: string) => {
    if (!content) return true;

    // Check for common Quill empty patterns
    if (content === '<p><br></p>' || content === '<p></p>') return true;

    // Strip all HTML tags and check if there's any text content left
    const textOnly = content.replace(/<[^>]*>/g, '').trim();
    return textOnly.length === 0;
};

/**
 * The answers of a numeric question worth saving. An answer box the teacher left
 * empty is null in the form; it must not reach the answer key. Every other value
 * goes through untouched, exactly as before.
 */
export const usableNumericAnswers = (validAnswers?: unknown[] | null): number[] =>
    (validAnswers ?? []).filter(
        (answer) => answer !== null && answer !== undefined && answer !== ''
    ) as number[];

const hasNumericAnswer = (validAnswers?: unknown[] | null) =>
    usableNumericAnswers(validAnswers).some((answer) => Number.isFinite(Number(answer)));

/**
 * Index of the first numeric question that would be saved with no answer, or -1.
 * Saved like that, every learner's response to it is graded wrong.
 *
 * With `previous` (editing a saved paper) only questions that are new or whose
 * answer the teacher changed count: a question already saved without an answer,
 * and left alone, keeps saving exactly as it did.
 */
export const findNumericQuestionWithoutAnswer = (
    questions: MyQuestion[] = [],
    previous?: MyQuestion[]
): number => {
    const before = new Map((previous ?? []).map((question) => [question.questionId, question]));
    return questions.findIndex((question) => {
        if (question.questionType !== 'NUMERIC' && question.questionType !== 'CNUMERIC') {
            return false;
        }
        if (hasNumericAnswer(question.validAnswers)) return false;
        const saved = before.get(question.questionId);
        return (
            !saved || JSON.stringify(saved.validAnswers) !== JSON.stringify(question.validAnswers)
        );
    });
};

export function getEvaluationJSON(
    question: MyQuestion,
    correctOptionIds?: (string | null)[],
    validAnswers?: number[],
    subjectiveAnswerText?: string
): string {
    switch (question.questionType) {
        case 'TRUE_FALSE':
            return JSON.stringify({
                type: 'TRUE_FALSE',
                data: {
                    correctOptionIds,
                },
            });
        case 'MCQS':
            return JSON.stringify({
                type: 'MCQS',
                data: {
                    correctOptionIds,
                },
            });
        case 'CMCQS':
            return JSON.stringify({
                type: 'MCQS',
                data: {
                    correctOptionIds,
                },
            });
        case 'MCQM':
            return JSON.stringify({
                type: 'MCQM',
                data: {
                    correctOptionIds,
                },
            });
        case 'CMCQM':
            return JSON.stringify({
                type: 'MCQM',
                data: {
                    correctOptionIds,
                },
            });
        case 'NUMERIC':
            return JSON.stringify({
                type: 'NUMERIC',
                data: {
                    validAnswers: usableNumericAnswers(validAnswers),
                },
            });
        case 'CNUMERIC':
            return JSON.stringify({
                type: 'NUMERIC',
                data: {
                    validAnswers: usableNumericAnswers(validAnswers),
                },
            });
        case 'ONE_WORD':
            return JSON.stringify({
                type: 'ONE_WORD',
                data: {
                    answer: subjectiveAnswerText,
                },
            });
        case 'LONG_ANSWER':
            return JSON.stringify({
                type: 'ONE_WORD',
                data: {
                    answer: {
                        id: null,
                        type: 'HTML',
                        content: subjectiveAnswerText,
                    },
                },
            });
        case 'CODING':
            return JSON.stringify({
                type: 'CODING',
                data: question.codingConfig ?? {},
            });
        default:
            return '';
    }
}
export function getOptionsJson(question: MyQuestion): string | null {
    switch (question.questionType) {
        case 'MCQS':
            return null;
        case 'MCQM':
            return null;
        case 'NUMERIC':
        case 'CNUMERIC':
            return JSON.stringify({
                decimals: question.decimals,
                numericType: question.numericType,
            });
        default:
            return null;
    }
}
export const getQuestionType = (type: string): string => {
    if (type === 'CMCQS') return 'MCQS';
    else if (type === 'CMCQM') return 'MCQM';
    else if (type === 'CNUMERIC') return 'NUMERIC';
    else return type;
};
