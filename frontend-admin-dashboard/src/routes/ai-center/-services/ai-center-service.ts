import { getInstituteId } from '@/constants/helper';
import {
    CHAT_WITH_PDF_AI_URL,
    CONVERT_PDF_TO_HTML_AI_URL,
    GENERATE_FEEDBACK_FROM_FILE_AI_URL,
    GENERATE_QUESTIONS_FROM_FILE_AI_URL,
    GENERATE_QUESTIONS_FROM_IMAGE_AI_URL,
    GET_INDIVIDUAL_AI_TASK_QUESTIONS_AI_SERVICE,
    GET_INDIVIDUAL_CHAT_WITH_PDF_AI_TASK_QUESTIONS,
    GET_LECTURE_FEEDBACK_PREVIEW_URL,
    GET_LECTURE_PLAN_PREVIEW_URL,
    GET_LECTURE_PLAN_URL,
    GET_QUESTIONS_FROM_AUDIO,
    GET_QUESTIONS_FROM_TEXT,
    GET_QUESTIONS_URL_FROM_HTML_AI_URL,
    HTML_TO_QUESTIONS_FROM_FILE_AI_URL,
    LIST_INDIVIDUAL_AI_TASKS_URL_AI_SERVICE,
    RETRY_AI_URL,
    SORT_QUESTIONS_FILE_AI_URL,
    SORT_SPLIT_FILE_AI_URL,
    START_PROCESSING_FILE_AI_URL,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type {
    AIPaperMarking,
    AIPaperSection,
} from '@/types/ai/generate-assessment/generate-complete-assessment';
import axios from 'axios';

/**
 * Get an uploaded file ready for question work.
 *
 * `mode: 'extract'` (Vsmart Extract) reads a digital PDF on the server for
 * free and sends only scans to MathPix — the response says which (`ocr`).
 * Without it every file goes to MathPix, as the generate tools always have.
 */
export interface StartProcessResponse {
    pdf_id: string;
    /** extract mode: was OCR needed, page counts, the paper's question count and the credits it will cost */
    ocr?: boolean | null;
    pages?: number | null;
    ocr_pages?: number | null;
    question_count?: number | null;
    estimated_credits?: number | null;
    /** the paper's own sections (2+) and marking scheme, when it prints them */
    sections?: AIPaperSection[] | null;
    marking?: AIPaperMarking | null;
    duration_minutes?: number | null;
}

export const handleStartProcessUploadedFile = async (
    fileId: string,
    mode?: 'extract',
    options?: { fileName?: string }
): Promise<StartProcessResponse> => {
    const response = await axios({
        method: 'POST',
        url: START_PROCESSING_FILE_AI_URL,
        params: mode
            ? { mode, instituteId: getInstituteId(), fileName: options?.fileName }
            : undefined,
        data: {
            file_id: fileId,
        },
    });
    return response?.data;
};

export const handleRetryAITask = async (taskId: string) => {
    const response = await axios({
        method: 'POST',
        url: RETRY_AI_URL,
        params: {
            taskId,
        },
    });
    return response?.data;
};

export const handleGetListIndividualTopics = async (taskType?: string) => {
    const instituteId = getInstituteId();

    // All AI task types now live in ai_service — a single source for the
    // history list (the phased media merge + per-type routing has been removed).
    const response = await axios({
        method: 'GET',
        url: LIST_INDIVIDUAL_AI_TASKS_URL_AI_SERVICE,
        params: {
            instituteId,
            ...(taskType ? { taskType } : {}),
        },
    });
    return Array.isArray(response?.data) ? response.data : [];
};

export const handleQueryGetListIndividualTopics = (taskType?: string) => {
    return {
        queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA', taskType ?? null],
        queryFn: () => handleGetListIndividualTopics(taskType),
        staleTime: 60 * 60 * 1000,
    };
};

export const handleGetQuestionsInvidualTask = async (taskId: string) => {
    // Every question task type lives in ai_service now — single call, no
    // media fallback. get-result converts the stored LLM JSON to
    // AutoQuestionPaperResponse (empty while the task isn't done yet).
    const response = await axios({
        method: 'GET',
        url: GET_INDIVIDUAL_AI_TASK_QUESTIONS_AI_SERVICE,
        params: { taskId },
    });
    return response?.data;
};

export const handleGetChatWithPDFInvidualTask = async (parentId: string) => {
    const response = await axios({
        method: 'GET',
        url: GET_INDIVIDUAL_CHAT_WITH_PDF_AI_TASK_QUESTIONS,
        params: {
            parentId,
        },
    });
    return response?.data;
};

export const handleGetLecturePlan = async (taskId: string) => {
    const response = await axios({
        method: 'GET',
        url: GET_LECTURE_PLAN_PREVIEW_URL,
        params: {
            taskId,
        },
    });
    return response?.data;
};

export const handleGetEvaluateLecture = async (taskId: string) => {
    const response = await axios({
        method: 'GET',
        url: GET_LECTURE_FEEDBACK_PREVIEW_URL,
        params: {
            taskId,
        },
    });
    return response?.data;
};

export const handleSortSplitPDF = async (
    pdfId: string,
    requiredTopics: string,
    taskName: string,
    taskId: string
) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'GET',
        url: SORT_SPLIT_FILE_AI_URL,
        params: {
            pdfId,
            requiredTopics,
            taskName,
            instituteId,
            taskId,
        },
    });
    return response?.data;
};

export const handleSortQuestionsPDF = async (
    pdfId: string,
    userPrompt: string,
    taskName: string
) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'GET',
        url: SORT_QUESTIONS_FILE_AI_URL,
        params: {
            pdfId,
            userPrompt,
            taskName,
            instituteId,
        },
    });
    return response?.data;
};

/**
 * Start a PDF → questions task.
 *
 * `mode: 'extract'` digitises the paper's OWN questions verbatim (every
 * question, options, passages, marks, printed answer key and solutions) —
 * what Vsmart Extract promises. Without it the server GENERATES questions
 * from the material, which is Vsmart Upload's job.
 */
export type SectionMode = 'split' | 'single';

export const handleGenerateAssessmentQuestions = async (
    pdfId: string,
    userPrompt: string,
    taskName: string,
    taskId: string,
    mode?: 'extract',
    /** extract only: one assessment section per paper section, or everything in one */
    sectionMode?: SectionMode
) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'GET',
        url: GENERATE_QUESTIONS_FROM_FILE_AI_URL,
        params: {
            pdfId,
            userPrompt,
            taskName,
            instituteId,
            taskId,
            ...(mode ? { mode } : {}),
            ...(mode && sectionMode ? { sectionMode } : {}),
        },
    });
    return response?.data;
};
export const handleGenerateAssessmentImage = async (
    pdfId: string,
    userPrompt: string,
    taskName: string,
    taskId: string
) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'GET',
        url: GENERATE_QUESTIONS_FROM_IMAGE_AI_URL,
        params: {
            pdfId,
            userPrompt,
            taskName,
            instituteId,
            taskId,
        },
    });
    return response?.data;
};

export const handleEvaluateLecture = async (
    fileId: string,
    taskName: string,
    preferredModel?: string
) => {
    const instituteId = getInstituteId();
    // Migrated to ai_service: pass the uploaded audio fileId directly; ai_service
    // resolves it, transcribes in-house, and generates the feedback (single step).
    const response = await axios({
        method: 'GET',
        url: GENERATE_FEEDBACK_FROM_FILE_AI_URL,
        params: {
            fileId,
            taskName,
            instituteId,
            ...(preferredModel && { preferredModel }),
        },
    });
    return response?.data;
};

export const handleGenerateAssessmentQuestionsPageWise = async (
    html: string,
    userPrompt: string,
    taskId: string
) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'POST',
        url: HTML_TO_QUESTIONS_FROM_FILE_AI_URL,
        params: {
            userPrompt,
            instituteId,
        },
        data: { html: html, taskId: taskId },
    });
    return response?.data;
};

export const handleConvertPDFToHTML = async (pdfId: string, taskName: string) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'GET',
        url: CONVERT_PDF_TO_HTML_AI_URL,
        params: {
            pdfId,
            taskName,
            instituteId,
        },
    });
    return response?.data;
};

export const handleGetQuestionsFromHTMLUrl = async (html: string, userPrompt: string) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'POST',
        params: {
            userPrompt,
            instituteId,
        },
        url: GET_QUESTIONS_URL_FROM_HTML_AI_URL,
        data: { html: html },
    });
    return response?.data;
};

export const handleGetQuestionsFromAudio = async (
    fileId: string,
    numQuestions: string | null,
    prompt: string | null,
    difficulty: string | null,
    language: string | null,
    taskName: string,
    taskId: string,
    preferredModel?: string
) => {
    const instituteId = getInstituteId();
    // Migrated to ai_service: pass the uploaded audio fileId directly; ai_service
    // resolves it, transcribes in-house, and generates questions (single step).
    const response = await axios({
        method: 'GET',
        url: GET_QUESTIONS_FROM_AUDIO,
        params: {
            fileId,
            numQuestions: numQuestions,
            prompt: prompt,
            difficulty: difficulty,
            language: language,
            taskName,
            instituteId,
            taskId,
            ...(preferredModel && { preferredModel }),
        },
    });
    return response?.data;
};

export const handleGetQuestionsFromText = async (
    taskName: string,
    text: string,
    num: number,
    class_level: string,
    topics: string,
    question_type: string,
    question_language: string,
    taskId: string,
    preferredModel?: string
) => {
    const instituteId = getInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_QUESTIONS_FROM_TEXT,
        data: {
            text: text,
            num: num,
            class_level: class_level,
            topics: topics,
            question_type: question_type,
            question_language: question_language,
            taskName,
            taskId,
            ...(preferredModel && { preferredModel }),
        },
        params: { instituteId },
    });
    return response?.data;
};

export const handleGetPlanLecture = async (
    taskName: string,
    prompt: string,
    level: string,
    teachingMethod: string,
    language: string,
    lectureDuration: {
        hrs: string;
        min: string;
    },
    isQuestionGenerated: boolean,
    isAssignmentHomeworkGenerated: boolean,
    preferredModel?: string
) => {
    const instituteId = getInstituteId();
    const totalMinutes =
        Number(lectureDuration.hrs || '0') * 60 + Number(lectureDuration.min || '0');
    const response = await axios({
        method: 'GET',
        url: GET_LECTURE_PLAN_URL,
        params: {
            userPrompt: prompt,
            lectureDuration: `${totalMinutes} minutes`,
            language: language,
            methodOfTeaching: teachingMethod,
            taskName: taskName,
            instituteId,
            level: level,
            isQuestionGenerated,
            isAssignmentHomeworkGenerated,
            ...(preferredModel && { preferredModel }),
        },
    });
    return response?.data;
};

export const handleChatWithPDF = async (
    pdfId: string,
    userPrompt: string,
    taskName: string,
    parentId: string
) => {
    const instituteId = getInstituteId();
    const response = await axios({
        method: 'GET',
        url: CHAT_WITH_PDF_AI_URL,
        params: {
            pdfId,
            userPrompt,
            taskName,
            instituteId,
            parentId,
        },
    });
    return response?.data;
};
